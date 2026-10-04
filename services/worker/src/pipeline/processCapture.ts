import { validateChangeSet, type ValidationIssue } from "@contractorsight/shared";
import type { CaptureInput, PipelineDeps } from "./ports";

export async function captureText(capture: CaptureInput, deps: PipelineDeps): Promise<string> {
  switch (capture.type) {
    case "text":
      return capture.rawText ?? "";
    case "audio":
      return (await Promise.all(capture.sourceFiles.map((f) => deps.speechToText.transcribe(f)))).join("\n\n");
    case "image":
      return (await Promise.all(capture.sourceFiles.map((f) => deps.imageText.extractText(f)))).join("\n\n");
  }
}

/**
 * Capture → text → proposed ChangeSet → validation → stored as pending for review.
 * Nothing here writes domain data; committing happens only after a human approves.
 */
export async function processCapture(capture: CaptureInput, deps: PipelineDeps): Promise<{ issues: ValidationIssue[] }> {
  const text = await captureText(capture, deps);
  const draft = await deps.planner.plan({ capture, text });
  const result = await validateChangeSet(draft, { orgId: capture.orgId, repository: deps.repository });
  const issues = result.ok ? [] : result.issues;
  // TODO: feed issues back to the planner for a bounded number of repair attempts before storing.
  await deps.store.savePending({ capture, draft, issues });
  return { issues };
}
