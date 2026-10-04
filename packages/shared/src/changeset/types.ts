import { z } from "zod";
import type { StagedToolName, ToolArgs } from "../tools/registry";

/**
 * A ChangeSet as proposed by the pipeline: the LLM's staged tool calls plus the job
 * versions the worker read while building it. `args` is unchecked here; validation
 * parses each operation against its tool's schema.
 *
 * The org is deliberately absent: it comes from the authenticated capture
 * (ValidationContext.orgId), never from the payload.
 */
export const changeSetDraftSchema = z.strictObject({
  captureId: z.uuid(),
  /** Version of every existing job the operations touch, as read when the ChangeSet was built. */
  baseJobVersions: z.record(z.uuid(), z.int().nonnegative()),
  operations: z
    .array(
      z.strictObject({
        tool: z.string(),
        args: z.unknown(),
      }),
    )
    .min(1)
    .max(200),
});
export type ChangeSetDraft = z.infer<typeof changeSetDraftSchema>;

/** One operation after it passed schema validation. Discriminated on `tool`. */
export type StagedOperation = {
  [N in StagedToolName]: { tool: N; args: ToolArgs<N> };
}[StagedToolName];

export interface ValidatedChangeSet {
  captureId: string;
  baseJobVersions: Record<string, number>;
  operations: StagedOperation[];
}
