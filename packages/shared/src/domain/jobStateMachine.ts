import type { JobStatus } from "./enums";

/**
 * Legal job status transitions. The happy path is
 * lead → quoted → accepted → scheduled → in_progress → completed → invoiced → paid,
 * with `declined` (customer said no) and `cancelled` (stopped after/without agreement) as exits.
 *
 * The same table is seeded into `job_status_transitions` in the database and enforced by a
 * trigger; test/migrationParity.test.ts keeps them identical.
 */
export const JOB_STATUS_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  lead: ["quoted", "declined", "cancelled"],
  quoted: ["accepted", "declined", "cancelled"],
  accepted: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["invoiced"],
  invoiced: ["paid"],
  paid: [],
  declined: [],
  cancelled: [],
};

/** Jobs in these states accept notes only. */
export const CLOSED_JOB_STATUSES: readonly JobStatus[] = ["paid", "declined", "cancelled"];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function isClosed(status: JobStatus): boolean {
  return CLOSED_JOB_STATUSES.includes(status);
}
