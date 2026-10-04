import { InMemoryRepository } from "@contractorsight/shared/testing";
import { describe, expect, it } from "vitest";
import { processCapture } from "../../src/pipeline/processCapture";
import { InMemoryChangeSetStore, stubImageText, stubPlanner, stubSpeechToText } from "../../src/pipeline/stubs";

describe("processCapture (stubbed)", () => {
  it("stores a pending ChangeSet for a voice capture without writing anything else", async () => {
    const store = new InMemoryChangeSetStore();
    const { issues } = await processCapture(
      { id: crypto.randomUUID(), orgId: crypto.randomUUID(), type: "audio", rawText: null, sourceFiles: ["a.m4a"], targetJobId: null },
      { speechToText: stubSpeechToText, imageText: stubImageText, planner: stubPlanner, repository: new InMemoryRepository(), store },
    );
    expect(issues).toEqual([]);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]!.draft.operations[0]!.tool).toBe("flag_ambiguity");
  });
});
