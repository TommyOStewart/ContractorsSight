import {
  AUDIT_SOURCE_BY_CAPTURE_TYPE,
  resolveTempIds,
  validateChangeSet,
  type CaptureType,
  type ValidationIssue,
} from "@contractorsight/shared";
import type postgres from "postgres";
import { PostgresValidationRepository } from "../db/PostgresValidationRepository";
import type { Sql } from "../db/sql";
import { applyOperations } from "./applyOperations";

export class ChangeSetError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type ApproveResult =
  | { ok: true; tempIdMap: Record<string, string> }
  | { ok: false; issues: ValidationIssue[] };

interface PendingChangeSet {
  id: string;
  orgId: string;
  captureId: string;
  status: string;
  operations: unknown;
  baseJobVersions: Record<string, number>;
  captureType: CaptureType;
}

type Tx = postgres.TransactionSql<Record<string, never>>;

/** Locks the ChangeSet row and checks the user may review it. Not-a-member looks like not-found. */
async function lockForReview(tx: Tx, changeSetId: string, userId: string): Promise<PendingChangeSet> {
  const [changeSet] = await tx<PendingChangeSet[]>`
    select cs.id, cs.org_id, cs.capture_id, cs.status, cs.operations, cs.base_job_versions, c.type as capture_type
    from change_sets cs
    join captures c on c.id = cs.capture_id
    where cs.id = ${changeSetId}
      and exists (select 1 from org_members m where m.org_id = cs.org_id and m.user_id = ${userId})
    for update of cs`;
  if (!changeSet) throw new ChangeSetError(404, "Change set not found.");
  if (changeSet.status !== "pending") throw new ChangeSetError(409, `Change set is already ${changeSet.status}.`);
  return changeSet;
}

/**
 * Commits a pending ChangeSet on behalf of a reviewer, all in one transaction:
 * lock ChangeSet → lock touched jobs and re-validate (versions included) → resolve temp IDs →
 * apply every operation with audit events → mark ChangeSet approved and capture committed.
 *
 * If re-validation fails (e.g. a job changed since the proposal), nothing is applied; the issues
 * are saved on the ChangeSet and returned so the app can show them.
 */
export async function approveChangeSet(sql: Sql, input: { changeSetId: string; userId: string }): Promise<ApproveResult> {
  return sql.begin(async (tx) => {
    const changeSet = await lockForReview(tx, input.changeSetId, input.userId);

    const validation = await validateChangeSet(
      { captureId: changeSet.captureId, baseJobVersions: changeSet.baseJobVersions, operations: changeSet.operations },
      { orgId: changeSet.orgId, repository: new PostgresValidationRepository(tx, { lockJobs: true }) },
    );
    if (!validation.ok) {
      await tx`update change_sets set validation_issues = ${tx.json(validation.issues as unknown as postgres.JSONValue)} where id = ${changeSet.id}`;
      return { ok: false, issues: validation.issues };
    }

    const resolved = resolveTempIds(validation.changeSet);
    await applyOperations(resolved.operations, {
      tx,
      orgId: changeSet.orgId,
      actorUserId: input.userId,
      source: AUDIT_SOURCE_BY_CAPTURE_TYPE[changeSet.captureType],
      changeSetId: changeSet.id,
      captureId: changeSet.captureId,
    });

    await tx`
      update change_sets
      set status = 'approved', reviewed_by = ${input.userId}, reviewed_at = now(),
          temp_id_map = ${tx.json(resolved.tempIdMap)}, validation_issues = '[]'
      where id = ${changeSet.id}`;
    await tx`update captures set status = 'committed' where id = ${changeSet.captureId}`;
    return { ok: true, tempIdMap: resolved.tempIdMap };
  });
}

export async function rejectChangeSet(sql: Sql, input: { changeSetId: string; userId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const changeSet = await lockForReview(tx, input.changeSetId, input.userId);
    await tx`update change_sets set status = 'rejected', reviewed_by = ${input.userId}, reviewed_at = now() where id = ${changeSet.id}`;
    await tx`update captures set status = 'rejected' where id = ${changeSet.captureId}`;
  });
}
