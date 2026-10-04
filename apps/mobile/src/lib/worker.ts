import type { ValidationIssue } from '@contractorsight/shared';
import { supabase } from './supabase';

// The worker runs the AI planner and commits approved changes. The app never calls a model itself.
const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL;

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

  let res: Response;
  try {
    res = await fetch(`${workerUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new WorkerError(`Can't reach the worker at ${workerUrl}. Is it running, and is the phone on the same Wi-Fi?`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: ValidationIssue[] };
  if (!res.ok) {
    throw new WorkerError(json.error ?? (json.issues?.length ? 'These changes no longer fit the current records.' : `Worker error ${res.status}`), res.status, json.issues);
  }
  return json as T;
}

export interface CaptureResult {
  captureId: string;
  changeSetId: string | null;
  summary: string | null;
  issues: ValidationIssue[];
}

export const worker = {
  createCapture: (input: { orgId: string; text: string; targetJobId?: string }) => call<CaptureResult>('/captures', input),
  approve: (changeSetId: string) => call<{ ok: true; tempIdMap: Record<string, string> }>(`/change-sets/${changeSetId}/approve`),
  reject: (changeSetId: string) => call<{ ok: true }>(`/change-sets/${changeSetId}/reject`),
};
