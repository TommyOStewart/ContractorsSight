import type { ToolArgs } from "@contractorsight/shared";
import type { SchemaStyle } from "./schemaStyle";

/**
 * Provider-neutral chat types, in the OpenAI chat-completions shape that OpenRouter speaks.
 * A direct provider adapter (e.g. Anthropic's SDK) converts to and from these.
 */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model produced it. */
  arguments: string;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  costUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Time spent in successful model requests, excluding client-side pacing and retry waits. */
  modelMs: number;
}

export interface ChatResponse {
  text: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface ChatModel {
  readonly id: string;
  /** How this model's provider wants optional tool parameters expressed. */
  readonly schemaStyle: SchemaStyle;
  complete(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }): Promise<ChatResponse>;
}

/** Records found by searching the capture text before the model runs (pre-search). */
export interface Candidates {
  clients: unknown[];
  jobs: unknown[];
}

/** Searches the capture text up front so the model can usually act without lookup round trips. */
export interface CandidateFinder {
  find(orgId: string, captureText: string): Promise<Candidates>;
}

/** Read-only lookups the model can run while planning. Always scoped to one org. */
export interface LookupExecutor {
  findClients(orgId: string, args: ToolArgs<"find_client">): Promise<unknown[]>;
  findJobs(orgId: string, args: ToolArgs<"find_job">): Promise<unknown[]>;
}

export interface GlossaryEntry {
  term: string;
  expansion: string;
}
