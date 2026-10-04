import type { ValidationIssue } from "@contractorsight/shared";
import type postgres from "postgres";
import { ChangeSetError } from "../commit/changeSetService";
import { PostgresValidationRepository } from "../db/PostgresValidationRepository";
import type { Sql } from "../db/sql";
import type { PostgresPlannerData } from "../planner/PostgresPlannerData";
import { buildCaptureMessage, buildSystemPrompt } from "../planner/prompt";
import { runPlanner } from "../planner/runPlanner";
import type { ChatModel } from "../planner/types";

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

/**
 * Typed-text capture → pending ChangeSet. Synchronous for now (a few seconds); audio and image
 * captures will run the same steps after transcription/OCR, from a queue.
 */
export async function createTextCapture(
  deps: CaptureDeps,
  input: { userId: string; orgId: string; text: string; targetJobId?: string },
): Promise<CaptureResult> {
  const { sql } = deps;
  const [member] = await sql`select 1 from org_members where org_id = ${input.orgId} and user_id = ${input.userId}`;
  if (!member) throw new ChangeSetError(404, "Company not found.");

  let targetJob: { id: string; title: string } | undefined;
  if (input.targetJobId) {
    const [job] = await sql<{ id: string; title: string }[]>`select id, title from jobs where id = ${input.targetJobId} and org_id = ${input.orgId}`;
    if (!job) throw new ChangeSetError(404, "Job not found.");
    targetJob = job;
  }

  const [capture] = await sql<{ id: string }[]>`
    insert into captures (org_id, created_by, type, raw_text, target_job_id, status)
    values (${input.orgId}, ${input.userId}, 'text', ${input.text}, ${input.targetJobId ?? null}, 'processing')
    returning id`;
  const captureId = capture!.id;

  try {
    const context = await deps.data.promptContext(input.orgId);
    const { today, utcOffset } = localDay(deps.now?.() ?? new Date(), deps.timezone);
    const result = await runPlanner({
      model: deps.model,
      lookups: deps.data,
      repository: new PostgresValidationRepository(sql),
      orgId: input.orgId,
      captureId,
      system: buildSystemPrompt({ ...context, today, timezone: deps.timezone, utcOffset }),
      captureMessage: buildCaptureMessage({
        text: input.text,
        captureType: "text",
        targetJob,
        candidates: await deps.data.find(input.orgId, input.text),
      }),
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
  } catch (error) {
    await sql`update captures set status = 'failed', error = ${error instanceof Error ? error.message : String(error)} where id = ${captureId}`;
    throw error;
  }
}
