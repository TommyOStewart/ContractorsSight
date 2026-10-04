/**
 * Planner bake-off: runs every eval case against each model through OpenRouter, grades the
 * staged operations, and writes results.json (with transcripts) and summary.md.
 *
 *   pnpm --filter @contractorsight/worker eval -- --budget 10
 *   pnpm --filter @contractorsight/worker eval -- --models openai/gpt-6-luna --cases 01,02 --budget 0.5
 *
 * Spends real money. --budget is a hard stop on cumulative cost (USD) reported by OpenRouter.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { OpenRouterChatModel, type ReasoningEffort } from "../src/planner/openRouter";
import { buildCaptureMessage, buildSystemPrompt } from "../src/planner/prompt";
import { runPlanner, type PlannerResult } from "../src/planner/runPlanner";
import { CASES, type EvalCase, type Op } from "./cases";
import { evalLookups, evalRepository, ORG_ID, promptContext } from "./world";

const DEFAULT_MODELS = [
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-6.1-sol",
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-6-luna",
];
const CAPTURES_PER_MONTH = 220;

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    cases: { type: "string" },
    budget: { type: "string" },
    effort: { type: "string", default: "medium" },
    concurrency: { type: "string", default: "4" },
  },
});

if (!values.budget) throw new Error("--budget <usd> is required: this spends real money.");
const budget = Number(values.budget);
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set (services/worker/.env).");

const models = values.models ? values.models.split(",") : DEFAULT_MODELS;
const cases = values.cases ? CASES.filter((c) => values.cases!.split(",").some((p) => c.id.startsWith(p))) : CASES;
const effort = values.effort as ReasoningEffort;
const system = buildSystemPrompt(promptContext);

interface RunRecord {
  model: string;
  caseId: string;
  pass: boolean;
  failedChecks: string[];
  validationIssues: string[];
  validFirstTry: boolean;
  repairsUsed: number;
  turns: number;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  operations: Op[];
  finalText: string | null;
  error?: string;
  transcript?: PlannerResult["transcript"];
}

let spent = 0;
let stoppedForBudget = false;

async function runOne(model: string, testCase: EvalCase): Promise<RunRecord | null> {
  if (spent >= budget) {
    stoppedForBudget = true;
    return null;
  }
  const started = Date.now();
  const base = { model, caseId: testCase.id };
  try {
    const result = await runPlanner({
      model: new OpenRouterChatModel({ apiKey: apiKey!, model, effort }),
      lookups: evalLookups,
      repository: evalRepository(),
      orgId: ORG_ID,
      captureId: "00000000-0000-4000-8000-0000000000cc",
      system,
      captureMessage: buildCaptureMessage({ text: testCase.text, captureType: testCase.captureType, targetJob: testCase.targetJob }),
    });
    spent += result.usage.costUsd;
    const ops = result.draft.operations as Op[];
    const failedChecks = testCase.checks.filter((c) => !c.test(ops)).map((c) => c.describe);
    const validationIssues = result.issues.map((i) => `op ${i.opIndex}: [${i.code}] ${i.message}`);
    if (result.stoppedEarly) validationIssues.push(`stopped early: ${result.stoppedEarly}`);
    return {
      ...base,
      pass: failedChecks.length === 0 && validationIssues.length === 0,
      failedChecks,
      validationIssues,
      validFirstTry: result.validFirstTry,
      repairsUsed: result.repairsUsed,
      turns: result.turns,
      latencyMs: Date.now() - started,
      ...result.usage,
      operations: ops,
      finalText: result.finalText,
      transcript: result.transcript,
    };
  } catch (error) {
    return {
      ...base,
      pass: false,
      failedChecks: [],
      validationIssues: [],
      validFirstTry: false,
      repairsUsed: 0,
      turns: 0,
      latencyMs: Date.now() - started,
      costUsd: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      operations: [],
      finalText: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

const records: RunRecord[] = [];
const jobs = models.flatMap((model) => cases.map((c) => ({ model, c })));
console.log(`Running ${cases.length} cases × ${models.length} models (effort ${effort}), budget $${budget.toFixed(2)}`);

await pool(jobs, Number(values.concurrency), async ({ model, c }) => {
  const record = await runOne(model, c);
  if (!record) return;
  records.push(record);
  const mark = record.error ? "ERR " : record.pass ? "pass" : "FAIL";
  console.log(`${mark}  ${model.padEnd(30)} ${c.id.padEnd(28)} $${record.costUsd.toFixed(4)}  ${(record.latencyMs / 1000).toFixed(1)}s  total $${spent.toFixed(2)}`);
});

// --- report -----------------------------------------------------------------

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

const rows = models.map((model) => {
  const rs = records.filter((r) => r.model === model);
  const ok = rs.filter((r) => !r.error);
  return {
    model,
    passed: rs.filter((r) => r.pass).length,
    total: rs.length,
    validFirstTry: ok.filter((r) => r.validFirstTry).length,
    errors: rs.filter((r) => r.error).length,
    costPerCapture: avg(ok.map((r) => r.costUsd)),
    latency: avg(ok.map((r) => r.latencyMs)) / 1000,
    turns: avg(ok.map((r) => r.turns)),
    cacheShare: ok.reduce((a, r) => a + r.cachedInputTokens, 0) / Math.max(1, ok.reduce((a, r) => a + r.inputTokens, 0)),
  };
});

const lines: string[] = [];
lines.push(`# Planner eval: ${new Date().toISOString()}`, "");
lines.push(`${cases.length} cases, reasoning effort \`${effort}\`, total spend **$${spent.toFixed(2)}**${stoppedForBudget ? " (stopped at budget)" : ""}.`, "");
lines.push("| Model | Passed | Valid first try | Errors | $/capture | $/month (220) | Avg latency | Avg turns | Cached input |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const r of [...rows].sort((a, b) => b.passed - a.passed || a.costPerCapture - b.costPerCapture)) {
  lines.push(
    `| ${r.model} | ${r.passed}/${r.total} (${pct(r.passed, r.total)}) | ${pct(r.validFirstTry, r.total - r.errors)} | ${r.errors} | $${r.costPerCapture.toFixed(4)} | $${(r.costPerCapture * CAPTURES_PER_MONTH).toFixed(2)} | ${r.latency.toFixed(1)}s | ${r.turns.toFixed(1)} | ${Math.round(r.cacheShare * 100)}% |`,
  );
}
lines.push("", "## Failures", "");
for (const model of models) {
  const failed = records.filter((r) => r.model === model && !r.pass).sort((a, b) => a.caseId.localeCompare(b.caseId));
  if (!failed.length) continue;
  lines.push(`### ${model}`, "");
  for (const r of failed) {
    const why = r.error ? [`error: ${r.error}`] : [...r.failedChecks.map((c) => `missed: ${c}`), ...r.validationIssues.map((i) => `invalid: ${i}`)];
    lines.push(`- **${r.caseId}**: ${why.join("; ")}`);
    if (!r.error) lines.push(`  - staged: ${r.operations.map((o) => o.tool).join(", ") || "(nothing)"}`);
  }
  lines.push("");
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "results", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "results.json"), JSON.stringify({ models, cases: cases.map((c) => c.id), effort, spent, records }, null, 2));
writeFileSync(resolve(outDir, "summary.md"), lines.join("\n"));
console.log(`\n${lines.join("\n")}\n\nWrote ${outDir}`);
