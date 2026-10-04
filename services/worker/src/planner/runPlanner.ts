import {
  TOOLS,
  computeBaseJobVersions,
  getTool,
  toLlmToolSchemas,
  validateChangeSet,
  type ChangeSetDraft,
  type ValidationIssue,
  type ValidationRepository,
} from "@contractorsight/shared";
import type { ChatMessage, ChatModel, LookupExecutor, ToolSpec, Usage } from "./types";

export interface PlannerInput {
  model: ChatModel;
  lookups: LookupExecutor;
  repository: ValidationRepository;
  orgId: string;
  captureId: string;
  system: string;
  captureMessage: string;
  /** Model turns allowed per attempt (lookups + staging). */
  maxTurns?: number;
  /** Extra attempts after validation fails. */
  maxRepairs?: number;
}

export interface PlannerResult {
  draft: ChangeSetDraft;
  /** Issues from the final validation; empty when the draft is valid. */
  issues: ValidationIssue[];
  /** Whether the first attempt validated without needing a repair. */
  validFirstTry: boolean;
  repairsUsed: number;
  turns: number;
  usage: Usage;
  transcript: ChatMessage[];
  finalText: string | null;
  /** Set when the loop stopped for a reason other than the model finishing. */
  stoppedEarly?: "max_turns";
}

const TOOL_SPECS: ToolSpec[] = toLlmToolSchemas().map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema }));
const LOOKUP_NAMES = new Set<string>(TOOLS.filter((t) => t.kind === "lookup").map((t) => t.name));

const addUsage = (a: Usage, b: Usage): Usage => ({
  costUsd: a.costUsd + b.costUsd,
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});
const ZERO: Usage = { costUsd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

/**
 * The LLM step of the capture pipeline. The model runs lookups (executed immediately, read-only)
 * and stages changes (collected, never written). Each staged call is schema-checked on the spot
 * so the model can fix it in the same turn; the full set is then validated, and on failure the
 * model gets the issues and one more attempt to restage everything.
 */
export async function runPlanner(input: PlannerInput): Promise<PlannerResult> {
  const maxTurns = input.maxTurns ?? 8;
  const maxRepairs = input.maxRepairs ?? 1;
  const messages: ChatMessage[] = [{ role: "user", content: input.captureMessage }];
  let usage = ZERO;
  let turns = 0;
  let finalText: string | null = null;
  let validFirstTry = false;

  for (let attempt = 0; ; attempt++) {
    const staged: { tool: string; args: unknown }[] = [];
    let finished = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await input.model.complete({ system: input.system, messages, tools: TOOL_SPECS });
      usage = addUsage(usage, response.usage);
      turns++;
      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
      if (!response.toolCalls.length) {
        finalText = response.text;
        finished = true;
        break;
      }
      for (const call of response.toolCalls) {
        messages.push({ role: "tool", toolCallId: call.id, content: await handleToolCall(call.name, call.arguments, staged, input) });
      }
    }

    const draft: ChangeSetDraft = {
      captureId: input.captureId,
      baseJobVersions: await computeBaseJobVersions(staged, input.repository),
      operations: staged,
    };
    const result = draft.operations.length
      ? await validateChangeSet(draft, { orgId: input.orgId, repository: input.repository })
      : ({ ok: true } as const);
    const issues = result.ok ? [] : result.issues;
    if (attempt === 0) validFirstTry = issues.length === 0 && finished;

    if (!issues.length || attempt >= maxRepairs) {
      return {
        draft,
        issues,
        validFirstTry,
        repairsUsed: attempt,
        turns,
        usage,
        transcript: messages,
        finalText,
        ...(finished ? {} : { stoppedEarly: "max_turns" as const }),
      };
    }

    messages.push({
      role: "user",
      content: `Those changes failed validation, so none were kept:\n${issues
        .map((i) => `- operation ${i.opIndex ?? "-"} ${i.path.length ? `(${i.path.join(".")})` : ""}: [${i.code}] ${i.message}`)
        .join("\n")}\nStage the complete corrected set of changes again from scratch (or flag_ambiguity if you can't).`,
    });
  }
}

async function handleToolCall(
  name: string,
  rawArgs: string,
  staged: { tool: string; args: unknown }[],
  input: PlannerInput,
): Promise<string> {
  const tool = getTool(name);
  if (!tool) return JSON.stringify({ error: `Unknown tool ${name}.` });

  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "Arguments were not valid JSON. Call the tool again." });
  }

  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    return JSON.stringify({
      error: "Invalid arguments; nothing was staged. Fix and call again.",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  if (LOOKUP_NAMES.has(name)) {
    const results =
      name === "find_client"
        ? await input.lookups.findClients(input.orgId, parsed.data as never)
        : await input.lookups.findJobs(input.orgId, parsed.data as never);
    return JSON.stringify({ results });
  }

  staged.push({ tool: name, args });
  return JSON.stringify({ status: "staged", operation: staged.length - 1 });
}
