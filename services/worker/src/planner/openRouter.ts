import type { SchemaStyle } from "./schemaStyle";
import type { ChatMessage, ChatModel, ChatResponse, ToolSpec } from "./types";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface OpenRouterOptions {
  apiKey: string;
  /** OpenRouter model ID, e.g. "anthropic/claude-sonnet-5.5". */
  model: string;
  effort?: ReasoningEffort;
  maxTokens?: number;
  /** Retries for 429 / 5xx / network errors. */
  maxRetries?: number;
  /** Max requests per minute to this model from this process (OpenRouter limits new accounts to 20). */
  requestsPerMinute?: number;
  fetchImpl?: typeof fetch;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface WireResponse {
  choices?: { message: { content: string | null; tool_calls?: WireToolCall[] }; finish_reason: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message: string; code?: number };
}

function toWire(messages: ChatMessage[]) {
  return messages.map((m) => {
    switch (m.role) {
      case "user":
        return { role: "user", content: m.content };
      case "tool":
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      case "assistant":
        return {
          role: "assistant",
          content: m.content ?? "",
          ...(m.toolCalls.length
            ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
            : {}),
        };
    }
  });
}

export class OpenRouterChatModel implements ChatModel {
  readonly id: string;
  readonly schemaStyle: SchemaStyle;

  constructor(private readonly options: OpenRouterOptions) {
    this.id = options.model;
    this.schemaStyle = options.model.startsWith("openai/") ? "nullable-optionals" : "standard";
  }

  async complete(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }): Promise<ChatResponse> {
    const body = {
      model: this.options.model,
      messages: [
        // cache_control marks the stable prefix (tools + instructions) for providers that need an
        // explicit breakpoint (Anthropic, Gemini); others cache automatically and ignore it.
        { role: "system", content: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }] },
        ...toWire(input.messages),
      ],
      tools: input.tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      reasoning: { effort: this.options.effort ?? "medium" },
      max_tokens: this.options.maxTokens ?? 16000,
    };

    const { data, ms } = await this.post(body);
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`OpenRouter returned no choices: ${data.error?.message ?? "unknown error"}`);

    return {
      text: choice.message.content,
      toolCalls: (choice.message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      usage: {
        costUsd: data.usage?.cost ?? 0,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        modelMs: ms,
      },
    };
  }

  private async post(body: unknown): Promise<{ data: WireResponse; ms: number }> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const maxRetries = this.options.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      let retryAfterMs = 0;
      await waitForSlot(this.options.model, this.options.requestsPerMinute ?? 15);
      const started = Date.now();
      try {
        const res = await doFetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
            "x-title": "ContractorSight",
          },
          body: JSON.stringify(body),
        });
        status = res.status;
        retryAfterMs = Number(res.headers.get("retry-after") ?? 0) * 1000;
        const data = (await res.json()) as WireResponse;
        if (res.ok && !data.error) return { data, ms: Date.now() - started };
        if (status !== 429 && status < 500) throw new NonRetryableError(`OpenRouter ${status}: ${data.error?.message ?? res.statusText}`);
        if (attempt >= maxRetries) throw new Error(`OpenRouter ${status}: ${data.error?.message ?? res.statusText}`);
      } catch (error) {
        if (error instanceof NonRetryableError || attempt >= maxRetries) throw error;
      }
      // Rate limits clear on a per-minute window; back off long enough to actually get through.
      const backoff = status === 429 ? Math.max(retryAfterMs, 10_000 * 2 ** attempt) : 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(backoff, 120_000)));
    }
  }
}

class NonRetryableError extends Error {}

/** Spaces out requests per model across every client instance in this process. */
const nextSlot = new Map<string, number>();
async function waitForSlot(model: string, requestsPerMinute: number) {
  const interval = 60_000 / requestsPerMinute;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(model) ?? 0);
  nextSlot.set(model, slot + interval);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}
