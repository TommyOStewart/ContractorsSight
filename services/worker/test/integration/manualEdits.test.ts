import { afterAll, describe, expect, it } from "vitest";
import { ChangeSetError } from "../../src/commit/changeSetService";
import { applyManualEdit } from "../../src/commit/manualEdits";
import { createApp } from "../../src/http/app";
import { jobVersion, seedOrg, sql } from "./seed";

afterAll(() => sql.end());

describe("applyManualEdit", () => {
  it("updates a client and audits it as a manual change with no capture", async () => {
    const org = await seedOrg();
    const result = await applyManualEdit(sql, {
      userId: org.userId,
      orgId: org.orgId,
      operations: [{ tool: "update_client", args: { clientId: org.clientId, changes: { phone: "555-0101", email: "jeb@example.test" } } }],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const [client] = await sql`select name, phone, email from clients where id = ${org.clientId}`;
    expect(client).toMatchObject({ name: "Jeb Henderson", phone: "555-0101", email: "jeb@example.test" });
    const audits = await sql`select source, action, change_set_id, capture_id, before, after from audit_events where entity_id = ${org.clientId}`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ source: "manual", action: "update", changeSetId: null, captureId: null });
    expect((audits[0]!.before as { phone: string | null }).phone).toBeNull();
  });

  it("schedules a job from the version the screen showed, and refuses a stale screen", async () => {
    const org = await seedOrg();
    const shown = await jobVersion(org.jobId);
    const ok = await applyManualEdit(sql, {
      userId: org.userId,
      orgId: org.orgId,
      operations: [{ tool: "schedule_job", args: { jobId: org.jobId, start: "2026-10-07T13:00:00.000Z", end: "2026-10-07T16:00:00.000Z" } }],
      baseJobVersions: { [org.jobId]: shown },
    });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    const [job] = await sql`select status from jobs where id = ${org.jobId}`;
    expect(job!.status).toBe("scheduled");

    // Same screen, not reloaded: the job has moved on since.
    const stale = await applyManualEdit(sql, {
      userId: org.userId,
      orgId: org.orgId,
      operations: [{ tool: "update_job_fields", args: { jobId: org.jobId, changes: { title: "Old screen" } } }],
      baseJobVersions: { [org.jobId]: shown },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.issues.map((i) => i.code)).toEqual(["STALE_VERSION"]);
  });

  it("applies the same business rules as captures", async () => {
    const org = await seedOrg();
    const result = await applyManualEdit(sql, {
      userId: org.userId,
      orgId: org.orgId,
      operations: [{ tool: "request_status_change", args: { jobId: org.jobId, toStatus: "paid" } }],
    });
    expect(result.ok).toBe(false);
    const [job] = await sql`select status from jobs where id = ${org.jobId}`;
    expect(job!.status).toBe("accepted");
  });

  it("refuses records in another company and tools that aren't plain edits", async () => {
    const owner = await seedOrg();
    const outsider = await seedOrg();
    await expect(
      applyManualEdit(sql, {
        userId: outsider.userId,
        orgId: owner.orgId,
        operations: [{ tool: "update_client", args: { clientId: owner.clientId, changes: { name: "Hacked" } } }],
      }),
    ).rejects.toMatchObject({ status: 404 });

    const crossOrg = await applyManualEdit(sql, {
      userId: outsider.userId,
      orgId: outsider.orgId,
      operations: [{ tool: "update_client", args: { clientId: owner.clientId, changes: { name: "Hacked" } } }],
    });
    expect(crossOrg.ok).toBe(false);

    await expect(
      applyManualEdit(sql, {
        userId: owner.userId,
        orgId: owner.orgId,
        operations: [{ tool: "flag_ambiguity", args: { question: "?", candidates: [] } }],
      }),
    ).rejects.toBeInstanceOf(ChangeSetError);
  });

  it("is reachable over HTTP", async () => {
    const org = await seedOrg();
    const app = createApp({ sql, verifyUser: async (token) => (token === "good" ? org.userId : null) });
    const res = await app.request("/edits", {
      method: "POST",
      headers: { authorization: "Bearer good", "content-type": "application/json" },
      body: JSON.stringify({ orgId: org.orgId, operations: [{ tool: "add_note", args: { jobId: org.jobId, body: "Typed straight in" } }] }),
    });
    expect(res.status).toBe(200);
    const notes = await sql`select body from notes where job_id = ${org.jobId}`;
    expect(notes.map((n) => n.body)).toEqual(["Typed straight in"]);
  });
});
