import type { CaptureType, ChangeSetDraft, ValidationIssue, ValidationRepository } from "@contractorsight/shared";

/** A capture as the worker receives it. Audio, image, and text all flow through the same pipeline. */
export interface CaptureInput {
  id: string;
  orgId: string;
  type: CaptureType;
  /** Typed text for `text` captures; empty for audio/image until extraction fills it in. */
  rawText: string | null;
  /** Storage paths of the uploaded audio or image files. */
  sourceFiles: string[];
  targetJobId: string | null;
}

/** Speech-to-text. The worker holds the API keys; the phone never calls a model. */
export interface SpeechToText {
  transcribe(storagePath: string): Promise<string>;
}

/** Text extraction from photos of handwritten notes and receipts. */
export interface ImageTextExtractor {
  extractText(storagePath: string): Promise<string>;
}

/**
 * The LLM step: reads capture text and proposes staged tool calls. It may run lookups
 * internally; what it returns is only the proposal, never a write.
 */
export interface ChangeSetPlanner {
  plan(input: { capture: CaptureInput; text: string }): Promise<ChangeSetDraft>;
}

/** Persists proposals for human review. */
export interface ChangeSetStore {
  savePending(input: { capture: CaptureInput; draft: ChangeSetDraft; issues: ValidationIssue[] }): Promise<void>;
}

export interface PipelineDeps {
  speechToText: SpeechToText;
  imageText: ImageTextExtractor;
  planner: ChangeSetPlanner;
  repository: ValidationRepository;
  store: ChangeSetStore;
}
