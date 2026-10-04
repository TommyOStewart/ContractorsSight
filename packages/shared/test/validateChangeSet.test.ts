import { describe, expect, it } from "vitest";
import { resolveTempIds, validateChangeSet, type IssueCode, type ValidationResult } from "../src";
import { ORG, draft, ids, seedRepository, versions } from "./fixtures";

const NOW = new Date("2026-10-04T12:00:00Z");
const validate = (input: unknown) => validateChangeSet(input, { orgId: ORG, repository: seedRepository(), now: () => NOW });

function codes(result: ValidationResult): IssueCode[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function expectIssue(result: ValidationResult, code: IssueCode, opIndex: number | null, path?: (string | number)[]) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const match = result.issues.find(
    (i) => i.code === code && i.opIndex === opIndex && (!path || JSON.stringify(i.path) === JSON.stringify(path)),
  );
  expect(match, `expected ${code} on op ${opIndex} at ${JSON.stringify(path)}, got ${JSON.stringify(result.issues)}`).toBeDefined();
}

describe("validateChangeSet: valid change sets", () => {
  it("accepts new client + job with temp IDs, followed by edits to existing records", async () => {
    const result = await validate(
      draft([
        { tool: "create_client", args: { tempId: "$c1", name: "Jeb Henderson", phone: "555-0101" } },
        {
          tool: "create_job",
          args: { tempId: "$j1", clientId: "$c1", siteAddress: { line1: "12 Elm St" }, title: "Replace water heater", jobType: "Water Heater" },
        },
        { tool: "add_material", args: { tempId: "$m1", jobId: "$j1", description: "50gal gas water heater", quantity: 1, unitCostDollars: 899.99 } },
        {
          tool: "revise_quote",
          args: {
            jobId: "$j1",
            lineItems: [
              { kind: "labor", description: "Install", hours: 4, hourlyRateDollars: 125 },
              { kind: "material", description: "Water heater", quantity: 1, unitPriceDollars: 1100, materialId: "$m1" },
            ],
          },
        },
        { tool: "request_status_change", args: { jobId: "$j1", toStatus: "quoted" } },
        { tool: "add_note", args: { jobId: ids.acceptedJob, body: "Gate code 4411" } },
        { tool: "schedule_job", args: { jobId: ids.acceptedJob, start: "2026-10-06T08:00:00-05:00", end: "2026-10-06T12:00:00-05:00" } },
        { tool: "request_status_change", args: { jobId: ids.acceptedJob, toStatus: "in_progress" } },
        { tool: "update_material", args: { materialId: ids.material, changes: { status: "purchased", supplyHouseId: ids.supplyHouse } } },
        { tool: "flag_ambiguity", args: { question: "Which Jeb?", about: "client", candidates: [{ label: "Jeb H.", clientId: ids.client }] } },
      ]),
    );

    expect(result.ok, JSON.stringify(!result.ok && result.issues)).toBe(true);
    if (!result.ok) return;
    expect(result.changeSet.operations).toHaveLength(10);
    // Parsed args have defaults applied and strings normalised.
    const createJob = result.changeSet.operations[1]!;
    expect(createJob.tool === "create_job" && createJob.args.jobType).toBe("water heater");
    const addMaterial = result.changeSet.operations[2]!;
    expect(addMaterial.tool === "add_material" && addMaterial.args.status).toBe("needed");
  });

  it("allows notes on closed jobs", async () => {
    const result = await validate(draft([{ tool: "add_note", args: { jobId: ids.paidJob, body: "Customer happy" } }]));
    expect(result.ok).toBe(true);
  });
});

describe("validateChangeSet: schema", () => {
  it("rejects unknown tools and lookups", async () => {
    const result = await validate(
      draft([
        { tool: "delete_everything", args: {} },
        { tool: "find_client", args: { query: "Jeb" } },
      ]),
    );
    expect(codes(result)).toEqual(["UNKNOWN_TOOL", "NOT_STAGEABLE"]);
  });

  it("rejects unknown fields, so status can't be smuggled through update_job_fields", async () => {
    const result = await validate(draft([{ tool: "update_job_fields", args: { jobId: ids.leadJob, changes: { status: "paid" } } }]));
    expectIssue(result, "INVALID_ARGS", 0, ["changes"]);
  });

  it("rejects malformed IDs and missing required fields", async () => {
    const result = await validate(draft([{ tool: "add_material", args: { jobId: "Henderson job", quantity: -1 } }]));
    expectIssue(result, "INVALID_ARGS", 0, ["jobId"]);
    expectIssue(result, "INVALID_ARGS", 0, ["description"]);
    expectIssue(result, "INVALID_ARGS", 0, ["quantity"]);
  });

  it("rejects a malformed envelope", async () => {
    const result = await validate({ captureId: "nope", operations: [] });
    expect(codes(result).every((c) => c === "INVALID_CHANGESET")).toBe(true);
  });
});

describe("validateChangeSet: references", () => {
  it("rejects an ID that does not exist", async () => {
    const result = await validate(draft([{ tool: "add_note", args: { jobId: ids.missing, body: "hi" } }]));
    expectIssue(result, "UNKNOWN_ID", 0, ["jobId"]);
  });

  it("rejects an ID that belongs to another org", async () => {
    const result = await validate(
      draft([{ tool: "create_job", args: { clientId: ids.otherOrgClient, title: "Sneaky" } }]),
    );
    expectIssue(result, "CROSS_ORG_REFERENCE", 0, ["clientId"]);
  });

  it("does not reveal whether a cross-org record exists in the message", async () => {
    const unknown = await validate(draft([{ tool: "add_note", args: { jobId: ids.missing, body: "x" } }]));
    const crossOrg = await validate(draft([{ tool: "add_note", args: { jobId: ids.otherOrgJob, body: "x" } }]));
    const message = (r: ValidationResult, id: string) => (!r.ok ? r.issues[0]!.message.replace(id, "<id>") : "");
    expect(message(crossOrg, ids.otherOrgJob)).toBe(message(unknown, ids.missing));
  });

  it("rejects cross-org IDs nested inside arrays", async () => {
    const result = await validate(
      draft([
        {
          tool: "flag_ambiguity",
          args: { question: "Which one?", about: "client", candidates: [{ label: "A", clientId: ids.client }, { label: "B", clientId: ids.otherOrgClient }] },
        },
      ]),
    );
    expectIssue(result, "CROSS_ORG_REFERENCE", 0, ["candidates", 1, "clientId"]);
  });

  it("rejects a site that belongs to a different client", async () => {
    const result = await validate(draft([{ tool: "create_job", args: { clientId: ids.client, siteId: ids.otherSite, title: "Leak" } }]));
    expectIssue(result, "WRONG_PARENT", 0, ["siteId"]);
  });
});

describe("validateChangeSet: temp IDs", () => {
  it("rejects a temp ID referenced before the operation that creates it", async () => {
    const result = await validate(
      draft([
        { tool: "add_note", args: { jobId: "$j1", body: "Bring the long ladder" } },
        { tool: "create_job", args: { tempId: "$j1", clientId: ids.client, title: "Gutter drain" } },
      ]),
    );
    expectIssue(result, "TEMP_ID_USED_BEFORE_CREATION", 0, ["jobId"]);
  });

  it("rejects a temp ID that is never created", async () => {
    const result = await validate(draft([{ tool: "add_note", args: { jobId: "$j9", body: "?" } }]));
    expectIssue(result, "UNKNOWN_TEMP_ID", 0, ["jobId"]);
  });

  it("rejects a temp ID used as the wrong entity type", async () => {
    const result = await validate(
      draft([
        { tool: "create_client", args: { tempId: "$c1", name: "Jeb" } },
        { tool: "add_material", args: { jobId: "$c1", description: "coupling", quantity: 2 } },
      ]),
    );
    expectIssue(result, "TEMP_ID_TYPE_MISMATCH", 1, ["jobId"]);
  });

  it("rejects a temp ID declared twice", async () => {
    const result = await validate(
      draft([
        { tool: "create_client", args: { tempId: "$c1", name: "Jeb" } },
        { tool: "create_client", args: { tempId: "$c1", name: "Jeb Jr" } },
      ]),
    );
    expectIssue(result, "DUPLICATE_TEMP_ID", 1, ["tempId"]);
  });

  it("does not accept temp IDs where an existing record is required", async () => {
    const result = await validate(
      draft([
        { tool: "add_material", args: { tempId: "$m1", jobId: ids.acceptedJob, description: "valve", quantity: 1 } },
        { tool: "remove_material", args: { materialId: "$m1" } },
      ]),
    );
    expectIssue(result, "INVALID_ARGS", 1, ["materialId"]);
  });

  it("resolves temp IDs to real UUIDs consistently at commit", async () => {
    const result = await validate(
      draft([
        { tool: "create_client", args: { tempId: "$c1", name: "Jeb" } },
        { tool: "create_job", args: { tempId: "$j1", clientId: "$c1", title: "Leak" } },
        { tool: "add_note", args: { jobId: "$j1", body: "Under sink" } },
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    let n = 0;
    const resolved = resolveTempIds(result.changeSet, () => `00000000-0000-4000-8000-00000000000${++n}`);
    const [client, job, note] = resolved.operations;
    expect(resolved.tempIdMap).toEqual({ $c1: "00000000-0000-4000-8000-000000000001", $j1: "00000000-0000-4000-8000-000000000002" });
    expect(client!.tool === "create_client" && client!.args.tempId).toBe(resolved.tempIdMap.$c1);
    expect(job!.tool === "create_job" && job!.args.clientId).toBe(resolved.tempIdMap.$c1);
    expect(note!.tool === "add_note" && note!.args.jobId).toBe(resolved.tempIdMap.$j1);
    // The validated ChangeSet is not mutated.
    expect(result.changeSet.operations[2]!.args).toMatchObject({ jobId: "$j1" });
  });
});

describe("validateChangeSet: job state machine", () => {
  it("rejects an illegal status jump", async () => {
    const result = await validate(draft([{ tool: "request_status_change", args: { jobId: ids.leadJob, toStatus: "completed" } }]));
    expectIssue(result, "ILLEGAL_STATUS_TRANSITION", 0, ["toStatus"]);
  });

  it("checks each transition against the state left by earlier operations", async () => {
    const legal = await validate(
      draft([
        { tool: "schedule_job", args: { jobId: ids.acceptedJob, start: "2026-10-06T08:00:00Z" } },
        { tool: "request_status_change", args: { jobId: ids.acceptedJob, toStatus: "in_progress" } },
        { tool: "request_status_change", args: { jobId: ids.acceptedJob, toStatus: "completed" } },
      ]),
    );
    expect(legal.ok).toBe(true);

    const illegal = await validate(
      draft([
        { tool: "request_status_change", args: { jobId: ids.acceptedJob, toStatus: "cancelled" } },
        { tool: "schedule_job", args: { jobId: ids.acceptedJob, start: "2026-10-06T08:00:00Z" } },
      ]),
    );
    expectIssue(illegal, "JOB_CLOSED", 1);
  });

  it("does not let a new job skip straight past lead", async () => {
    const result = await validate(
      draft([
        { tool: "create_job", args: { tempId: "$j1", clientId: ids.client, title: "Leak" } },
        { tool: "request_status_change", args: { jobId: "$j1", toStatus: "accepted" } },
      ]),
    );
    expectIssue(result, "ILLEGAL_STATUS_TRANSITION", 1);
  });

  it("requires a quote before marking a job quoted", async () => {
    const result = await validate(draft([{ tool: "request_status_change", args: { jobId: ids.leadJob, toStatus: "quoted" } }]));
    expectIssue(result, "BUSINESS_RULE", 0, ["toStatus"]);
  });

  it("rejects scheduling a job that hasn't been accepted", async () => {
    const result = await validate(draft([{ tool: "schedule_job", args: { jobId: ids.leadJob, start: "2026-10-06T08:00:00Z" } }]));
    expectIssue(result, "ILLEGAL_STATUS_TRANSITION", 0);
  });
});

describe("validateChangeSet: business rules", () => {
  it("rejects edits to closed jobs", async () => {
    const result = await validate(draft([{ tool: "add_material", args: { jobId: ids.paidJob, description: "elbow", quantity: 1 } }]));
    expectIssue(result, "JOB_CLOSED", 0, ["jobId"]);
  });

  it("rejects a quote revision based on a superseded version", async () => {
    const result = await validate(
      draft([
        {
          tool: "revise_quote",
          args: { jobId: ids.acceptedJob, basedOnQuoteId: ids.oldQuote, lineItems: [{ kind: "labor", description: "Install", hours: 2, hourlyRateDollars: 100 }] },
        },
      ]),
    );
    expectIssue(result, "STALE_QUOTE", 0, ["basedOnQuoteId"]);
  });

  it("rejects using a material after removing it", async () => {
    const result = await validate(
      draft([
        { tool: "remove_material", args: { materialId: ids.material } },
        { tool: "update_material", args: { materialId: ids.material, changes: { quantity: 3 } } },
      ]),
    );
    expectIssue(result, "BUSINESS_RULE", 1, ["materialId"]);
  });

  it("rejects an empty update and a schedule that ends before it starts", async () => {
    const result = await validate(
      draft([
        { tool: "update_job_fields", args: { jobId: ids.leadJob, changes: {} } },
        { tool: "schedule_job", args: { jobId: ids.acceptedJob, start: "2026-10-06T12:00:00Z", end: "2026-10-06T08:00:00Z" } },
      ]),
    );
    expectIssue(result, "BUSINESS_RULE", 0, ["changes"]);
    expectIssue(result, "BUSINESS_RULE", 1, ["end"]);
  });

  it("rejects a receipt dated in the future", async () => {
    const result = await validate(
      draft([{ tool: "record_purchase", args: { jobId: ids.acceptedJob, purchasedOn: "2026-12-01", lines: [{ description: "PEX 1/2in", quantity: 100, unit: "ft" }] } }]),
    );
    expectIssue(result, "BUSINESS_RULE", 0, ["purchasedOn"]);
  });
});

describe("validateChangeSet: optimistic concurrency", () => {
  it("rejects a ChangeSet built from a stale job version", async () => {
    const result = await validate(
      draft([{ tool: "add_note", args: { jobId: ids.acceptedJob, body: "x" } }], { [ids.acceptedJob]: versions.acceptedJob - 1 }),
    );
    expectIssue(result, "STALE_VERSION", 0, ["jobId"]);
  });

  it("checks the parent job's version when an operation targets a child record", async () => {
    const result = await validate(
      draft([{ tool: "update_material", args: { materialId: ids.material, changes: { quantity: 2 } } }], { [ids.acceptedJob]: 1 }),
    );
    expectIssue(result, "STALE_VERSION", 0, ["materialId"]);
  });

  it("rejects a ChangeSet that doesn't record the base version of a job it touches", async () => {
    const result = await validate(draft([{ tool: "add_note", args: { jobId: ids.leadJob, body: "x" } }], {}));
    expectIssue(result, "MISSING_BASE_VERSION", 0, ["jobId"]);
  });

  it("ignores job versions for signals, which write nothing", async () => {
    const result = await validate(
      draft([{ tool: "flag_ambiguity", args: { question: "Which job?", about: "job", candidates: [{ label: "Lead", jobId: ids.leadJob }] } }], {}),
    );
    expect(result.ok).toBe(true);
  });
});
