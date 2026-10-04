import { afterAll, describe, expect, it } from "vitest";
import { approveChangeSet, ChangeSetError, rejectChangeSet } from "../../src/commit/changeSetService";
import { createApp } from "../../src/http/app";
import { jobVersion, seedOrg, sql, stageChangeSet } from "./seed";

afterAll(() => sql.end());

describe("approveChangeSet", () => {
  it("applies new records linked by temp IDs, with audit events, in one go", async () => {
    const org = await seedOrg();
    const { changeSetId, captureId } = await stageChangeSet(org, [
      { tool: "create_client", args: { tempId: "$c_1", name: "Ada Lovelace", siteAddress: { line1: "12 Elm St", city: "Springfield" } } },
      { tool: "create_job", args: { tempId: "$j1", clientId: "$c_1", title: "Replace water heater", jobType: "Water Heater" } },
      { tool: "add_material", args: { jobId: "$j1", description: "50gal gas water heater", quantity: 1, unitCostDollars: 899.99 } },
      { tool: "add_note", args: { jobId: "$j1", body: "Gate code 4411" } },
    ]);

    const result = await approveChangeSet(sql, { changeSetId, userId: org.userId });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const clientId = result.tempIdMap.$c_1!;
    const jobId = result.tempIdMap.$j1!;
    const [client] = await sql`select name from clients where id = ${clientId} and org_id = ${org.orgId}`;
    const [job] = await sql`select client_id, job_type, status, site_id from jobs where id = ${jobId}`;
    const [material] = await sql`select unit_cost_cents, status from material_items where job_id = ${jobId}`;
    const [site] = await sql`select id, line1, client_id from sites where client_id = ${clientId}`;
    expect(client!.name).toBe("Ada Lovelace");
    expect(job).toMatchObject({ clientId, jobType: "water heater", status: "lead", siteId: site!.id }); // no site given → the client's only site
    expect(material).toMatchObject({ unitCostCents: "89999", status: "needed" });
    expect(site).toMatchObject({ line1: "12 Elm St", clientId });

    const audits = await sql`select entity_type, source, change_set_id, capture_id from audit_events where change_set_id = ${changeSetId} order by occurred_at`;
    expect(audits.map((a) => a.entityType).sort()).toEqual(["client", "job", "material", "note", "site"]);
    expect(audits.every((a) => a.source === "text" && a.captureId === captureId)).toBe(true);

    const [changeSet] = await sql`select status, reviewed_by, temp_id_map from change_sets where id = ${changeSetId}`;
    expect(changeSet).toMatchObject({ status: "approved", reviewedBy: org.userId, tempIdMap: result.tempIdMap });
    const [capture] = await sql`select status from captures where id = ${captureId}`;
    expect(capture!.status).toBe("committed");
  });

  it("puts a job with no site on its client's only site", async () => {
    const org = await seedOrg();
    const { changeSetId } = await stageChangeSet(org, [
      { tool: "create_client", args: { tempId: "$c1", name: "Priya Shah", siteAddress: { line1: "9 Willow Way" } } },
      { tool: "create_job", args: { tempId: "$j1", clientId: "$c1", title: "Tankless quote" } },
    ]);
    const result = await approveChangeSet(sql, { changeSetId, userId: org.userId });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const [job] = await sql`select j.site_id, s.line1 from jobs j join sites s on s.id = j.site_id where j.id = ${result.tempIdMap.$j1!}`;
    expect(job!.line1).toBe("9 Willow Way");
    const sites = await sql`select 1 from sites where client_id = ${result.tempIdMap.$c1!}`;
    expect(sites).toHaveLength(1);
  });

  it("rejects a ChangeSet whose job changed after it was proposed, and applies nothing", async () => {
    const org = await seedOrg();
    const base = await jobVersion(org.jobId);
    const { changeSetId } = await stageChangeSet(org, [{ tool: "add_note", args: { jobId: org.jobId, body: "should not land" } }], {
      [org.jobId]: base,
    });

    await sql`update jobs set title = 'Edited on another phone' where id = ${org.jobId}`; // bumps the version

    const result = await approveChangeSet(sql, { changeSetId, userId: org.userId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toEqual(["STALE_VERSION"]);

    const notes = await sql`select 1 from notes where job_id = ${org.jobId}`;
    expect(notes).toHaveLength(0);
    const [changeSet] = await sql`select status, validation_issues from change_sets where id = ${changeSetId}`;
    expect(changeSet!.status).toBe("pending");
    expect((changeSet!.validationIssues as { code: string }[])[0]!.code).toBe("STALE_VERSION");
  });

  it("schedules then starts a job, and versions quotes", async () => {
    const org = await seedOrg();
    const base = { [org.jobId]: await jobVersion(org.jobId) };
    const first = await stageChangeSet(
      org,
      [
        { tool: "schedule_job", args: { jobId: org.jobId, start: "2026-10-06T08:00:00-05:00", end: "2026-10-06T12:00:00-05:00" } },
        { tool: "request_status_change", args: { jobId: org.jobId, toStatus: "in_progress" } },
        {
          tool: "revise_quote",
          args: {
            jobId: org.jobId,
            lineItems: [
              { kind: "labor", description: "Install", hours: 3.5, hourlyRateDollars: 125 },
              { kind: "material", description: "Expansion tank", quantity: 2, unitPriceDollars: 64.99 },
            ],
          },
        },
      ],
      base,
    );
    expect((await approveChangeSet(sql, { changeSetId: first.changeSetId, userId: org.userId })).ok).toBe(true);

    const [job] = await sql`select status, scheduled_start from jobs where id = ${org.jobId}`;
    expect(job!.status).toBe("in_progress");
    expect((job!.scheduledStart as Date).toISOString()).toBe("2026-10-06T13:00:00.000Z");

    const [v1] = await sql`select id, version, total_cents from quotes where job_id = ${org.jobId}`;
    expect(v1).toMatchObject({ version: 1, totalCents: String(3.5 * 12500 + 2 * 6499) });

    const second = await stageChangeSet(
      org,
      [{ tool: "revise_quote", args: { jobId: org.jobId, basedOnQuoteId: v1!.id, lineItems: [{ kind: "labor", description: "Install", hours: 4, hourlyRateDollars: 125 }] } }],
      { [org.jobId]: await jobVersion(org.jobId) },
    );
    expect((await approveChangeSet(sql, { changeSetId: second.changeSetId, userId: org.userId })).ok).toBe(true);
    const quotes = await sql`select version, status, supersedes_quote_id from quotes where job_id = ${org.jobId} order by version`;
    expect(quotes).toMatchObject([
      { version: 1, status: "superseded" },
      { version: 2, status: "draft", supersedesQuoteId: v1!.id },
    ]);
  });

  it("treats a ChangeSet in another org as not found", async () => {
    const owner = await seedOrg();
    const outsider = await seedOrg();
    const { changeSetId } = await stageChangeSet(owner, [{ tool: "add_note", args: { clientId: owner.clientId, body: "x" } }]);
    await expect(approveChangeSet(sql, { changeSetId, userId: outsider.userId })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to approve twice, and rejects cleanly", async () => {
    const org = await seedOrg();
    const approved = await stageChangeSet(org, [{ tool: "add_note", args: { clientId: org.clientId, body: "once" } }]);
    expect((await approveChangeSet(sql, { changeSetId: approved.changeSetId, userId: org.userId })).ok).toBe(true);
    const again = approveChangeSet(sql, { changeSetId: approved.changeSetId, userId: org.userId });
    await expect(again).rejects.toBeInstanceOf(ChangeSetError);
    await expect(again).rejects.toMatchObject({ status: 409 });

    const rejected = await stageChangeSet(org, [{ tool: "add_note", args: { clientId: org.clientId, body: "never" } }]);
    await rejectChangeSet(sql, { changeSetId: rejected.changeSetId, userId: org.userId });
    const [row] = await sql`select cs.status, c.status as capture_status from change_sets cs join captures c on c.id = cs.capture_id where cs.id = ${rejected.changeSetId}`;
    expect(row).toMatchObject({ status: "rejected", captureStatus: "rejected" });
    const notes = await sql`select body from notes where client_id = ${org.clientId}`;
    expect(notes.map((n) => n.body)).toEqual(["once"]);
  });
});

describe("HTTP API", () => {
  it("requires a valid token and returns the commit result", async () => {
    const org = await seedOrg();
    const app = createApp({ sql, verifyUser: async (token) => (token === "good" ? org.userId : null) });
    const { changeSetId } = await stageChangeSet(org, [{ tool: "add_note", args: { clientId: org.clientId, body: "via http" } }]);

    expect((await app.request(`/change-sets/${changeSetId}/approve`, { method: "POST" })).status).toBe(401);
    expect(
      (await app.request(`/change-sets/${changeSetId}/approve`, { method: "POST", headers: { authorization: "Bearer bad" } })).status,
    ).toBe(401);

    const ok = await app.request(`/change-sets/${changeSetId}/approve`, { method: "POST", headers: { authorization: "Bearer good" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });

    const twice = await app.request(`/change-sets/${changeSetId}/approve`, { method: "POST", headers: { authorization: "Bearer good" } });
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({ error: "Change set is already approved." });
  });
});

describe("approving a selection", () => {
  it("applies only the ticked operations", async () => {
    const org = await seedOrg();
    const { changeSetId } = await stageChangeSet(org, [
      { tool: "add_note", args: { clientId: org.clientId, body: "skip me" } },
      { tool: "add_note", args: { clientId: org.clientId, body: "keep me" } },
    ]);
    expect((await approveChangeSet(sql, { changeSetId, userId: org.userId, include: [1] })).ok).toBe(true);
    const notes = await sql`select body from notes where client_id = ${org.clientId}`;
    expect(notes.map((n) => n.body)).toEqual(["keep me"]);
  });

  it("refuses a selection that drops something a kept change depends on", async () => {
    const org = await seedOrg();
    const { changeSetId } = await stageChangeSet(org, [
      { tool: "create_client", args: { tempId: "$c1", name: "Priya Shah" } },
      { tool: "create_job", args: { clientId: "$c1", title: "Tankless quote" } },
    ]);
    const result = await approveChangeSet(sql, { changeSetId, userId: org.userId, include: [1] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toEqual(["UNKNOWN_TEMP_ID"]);
    const [cs] = await sql`select status from change_sets where id = ${changeSetId}`;
    expect(cs!.status).toBe("pending");
  });

  it("refuses an empty selection", async () => {
    const org = await seedOrg();
    const { changeSetId } = await stageChangeSet(org, [{ tool: "add_note", args: { clientId: org.clientId, body: "x" } }]);
    await expect(approveChangeSet(sql, { changeSetId, userId: org.userId, include: [] })).rejects.toMatchObject({ status: 409 });
  });
});

describe("CORS", () => {
  it("answers browser preflights without a token", async () => {
    const app = createApp({ sql, verifyUser: async () => null });
    const res = await app.request("/captures", { method: "OPTIONS", headers: { origin: "http://localhost:8083", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
