# Model routing trace — what the production path enforces (2026-09-25)

Requirement: MW-033 (cheapest suitable model first; move up only for a recorded
reason; reuse before research), with MW-031 (record the reason and the combined
cost of both attempts) and MW-035 (expensive steps are selective).

Branch `claude/ac-cheaper-first`, from `main` at `70313b36`. File and line
references are to that branch.

**Labels used below.**

- **OFFLINE-VERIFIED** — proved by a test that runs with a fake transport and a
  fake toolkit. No model, host or database is reached.
- **PRODUCTION** — observed in production use. **Nothing in this trace is
  labelled PRODUCTION.** Paid research has been paused by the owner since
  2026-09-22 at 1:06 PM Arizona time (MST). That time comes from the assignment
  brief and was not re-read: this session touched no production store.
- **CODE** — read from the code path, with no separate test.

## 1. Ordinary code first: steps that can never reach a model

| What | Where | Status |
|---|---|---|
| The step registry is closed. `page-to-representation`, `permission-reading` and `date-parsing` are `DETERMINISTIC` and name the code that does them | `lib/control-plane/scheduler/model-routing.ts:101`, `:107`, `:113` | CODE |
| `assertStepMayInvokeModel` throws for a deterministic or unknown step before any transport call | `model-routing.ts:194` | OFFLINE-VERIFIED (`tests/scout-lane.test.ts` test 15; `tests/scout-model-ladder.test.ts` L7) |
| An escalation of a deterministic step throws the same way | `model-routing.ts:275` (`assertStepMayEscalate` calls `assertStepMayInvokeModel` first) | OFFLINE-VERIFIED (L7) |
| A route the executor decision marks DETERMINISTIC (graduated or declared) never sends a request: `SCOUT_GRADUATED_ROUTE`, measured zero cost, no escalation | `lib/control-plane/scheduler/scout-executor.ts:1051`; decision rule `lib/control-plane/scheduler/dispatch.ts:165` | OFFLINE-VERIFIED (`scout-lane` tests 1 and 13) |
| Only two roles can reach a paid model: SCOUT and ADVERSARIAL_AUDITOR. Every other role declares the plain-code lane | `lib/control-plane/cost-panel.ts:510`; `lib/control-plane/workers/runtime.ts:99` | OFFLINE-VERIFIED (`tests/cost-section-adm-c14.test.ts`, which rebuilds the table from the files) |

## 2. Reuse before research

| What | Where | Status |
|---|---|---|
| Free walk first: a meetings-discovery row reaches a paid Scout only after the unpaid walk read the site and found nothing, or when there is no site to walk (`FREE_WALK_FIRST`) | `scripts/freshness-shadow.mts:2180` → `lib/control-plane/scheduler/providers/meetings-discovery.ts:134` | CODE |
| Field manual inheritance: each Scout brief starts with the doors earlier walks found, projected to its jurisdiction. The IDs are recorded on the result (`inheritedFieldManualEntryIds`) | `scripts/freshness-shadow.mts:1701`; autonomous path `lib/control-plane/workers/standing-runtime.ts:77` | CODE (the delivery was checked earlier; see the memory note "scout field-manual delivery verified") |
| Resume, don't restart: the last two Scout results, their rungs and named next rungs lead the brief | `scripts/freshness-shadow.mts:1639`, `:1671`, `:1714`; `scout-executor.ts:363` | OFFLINE-VERIFIED (`scout-lane` tests 5 and 17) |
| No re-read, no re-walk: a URL already vaulted this Attempt, or a rung recorded as durably failed, is refused before it runs | `scout-executor.ts:1072` | OFFLINE-VERIFIED (`scout-lane` tests 17 and 18) |
| **Escalation reuses the cheaper attempt's work.** The frontier continues the same conversation, with every rung, artifact and representation. It shares the no-re-read set, the tool-call bound and the per-host bound, so a second attempt never means more requests to a publisher | `scout-executor.ts:1472`–`:1519` | OFFLINE-VERIFIED (L3: the frontier's first request contains the Sonnet attempt's tool results, and its accepted finish cites an artifact the Sonnet attempt stored) |

## 3. Cheapest suitable class first, for each paid step

| Step | Class it starts on | Why | Where | Status |
|---|---|---|---|---|
| Scout research loop | **Sonnet 5** (`claude-sonnet-5`), then the frontier on a recorded reason | Cheapest class that accepts this request. Sonnet 5 accepts the effort setting, tool use and long context. Haiku 4.5 rejects `output_config.effort` and has a 200K context limit | registry `model-routing.ts:91`; one start answer for the executor and pre-warm `scout-executor.ts:906`; first attempt `:1426`; request model `:1140`–`:1160` | OFFLINE-VERIFIED (L1, L2; `scout-lane` tests 8, 15, 19) |
| Scout cache pre-warm | The loop's start model (Sonnet 5) | Warms the entry the loop reads first. It never warms a model an Attempt might escalate to | `scout-executor.ts:786`; `scripts/freshness-shadow.mts:1956` | OFFLINE-VERIFIED (L6: pre-warm tools, system, effort and model match the loop's first request byte-for-byte) |
| Adversarial audit | Frontier (`claude-opus-5-5`), no cheaper class and no escalation | MW-035 allows an expensive step when it is selective. This one runs once per record that the parser and validator already passed on its way to promotion. It exists to find what cheaper passes missed | `model-routing.ts:150`; `lib/control-plane/workers/model-audit.ts:228`–`:237` | OFFLINE-VERIFIED (L7: frontier, `escalationTargetFor` is null, escalation throws) |
| extraction / classification / summarization | Haiku → Sonnet / Sonnet → frontier | Registry entries only | `model-routing.ts:119`, `:127`, `:135` | CODE: **no production caller exists**, so no production call reaches these steps |

`SCOUT_MODEL`, which the research state records as the lane's model, is now the
loop's start model: `lib/control-plane/scheduler/research-policy.ts` (end of file).

## 4. The escalation rule

- **Four recorded reasons.** A step moves up only for one of four reasons, each
  observed on the cheaper attempt by the executor and never taken from the model's
  words: `BOUND_EXHAUSTED_WITHOUT_RESULT`, `RESULT_REFUSED`, `NO_TYPED_RESULT` and
  `CAPABILITY_ERROR` (HTTP 400 on the cheaper model). They are defined at
  `model-routing.ts:220` and classified at `scout-executor.ts:1390`.
  OFFLINE-VERIFIED: L3 tests each reason.
- **What does not escalate.** A provider overload, a network fault or a ceiling
  refusal is not the model's failure, so it never escalates (`:1392`–`:1396`).
  Neither does an accepted result, including an argued NO_PROGRESS.
  OFFLINE-VERIFIED: L2 and L4, where an HTTP 529 does not escalate.
- **Checks before every frontier call.** Each call runs `assertStepMayEscalate(step, reason)` first
  (`scout-executor.ts:1510`). It refuses a reason outside the list, a step already
  at the top of its ladder, and a target above the ceiling.
  OFFLINE-VERIFIED: L7.
- **Reserve first.** The frontier attempt's worst case is held before its first
  request, against the same rolling 24-hour inequality every request uses:
  `scoutAttemptWorstCaseUsd` (`scout-executor.ts:508`), then
  `FleetSafetyController.holdModelBudget` (`lib/control-plane/fleet-safety.ts:769`)
  through `scoutEscalationReservation` (`:800`). It is wired to both production
  Scout paths: `scripts/freshness-shadow.mts:1996` and `:2487` →
  `standing-runtime.ts:62`. As each frontier turn is priced, its cost is drawn from
  the hold (`scout-executor.ts:1190`). The rest is released when the attempt ends,
  so the hold and the spend are never counted twice.
  OFFLINE-VERIFIED: L5 uses the real controller. At a $5 ceiling the escalation is
  refused before any frontier request and is deferred by name. At a $100 ceiling it
  runs, and afterward no hold remains.
- **Refusals are recorded.** A refused escalation records `escalationRefused`
  with one of four codes: `CEILING`, `WALL_CLOCK`, `UNMEASURED_SPEND` or
  `NOT_RESERVED`. It also appends `SCOUT_ESCALATION_REFUSED` to the result's refusal
  list, after the root cause (`scout-executor.ts:1447`–`:1454`, `:1631`). With no
  seam wired, every escalation is refused `NOT_RESERVED`, so the default fails
  closed. OFFLINE-VERIFIED: L5.
- **What is recorded.** Each result records `modelClass`, `modelClassWhy`,
  `escalatedFrom`, `escalationReason`, `escalationEvidence` (300 characters or
  fewer, machine-written) and `escalationRefused`. It also records
  `modelAttempts[]`, with each attempt's class, model, turns, cost at its own rate
  and whether it was accepted. `usd` is the combined cost of all attempts
  (`lib/control-plane/scheduler/scout-result.ts`, `ScoutResult` and
  `ScoutModelAttempt`). OFFLINE-VERIFIED: L3 checks each attempt's cost against its
  model's rate and checks that `usd` equals their sum.
- **Admin reads the record.** `app/(admin)/_mw/data/spend-store.ts` reads the
  start class, escalation counts and the six latest escalations.
  `lib/control-plane/admin-view/model-ladder-view.ts` turns them into owner words.
  Fleet · Money shows one line, for example "Escalations recorded: 0 (paid research
  paused since Sep 22)." OFFLINE-VERIFIED: `tests/model-ladder-view.test.ts`. The
  SQL runs only against the control plane and was **not** run in this session.
- **Model escalation is separate from owner escalation.** It is kept apart from the
  owner `Escalation` in `work-item.ts`. No count mixes the two.

## 5. The ceiling: Opus is the maximum, and Fable is refused

- `MODEL_CEILING` is `claude-opus-5-5` (`model-routing.ts:307`). `modelCeilingViolation`
  (`:328`) refuses any model named Fable, any unrated model, and any model priced above
  Opus 5.5.
- The module-load guard from PR #345 is `assertModelClassesWithinCeiling()` at `:362`.
  A routing edit that breaches the ceiling fails at import.
- `assertStepMayEscalate` re-checks the ceiling at call time (`:275`).

OFFLINE-VERIFIED: `tests/model-ceiling.test.ts` (positive controls) and L7.

## 6. Prompt-cache placement

- Breakpoints appear in render order (`SCOUT_CACHE_POLICY`, `model-routing.ts:430`):
  - the last tool definition (`scout-executor.ts:656`);
  - the system block (`:669`);
  - the top-level moving breakpoint (`:1160`), with message blocks sent bare (`:558`).
- `cacheTtlOrderProblems` (`:690`) refuses an unlawful TTL order before sending.
  OFFLINE-VERIFIED: L1 checks the Sonnet request bodies. L3 checks the frontier
  requests after escalation.
- **Minimum cacheable prefix.** The minimum is looked up for each model
  (`lib/control-plane/model-cost.ts`, `MODEL_CACHE_MINIMUMS`): Opus 5.5 512,
  Sonnet 5 1024, Haiku 4.5 4096 tokens.
  - The pre-warm is sent only when a lower bound on the prefix size clears the
    start model's minimum. The bound is the prefix's bytes divided by 4
    (`PREFIX_BYTES_PER_TOKEN_CEILING`, `scout-executor.ts:753`).
  - Otherwise the pre-warm is `SKIPPED` with a named reason and no paid call.
    OFFLINE-VERIFIED: L6. The production prefix clears Sonnet's 1024. Haiku is
    `BELOW_CACHE_MINIMUM`, and an unrated model is `CACHE_MINIMUM_UNKNOWN`.
- **Cache defects.** The detector now runs once per model attempt, against that
  attempt's own model minimum (`scout-executor.ts:1608`). The frontier's first turn
  rewrites the conversation into its own model's cache by design. That is counted
  as its first turn, not as a defect. OFFLINE-VERIFIED: L3 (`cacheDefect` is null).

## 7. What is NOT yet measured in production

1. **No paid call has run under this ladder.** Paid research has been paused since
   2026-09-22 at 1:06 PM MST. Every claim above is offline or read from code.
2. **Sonnet 5 has not been proved suitable for the Scout loop on real tasks.** No
   real Scout task has ever run on Sonnet 5. It is not yet known how often each
   escalation reason fires, or whether Sonnet plus an occasional frontier second try
   costs less per completed task than Opus alone. A small, capped paid comparison
   would measure this. It would run the same obligations on each arm against known
   answers, like the Ask comparison in `lib/ask/model-comparison.ts`, and would
   report correct results, misses, refusals, escalations and cost per completed
   task. Running it spends money, so the owner must approve it first.
3. **Cache behavior on Sonnet 5 is unmeasured.** Cache reads on the second and later
   turns, and a warm pre-warm entry on its first real read, are only projected from
   the Opus measurements of 2026-09-06.
4. **The escalation SQL on Fleet · Money has not run against the control plane.**
5. **The hold's size.** The hold is the declared token bound priced at Opus 5.5's
   output rate: $8.16 at the standard bound. That is an upper bound, not an estimate.
   Near the ceiling it may refuse an escalation that would have fit. Any refusal is
   recorded by name.
6. **A risk carried over from before this change, not fixed here.** Opus 5.5 checks
   that the conversation before each of its reasoning blocks is unchanged, and
   rejects a request when an earlier message was edited. The Scout context bound
   shortens older tool results in place (`boundToolResultContext`). On an account the
   check is enforced for, a frontier attempt that crosses that bound could be refused
   with HTTP 400. The account's enforcement status was not checked.
7. **Found in passing, outside this change.** The auditor sends a forced
   `tool_choice: { type: "tool", name: "record_audit" }` to `claude-opus-5-5`
   (`model-audit.ts:249`). According to the claude-api reference, Opus 5.5 rejects a
   forced `tool_choice` with HTTP 400. If so, every audit request since the frontier
   moved to Opus 5.5 on 2026-09-22 would fail. This session did not change the
   auditor, as its brief required.

## Facts taken from the claude-api reference (read 2026-09-25)

**Model IDs:**

- `claude-opus-5-5`
- `claude-sonnet-5`
- `claude-haiku-4-5` (no date suffix)
- Fable models (`claude-fable-5-1`, `claude-fable-5`) exist and are refused here by owner rule.

**Prices per million input / output tokens:**

| Model | Input | Output | Cache read |
|---|---:|---:|---:|
| Opus 5.5 | $4 | $20 | $0.20 |
| Sonnet 5 | $2 | $10 | standard rate |
| Haiku 4.5 | $1 | $5 | standard rate |

**Cache multipliers:**

- A 5-minute cache write costs 1.25× the input price.
- A 1-hour cache write costs 2× the input price.
- A standard cache read costs 0.1× the input price.
- Opus 5.5 cache reads cost 0.05× ($0.20 on its $4 input price).

**Minimum cacheable prefix:**

- Sonnet 5: 1024 tokens.
- Haiku 4.5: 4096 tokens.
- Opus 5: 512 tokens. The reference lists Opus 5.5 with the same feature set as Opus 5.

**Request compatibility:**

- Haiku 4.5 rejects `effort`.
- Sonnet 5 and Opus 5.5 accept `low` through `max`.
- Opus 5.5 rejects forced `tool_choice` and disabled thinking.
- Opus 5.5 reads thinking blocks from Sonnet, so the conversation can move onto it.
