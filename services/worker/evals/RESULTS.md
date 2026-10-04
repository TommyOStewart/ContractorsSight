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

## 2026-10-04: 40 cases, with and without pre-search

Cases 26–40 added (self-corrections, relative times, a rambling three-job note, noisy OCR, an
unknown person, an existing site, a 10% discount…), plus a duplicate-site check. Spend: $1.86
(pre-search off) + $1.75 (on) + $0.27 (re-runs after fixes).

### Pre-search off vs on (same 40 cases, before the fixes below)

| Model | Passed off → on | Turns off → on | $/capture off → on | Model time off → on |
|---|---|---|---|---|
| openai/gpt-6-luna | 36 → 37 | 4.1 → 2.6 | 0.06¢ → 0.05¢ | 8.7s → 7.1s |
| openai/gpt-6.1-sol | 36 → 37 | 3.5 → 2.5 | 0.74¢ → 0.66¢ | 9.1s → 7.2s |
| google/gemini-3.8-flash | 39 → 38 | 3.5 → 2.5 | 1.22¢ → 1.41¢ | 20.4s → 25.6s |
| anthropic/claude-sonnet-5.5 | 38 → 37 | 3.0 → 2.1 | 1.68¢ → 1.39¢ | 5.9s → 5.4s |
| anthropic/claude-haiku-4.5 | 33 → 35 | 3.5 → 2.0 | 0.94¢ → 0.86¢ | 6.5s → 8.2s |

Pre-search cut about one model call per capture for every model. Savings were smaller than
estimated (−10 to −17% cost; Gemini went up), because the repeated prefix was already cheap
thanks to caching, and the candidate list adds uncached tokens. Accuracy was unchanged within
run-to-run noise. Keep it for the fewer round trips, and because the model sees ambiguous
matches (two Jebs) side by side.

### Fixes from this run

- **Duplicate sites were a tool-design flaw, not a model one.** Every model put a new client's
  address on both create_client and create_job. Fixed with tool guidance, a validation rule
  (repairable), and a default: a job with no site goes on the client's only site. All five models
  pass 04 and 20 afterwards.
- **Case 36's check was wrong.** Flagging the missing cement/primer quantities is correct per the
  instructions. The check now accepts it.

### Corrected standings (pre-search on)

| Model | Passed | Real misses |
|---|---|---|
| openai/gpt-6-luna | 40/40 | none in this run; earlier runs: asked AM/PM for "tomorrow at 2", one repair left an invalid flag |
| openai/gpt-6.1-sol | 40/40 | none |
| google/gemini-3.8-flash | 40/40 | none, but 20–25 s model time |
| anthropic/claude-sonnet-5.5 | 39/40 | rambling note: left the rental toilet job in progress instead of completed |
| anthropic/claude-haiku-4.5 | 37/40 | dropped the PRV, missed parts of the rambling note, no note for "call Maria back"; earlier asked questions in plain text |

**Single runs are noisy:** luna passed 27 in one run and failed it in another. Separating
40/40 from 39/40 needs repeated runs.

## 2026-10-04: repeatability (3 runs × 40 cases, pre-search on)

Spend: $2.40. Aggregated with `pnpm eval:aggregate`.

| Model | Pass rate | Valid first try | Avg $/capture | Avg model time | Avg turns |
|---|---|---|---|---|---|
| anthropic/claude-sonnet-5.5 | 120/120 (100%) | 100% | 1.44¢ | 5.3s | 2.2 |
| openai/gpt-6.1-sol | 119/120 (99.2%) | 92% | 0.51¢ | 7.2s | 2.5 |
| openai/gpt-6-luna | 118/120 (98.3%) | 90% | 0.04¢ | 6.7s | 2.5 |

Misses were occasional, not systematic: luna once each on "tomorrow at 2" and the rambling note;
gpt-6.1-sol once on the returning-spigot case. All three are accurate enough for this case set.
Sonnet never needed the repair loop, which is why it's also the fastest per capture.
