import { computeBaseJobVersions, resolveTempIds, validateChangeSet, type ValidationIssue } from "@contractorsight/shared";
import { PostgresValidationRepository } from "../db/PostgresValidationRepository";
import type { Sql } from "../db/sql";
import { applyOperations } from "./applyOperations";
import { ChangeSetError } from "./changeSetService";

/**
 * Tools the app may call directly when someone edits a record by hand. Captures can use every
 * tool; hand edits stick to plain record changes (signals like flag_ambiguity make no sense here).
 */
export const MANUAL_TOOLS: ReadonlySet<string> = new Set([
  "create_client",
  "create_job",
  "add_material",
  "add_note",
  "update_job_fields",
  "update_client",
  "update_site",
  "update_material",
  "remove_material",
  "request_status_change",
  "schedule_job",
  "record_payment",
  "record_expense",
]);

export type ManualEditResult = { ok: true; tempIdMap: Record<string, string> } | { ok: false; issues: ValidationIssue[] };

/**
 * Applies a hand edit from the app: no capture, no LLM, no review step, but the same validation,
 * appliers and audit trail (source `manual`) as an approved ChangeSet, in one transaction.
 *
 * `baseJobVersions` should hold the version of each job as the screen showed it, so an edit made
 * on a stale screen is refused instead of overwriting someone else's change. Jobs the app didn't
 * send a version for are checked against their current version.
 */
export async function applyManualEdit(
  sql: Sql,
  input: { userId: string; orgId: string; operations: { tool: string; args: unknown }[]; baseJobVersions?: Record<string, number> },
): Promise<ManualEditResult> {
  const notAllowed = input.operations.find((op) => !MANUAL_TOOLS.has(op.tool));
  if (notAllowed) throw new ChangeSetError(409, `${notAllowed.tool} can't be used for a hand edit.`);

  return sql.begin(async (tx) => {
    const [member] = await tx`select 1 from org_members where org_id = ${input.orgId} and user_id = ${input.userId}`;
    if (!member) throw new ChangeSetError(404, "Company not found.");

    const repository = new PostgresValidationRepository(tx, { lockJobs: true });
    const current = await computeBaseJobVersions(input.operations, repository);
    const validation = await validateChangeSet(
      { captureId: null, baseJobVersions: { ...current, ...input.baseJobVersions }, operations: input.operations },
      { orgId: input.orgId, repository },
    );
    if (!validation.ok) return { ok: false, issues: validation.issues };

    const resolved = resolveTempIds(validation.changeSet);
    await applyOperations(resolved.operations, {
      tx,
      orgId: input.orgId,
      actorUserId: input.userId,
      source: "manual",
      changeSetId: null,
      captureId: null,
    });
    return { ok: true, tempIdMap: resolved.tempIdMap };
  });
}
