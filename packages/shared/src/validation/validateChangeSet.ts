import { changeSetDraftSchema, type StagedOperation, type ValidatedChangeSet } from "../changeset/types";
import { collectIdFields, isTempId, type IdField, type IdPath } from "../domain/refs";
import { getTool } from "../tools/registry";
import { BUSINESS_RULES, Projection, type RuleContext } from "./businessRules";
import { issue, type ValidationIssue } from "./issues";
import type { EntityKey, EntitySnapshot, ValidationRepository } from "./repository";

export interface ValidationContext {
  /** The org of the authenticated capture. Every referenced record must belong to it. */
  orgId: string;
  repository: ValidationRepository;
  /** Clock for date rules; injectable for tests. */
  now?: () => Date;
}

export type ValidationResult =
  | { ok: true; changeSet: ValidatedChangeSet }
  | { ok: false; issues: ValidationIssue[] };

interface ParsedOperation {
  index: number;
  op: StagedOperation;
  idFields: IdField[];
}

const keyOf = (k: EntityKey) => `${k.entity}:${k.id}`;
const fail = (issues: ValidationIssue[]): ValidationResult => ({ ok: false, issues });

/**
 * Checks a proposed ChangeSet in four phases, stopping after the first phase that finds problems
 * (later phases assume earlier ones passed):
 *
 * 1. Schema:       envelope shape; each operation names a stageable tool and its args parse.
 * 2. References:   temp IDs are declared once and before use; real IDs exist and belong to the org.
 * 3. Concurrency:  every existing job touched is still at the version the ChangeSet was built from.
 * 4. Business:     state machine and per-tool rules, applied in order against projected state.
 *
 * Passing validation does not commit anything. The commit step must re-check job versions
 * atomically, because time passes between validation and approval.
 */
export async function validateChangeSet(input: unknown, ctx: ValidationContext): Promise<ValidationResult> {
  const envelope = changeSetDraftSchema.safeParse(input);
  if (!envelope.success) {
    return fail(envelope.error.issues.map((i) => issue("INVALID_CHANGESET", i.message, null, toPath(i.path))));
  }
  const draft = envelope.data;

  const schema = checkSchemas(draft.operations);
  if (schema.issues.length) return fail(schema.issues);
  const ops = schema.parsed;

  const tempIdIssues = checkTempIds(ops);
  const refs = await checkReferences(ops, ctx);
  if (tempIdIssues.length || refs.issues.length) return fail([...tempIdIssues, ...refs.issues]);

  const concurrencyIssues = checkJobVersions(ops, refs.snapshots, draft.baseJobVersions);
  if (concurrencyIssues.length) return fail(concurrencyIssues);

  const ruleIssues = checkBusinessRules(ops, refs.snapshots, ctx.now?.() ?? new Date());
  if (ruleIssues.length) return fail(ruleIssues);

  return {
    ok: true,
    changeSet: {
      captureId: draft.captureId,
      baseJobVersions: draft.baseJobVersions,
      operations: ops.map((p) => p.op),
    },
  };
}

function toPath(path: readonly PropertyKey[]): IdPath {
  return path.filter((p): p is string | number => typeof p !== "symbol");
}

// ---------------------------------------------------------------------------
// Phase 1: schema
// ---------------------------------------------------------------------------

function checkSchemas(operations: { tool: string; args: unknown }[]) {
  const issues: ValidationIssue[] = [];
  const parsed: ParsedOperation[] = [];

  operations.forEach(({ tool: name, args }, index) => {
    const tool = getTool(name);
    if (!tool) {
      issues.push(issue("UNKNOWN_TOOL", `Unknown tool "${name}".`, index));
      return;
    }
    if (tool.kind === "lookup") {
      issues.push(issue("NOT_STAGEABLE", `"${name}" is a lookup and can't be part of a ChangeSet.`, index));
      return;
    }
    const result = tool.input.safeParse(args);
    if (!result.success) {
      for (const i of result.error.issues) issues.push(issue("INVALID_ARGS", i.message, index, toPath(i.path)));
      return;
    }
    parsed.push({
      index,
      op: { tool: tool.name, args: result.data } as StagedOperation,
      idFields: collectIdFields(tool.input, result.data),
    });
  });

  return { issues, parsed };
}

// ---------------------------------------------------------------------------
// Phase 2: temp IDs and references
// ---------------------------------------------------------------------------

function checkTempIds(ops: ParsedOperation[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const declared = new Map<string, { entity: string; index: number }>();

  for (const { index, idFields } of ops) {
    for (const f of idFields) {
      if (f.meta.role !== "decl") continue;
      const existing = declared.get(f.value);
      if (existing) {
        issues.push(issue("DUPLICATE_TEMP_ID", `Temp ID ${f.value} is already used by operation ${existing.index}.`, index, f.path));
      } else {
        declared.set(f.value, { entity: f.meta.entity, index });
      }
    }
  }

  for (const { index, idFields } of ops) {
    for (const f of idFields) {
      if (f.meta.role !== "ref" || !isTempId(f.value)) continue;
      const decl = declared.get(f.value);
      if (!decl) {
        issues.push(issue("UNKNOWN_TEMP_ID", `Temp ID ${f.value} is never created in this ChangeSet.`, index, f.path));
      } else if (decl.index >= index) {
        issues.push(
          issue("TEMP_ID_USED_BEFORE_CREATION", `Temp ID ${f.value} is used before operation ${decl.index} creates it.`, index, f.path),
        );
      } else if (decl.entity !== f.meta.entity) {
        issues.push(
          issue("TEMP_ID_TYPE_MISMATCH", `Temp ID ${f.value} is a ${decl.entity}, but a ${f.meta.entity} is expected here.`, index, f.path),
        );
      }
    }
  }

  return issues;
}

async function checkReferences(ops: ParsedOperation[], ctx: ValidationContext) {
  const issues: ValidationIssue[] = [];
  const snapshots = new Map<string, EntitySnapshot>();

  const keys = new Map<string, EntityKey>();
  for (const { idFields } of ops) {
    for (const f of idFields) {
      if (f.meta.role === "ref" && !isTempId(f.value)) {
        const key = { entity: f.meta.entity, id: f.value };
        keys.set(keyOf(key), key);
      }
    }
  }
  await load(ctx.repository, [...keys.values()], snapshots);

  // Child records (materials, quotes) imply a job; load those jobs too, for version and status checks.
  const parentJobs = [...snapshots.values()]
    .filter((s) => s.entity === "material" || s.entity === "quote")
    .map((s) => ({ entity: "job" as const, id: s.jobId }))
    .filter((k) => !snapshots.has(keyOf(k)));
  await load(ctx.repository, parentJobs, snapshots);

  for (const { index, idFields } of ops) {
    for (const f of idFields) {
      if (f.meta.role !== "ref" || isTempId(f.value)) continue;
      const snapshot = snapshots.get(keyOf({ entity: f.meta.entity, id: f.value }));
      if (!snapshot) {
        issues.push(issue("UNKNOWN_ID", `No ${f.meta.entity} with ID ${f.value}.`, index, f.path));
      } else if (snapshot.orgId !== ctx.orgId) {
        // Same wording as UNKNOWN_ID for anything shown to users or the LLM; the code is for logs.
        issues.push(issue("CROSS_ORG_REFERENCE", `No ${f.meta.entity} with ID ${f.value}.`, index, f.path));
      }
    }
  }

  return { issues, snapshots };
}

async function load(repository: ValidationRepository, keys: EntityKey[], into: Map<string, EntitySnapshot>) {
  if (!keys.length) return;
  for (const snapshot of await repository.getEntities(keys)) into.set(keyOf(snapshot), snapshot);
}

// ---------------------------------------------------------------------------
// Phase 3: optimistic concurrency
// ---------------------------------------------------------------------------

function checkJobVersions(
  ops: ParsedOperation[],
  snapshots: Map<string, EntitySnapshot>,
  baseJobVersions: Record<string, number>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const checked = new Set<string>();

  for (const { index, op, idFields } of ops) {
    if (getTool(op.tool)?.kind !== "mutation") continue; // signals write nothing
    for (const f of idFields) {
      if (f.meta.role !== "ref" || isTempId(f.value)) continue;
      const snapshot = snapshots.get(keyOf({ entity: f.meta.entity, id: f.value }));
      const jobId =
        snapshot?.entity === "job" ? snapshot.id
        : snapshot?.entity === "material" || snapshot?.entity === "quote" ? snapshot.jobId
        : undefined;
      if (!jobId || checked.has(jobId)) continue;
      checked.add(jobId);

      const job = snapshots.get(keyOf({ entity: "job", id: jobId }));
      if (job?.entity !== "job") continue;
      const base = baseJobVersions[jobId];
      if (base === undefined) {
        issues.push(issue("MISSING_BASE_VERSION", `ChangeSet doesn't record which version of job ${jobId} it was built from.`, index, f.path));
      } else if (base !== job.version) {
        issues.push(
          issue("STALE_VERSION", `Job ${jobId} changed since this ChangeSet was built (version ${base}, now ${job.version}).`, index, f.path),
        );
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Phase 4: business rules
// ---------------------------------------------------------------------------

function checkBusinessRules(ops: ParsedOperation[], snapshots: Map<string, EntitySnapshot>, now: Date): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const projection = new Projection(snapshots.values());

  for (const { index, op } of ops) {
    const ctx: RuleContext = {
      projection,
      now,
      report: (code, message, path = []) => issues.push(issue(code, message, index, path)),
    };
    (BUSINESS_RULES[op.tool] as (args: unknown, ctx: RuleContext) => void)(op.args, ctx);
  }

  return issues;
}
