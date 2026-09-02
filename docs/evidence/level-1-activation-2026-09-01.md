# Level 1 — Research activation: the session record (2026-09-01)

*(The Level 1 activation session. Law: RULING 240, RULING 241. Every claim
below cites the artifact that proves it; sections marked PENDING are filled in
by the live proof runs recorded beneath them.)*

## What the activation is

The standing control plane now decides every due unit by ONE rule
(`decideExecutor`, `lib/control-plane/scheduler/dispatch.ts`): a
machine-executable shape — declared by the provider, or graduated since in the
method store — runs the deterministic route executor; genuine unresolved
novelty runs a real bounded Scout (`lib/control-plane/scheduler/scout-executor.ts`)
through the same `dispatchOne` path as every other worker, under lane
`BOUNDED_MODEL_WORKER`, role `SCOUT`, provider `anthropic`, the model named on
the Attempt, provider-reported usage and computed cost on the Attempt and in
the cost ledger whatever the outcome. The two lanes run concurrently in one
cycle (`runCycle`, `lib/control-plane/scheduler/shadow-loop.ts`); the Scout
lane is admitted per row or deferred BY CODE — `LANE_DISABLED`, `PAUSED`,
`CEILING`, `CYCLE_MAX`, `BUDGET` — and a deferred row keeps its next-due.

## BEFORE denominator — `docs/evidence/scout-denominator-before-2026-09-01.json`

Measured at 2026-09-02T06:28:38Z against SHA e2a4ff51 over the whole registry.

| Reading | Value |
| --- | --- |
| registered route units | 2,991 (meetings 78, campaign-finance 16, local-jurisdictions 1,177, candidate-enrichment 1,720) |
| declared DETERMINISTIC · due | 658 · 548 |
| declared BOUNDED_MODEL_WORKER · due | 2,333 · 2,308 |
| opening kinds | HTTP_GET 655 · HTTP_POST 2 · NOT_MACHINE_EXECUTABLE 2,334 |
| contradictions (declared DETERMINISTIC, opening NOT_MACHINE_EXECUTABLE) | 1 of 2,991 — `az-sos-cfs-bulk-ftp` |
| model-class route ids the method store lists as learned | 2 of 18 (`nh-cfs-transaction-detail`, `nh-sos-records-request`) |
| model-class last committed disposition | REQUIRES_NEW_ADAPTER 156 · INGESTED 8 · none 2,169 |
| cannot progress without genuine novel investigation | 2,333 of 2,333 |
| no machine capable of running them (no Scout result exists) | 2,333 of 2,333 |
| Scout results held | 0 |

## Governance — L1-0

RULING 240 (LAW_DECISION, discovery) carries the operative authorization
verbatim and claims `activation.standing_level = level-1-research`; RULING 241
(DECISION) records the TEMPORARY $25/day rolling ceiling, the local
dispatchOne runtime and hosted runtimes as frontier. `pnpm governance:check`
PASSED (13 checks, 0 conflicts); `pnpm exec tsx scripts/regen-check.mts
--write` re-recorded 14 digests; `tests/governance-questions.test.ts` answers
the activation question from current law.

## The seeded failures, each with the test that proves it can fail

| Failure | Test |
| --- | --- |
| a declared-deterministic route consumes a model | `tests/scout-lane.test.ts` 1 (no model request is made; the decision rule's four cases) |
| model called, no tools, wrote prose | `tests/scout-lane.test.ts` 2 (SCOUT_NO_TOOL_USED; the Attempt ABORTS; the refused result is persisted) |
| a candidate citing an artifact nobody vaulted | `tests/scout-lane.test.ts` 3 (refused; the vaulted citation passes) |
| early NO_PROGRESS below the rung minimum | `tests/scout-lane.test.ts` 4 (refused, and the bound does not launder it; cost reaches the ledger on abort) |
| the bound reached | `tests/scout-lane.test.ts` 5 (rungs walked and next rungs on the typed result; only `finish` is offered) |
| the rolling ceiling | `tests/scout-lane.test.ts` 6 (deferred by code CEILING, nothing disposed; the cap fires AT the cap; unmeasured spend defers) |
| a manually asserted ACTIVE flag | `tests/scout-lane.test.ts` 7 and `tests/admin-research.test.ts` (ignored; the heartbeat reason is named; a historical success with a dead runner is INACTIVE) |
| ephemeral tool return without a vaulted artifact | `tests/scout-tools.test.ts` (a refusing vault shows the model NO body; positive control) |
| a DISALLOWED or CANNOT_TELL host is opened | `tests/scout-tools.test.ts` (no GET; the transport saw only robots.txt) |
| hostile page content executed | `tests/scout-tools.test.ts` (returned verbatim inside the untrusted DATA wrapper) |
| the installer regresses to RestartCount alone | `tests/pilot-task-installer.test.ts` (positive control: a mutated installer fails) |
| a Scout promotes its own proposal | `tests/scout-candidates.test.ts` (VALIDATED, never ADMITTED; admission is a session's act and then the decision rule replays deterministically) |
| an admin research write from the public host or cross-origin | `tests/admin-research.test.ts` (404 / 403 / 401 / 400) |

## Runner — L1-8

`scripts/pilot-task.ps1 -Action install` now registers the at-logon trigger
AND a 5-minute repetition trigger for 3,650 days; `verify-triggers` and
`prove-relaunch` are new. Measured 2026-09-01 (see
`docs/evidence/runner-installer-2026-09-01.md`): the live task carries only
the at-logon trigger; the unelevated install answered **Access is denied**,
exit 1; the runner pid stayed 26404. Tracker row **NH305** carries a
predicate on `data/ops/runner-relaunch-proof.json`. **NEEDS_SEAN**: one
elevated PowerShell in the repository —
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pilot-task.ps1 -Action install`,
then `-Action verify-triggers`, then `-Action prove-relaunch`, then commit the
proof.

## Secret custody — L1-7

No credential was created or rotated. `WTP_WORKERS_ANTHROPIC_API_KEY`
(provider Anthropic; context: the standing runner's child process, loaded by
`node --env-file=.env.local`; scope: the Scout lane only, never the Ask
credential; actor: this session, verification only; owner copy:
`.env.local` in the main checkout, gitignored) is CONFIRMED BY NAME in the
research state each cycle writes — `workerCredential.configured`. Its value
reaches only the provider request header.

## A finding the ship door surfaced — NEEDS_SEAN NH306

`pnpm secrets:sweep --transcripts`, run from the main checkout on 2026-09-02
after the ship door reported the transcript mirror carrying a credential value,
found the VALUES of `DATA_GOV_API_KEY` and `NETLIFY_AUTH_TOKEN` in a subagent
transcript of the earlier session `771dfc3d-591d-4a39-9cb2-2c028431acdd`
(`agent-a5abb86c7d4cf8d7a.jsonl`, line 24). The file was scrubbed in place (8
values replaced, 0 remaining on re-read); the repository and the Drive mirror
read 0 secret occurrences. RULING 127: a credential that has appeared in a
transcript is COMPROMISED and is ROTATED, and scrubbing is necessary and not
sufficient. Tracker row **NH306** carries a predicate on
`data/ops/credential-events.jsonl`. Neither value was produced or handled by
this session; this is a prior session's transcript.

## Real civic Scout proof — L1-9

Three proof cycles ran the standing cycle itself (`scripts/freshness-shadow.mts`
against the Postgres control plane, the runner stopped, one cycle at a time,
`--ids=` naming real due model-class obligations, `--max=0`). Seven Scout
Attempts ran; the readback (`docs/evidence/scout-readback-2026-09-02.json`,
`pnpm scout:readback`) answers eight proof conditions per Attempt from the
PERSISTED rows, never from the result alone.

| Obligation (seam) | Outcome · disposition | Rungs (evidence-backed) | Tools | Usd | Proof conditions |
| --- | --- | --- | --- | --- | --- |
| Avondale, AZ — meetings via the city's own site (permission unread) | ROUTE_CANDIDATE (BOUND) · DISCOVERED | 15 (13) | permission, fetch, browse | 1.5541 | 0 FAILED of 8 |
| Coconino County, AZ — ballot and candidates via the county election officer (address unknown) | ROUTE_CANDIDATE · DISCOVERED | 10 (8) | permission, fetch, browse | 0.7121 | 0 FAILED of 8 |
| Apache Junction, AZ — campaign finance via the city clerk (address unknown) | ROUTE_CANDIDATE · DISCOVERED | 14 (5) | permission, fetch (PDF vaulted), browse, public archive | 0.7852 | 0 FAILED of 8 |
| Daniel Keenan (AZ CD-5) — Wikipedia search API DISALLOWED; a compliant alternate needed | ROUTE_CANDIDATE · DISCOVERED | 7 (7) | permission, fetch (`/wiki/<Title>?action=raw`) | 0.9353 | 0 FAILED of 8 |
| Cochise County, AZ — ballot and candidates (address unknown) | EVIDENCE_FOUND · none (see below) | 8 (4) | permission, fetch, public archive CDX | 0.7943 | 2 FAILED of 8 |
| Benson, AZ — meetings via the city's own site | EVIDENCE_FOUND · none (see below) | 11 (9) | permission, fetch, browse | 0.8472 | 2 FAILED of 8 |
| Apache County, AZ — ballot and candidates | NO_PROGRESS (REFUSED: SCOUT_TRANSPORT_FAILED, HTTP 529 overloaded) | 0 | none | 0 (measured) | 4 FAILED of 8 |

Every Attempt persisted worker `SCOUT / anthropic / claude-opus-5`; every
served turn's usage is the provider's own count; every cost is computed at the
stated rate with the cache rates; every Scout that ran a tool vaulted its
evidence before the model saw it; every typed outcome is in `scout_results`;
no disposition touched a reader surface (DISCOVERED lands in the control plane
and `data/control-plane/staging/` only).

**Two measured defects, fixed in this session and tested:** the first two
Scouts (Benson, Cochise) finished their investigations and persisted typed
results with provider usage, then `dispatchOne` threw on an artifact
attribution collision — `bensonaz.gov/robots.txt` and
`www.bensonaz.gov/robots.txt` are one content id under two canonical URLs —
so their Attempts stayed open until the next cycle's lease sweep reclaimed
them (LEASE_EXPIRED) and their cost never reached the Attempt. The dispatcher
now records an attribution refusal by name and closes the Attempt
(`tests/scout-lane.test.ts` 9); their provider-measured cost was transferred
into the ledger under their own Attempt ids (`recordCost`, a copy of a
measured value). The Apache County Scout was refused by the provider before
any completion (HTTP 529); an unserved request is now a MEASURED ZERO cost
rather than an unmeasured one (`tests/scout-lane.test.ts` 10).

Method candidates PROPOSED and VALIDATED (never admitted) in
`data/method/candidates.json`: `bensonaz-gov-agenda-rss`,
`bensonaz-gov-sitemap`, `cochise-documentcenter-candidate-pdf`,
`wikipedia-raw-wikitext-title`, `azsos-2026-county-canvass-mirror`,
`avondale-civicclerk-events-api`, `avondaleaz-gov-public-meetings-page` —
seven, each citing the artifacts that show the route exists and carrying the
jurisdictional outcome the Attempt observed.

## AFTER denominator — L1-1 — `docs/evidence/scout-denominator-after-2026-09-02.json`

| Reading | BEFORE | AFTER |
| --- | --- | --- |
| registered route units | 2,991 | 2,991 |
| declared BOUNDED_MODEL_WORKER | 2,333 | 2,333 |
| model-class last disposition REQUIRES_NEW_ADAPTER · DISCOVERED | 156 · 0 | 163 · 4 |
| Scout results held | 0 | 9 after the first unattended cycle (ROUTE_CANDIDATE 5, EVIDENCE_FOUND 2, NO_PROGRESS 2) |
| model-class units with at least one Scout result | 0 | 9 of 2,333 |
| no machine capable of running them | 2,333 of 2,333 | 2,324 of 2,333 without a result yet — and a machine now exists for every one |
| research state `level-1` | absent | present: lane enabled, credential confirmed by name |
| rolling Scout spend | — | $5.63 of $25 |

## Unattended activation — L1-10

After PR #261 merged (95e1eb12) the main checkout was fast-forwarded and the
standing runner restarted through the Scheduled Task (`schtasks /Run`), with
no other command. Its first cycle — `data/health/freshness-shadow-runs/2026-09-02-04.json`
in the main checkout, started 2026-09-02T07:36:35Z at SHA 95e1eb12 — ran both
lanes:

| Reading | Value |
| --- | --- |
| due | 2,785 (deterministic 542 · model-class 2,243) |
| deterministic dispatched | 16 of 542 (the 15-minute dispatch budget was spent) |
| Scouts dispatched | 2 of 2,243 due (per-cycle bound 3; the rest deferred BY NAME — BUDGET 2,241 — each keeping its next-due) |
| executors, as they ran | DETERMINISTIC 16 · BOUNDED_MODEL_WORKER 2 · mismatches 0 · decision disagreements recorded 3 |
| worker identities on the Scout Attempts | `SCOUT / anthropic / claude-opus-5` on both, matching what ran |
| Scout results | ROUTE_CANDIDATE (BOUND, 15 rungs, 13 evidence-backed, 1 candidate, $2.0395, DISCOVERED) · NO_PROGRESS (MODEL, 14 rungs, 11 evidence-backed, $0.7034, Attempt aborted, obligation still owed) |
| cost measured | $2.7429 over 18 measured Attempts of 18 dispatched; rolling Scout spend $8.3711 of $25 |
| research state written by the task-launched process | lane ENABLED · `WTP_WORKERS_ANTHROPIC_API_KEY` configured: true (by name) · running 0 at close · runtime conditions none · method candidates validated 8 |
| promotion | `promotedToReaderTruth=false`; 16 entries staged as honest gaps, 0 promotion-ready |
| digest | delivered to the Drive mirror with a RESEARCH — LEVEL 1 section stating the lane, the credential by name, the spend and each Scout result |

The obligations both Scouts worked were Jereme Lance Peters (AZ CD-6):
`candidate-wikipedia-api` (a disallowed route; the Scout found and vaulted the
compliant `/wiki/<Title>?action=raw` representation and proposed a candidate)
and `candidate-authored-awaits-site` (NO_PROGRESS after eleven evidence-backed
rungs, which is the doctrine's honest answer, not an absence about the
candidate).

## /admin/research readback — L1-12 — `docs/evidence/admin-research-readback-2026-09-02.json`

Read from the deployed admin host after the merge deployed (production serving
95e1eb1 per `pnpm deploy:sha`; post-deploy observer green): login POST 303 with
the `__Host-` session cookie; `GET /admin/research` 200; the same path on the
public host **404**; sign-out 204; no credential value anywhere in the HTML.
The page derived **DEGRADED** and named its one failing condition — *every
Scout Attempt in the window measured its cost: 1 Scout Attempt reported no
usd* — which is the pre-fix HTTP 529 Attempt (`at-efaed514…`) whose ledger
entry carries `usd: null`; the fix that records an unserved request as a
measured zero shipped in the same PR, and the condition clears when that entry
ages out of the 24-hour window. Every other condition held: runner ALIVE,
research state current, not paused, model lane enabled, credential confirmed
by name, spend $5.6282 of $25, 2 of 2 Scouts running at read time, 2,243 of
2,333 model-class units due, 7 of 7 Scout Attempts listed with subject, reason,
model, elapsed, cost and outcome, 47 of 54 distinct evidence artifacts, the
two intent controls rendered, 15 rendered numbers each carrying a denominator.

One rendering defect measured on the live page and fixed in the follow-up:
the method-candidate panel used the `proposed` lifecycle count as its
denominator (zero once candidates validate) and rendered seven VALIDATED
candidates as "no method candidate proposed yet"; the denominator is now the
sum of the four lifecycle states.

