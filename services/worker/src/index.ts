// Worker entry point. Real queue consumption (Supabase realtime / pg queue) is not built yet;
// this just proves the pipeline wiring runs.
import { InMemoryRepository } from "@contractorsight/shared/testing";
import { processCapture } from "./pipeline/processCapture";
import { InMemoryChangeSetStore, stubImageText, stubPlanner, stubSpeechToText } from "./pipeline/stubs";

const store = new InMemoryChangeSetStore();
const result = await processCapture(
  {
    id: crypto.randomUUID(),
    orgId: crypto.randomUUID(),
    type: "text",
    rawText: "Need two SB couplings for the Henderson job",
    sourceFiles: [],
    targetJobId: null,
  },
  {
    speechToText: stubSpeechToText,
    imageText: stubImageText,
    planner: stubPlanner,
    repository: new InMemoryRepository(),
    store,
  },
);
console.log("Stored pending ChangeSet:", JSON.stringify(store.saved[0]?.draft, null, 2), "issues:", result.issues);
