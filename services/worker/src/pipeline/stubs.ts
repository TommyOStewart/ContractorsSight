import type { ChangeSetDraft } from "@contractorsight/shared";
import type { ChangeSetPlanner, ChangeSetStore, ImageTextExtractor, SpeechToText } from "./ports";

// Placeholders until real providers are chosen. They make the pipeline runnable end to end.

export const stubSpeechToText: SpeechToText = {
  async transcribe(path) {
    return `[transcript of ${path}]`;
  },
};

export const stubImageText: ImageTextExtractor = {
  async extractText(path) {
    return `[text extracted from ${path}]`;
  },
};

/** Turns any capture into a single note on its target job, or an ambiguity flag if there is none. */
export const stubPlanner: ChangeSetPlanner = {
  async plan({ capture, text }): Promise<ChangeSetDraft> {
    if (!capture.targetJobId) {
      return {
        captureId: capture.id,
        baseJobVersions: {},
        operations: [
          { tool: "flag_ambiguity", args: { question: "Which job is this capture about?", about: "job", sourceExcerpt: text.slice(0, 500) } },
        ],
      };
    }
    return {
      captureId: capture.id,
      baseJobVersions: {},
      operations: [{ tool: "add_note", args: { jobId: capture.targetJobId, body: text } }],
    };
  },
};

export class InMemoryChangeSetStore implements ChangeSetStore {
  readonly saved: Parameters<ChangeSetStore["savePending"]>[0][] = [];
  async savePending(input: Parameters<ChangeSetStore["savePending"]>[0]) {
    this.saved.push(input);
  }
}
