# Meanwhile Admin — the one requirement-to-evidence checklist

The single checklist for the finished Admin experience, keyed to the design package's own
requirements (`REQUIREMENTS.md`, `MW-###`) and acceptance tests (`ACCEPTANCE.md`), in
`Project requirements clarification.zip`. Maintained by the Admin redesign session, which
owns integrated delivery and final acceptance (owner's alignment note, 2026-09-23). Each
session supplies the evidence for the capabilities it delivers; a row names its owner.

- **The finish line** is the deployed design, accurate data, working controls, and a
  demonstrated assignment-to-publication workflow. A merged PR is a milestone, not the finish.
- **Status words:** `built` (in a branch, rendered locally against the production stores,
  read-only) · `merged` · `deployed` · `verified` (seen on the signed-in production site and
  checked against its record) · `needs recording` (the system does not record it yet) ·
  `owner` (waits on a decision only Sean can make).
- **Owners:** *Redesign* — this session. *Backend* — Admin worker and cost visibility (backend
  operations, the merge train). *RouteTask* — stop redispatching. *Vault* — pre-split vault.
  *Census* — the Census geography lookup (delivered). *Sean* — owner decisions.
- **Limits that stand:** paid research stays paused until Sean authorises it (his pause from Admin,
  `PAUSE:2026-09-23T17:25:04.443Z`, was honored by the runner at 17:33:06Z; the latest paid model
  charge is 2026-09-22T20:06:54Z — Backend's evidence); no expansion is demonstrated without Sean's
  approved scope and budget; no production write outside the owner-only gateway actions.
- `docs/meanwhile-admin-requirements.md` keeps the evidence behind the statuses verified on
  2026-09-21 and the 2026-09-22 runner outcomes; the statuses below supersede its MW table.

---

## What Sean can do in Admin (deployed 2026-09-23, #373)

Statuses from the signed-in walk of admin.meanwhileusa.com on 2026-09-23, 20:12–20:25Z (Sean's session): every
redesigned page and three kept pages returned 200 with their content, and the figures below were checked against the
stores with independent read-only SQL. Write controls were not pressed: they are Sean's to press, and the paid lane stays
paused.

| Area | What | Status |
| --- | --- | --- |
| Every page | One header: Fleet / Readiness, one scope filter that holds across both, Other pages. The old View/State header is gone everywhere. | verified |
| Fleet · Now | Read what is working, what isn't and where to put effort, each counted from the lists beneath; answer each decision with an option or in his own words; open any watched body. | verified — 108 of 119 bodies got in; 24-hour changes 217 added, 3,741 revised, 10 removed equal the store to the record; 74 cards listed = 69 decisions + 3 optional + 2 machine checks. Records held read 596 where the store holds at least 608 (bodies read through two sources counted one source) — fixed in P5 |
| Fleet · Work | See the runner and pause/resume it; choose a geography (kind, then place) and see every ZCTA it covers and what already exists there before sending; send it with a priority and a budget; watch the runner acknowledge it; open any assignment in place. | verified (read); the first open on a cold instance failed with "This page didn't load" (the page outran Netlify's 10-second limit) — fixed in P5 |
| Fleet · Money | See the three ceilings (and change the in-app dial), every provider with its reading or NO READING, AI usage by model, spend by place, what paid work produced; enter or import a bill the system cannot read. | verified — September ledger $186.31 equals `cp_log_costs` to the cent; the last charge with dollars is still 2026-09-22 20:06:54Z; the dial reads $105.00, set 2026-09-19 |
| Is it learning · Fix list | Read what the records say about learning today; order the MW items; put one on the fix queue; send the queue. | verified (read) |
| Readiness | All states; one state's collection status, five readings and gaps by district, county or metro; County → Pima → its 56 ZCTAs with coverage, gaps and work; What counts as done. | verified — Pima: 56 codes, 96 bodies, 38 with a way in, 4 codes not indexed; choosing districts clears the county; Ohio reads as sentences, never zeros |

---

## Acceptance tests (`ACCEPTANCE.md`)

| # | Test | Status | Evidence / what is missing | Owner |
| --- | --- | --- | --- | --- |
| 1.1 | Scope: select a district; codes listed with whole/partial overlap and the deduplicated body count before sending | built | Composer lists each ZCTA with its overlap and the distinct bodies reaching it (Pima: 56 codes, 96 bodies). Reuse by an existing assignment is shown only for geographies already selected | Redesign |
| 1.2 | Preview: existing holdings and missing work shown apart | built | "What already exists here": way in, never walked, looked with no route, watched, reader-visible | Redesign |
| 1.3 | Budget: the panel says whether it is enforced and by what | built | Enforced before each paid Scout (membership admission); paid work is paused anyway | Redesign |
| 1.4 | Send: created / reordered / blocked counts | built (partial) | Says plainly it creates no new work (MW-028 not built) and reorders registered work | Backend (MW-028) |
| 1.5 | Acknowledgement: five facts, five times | built | Saved, read by the runner, placed first, running, blocked/paused — each with its own time or "not yet" | Redesign |
| 1.6 | Concurrency: lanes with active/waiting/oldest; independence proven | needs recording | Lanes shown per body; no waiting/oldest gauge per lane (MW-029) | Backend |
| 1.7 | Inherited knowledge: exact text given at dispatch, and whether used | needs recording | Recorded on each Scout result since 2026-09-19; "whether used" is not (MW-025) | Backend |
| 1.8 | Model routing: class, why, one escalation with evidence and combined cost | needs recording | No step has ever escalated; the reason is recorded nowhere (MW-031) | Backend |
| 1.9 | Budget enforcement per assignment | needs recording | Per-geography budget enforced; per-assignment does not exist (MW-021) | Backend |
| 1.10 | One new or changed record reaches the public site, with its audit trail | demonstrated (routine) | Morris County, NJ, 2026-09-23. The county withdrew the agenda for its Board of County Commissioners' 7:00 PM regular meeting (its own page now reads "The meeting is not available at this time"). On the deployed Admin, Work → the routine assignment shows: IQM2 portal; retrieved 9:53 AM ET; 1 meeting changed, named; validation passed 9:53 AM ET; promoted as version `cv-362cbf555009…` at 9:53 AM ET; public destination meanwhileusa.com/?zip=07005; checked 9:53 AM ET through the Reader's projection; served now by a later version that changed nothing. On the reader's path, the public meetings API for 07005 lists the same 24 meetings for that board and serves `iqm2:morriscountynj:2248` with no agenda link, while the 5:00 PM work session keeps its agenda. One search-log row written. The owner-assignment form of this test (a selected geography) waits on Sean's approved scope and budget | Redesign |
| 1.11 | Not finished: refused/unsettled visible with three dead-end fields | built (partial) | Three fields shown or named missing (MW-016); refusals roll up per assignment only in part (MW-015) | Backend (MW-015/016) |
| 2 | Unknown is never zero; empty state gives sentences; unanswerable period refused | built | Dashed pills and floors throughout; a state with nothing registered gives two sentences; every figure names its own window (no period selector exists — MW-023) | Redesign |
| 3.1 | A readiness gap opens the assignment that addresses it | built (partial) | A container opens Work with the geography chosen, or the assignment already covering it; gaps are not yet linked to requirement instances by id (MW-063) | Redesign / Backend |
| 3.2 | An assignment lists the requirement instances it addresses | needs recording | No requirement-instance ids exist (MW-063) | Backend |
| 3.3 | A promoted record links to source, checks, assignment and public destination | built (routine meetings) | Body and routine-assignment drilldowns | Redesign |
| 3.4 | Scope holds across areas; panels that cannot narrow say so | built | `?scope=` on every link; Money and Learning say which figures are everywhere | Redesign |
| 3.5 | One queue, one ledger, one status vocabulary | built | The old decision queue and the fleet Decisions tab are deleted; one assignment view; one charge ledger | Redesign |
| 4 | Cost: every provider, bill ≠ ledger, balance ≠ usage, three ceilings, refused rates, test spend | built | Money · Overall spending and Cost of work; manual entry path (`billing.fact.record`); test spend is inside totals and not yet separated (MW-024) | Redesign / Backend (MW-024) |
| 5 | Maintenance does not become a paid re-read | partly shown | Routine re-reads are plain code: $0 model spend by construction. In the 24 hours to 20:12Z on 2026-09-23 the runner made 2,603 routine meeting reads (1,355 got in) and the ledger gained no charge with dollars — the last is 2026-09-22 20:06:54Z. The test as written deploys an assignment against a current body, which is an expansion and waits on Sean's approved scope and budget | Redesign (demo) / Sean |
| 6 | Readiness arithmetic: no sixth number; a gate blocks its own lane; a body counted once; blocked stays unsatisfied; versioned bar | built (partial) | First four hold on the Readiness screens; the standard is code, not versioned data (MW-063) | Backend (MW-063) |

---

## Requirements (`REQUIREMENTS.md`)

| MW | Requirement | Status | Evidence | Owner |
| --- | --- | --- | --- | --- |
| 001 | An assignment is a thing the system knows about | partly | Every unit of work has an id and a full chain (assignment view); an instruction id is not carried onto the work it moves | Backend |
| 002 | Every piece of work names its question | needs recording | Composer keeps the chosen questions in the owner's words only | Backend |
| 003 | Bodies are the unit of attribution | partly | Bodies attributed in the UI from the registry and ZIP index; charges are not attributed to bodies | Backend |
| 004 | Container membership per code | built | Census lookup (Census, merged #346/#363); per-code coverage computed at request time | Census / Redesign |
| 011 | Public delivery is a readback | partly | Routine meetings read back through the reader's projection; paid research reaches no reader while promotion is off | Backend / Sean |
| 012 | Changed versus unchanged | partly | Change sets on every routine promotion; re-keyed agenda documents and iCal series still count as changes (fixes in the Backend batch) | Backend |
| 013 | Every charge records what the work was for | needs recording | Money splits paid spend by each attempt's own recorded result instead | Backend |
| 014 | Skipped work explains itself | needs recording | — | Backend |
| 015 | Visited is not finished | needs recording | — | Backend |
| 016 | No unexplained dead ends | partly | Three fields shown or named missing | Backend |
| 017 | Publishing limit ≠ failed check | needs recording | — | Backend |
| 021 | Per-assignment budget | partly | Per-geography budget enforced | Backend |
| 022 | Every reading narrows to one scope | partly | Bodies, readiness and paid spend narrow; bills, ledger-by-model and decisions say they do not | Redesign |
| 023 | Periods are real or refused | partly | Every figure names its window; no period comparison | Backend |
| 024 | Test runs are separable | partly | Proof lane counted apart; dollars not separated | Backend |
| 025 | What a worker was given, verbatim | partly | Recorded on Scout results since 2026-09-19; "used" not recorded | Backend |
| 026 | Runner acknowledgement is five facts | built | Work · instruction acknowledgement | Redesign |
| 027 | Learning measured over time | partly | One reading per question on Is it learning; no trends | Backend |
| 028 | Deploy creates missing work | needs recording | Send reorders only, and says so | Backend |
| 029 | Concurrent lanes never serialise | works (verify) | Two lanes run together; no per-lane gauge | Backend |
| 030 | Answer in your own words | built | Recorded verbatim through `decision.record`; applied by a person | Redesign |
| 031 | Escalation reason recorded | needs recording | Ladder never used | Backend |
| 032 | Which model is better | partly | Ask comparison ran once (not measured); fleet not compared | Backend |
| 033 | Cheapest suitable first | needs recording | — | Backend |
| 034 | The ceiling is a guard | done | Module-load guard in `model-routing.ts` | Backend (done) |
| 035 | Expensive planning is selective | needs recording | — | Backend |
| 041 | Every provider in one place | built | Money: every provider; manual entry and CSV import; no automated bill read (no billing credential held) | Redesign / Sean (access) |
| 042 | Credits bought ≠ usage | built | Balance and purchase are separate kinds | Redesign |
| 043 | Three kinds of ceiling | built | Money ceilings | Redesign |
| 044 | Cost per result needs numerator and denominator | built | Per-outcome prices from recorded results; refusals otherwise | Redesign |
| 045 | Reconciliation is explicit | built | Generated reconciliation lines | Redesign |
| 051 | Maintenance is cheap and scheduled | works | Routine reads are plain code; before/after charge proof is part of acceptance 5 | Redesign (demo) |
| 052 | Meetings coverage states six things | built | Six cells per body | Redesign |
| 053 | Four stages with failures between | partly | Body and assignment chains | Backend |
| 054 | Promotion history is complete | partly | Routine promotions carry version, time and change set | Backend |
| 061 | Five readings, five denominators | built | Readiness state screen | Redesign |
| 062 | Blocked and never-attempted stay unsatisfied | built | Grid counts keep them in the denominator | Redesign |
| 063 | The checklist is versioned data | needs recording | What counts as done says so | Backend / Sean |
| 064 | A blocker stops only its own lane | built | Collection status | Redesign |
| 065 | Anything a check can answer is queued | works (verify) | — | RouteTask |
| 066 | Could-govern ≠ confirmed representation | works | Coverage keeps registry membership apart from way-in | Redesign |
| 071 | Live status for active work | partly | Pulse route drives decision staleness; no live strip | Backend |

---

## Delivered by the other sessions (their evidence, recorded as sent)

| Session | Delivered | Evidence | Remaining, recorded separately |
| --- | --- | --- | --- |
| Vault — complete (handoff 2026-09-23, re-checked 17:41Z) | Held evidence is readable by the runtime: 473 objects restored from the main checkout's vault (#362, merge f0767e02) and 23 from an agent worktree's vault (#370, merge cee32592), add-only, sidecars byte-identical; the deployed tool finds 0 of 3,731 records held only in an old vault. Worker artifact resolution reads any complete, admitted record of an artifact (#367, merge 8e21f229): 10 of 10 previously failing ids read, 0 NOT_IN_VAULT across the 339 restored ids | `docs/evidence/runtime-vault-restore-2026-09-22.md`, `docs/evidence/runtime-vault-restore-agent-worktree-2026-09-23.md`; #362 and #367 comments | 4 binary bodies refused at `issueParserInput` (UTF-8 only) — Backend. 57 records with bytes in no vault: 17 restricted by design; 40 raw, recoverable only by a new walk (including 2 Pima Legistar parser tasks) — no owner or budget; Sean decides whether they matter |
| Census — delivered | The Census geography lookup behind every district, county and metro choice | #346, #363; `docs/meanwhile-admin-requirements.md` row 3 | The 2026 district build, only if Sean picks a redrawn state |
| RouteTask — delivered (#368, #372) | #368 (merge d4b7edde, verified 17:54Z): an obligation the registry stops emitting is retired with a named reason. First cycle: 23 superseded rows retired, 20 legacy rows' open occurrences settled, 40 occurrences closed unresolved, 17 debts tombstoned; nothing deleted, no RouteTask, lease or Attempt written. Admin's live-obligation and open-occurrence counts no longer include that dead work | #368; #372 (merge 41d4c724) post-deploy receipt: read-only check at 19:49:43Z against a 19:07:32Z before-image, first cycle on runtime 41d4c724 at 19:34:18Z — 19 of 19 abandoned occurrences closed unresolved ("ABANDONED: … Nothing was read and nothing was refreshed"), their 19 RouteTasks unchanged, no Attempt, lease or commit written, all 19 obligations still active, nothing deleted. That cycle was killed at the 15-minute wall after its work finished, so it wrote no digest line; the receipt is read from the store | #372 closed 19 abandoned occurrences from 2026-09-01, with a guard against new ones — dead work removed, never work done. Meetings discovery moves to the gap ledger tonight with Backend's reader batch: owed for 2,641 jurisdictions (1,975 with a known site never walked, 666 with no website recorded); **nothing performs it** — the only executor that walks a site is the paid Scout lane, closed under the research pause |

Data meanings the screens rely on: `WORKER_ARTIFACT_NOT_IN_VAULT` now means no complete, admitted record of the artifact is held anywhere the runtime reads — a true absence. A worker's evidence names the Attempt whose bytes were actually read, which can be later than the first record carrying that artifact id. An obligation with `active=false`, a `retiredAt` and a `retirementReason` (SUPERSEDED, MOVED TO THE GAP LEDGER, or a legacy transfer reason) is retired history, not live work. An occurrence closed with no disposition and an `unresolvedReason` (SUPERSEDED, MOVED TO THE GAP LEDGER, ABANDONED, or the row's own retirement reason) is a closure, not a reading, and never counts as work done. A debt with zero failures and "…the obligation was retired (…). Not a reading" is a tombstone, not a discharge. Meetings discovery needs recorded in the gap ledger are **owed, with no executor** — never shown as scheduled work.


---

## Earlier owner feedback the design does not carry (recorded, not built in this delivery)

The design package is the spec, so where it draws no place for something the old console had, the
thing went with the old console. Each is recorded here, and in the feedback sweep where it has a
row, so none reads as still fixed. Whether any returns is Sean's call.

| Item | What went | Where it stands |
| --- | --- | --- |
| ADM-9, POS-10 (9.4.26) | The light/dark toggle in the header. The design is dark-first and writes no theme; its prototype carries light values "so a port has somewhere to land" | Sweep `checkDebt` — not counted fixed. Restoring it means wiring the toggle over the design's light values and re-checking every screen in both themes |
| ADM-18 (9.4.26 evening) | The owner-facing reader-suite section on the old home page. The reading survives only on the fleet operations map's Panels tab, in engineering terms | Sweep `checkDebt` — not counted fixed until the design gives the reader check a place |
| POS-12 | The spend-by-role and spend-by-day charts | Money draws AI usage by provider and model, and model money by place, instead |
| ADM-C14 (part) | The per-model cache hit rate and caching saving | Money's model table carries charges, measured dollars, unpriced charges and share |
| Health legend | The Pilot health contract cards and grade-scale legend | The health contracts reach the owner as the Gates reading on a readiness state page |

---

## Track everywhere, without a code change (Sean, 2026-09-23)

Sean's direction, on learning that tracking stops at three states: *"This shouldn't be a code change - new areas states
will be added rapidly, it needs to be able to track and keep up everywhere, not just a small subset"*, and of the three
things an area needs to be trackable end to end, *"This needs built, whether it's in this session or the admin and worker
cost visibility session"*.

What exists today (measured 2026-09-23): the published Census lookup already covers every state (Ohio: 88 counties, 15
congressional districts, 44 metros, 33 and 99 state legislative districts), so Admin can already accept an instruction
for any county, district or metro. Three things stop at three states: the coverage list is code (`COVERED_STATES` in
`lib/coverage/states.ts`, read by Admin, expansion, coverage artifacts, the ballot and funding readers, and two build
scripts); the ZIP index that places bodies on codes holds 279 ZIPs, all AZ/NH/NJ; and nothing does discovery (the paid
lane is paused and no unpaid executor exists).

| Part | Owner | Status |
| --- | --- | --- |
| Admin tracks every state from data. All states lists all 56 states and territories. An unregistered one says what the Census knows is there (its governments by type and its ZIP codes) instead of zeros; the state page and Now say the same. The composer offers every state | Redesign | built (PR C). It uses the national Census of Governments and ZIP lattice files already in the repository, so adding a state needs no code |
| A nationwide ZIP index: every ZIP code mapped to the county, municipality, township and school district whose territory reaches it, with ids built from the Census names. 33,791 ZIPs in 99 files, one per two-digit ZIP prefix (8.7 MB), ZIP for ZIP identical to the first one-per-ZIP3 build; committed ids never move. It names one id the committed geometry already shares between two districts, and one stale id in the old index | Redesign | built; every reader of the old file switched (reader, Ask, health, holdings, Admin, the runner's readiness snapshot). The old three-state file (279 ZIPs: Pima, Morris and Merrimack counties only) is superseded, its exact bytes kept as the test baseline. Proved on the local production build: 07866 keeps its full ballot; Admin places bodies on codes in 12 New Jersey counties where it placed them in 1; 43215 (Columbus, Ohio) now reaches the reader with its partial school districts but renders nothing until Ohio is registered. Lands as its own reader batch with one full reproof, after Backend's reader batches |
| Registration without per-state code, kept current by the runner. Sean's choices (2026-09-23): the runner keeps each state's registration current, and picking an area in an untracked state registers that state. It emits each government's jurisdiction id and OCD id and mints governing bodies (`<ocdId>#governing`, `<ocdId>#board`) | Redesign | designed; its data-plane parts go to Backend for review before any build (contract, authority, promotion path, one writer under RULINGS 282/283) |
| Splitting the reader's registry projection per state. One national projection would be about 150 MB (3.6 MB holds 1,998 bodies today), so bodies can be minted everywhere only after it splits; each state's projection stays well under the 64 MiB response cap | Redesign (handed over by Backend 2026-09-23, Backend reviews) | Needed before bodies are minted beyond the three states. Until then bodies are minted only where a projection member exists |
| Two school boards that do not exist. The registry minted a board on the Census's "no unified school district here" land in Arizona and New Hampshire. Each counts as a registered body (Admin's Coverage reading and the readiness denominators are one high in each state), and school-board routing names it to a reader inside (the centers of 16 ZIP areas fall inside) | Redesign | Rule built and committed (c5be427c, rides the ZIP index batch): no body is derived on a placeholder, a promotion refuses one and drops it, reads keep serving until the correction promotes, and the reader census no longer counts the two frozen records. Removing them from production waits on Sean: the owner door refuses the registry imported at the transfer (it has no source receipt), so no registry correction can promote. Options put to him 2026-09-23 |
| A runner-scheduled promotion kind for rows derived from already-promoted inputs, with no route of their own ("DERIVED") | Backend (proposed by RouteTask) | Proposed. The wiring store needs it; registration may fit the existing routine kind instead |
| MW-028: sending a geography creates its missing work (registry-derived requirement instances become obligations and RouteTasks through the durable path, capped by the budget, with created / reordered / blocked counts on the receipt). Its unit list is read from the registration data, never from a code list | Backend | in progress |
| The unpaid meetings-discovery executor under the standing runner (robots-first walks of the owed sites, vendor-pattern probes, no model) | RouteTask | Built and switched off (heads: executor 538ddc24, recipes 53ee6f8c, search 0ec9e495). Local gates on the search head: 15 of 16; the test gate's 4 failures are a guard that read a variable as a table read (fixed at 0ec9e495), the reader receipt awaiting Backend's re-proof, and two heavy reader tests that pass alone. It merges after Backend's batch. Turning it on is Sean's go (tracker NS28, on its branch) |
| The meeting-source wiring store: a find that passes four checks is wired on the runner's clock, so no body's source is a code change. The checks: the body exists, the host is authorised, the site permits it, and the route yielded within 30 days | RouteTask and Backend | designed; waits on the promotion kind above |
| The reader's completeness sentence for places not fully collected. Sean's wording is "We are showing what has been collected and are continuing acquiring more info to show you.", shown once per page | Sean | Asked whether it replaces RULING 254's sentence and its per-gap wording. Nothing changes until he answers |
| Demonstrating any of it on a new area | Sean | waits on an approved scope and budget; building does not |

---

## Shipping

| # | Item | Evidence | Status |
| --- | --- | --- | --- |
| P1 | PR A — the redesign on existing reads, the billing-figure actions, the research route's JSON answer | #373: local gates 16 of 16 run as CI runs them (7,162 tests, 0 failing); 11 required checks green on `c014400c`; merged as `65f0c6f6` at 20:09:17Z; Netlify's deploy record shows `65f0c6f` live at 20:11:11Z (deploy `6ab431ef…`), read without a request to the site | deployed |
| P2 | Redirect host fix: nine redirects in seven admin routes build their Location from the admin origin, with a guard over `app/api/admin/**` and `app/(admin)/**` | #371 (Backend), merge 94ab9213, served from 18:22:25Z. Read-only probe of a failed Google sign-in callback: before (17:46:11Z) `303 → https://meanwhileusa.com/admin/login?why=BAD_STATE`, the public host, a 404; after (18:22:33Z) `303 → https://admin.meanwhileusa.com/admin/login?why=BAD_STATE`. The first owner button press is the live confirmation of the write path | verified (read path) |
| P3 | Signed-in walk of admin.meanwhileusa.com, side by side with the prototype; values checked against records | Walked 20:12–20:25Z in Sean's signed-in session: content and values per screen, recorded in the first table above. It found the cold-load failure and the two-source undercount, both fixed in P5. Pixels were compared at 1280 px against the design's own captures (screens 06, 11 and 17, and Fleet · Now), on local production renders of the deployed code, because the Browser pane is narrow and usually hidden. Look and structure match; the figures are live values where the design shows samples. The one organizational difference, the runner card above Work's composer, moves below it in P6 | verified |
| P4 | Assignment-to-publication demonstration (acceptance 1.10 and 5) on the deployed site | Routine form demonstrated: Morris County, acceptance 1.10 above. The selected-geography form waits on Sean's approved scope and budget | routine form done |
| P5 | PR B — every page inside the host's time limit, the records-held floor, phone width | Reads shared by concurrent callers, recent reads served while refreshed, and a six-second deadline per read that names a late read as not read this time, never as none; locally a cold All states page went from ~13.5 s of reads to 7.2 s. Records held counts a two-source body's larger source and says the total is a floor (596 → at least 608). At 375 px no page is wider than the screen. #374: local gates 16 of 16 run as CI runs them; 11 checks green on `144a0521`; merged as `72e9dcb5` at 21:14:54Z and live at 21:16:14Z. The first, cold loads on the new deploy completed — All states in 10.8 s, Work in 9.7 s — slow, but whole | deployed |
| P6 | PR C — Admin tracks every state: all 56 rows on All states, each unregistered state's Census universe, the composer offering every state, and the runner card below Work's instruction and assignments (the design does not draw it) | Admin-only; waits for Backend's reader batch to merge, then gates, CI and merge | built |
