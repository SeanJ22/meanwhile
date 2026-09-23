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

## What Sean can do in Admin (once PR A is deployed)

| Area | What | Status |
| --- | --- | --- |
| Every page | One header: Fleet / Readiness, one scope filter that holds across both, Other pages. The old View/State header is gone everywhere. | built |
| Fleet · Now | Read what is working, what isn't and where to put effort, each counted from the lists beneath; answer each decision with an option or in his own words; open any watched body. | built |
| Fleet · Work | See the runner and pause/resume it; choose a geography (kind, then place) and see every ZCTA it covers and what already exists there before sending; send it with a priority and a budget; watch the runner acknowledge it; open any assignment in place. | built |
| Fleet · Money | See the three ceilings (and change the in-app dial), every provider with its reading or NO READING, AI usage by model, spend by place, what paid work produced; enter or import a bill the system cannot read. | built |
| Is it learning · Fix list | Read what the records say about learning today; order the MW items; put one on the fix queue; send the queue. | built |
| Readiness | All states; one state's collection status, five readings and gaps by district, county or metro; County → Pima → its 56 ZCTAs with coverage, gaps and work; What counts as done. | built |

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
| 1.10 | One new or changed record reaches the public site, with its audit trail | built — to demonstrate | Routine reads carry it end to end today (read → change set → validated → promoted version → reader readback). An opened routine assignment's trail follows the latest version that changed what readers see — source, retrieval time, what changed with the meetings named, validation time, promotion time and version, public destination, first readback — and names the later version serving now, which re-confirmed it. Candidate for the demonstration: Morris County, NJ, where the county withdrew the 7:00 PM agenda for its September 23 meeting; read, validated, promoted and read back at 9:53 AM ET that day (version `cv-362cbf555009…`) | Redesign (demo) |
| 1.11 | Not finished: refused/unsettled visible with three dead-end fields | built (partial) | Three fields shown or named missing (MW-016); refusals roll up per assignment only in part (MW-015) | Backend (MW-015/016) |
| 2 | Unknown is never zero; empty state gives sentences; unanswerable period refused | built | Dashed pills and floors throughout; a state with nothing registered gives two sentences; every figure names its own window (no period selector exists — MW-023) | Redesign |
| 3.1 | A readiness gap opens the assignment that addresses it | built (partial) | A container opens Work with the geography chosen, or the assignment already covering it; gaps are not yet linked to requirement instances by id (MW-063) | Redesign / Backend |
| 3.2 | An assignment lists the requirement instances it addresses | needs recording | No requirement-instance ids exist (MW-063) | Backend |
| 3.3 | A promoted record links to source, checks, assignment and public destination | built (routine meetings) | Body and routine-assignment drilldowns | Redesign |
| 3.4 | Scope holds across areas; panels that cannot narrow say so | built | `?scope=` on every link; Money and Learning say which figures are everywhere | Redesign |
| 3.5 | One queue, one ledger, one status vocabulary | built | The old decision queue and the fleet Decisions tab are deleted; one assignment view; one charge ledger | Redesign |
| 4 | Cost: every provider, bill ≠ ledger, balance ≠ usage, three ceilings, refused rates, test spend | built | Money · Overall spending and Cost of work; manual entry path (`billing.fact.record`); test spend is inside totals and not yet separated (MW-024) | Redesign / Backend (MW-024) |
| 5 | Maintenance does not become a paid re-read | built — to demonstrate | Routine re-reads are plain code: $0 model spend by construction; paid research is paused | Redesign (demo) |
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
| RouteTask — delivered, one PR in the train | #368 (merge d4b7edde, verified 17:54Z): an obligation the registry stops emitting is retired with a named reason. First cycle: 23 superseded rows retired, 20 legacy rows' open occurrences settled, 40 occurrences closed unresolved, 17 debts tombstoned; nothing deleted, no RouteTask, lease or Attempt written. Admin's live-obligation and open-occurrence counts no longer include that dead work | #368; post-deploy receipts to follow for #372 | #372 (in the train after #371): 19 abandoned occurrences from 2026-09-01 closed, with a guard. Meetings discovery moves to the gap ledger tonight with Backend's reader batch: owed for 2,641 jurisdictions (1,975 with a known site never walked, 666 with no website recorded); **nothing performs it** — the only executor that walks a site is the paid Scout lane, closed under the research pause |

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

## Shipping

| # | Item | Evidence | Status |
| --- | --- | --- | --- |
| P1 | PR A — the redesign on existing reads, the billing-figure actions, the research route's JSON answer | required checks green, merged, deployed | built |
| P2 | Redirect host fix: nine redirects in seven admin routes build their Location from the admin origin, with a guard over `app/api/admin/**` and `app/(admin)/**` | #371 (Backend), merge 94ab9213, served from 18:22:25Z. Read-only probe of a failed Google sign-in callback: before (17:46:11Z) `303 → https://meanwhileusa.com/admin/login?why=BAD_STATE`, the public host, a 404; after (18:22:33Z) `303 → https://admin.meanwhileusa.com/admin/login?why=BAD_STATE`. The first owner button press is the live confirmation of the write path | verified (read path) |
| P3 | Signed-in walk of admin.meanwhileusa.com, side by side with the prototype; values checked against records | screenshots per screen | todo |
| P4 | Assignment-to-publication demonstration (acceptance 1.10 and 5) on the deployed site | a routine assignment followed from read to reader; and, only with Sean's approved scope and budget, one selected geography | todo |
