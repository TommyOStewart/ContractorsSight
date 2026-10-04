import type { z } from "zod";

/**
 * - `lookup`:   read-only, executed by the worker during the LLM loop; never part of a ChangeSet.
 * - `mutation`: becomes a staged operation in a ChangeSet; writes only after human approval.
 * - `signal`:   goes into the ChangeSet for the reviewer to see, but writes nothing (e.g. flag_ambiguity).
 */
export type ToolKind = "lookup" | "mutation" | "signal";

export interface ToolDefinition<
  Name extends string = string,
  Kind extends ToolKind = ToolKind,
  Input extends z.ZodObject = z.ZodObject,
> {
  name: Name;
  kind: Kind;
  /** Shown to the LLM. Say when to use the tool and when not to. */
  description: string;
  input: Input;
}

export function defineTool<const Name extends string, const Kind extends ToolKind, Input extends z.ZodObject>(
  definition: ToolDefinition<Name, Kind, Input>,
): ToolDefinition<Name, Kind, Input> {
  return definition;
}
