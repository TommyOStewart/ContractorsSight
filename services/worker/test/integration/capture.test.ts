import { afterAll, describe, expect, it } from "vitest";
import { answerQuestion, correctCapture, createAudioCapture, createImageCapture, createTextCapture, localDay } from "../../src/capture/captureService";
import { updateOperation } from "../../src/commit/changeSetService";
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

describe("answering a question", () => {
  it("re-plans the capture with the answer and replaces the proposal", async () => {
    const org = await seedOrg();
    const model = scripted([
      { text: null, toolCalls: [{ id: "q1", name: "flag_ambiguity", arguments: JSON.stringify({ question: "Which job?", about: "job" }) }], usage },
      { text: "Asked which job.", toolCalls: [], usage },
      { text: null, toolCalls: [{ id: "n1", name: "add_note", arguments: JSON.stringify({ jobId: org.jobId, body: "Leaking again" }) }], usage },
      { text: "Added a note.", toolCalls: [], usage },
    ]);
    const deps = { sql, model, data, timezone: "America/New_York" };
    const first = await createTextCapture(deps, { userId: org.userId, orgId: org.orgId, text: "It's leaking again" });

    const second = await answerQuestion(deps, { userId: org.userId, changeSetId: first.changeSetId!, question: "Which job?", answer: "Leaky water heater (Jeb Henderson)" });
    expect(second.captureId).toBe(first.captureId);
    expect(second.changeSetId).not.toBe(first.changeSetId);
    expect(model.prompts[2]).toContain("Leaky water heater (Jeb Henderson)");

    const rows = await sql`select id, status from change_sets where capture_id = ${first.captureId} order by created_at`;
    expect(rows.map((r) => r.status)).toEqual(["rejected", "pending"]);
    const [answer] = await sql`select question, answer from capture_answers where capture_id = ${first.captureId}`;
    expect(answer).toMatchObject({ question: "Which job?", answer: "Leaky water heater (Jeb Henderson)" });
  });
});

describe("createAudioCapture", () => {
  const transcriber = { id: "fake-stt", transcribe: async () => ({ text: "Henderson says the heater is leaking again", costUsd: 0 }) };

  it("transcribes the recording, keeps it as an attachment, and plans from the transcript", async () => {
    const org = await seedOrg();
    const downloads: string[] = [];
    const model = scripted([
      { text: null, toolCalls: [{ id: "n1", name: "add_note", arguments: JSON.stringify({ jobId: org.jobId, body: "Leaking again" }) }], usage },
      { text: "Added a note.", toolCalls: [], usage },
    ]);
    const path = `${org.orgId}/${crypto.randomUUID()}.m4a`;
    const result = await createAudioCapture(
      {
        sql,
        model,
        data,
        timezone: "America/New_York",
        transcriber,
        downloadFile: async (_token, p) => {
          downloads.push(p);
          return new Uint8Array([1, 2, 3]);
        },
      },
      { userId: org.userId, orgId: org.orgId, accessToken: "user-token", audioPath: path },
    );
    expect(downloads).toEqual([path]);
    expect(result.transcript).toBe("Henderson says the heater is leaking again");
    expect(result.changeSetId).toBeTruthy();
    expect(model.prompts[0]).toContain("Voice note transcript");

    const [capture] = await sql`select type, raw_text, status from captures where id = ${result.captureId}`;
    expect(capture).toMatchObject({ type: "audio", rawText: "Henderson says the heater is leaking again", status: "ready_for_review" });
    const [attachment] = await sql`select storage_path, mime_type from attachments where capture_id = ${result.captureId}`;
    expect(attachment).toMatchObject({ storagePath: path, mimeType: "audio/mp4" });
  });

  it("refuses a recording path outside the user's company", async () => {
    const org = await seedOrg();
    const other = await seedOrg();
    await expect(
      createAudioCapture(
        { sql, model: scripted([]), data, timezone: "America/New_York", transcriber, downloadFile: async () => new Uint8Array() },
        { userId: org.userId, orgId: org.orgId, accessToken: "t", audioPath: `${other.orgId}/x.m4a` },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("createImageCapture", () => {
  it("reads every page, keeps them as attachments, and plans from the text", async () => {
    const org = await seedOrg();
    const reads: number[] = [];
    const imageReader = {
      id: "fake-vision",
      read: async (images: { bytes: Uint8Array }[]) => {
        reads.push(images.length);
        return { text: "FERGUSON #1234\nSB 1/2 COUPLING 4 @ 6.89\nPO: LEAKY WATER HEATER", costUsd: 0 };
      },
    };
    const model = scripted([
      { text: null, toolCalls: [{ id: "n1", name: "add_note", arguments: JSON.stringify({ jobId: org.jobId, body: "Receipt from Ferguson" }) }], usage },
      { text: "Noted the receipt.", toolCalls: [], usage },
    ]);
    const pages = [`${org.orgId}/${crypto.randomUUID()}.jpg`, `${org.orgId}/${crypto.randomUUID()}.jpg`];
    const result = await createImageCapture(
      { sql, model, data, timezone: "America/New_York", imageReader, downloadFile: async () => new Uint8Array([9]) },
      { userId: org.userId, orgId: org.orgId, accessToken: "t", imagePaths: pages },
    );
    expect(reads).toEqual([2]);
    expect(result.changeSetId).toBeTruthy();
    expect(model.prompts[0]).toContain("Text read from a photo");
    const [capture] = await sql`select type, raw_text from captures where id = ${result.captureId}`;
    expect(capture).toMatchObject({ type: "image" });
    expect(capture!.rawText).toContain("FERGUSON");
    const attachments = await sql`select storage_path from attachments where capture_id = ${result.captureId} order by storage_path`;
    expect(attachments.map((a) => a.storagePath)).toEqual([...pages].sort());
  });

  it("finishes without a proposal when the photo has no readable text", async () => {
    const org = await seedOrg();
    const result = await createImageCapture(
      {
        sql,
        model: scripted([]),
        data,
        timezone: "America/New_York",
        imageReader: { id: "fake", read: async () => ({ text: "", costUsd: 0 }) },
        downloadFile: async () => new Uint8Array([1]),
      },
      { userId: org.userId, orgId: org.orgId, accessToken: "t", imagePaths: [`${org.orgId}/blank.jpg`] },
    );
    expect(result.changeSetId).toBeNull();
    expect(result.summary).toMatch(/couldn't read/);
  });
});

describe("fixing a proposal", () => {
  const addMaterial = (jobId: string, quantity: number) => ({
    text: null,
    toolCalls: [{ id: `m${quantity}`, name: "add_material", arguments: JSON.stringify({ jobId, description: "SharkBite coupling", quantity }) }],
    usage,
  });

  it("re-plans with the previous proposal and the correction", async () => {
    const org = await seedOrg();
    const model = scripted([addMaterial(org.jobId, 2), { text: "Added 2.", toolCalls: [], usage }, addMaterial(org.jobId, 3), { text: "Added 3.", toolCalls: [], usage }]);
    const deps = { sql, model, data, timezone: "America/New_York" };
    const first = await createTextCapture(deps, { userId: org.userId, orgId: org.orgId, text: "Need SB couplings for the heater job" });
    const fixed = await correctCapture(deps, { userId: org.userId, changeSetId: first.changeSetId!, text: "make it three, not two" });

    expect(model.prompts[2]).toContain("Your previous proposal");
    // The prompt is JSON-encoded once more by the test helper, so quotes appear escaped.
    expect(model.prompts[2]).toMatch(/quantity\\*":2/);
    expect(model.prompts[2]).toContain("make it three, not two");
    const [cs] = await sql`select operations from change_sets where id = ${fixed.changeSetId}`;
    expect((cs!.operations as { args: { quantity: number } }[])[0]!.args.quantity).toBe(3);
  });

  it("saves a hand edit, refuses an invalid one, and reports rule problems", async () => {
    const org = await seedOrg();
    const deps = { sql, model: scripted([addMaterial(org.jobId, 2), { text: "Added.", toolCalls: [], usage }]), data, timezone: "America/New_York" };
    const { changeSetId } = await createTextCapture(deps, { userId: org.userId, orgId: org.orgId, text: "couplings" });

    const ok = await updateOperation(sql, { changeSetId: changeSetId!, userId: org.userId, index: 0, args: { jobId: org.jobId, description: "1/2in SharkBite coupling", quantity: 5 } });
    expect(ok.issues).toEqual([]);
    const [after] = await sql`select operations from change_sets where id = ${changeSetId}`;
    expect((after!.operations as { args: { quantity: number; description: string } }[])[0]!.args).toMatchObject({ quantity: 5, description: "1/2in SharkBite coupling" });

    await expect(
      updateOperation(sql, { changeSetId: changeSetId!, userId: org.userId, index: 0, args: { jobId: org.jobId, description: "x", quantity: -1 } }),
    ).rejects.toMatchObject({ status: 409 });

    const otherOrg = await seedOrg();
    const flagged = await updateOperation(sql, { changeSetId: changeSetId!, userId: org.userId, index: 0, args: { jobId: otherOrg.jobId, description: "x", quantity: 1 } });
    expect(flagged.issues.map((i) => i.code)).toEqual(["CROSS_ORG_REFERENCE"]);
  });

  it("ties a voice note to the job it was recorded from", async () => {
    const org = await seedOrg();
    const model = scripted([{ text: "Nothing.", toolCalls: [], usage }]);
    await createAudioCapture(
      { sql, model, data, timezone: "America/New_York", transcriber: { id: "t", transcribe: async () => ({ text: "it's leaking", costUsd: 0 }) }, downloadFile: async () => new Uint8Array([1]) },
      { userId: org.userId, orgId: org.orgId, accessToken: "t", audioPath: `${org.orgId}/x.m4a`, targetJobId: org.jobId },
    );
    expect(model.prompts[0]).toContain(`(ID ${org.jobId})`);
  });
});
