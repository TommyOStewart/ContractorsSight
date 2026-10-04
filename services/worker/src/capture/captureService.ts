import type { ValidationIssue } from "@contractorsight/shared";
import type postgres from "postgres";
import { ChangeSetError } from "../commit/changeSetService";
import { PostgresValidationRepository } from "../db/PostgresValidationRepository";
import type { Sql } from "../db/sql";
import type { PostgresPlannerData } from "../planner/PostgresPlannerData";
import { buildCaptureMessage, buildSystemPrompt } from "../planner/prompt";
import { runPlanner } from "../planner/runPlanner";
import type { ChatModel } from "../planner/types";
import type { Transcriber } from "../speech/transcriber";
import type { ImageReader } from "../vision/imageReader";

export interface CaptureDeps {
  sql: Sql;
  model: ChatModel;
  data: PostgresPlannerData;
  /** IANA timezone used to interpret "tomorrow at 2" (per-org setting later). */
  timezone: string;
  now?: () => Date;
}

export interface CaptureResult {
  captureId: string;
  /** Null when the capture had nothing to record. */
  changeSetId: string | null;
  /** The model's one-line summary of what it staged. */
  summary: string | null;
  issues: ValidationIssue[];
}

/** "Monday, 2026-10-05" and "-05:00" for a moment in a timezone. */
export function localDay(now: Date, timeZone: string): { today: string; utcOffset: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName").replace("GMT", "") || "+00:00";
  return { today: `${get("weekday")}, ${get("year")}-${get("month")}-${get("day")}`, utcOffset: offset };
}

async function requireMember(sql: Sql, orgId: string, userId: string) {
  const [member] = await sql`select 1 from org_members where org_id = ${orgId} and user_id = ${userId}`;
  if (!member) throw new ChangeSetError(404, "Company not found.");
}

/**
 * Runs the planner for a capture and stores the result as a pending ChangeSet. `answers` carries
 * the contractor's replies to earlier questions about the same capture.
 */
async function planCapture(
  deps: CaptureDeps,
  input: {
    captureId: string;
    captureType: "audio" | "image" | "text";
    orgId: string;
    text: string;
    targetJob?: { id: string; title: string };
    answers?: { question: string; answer: string }[];
    /** The proposal being replaced, so corrections like "make it three" have something to change. */
    previousOperations?: unknown[];
  },
): Promise<CaptureResult> {
  const { sql } = deps;
  const { captureId } = input;
  const context = await deps.data.promptContext(input.orgId);
  const { today, utcOffset } = localDay(deps.now?.() ?? new Date(), deps.timezone);
  const previous = input.previousOperations?.length
    ? `\n\nYour previous proposal for this capture (shown to the contractor, not saved):\n${JSON.stringify(input.previousOperations)}`
    : "";
  const answers = input.answers?.length
    ? `\n\nThe contractor responded to your proposal:\n${input.answers.map((a) => `- ${a.question}\n  ${a.answer}`).join("\n")}\nStage the complete corrected set from scratch: apply these answers and corrections, keep everything they didn't change, and don't ask again about what they answered.`
    : "";

  const result = await runPlanner({
    model: deps.model,
    lookups: deps.data,
    repository: new PostgresValidationRepository(sql),
    orgId: input.orgId,
    captureId,
    system: buildSystemPrompt({ ...context, today, timezone: deps.timezone, utcOffset }),
    captureMessage:
      buildCaptureMessage({
        text: input.text,
        captureType: input.captureType,
        targetJob: input.targetJob,
        candidates: await deps.data.find(input.orgId, input.text),
      }) +
      previous +
      answers,
  });
  console.log(
    `capture ${captureId}: ${result.draft.operations.length} ops, ${result.issues.length} issues, ` +
      `${result.turns} turns, $${result.usage.costUsd.toFixed(4)}, ${(result.usage.modelMs / 1000).toFixed(1)}s (${deps.model.id})`,
  );

  if (!result.draft.operations.length) {
    // Nothing to record ("grab coffee filters"): done, no review needed.
    await sql`update captures set status = 'committed' where id = ${captureId}`;
    return { captureId, changeSetId: null, summary: result.finalText, issues: [] };
  }

  const [changeSet] = await sql<{ id: string }[]>`
    insert into change_sets (org_id, capture_id, operations, base_job_versions, validation_issues)
    values (
      ${input.orgId}, ${captureId},
      ${sql.json(result.draft.operations as postgres.JSONValue)},
      ${sql.json(result.draft.baseJobVersions)},
      ${sql.json(result.issues as unknown as postgres.JSONValue)}
    )
    returning id`;
  await sql`update captures set status = 'ready_for_review' where id = ${captureId}`;
  return { captureId, changeSetId: changeSet!.id, summary: result.finalText, issues: result.issues };
}

async function failCapture(sql: Sql, captureId: string, error: unknown): Promise<never> {
  await sql`update captures set status = 'failed', error = ${error instanceof Error ? error.message : String(error)} where id = ${captureId}`;
  throw error;
}

/**
 * Text (typed, or transcribed from audio) → pending ChangeSet. Synchronous for now (a few seconds).
 */
export async function createTextCapture(
  deps: CaptureDeps,
  input: { userId: string; orgId: string; text: string; targetJobId?: string; captureType?: "audio" | "text"; captureId?: string },
): Promise<CaptureResult> {
  const { sql } = deps;
  await requireMember(sql, input.orgId, input.userId);

  let targetJob: { id: string; title: string } | undefined;
  if (input.targetJobId) {
    const [job] = await sql<{ id: string; title: string }[]>`select id, title from jobs where id = ${input.targetJobId} and org_id = ${input.orgId}`;
    if (!job) throw new ChangeSetError(404, "Job not found.");
    targetJob = job;
  }

  const captureType = input.captureType ?? "text";
  let captureId = input.captureId;
  if (captureId) {
    await sql`update captures set raw_text = ${input.text}, status = 'processing' where id = ${captureId} and org_id = ${input.orgId}`;
  } else {
    const [capture] = await sql<{ id: string }[]>`
      insert into captures (org_id, created_by, type, raw_text, target_job_id, status)
      values (${input.orgId}, ${input.userId}, ${captureType}, ${input.text}, ${input.targetJobId ?? null}, 'processing')
      returning id`;
    captureId = capture!.id;
  }

  try {
    return await planCapture(deps, { captureId, captureType, orgId: input.orgId, text: input.text, targetJob });
  } catch (error) {
    return failCapture(sql, captureId, error);
  }
}

interface PendingCapture {
  orgId: string;
  captureId: string;
  status: string;
  type: "audio" | "image" | "text";
  rawText: string | null;
  targetJobId: string | null;
  operations: unknown[];
}

async function loadPending(sql: Sql, changeSetId: string, userId: string): Promise<PendingCapture> {
  const [row] = await sql<PendingCapture[]>`
    select cs.org_id, cs.capture_id, cs.status, cs.operations, c.type, c.raw_text, c.target_job_id
    from change_sets cs join captures c on c.id = cs.capture_id
    where cs.id = ${changeSetId}`;
  if (!row) throw new ChangeSetError(404, "Change set not found.");
  await requireMember(sql, row.orgId, userId);
  if (row.status !== "pending") throw new ChangeSetError(409, `Change set is already ${row.status}.`);
  return row;
}

/** Answer to a flag_ambiguity question. */
export async function answerQuestion(
  deps: CaptureDeps,
  input: { userId: string; changeSetId: string; question: string; answer: string },
): Promise<CaptureResult> {
  return reviseCapture(deps, input);
}

/** A typed correction to a pending proposal ("make it three, not two"). */
export async function correctCapture(deps: CaptureDeps, input: { userId: string; changeSetId: string; text: string }): Promise<CaptureResult> {
  return reviseCapture(deps, { userId: input.userId, changeSetId: input.changeSetId, question: "Correction after reviewing:", answer: input.text });
}

/** A spoken correction to a pending proposal: transcribe, keep the recording, then revise. */
export async function correctCaptureByAudio(
  deps: CaptureDeps & AudioDeps,
  input: { userId: string; changeSetId: string; accessToken: string; audioPath: string },
): Promise<CaptureResult & { transcript: string }> {
  const pending = await loadPending(deps.sql, input.changeSetId, input.userId);
  requireOrgPath(pending.orgId, input.audioPath);
  await deps.sql`
    insert into attachments (org_id, storage_path, mime_type, capture_id, uploaded_by)
    values (${pending.orgId}, ${input.audioPath}, 'audio/mp4', ${pending.captureId}, ${input.userId})`;
  const { text } = await deps.transcriber.transcribe(await deps.downloadFile(input.accessToken, input.audioPath), "m4a");
  if (!text) throw new ChangeSetError(409, "We couldn't hear anything in that recording. Try again a little closer to the phone.");
  const result = await correctCapture(deps, { userId: input.userId, changeSetId: input.changeSetId, text });
  return { ...result, transcript: text };
}

/**
 * The contractor answered a question or corrected a pending ChangeSet: re-plan the same capture
 * with every answer so far plus the proposal being replaced, mark the old proposal rejected, and
 * return the new one.
 */
async function reviseCapture(
  deps: CaptureDeps,
  input: { userId: string; changeSetId: string; question: string; answer: string },
): Promise<CaptureResult> {
  const { sql } = deps;
  const row = await loadPending(sql, input.changeSetId, input.userId);

  // Earlier answers on this capture, so a second question doesn't lose the first answer.
  const previous = await sql<{ question: string; answer: string }[]>`
    select question, answer from capture_answers where capture_id = ${row.captureId} order by created_at`;
  await sql`
    insert into capture_answers (org_id, capture_id, change_set_id, question, answer, answered_by)
    values (${row.orgId}, ${row.captureId}, ${input.changeSetId}, ${input.question}, ${input.answer}, ${input.userId})`;
  await sql`update change_sets set status = 'rejected', reviewed_by = ${input.userId}, reviewed_at = now() where id = ${input.changeSetId}`;

  const targetJob = row.targetJobId
    ? (await sql<{ id: string; title: string }[]>`select id, title from jobs where id = ${row.targetJobId}`)[0]
    : undefined;
  try {
    return await planCapture(deps, {
      captureId: row.captureId,
      captureType: row.type,
      orgId: row.orgId,
      text: row.rawText ?? "",
      targetJob,
      answers: [...previous, { question: input.question, answer: input.answer }],
      previousOperations: row.operations,
    });
  } catch (error) {
    return failCapture(sql, row.captureId, error);
  }
}

/** Fetches an uploaded capture file from storage, as the user (so storage RLS applies). */
export type DownloadFile = (accessToken: string, storagePath: string) => Promise<Uint8Array>;

export interface AudioDeps {
  transcriber: Transcriber;
  downloadFile: DownloadFile;
}

export interface ImageDeps {
  imageReader: ImageReader;
  downloadFile: DownloadFile;
}

async function loadTargetJob(sql: Sql, orgId: string, jobId?: string): Promise<{ id: string; title: string } | undefined> {
  if (!jobId) return undefined;
  const [job] = await sql<{ id: string; title: string }[]>`select id, title from jobs where id = ${jobId} and org_id = ${orgId}`;
  if (!job) throw new ChangeSetError(404, "Job not found.");
  return job;
}

/** Uploaded files must sit under the org's folder in the captures bucket. */
function requireOrgPath(orgId: string, path: string) {
  if (!path.startsWith(`${orgId}/`) || path.includes("..")) throw new ChangeSetError(404, "File not found.");
}

/**
 * Voice note → transcript → pending ChangeSet. The phone has already uploaded the recording to
 * the `captures` bucket under `<org id>/…`; the attachment row keeps it with the capture.
 */
export async function createAudioCapture(
  deps: CaptureDeps & AudioDeps,
  input: { userId: string; orgId: string; accessToken: string; audioPath: string; targetJobId?: string },
): Promise<CaptureResult & { transcript: string }> {
  const { sql } = deps;
  await requireMember(sql, input.orgId, input.userId);
  requireOrgPath(input.orgId, input.audioPath);
  const targetJob = await loadTargetJob(sql, input.orgId, input.targetJobId);

  const [capture] = await sql<{ id: string }[]>`
    insert into captures (org_id, created_by, type, target_job_id, status)
    values (${input.orgId}, ${input.userId}, 'audio', ${input.targetJobId ?? null}, 'processing')
    returning id`;
  const captureId = capture!.id;
  await sql`
    insert into attachments (org_id, storage_path, mime_type, capture_id, uploaded_by)
    values (${input.orgId}, ${input.audioPath}, 'audio/mp4', ${captureId}, ${input.userId})`;

  try {
    const audio = await deps.downloadFile(input.accessToken, input.audioPath);
    const { text, costUsd } = await deps.transcriber.transcribe(audio, "m4a");
    console.log(`capture ${captureId}: transcribed ${audio.byteLength} bytes, $${costUsd.toFixed(4)} (${deps.transcriber.id})`);
    if (!text) {
      await sql`update captures set status = 'failed', error = 'No speech heard' where id = ${captureId}`;
      return { captureId, changeSetId: null, summary: "We couldn't hear anything in that recording. Try again a little closer to the phone.", issues: [], transcript: "" };
    }
    await sql`update captures set raw_text = ${text} where id = ${captureId}`;
    const result = await planCapture(deps, { captureId, captureType: "audio", orgId: input.orgId, text, targetJob });
    return { ...result, transcript: text };
  } catch (error) {
    return failCapture(sql, captureId, error);
  }
}

/**
 * Photos of notes or receipts → text → pending ChangeSet. The phone has already uploaded each image
 * to the `captures` bucket under `<org id>/…`; every page is kept as an attachment.
 */
export async function createImageCapture(
  deps: CaptureDeps & ImageDeps,
  input: { userId: string; orgId: string; accessToken: string; imagePaths: string[]; targetJobId?: string },
): Promise<CaptureResult & { transcript: string }> {
  const { sql } = deps;
  await requireMember(sql, input.orgId, input.userId);
  for (const path of input.imagePaths) requireOrgPath(input.orgId, path);
  const targetJob = await loadTargetJob(sql, input.orgId, input.targetJobId);

  const [capture] = await sql<{ id: string }[]>`
    insert into captures (org_id, created_by, type, target_job_id, status)
    values (${input.orgId}, ${input.userId}, 'image', ${input.targetJobId ?? null}, 'processing')
    returning id`;
  const captureId = capture!.id;
  for (const path of input.imagePaths) {
    await sql`
      insert into attachments (org_id, storage_path, mime_type, capture_id, uploaded_by)
      values (${input.orgId}, ${path}, 'image/jpeg', ${captureId}, ${input.userId})`;
  }

  try {
    const images = await Promise.all(
      input.imagePaths.map(async (path) => ({ bytes: await deps.downloadFile(input.accessToken, path), mimeType: "image/jpeg" })),
    );
    const { text, costUsd } = await deps.imageReader.read(images);
    console.log(`capture ${captureId}: read ${images.length} photo(s), $${costUsd.toFixed(4)} (${deps.imageReader.id})`);
    if (!text) {
      await sql`update captures set status = 'failed', error = 'No readable text' where id = ${captureId}`;
      return {
        captureId,
        changeSetId: null,
        summary: "We couldn't read any writing in that photo. Try again with more light, closer up.",
        issues: [],
        transcript: "",
      };
    }
    await sql`update captures set raw_text = ${text} where id = ${captureId}`;
    const result = await planCapture(deps, { captureId, captureType: "image", orgId: input.orgId, text, targetJob });
    return { ...result, transcript: text };
  } catch (error) {
    return failCapture(sql, captureId, error);
  }
}
