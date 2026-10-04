import { afterAll, describe, expect, it } from "vitest";
import { createTextCapture, localDay } from "../../src/capture/captureService";
import { approveChangeSet } from "../../src/commit/changeSetService";
import { PostgresPlannerData } from "../../src/planner/PostgresPlannerData";
import type { ChatModel, ChatResponse } from "../../src/planner/types";
import { seedOrg, sql } from "./seed";

afterAll(() => sql.end());
const data = new PostgresPlannerData(sql);
const usage = { costUsd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, modelMs: 0 };

function scripted(responses: ChatResponse[]): ChatModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: "scripted",
    schemaStyle: "standard",
    prompts,
    async complete({ system, messages }) {
      prompts.push(system + "\n---\n" + JSON.stringify(messages[0]));
      return responses.shift() ?? { text: "done", toolCalls: [], usage };
    },
  };
}

describe("PostgresPlannerData", () => {
  it("pre-search finds a client by possessive name, with their jobs and an empty org elsewhere", async () => {
    const org = await seedOrg();
    const found = await data.find(org.orgId, "Henderson's heater is leaking again");
    expect(found.clients).toMatchObject([{ id: org.clientId, name: "Jeb Henderson" }]);
    expect(found.jobs).toMatchObject([{ id: org.jobId, status: "accepted", client: { name: "Jeb Henderson" } }]);

    const other = await seedOrg();
    const otherFound = await data.find(other.orgId, "Something about a pump");
    expect(otherFound.clients).toEqual([]);
  });

  it("find_job matches title words and respects org and status filters", async () => {
    const org = await seedOrg();
    expect(await data.findJobs(org.orgId, { query: "water heater", limit: 5 })).toMatchObject([{ id: org.jobId }]);
    expect(await data.findJobs(org.orgId, { query: "water heater", statuses: ["lead"], limit: 5 })).toEqual([]);
    const other = await seedOrg();
    const leaked = (await data.findJobs(other.orgId, { query: "water heater", limit: 20 })) as { id: string }[];
    expect(leaked.map((j) => j.id)).not.toContain(org.jobId);
  });
});

describe("createTextCapture", () => {
  it("stores a pending ChangeSet that approves cleanly", async () => {
    const org = await seedOrg();
    const model = scripted([
      { text: null, toolCalls: [{ id: "c1", name: "add_note", arguments: JSON.stringify({ jobId: org.jobId, body: "Customer says it's leaking again" }) }], usage },
      { text: "Added a note.", toolCalls: [], usage },
    ]);
    const result = await createTextCapture(
      { sql, model, data, timezone: "America/Chicago", now: () => new Date("2026-10-05T17:00:00Z") },
      { userId: org.userId, orgId: org.orgId, text: "Henderson says the heater is leaking again" },
    );
    expect(result).toMatchObject({ summary: "Added a note.", issues: [] });
    expect(model.prompts[0]).toContain("Today is Monday, 2026-10-05");
    expect(model.prompts[0]).toContain("Jeb Henderson"); // pre-search result in the message

    const [changeSet] = await sql`select status, base_job_versions from change_sets where id = ${result.changeSetId}`;
    expect(changeSet!.status).toBe("pending");
    expect(Object.keys(changeSet!.baseJobVersions as object)).toEqual([org.jobId]);
    const [capture] = await sql`select status from captures where id = ${result.captureId}`;
    expect(capture!.status).toBe("ready_for_review");

    expect((await approveChangeSet(sql, { changeSetId: result.changeSetId!, userId: org.userId })).ok).toBe(true);
  });

  it("finishes without a ChangeSet when there is nothing to record", async () => {
    const org = await seedOrg();
    const result = await createTextCapture(
      { sql, model: scripted([{ text: "Nothing to record.", toolCalls: [], usage }]), data, timezone: "America/Chicago" },
      { userId: org.userId, orgId: org.orgId, text: "grab coffee filters" },
    );
    expect(result.changeSetId).toBeNull();
    const [capture] = await sql`select status from captures where id = ${result.captureId}`;
    expect(capture!.status).toBe("committed");
  });

  it("refuses a company the user doesn't belong to", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await expect(
      createTextCapture({ sql, model: scripted([]), data, timezone: "America/Chicago" }, { userId: a.userId, orgId: b.orgId, text: "hi" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("localDay", () => {
  it("formats the local date and offset", () => {
    expect(localDay(new Date("2026-10-05T12:00:00Z"), "America/Chicago")).toEqual({ today: "Monday, 2026-10-05", utcOffset: "-05:00" });
    expect(localDay(new Date("2026-10-05T03:00:00Z"), "America/Chicago").today).toBe("Sunday, 2026-10-04");
    expect(localDay(new Date("2026-01-05T12:00:00Z"), "UTC").utcOffset).toBe("+00:00");
  });
});
