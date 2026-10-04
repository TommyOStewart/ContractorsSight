# Planner eval results

Run with `pnpm --filter @contractorsight/worker eval -- --budget <usd>`. Raw transcripts land in
`evals/results/` (gitignored). Record notable runs here.

## 2026-10-04: first bake-off (25 cases, effort `medium`, via OpenRouter)

Total spend for the run: **$1.08**.

| Model | Passed | Valid first try | $/capture | $/user/month (220 captures) |
|---|---|---|---|---|
| openai/gpt-6-luna | 25/25 | 92% (2 repaired) | $0.0006 | $0.13 |
| openai/gpt-6.1-sol | 25/25 | 92% (2 repaired) | $0.0074 | $1.64 |
| google/gemini-3.8-flash | 25/25 | 96% (1 repaired) | $0.0097 | $2.14 |
| anthropic/claude-sonnet-5.5 | 25/25 | 100% | $0.0161 | $3.55 |
| anthropic/claude-haiku-4.5 | 24/25 | 96% | $0.0094 | $2.07 |

**Latency:** this run's latency numbers were dominated by client-side pacing for OpenRouter's
new-account limit (20 requests/minute/model), so they're omitted. The unpaced trial run measured
5–10 s per capture at about 3 model calls. The runner now records model time separately (`modelMs`).

### What we learned

- **This case set doesn't separate the models.** Every model handled every case, including the
  two-Jebs ambiguity, a quote revision from the latest version, invoiced→paid in order, a closed job
  needing a new one, Spanish, and a prompt-injection attempt. Real captures will be messier, so
  the next step is harder cases, not a model decision from this run alone.
- **The repair loop matters for cheap models.** The cheaper models needed it on 1–2 cases each; the
  validator turned would-be failures into passes at the cost of an extra model call.
- **Graded checks miss "valid but sloppy."** gpt-6-luna put the new client's address on both the
  client and the job in case 20, which would create a duplicate site. It passed every check.
  Add checks for duplicates and unrequested extras.
- **Schema style is provider-specific.** OpenAI models fill every optional field with placeholders
  unless optional fields are nullable; `schemaStyle.ts` handles that. Without it, they failed
  case 04.
- **Costs came in below estimates** (Sonnet 1.6¢ vs ~4¢ estimated) because prompt caching held
  across captures.

### Next

1. Add ~15 harder cases: long rambling notes with several jobs, self-corrections ("no wait, three"),
   relative dates ("next Tuesday"), noisy OCR, conflicting details. Add sloppiness checks.
2. Pre-search candidates in code and put them in the prompt, then re-run to measure the
   reduction in turns, cost, and latency.
3. Re-run with the new cases; decide on a primary model plus a validation-gated escalation.
