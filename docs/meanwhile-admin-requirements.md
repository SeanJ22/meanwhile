# Meanwhile Admin — requirements and evidence

One authoritative checklist for the Admin / Fleet / cost-visibility workstream, keyed to the
design package's stable `MW-###` IDs. It records, per requirement, the **verified** current
status and the **evidence** (file:line) it was verified against — so a claim is never made
because a mockup showed it.

- **Authority order** (RULING 272): the owner's session prompt > this repo's CLAUDE.md/rulings >
  the design package (`Project requirements clarification.zip`) > the State Run Checklist v1.1.
  Where the design package disagrees with current `main`, current `main` wins and is corrected here.
- **Verified against** `main` at `afab0126` (fetched 2026-09-21), two read-only code audits.
- **Status vocabulary:** `WORKS` (render honestly, still verify on the reader path) ·
  `NOT JOINED` (every piece is recorded, nothing gathers it) · `BUILD` (value is written nowhere) ·
  `COMMAND` (the closed instruction set has no member meaning this) · `BLOCKED` (needs an owner
  decision, a peer session, or engineering named as a dependency).
- The prototype's sample numbers (AZ CD6 = 3 codes / 19 bodies / 15 new; specific ZIPs; `$25`;
  `$105`; "Sonnet 4.5") are **not** repeated here. They are verified or replaced below.

---

## Completion checklist — owner directive of 2026-09-22

The one shared checklist for the three outcomes and the model change. Status keeps
**implemented · merged · deployed · publicly verified** distinct. Single writer: Admin; Census
sends its row and it is recorded verbatim. Last updated 2026-09-22T22:10Z.

| # | Outcome | Owner | Actual status | Evidence | Next action |
| --- | --- | --- | --- | --- | --- |
| 1 | Paid Scouting and enrichment paused while their publication is blocked; deterministic acquisition, parsing, verification, maintenance and routine publication continue | Admin (control) · **the pause click is Sean's** | **NOT PAUSED** — admission is live. No Scout has run since 20:10Z only because the two research cycles since then failed | Stored research state re-read 21:48Z: `paused=false`, no research `PAUSE`/`RESUME` intent ever recorded, no `HONORED` record. Since the authorized pause (15:41:58Z) through 20:10Z: $11.09 — 22 newly started attempts $10.97 (by `cp_attempts.startedAt`) + 4 pre-warms $0.12; nothing was in flight at the pause. Paid Scout spend (`cp_log_costs`, role SCOUT): 09-21 $57.67 (133 calls), 09-22 $41.18 (89); the last Scout calls were the 19:59:48Z cycle's 4 ($2.75). The 21:11Z cycle was killed mid-run, so a call it had in flight would be unrecorded: unknown, not zero. The runner fix in row 2 also frees the 348 s the lease sweep takes before dispatch; that cycle deferred 1,240 due Scouts for lack of wall time, so without the pause each cycle would admit several times more Scouts, bounded only by the rolling-24-hour ceiling on the console dial: $105, set by the owner 2026-09-20 (`adminConfig.fleetSpendCeiling`; the 19:59Z cycle recorded $49.93 of $105) — **its merge is held for the pause**. Every deploy also relaunches the runner at the next cycle boundary and the new process runs a cycle at once (21:33Z relaunch → cycle at 21:34:51Z). Only the authenticated admin route (`app/api/admin/research/route.ts:88`) can write a research pause | Sean: Admin → Research → **Pause research** (stops Scout and auditor admission only). Admin then verifies stored `paused=true`, the runner's `HONORED` record and the next cycle admitting 0 Scouts, and merges the row 2 fix |
| 2 | A working runner | Admin | **Not recovered.** Running `97a673e7` (#352 + #353); no research cycle has completed since 20:10Z; routine publication degraded. Repair implemented on `claude/runner-recovery` (not merged; merge held for row 1) | **Running version:** runtime checkout `97a673e7`, runner pid 33032 since 21:33:00Z (handoff from `01a9a0db`). **Research cycles:** 19:59:48–20:10:38Z SUCCEEDED (4 Scouts, 0 deterministic dispatches); 21:11Z stopped by the 15-minute limit (SIGTERM, no stderr, no local record); 21:34:51Z on `97a673e7` crashed after 17 s: `STORE_READ_FAILED` reading `OPERATIONAL_REFERENCE:US:covered-jurisdiction-routing:v1` (`freshness-shadow.mts:465`). #352's crash recording worked (FRESHNESS_CYCLE FAILED written, local record `2026-09-22-05.json`); the cycle did no work. **Routine publication** (own clock): 2 of 8 passes succeeded in the 21Z hour (normally 8–12 of 12); the 22:03Z pass failed 21 tasks. Since 21:50Z the dominant failure is `DURABLE_CLOCK_READ_FAILED` — database requests that hang until the 30 s request deadline aborts them (19), plus meetings partitions returning zero receipts (5) and reader-readback repairs (8). Both databases answered 10 of 10 reads at about 90 ms at 22:07Z; host CPU was 99–100% during parallel test suites at 21:38Z but 53–62% at 22:06Z while requests were still failing; TCP state normal. Cause not isolated. **Repair:** (a) release dead leases on disposed RouteTasks and read one task's Attempts, not all (sweep 348 s → seconds); (b) both startup authority reads re-read a failed read within the connect-retry bounds, never while the Neon circuit is latched. **Earlier rows, still true:** how failed cycles coexisted with spend (a native crash killed the research child before its summary, so cycles that had dispatched Scouts kept their costs but read as "dispatched nothing") | Sean's pause click (row 1), then merge `claude/runner-recovery` on green CI; the runner hands off at the first cycle boundary after certification. Then observe consecutive completed cycles: lease phase in seconds, deterministic dispatch above zero, startup reads surviving a failed read, routine passes succeeding. Routine-lane request timeouts: capture the transport cause at the next burst |
| 3 | Census workflow (#346) | Census | IMPLEMENTED, NOT merge-ready — full reader reproof RUNNING at `05f0223f` (census gate still red until it renews) | Newbury phone defect FIXED and verified. Root cause confirmed: the unresolved-listing notice (one line per group) sat in the venue panel's pinned header and outgrew the phone cap (`.bottom-sheet > .panel` 55dvh), collapsing the sitting list to `clientHeight` 0. Fix `1b39e0b4`→`05f0223f` moves the notice into the scrolling body in `meeting-panel.tsx` and the same-class `list-overlay.tsx` (no record hidden, no interaction changed, no assertion weakened). Isolated render proof 16/16 PASS (03255/07866/85641/85701 × phone/desktop × light/dark, incl. 03255-phone-dark/light which failed before); 75/75 component tests; eslint clean. Branch rebased clean onto `97a673e7` (#352 + #353; none of their files are in the reader-closure fingerprint), 0 behind. Production authority re-minted at `05f0223f`. (Correction by Census: an earlier "fix didn't work" reading was a stale-log artifact from a harness that never reached render — fixed, recorded in memory.) | Full reproof → if green: commit renewed evidence + regen + `pnpm gates` → push → CI → merge → deploy → activate census-geography-overlaps → joint Admin-to-public readback with Admin |
| 4 | Operational visibility — the seven assignment-level parts | Admin | **In progress, not merged** | Fleet-wide delivery trail (acquired → validated → approved → publicly available) and spend-by-place are merged (#351, #343). The per-assignment view — what/where/why/model, discovered vs downloaded, parsed/failed/records, verified/rejected/needs evidence, promoted vs publicly available, costs with shared and unmeasured shown apart, waiting with age/blocker/owner/next action — is being built on `claude/admin-assignment-visibility` | Finish, review, gates, merge; demonstrate on real successful, failed and waiting work |
| 5 | Model routing — fleet frontier to Opus 5.5 | Admin | **Deployed to the runner** (`97a673e7` running since 21:33:00Z); first real call not yet observed | Merged #353 (CI 11/11 green on `e7d13f54`). The running code selects Opus 5.5 for the frontier and keeps the cheaper classes first: `model-routing.ts:44` `frontier: "claude-opus-5-5"`, `research-metrics.ts:312-313` Scout and auditor, `model-cost.ts:38` `MODEL_WORKER_MODEL`, `scout-executor.ts:749` uses the routed model; the legacy `claude-opus-5` rate is kept for historical billing only. An Attempt records its model in `worker.version`; the 19:59Z Scouts, before the deploy, recorded `claude-opus-5`. No active worktree or open PR adds an Opus 5 selection | Read `worker.version` and the priced cost of the first Scout Attempt after 21:33Z. No paid run is started to demonstrate it |
| 6 | Model routing — reader Ask to Opus 5.5 | Admin (+ Census for its reproof) | **BLOCKED — owner decision (RULING 230)** | `lib/ask/model.ts:130` `ASK_SYNTHESIS_MODEL = "claude-opus-5"` stands on a measurement: a switch to Sonnet 5 failed a required question (RULING 236). RULING 230 (ACTIVE) requires every required question measured and holding before a switch; the reader reproof makes zero model calls, so it cannot be that measurement. Ask pricing (`lib/ask/model-comparison.ts:308`) needed #353's per-model cache-read rate — met now that #353 is merged | Sean chooses: (a) one `ask:model-compare` run, Opus 5 vs Opus 5.5 (≈$0.5–1; the last comparable run cost $0.48), or (b) an explicit override ruling, or (c) keep reader Ask on Opus 5. Then the reader change gets its own reproof — not folded into #346 |

---

## Ground truth — where the design package is stale, corrected

| Package claim | Current `main` | Evidence |
| --- | --- | --- |
| In-app ceiling is `$25/day` (`research-policy.ts:78`) | `$25` brake **retired**. Effective ceiling = console dial `AdminConfig.fleetSpendCeiling`; fallback **$100** | `fleet-safety.ts:61` (`rolling24HourModelUsd:100`), `research-policy.ts:85` (`dailyCeilingUsd:100`), `resolveRollingCeiling` `fleet-safety.ts:83-91`, dial write `gateway/registry.ts:628` |
| `$105` is an Anthropic **account cap** | **No `105` spend literal exists anywhere.** `$105` is not in current code; the only in-app ceiling is the `$100` dial | repo-wide search; `deploy-preview.ts:149` "one ceiling ... no per-cycle cap" |
| MID model = "Claude Sonnet 4.5" | `sonnet` class = **`claude-sonnet-5`**; classes `haiku=claude-haiku-4-5`, `frontier=claude-opus-5` | `model-routing.ts:39-43` |
| Model routing "cheapest first, escalate on failure" is the live behavior | Ladder is **defined but never triggered** — every production call passes `escalated=false`; SCOUT loop + audit run on Opus | `model-routing.ts:172-181`; call sites `scout-executor.ts:748,910`, `freshness-shadow.mts:1398`, `model-audit.ts:227` |
| Escalation reason should write through the existing `escalations` repo | That aggregate is **owner-escalation only and has no production writer** (`recordEscalation` uncalled). Keep model vs human escalation separate | `work-item.ts:214-251`, `coordinator.ts:871-893` |
| `dev/gra-evidence/`, `dev/fleet-runtime-investigation/` on disk | **Absent from this repo** (they lived in the working copy `dev/meanwhile-admin-fleet-fix`). GRA evidence is at `C:/Users/seanj/dev/meanwhile-evidence/` | worktree `ls` |
| RULING 241 (ACTIVE) still reads "TEMPORARY $25/day" | Code moved to `$100` dial (owner-authorized, PR #334). Ruling text now inconsistent — a governance reconciliation item | `docs/rulings.md:285`; `lib/governance/adoptions.ts:3632` |

---

## The system as it actually runs (for the non-code reader)

- **The runner** (`scripts/freshness-shadow.mts`) is one unattended cycle. Inside it, a deterministic
  lane (ACQUIRER/PARSER/VALIDATOR — plain code) and a model lane (SCOUT — up to **4 at once**) run
  **concurrently** (`shadow-loop.ts:719`, `runPool(...,4)` `:654`). A slow acquisition does not, by
  construction, block a scout. RULING 282/283: this runner is the sole routine civic-data clock.
- **The only model-driven workers are SCOUT and the ADVERSARIAL_AUDITOR**, both on Opus. Everything
  else is plain code (`attempt.ts:74-84`; kinds confirmed per role).
- **The charge ledger** is `repos.costs` (append-only, one writer `recordCost` `coordinator.ts:935`).
  Each row: attempt, work item, route task, route, source, jurisdiction (OCD id), project, role, cost.
  **Missing for attribution:** assignment, purpose, model, district (model is on `attempt.ts:93`,
  derivable). `cost.ts:110-125`.
- **Promotion to readers is OFF** — the runner produces verified/audited research but the activation
  gate holds it in shadow (`promotion/activation-gate.ts:17-20` `promotionEnabled:false`). The single
  authorized production writer is `lib/civic-data/store.ts` (guarded by `runtime-authority.ts` +
  `db/write-guard.ts`); the authorized research→reader bridge is `approvedResearchMeetingPartition`
  (`promotion/production-meetings.ts`). Turning promotion on wholesale is a **prohibited** gateway
  action (`gateway/registry.ts:777`) — reaching a reader goes through the authorized bridge, with an
  owner decision, never a gate flip.
- **Admin reads a published control-plane snapshot**, never the filesystem/reader DB. A new reading
  needs a publisher + a durable aggregate (5-file pattern + `BOOTSTRAP_VERSION` bump + conformance
  pin). A new admin surface must be in `middleware.ts` `ADMIN_PATH_PREFIXES`.

---

## Requirements, verified

### Block 1 — identity and attribution
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-001 | An assignment is one reference everything hangs off | `BUILD` | No correlation id threads work items/cost; DISPATCH only reorders. `freshness-shadow.mts:744-768`, `work-item.ts:284-303` |
| MW-002 | Every work item names its question (1 of 6) | `BUILD` | Only free-text `obligation`/`why`. `work-item.ts:291-294` |
| MW-003 | Bodies are the unit of attribution | `NOT JOINED` | Cost carries `jurisdiction` (OCD); needs body rollup + dedupe. `cost.ts:110` |
| MW-004 | Container membership per code (CD/county/metro), overlap recorded | `BLOCKED` (Census) + `BUILD` | Container→ZCTA owned by Census session; ZCTA→bodies mine via registry |

### Block 2 — the readings
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-011 | Public delivery is a readback, not a declaration | `BUILD` + `BLOCKED` | Promotion gated off; no promotion→served join. `activation-gate.ts:17`, `read-model.ts` |
| MW-012 | Changed vs unchanged (NEW/CHANGED/UNCHANGED/REMOVED) | `BUILD` | Check for an existing fingerprint at write time |
| MW-013 | Every charge records what the work was for | `BUILD` | Largest unlock. Derive purpose from role/step; model from `attempt.ts:93`; add assignment (MW-001) |
| MW-014 | Skipped work explains itself (reasons sum to count) | `BUILD` | Second queue records its own skip reason; report doesn't read it |
| MW-015 | Visited is not finished | `BUILD` | `completion.ts` exists; roll up refusals/unsettled to assignment |
| MW-016 | No unexplained dead ends (three fields) | `BUILD` | Terminal state must carry ruled-out / would-settle / who-moves-next |
| MW-017 | Publishing limit vs a check we failed to make | `BUILD` | Measured route horizons exist for meetings |

### Block 3 — control (the operational path)
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-021 | Per-assignment budget the runner honours | `BUILD` | Reuse `fleet-safety.ts` holdback; nothing keys spend to an assignment today |
| MW-022 | Every reading narrows to one scope | `BUILD` | Attempts carry a state tag; container/code narrowing needed |
| MW-023 | Periods are real or refused | `BUILD` | Only rolling-24h exists; never scale a daily value up |
| MW-024 | Test runs are separable (real money, out of productivity) | `BUILD` | Proof-run ids may be distinguishable |
| MW-025 | What a worker was given, verbatim | `NOT JOINED` | Dispatch/scout context exists; capture the exact text at dispatch + whether used |
| MW-026 | Runner acknowledgement is five facts, five times | `BUILD` | Gateway writes an `ActionReceipt`; 5-fact lifecycle (saved/accepted/queued/running/blocked/paused/completed) not surfaced |
| MW-027 | Learning measured over time (six trends) | `BUILD` | None measured today |
| MW-028 | Deploy creates missing work, not just priority | `COMMAND` | `fleet.deployHere` only reorders. `gateway/registry.ts:442` |
| MW-029 | Concurrent lanes never serialise | `WORKS` (verify) | Two lanes via `Promise.all` `shadow-loop.ts:719`; scouts 4-wide. Gap: waiting/oldest gauge + prove independence |
| MW-030 | Answer a suggested next step in your own words | `COMMAND` | Instruction set is closed/typed; needs a free-text member + classification |

### Block 4 — model routing and its evidence (this session owns routing)
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-031 | The escalation reason is recorded (+ combined cost) | `BUILD` | Ladder never triggered; reason persisted nowhere. Put it on the model attempt/charge, not the owner escalations aggregate |
| MW-032 | Which model is better, not just cheaper | `NOT JOINED` | Bake-off harness exists `lib/ask/model-comparison.ts` (cold pricing, comparability guard) |
| MW-033 | Cheapest suitable first, reuse before research | `BUILD` (trace-and-record) | Steps are tiered but escalation never fires; scout loop + audit on Opus. Trace what production actually enforces |
| MW-034 | The ceiling is a guard, not an observation | `BUILD` | Structural only (frontier=opus, `escalateTo:null`); add explicit deny-list + a failing test above ceiling; no "fable" in code |
| MW-035 | Expensive planning is selective | `BUILD` | Show which decisions used a planning model and why |

### Block 5 — cost across every provider
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-041 | Every provider in one place | `BUILD` | Our ledger exists (`cost-panel.ts`); provider registry (Anthropic/OpenAI/Brave/Exa/Neon/Netlify/GitHub/tools) does not |
| MW-042 | Credits bought are not usage consumed | `BUILD` | Brave prepaid balance separate from consumption |
| MW-043 | Three kinds of ceiling, never blended | `BUILD` | Today one in-app ceiling ($100 dial). Provider account cap + subscriptions not modeled |
| MW-044 | Cost per result needs a defensible numerator and denominator | `BUILD` | Depends on MW-013; a rate over a floor is a ceiling |
| MW-045 | Reconciliation is explicit | `BUILD` | Provider bill vs our estimate never summed |

### Block 6 — acquisition, maintenance and public delivery
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-051 | Maintenance is cheap and scheduled, not blanket re-verification | `BUILD` | Prove with before/after charge count on one body; deploy must not trigger paid re-read |
| MW-052 | Meetings coverage states six things | `BUILD` | Route horizons exist to build on |
| MW-053 | Four stages, with the failures between them | `NOT JOINED` | Promotion pipeline transitions exist `promotion/pipeline.ts`; activation gated |
| MW-054 | Promotion history is complete | `BUILD` | What changed / evidence / validation / promotion time+version / public destination |

### Block 7 — readiness and the versioned standard
| ID | What it is | Status | Evidence / note |
| --- | --- | --- | --- |
| MW-061 | Five readings, five denominators | `WORKS` (verify) | Readiness panel + pure core exist `lib/control-plane/readiness/*` |
| MW-062 | Blocked and never-attempted stay visibly unsatisfied | `BUILD` | Do not fold out of the denominator |
| MW-063 | The checklist is versioned data, not code | `BUILD` | State Run Checklist v1.1 → configuration; keep old measurements |
| MW-064 | A blocker stops only its own lane | `WORKS` (verify) | |
| MW-065 | Anything a supported check can answer is already queued | `WORKS` (verify) | |
| MW-066 | Could-govern stays distinct from confirmed representation | `WORKS` (do not change) | |
| MW-071 | Live status for active work (one narrow read) | `WORKS` (pattern) | Do not widen the heartbeat |

---

## Decisions

**Resolved by the owner's prompt (not open):**
- Model routing is implemented **in this session** (supersedes the package's "separate session").
- Do not hardcode AZ CD6 sample numbers; verify against real geography + registry.
- `$25` is not the current ceiling; `$105` is not an account cap. Render the live dial value.

**Resolved by me (ordinary technical choices):**
- MW-031 escalation reason lives on the **model attempt/charge record** (it needs the prior-attempt
  cost anyway), keeping model-routing escalation separate from the owner `Escalation` aggregate.
  (Settles OPEN-DECISION #2.)
- Geography stays on clearly-labeled fixtures until the Census session's published lookup lands;
  final acceptance uses the published lookup.

**Needs the owner (I will bring each with a recommendation, when I reach it):**
1. **Reaching a real reader for the milestone.** Promotion is gated off by law/config (RULING 215;
   `activation-gate.ts`). The demonstration's "public availability" must use the authorized bridge
   for a bounded class (recommend: meetings for the milestone district's bodies), with your decision
   — never a gate flip. *This shapes what "milestone complete" means.*
2. **A one-time bounded paid-test budget** for the live model bake-off (MW-032). The fleet ceiling is
   not permission to spend it on testing.
3. **One consolidated billing/access request** for the cost screen providers (MW-041) — what each
   provider needs, in plain steps, batched once.
4. **AZ legislative-votes route** (OPEN-DECISION #1): recommend the official bulk files first.
5. **Freshness rules** for government finance + participation (OPEN-DECISION #4): recommend leave
   unset and report "not measured" until first walked.

---

## Phase plan (from the design's IMPLEMENTATION.md, this session's sequencing)

- **Phase 0 (24-hour milestone):** MW-001 → MW-004 (CD scope, Census fixture) → MW-002 → MW-026 →
  MW-028 → MW-021 → MW-012 → MW-011, proven end-to-end on one district with one record reaching the
  authorized reader path. Exit test = ACCEPTANCE §1.
- **Phase 1:** honesty renders (unknown-as-dash, floors, scope+window labels) — no new recording.
- **Phase 2:** MW-013 (the cost-attribution unlock) + MW-014/15/16/17.
- **Phase 3:** cost plane MW-041/42/43/44/45.
- **Phase 4:** MW-022/23/24 + MW-003/004 generalised.
- **Phase 5:** routing evidence MW-031/32/33/34/35 (+ the historical-spend investigation, §4).
- **Phase 6:** MW-051/52/53/54.
- **Phase 7:** readiness completeness MW-061/62/63/64/65/66; State Run Checklist v1.1 as config.
- **Phase 8:** MW-027 learning + MW-071 live status.

Sequential PRs, each titled with its `MW-###`. Deploy target `https://admin.meanwhileusa.com`.
