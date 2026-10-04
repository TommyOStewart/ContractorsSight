# ContractorSight architecture

ContractorSight turns what a trade contractor says, scribbles, or types into structured job records. A plumber records a voice note in a crawlspace, photographs a handwritten parts list, or types "Henderson accepted, start Tuesday". An LLM reads that capture and **proposes** changes. The contractor reviews them as a diff and approves before anything is saved.

This document covers how the repo is laid out, how data flows, and the rules that are not up for negotiation. Read the "Core rules" section before changing anything in `packages/shared` or `supabase/migrations`.

## Repo layout

```
apps/mobile/          Expo (React Native) app, Expo Router. Sign-in and company setup so far; will hold on-device SQLite for offline use.
services/worker/      Node service that runs the capture pipeline. The only place LLM / speech-to-text keys live.
packages/shared/      Domain types, LLM tool definitions, and the validation layer. Used by both of the above.
supabase/migrations/  Postgres schema, row-level security, storage bucket.
```

pnpm workspaces, with `nodeLinker: hoisted` (set in `pnpm-workspace.yaml`) because Expo's tooling expects a flat `node_modules`. Internal packages are consumed as TypeScript source, so there is no build step between them.

## Data flow

```
 phone                         worker (service role)                           phone
 ─────                         ─────────────────────                           ─────
 Capture ──upload──▶ captures ──▶ text extraction ──▶ LLM planner ──▶ validate ──▶ change_sets (pending) ──▶ review diff
 (audio | image | text)          (STT / OCR, stubbed)  (tool calls,     │                                       │
                                                         stubbed)       └─ issues fed back for repair (TODO)    ▼
                                                                                                   approve ──▶ commit RPC (TODO)
                                                                                                               re-validate, resolve temp IDs,
                                                                                                               apply ops, write audit_events
```

1. **Capture.** Voice, image, and typed text are all a single `Capture` (`captures.type` = `audio | image | text`). Source files go to the private `captures` storage bucket under `<org_id>/…` and are linked through `attachments.capture_id`. There is one pipeline, not three.
2. **Text extraction.** The worker turns the capture into text: speech-to-text for audio, OCR/vision for images, passthrough for text. These sit behind the `SpeechToText` and `ImageTextExtractor` interfaces in `services/worker/src/pipeline/ports.ts`. Only stubs exist today.
3. **Planning.** The LLM gets the text, the org glossary (`glossary_terms`, e.g. "SB" = SharkBite fitting), and the tool definitions. It can call lookup tools (`find_client`, `find_job`), which the worker executes immediately. Every other tool call is collected into a `ChangeSetDraft`. This sits behind `ChangeSetPlanner` and is also a stub for now.
4. **Validation.** `validateChangeSet` in `packages/shared` (details below).
5. **Review.** The draft is stored in `change_sets` with status `pending`, along with any validation issues. The phone shows it as a diff.
6. **Commit** (not built yet). Approval goes through a security-definer RPC that re-validates, checks job versions under lock, resolves temp IDs, applies the operations in one transaction, and writes `audit_events`.

## Core rules

These are architectural invariants. If a change seems to need one of them broken, raise it first.

### 1. The LLM never writes to the database

The LLM only emits tool calls. Tool calls become a staged `ChangeSet`. Nothing is committed until a human approves it. This is enforced structurally, not by convention:

- The worker's pipeline (`processCapture`) has no write path to domain tables. Its only output is `ChangeSetStore.savePending`.
- `change_sets` has no insert or update policy for app users, so approval can only happen through the commit RPC.
- Even `draft_supply_order` creates only a draft. Sending an order to a supplier is a separate human action.

### 2. Every tool call is validated

`validateChangeSet(draft, { orgId, repository })` runs four phases. It stops after the first phase that reports issues, because later phases assume the earlier ones passed.

| Phase | Checks | Example codes |
|---|---|---|
| Schema | Envelope shape. The tool exists and is stageable (lookups are not). Args parse against the tool's Zod schema, and unknown keys are rejected. | `UNKNOWN_TOOL`, `NOT_STAGEABLE`, `INVALID_ARGS` |
| References | Temp IDs are declared once and before use, with the right entity type. Real IDs exist **and belong to the capture's org**. | `TEMP_ID_USED_BEFORE_CREATION`, `UNKNOWN_ID`, `CROSS_ORG_REFERENCE` |
| Concurrency | Every existing job touched (directly, or through its materials or quotes) is still at the version recorded in `baseJobVersions`. | `STALE_VERSION`, `MISSING_BASE_VERSION` |
| Business rules | The job state machine, plus per-tool rules applied in order against a projected state. | `ILLEGAL_STATUS_TRANSITION`, `JOB_CLOSED`, `WRONG_PARENT`, `STALE_QUOTE` |

Some details that matter:

- **The org comes from the authenticated capture**, never from the ChangeSet payload. The worker uses the service role, which bypasses RLS, so the validator is what keeps one org's LLM output from touching another org's rows.
- **The repository must not filter by org.** `ValidationRepository.getEntities` returns records from any org so the validator can tell "doesn't exist" apart from "not yours". The two produce the same message text, so nothing user-facing reveals that another org's record exists. The different codes are for logs.
- **Rules are checked in sequence.** `schedule_job` followed by `request_status_change → in_progress` is valid in one capture, because each operation is checked against the state the earlier ones produced (`Projection` in `businessRules.ts`).
- **`BUSINESS_RULES` is a complete record keyed by tool name.** Adding a staged tool without deciding its rules is a compile error.
- The validator tests against `InMemoryRepository` (`@contractorsight/shared/testing`), so no database is needed.

### 3. One capture type, one pipeline

Audio, image, and text differ only at the text-extraction step. Everything after that is shared. Don't add a type-specific path downstream of `captureText()`.

### 4. Every committed change writes an AuditEvent

`audit_events` records actor, source, entity, action, before/after, and the `change_set_id` and `capture_id` that carried the change.

- `source` is `manual | voice | image | text | system`. `text` means a typed capture that went through the LLM. `manual` means a direct edit in the app with no LLM involved. Map capture type to source with `AUDIT_SOURCE_BY_CAPTURE_TYPE`.
- A check constraint requires capture-derived events (`voice`, `image`, `text`) to reference their ChangeSet and capture.
- The table is append-only. A trigger rejects update and delete for every role, including the service role. App users can insert only `manual` events attributed to themselves.

### 5. Tool definitions have one source of truth

Each tool is defined once with Zod in `packages/shared/src/tools/definitions.ts`. Everything else is derived from it:

| Derived artifact | How |
|---|---|
| TypeScript types | `ToolArgs<"create_job">`, `StagedOperation` (inferred) |
| JSON Schema for the LLM | `toLlmToolSchemas()` → `z.toJSONSchema`; `pnpm export:tool-schemas` writes `packages/shared/generated/tools.json` |
| Runtime validation | `tool.input.safeParse` in the schema phase |
| Which fields are IDs, and of which entity | ID fields are built with `entityRef`, `existingRef`, or `tempIdDecl`, which tag the schema in `idFieldRegistry`. The validator and `resolveTempIds` walk the schema to find them. No per-tool list of ID fields exists, so none can drift. |

Don't hand-write JSON Schema, and don't add a parallel list of a tool's fields anywhere. `generated/` is gitignored; regenerate it, never edit it.

## Temp IDs

A single capture often creates things and then refers to them: "new client Jeb Henderson, water heater job at 12 Elm, needs a 50 gal heater." Create tools take an optional `tempId` (`$c1`, `$j1`, `$m1`…). Later operations can use it anywhere an `entityRef` is accepted.

- **Validation:** each temp ID is declared at most once, used only after the operation that declares it, and as the right entity type. Fields built with `existingRef` (e.g. `remove_material.materialId`, `revise_quote.basedOnQuoteId`) reject temp IDs at the schema level.
- **Commit:** `resolveTempIds(changeSet)` assigns a real UUID to each declaration and rewrites every reference. The map is stored in `change_sets.temp_id_map`.

## Optimistic concurrency

Time passes between the worker reading a job and the contractor tapping Approve. Meanwhile someone may have edited the job on another phone.

- `jobs.version` starts at 1 and is incremented by trigger on every job update. It is also bumped when the job's `material_items` or `quotes` change. Callers cannot set it.
- A ChangeSet records `baseJobVersions: { [jobId]: version }` for every existing job it touches. Validation rejects it if any version moved, or if a touched job is missing from the map.
- The validation-time check is advisory. The commit RPC must repeat it with the job rows locked (`select … for update`) inside the commit transaction.
- Quotes have a parallel check: `revise_quote.basedOnQuoteId` must be the latest version (`STALE_QUOTE`).

## Job status state machine

```
lead → quoted → accepted → scheduled → in_progress → completed → invoiced → paid
  │       │         │           │             │
  ├───────┴─▶ declined          │             │
  └───────┴─────────┴───────────┴─────────────┴─▶ cancelled
```

- Defined once in TypeScript as `JOB_STATUS_TRANSITIONS` (`packages/shared/src/domain/jobStateMachine.ts`). It is mirrored in the `job_status_transitions` table and enforced by a trigger on `jobs`, so manual edits from the app can't bypass it either. `test/migrationParity.test.ts` fails if the two copies drift apart. The same test covers every enum.
- `paid`, `declined`, and `cancelled` are closed: they accept notes only.
- Entering `scheduled` requires a start time. `schedule_job` moves `accepted → scheduled`, and reschedules a job that is already `scheduled`.
- Entering `quoted` requires that the job has a quote.

## Database conventions

- Tables are plural snake_case. TypeScript is camelCase, and the repository layer maps between the two.
- Every domain row has `org_id`. Child tables reference parents through **composite foreign keys** `(parent_id, org_id)`, so the database itself refuses a job whose client is in another org. `jobs` also has `(site_id, client_id) → sites`, so a job's site always belongs to its client.
- Money is stored as `bigint` cents (`*_cents`). Tools take dollars, because that's how people talk. Convert only with `dollarsToCents`.
- `material_items` are per-job lines (needed, ordered, purchased, installed, returned), not a price book. Removal is a soft delete through `removed_at`.
- Quotes are versioned per job (`unique (job_id, version)`). A revision inserts a new row; old versions are history.
- `org_members` lets one user belong to several orgs with a role (`owner`, `admin`, `member`). `profiles` holds app-level user data; identity lives in `auth.users`.
- Search indexes: trigram GIN on `clients.name` and `jobs.title`; btree on `jobs (org_id, status)`, `(org_id, job_type)`, `client_id`. `job_type` is stored lowercased.
- `supply_houses.api_config` holds only non-secret settings. Supplier credentials will go in Supabase Vault.

### Row-level security

The RLS helper functions (`is_org_member`, `has_org_role`) are `security definer` with an empty `search_path`, and policies call them wrapped in `(select …)` so Postgres evaluates them once per statement.

| Tables | App users (authenticated) |
|---|---|
| Domain tables (clients, jobs, materials, quotes, …) | Full CRUD within their orgs |
| `captures` | Read; create their own |
| `change_sets` | Read only. Approval goes through the commit RPC. |
| `audit_events` | Read; insert `manual` events as themselves; never update or delete |
| `organizations`, `org_members` | Read their own; owners and admins manage |

## Mobile app

- Routes live in `apps/mobile/src/app` (Expo Router). The root layout picks one of three route groups with `Stack.Protected`: signed out → `sign-in`; signed in with no company → `create-company`; otherwise → `(app)`.
- `SessionProvider` (`src/auth`) owns the Supabase session and the user's company memberships.
- The app talks to Supabase directly with the **publishable** key and relies on RLS. It never holds a secret key and never calls an LLM. Config comes from `apps/mobile/.env` (see `.env.example`).
- Sessions persist in AsyncStorage. Moving to encrypted storage (expo-secure-store) is a follow-up.
- Companies are created through the `create_organization` RPC, which makes the caller the owner in the same transaction. There is deliberately no insert policy on `organizations`.
- Typed queries: `pnpm db:types` regenerates `packages/shared/src/db/database.types.ts` from the local database. Run it after every migration.

## Not built yet (intentionally)

- UI beyond sign-in, company setup, and a placeholder home screen.
- Real speech-to-text, OCR, and LLM calls. Stubs are in `services/worker/src/pipeline/stubs.ts`.
- The commit RPC (approve → apply ops → audit), and inviting teammates to a company.
- The validate → LLM repair loop.
- Offline sync between on-device SQLite and Supabase.
- Supplier integrations (email/API order sending).

## Working on this repo

```bash
pnpm install
pnpm test                    # all unit tests (no database needed)
pnpm typecheck
pnpm export:tool-schemas     # writes packages/shared/generated/tools.json
pnpm db:start                # local Supabase (needs Docker)
pnpm db:reset                # re-apply all migrations from scratch
pnpm --filter @contractorsight/worker start   # run the stubbed pipeline once
```

**Adding a tool:**

1. Define it in `definitions.ts` and add it to `TOOLS`.
2. Add its entry in `BUSINESS_RULES`. The compiler will remind you.
3. Add tests.
4. Re-export the schemas.

**Changing an enum or the state machine:** change the TypeScript and add a migration in the same commit. The parity test will tell you if you missed one.
