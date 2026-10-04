import { z } from "zod";
import { TOOLS } from "./definitions";

export type AnyTool = (typeof TOOLS)[number];
export type ToolName = AnyTool["name"];
export type ToolByName = { [T in AnyTool as T["name"]]: T };

/** Tools whose calls are staged into a ChangeSet (mutations and signals). */
export type StagedTool = Extract<AnyTool, { kind: "mutation" | "signal" }>;
export type StagedToolName = StagedTool["name"];
export type LookupToolName = Extract<AnyTool, { kind: "lookup" }>["name"];

/** Arguments as the LLM sends them (defaults not yet applied). */
export type ToolInput<N extends ToolName> = z.input<ToolByName[N]["input"]>;
/** Arguments after parsing (defaults applied, strings trimmed). */
export type ToolArgs<N extends ToolName> = z.output<ToolByName[N]["input"]>;

export const toolsByName: ReadonlyMap<string, AnyTool> = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): AnyTool | undefined {
  return toolsByName.get(name);
}

export interface LlmToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** JSON Schema for one tool's input, in the shape LLM tool-use APIs expect. */
export function toolInputJsonSchema(tool: AnyTool): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input, { io: "input", target: "draft-2020-12" });
  return schema;
}

export function toLlmToolSchemas(tools: readonly AnyTool[] = TOOLS): LlmToolSchema[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toolInputJsonSchema(tool),
  }));
}
