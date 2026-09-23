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

The one shared checklist for the owner's 2026-09-22 outcomes (rows 1–4, 7–11) and the model change (rows 5–6). Status keeps
**implemented · merged · deployed · publicly verified** distinct. Single writer: Admin; Census
sends its row and it is recorded verbatim. Last updated at 01:10Z, Phoenix day 2026-09-22.

| # | Outcome | Owner | Actual status | Evidence | Next action |
| --- | --- | --- | --- | --- | --- |
| 1 | Paid Scouting and enrichment paused while their publication is blocked; deterministic acquisition, parsing, verification, maintenance and routine publication continue | Admin | **Controlled by a standing rule, running.** Since `c61dbc2d` (22:51Z), and on `37d330db` since 00:23Z, the runner admits no paid Scout, auditor or pre-warm while no delivery path is open (promotion off). The owner click is no longer needed | Paid model rows since 20:10Z: 0 ($0.00). The last paid Scout calls were the 19:59:48Z cycle's 4 ($2.75). Rule: `lib/control-plane/scheduler/model-lane.ts` (#355). The stored research pause is still unset; the rule does not depend on it. The lane's reason line ("no delivery path is open") is written in a completed research cycle's record, and none has completed since 22:48Z (row 2) | Read the lane line in the first completed cycle's record. Nothing needed from Sean |
| 2 | A working runner | Admin | **Routine publication recovered; research cycles not yet.** Running `37d330db` (#357 connect window, #358 settled-route prevention) since 00:23:00Z, pid 30708 | **Routine lane, the one that publishes to readers:** 5 consecutive passes on `37d330db` from 00:26Z to 00:45Z, all SUCCEEDED, 0 task failures, 0 connection failures. The last two failing passes were on `c61dbc2d` (00:11Z and 00:17Z, 9 meeting tasks with zero receipts). **Research lane (shadow: promotion is off, so nothing it does reaches a reader):** the 22:55Z and 00:07Z cycles on `c61dbc2d` died in native aborts 10.6–11 min in, before writing a record. The first cycle on `37d330db` (00:25Z) was refused after 17 s because the dead cycle's window lease stood until 00:32:44Z; the same refusal happened at 17:54Z. The next cycle, 01:25Z, is the first with the 40-line capture of a native abort's fatal line. The stale-lease fix is designed (automate the exact-local-holder recovery `scripts/autonomous-fleet-cutover.mts` already performs by hand) and parked off the critical path. The settled-route residue was repaired at 00:34Z by the RouteTask session (65 tasks, 8 Attempts, 1 lease; timestamp-format correction at 00:37Z; every post-check passed; before-image sha256 `f13266b4…`, final `edadc555…`) | Read the 01:25Z cycle: a completed record, or the fatal line. Nothing needed from Sean |
| 3 | Census workflow (#346) | Census | IMPLEMENTED, NOT merge-ready. Full reproof started 00:32Z at `05f0223f` (Census, 00:31Z) | Census: expected to finish 02:00–02:15Z; then commit the evidence, rebase onto `37d330db` (none of main's 41 changed files is among the receipt's 514 bound paths; the trial merge is clean), re-run the census gate and `pnpm gates`, push and mark ready about 02:45Z, merge about 03:30Z. No meeting ages out between 00:30Z and 06:00Z. The tusd1:499 defect the earlier run caught is Admin's (row 11) | Census: reproof result, push, merge, then the joint readback of the geography publication |
| 4 | Operational visibility — the seven assignment-level parts | Admin | **Merged** (#356, `72915e18`, 23:07Z); not yet running. The view appears after the runner hands off to a SHA containing it and republishes the console | Demonstrated read-only on the production control plane at 22:13Z: 3,168 assignments (162 blocked, 398 failed, 2,250 waiting, 278 succeeded, 80 retired); 2,887 of 2,966 active obligations overdue; $186.31 measured, of which $184.17 is attributed, $2.15 is the shared pre-warm, $0.00 is unattributed, and 2 of 2,240 model rows are unknown. Rendered locally: list plus 8 drilldowns (succeeded, failed, waiting, blocked) with all seven parts, no page errors, no "$0.00"; the render found and fixed zero-drawn filter counts. CI 11/11 | After the handoff, read the published snapshot's `assignments` (BUILT) and confirm the deployed `/admin/assignments` lists it |
| 5 | Model routing — fleet frontier to Opus 5.5 | Admin | **Deployed and running** (`c61dbc2d` since 22:53Z). No real call observed yet, and none is expected while the paid lane is closed (row 1) | The running code selects Opus 5.5 for the frontier and keeps the cheaper classes first: `model-routing.ts:44`, `research-metrics.ts:312-313`, `model-cost.ts:38`, `scout-executor.ts:749`. The legacy `claude-opus-5` rate is kept for historical billing only. An Attempt records its model in `worker.version`; the 19:59Z Scouts, before the deploy, recorded `claude-opus-5` | Read `worker.version` on the first Scout Attempt after a delivery path opens. No paid run is started to demonstrate it |
| 6 | Model routing — reader Ask to Opus 5.5 | Admin (+ Census for its reproof) | **BLOCKED — owner decision (RULING 230)** | `lib/ask/model.ts:130` `ASK_SYNTHESIS_MODEL = "claude-opus-5"` stands on a measurement: a switch to Sonnet 5 failed a required question (RULING 236). RULING 230 (ACTIVE) requires every required question measured and holding before a switch; the reader reproof makes zero model calls, so it cannot be that measurement. Ask pricing (`lib/ask/model-comparison.ts:308`) needed #353's per-model cache-read rate — met now that #353 is merged | Sean chooses: (a) one `ask:model-compare` run, Opus 5 vs Opus 5.5 (≈$0.5–1; the last comparable run cost $0.48), or (b) an explicit override ruling, or (c) keep reader Ask on Opus 5. Then the reader change gets its own reproof — not folded into #346 |
| 7 | New information in existing coverage, delivered by the normal process | Admin | **Delivered and verified on the reader path, and continuing** | **First example (09-21):** Tucson Unified School District Budget Advisory Committee meeting, 30 September 16:00 America/Phoenix, via Zoom (ZIP 85701). Record `diligent:tusd1:505`, candidate `cv-8472430cc7971fb9fd5e719695f9dece`: FETCHED → NORMALIZED (18/18) → VALIDATED → PROMOTED at 20:46:26Z on 09-21, then READER_PROJECTION_READBACK_V2 at 20:46:32Z, with no manual step. Public link: https://meanwhileusa.com/?zip=85701. **Continuing (09-22):** 9 genuinely new sittings or agendas were first promoted (by identity first seen; 7 Newbury Selectboard rows that repeat an existing calendar series are excluded, row 11). 8 are served by production `/api/meetings` now, each exactly once: New London Budget Committee, Zoning Board, Housing Commission and Supervisors of the Checklist; the Kearsarge School Board's 24 September budget sitting with the district's agenda PDF; Newbury Planning Board; Bradford Supervisors of the Checklist; Tucson Commission on Disability Issues. The 9th, a Vail Governing Board sitting five months out, is promoted and in the reader snapshot; the reader list shows 120 days ahead, so it appears on its own. **Traced end to end:** New London Budget Committee, 14 October 6:00 pm, Whipple Memorial Town Hall. Candidate `cv-b3dd2d1825f20b2374cd875bb7dc00aa` from https://newlondon.nh.gov/calendar: FETCHED → NORMALIZED 4/4 → VALIDATED (every check PASS: source authenticity, schema, identity and jurisdiction, temporal, semantic, completeness horizon, absence, dependent read model) → PROMOTED by atomic pointer → READER_PROJECTION_READBACK_V2 two seconds later. Production `/api/meetings` for 03257 serves it once (synthetic-marked readback). The public page for 03257, filtered to New London and Budget Committee, shows its 4 sittings. Model cost $0.00. Tools: the `schedulepage` adapter, parser `meetings-composite/2`, the production validator and promotion | None |
| 8 | Economical operation without losing quality | Admin | **Model spend on delivery is $0; database transfer measured, largely waste; two fixes batched** | Reader delivery uses no models, and paid Scouts are stopped while they cannot deliver (row 1). **Neon transfer, Neon's own counters for the billing period from 09-04:** reader production database 1,372 GB (about 75 GB/day), control plane 480 GB (about 26 GB/day). Neon Launch includes 500 GB per project, then $0.10/GB: about $87 of reader-database overage so far, about $147 by the period's end at this rate; the control plane crosses its allowance within about a day. **Causes found:** (1) the routine clock read pulls about 80 MB per 5-minute pass (about 23 GB/day) of payloads it never uses (Census, measured); (2) agenda churn: hourly re-reads of unchanged agendas are stored as new versions (3,317 agenda documents for 208 sittings), and each re-promotion recomposes and reads back the 7 MB reader snapshot. **Fixes:** the churn fix (`claude/meetings-churn-fix`, 6 commits) and the clock narrowing (Census, `lib/civic-data/store.ts`) both bind the reader proof, so they ship together in one reproof after #346. The cheaper-model-first ladder for Scouts has never been exercised; measuring it needs a small capped paid test once a delivery path opens | Land the batched fix after #346, then re-measure transfer per pass. Sean decides whether to measure Scout model routing once a delivery path opens |
| 9 | Continues across normal cycles; Sean can see what runs, what reached readers, what it cost, and what waits or fails | Admin | **Routine publication: shown. Research cycles: not yet** | Routine: 5 consecutive passes on `37d330db` (row 2) and 9 new items on 09-22 (row 7). Visibility: the published owner snapshot carries the assignments view (BUILT, 3,168 assignments, published 00:23Z); the deployed `/admin/assignments` page itself is not yet read back. Research cycles: row 2 | After the 01:25Z cycle: two consecutive completed research cycles, or the crash cause fixed |
| 10 | Geography selection and launch controls ready for Sean to choose scope, priority and budget | Admin (controls, cost) · Census (geography) | **Proposal ready. Selection not live. Nothing launched** | See "Expansion proposal — for the owner's choice" below: current coverage overlay (84 meeting bodies: NH 54, AZ 24, NJ 6), costs from the ledgers, what exists against the six missing controls, and three candidate AZ scopes with exact ZCTA sets (Census). Geography selection goes live when #346 deploys and promotes `census-geography-overlaps` | Sean: choose the first scope and its budget, and whether to build launch-control items 1, 3, 4 and 6 |
| 11 | Reader-facing correctness on the delivery path | Admin | **Two live defects: one fix ready, one needs Sean** | (1) **False revision claims.** 25 sittings' agenda cards say "N versions on file — a revised agenda is itself news", N from 44 to 142 (Diligent: Tucson Unified, Pima Community College, Sunnyside; BoardBook 2065; Kearsarge), because identical hourly re-reads are stored as versions; each count grows by one an hour. The fix is ready (`claude/meetings-churn-fix`: count distinct content, only facts decide a change, Ask cites the reader projection). It binds the reader proof, and so does #346, so it runs after #346 rather than restarting Census's proof. (2) **Duplicate sittings.** Newbury's calendar lists 7 Selectboard sittings twice under two series. A merge fix exists, but it overrides the 2026-09-04 listing-identity notice | (1) After #346 merges: rebase, add Census's clock fix, one reproof, merge. (2) Sean decides whether one calendar's duplicate listings of a sitting may be merged into one row |


## Expansion proposal — for the owner's choice

Prepared 2026-09-22 by Admin (launch controls, budget, cost) and Census (geography,
recorded verbatim below). **Nothing here is chosen or launched.** Sean picks the
scopes, their order and their budgets.

### What a new scope costs, from the real ledgers

- **Everything the runner delivered to readers this week came through plain-code routine
  contracts: $0.00 in model spend.** Routine civic-data contracts fetch, parse, verify and promote public
  meetings and agendas on the standing runner's 5-minute clock, through adapters that
  already exist for the vendors in use (iCal, CivicPlus, Diligent, Legistar,
  ClerksBoards, CivicClerk, Apptegy, OnBase, Revize, IQM2, town schedule pages). A new
  body on one of those vendors costs wiring and verification time, not model spend.
  Database and hosting cost is not metered per contract: unknown, not zero.
- **Paid discovery (Scouts) cannot deliver today.** Promotion is off (activation gate),
  so since PR #355 the runner admits no paid Scout, auditor or pre-warm while no
  delivery path is open.
  - Historical rate: $155.08 for 2,133 Scout calls in the last 7 days, a mean of $0.55
    per attempt (the runner's own figure).
  - 83% of Scout input was served from the prompt cache.
  - 1,913 of 2,147 Scout attempts ended aborted.
  - Paid discovery for a new scope therefore belongs AFTER a delivery path (an open
    record class) exists for what it finds.
- **Recommended budget shape:** $0 in model spend for the first phase of any scope.
  Local meeting and agenda coverage is plain-code wiring. The existing $105 rolling
  ceiling stays the only paid limit until a per-scope budget exists (below).

### Current local coverage, the overlay Census asked for

Meeting bodies with a promoted production pointer (read 2026-09-22, 84 bodies):

| State | Bodies | Where |
| --- | --- | --- |
| NH | 54 | Merrimack County towns |
| AZ | 24 | Tucson (15), Pima County (3), Pima Community College, school districts: Tucson Unified, Amphitheater, Sunnyside, Vail; Mesa (1) |
| NJ | 6 | Morris County (Rockaway area) |

Deepening Pima County (scope AZ-A below) means the rest of the county: the towns of
Oro Valley, Marana, Sahuarita and South Tucson, the remaining school districts, and
county boards and commissions beyond the 3 already held. Readers in every ZCTA below
already get federal and state officials and the ballot.

### Launch controls: what exists and what is missing

- **Exists:**
  - one fleet-wide rolling spend dial ($105/24h; `AdminConfig.fleetSpendCeiling`);
  - research pause and resume;
  - a one-cycle "Deploy fleet" reorder (DISPATCH), which reorders existing work and
    creates none;
  - the per-state readiness panel (`/readiness/<state>`, AZ, NH, NJ only);
  - spend by place (ledger-wide, no window);
  - `/admin/assignments` (PR #356).
- **Missing.** Choosing coverage, standing priority and per-scope budgets are code
  changes today: covered states live in five separate code lists (`COVERED_STATES`,
  the reference, local-jurisdiction and enrichment state lists, and the readiness
  publisher), and pilot ZIPs in two. A new state also needs geometry adoption, a ZIP
  index rebuild, source contracts and an owner promotion
  (`pnpm jurisdictions:promote`).
- **The smallest set that makes "select → prioritise and budget → launch → monitor" a
  console action:**
  1. One stored scope list (owner-approved scopes, each with priority and budget) that
     replaces the separate code lists.
  2. A scope picker on the console, fed by Census geography once #346 promotes
     `census-geography-overlaps`.
  3. Standing priority: owner scope priorities feed the runner's band ordering.
  4. A per-scope rolling budget, checked before any paid work for that scope is
     admitted.
  5. A launch action: enumerate and promote the scope's jurisdictions, and register its
     meeting sources for the routine clock.
  6. Per-scope monitoring: a geography filter on `/admin/assignments`, with readiness
     and spend narrowed to the chosen scopes.

  Items 1, 3, 4 and 6 are Admin engineering. Item 2 depends on #346. Item 5 needs an
  owner-approved design, because it creates coverage.

### Candidate scopes (geography by Census, verbatim)

> SOURCE + TERMS. Census 2020 tab20 ZCTA relationship files (area-share overlaps) and OMB 2023 CBSA delineation. These are ZCTAs (ZIP Code Tabulation Areas), not USPS ZIPs (RULING 275); reconcilePostalZips maps a USPS ZIP list onto them. "Partial" = a boundary ZCTA that also lies in a neighbouring unit, so every scope reaches slightly past its nominal edge — listed below as "also touches". AZ, NH and NJ are not among the ten states redrawn for 2026 (UT, TN, LA, TX, FL, CA, MO, OH, AL, NC), so the 119th-Congress districts are the correct 2026 districts for all current coverage.
>
> AZ-A. Pima County (04019) = Tucson metro CBSA 46060 (single-county metro, identical set). 56 ZCTAs (46 whole, 10 partial): 85321 85341 85601 85602 85611 85614 85619 85622 85629 85633 85634 85637 85639 85641 85645 85653 85654 85658 85701 85704 85705 85706 85707 85708 85709 85710 85711 85712 85713 85714 85715 85716 85718 85719 85721 85723 85724 85726 85730 85734 85735 85736 85737 85739 85741 85742 85743 85745 85746 85747 85748 85749 85750 85755 85756 85757. Also touches counties Cochise, Maricopa, Pinal, Santa Cruz. Districts: CD 6, CD 7; State Senate 7, 16, 17, 18, 19, 20, 21, 23 (8); State House 8 districts. Proof ZIPs inside: 85701, 85641, 85601.
>
> AZ-B. AZ-06 (119th). 79 ZCTAs (43 whole, 36 partial): 85122 85123 85128 85131 85132 85141 85145 85193 85194 85531 85533 85534 85535 85536 85540 85543 85546 85551 85552 85602 85603 85605 85606 85607 85608 85609 85610 85611 85613 85614 85615 85616 85617 85618 85619 85622 85623 85625 85627 85629 85630 85631 85632 85635 85637 85638 85641 85643 85645 85650 85653 85654 85658 85704 85705 85706 85707 85708 85710 85711 85712 85714 85715 85716 85718 85719 85730 85737 85739 85741 85742 85743 85747 85748 85749 85750 85755 85756 85922. Counties: Cochise, Graham, Greenlee, Pima, Pinal, Santa Cruz. Also touches CD 2, CD 7. State Senate 9 districts (6, 7, 16–21, 23); State House 9. Proof ZIP inside: 85641.
>
> AZ-C. AZ-07 (119th). 74 ZCTAs (30 whole, 44 partial): 85037 85043 85123 85131 85139 85145 85172 85193 85321 85322 85323 85326 85329 85333 85336 85337 85338 85340 85341 85349 85350 85353 85356 85364 85365 85392 85601 85603 85607 85608 85611 85614 85615 85617 85620 85621 85622 85624 85626 85629 85633 85634 85637 85638 85639 85640 85645 85646 85648 85653 85701 85705 85706 85707 85709 85710 85711 85713 85714 85716 85719 85721 85723 85724 85726 85730 85734 85735 85736 85743 85745 85746 85756 85757. Counties: Cochise, Maricopa, Pima, Pinal, Santa Cruz, Yuma. Also touches CD 2, 3, 6, 9 (44 partial ZCTAs). State Senate 12 districts (16–26, 29); State House 12. Proof ZIPs inside: 85701, 85601.
>
> OVERLAP WITH CURRENT COVERAGE (geography side). Every ZCTA above is in a covered state, so readers there already get federal/state officials and the ballot; what a scope adds is LOCAL depth. Which local bodies are already routed/held is your overlay from the promoted OPERATIONAL_REFERENCE:US:covered-jurisdiction-routing:v1 — please add it per scope.
>
> NH/NJ (Merrimack County + NH-2; Morris County + NJ-11) and any new-state option: I'll produce them from the PRODUCTION lookup right after promotion, which doubles as the proof that selection works.
>
> PREREQUISITES before geography selection is live: (1) #346 passes its reproof (running now) + gates, merges, deploys; (2) the production-runtime checkout takes the new main and the ROUTINE child (every 5 min, healthy — research's outage doesn't block it) runs census-geography-overlaps, due on its first tick since it has no history; it acquires the five default scopes live from Census, runs the 8 checks, and promotes atomically; (3) readback: /api/census-geography/zctas?type=county&geoid=04019&version=county:2020 returns source "published" with these 56 ZCTAs.


**Part 2 (Census, verbatim):**

> Geography half, part 2 — record verbatim under the AZ scopes. Same source/terms note applies (Census 2020 tab20 area-share ZCTAs, not USPS ZIPs; "also touches" = boundary ZCTAs). Built from original Census files for states 33/34 (local planning build, not a publication; production publication is the runner's promotion after #346).
>
> NH-A. Merrimack County (33013). 31 ZCTAs (25 whole, 6 partial): 03046 03104 03106 03216 03220 03221 03224 03229 03230 03231 03233 03234 03235 03242 03243 03255 03257 03258 03260 03261 03263 03268 03273 03275 03276 03278 03287 03301 03303 03304 03307. Also touches Belknap, Grafton, Hillsborough, Rockingham, Sullivan counties. CD 1, CD 2. CBSAs touched: Concord NH (micro), Manchester-Nashua, Laconia, Lebanon-Claremont, Boston-Cambridge-Newton. State Senate 10 districts; State House 35. Proof ZIP inside: 03255.
>
> NH-B. NH-02 (119th). 167 ZCTAs (147 whole, 20 partial) — full list available on request (long). 9 counties (Belknap, Carroll, Cheshire, Coos, Grafton, Hillsborough, Merrimack, Rockingham, Sullivan). Also touches CD 1. State Senate 18; State House 107 (NH's 400-seat House). Proof ZIP inside: 03255. Large: ~5x Merrimack.
>
> NJ-A. Morris County (34027). 58 ZCTAs (48 whole, 10 partial): 07005 07034 07035 07045 07046 07054 07058 07082 07405 07435 07438 07440 07444 07457 07460 07801 07803 07828 07830 07834 07836 07840 07842 07847 07849 07850 07852 07853 07856 07857 07865 07866 07869 07870 07876 07878 07885 07920 07926 07927 07928 07930 07931 07932 07933 07934 07935 07936 07940 07945 07946 07950 07960 07961 07970 07976 07980 07981. Also touches Hunterdon, Passaic, Somerset, Sussex, Warren. CD 5, 7, 11. Legislative districts: 5 (NJ Senate and Assembly share the same 40 districts). Proof ZIPs inside: 07866, 07936, 07803, 07444. Note: Morris lies in the New York-Newark-Jersey City metro, which is far too large to be a single step — county/district scopes are the practical options.
>
> NJ-B. NJ-11 (119th). 60 ZCTAs (38 whole, 22 partial): 07003 07004 07005 07006 07009 07013 07017 07028 07034 07035 07039 07040 07041 07042 07043 07045 07046 07052 07054 07058 07068 07078 07079 07082 07107 07109 07110 07405 07424 07435 07438 07440 07444 07457 07460 07470 07512 07801 07834 07842 07849 07866 07869 07878 07885 07920 07926 07927 07928 07932 07935 07936 07940 07945 07950 07960 07961 07970 07976 07981. Counties: Essex, Morris, Passaic, Somerset, Sussex. Also touches CD 5, 7, 8, 9, 10 (22 partial ZCTAs). Legislative districts: 11. Proof ZIPs inside: 07866, 07936, 07444.
>
> SIZE LADDER for the owner (smallest step first): Merrimack 31 → Pima 56 → Morris 58 → NJ-11 60 → AZ-07 74 → AZ-06 79 → NH-02 167 ZCTAs. Deepening local coverage around existing proof ZIPs needs no state onboarding; a new state needs a COVERED_STATES entry plus per-state content (election dates, registration, area facts, ballot surface). Your cost half + launch controls complete the picture.

### Decisions for Sean

1. **Which scope first.** Size ladder, smallest first (Census): Merrimack 31 → Pima 56 → Morris 58 → NJ-11 60 →
   AZ-07 74 → AZ-06 79 → NH-02 167 ZCTAs. Deepening local coverage around the existing proof ZIPs needs no state
   onboarding.
   - NH-A, Merrimack County (03255's county) or AZ-A, Pima County (85701, 85641, 85601): the two smallest steps.
   - AZ-B, AZ-06, or AZ-C, AZ-07: whole congressional districts; wider, and 36 and 44
     partial ZCTAs respectively.
   - NJ-A, Morris County (07866), or NJ-11; NH-02 is the largest step.
   - A new state.
2. **Its budget.** Recommended: $0 model spend for local meeting coverage. Paid
   discovery only once you open a delivery path for what it finds.
3. **Whether to build launch-control items 1, 3, 4 and 6 now**, so the next scope is
   chosen and funded from the console rather than by code change.

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
