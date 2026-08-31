# Frontier

Updated: 2026-08-31 (rev 5 — post Session B close). Priorities only — never
invariants (the generated constitution), never status claims (generated status
ledger). This is a mutable planning artifact, not law and not a governance
input.

## The three-question split

GitHub Actions answers: "Is this code safe to merge?" The ingestion runtime
answers: "Is the civic information fresh?" The production-integrity system
answers: "Is the deployed application healthy?" Never one notification stream.

## Sequence

1. Reconcile governance and contracts (Session A): rulings adopted under
   canonical IDs with explicit supersessions; Reader/Truth/Freshness contracts
   defined; ReaderQuestion, ControlFact, and VisualAcceptanceCheck schemas;
   scheduler persistence-provider decision recorded with migration/adapter
   plan (no migration executed); JOB16–18-class measurements rerouted from
   Needs-Owner to operational incidents.
2. Make the loop observable (Session A): suite scaffold running with honest
   zero-state and recorded render target; control-set plumbing with
   harness-only blindness proven at the context-assembly boundary; generated
   status ledger distinguishing SESSION_MEASURED from INDEPENDENTLY_REPRODUCED;
   generated repo inventory joined to the mirror via scripts/mirror-set.mjs.
3. Make freshness autonomous in shadow (Session B): authoritative due-work
   scheduling off GitHub cron onto the decided provider; derived next-due;
   freshness debt; deterministic routes running without commits or deploys.
   Cron-delay evidence (186–313 min typical, ~699 worst) is the standing
   justification. FRESHNESS reports NOT_READY until this is independently
   proved.
4. Connect scheduler to disposable workers (Session B/C): reuse the existing
   WorkItem/RouteTask/Attempt/lease/reclaim substrate — the lower half is
   built and exercised; only the dispatch upper half is new.
5. Overnight proof: repeated unattended cycles including at least one genuine
   route failure absorbed by retry/reclaim, each producing a correct digest
   whose headline is PILOT HEALTH (Reader + Truth + Freshness), activity
   counts beneath.
6. Activation gate: Reader green and stable on PRODUCTION_RENDER, Truth
   trustworthy on both false absence and false presence, Freshness within
   tolerance — all INDEPENDENTLY_REPRODUCED, never session-measured.
7. Level 2: verified low-risk civic-data promotion without sessions, branches,
   or deploys.

## Explicitly deferred

External orchestration (revisit trigger per the adopted ruling). New
multi-project investment. Level 4 auto-publishing past 2026-11-03. <!-- expected-future: the author's Level-4 automatic-publishing deferral horizon, deliberately past the 2026 general election -->
Level 5 removed. National activation (pilot health green and stable, plus
cost-model national math from measured pilot numbers).

## Carried forward from Session B (2026-08-31)

Priorities, not status. What the closing sweep left standing, and what each is
waiting on.

### Waiting on the owner, and published where he reads them

Six rows, `needs-sean` section, `OWN01`–`OWN06` — each carries what is needed,
why the machine cannot proceed, what was tried, and what continues without it.
Four are one decision each; two are one approval each.

- **`OWN03` / OFF-9 is the cheapest of them.** The acquisition already ran: 9
  statewide portraits are queued off the offices' own pages, decoded and
  name-matched, Mayes at 442×553. RULING 55 reserves the review to the author,
  so approving them is the entire remaining step.
- **`OWN02` / OFF-8** names 5 Tucson portraits whose 480×720 originals are
  publicly available, and 138 where the government publishes nothing larger —
  the second half is a source decision (a different door for a sitting
  official), not a render one.
- **`OWN05` / BAL-36** and **`OWN06` / BAL-37** are both ask-before source
  additions: state executive-action records, and an address typeahead with its
  own privacy question about partial addresses leaving the product.

### The check debt, which is the biggest thing this session found and did not fix

Thirteen rows of the 8.30.26 sweep were recorded FIXED against `vac:` check ids
naming a VisualAcceptanceCheck store that **does not exist** —
`data/health/visual-checks.json` is not on disk and the suite's last run
recorded `checksLoaded: 0`. They are enumerated on the sweep's `checkDebt`,
printed on every `feedback:sweep` run, and **not counted verified fixed**.

Closing them needs two things this session deliberately did not start, because
each is a workstream rather than a repair:

1. **`visual-suite.mts` has no evaluator for any DOM-certifiable property.**
   `text_content`, `element_presence`, `element_count`, `link_target` and
   `stated_n_equals_rendered_rows` all fall to the `default:` branch and return
   `NOT_EVALUABLE`. So a `vac:` check could not be graded even if one existed.
2. **The twelve checks themselves**, authored against the surfaces the rows are
   about. The probe data for most of them is already measured — the
   who-governs disclosure, the statewide slate, the ballot contact routes.

### A reader-facing gap the WGH-22 hunt turned up — FIXED 2026-08-31 (Session C)

**A street the Census carries only at the address level is refused by the
street-only form.** `South Bear Table Tank Drive` in 85641 — the owner's own
address — returns `FAILED / NOT_FOUND` from `/api/address/resolve` in every
street-only spelling, and resolves completely the moment a house number is
supplied. The prompt asks for a number only when a street is AMBIGUOUS, so that
branch never fires: the reader is told we could not place their street while
the resolver would have placed their house. Common on rural and named-feature
roads.

**Session C fixed it, because it turned out to be half of WGH-22 rather than a
gap beside it.** With no house number the resolver probes a fixed ladder — 1,
50, 200, 800 — and the owner's road is numbered 10701-10899, so every probe
missed. The prompt now ASKS for the number on a `FAILED` result where none was
supplied, instead of asserting an absence out of our own empty result, and the
promise under the form names both reasons a number is wanted. Only a number
that was supplied and still failed is reported as a failure.

This was load-bearing for WGH-22 and not merely adjacent: with the street
unplaceable the reader could never confirm an address on it at all, so the
who-governs panel could not have moved even after the notification defect was
repaired. Both had to be fixed for the owner's screen to come right, which is
why the deferral above could not have held.

### At two pilot ZIPs the who-governs card offers no way to settle what it says is unsettled

Found 2026-08-31 (Session C) while building the reader-interaction check for
WGH-22, and **measured on the rendered DOM rather than reasoned about**.

At 85701 and 03255 the who-governs card renders its three state and federal seat
rows as `UNSETTLED` — *we have not been told enough to say* — and the card
carries **no address control at all**: no `could-govern` pill, no
`address-prompt`, no trigger. Measured on the local production build after
opening the card at each ZIP. At 85641 and 07866 the pill is present and the new
`SC0831` checks drive it.

The cause is structural rather than accidental. WGH-7 (2026-08-24, the author's
ruling) deleted the second address door on this card — *the pill is the single
entry point* — and the pill is `CouldGovernNotice`, which returns `null` when no
row carries the could-govern mark. Where nothing is marked, the single entry
point does not render, and the unsettled rows have no door beside them.

So the reader is shown a question and denied the answer on the surface that
asked it. The address can still be given on the ballot page, which is a
different surface and a different question.

**Not fixed here, and deliberately.** Where that door belongs is a design
decision on a surface the author has ruled on twice, and the ruling that removed
the second door is the reason there is now none. It falsifies no acceptance
criterion of this session and is not a regression from its changes (RULING 221).
The three `SC0831` checks at each of these ZIPs DECLARE `COULD NOT RUN` naming
the missing field, so the gap is visible in every walk rather than silent.

### A gate can fail without recording what failed

Observed 2026-08-31 (Session C). Gate run `2026-08-31-25` recorded
`test … FAIL (42s)`; run `2026-08-31-26`, on a byte-identical working tree with
no intervening edit, recorded `14 of 14 gates green`. `pnpm test` run directly
either side passes at 4266/0.

So one of the tests is flaky — and **it cannot be named**, because
`data/ops/gate-runs/*.json` stores `{id, ciJob, command, status, seconds}` and
nothing else. The failing output is printed to the console and then discarded,
so a gate failure that is not watched live leaves no evidence of its cause.

That matters more than the flake does. A gate set is the instrument the shipping
law rests on, and this one can say NO without saying why — which on CI, where
nobody is watching the console, is a red run with an unrecoverable reason. The
run record should carry the failing gate's captured output, or at minimum the
failing test names.

Recorded rather than fixed: it falsifies no acceptance criterion of this session
and is not a regression from its changes (RULING 221). The walk suite already
does this correctly — `data/health/walk-runs/*.json` carries per-check evidence.

### Session C — verified ground truth for the Parts it did not reach

Session C was directed to deliver Parts A–J. It delivered **A** (and Part H item
4, which turned out to be the same fix). Before starting it measured the ground
each remaining Part stands on, and **several premises the directive carried are
false**. They are recorded here so the next session resumes from measurement
rather than from the brief. Every line below was checked against disk or against
a running build.

**Part B — the tracker.** 389 open rows, 72 `needs-sean`, confirmed by parsing
`docs/tracker-working.csv`; the generated view agrees. The state column is
`Section`, value `needs-sean` — not `Resolution`. **There is no opened-date
column and never was**; the dates live in a sidecar, `docs/tracker-opened.json`,
where **89 of 193 entries are `reconstructed: true`** with placeholder values, so
only 42 of the 72 needs-sean rows can resolve to a real ISO date. Backfill has a
ceiling, and UNKNOWN is the honest value for the rest. There is **no verification
predicate concept anywhere in the tracker tooling** — `reconcileTracker`
(`lib/ops/tracker-transaction.ts`) verifies the TRANSACTION, never the claim a
row makes. **NH281's own session record already states its premise has cleared**
and it stays open by policy (R-0079), not by evidence; NH300 shows no such
evidence.

**Part C — the check debt.** The 13 rows are real, but `CHECK_DEBT` is not a
disposition: it is a parallel list, `SweepRecord.checkDebt`, and 10 of the 13 are
`FIXED_VERIFIED` while 3 are `POSITIVE_KEPT`. All 13 fail for **one** cause —
`data/health/visual-checks.json` does not exist, and the loader
(`scripts/visual-suite.mts:134`) returns `[]` silently rather than failing.
**The blocking fact the directive does not state: there is no DOM evaluator at
all.** All eight implemented evaluators in `lib/health/visual-evaluation.ts` are
pixel-based, and none of the five `DOM_CERTIFIABLE_PROPERTIES` has a dispatch
case — so authoring the 13 checks is not enough; the evaluator half must be
built first, or every one of them renders `NOT_EVALUABLE`.

**Part D — the obligation registry.** Confirmed: the corpus is meetings-only,
hardcoded at `lib/control-plane/scheduler/obligations-from-corpus.ts:101` and
`:103`. `arizonaLocalObligation()` is reached only from
`campaignFinanceObligations()`, **which itself has zero callers anywhere** — and
it returns `CampaignFinanceObligation`, not `FreshnessObligation`, so it is not
even the right type to hand to `syncObligations`. A second provider needs three
concrete edits, not an abstraction: the import at `scripts/freshness-shadow.mts:60`,
the record-class literal, and the URL map at `:145-153`. **Nothing schedules
`pnpm freshness:shadow`** — no cron, no workflow. It runs one cycle when a human
types it.

**Part E — Arizona money.** The directive assumes the held corpus can be
normalised to readers. **It cannot, and this was measured rather than reasoned
about.** All 43 committee names in `az-pima-2026-transactions.json` are Pima
County school-board and PAC committees; all 15 pilot contests that carry
candidacies are statewide, federal or legislative — offices that file with the
**AZ Secretary of State**, not the county. Comparing every committee name against
every pilot candidacy gives **zero matches**, and `judgeMatch` requires name AND
office AND year. Two facts that change the ask: the reader surface is a **missing
file, not missing code** — `lib/funding/state-snapshot.ts:28-32` already names
`state-money-az-2026.json`, "AZ" is already a legal `MoneyJurisdiction`, and
`next.config.ts` traces `data/funding/*.json` by glob — and the held Arizona money
**already reaches readers today** through Ask, for the Vail governing board, via
a deliberately one-entry crosswalk at `lib/ask/local-finance.ts:145`. The bridge
to the pilot ballot is the AZ SOS regime, which is unacquired.

**Part F — New Hampshire money.** The directive says the higher rungs were never
worked. **That is false.** Rung 7 WORKED on 2026-08-21 — visible browser, read the
app's own JS bundles, called `cfsapi.sos.nh.gov/api`
`PublicFilerDetails/GetFilingEntityDetails` from the page's own origin — and the
harvested filer records are committed. The 8/26 403 is real but covers only
`/public/cf/downloads` at rungs 2 and 3. **The debt is that the working route was
never written to `data/method/knowledge.json`** (store is at v61; a new route now
MUST carry a claim class). Rung 13, the Department's public-records path, has
never been walked and was named as the next session's start on 2026-08-19. An
untried lead is recorded and applies here: `identified-agent-refused` measured
that 32 of 40 `*.nh.gov` hosts serve an anonymous request and refuse every client
carrying this project's name.

**Part H — W6.** No `cache_control` exists anywhere in any API path. Ask is
`claude-opus-5` at two rungs (`lib/ask/interpret.ts:101`,
`lib/ask/synthesize.ts:43`), called by raw `fetch` with no SDK. **Token usage is
never read on the Ask path at all** — `body.usage` is ignored at both call sites,
so there is no hit rate to report until that is added. Both rungs pass `system` as
a plain string, so caching requires converting it to a block array first, and in
`interpretPrompt` the per-ZIP inventory sits inside the would-be stable prefix, so
ordering must change before anything is shareable across ZIPs. For the fly-in:
`components/map/map-canvas.tsx:1446-1466` runs `queryRenderedFeatures` and a React
`setState` on **`sourcedata`**, unthrottled and ungated by `moveend`, throughout
the 2600ms flight. `pnpm measure:fly` already exists and deliberately asserts no
frame budget.

### Still open from the sequence above

W6's overnight proof and the activation gate are untouched by this session and
stand exactly as written. The **model half of cost truth is now PROVEN** — see
`pnpm model:proof` — so item 4's dispatch upper half has one real
`BOUNDED_MODEL_WORKER` Attempt behind it with provider-reported usage and a
computed cost, rather than a lane label.

### The check-identity baseline can no longer be written, and nothing says so

`docs/walk-checks.txt` is the set of every check `walk:all` HAS, and it exists
so a run diffs by set difference rather than by subtracting two totals — *a run
that loses three checks and gains seven reports +4 either way, and the check
dying quietly is the failure this suite exists to catch.*

It is written **only** on a run where `AGAINST_PRODUCTION` is true. RULING 125
(2026-08-24) refuses a production run outright, at the top of the same file. So
the baseline has been frozen since that ruling landed, every session's new
checks accumulate as `+ ADDED` forever, and the GONE detection degrades as the
gap widens. This session added 22 identities and the file did not move.

**It is not a one-line fix**, which is why it is here rather than done. Writing
it from a local run would DELETE the production-only identities — the deploy-id
and build-SHA checks a local build genuinely cannot run — which is precisely the
quiet check death the file was built to catch, committed by its own repair. The
baseline needs to record which checks EXIST across both targets, or to merge
rather than overwrite, and that is a design decision.

Discovered 2026-08-31 while verifying the merge. It falsifies none of this
session's acceptance criteria and is not a regression from its changes, so it is
recorded here rather than taken into the denominator (RULING 221).
