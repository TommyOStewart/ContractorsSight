import { describe, expect, it } from "vitest";
import { buildCaptureMessage, buildSystemPrompt } from "../../src/planner/prompt";
import { runPlanner } from "../../src/planner/runPlanner";
import type { ChatModel, ChatResponse, ToolCall } from "../../src/planner/types";
import { evalLookups, evalRepository, ids, ORG_ID, promptContext } from "../../evals/world";

const usage = { costUsd: 0.001, inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 0, modelMs: 0 };
let n = 0;
const call = (name: string, args: unknown): ToolCall => ({ id: `call_${++n}`, name, arguments: JSON.stringify(args) });

/** Replays a fixed sequence of responses and records what it was sent. */
function scripted(responses: ChatResponse[]): ChatModel & { seen: string[] } {
  const seen: string[] = [];
  return {
    id: "scripted",
    schemaStyle: "standard",
    seen,
    async complete({ messages }) {
      seen.push(JSON.stringify(messages.at(-1)));
      const next = responses.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
}

const base = {
  lookups: evalLookups,
  orgId: ORG_ID,
  captureId: "00000000-0000-4000-8000-0000000000cc",
  system: buildSystemPrompt(promptContext),
  captureMessage: buildCaptureMessage({ text: "Henderson accepted the WH quote", captureType: "audio" as const }),
};

describe("runPlanner", () => {
  it("runs lookups, stages changes, and records base job versions", async () => {
    const model = scripted([
      { text: null, toolCalls: [call("find_job", { query: "Henderson water heater" })], usage },
      { text: null, toolCalls: [call("request_status_change", { jobId: ids.hendersonWaterHeater, toStatus: "accepted" })], usage },
      { text: "Marked the Henderson water heater job accepted.", toolCalls: [], usage },
    ]);
    const result = await runPlanner({ ...base, model, repository: evalRepository() });

    expect(model.seen[1]).toContain(ids.hendersonWaterHeater); // lookup result went back to the model
    expect(result.draft.operations).toEqual([{ tool: "request_status_change", args: { jobId: ids.hendersonWaterHeater, toStatus: "accepted" } }]);
    expect(result.draft.baseJobVersions).toEqual({ [ids.hendersonWaterHeater]: 4 });
    expect(result).toMatchObject({ issues: [], validFirstTry: true, repairsUsed: 0, turns: 3 });
    expect(result.usage.costUsd).toBeCloseTo(0.003);
  });

  it("rejects invalid args on the spot without staging them", async () => {
    const model = scripted([
      { text: null, toolCalls: [call("add_material", { jobId: "Maria's job", quantity: 2 })], usage },
      { text: "done", toolCalls: [], usage },
    ]);
    const result = await runPlanner({ ...base, model, repository: evalRepository() });
    expect(model.seen[1]).toContain("Invalid arguments");
    expect(result.draft.operations).toEqual([]);
  });

  it("feeds validation issues back once and keeps the repaired set", async () => {
    const model = scripted([
      // lead → completed is illegal
      { text: null, toolCalls: [call("request_status_change", { jobId: ids.waltersDrain, toStatus: "completed" })], usage },
      { text: "done", toolCalls: [], usage },
      { text: null, toolCalls: [call("flag_ambiguity", { question: "Walters job hasn't been quoted; what happened?", about: "job" })], usage },
      { text: "Flagged instead.", toolCalls: [], usage },
    ]);
    const result = await runPlanner({ ...base, model, repository: evalRepository() });
    expect(model.seen[2]).toContain("ILLEGAL_STATUS_TRANSITION");
    expect(result).toMatchObject({ issues: [], validFirstTry: false, repairsUsed: 1 });
    expect(result.draft.operations.map((o) => o.tool)).toEqual(["flag_ambiguity"]);
  });

  it("gives up after the repair budget and returns the remaining issues", async () => {
    const bad = { text: null, toolCalls: [call("request_status_change", { jobId: ids.waltersDrain, toStatus: "paid" })], usage };
    const model = scripted([bad, { text: "done", toolCalls: [], usage }, { ...bad, toolCalls: [call("request_status_change", { jobId: ids.waltersDrain, toStatus: "paid" })] }, { text: "done", toolCalls: [], usage }]);
    const result = await runPlanner({ ...base, model, repository: evalRepository() });
    expect(result.repairsUsed).toBe(1);
    expect(result.issues.map((i) => i.code)).toEqual(["ILLEGAL_STATUS_TRANSITION"]);
  });
});

describe("schema styles", () => {
  it("makes optional fields required-but-nullable for OpenAI, and strips nulls back out", async () => {
    const { adaptSchema, stripNulls } = await import("../../src/planner/schemaStyle");
    const { toLlmToolSchemas } = await import("@contractorsight/shared");
    const findJob = toLlmToolSchemas().find((t) => t.name === "find_job")!.input_schema as any;
    const adapted = adaptSchema(findJob, "nullable-optionals") as any;
    expect(adapted.required).toEqual(Object.keys(findJob.properties));
    expect(adapted.properties.clientId.anyOf).toContainEqual({ type: "null" });
    expect(adapted.properties.limit.anyOf[0]).not.toHaveProperty("default");
    expect(stripNulls({ query: "x", clientId: null, nested: [{ a: null, b: 1 }] })).toEqual({ query: "x", nested: [{ b: 1 }] });
  });

  it("treats null args as omitted when staging", async () => {
    const model = scripted([
      { text: null, toolCalls: [call("add_note", { jobId: ids.kimSump, clientId: null, body: "Gate code 4471" })], usage },
      { text: "done", toolCalls: [], usage },
    ]);
    const result = await runPlanner({ ...base, model, repository: evalRepository() });
    expect(result.draft.operations).toEqual([{ tool: "add_note", args: { jobId: ids.kimSump, body: "Gate code 4471" } }]);
    expect(result.issues).toEqual([]);
  });
});

describe("eval lookups", () => {
  it("doesn't match on shared phone prefixes or street suffixes", async () => {
    expect(await evalLookups.findClients(ORG_ID, { query: "555-0142", limit: 5 })).toEqual([]);
    expect(await evalLookups.findClients(ORG_ID, { query: "31 Spruce St", limit: 5 })).toEqual([]);
    expect(await evalLookups.findClients(ORG_ID, { query: "555-0101", limit: 5 })).toMatchObject([{ id: ids.jebHenderson }]);
    expect(await evalLookups.findClients(ORG_ID, { query: "Jeb", limit: 5 })).toHaveLength(2);
  });
});

describe("pre-search", () => {
  it("finds clients by possessive names and includes all their jobs", async () => {
    const { evalCandidates } = await import("../../evals/world");
    const found = await evalCandidates.find(ORG_ID, "Add 2 SB couplings to Maria's repipe");
    expect((found.clients as { id: string }[]).map((c) => c.id)).toEqual([ids.maria]);
    expect((found.jobs as { id: string }[]).map((j) => j.id).sort()).toEqual([ids.mariaRepipe, ids.mariaRentalToilet].sort());
  });

  it("surfaces both Jebs for an ambiguous first name", async () => {
    const { evalCandidates } = await import("../../evals/world");
    const found = await evalCandidates.find(ORG_ID, "Jeb wants us to look at a leak");
    expect(found.clients).toHaveLength(2);
  });

  it("puts candidates in the capture message, and says so when there are none", () => {
    const withRecords = buildCaptureMessage({ text: "x", captureType: "text", candidates: { clients: [{ id: "c" }], jobs: [] } });
    expect(withRecords).toContain("<records>");
    const empty = buildCaptureMessage({ text: "x", captureType: "text", candidates: { clients: [], jobs: [] } });
    expect(empty).toContain("found no existing clients or jobs");
    expect(buildCaptureMessage({ text: "x", captureType: "text" })).not.toContain("records");
  });
});
