import { worker, WorkerError } from '../lib/worker';

type Args = Record<string, unknown>;

// Hand edits go through the worker like everything else, so they're validated against the same
// rules and recorded in the audit history (as "manual"). They apply right away; no review step.

/** The fields of `next` that differ from `before`; unchanged and blanked-out fields are left out. */
export function changedFields(before: Args, next: Args): Args {
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== undefined && v !== '' && v !== before[k]));
}

/** Saves a hand edit. Returns a message to show, or null when it saved. */
export async function saveEdit(
  orgId: string,
  operations: { tool: string; args: Args }[],
  baseJobVersions?: Record<string, number>,
): Promise<string | null> {
  try {
    await worker.edit(orgId, operations, baseJobVersions);
    return null;
  } catch (e) {
    if (!(e instanceof WorkerError)) return 'Something went wrong saving that.';
    if (e.issues.some((i) => i.code === 'STALE_VERSION')) return 'This job changed since you opened it. Go back and open it again.';
    return e.issues[0]?.message ?? e.message;
  }
}
