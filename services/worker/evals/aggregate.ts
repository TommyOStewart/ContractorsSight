/**
 * Combines several eval runs (e.g. repeats of the same models) into per-model reliability numbers.
 *
 *   pnpm --filter @contractorsight/worker eval:aggregate -- --last 3
 *   pnpm --filter @contractorsight/worker eval:aggregate -- results/<dir1> results/<dir2>
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

interface RunRecord {
  model: string;
  caseId: string;
  pass: boolean;
  error?: string;
  validFirstTry: boolean;
  costUsd: number;
  modelMs: number;
  turns: number;
  failedChecks: string[];
  validationIssues: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({ options: { last: { type: "string" } }, allowPositionals: true });

const resultsRoot = resolve(here, "results");
const dirs = positionals.length
  ? positionals.map((p) => resolve(here, p))
  : readdirSync(resultsRoot)
      .sort()
      .slice(-Number(values.last ?? 3))
      .map((d) => resolve(resultsRoot, d));

const records: RunRecord[] = dirs.flatMap((d) => JSON.parse(readFileSync(resolve(d, "results.json"), "utf8")).records);
const models = [...new Set(records.map((r) => r.model))];
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`${dirs.length} runs, ${records.length} capture attempts\n`);
console.log("| Model | Pass rate | Valid first try | Errors | Avg $/capture | Avg model time | Avg turns | Cases ever failed |");
console.log("|---|---|---|---|---|---|---|---|");
for (const model of models) {
  const rs = records.filter((r) => r.model === model);
  const ok = rs.filter((r) => !r.error);
  const failedCases = [...new Set(rs.filter((r) => !r.pass).map((r) => r.caseId))].sort();
  console.log(
    `| ${model} | ${rs.filter((r) => r.pass).length}/${rs.length} (${((100 * rs.filter((r) => r.pass).length) / rs.length).toFixed(1)}%) | ` +
      `${((100 * ok.filter((r) => r.validFirstTry).length) / Math.max(1, ok.length)).toFixed(0)}% | ${rs.length - ok.length} | ` +
      `${(100 * avg(ok.map((r) => r.costUsd))).toFixed(2)}¢ | ${(avg(ok.map((r) => r.modelMs)) / 1000).toFixed(1)}s | ${avg(ok.map((r) => r.turns)).toFixed(1)} | ${failedCases.length} |`,
  );
}

console.log("\n## Failures by case\n");
for (const model of models) {
  const failures = records.filter((r) => r.model === model && !r.pass);
  if (!failures.length) continue;
  console.log(`### ${model}`);
  const byCase = new Map<string, RunRecord[]>();
  for (const f of failures) byCase.set(f.caseId, [...(byCase.get(f.caseId) ?? []), f]);
  for (const [caseId, fs] of [...byCase].sort()) {
    const attempts = records.filter((r) => r.model === model && r.caseId === caseId).length;
    const reasons = [...new Set(fs.flatMap((f) => (f.error ? [`error: ${f.error.slice(0, 80)}`] : [...f.failedChecks, ...f.validationIssues])))];
    console.log(`- ${caseId}: failed ${fs.length}/${attempts}: ${reasons.join("; ").slice(0, 300)}`);
  }
  console.log("");
}
