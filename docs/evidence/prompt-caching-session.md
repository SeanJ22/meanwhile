# Prompt caching and the Batch API across every Anthropic call site — session evidence

<!-- FILL:STATUS -->

Session of 2026-09-06 (America/Phoenix), branch `claude/anthropic-caching-batch-api-b5afb0`, based on `main` at `251c43d0`. Every number below is read off a real API response, a persisted control-plane record or a test run named beside it. Nothing in this session fetched from a public body; every verification Attempt was served from artifacts already in the evidence vault.

## In reader terms

Nothing a reader sees changes. The product's answers are built from the same records with the same instructions; what changed is how much the company pays the model provider to read the same text twice. The date sentence the Grounded Ask synthesis used to carry at the top of its instructions now rides beside the reader's question, word for word, so the instructions can be reused from the provider's cache across a midnight. Promotion stays OFF; no Scout finding reaches a reader through this work.

## 0. What the owner's diagnosis turned out to be

The owner's diagnosis — a breakpoint on the system prompt that never moves, every turn re-sending the growing conversation at full price — is **confirmed for the 23 Scout Attempts of 2026-09-02 and falsified for the code that has run since**.

- The 23 Attempts of 2026-09-02 ran before RULING 244's four-breakpoint executor landed that day (commit `bbae5906`). Their persisted usage shows the signature exactly: each Attempt's cache reads equal **4,082 tokens × its later turns, to the token** (the tools + system prefix, read once per turn and never more), while the uncached remainder is the whole conversation: 4,426,004 uncached tokens, 869,466 read, 73,476 written across the 23. At list prices that is about $22.13 of uncached input, and it is the bill the owner saw.
- Every instrumented Attempt since (2026-09-04, 2026-09-06) shows the healthy loop: uncached input of **2 tokens per turn**, reads growing turn over turn, writes equal to what the turn appended. The digest's 18.6% was an unwindowed average over both eras, and its detector — "a later turn with zero reads" — could not see the stationary shape because the static prefix *was* read every turn.
- One residual defect was measured on the current code and left in place by the brief's own rule: the bound turn's forced `tool_choice: finish` invalidates the messages cache, so that turn reads only the 4,586-token static prefix and re-writes the conversation (16,874 / 24,082 / 24,369 tokens in the three measured bound turns, roughly $0.10–0.15 each). The brief forbids changing tool-choice configuration; the cost is stated in §10 for the owner.

## 1. Discovery — the population, never the example (PC-1)

**Population:** every file a commit would contain (`filesThatWouldBeCommitted()` in `lib/ops/repo-files.ts` = tracked plus untracked-not-ignored), searched with `git grep -a -i -E` over the tracked tree at `251c43d0` (the untracked files at the time were this session's own). **Search terms:** `api.anthropic.com`, `@anthropic-ai/sdk`, `anthropic`, `messages.create`, `x-api-key`, `anthropic-version`, `ANTHROPIC_API_KEY`, `WTP_WORKERS_ANTHROPIC_API_KEY`, `cache_control`, `/v1/messages`, `/v1/messages/batches`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`, `AttemptCost`, `max_tokens`, `fetch(`. Term hit counts (files): `api.anthropic.com` 20, `@anthropic-ai/sdk` 2 (docs only — **the SDK is not installed; every call site is raw `fetch`**), `x-api-key` 9, `anthropic-version` 9, `cache_control` 18, `/v1/messages` 0 as a bare literal (the endpoint is always spelled with its host).

**N = 10 places send a request to the Anthropic API: 8 Messages API call sites and 2 credential proofs against `/v1/models`.** A wrapper is a call site; its users are listed under it.

| # | File and line | Lane | Model | Shape | Reader-facing | Streaming | Thinking / effort | `cache_control` before → after | Per-request values and where they sit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `lib/control-plane/scheduler/scout-executor.ts` — `anthropicTransport` (the `fetch` at the transport), request built in `scoutExecutor` | Scout (SCOUT role). Users: `scripts/freshness-shadow.mts:1153` (the runner, through `fleetSafety.guardedModelTransport`), `scripts/autonomous-fleet-scout-proof.mts:55`, `lib/control-plane/workers/standing-runtime.ts` | `claude-opus-5` (`SCOUT_MODEL`) | multi-turn tool loop, up to 18 turns | no | no | no `thinking` field (adaptive by default on Opus 5); `output_config.effort: medium` (`ROLE_EFFORT.SCOUT`) | tools-last + system + brief + moving last-block marker (4 explicit) → tools-last + system + **top-level `cache_control`** (3) | obligation id, subject, route, reason, prior-rung stamps: all in the brief (`messages[0]`), after the static prefix; the Attempt id appears nowhere in the prompt; `tool_choice` flips to forced `finish` at the bound |
| 2 | `lib/control-plane/workers/model-audit.ts` — `modelAuditReasoner` (request) through `boundedAuditTransport` → site 1's transport. Users: `scripts/freshness-shadow.mts:1322`, `scripts/worker-fleet-proof.mts`, `scripts/autonomous-fleet-advance-proof.mts` | Adversarial audit (ADVERSARIAL_AUDITOR) | `claude-opus-5` (the `adversarial-audit` route) | single request, forced `tool_choice: record_audit` | no | no | no `thinking` field; `output_config.effort` from the route | system block + `record_audit` tool definition (2 explicit) → unchanged | the evidence as canonical JSON in the one user message, after both markers |
| 3 | `lib/ask/synthesize.ts` — `synthesizeAnswer` (`fetch` at the Messages URL) | Grounded Ask synthesis; user `app/api/ask/grounded/route.ts` | `claude-opus-5` (`resolveAskModel()`) | single request, structured output | **yes** | no | `thinking: adaptive`; `effort: medium` (`resolveAskEffort()`) | one marker on the civic-context block → **system block marker + civic-context marker** | the reader's question and the date in the last two blocks of the first user message, after both markers; the date used to be in the system prompt |
| 4 | `lib/ask/interpret.ts` — `interpretQuestion`; user `app/api/ask/grounded/route.ts` | Ask interpretation | `claude-opus-5` | single request plus up to 4 prior turns as messages | **yes** | no | `thinking: adaptive`; `effort: low` | none → none (recorded; see §2) | date, reader's approximate location and the ZIP inventory in the system prompt; question and prior turns in messages |
| 5 | `lib/routing/classifier.ts` — `classifyQuestion`; user `app/api/ask/classify/route.ts` | Ask classify | `claude-opus-5` | single request, structured output | **yes** | no | `thinking: disabled`; `effort: low` | none → none (319 system tokens, under the 512 minimum) | the question is the message; the system prompt is static |
| 6 | `lib/routing/unsourced-fallback.ts` — `askUnsourced` (no production caller: nothing under `app/` imports it; reachable from tests) | Ask unsourced fallback (reader-facing by design) | `claude-opus-5` | single request | yes by design | no | `thinking: disabled`; `effort: low` | none → none (243 system tokens) | the question is the message |
| 7 | `lib/ask/model-comparison.ts` — `synthesizeForComparison`; user `scripts/ask-model-compare.mts` | the Ask model comparison harness (offline) | the arm's named model | single request per arm, deliberately uncached (`cached: false`) | no | no | as the production request | none, by design (comparability) → unchanged; **batch route added behind `WTP_ASK_COMPARE_BATCH`** | the pack and question in the user message |
| 8 | `scripts/model-worker-proof.mts:166` | the model-worker plumbing proof | `claude-opus-5` (`MODEL_WORKER_MODEL`) | single request, no system prompt | no | no | no `thinking`; `effort: low` | none → none (54-token prompt) | none: the body is a static literal |
| 9 | `scripts/rotation-proof.mts:139` | credential liveness | — | `GET /v1/models?limit=1` | no | — | — | not a Messages request | — |
| 10 | `scripts/credential-ledger.mts:550` | credential proof (plus a control with an invalid key) | — | `GET /v1/models?limit=5` | no | — | — | not a Messages request | — |

Matches that are not call sites: `scripts/url-sweep.mts:101` (a hostname allowlist entry), `scripts/ask-cache-probe.mts:224` and `scripts/ask-model-compare.mts:312` (POST to the local server's `/api/ask/grounded`, reaching site 3 through the route), `app/transparency/page.tsx` and `lib/ask/model-economics.ts` (prose and rate tables), `lib/tracker/registry.mjs` (predicates), the tracker CSVs and `docs/`.

## 2. Diagnosis before changing (PC-2)

### 2a. The multi-turn site (Scout), from the persisted results

`repos.scoutResults` holds 28 results; 5 carry per-turn steps (RULING 244 instrumentation). Read from the live control plane, read-only, at 2026-09-06T21:5xZ.

The 2026-09-02 era, 23 Attempts, aggregate per Attempt (uncached / read / write, turns):

| Attempt | turns | uncached | read | write | read ÷ 4,082 |
|---|---|---|---|---|---|
| at-da0399c9 | 9 | 125,269 | 32,656 | 4,082 | 8 = turns − 1 |
| at-c8a6c07d | 10 | 116,061 | 36,738 | 4,082 | 9 |
| at-9a7b5a20 | 6 | 156,996 | 24,492 | 0 | 6 |
| at-08dbaa86 | 14 | 123,675 | 57,148 | 0 | 14 |
| at-5112a607 | 14 | 270,281 | 57,148 | 0 | 14 |
| at-a45f746d | 8 | 107,443 | 32,656 | 0 | 8 |
| at-7d01b6b2 | 10 | 357,593 | 36,738 | 4,082 | 9 |
| at-2920a9f2 | 11 | 466,803 | 40,820 | 4,082 | 10 |
| (the other 15 of 2026-09-02) | 7–15 | 68,182–373,612 | 24,492–57,148 | 0 or 4,082 | turns − 1 or turns |

**Verdict for that code path: CONFIRMED.** The read is flat at the static prefix and the uncached remainder is the conversation. (Attempts whose write is 0 started while a concurrent Attempt had just written the shared prefix; the brief and conversation were never written by anyone.)

The instrumented Attempts on the current code (uncached / read / write per turn):

| Attempt | t1 | t2 | t3 | t4 | t5 | t6 | t7 | t8 | t9 |
|---|---|---|---|---|---|---|---|---|---|
| at-0f32a2f3 (2026-09-04, BOUND) | 2 / 0 / 5,428 | 2 / 5,428 / 1,018 | 2 / 6,446 / 171 | 2 / 6,617 / 6,138 | 2 / 12,755 / 1,013 | 2 / 13,768 / 2,753 | 2 / 16,521 / 3,626 | 2 / 20,147 / 348 | **16 / 4,586 / 20,510** (bound turn) |
| at-6ba0dac8 (2026-09-06, MODEL) | 2 / 0 / 8,804 | 2 / 8,804 / 7,852 | 2 / 16,656 / 812 | 2 / 17,468 / 3,376 | 2 / 20,844 / 1,586 | 2 / 22,430 / 906 | | | |

**Verdict for the current code: NOT CONFIRMED** — reads grow, the uncached remainder is two tokens, and the write is the appended turn. The one exception is the bound turn (turn 9 above): read collapses to the static prefix and the conversation is re-written.

### 2b. The multi-turn site, live, on the unchanged code

One real Attempt through the real `scoutExecutor` with every tool served from the evidence vault (`.scratch/scout-diagnose.mts`, label `before`, 2026-09-06; obligation "the Arizona Secretary of State's 2026 candidate-filing list", 5 vaulted URLs served, 0 refused). The cache-diagnostics beta was used on every request (`anthropic-beta: cache-diagnosis-2026-04-07`, `diagnostics.previous_message_id` chained); the installed repository has no SDK, so the header and field were sent by raw `fetch`, and no SDK was upgraded.

| turn | uncached | read | write (5m / 1h) | total prompt | stop | markers on the request | diagnostics |
|---|---|---|---|---|---|---|---|
| 1 | 2 | 0 | 4,978 (4,978 / 0) | 4,980 | tool_use | tools[5], system[0], messages[0].content[0] | null |
| 2 | 2 | 4,978 | 1,288 | 6,268 | tool_use | + messages[2].content[1] | null |
| 3 | 2 | 6,266 | 14,799 | 21,067 | tool_use | + messages[4].content[1] | null |
| 4 (bound: `tool_choice: finish`) | 16 | **4,586** | **24,369** | 28,971 | tool_use | + messages[7].content[0] | `{"cache_miss_reason":{"type":"unavailable"}}` |

Cost $0.3774 (4 calls). The diagnostics beta did not localize the bound-turn miss; the documented invalidation hierarchy does (a `tool_choice` change invalidates the messages cache and keeps tools and system).

### 2c. The single-request sites, each sent twice inside five minutes

`.scratch/single-request-probe.mts`, 2026-09-06, real requests through the repository's own modules; usage read off each response. All on `claude-opus-5`.

| site | call 1 uncached / read / write | call 2 uncached / read / write | reading |
|---|---|---|---|
| 4 interpret (40-name inventory) | 1,866 / 0 / 0 | 1,866 / 0 / 0 | nothing is marked; the prompt (1,866) is above the 512 minimum, so a marker at the end of the system prompt would cache per ZIP context — left unmarked, see §4b |
| 5 classify | 665 / 0 / 0 | 665 / 0 / 0 | unmarked; the system prompt alone is 319 tokens, under the 512 minimum |
| 6 unsourced fallback | 259 / 0 / 0 | 259 / 0 / 0 | unmarked; 243 system tokens, under the minimum |
| 3 Grounded Ask (after the change; same records, different question) | 84 / 0 / 4,003 | 90 / **4,003** / 0 | the second call read system + evidence (PC-5) |
| 3 Grounded Ask, third call with different records | 83 / **1,043** / 884 | | the system breakpoint alone hit; before this session that call would have read nothing |
| 2 adversarial audit | 1,297 / 0 / 966 | 1,297 / **966** / 0 | system + tool prefix hits; the 1,297 uncached tokens are the per-audit evidence |
| 8 model-worker proof | 54 / 0 / 0 | 54 / 0 / 0 | unmarked; 54 tokens, under the minimum |

Minimums used: `claude-opus-5` 512 tokens (every call site runs it; no other model was discovered).

Static prefix sizes counted at `/v1/messages/count_tokens` on 2026-09-06 (Opus 5): Scout tools + system 4,586 (system alone 1,397); interpret static instructions 406 (with a 240-name inventory 5,223); classify 319; unsourced fallback 243; Grounded Ask system 731 (it was 471 on 2026-09-01, before ASK-24).

## 3. The Scout lane before and after, on one real run (PC-4, PC-7)

`.scratch/scout-diagnose.mts`, label `prewarm-concurrency`, 2026-09-06: one pre-warm, then two Attempts started together (concurrency 2, the lane's bound), on the changed executor (top-level moving breakpoint), 4 vaulted URLs served, 0 refused.

| request | uncached | read | write (5m) | total prompt |
|---|---|---|---|---|
| pre-warm (`max_tokens: 0`) | 77 | 0 | **4,586** | 4,663 |
| A1 turn 1 | 2 | **4,586** | 392 (its brief) | 4,980 |
| A2 turn 1 | 2 | **4,586** | 392 (its brief) | 4,980 |
| A1 turn 2 | 2 | 4,978 | 1,310 | 6,290 |
| A2 turn 2 | 2 | 4,978 | 1,301 | 6,281 |
| A1 turn 3 | 2 | 6,288 | 180 | 6,470 |
| A2 turn 3 | 2 | 6,279 | 7,037 | 13,318 |
| A1 turn 4 (bound) | 16 | 4,586 | 16,874 | 21,476 |
| A2 turn 4 (bound) | 16 | 4,586 | 24,082 | 28,684 |

Ledger rows written by the executor for the two Attempts: A1 `inputTokens 39,216 · uncachedInputTokens 22 · cacheReadInputTokens 20,438 · cacheCreationInputTokens 18,756 (5m 18,756 / 1h 0) · batch false · usd 0.1917`; A2 `53,263 · 22 · 20,429 · 32,812 (32,812 / 0) · false · 0.2987`. Cost of the run $0.5195 over 9 calls.

Read against the brief's PC-7 condition: the pre-warm's `cache_creation_input_tokens` equals the prefix size (4,586); both Attempts' first turns wrote 0 for the prefix (their 392-token writes are their own briefs) and read ≥ 4,586. Against PC-4: on turns 2 and 3 of both Attempts, reads grow and `input_tokens` (2) is under what the turn appended plus the 512 minimum.

**Before vs after on the same shape:** the moving breakpoint was already effective on the current code (§2b turns 1–3 and §3 turns 1–3 are the same shape); the change moves it from a hand-managed last-block marker to the API's top-level marker with identical measured behaviour, and the pre-warm removes the double write of the 4,586-token prefix when two Attempts start together (each would have written it; now each reads it). Against the 2026-09-02 era — the bill — the arithmetic is: the 23 Attempts paid $22.13 for 4,426,004 uncached tokens; with a moving breakpoint the same conversations cost their reads (about 4.4M tokens at $0.50/MTok ≈ $2.2) plus writes of what each turn appended (roughly the final prompt of each Attempt, on the order of 0.7M tokens at $6.25/MTok ≈ $4.3): about $6.5 against $23.0 with the writes and reads of that era added in. The dollar effect line in the digest is the exact form of this for every window going forward.

## 4. The changes, each made once at the shared path

Fix reach is stated as "reached / of N = 8 Messages call sites"; the two `/v1/models` proofs carry no prompt and are outside every fix.

- **4a ordering and byte-stability (8 of 8).** `tests/prompt-prefix-stability.test.ts` builds each site's request twice from identical inputs and asserts the prefix hash is identical and that the per-request values sit after it: Scout (tools + system identical across Attempts; the Attempt id, obligation id and timestamps absent from them; the executor sends exactly the bytes `scoutStaticPrefix` builds), the audit (tools + system identical; the evidence differs per audit; `auditReasoningContext` is canonical JSON), Grounded Ask (system + evidence identical across questions and across days; the question and the date after both markers), interpret (system identical for the same ZIP context; question and conversation in messages), classify and fallback (static system), the proof (a static literal with no interpolation, asserted on the script's source). Every JSON block that lands in a prompt is serialized with a fixed key order (`pick()` in `synthesize.ts`, `canonicalJson` in the audit); nothing upstream of a prefix reads a clock or a random value. The one date that sat in a system prompt (Grounded Ask) moved into the first user message. The interpret prompt still carries `Today is …` in its system prompt: recorded, not changed (§4b).
- **4b breakpoints (5 of 8 marked; 3 recorded unmarked).** Scout: explicit markers on the last tool definition and the system block, plus the top-level `cache_control` as the moving breakpoint — accepted by the API (HTTP 200, `cache_creation_input_tokens: 75` on a placeholder, `cache_read_input_tokens: 4,586`), so no per-turn marker is hand-managed; `SCOUT_CACHE_POLICY.movingBreakpoint = "LAST_BLOCK"` is the recorded fallback for a platform that rejects the field. The provider's four-slot ceiling is checked before sending (`cacheTtlOrderProblems`). Audit: unchanged (system + tool markers, both measured to hit). Grounded Ask: system-block marker (731 tokens ≥ 512) plus the civic-context marker. Classify (319), fallback (243) and the proof (54) are under the 512 minimum and stay unmarked with their counts recorded; padding classify to the minimum would add ~200 tokens per request to cache ~320 — it cannot pay for itself at any request rate. Interpret: the static instructions are 406 tokens (under the minimum) and the ZIP inventory block that would clear it sits in a file the Reader closure receipt binds outside the renewable boundary (`readerSourceImpact`, `lib/holdings/reader-census.ts`); a marker there would cost the V94 `--revalidate-source` renewal with browser observations. Left unmarked, measured (1,866 tokens per request at a 40-name inventory), and raised in §10.
- **4c TTL: 5 minutes, measured (PC-6).** Consecutive Scout ledger rows of consecutive cycles on 2026-09-02: 76.2, 75.9, 76.2, 76.2, 76.2, 73.7 minutes apart (08:52:45Z → 10:08:37Z → 11:24:46Z → 12:40:55Z → 13:57:09Z → 15:10:52Z, from `repos.costs`); the runner's cycle records of 2026-09-06 start 69.9–72.3 minutes apart (median 71.7; `data/health/freshness-shadow-runs/2026-09-06-01..13.json`, `startedAt`). Both exceed five minutes AND sixty, so a 1-hour entry written by one cycle expires before the next cycle can read it; the 2× write price would buy no cross-cycle read. Every breakpoint stays at 5 minutes. The API's ordering rule for a 1h marker (measured: HTTP 400, `system.0.cache_control.ttl: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block. Note that blocks are processed in the following order: tools, system, messages.`) is enforced before sending by `cacheTtlOrderProblems` and asserted in `tests/scout-prewarm.test.ts`.
- **4d pre-warm (1 of 8 applicable).** `scoutPrewarmRequest` builds the Attempts' exact static prefix (`scoutStaticPrefix`, the same function the executor uses) with `max_tokens: 0`, `tool_choice: auto`, the same effort, the placeholder `warmup` unmarked. The cycle sends it once, lazily, before the first admitted Scout, and every admitted Scout awaits it (`shadow-loop.ts`, `prewarm`; `tests/scout-prewarm.test.ts` proves once-per-cycle, before-first-dispatch, never-when-nothing-admitted, and that a failed pre-warm is recorded while the Attempts run). Its cost is a SCOUT ledger row under `routeId scout:prewarm`, so the rolling ceiling sees it and capacity never counts it as an Attempt. The audit site is `NOT_APPLICABLE — API_CONFIGURATION_INCOMPATIBLE`: its forced `tool_choice: record_audit` is refused with `max_tokens: 0` (measured 2026-09-06: HTTP 400, `tool_choice: type "tool" or "any" cannot be used when max_tokens is 0`). The single-request sites have no per-cycle shared prefix to warm.
- **4e batch (1 of 8 routed; 7 declined or prohibited).** §5.
- **4f the ledger (every writer, 8 of 8 lanes that write a cost).** §6.
- **4g the instruments.** §6.
- **4h prompt content unchanged.** No instruction, refusal rule or evidence format changed. The Grounded Ask date sentence moved, word for word, from the system prompt to the first user message. Tests that pinned the request shape and were updated, by name: `tests/scout-lane.test.ts` test 14 (the four explicit markers → tools-last, system and the top-level marker; the stationary shape added), `tests/research-metrics.test.ts` "cache hit rate by role" (the ledger signature), `tests/ask-model-comparison.test.ts` "the comparison request is the production request with the model named and no cache marker" (the production system field is now one marked block; the text is compared byte for byte), `tests/ask-prompt-cache.test.ts` "the system prompt is one string with every rule, and its size is pinned" (2,347 → 2,325 characters; the date left) and its test double (a system array). No test asserting model output or reader-visible behaviour failed.

## 5. The batch routing decision, per call site (PC-8)

| site | decision | reason |
|---|---|---|
| 1 Scout | declined, synchronous | every turn depends on the previous response; per turn a batch would have to complete inside the Attempt's wall clock, `RESEARCH_BOUNDS.perDispatch.maxWallMs` = 300,000 ms, and the cycle's `maxWallMsPerCycle`; the Batches API guarantees completion only within 24 hours (most within an hour), so a turn routed to a batch projects a violation of the 5-minute Attempt bound on the first turn. Budgets unchanged. Turns per measured Attempt: 9, 10, 6, 14, 14, 8, 10, 10, 10, 11, 12, 11, 11, 8, 14, 15, 10, 8, 10, 12, 11, 7, 9, 6 (24 Attempts with turns; 4 aborted before a turn); **0 of them finished in one turn, so 0% of Scout token volume is single-request.** |
| 2 audit | declined, synchronous | independent of any earlier model response, but bounded by `AUDIT_REVIEW_TIMEOUT_MS` = 60,000 ms written into `model-audit.ts`; a batch cannot be completed inside it. |
| 3, 4, 5, 6 reader-facing Ask | **prohibited** | a person is waiting; `tests/model-batch.test.ts` asserts nothing under `app/` and none of these four modules reaches the batch module or the batches endpoint. |
| 7 comparison harness | **routed behind `WTP_ASK_COMPARE_BATCH`** (default OFF) | offline, independent requests, nobody waiting. The same request body goes through `runSingleRequestBatch` (`lib/control-plane/model-batch.ts`: submit, poll, read the JSON Lines results, key by `custom_id`); the outcome says `batch: true`; `callUsd` halves once. `tests/model-batch.test.ts` proves the request shape (`POST /v1/messages/batches` with `{requests:[{custom_id, params}]}` and the Messages headers), the flag default, the results parsing, and that the seam never touches the synchronous endpoint under the flag. |
| 8 proof | declined | the script proves the synchronous plumbing reaches the provider; a batch submission proves a different thing, and its 54-token prompt is under every cache minimum. |
| 9, 10 | not a Messages request | — |

RULING 277: the batch code is merged inert; switching `WTP_ASK_COMPARE_BATCH` on is the owner's decision, reported here and not made.

## 6. The ledger and the instruments (PC-9, PC-10, PC-11, PC-12)

**The ledger** (`AttemptCost`, `lib/control-plane/attempt.ts`) gained `cacheReadInputTokens`, `cacheCreationInputTokens` (the aggregate), `cacheCreation5mInputTokens`, `cacheCreation1hInputTokens`, `uncachedInputTokens` and `batch`. The ledger is JSON in append-only logs (`cp_log_costs.record jsonb` in Postgres, the same shape in the file and memory providers), so no DDL migration was needed and none was made; `BOOTSTRAP_VERSION` is untouched at 8. `cacheMeteringOf` (`cost.ts`) is the parser: a row without the keys is `PREDATES_FIELDS`, a row with null values is `UNREPORTED`, and only a `MEASURED` row contributes tokens. Every writer populates the fields from the response through one parser, `readMeteredUsage` (`model-cost.ts`): the Scout executor (summed over turns; a refusal before any completion is a measured zero), the audit reasoner (`metering` on its result, carried by `workers/runtime.ts`), the proof script, and the pre-warm. Old rows read back as UNMEASURED: at 2026-09-06T22:37Z the live ledger held 1,408 rows and all of them predate the fields; the digest prints `NOT MEASURED — N ledger row(s), N predate the cache fields` for them, never 0%.

**Pricing** (`priceMeteredUsage`): uncached input at $5/MTok, 5-minute writes at $6.25, 1-hour writes at $10, reads at $0.50, output at $25 (Opus 5), then × 0.5 once when `batch` is true. The aggregate contributes nothing on top of its split; a response carrying the aggregate and no split is priced at the requested TTL's write price and the result says `cacheWritePricedFrom: "AGGREGATE"` (the Scout step and the digest count such rows). `tests/model-cost-metered.test.ts`: a known usage (1M uncached, 200k 5m writes, 100k 1h writes, 2M reads, 100k output) prices to $10.75; batched to $5.375; an aggregate ten times the split changes nothing; the older entry points (`usdForModelUsage`, `callUsd`) now delegate to the same function.

**The two instruments now read one ledger.** The digest's RESEARCH METRICS section (18.6%) had been computed from the Scout results' own usage block — a parallel store of the same per-Attempt quantities, unwindowed — while the COST section printed NOT MEASURED. `cacheHitRateByRole` now takes the cost ledger and a window (the ceiling's trailing 24 hours for the metrics; the cycle's own span for the COST section, `research.cacheThisCycle` on the run record) and prints per model role: the hit rate as `read / (read + write + uncached)` with the three counts, uncached input per Attempt (mean and max), the batch share of requests, the dollar effect as read tokens × (base − read price), and the denominators (measured rows; rows predating the fields; rows the provider left unreported). The per-turn columns still come from the Scout results' steps — the only per-turn record — matched by Attempt id; the results' usage block is no longer read for a rate.

**The detector** (`lib/control-plane/cache-defects.ts`): for turn N > 1, `uncached(N) > (total(N) − total(N−1)) + 512` is the stationary-breakpoint signature; `read(N) === 0` is the zero-read signature; both are counted apart with the denominator (`cache defects D of I instrumented result(s) (stationary S; zero reads Z)`). `tests/cache-defects.test.ts` replays the recorded healthy sequence (at-6ba0dac8, no defect), the 2026-09-02 stationary shape (fires on every later turn while the zero-read check stays silent), a cold turn (zero-read only), and the bound turn's rewrite (neither signature: a write, priced in the write column).

**One real digest run** — the digest's own functions over the live ledger and results, read-only, at 2026-09-06T22:37:38Z (`.scratch/render-digest.mts`; no cycle started, nothing written):

```
## RESEARCH METRICS (trailing 24h window)
- capacity           79 Attempt(s)/day at the $25 ceiling · mean $0.3139/Attempt over measured SCOUT cost-ledger entries in the trailing 24h window (1 measured, 0 unmeasured)
- cache hit rate     ADVERSARIAL_AUDITOR NOT MEASURED — 1 ledger row(s), 1 predate the cache fields; a row written before the fields existed says nothing about its cache behaviour
- cache hit rate     SCOUT NOT MEASURED — 1 ledger row(s), 1 predate the cache fields; a row written before the fields existed says nothing about its cache behaviour
- cache defects      0 of 5 instrumented result(s) recorded a cache defect (stationary breakpoint 0; zero reads 0)
- cost per outcome   ROUTE_CANDIDATE $2.3175 (12) · EVIDENCE_FOUND $3.9729 (7) · CONFIRMED UNMEASURED (0) · GRADUATED_ROUTE UNMEASURED (0)

## RESEARCH METRICS (every ledger row ever — the population the old 18.6% was computed over)
- cache hit rate     ADVERSARIAL_AUDITOR NOT MEASURED — 7 ledger row(s), 7 predate the cache fields …
- cache hit rate     SCOUT NOT MEASURED — 28 ledger row(s), 28 predate the cache fields …

## COST section for the runner's last cycle (2026-09-06-13.json, 21:27:25Z → 21:38:15Z)
- TOTAL — 0.0000 over 0 measured Attempt(s) of 0 dispatched
- BY ROLE — every Attempt this cycle opened under role ACQUIRER (deterministic); no SCOUT Attempt ran this cycle
- CACHE HIT RATE — no model request left a cost-ledger row this cycle
- PRE-WARM — none: no Scout was admitted this cycle, so nothing was warmed
```

(The first render also listed the deterministic roles ACQUIRER, PARSER, VALIDATOR as NOT MEASURED; a lane that never makes a model request has no missing measurement, so the rows are restricted to the roles that invoke a model.) The runner picks the new lines up on its next cycle after the merge reaches the main checkout; the first cycle that dispatches a Scout under the new code prints the measured rows. `tests/pilot-cost-digest.test.ts` renders the section over a record carrying measured rows, a lane predating the fields, a pre-warm, and the three older shapes.

## 7. Acceptance ledger

| Row | Claim | Status | Proof |
|---|---|---|---|
| PC-1 | Every Anthropic call site is enumerated | MET | §1: N = 10, 10 rows, terms and population named |
| PC-2 | Stationary breakpoint confirmed or falsified per multi-turn site | MET | §2a–2b: CONFIRMED for the 2026-09-02 code path, NOT CONFIRMED for the current code; per-turn rows for both; the bound-turn residual named |
| PC-3 | Prefix byte-stable and correctly ordered on every site | MET | `tests/prompt-prefix-stability.test.ts` (8 sites; hashes compared; per-request values located) |
| PC-4 | The moving breakpoint works on every multi-turn site | MET | §3: post-change turns read the growing prefix; `input_tokens` = 2 ≤ appended + 512 |
| PC-5 | Grounded Ask hits on repeat | MET | §2c: second call read 4,003 ≥ system (731) + evidence; a different-records call read the 1,043-token system prefix |
| PC-6 | TTL decision measured | MET | §4c: gaps and their sources; 5m chosen; the 1h-before-5m rule asserted by `tests/scout-prewarm.test.ts` against the API's message |
| PC-7 | Pre-warm removes the double write | MET for the Scout; NOT_APPLICABLE — API_CONFIGURATION_INCOMPATIBLE for the audit | §3 (pre-warm 4,586 written; both first turns read 4,586 and wrote 392 each); §4d (the API's refusal of `max_tokens: 0` with a forced tool choice) |
| PC-8 | Batch integrated, flagged, inert | MET | §5; `tests/model-batch.test.ts` (default off, request shape, reader-facing prohibition asserted); 1 routed, 3 declined with reasons, 4 prohibited |
| PC-9 | Ledger records cache and batch fields on every new row | MET | §6; the type diff (`attempt.ts`); real rows in §3 with all six fields; `tests/model-cost-metered.test.ts` reads old rows back as PREDATES_FIELDS; `tests/scout-lane.test.ts` reads the six fields back from the ledger after a dispatch |
| PC-10 | Pricing correct, no double-count | MET | `tests/model-cost-metered.test.ts` |
| PC-11 | Digest reports the new lines, denominators stated | MET | §6 (the render); `tests/pilot-cost-digest.test.ts`; `tests/research-metrics.test.ts` |
| PC-12 | New detector fires on the defect shape and not on the healthy shape | MET | `tests/cache-defects.test.ts` (recorded sequences); `tests/scout-lane.test.ts` test 14 (through the executor) |
| PC-13 | No regression from this session's own changes | <!-- FILL:PC13 --> | |
| PC-14 | Verification spend stated | MET | §8 |

## 8. Verification spend (PC-14)

Every request this session sent to the API, at Opus 5 list prices computed from the responses' own usage blocks:

| run | calls billed | usd |
|---|---|---|
| API probe (count_tokens ×10 free; pre-warm ×2; top-level acceptance; two planted TTL orders refused free) | 3 | 0.0345 |
| Scout diagnosis, unchanged code (`before`) | 4 | 0.3774 |
| Scout pre-warm + two concurrent Attempts, changed code | 9 | 0.5195 |
| single-request sites, twice each | 13 | 0.1498 |
| **total** | **29** | **1.0812** |

The rolling research ceiling ($25 / 24 h) read $0.4394 in the window at 21:38Z before this session's requests (run record 2026-09-06-13, `research.state.spend`). This session's Attempts ran through in-memory repositories and wrote no row into the shared append-only ledger (a session's proof runs are not a runner cycle, and the production control plane is not a test fixture), so the ceiling's reading is unchanged by them; the organization dashboard counts the $1.08 regardless. <!-- FILL:CEILING_AFTER -->

## 9. Pre-existing failures and conditions, not this session's

- `lib/control-plane/shadow/pima-run.ts:86` — an unused `endAttempt` import (ESLint warning, present before this session; its allowlisted count is unchanged).
- The runner dispatched **0 Scouts in every cycle of 2026-09-04 and 2026-09-06**: each model-class row was deferred `BUDGET` ("the cycle's dispatch budget was spent … before this item was reached"; 2,333 deferred in cycle 13). The lane is starved by the deterministic drain, not idle; nothing in this session changes scheduler budgets.
- Three Scout Attempts of 2026-09-04 (at-08ac386b, at-60aba2fe, at-becbfe04) ended with 0 turns and null costs — a transport failure before any usage, recorded as UNMEASURED by the ledger of that day.
- `tests/mirror-workbook-guard.test.ts` fails on this machine whenever the Drive workbook is out of sync (skips on CI); reported if it shows in the gate run.
- This session's own cosmetic defect, kept: commit `4649b4bb`'s subject begins with a UTF-8 byte-order mark (`EF BB BF`) because its message file was written by PowerShell's `Set-Content -Encoding utf8`. It was not amended: the Reader receipt renewal ran at that head and binds it, and rewriting the commit would orphan the proof head.
- <!-- FILL:PREEXISTING -->

## 10. For the owner, and one sentence per lane on model choice (no change made)

- **The bound turn's forced `tool_choice`** costs a full re-write of the conversation on every BOUND-stopped Attempt (9 of the 23 on 2026-09-02 stopped that way; 16,874–24,369 tokens re-written in the three measured cases, ≈ $0.10–0.15 each). `tool_choice: auto` with the same BOUND REACHED instruction would keep the cache; the brief forbids changing tool-choice configuration, so it is left as measured.
- **Batch activation** (`WTP_ASK_COMPARE_BATCH`) is integrated inert; switching it on is the owner's decision (RULING 277).
- **Interpret's ZIP inventory** (1,866 tokens per request at a 40-name inventory, 5,223 with 240 names) would cache per ZIP context with one marker at the end of its system prompt and the date moved into the first user message; the file is bound by the Reader closure receipt outside the renewable boundary and needs the V94 `--revalidate-source` renewal. At pilot traffic the saving is cents; at reader traffic it is the largest unmarked prefix left.
- **The Scout lane is not running** (BUDGET deferrals, §9); the pre-warm and the new digest lines take effect on the first cycle that admits a Scout.
- Model sentences (measured token profiles; the model string on every site is exactly what it was): **Scout** — per 4-turn Attempt ≈ 22 uncached, 20k read, 19–33k written, 2.5–3.3k output; the cost is dominated by cache writes of tool results, which no model choice changes, and route discovery is the frontier-class step RULING 244 reserves, so the profile makes no cheaper-model case. **Audit** — 1,297 uncached evidence + 966 cached prefix + 533–841 output per review; the profile would survive `claude-sonnet-5` at 40% of the price if the adversarial standard did, which RULING 244 assigns to the frontier. **Grounded Ask** — 731 system + ~3.3k evidence cached, ~90 uncached, 222–379 output; RULING 234's measured revert to Opus 5 stands and the profile changes nothing about it. **Interpret, classify, fallback** — 259–1,866 uncached tokens per call with small outputs; the cheapest-class candidates by profile, and each is a reader-facing rung whose standard the Ask corpus measures, not this session.

## 11. Git

<!-- FILL:GIT -->

## Appendix A — the request shapes the API accepted or refused, verbatim

- Pre-warm, Scout static prefix, `max_tokens: 0`, `tool_choice: auto`: HTTP 200, `{"input_tokens":77,"cache_creation_input_tokens":4586,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":4586,"ephemeral_1h_input_tokens":0},"output_tokens":0}`; sent again inside five minutes: `cache_read_input_tokens: 4586`.
- The same with `tool_choice: {"type":"tool","name":"finish"}`: HTTP 400, `tool_choice: type "tool" or "any" cannot be used when max_tokens is 0`.
- Top-level `cache_control: {"type":"ephemeral"}` beside the explicit system marker: HTTP 200, `cache_read_input_tokens: 4586, cache_creation_input_tokens: 75`.
- A 1h marker on the system block after a 5m marker on the last tool: HTTP 400, `system.0.cache_control.ttl: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block. Note that blocks are processed in the following order: tools, system, messages.`
