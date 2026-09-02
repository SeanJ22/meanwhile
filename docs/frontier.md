# Frontier

Updated: 2026-08-31 (rev 6 — post Session C resume). Priorities only — never
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

## Carried forward from Session C (resume) — 2026-08-31

Priorities, not status. Every item below is something this session deliberately
left, with what it is waiting on. Nothing here is a claim that it is finished.

### Waiting on the owner

- ~~**`pnpm pilot:install` from an ELEVATED PowerShell.**~~ **DONE by the owner,
  2026-09-01.** The Windows Scheduled Task "WeThePeople Pilot Runner" is
  installed and started — restart every 5 minutes, at logon, 1 process, with
  promotion OFF. Restart-on-crash is now satisfied rather than partial.
- ~~**OWN03 — nine portraits, one look.**~~ **APPROVED by the owner, 2026-09-01,
  and all nine now render.** Verified per person on the rendered DOM at 85641,
  85701 and 07866. Tom Horne was never among the nine and is not a decision
  waiting on the owner — his portrait is an open acquisition obligation.
  **What IS newly his:** four of the nine are Sitefinity thumbnails, and the
  full-size originals (2533–3275px) are staged in
  `data/photos/door2-azcc-originals-2026-09-01.json` awaiting a second look.
- **69 Needs-Sean rows, each with a decision card.** All are marked
  `NOT_MACHINE_VERIFIABLE`; the three that carried a checkable predicate
  auto-resolved and left the queue.
- ~~**The `tracker amend` guard.**~~ **RULED, 2026-09-01 — RULING 231.** A later
  session corrects an earlier session's false description of a named person
  through a RECORDED SUPERSESSION that preserves the original text and cites
  evidence about the person. The guard is preserved and direct edits stay
  prohibited; what changed is that there is now a lawful path where there was
  none.

### Executable, and not reached

- **The Ask model comparison (H2) is MEASURED and the decision is RETAIN.**
  Amended by the owner on 2026-08-31 from a deferral to a work item, and done:
  7 canonical questions, 3 passes per arm, decision RETAIN `claude-opus-5`
  because Q5 does not hold on the challenger. See the two entries below for
  what the comparison actually surfaced. The harness now exists —
  `pnpm ask:model-compare`, a comparison-only seam OUTSIDE the production
  request path: `SynthesizeOptions` has no model field, the production route
  emits `ASK_SYNTHESIS_MODEL` even when handed the challenger's id through an
  untyped cast, and nothing under `app/` imports the seam. Comparison caches
  are DISABLED rather than isolated, because a cache read prices a model by
  arrival order and whichever ran second would look up to 10× cheaper for a
  reason unrelated to the model — so the dollar figures are an UPPER BOUND on
  production cost, where H1's cache is live.
- **H3 is MEASURED and PASSES the host-normalized criterion — and the number
  that argued the old one is WITHDRAWN.** The owner replaced the absolute 55 fps
  target with *application median ≥ 90% of bare-map median on this host*.
  Measured over 6 interleaved pairs: bare **60.06 fps** median, application
  **59.88**, **ratio 99.7% — PASS**. The host reaches smooth motion, so the
  host-limit clause did not fire.

  **The `41.3 fps` "bare floor" cited everywhere before this is false and is
  withdrawn.** The bare arm was never bare: the ablation removed 24 district
  layers and 8 sources and `syncDistrictLayer` put every one back
  synchronously, throwing nothing and logging nothing. Measured live — 24
  layers / 8 sources before, 45 things removed, 24 layers / 8 sources
  immediately after. Every number taken through that arm described a fully
  loaded map with markers hidden. The fix blocks `addSource`/`addLayer` for
  `district-*` BEFORE removing anything and reads back at landing, or discards
  the flight; the bare arm now fires 0 `sourcedata` events and 0
  `queryRenderedFeatures` calls against 303–536 before.

- **The statistics disagree, and the disagreement is the finding — and it is
  STILL OPEN on hardware after the no-GPU repair closed.** Median ratio
  99.7% passes; **p95-sustained ratio is 66.2% and would fail**. The 2026-09-01
  software work took the sustained and jank half seriously for the software
  population and installed a criterion that requires ratio AND jank there; the
  HARDWARE criterion is still median-only, and the 66.2% below is what it does
  not see. The median is
  the criterion the owner set, and the tail is where the application's cost
  actually lives — app p99 frame time 61.0 ms against bare 18.4 ms, jank 2.98%
  against 0.31%. A median-only criterion is blind to concentrated jank, which is
  why the call-count gate is RETAINED beside it: the pre-fix 170-query build had
  a *perfect* 59.5 fps median.

- ~~**Without GPU acceleration the application holds 29.6% of bare.**~~
  **CLOSED 2026-09-01. It holds 100.1%, jank 1.5%, and hardware did not
  regress (100.3%).** The ablation named one CSS property: removing
  `.state-focus-scrim`'s `backdrop-filter` alone bought **+13.9 fps of the
  +14.8** that removing the entire state-focus layer bought — 94% of that
  layer's cost. District layers +6.3, SVG art +3.8 on median but nearly all the
  residual jank, and **markers +0.6, which is inside their own spread and
  therefore names nothing**. Corroborated by profile: 1762 ms of `(program)`
  self time in a 2768 ms flight with every named JS function under 40 ms, so
  the deficit was per-frame raster and never our JavaScript.

  The repair DEGRADES rather than deletes, and only where the rasteriser names
  itself software: during camera motion the blur and the SVG art stand down in
  CSS and the district layers go to `visibility:none`, all restored on
  `moveend`. An unreadable renderer is treated as HARDWARE — positive
  identification only, so a misread never degrades a reader who did not need it.

  **Two things that are still owed, and neither is a measurement problem.** The
  degradation fires on ANY camera motion on a software rasteriser, so such a
  reader's drag-pan also loses district boundaries until they release — endorsed
  by the brief for the fly-in, not scoped to it. And the absolute rates are facts
  about ONE host with ONE GPU (Intel Iris Xe); only the ratios are claims about
  the build, and no second machine has been measured.
- **Arizona's source universe is larger than any one query.** Three filters over
  `GetNEWTableData` union to 860 rows across 732 entities, 16 reachable from no
  other filter, and `ftp://ftp.azsos.gov/cfsdata2/` has **four** root
  directories where the record said one — `ElectionResults` (1998–2026) was
  never walked. The remaining AZ regimes — county, municipal and school-district
  filers whose filing officer is not the Secretary of State — are owed.
- **New Hampshire's remaining routes**, 14 of them in
  `data/hunt/nh-remaining-routes.json`. The highest-value is the **SOS filed
  report PDF series**: the API publishes `reportCount: null`, which is exactly
  why six candidates carry `REGISTERED_NO_ACTIVITY_REPORTED` rather than a
  report-level claim. The PDFs are the materially distinct representation that
  can answer it.
- **A Tom Horne portrait.** Not the file we have — `Tom Headshot 60px_0.jpg` is
  60px against a 96px floor, and `azed.gov` answers a Cloudflare interstitial to
  every client tried. Under RULING 206 the owed thing is ANOTHER
  REPRESENTATION of the same record, not a harder fetch of that URL.
- **A cache-read field in `AttemptCost`.** The digest reports cache hit rate as
  **NOT MEASURED** — correctly, because nothing in the cost ledger records a
  cache read, and `0%` would be a measurement nobody took. The **production**
  Ask path is now measured at Anthropic's own `usage` block — 15,731 cache-read
  tokens against 583 uncached input, 4 of 6 model-reaching calls reading,
  2026-09-01, `docs/evidence/cache-production-workspace-2026-09-01.md`. The
  worker cost ledger still cannot see the same thing.
  *(The 62.5% this line used to quote was the LOCAL probe, and it did not name
  the credential it measured. `scripts/ask-cache-probe.mts` refuses a production
  target by design, so that number was never evidence about production; the
  three keys were later proved to share one workspace, which is what makes the
  production reading above the one that settles it.)*

### Arizona money is ACQUIRED and does not reach the reader — CLOSED 2026-09-01

**It reaches the reader now.** Measured on the integrated head against a local
production build, by opening every card's battlecard and its Campaign money
section and classifying the sentence it ends in:

| ZIP | candidate cards | money sections BEFORE | AFTER |
| --- | ---: | ---: | ---: |
| 85701 | 24 | **4** | **24** — 19 filed, 3 our gap, 2 federal, 0 unclassified |
| 85641 | 29 | **4** | **29** — 22 filed, 3 our gap, 4 federal, 0 unclassified |

The diagnosis below was exactly right and nothing was acquired to fix it — the
JOIN was built. One precomputed, auditable reconciliation over the whole lineup
population, resolving into a STATEWIDE Arizona 2026 identity registry rather
than another ZIP-specific bridge: 30 nominees = 27 uniquely reconciled + 1
ambiguous + 2 unmatched, 0 duplicate-target collisions, and a collision refuses
the write. No fuzzy or runtime name matching reaches the reader; published names
expand into exact strings, each labelled with the annotation rule that produced
it, compared by string equality, once, into a committed table.

**The caution below was also right, and it has a price this session paid rather
than hid.** Teri Ann Hourihan is **No Labels** on the certified canvass and
**Arizona Independent Party** on the SOS candidate-filing list. Two Arizona
authorities disagree, the party criterion blocks the mapping, and her card
renders our gap although the corpus holds her filed figure. Both published
values are recorded in the reconciliation for the author to adjudicate. **That
is the rule working**, and one wrong join would have put a candidate's
fundraising on their opponent's card.

Pinned by `pnpm walk:all`, four checks per pilot ZIP under `[SC3]`, which
assert the FLOOR and never the composition — a candidate may move honestly
between states, but a card with NO money state at all is what may never happen
again.

*The original entry, kept because a closed frontier item is still the record of
how the defect was found:*

### (original) Arizona money is ACQUIRED and does not reach the reader — Part E's reader clause was NOT MET

**Measured on production and on a local production build of the same tree, which
agree exactly:**

| ZIP | contests | candidate cards | money sections rendered |
| --- | ---: | ---: | ---: |
| 85701 | 22 | 24 | **4** |
| 85641 | 23 | 29 | **4** |

Cross-referenced against the snapshot: **36 of the 38 candidacies in the
contests shown at 85701 have a record in `state-money-az-2026.json`** — the 2
that do not are US House District 7, correctly federal and served by the FEC
path. So 36 should carry a money section and **4 do**.

The four that render are all Corporation Commissioner Clean Elections
committees: Jonathon Hill, Nick Myers, Clara Pratte, Kevin Thompson.

**The cause, located.** `app/ballot/page.tsx` has two contest branches. The
filed-candidacies branch passes `targetKey={cand.id}`, which matches the
snapshot's `targetKeys` exactly — those four render. The **certified-lineup
branch** passes `targetKey={`${contest.id}|${nominee.name}`}`, and a lineup
nominee "exists only as a canvass name" with no candidacy id. That key can never
match `ballot-az-pima:governor:hobbs-katie`, so `stateMoneyForTarget` returns
`[]` and the money slot is `null`.

Verified directly: `stateMoneyForTarget("ballot-az-pima:governor:hobbs-katie")`
returns `FILED $11,109,719.95` when called with the candidacy id. The data, the
loader, the deploy tracing (`./data/funding/*.json` is named for `/ballot`) and
`isRenderable` are all correct. The key is the only thing wrong.

**This falsifies Part E's third acceptance clause** — *every applicable pilot
candidate ends in exactly one honest reader state* — because 32 candidates end
in NO state at all. The section is absent rather than showing filed data, a
sourced absence, or an OURS gap.

**Why it was NOT fixed at session end, which is a decision and not an
oversight.** The repair is a join from certified-canvass nominees to
candidacies, and the only available join key is the NAME. This session already
measured what name joins do here: quoted-nickname forms
(`Rachel "Jones" Keshel`) turned five live committees into manufactured
absences, and the Arizona lane refused to widen `namesAgree` on exactly the
reasoning that applies here — **a stranger's money on a named person's card is
the worse failure**. Shipping a name join into a reader surface, at the end of a
session, with no reconciliation evidence, would risk attributing one candidate's
fundraising to their opponent. That is the one failure this product cannot
survive.

**What the repair actually needs:** a reconciled nominee↔candidacy mapping with
its own evidence bar — `lib/ballot/contest-universe.ts` already carries the
concept ("certified nominees no rendered candidate could be reconciled to"), and
`lib/ballot/candidate-targets.ts` builds a valid-id SET but no mapping. Until
that mapping exists and is proven over the population, the honest render for a
lineup nominee is the OURS gap the snapshot already supports — which is itself a
smaller, safer change than the join, and is the recommended next step.

### The ASK-19 length budget and large evidence packs are incompatible (H2, 2026-08-31)

**Found by the model comparison, and it is not a fact about either model.** Two
of the four canonical questions that reach the synthesis contract — **Q3 and
Q5** — fail the ASK-19 700-character budget on the incumbent AND on the
challenger, on every pass, over the same 18-record / 6-gap Vail evidence pack:

```
  Q3  incumbent 736 / 771 / 733 chars      challenger held 3/3
  Q5  incumbent 760 / 840 / 794 chars      challenger 720 / 783 / 717
```

The reader consequence is a fall back to deterministic structured prose where a
grounded synthesis was available. Not a false claim — the fallback is honest —
but the reader loses the answer the evidence could have supported.

**The owed decision is which side gives.** Either the budget rises for packs
above some size, or large packs are summarised in stages, or the budget becomes
a target the synthesiser is told about rather than a gate applied after. All
three are product decisions and none is a model choice, which is why the model
comparison could not settle it and correctly did not try.

**Do not read this as a reason to switch models.** On Q3 the challenger was
GREEN 3/3 where the incumbent was RED 3/3, and it is 2.5–3.2× cheaper — but the
owner's criterion is absolute and Q5 fails on the challenger too, so the
incumbent is retained. The finding worth acting on is the budget, not the model.

### `switchVerdict` and the owner's criterion disagreed — CLOSED by RULING 230, 2026-09-01

**The ruling this section said was owed has been made.** RULING 230: SWITCH only
if every required challenger question is measured and holds; any required
question measured and not held is HOLD/RETAIN; any unmeasured is NOT_MEASURED
and the incumbent is retained; and **no second function may emit a
`SwitchVerdict`**. `git grep -E ")s*:s*SwitchVerdict"` returns exactly one
line, `lib/ask/model-economics.ts`, and a test holds it there.

The relative reasoning was not withdrawn — it survives as
`relativeNonRegressionAnalysis()` with its own type, structurally unassignable
to a `SwitchVerdict`. The comparison record was regenerated from its recorded
rows and now derives `decision` FROM `verdict` in one function, so the pair that
used to read `SWITCH` beside `RETAIN:claude-opus-5` cannot come apart again.

*The original entry, kept because a closed frontier item is still the record of
why the rule exists:*

### `switchVerdict` and the owner's criterion disagree, and both are kept

`lib/ask/model-economics.ts` carries a RELATIVE rule — a challenger question
blocks a switch only where the incumbent held it and the challenger did not —
which is argued and tested: *a question neither model answers is a retrieval
gap, and holding the model choice hostage to it would make every future switch
impossible for a reason unrelated to the model.*

The owner's instruction is ABSOLUTE: *switch only if every required question
holds.* On the 2026-08-31 runs the two derive opposite outcomes. Neither was
deleted; the decision was taken on the author's directive at precedence 1
(RULING 185) and the relative derivation is reported beside it as what it is.

~~**What is owed is not a bug fix but a ruling**: whether the standing rule
should become absolute, or stay relative with the absolute one reserved to
explicit author directives.~~ **Landed as RULING 230 on 2026-09-01 — absolute.**

### One test failed once inside `pnpm gates` and has never been named (2026-09-01)

A gates run on the Session C integrated head recorded `test FAIL` with
`failureKind: ASSERTION_FAILURE` and `suiteTotals { tests 4523, pass 4522,
fail 1 }` — a **real** single-test failure, correctly distinguished from the
early-abort class, and **the name of the test went with the run**. Two
subsequent full suites and a second full gates run all came back clean:
4523 of 4523, 14 of 14.

`scripts/gates.mjs` no longer loses the name — its detail filter never matched
`node:test`'s own `✖ <name>` lines, and it now extracts them separately and
writes them into the run record as `failingTests`. **That fixes the next one.
It does not recover this one**, and this entry exists so that a later
identical failure is recognised as a second sighting rather than a first.

Two things narrow it. It is not the documented EARLY_ABORT class — a complete
summary was printed and it named a failure. And the host was under load: the
record carries `nodeProcessesAtStart: 15`, with a subagent lane still running
its own installs and builds. **Load is a hypothesis, not a finding**; nothing
here measured a causal link, and recording one would be the single-case
reasoning this repository has refused twice already.

Owed: reproduce it under load with the new instrument, or wait for it to recur
and read the name.

### The runner: what is actually true about its cadence, and what is not (2026-09-01)

A lane reported that *“a cycle now costs ~7m42s”* against 2,358 obligations
and that **the runner's 5-minute interval no longer fits one cycle**. The
second half is a misreading, and correcting it matters rather than passing it
on: it would have reached the author as a scheduling emergency.

`-RestartInterval (New-TimeSpan -Minutes 5)` in `scripts/pilot-task.ps1` is the
**restart-after-crash delay**, not the cycle interval. The cycle interval is
`--interval`, default **60 minutes** (`scripts/pilot-runner.mts`), and the task
carries `-MultipleInstances IgnoreNew`. A 7m42s cycle fits inside 60 minutes
with room to spare and cannot overlap itself.

**What IS owed is smaller than it sounded, and it is real.** The cycle cost
rose with the obligation count — Neon round trips in the reclaim sweep and in
the list calls. Two of the worst offenders were fixed in the same lane
(`syncObligations` from N reads to one `list()`, and skipping unchanged
`next_due` writes); the remainder is not addressed.

**Roughly 1,000 occurrences opened by that lane's first unbounded run are still
open** in the control plane. `resumeOpenOccurrence` picks them up rather than
stranding them, so they drain rather than leak — over many cycles.

**And the runner is not running right now.** `pnpm pilot:status` on 2026-09-01
reads *scheduled task Ready, last run 06:48:53, last result 3221225786*
(`0xC000013A`, STATUS_CONTROL_C_EXIT) with **0 pilot-runner processes**. The
task is installed and its at-logon trigger stands; what is not true is that a
worker is turning right now.

### Instrument debt, and why each one matters

- **The gate-run record identifier collides under parallel execution.** Records
  are numbered from local state, so four branches allocated 42–45 independently
  in one evening and every pair conflicted on merge. RULING 190/191 make
  parallel lanes the DEFAULT, so this recurs by design. The durable fix is an
  identifier needing no agreement — tested SHA plus run instant.
- **`release:freeze` has no automatic path out of its own loop.** Every commit
  to main deploys (`netlify-ignore` reports CANNOT-TELL and builds, correctly),
  including the observer's own reading — which moves production out from under
  the reading just taken, while the observer only fires on push. The session
  cleared it by hand each round. See
  `data/health/gate-abort-evidence/2026-08-31-test-gate-false-red.md`.
- **The duration heuristic for abort-versus-real does not always discriminate.**
  It held on one tree (59s fail against a 75s pass) and failed on another (44s
  fail against a 43s pass). The reliable signal is the `failureKind` field now
  recorded by `scripts/gates.mjs`, derived from the suite's printed summary
  rather than the exit code. **Read the field, not the clock.**
- **The client-JS baseline for `/` looks stale.** 2003 KB measured against a
  2653 KB baseline last set 2026-08-29. Not this session's to re-baseline, and
  a baseline that far above the measurement cannot catch a regression.

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

**CAUSE FOUND LATER THE SAME DAY, and it was not a flake.**
`tests/tracker-transaction.test.ts` writes a synthetic row (`NH303`) into the
LIVE tracker store and restores the store in a `finally`. **A run KILLED
mid-test never reaches that `finally`**, so the synthetic row and its
`tracker-opened.json` ledger entry survive into the working tree — and the next
suite then fails two tests: the transaction test itself, and the expansion-log
guard, because the leftover row makes `tracker-transaction-test` the newest
session in `docs/log.md`.

This session killed several long runs with a task-stop, which is what produced
it. Removing the row and regenerating the views returned the suite to 4274/0.
**So the failures were self-inflicted, and the test is not flaky** — though a
test that mutates a canonical store and depends on its own `finally` for
correctness is a hazard worth knowing about, because an interrupted run leaves
the repository dirty in a way that looks like an unrelated failure.

**The instrument gap is real and stands regardless.** It took a suite re-run to
name the failing tests, because `data/ops/gate-runs/*.json` stores
`{id, ciJob, command, status, seconds}` and nothing else. The failing output is
printed to the console and then discarded, so a gate failure that is not watched
live leaves no evidence of its cause — which is exactly why this took three
runs and a guess to diagnose.

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

**Part E — Arizona money. The bridge route is now OPEN, and one named question
stands between it and a snapshot.** The held Pima corpus cannot reach the pilot
ballot (see below), so the bridge was always the AZ Secretary of State. That
portal's endpoint was recorded on 2026-08-24 as live with its **parameter shape
unknown** — a guessed body returned 200 and two bytes — and rung 7 was named as
the next rung and never walked.

Walked 2026-08-31. `POST seethemoney.az.gov/Reporting/GetNEWTableData/` is a
server-side **DataTables** action: the filters ride in the query string and the
body must be the DataTables form encoding INCLUDING its `columns[N][data]`
array, because that array is the projection. The three missing filters were
`IsLessActive`, `ShowOfficeHolder` and `ChartName`. With them it returns
**`recordsTotal` 370 for the 2025–2026 cycle** at `JurisdictionId=0`, each row
carrying `EntityID`, names, `CommitteeName`, `OfficeName`, `PartyName`,
`Income`, `Expense` and `CashBalance` — and `EntityID` is the non-name join key
the contract wants. Permission re-confirmed: no `robots.txt`, no terms, no
challenge, no credential.

**NO SNAPSHOT WAS BUILT, deliberately.** A single candidate returns SEVERAL rows
sharing one `EntityID`, with differing `Income`/`Expense` and an IDENTICAL
`CashBalance` — Jayme Accalia returns three. Which row, or which aggregation, is
the cycle total is **undetermined**; summing and taking the largest disagree, and
publishing either as a named person's campaign total is precisely the failure
`lib/funding/state-money.ts` opens by naming.

**That experiment was run, and it REFUTED the obvious answer.** The portal
displays no per-candidate total to reproduce — its table renders the same rows
the endpoint returns. And the arithmetic that looked like proof does not survive
the population: on Accalia, `sum(Income) − sum(Expense)` equals the repeated
`CashBalance` exactly, but across all 370 rows (255 entities) that identity
**holds for 134 and breaks for 121**, including for single-row entities where
there is nothing to sum. `CashBalance` carries something the 2025–2026 window
does not — a prior-cycle balance most likely — and Accalia matched because she
started from nothing.

**One candidate agreeing with a hypothesis is not evidence for it**, which is
the whole reason the check was run over the population before anything was
built. What would settle it is a source stating a cycle total independently:
`ExportEntityTransactions` (itemised, summable), the filed reports, or the
`ftp://ftp.azsos.gov/cfsdata2/` bulk drop already recorded as reachable on
2026-08-26 with 8,828 committees — **the FTP is the most promising and is
unwalked for this purpose.** Full write-up in
`docs/arizona-source-enumeration.md`; the route is in the method store as
`datatables-endpoint-needs-its-column-array`. **The obligation is not closed.**

**Part F — New Hampshire money. DELIVERED this session; what remains is named
below.** The directive said the higher rungs were never worked, which was false —
rung 7 worked on 2026-08-21 — but the blocking fact was underneath the rungs: the
PERMISSION question was recorded UNANSWERED because `robots.txt` itself answered
403, and RULING 148 refuses a walk on that.

It was our own identification. `www.sos.nh.gov/robots.txt` answers 200 to a bare
client and 403 to the identical request carrying this project's name; the file
disallows only CMS internals and nothing civic. `cfs.sos.nh.gov` publishes no
`robots.txt` at all. And the recorded browser-only route needed a browser solely
for CORS, which does not bind a server — so `NH40`'s "a procedure and not a
script" is retired. Both findings are in the method store
(`unanswered-permission-may-be-the-agent-not-the-host`,
`ask-what-the-browser-was-for-before-recording-human-only`, v61 → v63) and
`states/nh/sources.md` carries the answered permission.

`pnpm money:nh` writes `data/funding/state-money-nh-2026.json`: 28 non-federal
candidacies, 9 filed with reported totals, 19 sourced dated absences, 0 leads.

**Still open here.** Rung 13, the Department's public-records path, remains
unwalked and was named as the next session's start on 2026-08-19. The CFS holds
CONTRIBUTION and EXPENDITURE detail behind other endpoints; only filer-level
totals are taken. The lobbyist registry — *a source class this product holds
nothing of in any state except Arizona* — is on a host now known to be permitted
and is unwalked.

**AND THE GENERALISATION WAS TESTED AND DOES NOT HOLD — recorded because the
obvious next move is to assume it does.** The NH finding invites the conclusion
that every host recorded as refusing us was refusing our NAME. Eight hosts
carrying a recorded wall or a `CANNOT_TELL` were re-read on 2026-08-31 with an
identified client and with a bare one:

| host | identified | bare |
| --- | --- | --- |
| `apps.arizona.vote` | 403 | 403 |
| `www.pimajted.org` | 403 | 403 |
| `services6.arcgis.com` | 403 | 403 |
| `asmi.az.gov` | 403 | 403 |
| `azed.gov` | 403 | 403 |
| `azmineinspector.gov` | connection failed | connection failed |
| `azdor.gov` | 200 (robots) | 200 (robots) |
| `www.pima.gov` | 200 (robots) | 200 (robots) |

**Not one shows New Hampshire's pattern.** The 403s refuse both clients equally,
which is a transport wall — Cloudflare bot protection in the recorded cases —
and remains `CANNOT_TELL` under RULING 182 rather than a disallow. Bypassing bot
detection is prohibited and is not attempted.

So the NH route is **agent discrimination on a `nh.gov` host family**, not a
general property of civic hosts. The two-client `robots.txt` read is still worth
running against any newly walled host — it costs two requests and it unlocked a
state — but it should be run as a CHECK, never as an assumption that a wall is
our fault.

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

---

## Carried out of the autonomy-recovery session, 2026-09-01

*Priorities only. The full classified discovery list, with evidence pointers,
is `docs/evidence/autonomy-recovery-discoveries-2026-09-01.json`; the runner
defect itself is FIXED and is not here.*

- **Reconcile an already-disposed occurrence on resume without re-walking.**
  A resumed occurrence whose RouteTask already carries a committed disposition
  now soft-fails and closes instead of crashing the cycle; closing it directly
  from that disposition would drain the leaked-open set for free. Efficiency,
  not recovery. Readback before the fix: 393 of 1,447 occurrences had a disposed
  RouteTask while 55 were closed with one.
- **Batch the pre-open resume reads.** One hundred serial Neon round trips took
  about ten minutes under load. The corpus list is already one query; the
  resume reads and next-due writes are not.
- **Measure the Scheduled Task's restart-on-failure by killing the PARENT after
  the merge.** The runner is resilient to child failures; whether Windows
  relaunches a dead `pilot-runner` process is unmeasured because task history
  is disabled on this host. A reboot restores it through the at-logon trigger.
- **Netlify scopes the admin secret and session key to `functions` only.** The
  live login passes because middleware verifies where that scope applies on the
  current runtime; a move to an edge scope must re-check it.
- **The drain rate is the owner's** — tracker `RO08`, a decision card: 100
  dispatches per hourly cycle against roughly 2,900 due.

## Carried out of Session C (final), 2026-09-01

*Priorities only. None of this is law, and none of it is a status claim — the
generated status ledger and the ledger itself hold those.*

### Deferred by decision

- **Organization transfer of `SeanJ22/meanwhile` to `meanwhileusa/meanwhile` —
  DEFERRED TO INCORPORATION.** The user-level rename is complete and every live
  reference now addresses `SeanJ22/meanwhile`, so **nothing is blocked on it.**
  Netlify's stored `repo_url` and `repo_path` were re-linked and read back.

### The promotion tail, and it is the largest owed thing here

**211 newly acquired Arizona candidates are inventory, not product.** They are
`ACQUIRED → EXTRACTED → NORMALIZED → CANONICALLY_LINKED`, and nothing in `app/`
or `components/` reads
`data/hunt/<state>-candidate-universe-2026.json` or calls `projectOntoZip`.
RULING 224 is explicit that an acquisition obligation does not close when
evidence reaches the vault — it closes when a reader-facing surface reflects the
acquired truth or renders the honest gap. **Held data with no live promotion
tail is a defect**, retroactively, so this is a defect and not a plan.

### The two corpora that are retrieved and not normalized

- **New Hampshire** — the cumulative filing PDF is retrieved and hashed. Two
  walls, both OURS: the pages are rotated, so the generic table layer reads each
  column as a row and returns `ZERO_ROWS`; and this repository holds no sourced
  crosswalk from an NH State Representative or Executive Council district to an
  OCD division. A prototype axis-swapped parse recovered 1,268 rows whose
  segmentation could not be verified, and **an unverified count was not
  shipped.** `REQUIRES_NEW_ADAPTER`.
- **New Jersey** — the Division of Elections files **federal office only**. The
  state's universe is the union of that authority and **21 county clerks**, so
  the remaining work is an enumeration of clerks, not a parser.

### Instruments that reported wrongly — and the count kept rising

Five found in one session, and the pattern is worth naming rather than filing
five separate rows. **Three passed while looking at nothing; one FAILED while
looking at a race; one was this session's own new code.** A later independent
refutation pass then raised sixty more suspect claims across the session's own
acceptance package and confirmed forty of them
(), so the honest count is
not five — it is *this project has many sweeps and nothing systematically asks a
sweep to prove it looked.*

1. **The model-comparison harness filtered incomparable questions out** instead
   of carrying them as unmeasured, so a sweep emitted `SWITCH` over one row.
   Fixed; the denominator is now stated in the record.
2. **`--regenerate` read the arm names from today's constants**, which the model
   switch had swapped, so re-deriving a historical record stamped it with
   reversed roles. Now refused with the correct command.
3. **A stylesheet sweep reported zero `var()` references across 1,428 rules**,
   because Chromium's nested-CSS support gives every rule an empty-but-truthy
   `cssRules` and the walker recursed into nothing. The repaired sweep found a
   live undeclared-token rule that the source sweep could not see.

**The open question underneath all three:** this project has many sweeps, and
nothing systematically asks a sweep to prove it looked. The plant-check pattern
(`tests/brand-identity.test.ts` plants a violation and asserts the guard goes
red) is the answer that exists; it is not applied broadly.

### Still owed on Ask, unchanged by the model switch

**Q3 and Q5 fail on the INCUMBENT, 0 of 3 each** — an 18-record pack cannot fit
the ASK-19 700-character budget. That is a real unanswered reader question and a
PIPELINE defect. RULING 234 does not close it, and the model revert leaves it
exactly where it was: the model now shipping is the one that fails both.

**This line previously read "fail identically on both models", and that was
wrong.** It was true of the 2026-08-31 comparison runs and false of the two
later ones, which record the challenger holding **Q3 1 of 3** and **Q5 2 of 3**
with substantive stored answers
(`data/health/ask-model-compare-runs/2026-09-01-1788289823520.json` and
`…-1788292079219.json`). Two of this project's own artifacts disagreed about a
measurement, and the one a later session inherits carried the stale half —
which is the whole reason the frontier is not allowed to state results it has
not re-read. Found by the refutation pass recorded in
`docs/evidence/session-c-refutation-2026-09-01.json`.

Two effort levels are unusable and the reason is structural: **`xhigh` and `max`
break the output contract** at `max_tokens: 2048`, because thinking counts
against that ceiling and the JSON answer truncates mid-string.
