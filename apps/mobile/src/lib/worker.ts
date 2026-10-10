import type { ValidationIssue } from '@contractorsight/shared';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { supabase } from './supabase';

// The worker runs the AI planner and commits approved changes. The app never calls a model itself.
const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL;
/** A worker on the home network (a dev PC), where "same Wi-Fi" is the likely fix. */
const onLan = !!workerUrl && /^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(workerUrl);

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (!workerUrl) throw new WorkerError('EXPO_PUBLIC_WORKER_URL is not set in apps/mobile/.env.', 0);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new WorkerError('Not signed in.', 401);

  // Captures take a few seconds; anything past a minute means the worker isn't answering.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${workerUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new WorkerError(
      controller.signal.aborted
        ? onLan
          ? `The worker at ${workerUrl} didn't answer within a minute. Check that it's running.`
          : "The server didn't answer within a minute. Try again in a moment."
        : onLan
          ? `Can't reach the worker at ${workerUrl}. Is it running, and is the phone on the same Wi-Fi?`
          : "Can't reach the server. Check that the phone has signal or Wi-Fi, then try again.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: ValidationIssue[] };
  if (!res.ok) {
    throw new WorkerError(
      json.error ?? (json.issues?.length ? 'These changes no longer fit the current records.' : `Worker error ${res.status}`),
      res.status,
      json.issues,
    );
  }
  return json as T;
}

export interface CaptureResult {
  captureId: string;
  changeSetId: string | null;
  summary: string | null;
  issues: ValidationIssue[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plain words for a capture the worker marked failed (its stored error is meant for logs). */
export function captureErrorMessage(error: string | null): string {
  if (error === 'No speech heard') return "We couldn't hear anything in that recording. Try again a little closer to the phone.";
  if (error === 'No readable text') return "We couldn't read any writing in that photo. Try again with more light, closer up.";
  return 'Something went wrong reading that note. Nothing was saved. Try it again.';
}

/**
 * The connection to the worker dropped (the phone locked, the app went to the background, signal
 * cut out) but the worker carries on regardless. Watch the database for the result instead.
 *
 * `notChangeSetId`: when revising, the proposal being replaced (it stays visible until the new one lands).
 */
async function awaitProposal(captureId: string, dropped: WorkerError, notChangeSetId?: string): Promise<CaptureResult> {
  const started = Date.now();
  let seen = false;
  // Planning takes seconds, occasionally a minute or two. Timers pause while the app is in the background.
  while (Date.now() - started < 4 * 60_000) {
    await sleep(2500);
    if (AppState.currentState !== 'active') continue;
    const { data: capture } = await supabase.from('captures').select('status, error').eq('id', captureId).maybeSingle();
    if (!capture) {
      // The request never arrived; after a short wait, report the original problem.
      if (!seen && Date.now() - started > 20_000) throw dropped;
      continue;
    }
    seen = true;
    if (capture.status === 'failed') throw new WorkerError(captureErrorMessage(capture.error), 500);
    if (capture.status === 'committed') return { captureId, changeSetId: null, summary: 'Nothing to record in that note.', issues: [] };
    if (capture.status !== 'ready_for_review') continue;
    let query = supabase.from('change_sets').select('id').eq('capture_id', captureId).eq('status', 'pending');
    if (notChangeSetId) query = query.neq('id', notChangeSetId);
    const { data: proposal } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (proposal) return { captureId, changeSetId: proposal.id, summary: null, issues: [] };
  }
  throw new WorkerError("That's taking longer than usual. It will show up in Review when it's ready.", 0);
}

/** Sends a new capture under an ID chosen here, so a dropped connection doesn't lose the result. */
async function sendCapture<T extends CaptureResult>(path: string, input: object): Promise<T> {
  const clientCaptureId = Crypto.randomUUID();
  try {
    return await call<T>(path, { ...input, clientCaptureId });
  } catch (e) {
    if (!(e instanceof WorkerError) || e.status !== 0) throw e;
    return (await awaitProposal(clientCaptureId, e)) as T;
  }
}

/** Same, for a correction or answer that re-plans an existing proposal. */
async function sendRevision(changeSetId: string, path: string, body: object): Promise<CaptureResult> {
  try {
    return await call<CaptureResult>(path, body);
  } catch (e) {
    if (!(e instanceof WorkerError) || e.status !== 0) throw e;
    const { data } = await supabase.from('change_sets').select('capture_id').eq('id', changeSetId).maybeSingle();
    if (!data) throw e;
    return awaitProposal(data.capture_id, e, changeSetId);
  }
}

export const worker = {
  createCapture: (input: { orgId: string; text: string; targetJobId?: string }) => sendCapture<CaptureResult>('/captures', input),
  /** The recording is already uploaded to the `captures` bucket at `audioPath`. */
  createAudioCapture: (input: { orgId: string; audioPath: string; targetJobId?: string }) =>
    sendCapture<CaptureResult & { transcript?: string }>('/captures/audio', input),
  /** Photos already uploaded to the `captures` bucket, one path per page. */
  createImageCapture: (input: { orgId: string; imagePaths: string[]; targetJobId?: string }) =>
    sendCapture<CaptureResult & { transcript?: string }>('/captures/image', input),
  /** `include`: indexes of the operations to save; omit to save all. */
  approve: (changeSetId: string, include?: number[]) =>
    call<{ ok: true; tempIdMap: Record<string, string> }>(`/change-sets/${changeSetId}/approve`, include ? { include } : {}),
  /** Answer a question on a pending note; returns the re-planned note. */
  answer: (changeSetId: string, body: { question: string; answer: string }) => sendRevision(changeSetId, `/change-sets/${changeSetId}/answer`, body),
  /** A typed or spoken fix to a pending note; returns the re-planned note. */
  revise: (changeSetId: string, body: { text: string } | { audioPath: string }) => sendRevision(changeSetId, `/change-sets/${changeSetId}/revise`, body),
  /** Save a hand edit to one proposed change; returns what still needs fixing. */
  updateOperation: (changeSetId: string, index: number, args: Record<string, unknown>) =>
    call<{ issues: ValidationIssue[] }>(`/change-sets/${changeSetId}/operations/${index}`, { args }),
  reject: (changeSetId: string) => call<{ ok: true }>(`/change-sets/${changeSetId}/reject`),
  /** A hand edit: applied right away (no review), validated and audited like any other change. */
  edit: (orgId: string, operations: { tool: string; args: Record<string, unknown> }[], baseJobVersions?: Record<string, number>) =>
    call<{ ok: true; tempIdMap: Record<string, string> }>('/edits', { orgId, operations, baseJobVersions }),
};
