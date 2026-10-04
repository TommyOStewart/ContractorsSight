import { describe, expect, it } from "vitest";
import {
  JOB_STATUSES,
  JOB_STATUS_TRANSITIONS,
  TOOLS,
  canTransition,
  dollarsToCents,
  toLlmToolSchemas,
} from "../src";

describe("tool definitions", () => {
  it("covers every tool in the spec, with unique names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(
      [
        "find_client",
        "find_job",
        "create_client",
        "create_job",
        "add_material",
        "add_note",
        "update_job_fields",
        "revise_quote",
        "update_material",
        "remove_material",
        "request_status_change",
        "schedule_job",
        "flag_ambiguity",
        "draft_supply_order",
        "record_purchase",
        "create_invoice",
        "record_payment",
        "record_expense",
      ].sort(),
    );
  });

  it("exports a strict JSON Schema object for every tool", () => {
    for (const tool of toLlmToolSchemas()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.input_schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("describes ID fields to the LLM with a pattern that admits temp IDs only where allowed", () => {
    const byName = Object.fromEntries(toLlmToolSchemas().map((t) => [t.name, t.input_schema as any]));
    const createJobClient = byName.create_job.properties.clientId;
    expect(createJobClient.type).toBe("string");
    expect(new RegExp(createJobClient.pattern).test("$c1")).toBe(true);
    const removeMaterialId = byName.remove_material.properties.materialId;
    expect(new RegExp(removeMaterialId.pattern).test("$m1")).toBe(false);
  });

  it("treats defaulted fields as optional for the LLM", () => {
    const addMaterial = toLlmToolSchemas().find((t) => t.name === "add_material")!.input_schema as any;
    expect(addMaterial.required).not.toContain("status");
  });
});

describe("job state machine", () => {
  it("allows the happy path in order", () => {
    const path = ["lead", "quoted", "accepted", "scheduled", "in_progress", "completed", "invoiced", "paid"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it("forbids skipping steps, going backwards, and leaving terminal states", () => {
    expect(canTransition("lead", "accepted")).toBe(false);
    expect(canTransition("scheduled", "accepted")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
    for (const terminal of ["paid", "declined", "cancelled"] as const) {
      expect(JOB_STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("never allows a self-transition", () => {
    for (const s of JOB_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe("money", () => {
  it("converts dollars to integer cents without float drift", () => {
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(899.99)).toBe(89999);
    expect(dollarsToCents(19.995)).toBe(2000);
  });
});
