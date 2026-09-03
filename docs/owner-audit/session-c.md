# Session C — the owner's audit package

---

# READ THIS BEFORE ANY ROW ABOVE — the package was audited and it did not survive

**Session C does NOT close. Three items are UNFINISHED against the directive's
own acceptance criteria, and this package's own claims were attacked by an
independent pass that found forty of them broken.**

## 1. The refutation pass, and what it did to this document

After the acceptance rows above were written, ten independent skeptics were run
against them — instructed to **REFUTE, never to confirm** — and every finding
they raised was handed to a second agent told to show the first was wrong.
**71 agents, 89 claims examined, 60 raised as suspect, 40 CONFIRMED BROKEN, 20
where the refuter was shown wrong, 0 undecided.**

The full record, every finding with the command that produced it, is committed
at **`docs/evidence/session-c-refutation-2026-09-01.json`**.

**The refutation is itself fallible and was spot-checked rather than believed.**
Two examples, because the pattern matters more than the count:

- **One CONFIRMED_BROKEN finding is wrong.** It claimed the reported
  *"Q5 2/3 vs 0/3"* had no support in any stored measurement. It does:
  `data/health/ask-model-compare-runs/2026-09-01-1788289823520.json` and
  `…-1788292079219.json` both record Q5 `incumbent heldCount 0/3`,
  `challenger heldCount 2/3`, and the challenger's stored pass carries a
  substantive answer with real figures. The finding was right about something
  else, though: **`docs/frontier.md` says Q3 and Q5 "fail identically on both
  models"**, which was true of the earlier run and false of the later two. That
  contradiction is real and is corrected there.
- **One was stale.** It read gate record `2026-09-01-24.json` and called
  *"gates 14 of 14"* false. Record `-25.json`, at the shipping head, is green.

So the number to carry is not "40 defects". It is: **this package asserted
things it had not verified, at a rate an independent pass could detect in
89 claims.**

## 2. What is UNFINISHED

### ITEM A — UNFINISHED

Arizona was acquired from the authoritative source universe. **New Hampshire
and New Jersey were not.** Relabelling them `PILOT_DERIVED` /
`REQUIRES_NEW_ADAPTER` satisfies R-C9 honesty and **does not** satisfy Item A,
which requires migration to each state's authoritative candidate-filing
universe. An honestly named acquisition wall is not completion, and this
package previously read as though it were.

### ITEM K — UNFINISHED

`ASK_SYNTHESIS_MODEL` is **`claude-opus-5`**. The switch was made, measured,
and reverted the same day under RULING 234's own reversibility clause. The
revert is authorised and correct. **The directive's final acceptance requires
production serving `claude-sonnet-5`**, so Item K cannot simultaneously be
called complete. **Readers get `claude-opus-5`.**

### THE RUNNER — NOT VERIFIED, and this session broke it

Diagnosed, not guessed:

```
main checkout  (787211c1)  control-plane:gate REFUSED
                           applied version 3 against declared 2
                           5 undeclared cp_ tables
integration    (this head) control-plane:gate PASSED
                           version 3, 20 of 20 tables, no drift
```

**This session migrated the shared control-plane database to schema v3 from a
worktree**, while the runner executes from the main checkout on pre-session
code declaring v2. That module refuses undeclared tables by design, so it shut
itself down correctly: cycles have exited NON-ZERO since ~19:56Z and digests
read `0 providers, 0 units`.

The ordering lesson: **expand-first is only safe when the old code tolerates
the new schema.** Lane 5's additive Drizzle column was; the control-plane
bootstrap was not.

The repair is the code in this merge. Verification can only follow it, and
until the runner is observed completing a clean cycle on the merged code,
**Session C remains UNFINISHED on this item.**

Separately: **two runner processes** were found, one from the Scheduled Task
and one orphaned from the Startup entry, writing digests 11 seconds apart. The
duplicate was stopped. The two-mechanism configuration is an owner decision.

## 3. Corrections to specific rows above

| Row | It said | It should say |
| --- | --- | --- |
| Item E counts | `RouteTask dispositions 301` | **342.** The cited artifact `data/health/control-plane-readback/2026-09-01-03.json` records `routeTaskDispositions: 342`. The package named a file as the place to verify and then printed a number that file contradicts. |
| Item J, the undeclared-token sweep | "guards it with a **plant-check both ways**" | There is **no red arm**. The guard asserts the current state; it was not shown failing on a planted violation, so it cannot distinguish "the rule holds" from "the sweep looked at nothing". |
| Item H, seeded failure 3 | "a number rendered without a denominator fails the page's own check" — **MET** | **NOT MET.** `countClaimsFor` in `lib/control-plane/owner-surface.ts:665` sets `stated` and `rendered` to the *same expression* for all four entries. The check compares a number to itself and **can never fail**. This is the session's own failure pattern inside the surface built to report it. |
| Item B, "Where to verify" | `pnpm build && pnpm start`, then run the test | Those commands produce a **SKIP**, not the stated result: `pnpm start` is plain `next start` with no `--import ./scripts/trap-outbound.mjs` and no `WTP_OUTBOUND_LOG`. The recorded pass required a server started with the trap preloaded. An owner following the row verbatim gets a skip and exit 0. |
| Item A, "established TWICE by independent mechanisms" | "the two mechanisms share nothing" | **Overstated.** Both extractions walk the same pdfjs `page.getTextContent()` stream and consume different fields of it. They catch cell misalignment and header handling; they would **not** catch a correlated whole-page loss, which is the failure the sentence is sold against. The number 266 is correct by measurement — the *guarantee* is not what was claimed. |
| Item 5 denominator table | AZ candidacies 55 | Contradicts Item A on the same page (55 → 266). The Item-5 caveat "each state is currently derived from exactly one certified pilot-county ballot" is now false for Arizona. |

## 4. What was NOT done about the other findings

**They are recorded, not repaired.** The remaining confirmed findings — chiefly
guards that cannot catch what they are cited as catching (the `--mark` scope
test exempting legend dots, the comment-stripping sweep skipping the directory
whose comment caused the defect, the `derive()` template-level `continue`, the
NS12 predicate's acceptance of placeholder strings, the unchecked middleware
matcher) — are open defects with evidence in the committed findings file.

Repairing forty guards is a session's work and each repair needs its own gate
and CI cycle. Claiming them fixed here would be the exact defect this pass
exists to catch, one level up.

## 5. The generated-artifact race is NOT fixed

`tests/generated-artifacts.test.ts` now re-derives a mismatch once, so a real
drift (which reproduces) is told apart from a working-tree race (which does
not), and the race is thrown with its cause named. **The race is not
eliminated.** A non-reproducing mismatch still throws, so it can still turn a
`pnpm gates` run red at random. Isolating or removing the shared-tree mutation
remains open.


Written for you, not for a machine. **Every claim below is paired with exactly
where to check it**, one line each. Nothing here asks you to take a session's
word for anything.

Generated by hand and stamped 2026-09-01 (`pnpm stamp`). It supersedes the
version written on 2026-08-31, which said Session C had reached Part A only.
That version is preserved in git history; nothing in it has been edited.

**It also supersedes the version merged in PR #255 on 2026-09-01, which was
REFUSED on independent audit** — and the three reasons are worth stating,
because each one is a rule this package is supposed to enforce on itself:

1. It carried **no Item 5 acceptance section at all**, and pointed at "the
   session report" instead of naming a place to check. A close-out that cites a
   close-out has verified nothing. Item 5 now has its own section below, with a
   derivation command beside every number.
2. It said the autonomous runner **was running**. At the time it said so, the
   runner had exited and `pnpm pilot:status` reported zero processes. The
   runner's real state, measured at report time, is below — and it is not good
   news.
3. It quoted a suite total (**4,555**) that the pull-request close-out
   contradicted (**4,562**), and the gate run record could not settle it because
   it did not persist suite totals on a passing run. That is fixed in
   `scripts/gates.mjs`; both numbers are explained below.

**Placeholders in this document are real.** Any line reading
`PENDING — <lane>` is an acceptance result that has NOT been filled in yet. It
is not a pass, it is not a soft pass, and a section carrying one is not
finished. They are there because the work is being done in parallel lanes and
this package is written before they all land.

---

## What a reader can now see that they could not see before

### 1. Arizona campaign money is on the ballot, and it was on almost none of it

At **85701** and **85641**, every candidate card now ends in exactly one honest
money state. It did not before.

| ZIP | candidate cards | money sections BEFORE | money sections AFTER |
| --- | ---: | ---: | ---: |
| 85701 | 24 | **4** | **24** — 19 filed, 3 our gap, 2 federal |
| 85641 | 29 | **4** | **29** — 22 filed, 3 our gap, 4 federal |

**Katie Hobbs's card reads `Raised $11,109,720 · Spent $14,355,613`.** That
figure has been in this repository since 2026-08-31. It was not on her card,
and neither was anyone else's, because the certified-lineup cards asked for
money **by name** and the money records are keyed to **candidacy ids**. Two
correct halves, one seam, and the seam was the only place it could fail.

Nothing was acquired to fix this. The join was.

### 2. Nine officials have a face

The nine portraits you approved at `docs/photo-review/own03-nine.png` now render
on their cards: Adrian Fontes, Kris Mayes, Kimberly Yee, Nick Myers, Rachel
Walden, Kevin Thompson, Lea Márquez Peterson, René Lopez and Dale G. Caldwell.
Before today every one of them rendered initials.

**Tom Horne still renders initials, and that is correct.** He was never among
the nine — his decode was a Cloudflare challenge page, not an image — so there
was never a decision of yours to apply. His portrait is hunt work, not your
queue.

### 3. A reader with no GPU can use the map

On a machine with no hardware acceleration — an older laptop, a VM, remote
desktop, a blocklisted driver, or acceleration simply switched off — the zip
fly-in ran at **29.6% of a bare map, with 193 of 201 frames dropped**. It now
runs at **100.1%, with 1.5% dropped**. The bare map always managed 60 fps on
that same rasteriser, so this was ours, not the machine's.

**One visible change you should know about:** on such a machine, district
boundaries and the state-focus treatment now stand down *during any camera
movement* — a drag-pan as well as a zip fly-in — and come back the instant the
reader lets go. On a map that was doing 17 fps this is the better trade, but it
is a real change and it was not scoped to programmatic flights only.

---

## What required no operator — and the runner is NOT staying up

**The previous version of this page said the runner was running. Read this
instead.** Every line below is a reading from `pnpm pilot:status`, with the wall
clock beside it. Run it yourself: `cd C:\Users\seanj\dev\we-the-people` then
`pnpm pilot:status`.

| Wall clock (local) | What `pnpm pilot:status` said |
| --- | --- |
| 06:48:53 | task last result **3221225786** — that is `0xC000013A` — `running now: 0 pilot-runner process(es)` |
| 11:38:45 | `pnpm pilot:start` issued; task **Running**, `1 pilot-runner process`, **pid 31176** |
| 11:56:31 | digest written to `G:\My Drive\we-the-people\pilot-digest.md` — so it did a cycle's work |
| **12:01:11** | task **Ready**, last run 11:38:45, last result **3221225786** again, `running now: 0 pilot-runner process(es)` |
| **12:27:21** | unchanged — task **Ready**, last result **3221225786**, `running now: 0 pilot-runner process(es)`, digest still 11:56:31 |

**So it ran for roughly eighteen minutes, produced one digest, and died the same
way it died this morning.** Twice now, with the same exit status.

**And the automatic restart has not brought it back.** The Scheduled Task is
configured `-RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 5)`, so a
task that died should be retried within five minutes. **Thirty-one minutes after
the death it had not been**, measured at 12:27:21 against a death at roughly
11:56. That is a second open question beside the first, and it is the one that
matters more: if the runner cannot restart itself, then the runner being up is
something a person has to notice.

**What that status means, and what it does not.** `0xC000013A` is
`STATUS_CONTROL_C_EXIT` — the process was ended by a console control event, not
by an error inside it. It is the exit code of a program that was interrupted,
and the digest at 11:56 says the cycle it was in the middle of was doing real
work. **What has NOT been established is what is sending that event**, and this
page will not guess: naming a cause we have not measured is how a wrong fix gets
shipped and the runner keeps dying. It is recorded as an open diagnosis.

**What is genuinely true and does not depend on the runner being up:**

- **Promotion is OFF, structurally, not by configuration.** `runCycle` in
  `scripts/pilot-runner.mts` takes no parameter that could promote anything, and
  the digest records `Promotion to reader truth: none`. Verify by reading
  `scripts/pilot-runner.mts` line 13 and `docs/pilot-runner.md` line 12 — or by
  opening the digest and looking for that line. Nothing this process does
  changes what a reader is told.
- **The 5-minute number in the Scheduled Task is the crash-restart delay, not
  the cycle.** `scripts/pilot-task.ps1` line 139 sets
  `-RestartInterval (New-TimeSpan -Minutes 5)` with `-RestartCount 999` — that is
  how often Windows retries a task that DIED. The cycle is **60 minutes**:
  `scripts/pilot-runner.mts` line 86, `INTERVAL_MIN` defaults to 60, and line
  408 sleeps that long between cycles. **A seven-minute cycle is not an
  emergency and should not be reported as one.**
- The digest lives at `G:\My Drive\we-the-people\pilot-digest.md` and is written
  at the end of a cycle, so a stale digest and a dead runner look the same from
  the Drive folder. The status command is the instrument; the digest is not.

**Item 5's worker evidence is no longer described here as living "in the session
report."** It has its own acceptance section below, with a command beside every
number.

---

## What genuinely requires you

**OWN03 is closed.** You approved the nine, they render, and the row has left
your queue.

**Sixty-nine rows sit in Needs Sean, and they are two different things.**
**65 wait on your judgement**, every one carrying a decision card — what is
needed, the options, what each option costs, and how long it has been waiting.
**4 wait only on your acknowledgement**: the work is done or the question is
answered, and there is nothing to decide. Both sets are listed by age below, and
65 + 4 is where the 69 comes from. **Do not read this as a to-do list.** Most of
them cost nothing to leave open, and the queue says so per row.

### The three decision cards this directive named

| Card | Surface | What is actually being asked |
| --- | --- | --- |
| **`OWN01` (WGH-20)** — body count mismatch, 7 reported vs 6 listed at 85641 | Who Governs Here | The defect **does not reproduce**: the panel reports 9 and renders 9, both from one derivation, so there is no second source to reconcile against. Your own sheet marks this row PENDING and it is the only row in the sweep with no screenshot. What is needed is **the capture you saw, or the address and date that produced it**. A permanent check now pins the count and the rendered rows to one number, so a future divergence is caught rather than reported. |
| **`OWN05` (BAL-36)** — no legislative record for the governor | Data | There is **no adapter anywhere in `lib/sources/` for executive action records** — bills signed, vetoed, executive orders — and no held corpus carries the class, so Ask can only answer as a gap. Adding an external source is on `CLAUDE.md`'s ask-before list by name. What is needed is **approval to add one, and which publisher**: the Secretary of State's bill history, the Governor's own office, or another. |
| **`OWN06` (BAL-37)** — no address autocomplete | Ballot | The Census geocoder this product uses has **no typeahead endpoint**, and suggesting from our own partial data would hand a reader a list that silently excludes addresses we do not hold — a coverage gap wearing an autocomplete. What is needed is **approval to add an address-suggestion source, and a decision about whether partial addresses may leave this product as the reader types**. That second half is a privacy question the collection rules reserve to you. |

### And one this session hit: the Drive mirror refused an overwrite

The mirror guard **refused to overwrite**
`G:\My Drive\we-the-people\repo-inventory.md`, because the copy sitting in your
Drive folder contains two lines that appear in **no git version** of
`docs/repo-inventory.md`. Your standing instruction is that the guard was right
and must not be forced. **It has not been forced. Nothing was overwritten.**

Here are the two lines, verbatim, so the decision is yours and not ours:

```
line 5:  Generated 2026-08-31 02:52:44 EDT by `pnpm repo-map`. HEAD `b8676e1f9f17fd7392e3118103e3a4868faf5793`.
line 34: **3582 file(s) rendered — 2401 text (2098200 lines total), 1180 binary — and the table below has exactly 3582 row(s).**
```

*Method behind that pair: all 5,779 lines of the mirror copy were read, the set
of every line appearing in any of the 27 git revisions of
`docs/repo-inventory.md` was built, and the non-blank difference was taken. It
is exactly two lines. That measurement was made by the integration owner; the
git-side facts below were re-checked independently for this page.*

**The diagnosis, which you should have beside the decision — it is not the
decision.**

- `b8676e1f` **is a real commit and is an ancestor of `origin/main`**:
  *"Gate records for the final runs, including one transient test-gate failure"*,
  2026-08-30 23:30:38 -0700. Check it with
  `git log -1 --format='%h %ad %s' --date=iso b8676e1f` and
  `git merge-base --is-ancestor b8676e1f origin/main`.
- So **neither line is anything you wrote.** They are the header stamp and the
  count line of a **stale generation of a generated file**: `pnpm repo-map` run
  at `b8676e1f` on 2026-08-31 02:52 EDT, copied to the mirror, and never
  committed carrying that stamp.
- The committed copy at current `main` was regenerated at `bc730b45` on
  2026-09-01 13:15 EDT and reads
  `4873 file(s) rendered — 3682 text (2581191 lines total), 1190 binary`. Check
  with `sed -n '1,8p;30,36p' docs/repo-inventory.md`.
- Why no git revision holds those lines: the generator writes **the HEAD it ran
  at**, so the commit that CONTAINS the artifact always names its own parent.
  A generation that was mirrored but never committed leaves its stamp in the
  mirror alone. This repository already knows that pattern.

**So: the divergence is stale generated output, not your edits — and the guard
could not have known that, so refusing was correct.** What to do with the
mirror copy is yours: refresh it from the committed file, or keep the older
generation for a reason of your own. **This row stays open until you say.**

---

## Every acceptance claim, and exactly where to check it

### Item 1 — Arizona money reaches the certified-lineup reader

| Claim | Where to verify |
| --- | --- |
| 85701: 24 of 24 cards carry a money section, 0 silent | `pnpm walk:all`, check `[SC3] 85701: every candidate card carries a Campaign money section` — its evidence line prints the full breakdown |
| 85641: 29 of 29 | same command, `[SC3] 85641: …` |
| No card renders an unrecognised state | `[SC3] <zip>: no money section renders an unrecognised state` |
| Katie Hobbs's total is on her card | Live: `/ballot?zip=85701`, open her battlecard, expand **Campaign money**. Guard: `[SC3] 85701: Katie Hobbs's filed total reaches her card` |
| No fuzzy name matching reaches the reader | `lib/identity/name-forms.ts` — published names expand to exact strings, each labelled with the rule that produced it; comparison is string equality, run once into a committed table |
| The population proof | `data/states/az/identity/az-2026-certified-lineup-reconciliation.json`, key `proof`: 30 nominees = 27 uniquely reconciled + 1 ambiguous + 2 unmatched, 0 duplicate-target collisions |
| A duplicate target is an error, not a warning | `scripts/identity-az-2026.mts` exits 1 and writes nothing if any appear |
| Nickname and annotation forms | `tests/az-identity-reconciliation.test.ts` — `Walter "Les" Presmyk`, `Nicholas "Nick" Myers`, `Rachel "Jones" Keshel`, `Jackie O'Donnell Anderson`, `Daniel Francis Butierez Sr.` |
| No diminutive is ever inferred | same file — `Tom Horne` does not match `Thomas Chalres Horne`; `Katie Hobbs` does not match `Katherine Hobbs` |

**One case costs a reader a real number, and it is yours to settle.** Teri Ann
Hourihan is **No Labels** on Arizona's certified canvass and **Arizona
Independent Party** on the Secretary of State's candidate-filing list. Two
Arizona authorities disagree; the party criterion blocks the mapping; her card
renders our gap although the corpus holds a filed figure for that candidacy.
Both published values are recorded in
`data/states/az/identity/az-2026-certified-lineup-reconciliation.json` for you to
adjudicate. **The rule working, not failing** — but it is worth knowing it has a
price.

### Item 2 — one canonical switching rule (RULING 230)

| Claim | Where to verify |
| --- | --- |
| Exactly one function emits a `SwitchVerdict` | `git grep -nE "\)\s*:\s*SwitchVerdict"` — one line, `lib/ask/model-economics.ts` |
| It implements the absolute rule | `tests/ask-model-economics.test.ts`, *"RULING 230 seeded: BOTH ARMS FAILING one question yields HOLD, never SWITCH"* |
| The relative rule cannot be mistaken for a verdict | `relativeNonRegressionAnalysis()` returns its own type; `tsc` rejected a comparison against `"SWITCH"` as impossible |
| The record has no internal contradiction | `data/health/ask-model-compare-runs/2026-09-01-1788271705266.json` — `verdict.kind` `HOLD`, `decision` `RETAIN:claude-opus-5`, and `decision` is now rendered FROM `verdict` in one function |
| No per-request model switching in production | `grep -rn "claude-[a-z0-9-]*" app/api/ask/` returns nothing; `SynthesizeOptions` has no model field |

### Item 3 — the production prompt cache

| Claim | Where to verify |
| --- | --- |
| Production caching is real, measured from Anthropic's own `usage` | `data/health/ask-cache-runs/2026-09-01-1788272772853.json` — **15,731 cache-read tokens, 3,593 write, 503 uncached input**, 4 of 6 model-reaching calls reading |
| The Console card is not a contradiction | `docs/evidence/cache-production-workspace-2026-09-01.md` — prompt caching has **no enable switch**; it is activated per request by `cache_control`, and the card is an org-wide onboarding recommendation |
| The three keys share one workspace | same file — production answered with `cache_creation_input_tokens 1266`, and the byte-identical request under the local key then returned `cache_read_input_tokens 1266`. Caches do not cross workspaces |
| The savings | same file — **$0.03284 billed against a $0.09914 no-cache baseline, 66.9% saved**, 97.5% of input tokens inside the cached prefix |
| Every production request was declared synthetic | 33 rows, each carrying `x-wtp-synthetic-run` |

**Two things the repository had wrong about itself, corrected:** the system
prompt is **478 tokens** measured at `count_tokens`, not the 418 a
characters-over-four estimate had recorded — still under Opus 5's 512 minimum,
so a system-block breakpoint could never fire; and `synthesizeAnswer` collapsed
every network failure to the bare string `error`, which is now the HTTP status
and Anthropic's own `error.type`.

### Item 4 — the tracker

| Claim | Where to verify |
| --- | --- |
| 378 open, 69 Needs Sean, sections summing to 378 | `docs/tracker.md` — *"378 open, 477 resolved"* and *"69 waiting on Sean"*, generated from `docs/tracker-working.csv`. Regenerate with `pnpm tracker:views`, which WRITES — reading the file is the non-mutating check |
| All 69 carry a card, and they split 65 decisions + 4 acknowledgements | `docs/tracker-owner-view.md` — *"0 row(s) carry a machine-verifiable predicate. 69 row(s) are marked NOT_MACHINE_VERIFIABLE with a card."* and its two lists, stated `**65 row(s).**` and `**4 row(s).**`. `grep -cE "^#### " docs/tracker-owner-view.md` → `65` |
| Every row carries an opened date or `UNKNOWN`, never blank | `tests/tracker-predicates.test.ts`, *"every row in both stores carries an Opened on"* |
| Opened dates are DERIVED, not typed | same file, *"Opened on is DERIVED: every value matches what the opened ledger says, independently recomputed"* |
| Predicates are rechecked on every generation | `pnpm tracker:views` prints the RULING 227 recheck block on every run |
| `NH272`, `NH281`, `NH300` resolved with cited evidence | `docs/tracker-resolved.csv`, each row's `Session record` |
| The Needs-Sean queue, sorted by age | `docs/tracker-owner-view.md` — generated, sorted oldest first |

### Item 5 — the source universe stops being one ballot

**Item 5a is not covered here, and this page will not pretend otherwise.** The
orchestration plan names its Lane C workstream *"Items 5b to 5e"* and nothing on
disk names a 5a. If Item 5 had a first part, it is not in the plan, and an
acceptance section that quietly renumbered four items into "all of Item 5" would
be exactly the kind of tidy that hides work. **Owed: the integration owner
either names 5a and its verification, or states that Item 5 begins at 5b.**

Item 5b–5e is four things, and the plan that named them is
`data/workstate/orchestration/2026-09-01-session-c-closeout.json`, workstream
`ws-c-lane-c-source-universe`: register statewide Arizona candidate enrichment
as autonomous worker obligations; migrate the New Hampshire and New Jersey
collectors off their pilot-ballot denominators; enumerate the Arizona local
filing regimes as named jurisdiction obligations; and make new-ZIP readiness a
permanent check.

**Two of the three test files that plan named do not exist under those names.**
The plan wrote `tests/source-universe-migration.test.ts` and
`tests/local-regimes-az.test.ts`; what shipped is
`tests/source-universe-collectors.test.ts` and
`tests/local-regimes-arizona.test.ts`. Both resolve on disk and both are named
correctly below. The plan's names would have resolved to nothing, which is
exactly the failure this package exists to catch — so it is recorded rather than
quietly corrected.

| Claim | Where to verify |
| --- | --- |
| The acquisition denominator is the state, not one ballot | `tests/source-universe-collectors.test.ts` — *"NH: the acquisition asks for the WHOLE index, not for one ballot's surnames"* and *"NJ: the acquisition denominator is ELEC's whole location dropdown"* |
| A projection cannot be stated without the universe it was cut from | same file, *"a projection cannot be stated without the universe it was cut from"* |
| Going outbound for an already-owed record is a FAILURE, and it names the rows | same file, *"a projection that went outbound for an already-owed record is NOT READY, and names the rows"* |
| An unacquired location is `ROUTE_UNREAD`, never a sourced absence | same file, *"NJ: an unacquired ballot location is ROUTE_UNREAD, and never a sourced absence"* |
| Activating a new ZIP costs ZERO outbound acquisition (RULING 229) | `tests/new-zip-readiness.test.ts` — *"RULING 229: activating 85122 renders held statewide records with ZERO outbound acquisition"*, and *"85122 actually reaches a statewide contest, so the projection is not vacuous"* |
| All 15 Arizona counties are enumerated by name | `tests/local-regimes-arizona.test.ts` — *"every Arizona county is enumerated — all 15, by name"* |
| The registry refuses to be read as complete | same file, *"the registry REFUSES to be read as complete, and reports both adapted numbers"* |
| Two Arizona enumeration authorities disagree, and the disagreement STANDS | same file, *"the two enumeration authorities DISAGREE about city/town counts, and the disagreement stands"* |
| The enrichment obligations the worker schedules against | `lib/control-plane/scheduler/providers/candidate-enrichment.ts` and `lib/control-plane/scheduler/providers/local-jurisdictions.ts` |
| The three enrichment states are three different facts | `lib/hunt/candidate-universe.ts` — `EnrichmentState = "FOUND" \| "SEARCHED_NO_RESULT" \| "UNWORKED"` |

**One acceptance claim is NOT met, and it is the one that matters most for
Item 5.** The two new providers have **never been enumerated into committed
work state**. The committed shadow store holds 405 obligations and they are
`meetings 370` and `campaign-finance 35` — **zero candidate-enrichment rows and
zero local-jurisdiction rows.** Check it:

```
node -e 'const fs=require("fs"),p="data/control-plane/freshness-shadow/aggregates/obligations";
const t={}; let n=0; for (const f of fs.readdirSync(p)) { const o=JSON.parse(fs.readFileSync(p+"/"+f,"utf8")).value;
t[o.recordClass]=(t[o.recordClass]||0)+1; n++; } console.log(n, JSON.stringify(t));'
```

→ `405 {"campaign-finance":35,"meetings":370}`

So the providers exist, are tested, and schedule correctly — and **no obligation
they own has been materialised yet**. `pnpm freshness:shadow` is what would
materialise them, and it WRITES, so it is not run from an audit. Until it runs,
every Item-5 number below is counted from the source files, not from the
obligation store.

#### The Item-5 denominator table

**Read the caveat before the numbers.** `data/hunt/<state>-candidate-universe-2026.json`
says of itself, in its own `_note`: *"IT IS THE LARGEST DENOMINATOR DERIVABLE
FROM COMMITTED SOURCES TODAY, and it is not the state's candidate universe."*
Each state is currently derived from exactly one certified pilot-county ballot —
`data/states/az/ballot/az-pima-2026.json`, `nh-merrimack-2026.json`,
`nj-morris-2026.json`. **These are the acquisition denominators as recorded, and
recording them is not the same as claiming they are the state.**

Every number in the six tables below was re-derived by running the command
printed beneath it. None came from prose.

**Candidacies, and canonical identity**

| | candidacies known | with canonical identity | contests |
| --- | ---: | ---: | ---: |
| AZ | 55 | 55 | 15 |
| NH | 47 | 47 | 12 |
| NJ | 276 | 276 | 96 |

```
node -e 'for (const s of ["az","nh","nj"]) { const u = require("./data/hunt/"+s+"-candidate-universe-2026.json");
console.log(s.toUpperCase(), "known="+u.candidacies.length, "canonicalIds="+new Set(u.candidacies.map(c=>c.id)).size,
"contests="+new Set(u.candidacies.map(c=>c.canonicalContestId)).size); }'
```

**Canonical identity reads 100% BY CONSTRUCTION** in that file — the generator
mints the id, so the column cannot fail there. The only place a real
known-versus-canonical gap is recorded is Arizona, and it is a real gap:

| AZ identity registry | |
| --- | ---: |
| candidates | 57 |
| with a canonical candidacy id | 55 |
| **without one** | **2** |
| with a committee identity | 44 |

```
node -e 'console.log(JSON.stringify(require("./data/states/az/identity/az-2026-candidate-registry.json").denominators));'
```

**NH and NJ: NOT DERIVABLE — no identity registry exists for either state.**
`data/identity/` holds Arizona files only; `pnpm identity:az` has no NH or NJ
sibling.

**Campaign sites and positions**

| | site FOUND | site SEARCHED_NO_RESULT | site UNWORKED | positions FOUND | positions SEARCHED_NO_RESULT | positions UNWORKED |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AZ | 24 | 4 | 27 | 18 | 0 | 37 |
| NH | 10 | 0 | 37 | 10 | 0 | 37 |
| NJ | 6 | 0 | 270 | 6 | 0 | 270 |

```
node -e 'for (const s of ["az","nh","nj"]) { const u = require("./data/hunt/"+s+"-candidate-universe-2026.json");
for (const f of ["campaignSite","positions"]) { const t={FOUND:0,SEARCHED_NO_RESULT:0,UNWORKED:0};
for (const c of u.candidacies) t[c.enrichment[f].state]++;
console.log(s.toUpperCase(), f, JSON.stringify(t), "n="+u.candidacies.length); } }'
```

**`SEARCHED_NO_RESULT` is non-zero in exactly one cell of the six** — Arizona
campaign sites, 4. Everywhere else the distinction between *we looked and found
nothing* and *nobody has looked* has never been exercised, so today "gap" and
"unworked" are effectively one column outside that cell. That is a fact about
how far the hunt has got, not about the candidates.

**Finance**

| | candidate identities | committee identities | records reconciled | gap: ours | gap: theirs (sourced) |
| --- | ---: | ---: | ---: | ---: | ---: |
| AZ | 57 | 44 attributed · 716 statewide candidate committees | **716 of 716 agreed, 0 disagreed** | 4 | 1 |
| NH | 2,944 | 2,789 | NOT DERIVABLE — see below | 2 | 11 |
| NJ | NOT DERIVABLE — see below | 1,220 distinct entity ids | NOT DERIVABLE — see below | 0 | 172 |

```
node -e 'const az=require("./data/states/az/identity/az-2026-candidate-registry.json").denominators;
const c=require("./data/states/az/campaign-finance/az-2026-statewide-corpus.json").denominators;
console.log("AZ", JSON.stringify(az)); console.log("AZ corpus", JSON.stringify(c));
const nh=require("./data/states/nh/campaign-finance/nh-cfs-filer-index-2026.json"); const t={};
for (const r of nh.rows) t[r.filerTypeDesc]=(t[r.filerTypeDesc]||0)+1;
console.log("NH rows="+nh.rows.length, "stated="+nh.statedTotalItems, JSON.stringify(t));
const nj=require("./data/states/nj/campaign-finance/nj-elec-entity-corpus-2026.json");
const rows=Object.values(nj.byLocation).flatMap(v=>v.entities);
console.log("NJ entityRows="+rows.length, "distinctEntityId="+new Set(rows.map(e=>e.entityId)).size);'
```

```
node -e 'const r=require("./data/states/az/campaign-finance/az-seethemoney-2026-reconciliation.json").reconciliation;
console.log("AZ", JSON.stringify(r).slice(0,200));
const lu=require("./data/states/nj/campaign-finance/nj-elec-location-universe.json");
const c=require("./data/states/nj/campaign-finance/nj-elec-entity-corpus-2026.json");
console.log("NJ locations="+lu.locationCount, "acquired="+Object.keys(c.byLocation).length,
"neverAsked="+(lu.locationCount-Object.keys(c.byLocation).length));'
```

**Three things this table refuses to do, each named rather than smoothed over:**

- **NH's identity split is a filer-type tally, not a canonical identity count.**
  2,944 rows typed `Candidate` and 2,789 typed as one of the three committee
  kinds, out of 5,738 rows / 4,944 distinct filer ids. There is **no committed
  New Hampshire identity registry** joining any of them to a canonical candidacy;
  the only join that exists is inside `data/states/nh/funding/state-money-nh-2026.json`,
  over 28 candidacies.
- **NJ cannot be split into candidate and committee identities at all.** ELEC's
  entity rows carry `entityId, entityName, office, party, location, electionYear,
  electionType, totalContributions, totalExpenditures` — **no filer-type field**.
  That is a fact about the publisher's schema, and it is `NOT DERIVABLE` rather
  than a guess.
- **"Records reconciled" means one thing in Arizona and nothing comparable
  elsewhere.** Arizona's is a genuine per-committee summary-versus-itemised-ledger
  reconciliation: 716 tested, 716 agreed, 0 disagreed, 0 route gaps. New
  Hampshire has only an ACQUISITION reconciliation — 5,738 stated equals 5,738
  retrieved. New Jersey has only a LOCATION-COVERAGE reconciliation — **1,215
  filing locations in the universe, 240 acquired, 975 never asked.** Putting
  those three in one column as though they were the same measurement is the
  incommensurable subtraction the repository's own reconciler exists to stop, so
  they are not.

**Finance gaps, in full** (per candidacy, from each state's `split` block):

| | in scope | filed | registered, no activity | no reports on file | lead | route unread | **OURS_GAP** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AZ | 49 | 44 | 0 | 1 | 0 | 0 | **4** |
| NH | 28 | 9 | 6 | 11 | 2 | 0 | **2** |
| NJ | 239 | 67 | 0 | 172 | 1 | 0 | **0** |

```
node -e 'for (const s of ["az","nh","nj"]) { const f=require("./data/funding/state-money-"+s+"-2026.json");
console.log(s.toUpperCase(), JSON.stringify(f.split)); }'
```

**`OURS_GAP` and `noReportsOnFile` are different sentences and this table keeps
them apart.** The first is our gap — we have not got it. The second is theirs —
a sourced, dated absence at the publisher. NJ's `routeUnread: 0` is true only of
the 239 candidacies in scope; the 975 unasked ELEC locations sit outside that
scope entirely and are counted in the row above.

**Local jurisdictions**

| | enumerated | adapted by ANY route | **locally adapted** | **not yet locally adapted** |
| --- | ---: | ---: | ---: | ---: |
| AZ | 688 | 46 | 45 | **643** |
| NH | 552 | 11 | 0 | **552** |
| NJ | 1,401 | 1,401 | 0 | **1,401** |

```
node -e 'for (const s of ["az","nh","nj"]) { const r=require("./data/jurisdictions/"+s+".json");
const src=j=>j.sourceIds.map(id=>r.sourceCatalog[id]);
const ad=r.jurisdictions.filter(j=>src(j).some(x=>x.state==="ADAPTED")).length;
const loc=r.jurisdictions.filter(j=>src(j).some(x=>x.state==="ADAPTED"&&x.scope!=="STATEWIDE")).length;
const n=r.jurisdictions.length; console.log(s.toUpperCase(), "enumerated="+n, "adaptedAny="+ad,
"locallyAdapted="+loc, "notYetLocallyAdapted="+(n-loc)); }'
```

**Read the last two columns, not the middle one, and New Jersey is why.** NJ
shows `adapted 1,401 of 1,401` and `not yet adapted 0` — which would say every
government in the state is covered. It is not. One STATEWIDE ELEC route touches
all of them, so "adapted by any route" flatters to 100% while *reachable through
a route belonging to that government or its county* is **zero**.
`isLocallyAdapted` in `lib/hunt/jurisdiction-universe.ts` is documented in its
own source as the number that cannot be flattered by a statewide route, and it
is the honest column. Source catalogues behind it: AZ 130 sources
(2 ADAPTED, 2 REQUIRES_NEW_ADAPTER, 126 DISCOVERY_OWED); NH 554 (1, 0, 553);
NJ 1,368 (1, 0, 1,367).

### Item 6 — the no-GPU fly-in

| Claim | Where to verify |
| --- | --- |
| The ablation table | `docs/evidence/flyin-rotation-software.json` — 28 flights, seven arms, with the per-arm spread and the machine-load caveat inline |
| The culprit is one CSS property | same file: removing `backdrop-filter` alone buys **+13.9 fps of the +14.8** that removing the whole state-focus layer buys |
| Markers are NOT a culprit | same file: **+0.6**, smaller than their own spread, and reported as naming nothing |
| Hardware did not regress | `docs/evidence/flyin-normalized.json` — 100.3% of bare, against the standing 99.7% |
| Software now passes | `docs/evidence/flyin-normalized-software.json` — 100.1%, jank 1.5% |
| The permanent check asserts both | `pnpm walk:all`, `[W6H3] the fly-in on a browser with NO GPU acceleration…` — last run **RATIO 99.3% (MET), JANK 13.7% (MET)** |
| A check that cannot run says so | same output — the hardware arm declined on the last run because 3 of 3 bare flights healed mid-flight, and a decline is never a pass |

### OWN03 — the nine portraits

| Claim | Where to verify |
| --- | --- |
| All nine render, per person, decoded | Live at `/`: open **Officials**, click each name. Or `docs/evidence/own03-promotion.json` for the per-row record |
| The bytes are the bytes you approved | same file — each was re-fetched and compared against the decode you reviewed; a mismatch REFUSES the row rather than inheriting your approval |
| Your approval is recorded per image | `data/photos/review.json`, each keyed by person and by URL, `decidedBy: sean`, `decidedAt: 2026-09-01` |
| Each carries a licence row | `lib/registry/official-photos.json` — publishing office, source page, official-government-portrait basis with attribution and remove-on-request |
| Tom Horne is not closed by this | `docs/owner-audit/own03-portrait-count-correction.md` |

**The card URLs.** All nine are reached the same way: open the site, click
**Officials** in the left rail, click the person. Arizona's eight appear at
**85641** and **85701**; Dale G. Caldwell appears at **07866**.

---

## The final directive — Items A to K

Eleven items, run across five parallel lanes. **Every one has a section, whether
or not it is finished**, because a package that lists only the finished work
tells you nothing about the rest.

**How to read a result line.** `MET` means this package verified it and names
where. `NOT MET` means it was checked and it failed. **Neither `PENDING` is a
pass**, and they are different facts:

- **`PENDING — <lane>`** — not verified here, and the owning lane had not
  reported when this was written. **Every one of these has since been filled
  in; none remains.**
- **`PENDING THE MERGE`** — verified as far as it can be before the code is
  deployed, with the exact command to finish it and what a pass looks like.
  Two remain, and they are the only two: the legacy-host redirect, and
  production serving the Ask model — which is `claude-opus-5`, reverted on the
  measurement the same day it was switched (RULING 236). Both need the merge to have
  deployed, and both are re-run by the integration owner afterwards. A
  `PENDING THE MERGE` line that is never re-run is a failed acceptance.

**`OPEN — owner decision`** is a third thing again: the work is done and a
choice is yours. There is one, in Item J.

*Lane attribution below is read from the branch names in `git worktree list`
(`sc-final/l1-populations`, `l2-closeout`, `l3-domain-model`, `l4-brand`,
`l5-admin-staging`). Where the mapping from an item to a lane is an inference
rather than a fact, it says so.*

### Item A — populations

| | |
| --- | --- |
| **Arizona — ACQUIRED** | `data/states/az/candidates/az-2026-sos-candidate-filings.json` cites the Secretary of State's 2026 partisan filing list. Bytes committed at `tests/fixtures/az-sos-2026-candidate-filings.pdf`, sha256 `a13d2a82f83b…`, 183,097 B. Count: `node -e "const j=require('./data/states/az/candidates/az-2026-sos-candidate-filings.json'); console.log(j.candidacies.length)"` | **MET — 266 candidacies across 76 contests**, established TWICE by independent mechanisms (positional table recovery, and filing-date tokens counted out of the text layer); the adapter refuses to write on disagreement or on zero |
| **The registry equals the corpus** | `node -e "const r=require('./data/states/az/identity/az-2026-candidate-registry.json'); console.log(r.candidates.length)"` | **MET — 268** = the 266 filed candidates **plus 2 write-in nominees the certified canvass stars and the filing list never carried.** Every filing-list row is in the registry; nothing was dropped. The candidate universe moved **55 → 266** |
| **New Hampshire — NOT ACQUIRED** | `data/hunt/candidate-filing-authorities-2026.json`, the NH row | **NOT MET, and the wall is OURS.** The document is retrieved and hashed (sha256 `cd3d45a9db80…`, 77 pages, all with a text layer). The pages are **rotated**, so the generic table layer reads each COLUMN as a row and returns `ZERO_ROWS`; and this repository holds no sourced crosswalk from an NH State Representative district to an OCD division. A prototype recovered 1,268 rows whose segmentation could not be verified and **was not shipped**. `REQUIRES_NEW_ADAPTER` |
| **New Jersey — NOT ACQUIRED, and could not be** | same file, the NJ rows | **NOT MET, structurally.** The Division of Elections files **federal office only**; NJ's universe is the union of that authority and **21 county clerks**. No acquisition of these documents alone could earn the word "statewide" |
| **Both are relabelled rather than left overclaiming** | `lib/candidates/population-label.ts`; NH and NJ read `PILOT_DERIVED`, AZ reads `PARTIAL_AUTHORITY_ACQUIRED` | **MET** |
| **The AZ SOS `DISCOVERY_OWED` row resolves** | `data/states/az/jurisdictions/az.json` — key `BALLOT_AND_CANDIDATES:STATEWIDE:az-sos-candidate-filings`, now `ADAPTED` | **MET.** Its recorded URL also moved: the old one answered **404** while the document answered 200 — RULING 206, the record is not the URL |
| **Enrichment obligations, with denominators** | `pnpm readback:control-plane` | **MET — 1,087 → 1,720.** AZ 795 against a denominator of 266 corpus candidacies; NH 114 against 47 **pilot-derived**; NJ 811 against 276 **pilot-derived** |
| **R-C9 labels corrected everywhere** | `git grep -n "statewide" -- lib scripts` | **MET — 9 sites found, 6 corrected by the lane, 3 corrected by the integration owner** (the lane correctly refused to reach outside its ownership and reported them with exact text). 925 of the 1,720 obligations those headers described stand over pilot-derived populations |
| **Result** | **MET for Arizona. NOT MET for New Hampshire and New Jersey, with the wall named in each case and the population relabelled rather than left wearing a word it had not earned.** |

### Item B — the render test

| | |
| --- | --- |
| **Where to verify** | `tests/new-zip-render.test.ts` — case *"RULING 229: 85122 renders a held statewide record with ZERO outbound acquisition"*. Run it against a local production build: `pnpm build && pnpm start`, then `node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/new-zip-render.test.ts` |
| **The unit test is kept** | `tests/new-zip-readiness.test.ts` is untouched and still passes. Both together are the check | **MET** |
| **It renders the real application** | The test drives the Playwright route the walk uses, through `scripts/browser.mts` `launchGuarded` (so it cannot leak `x-wtp-synthetic-run`) | **MET** |
| **Outbound acquisition is trapped at BOTH layers** | Browser: `context.route("**/*")` records then aborts every non-loopback host. Server: `scripts/trap-outbound.mjs`, preloaded with `node --import`, wraps `fetch`, `http.request/get` and `https.request/get`, **appends every attempt to a log and only then throws**. A browser-only trap would have reported ZERO over a render that hunted during SSR | **MET** |
| **A held statewide record appears** | `[data-contest-id="ballot-az-pima:governor"]` containing a `.candidate-row` with **Katie Hobbs** — a statewide Arizona office, at a ZIP outside both pilots | **MET** |
| **Result** | **MET — 18 contests, 19 candidate cards, 0 browser outbound, 0 server outbound.** With no local build or no trap log the test **SKIPS with the missing piece named** rather than passing |

### Item C — the closeout truth surfaces *(this lane)*

| Claim | Where to verify | Result |
| --- | --- | --- |
| This page has an Item 5 acceptance section | The section above, headed *"Item 5 — the source universe stops being one ballot"* | **MET** |
| Every acceptance claim names a place to check, and none says "the session report" | `grep -n "session report" docs/owner-audit/session-c.md` — three hits, and **all three are narrative about the defect, none is a verification pointer**. The Item-5 parenthetical that used to be one is gone | **MET** |
| The Item-5 denominator table is derived, with the command beside it | The six tables above, each with its `node -e` one-liner. Re-run any of them | **MET** |
| The runner statement matches `pnpm pilot:status` at report time | The table in *"What required no operator"* above, and re-run the command | **MET** |
| The gate record persists suite totals on a PASSING run | `scripts/gates.mjs` — `suiteTotals` is now parsed on the success path; then `node -e 'const r=require("./data/ops/gate-runs/<newest>.json"); console.log(JSON.stringify(r.gates.find(g=>g.id==="test").suiteTotals));'` | **MET** — see the test-count section below |
| Every generated artifact regenerated, `pnpm handoff --check` green | `pnpm regen` prints `STALE 0`; `pnpm handoff --check` | See the close of this document |

### Item D — the municipal wiki artifact

**Verified against current `main` by reading the artifact and the git history —
not re-run.** The walk was already complete.

| Stated | Measured here | Result |
| --- | ---: | --- |
| 39/39 municipalities reached | **39 of 39** | agrees |
| 37/39 governing bodies parsed | **37** (`governingBody.form` non-null; the two without are Chatham Borough and Montville) | agrees |
| 38/39 rosters parsed | **38** (non-empty `council`; the one without is Jefferson Township) | agrees |
| 908 official rows | **908** = 220 council + 35 mayors + 653 template rows | agrees |
| 270 distinct officials | **270** distinct names across those three | agrees |

```
node -e 'const d=require("./data/states/nj/hunt/wikipedia-nj-morris.json"); const m=d.municipalities;
let council=0,mayors=0,tmpl=0; const names=new Set();
for (const x of m) { council+=(x.council||[]).length; (x.council||[]).forEach(p=>names.add((p.name||"").trim().toLowerCase()));
  if (x.mayor&&x.mayor.name) { mayors++; names.add(x.mayor.name.trim().toLowerCase()); }
  (x.fromTemplates||[]).forEach(p=>{ tmpl++; if (p&&p.name) names.add(p.name.trim().toLowerCase()); }); }
console.log("reached="+m.filter(x=>x.title&&x.fetchedAt).length,
"gbParsed="+m.filter(x=>x.governingBody&&x.governingBody.form!=null).length,
"rosterParsed="+m.filter(x=>(x.council||[]).length>0).length,
"officialRows="+(council+mayors+tmpl), "distinct="+names.size);'
```

| Claim | Where to verify | Result |
| --- | --- | --- |
| The artifact is committed and merged in PR #255 | `git log --format="%h %ad %s" --date=iso -- data/states/nj/hunt/wikipedia-nj-morris.json` → newest is `7514e68e`, 2026-09-01 09:22:43 -0700. `git merge-base --is-ancestor 7514e68e 91caa766` succeeds, and `91caa766` is #255's merge commit, merged 2026-09-01T16:56:31Z | **MET** |
| The artifact matches what its generator would produce | `pnpm regen` reports it `CURRENT` against `pnpm wiki:muni --state NJ --county Morris --confirm`, 6 source files | **MET** |
| No conclusion from the walk sits only in scratch output | The producer `scripts/wiki-municipality.mts` writes exactly one file (`writeFileSync` at line 320; everything else it emits is console text). The session scratch directory `.scratch/` in `C:\Users\seanj\dev\we-the-people` holds 77 files, **none modified on 2026-09-01**, none named for this walk, and `grep -rl "wikipedia-nj-morris" .scratch` returns nothing. The permission finding is committed in `docs/sources.md`; the route is in `data/method/knowledge.json` as `wikipedia-municipality`; the guard is `tests/wikipedia-permission.test.ts` | **MET** |
| The orphan-waiter defect is recorded as a reusable lesson | `docs/false-verifications.md`, row 6, *"The orphan waiter (9/1)"* | **MET** |

**Item D is met without another acquisition run.** Verification found no
unmerged data and no conclusion stranded outside a governed artifact.

### Item E — worker provenance

| | |
| --- | --- |
| **Where to verify** | `data/health/control-plane-readback/2026-09-01-03.json`, produced by `pnpm readback:artifact`, which runs `pnpm readback:control-plane` **as a subprocess** and parses every number back out of its verbatim stdout — there is no path by which a count reaches the artifact without the reader having printed it |
| **The counts, read back** | obligations **2,996** (candidate-enrichment 1,720, local-jurisdiction 1,177, meetings 83, campaign-finance 16); occurrences **1,346**, of which **55** carry a committed disposition; RouteTask dispositions **342**; debt rows 96 | **MET as a reading** |
| **The proof class did NOT move** | `proofClassOf` in `lib/ops/run-provenance.ts` requires `runClass ≠ LOCAL_SESSION`, `workingTreeClean`, and `integratedAtRunTime`. This run records `LOCAL_SESSION / true / false` | **NOT MET — still `SESSION_MEASURED`, deliberately.** A session cannot award itself independence by running the same command twice. Moving it needs a CI or scheduled run on an already-merged SHA, and the artifact says so in its own `_note` |
| **Two premises in the directive were wrong, and are corrected here** | The three figures 1,087 / 1,020 / 52 were never both in the repo and current: the durable store held **1,087 / 1,294 / 300**. And "the latest committed freshness run shows 94 obligations" is a **per-cycle** number, not a store total — the two were being compared as if they were the same quantity | Recorded |
| **`verify:readonly` and `census:runs` cannot answer this** | Both are scoped to the four collection stores and have never been control-plane aware. The read-back uses `WTP_CONTROL_PLANE_DATABASE_URL`, which is not the production read-only role. No second instrument was built — `pnpm dupes` passes | Recorded |
| **Result** | **PARTIALLY MET.** The read-back artifact is landed and the counts are regenerated after Item A. The proof class is **not** upgraded, and upgrading it from this session would have been the exact defect the class exists to prevent |

### Item F — the domain cutover

The base commit for this item is in the tree this package was written from
(`35afd378`), so its anchors are named and checked; **whether the cutover is
live in production is the owning lane's to report.**

| Claim | Where to verify | Result |
| --- | --- | --- |
| Three named origins, one public site origin | `lib/ops/origins.ts` — `PUBLIC_SITE_ORIGIN`, `STAGING_RENDER_ORIGIN`, `ADMIN_ORIGIN`, plus `LEGACY_NETLIFY_ORIGIN` kept apart from `NETLIFY_SITE_ID_DEFAULT` | **MET in the tree** |
| The production host is not hardcoded anywhere else | `tests/origins.test.ts`, *"the production host is not hardcoded outside the origins module"* | **MET in the tree** |
| The legacy host 301s to the new one | `netlify.toml` lines 98–102, and `tests/origins.test.ts`, *"netlify.toml forwards the legacy host with a 301"* | **MET in the tree** |
| The redirect actually serves from production | `curl -sI https://sparkwtp.netlify.app/` and read the `301` and the `location:` header | **PENDING THE MERGE.** `netlify.toml` ships with the RULING-1 merge, so the redirect cannot serve before it. Measured **before** the change, on 2026-09-01: `GET https://sparkwtp.netlify.app/` returned **200, not a redirect** — the old host was serving the whole application in parallel with the new one. Re-run the command after the merge; a `301` with `location: https://meanwhileusa.com/` is the pass |
| The observer targets the new host | `scripts/post-deploy-observer.mts` — `PRODUCTION_BASE_URL = PUBLIC_SITE_ORIGIN`. One read-only cycle ran 30 probes against `https://meanwhileusa.com/api/build` and recorded nothing | **MET** |
| Canonical / OG / sitemap / CORS references | There were **none to move**: no `metadataBase`, no sitemap machinery, and no CORS or allowed-host list existed anywhere in `next.config.ts`, `app/` or `netlify/`. Item J then added the OG image, which resolves absolute via `PUBLIC_SITE_ORIGIN` | **MET, and stated rather than implied** |

### Item G — the repository rename

| | |
| --- | --- |
| Claim | Where to verify | Result |
| --- | --- | --- |
| The origin remote addresses the new name | `git remote -v` — `https://github.com/SeanJ22/meanwhile.git`. The remote is shared by every worktree of this clone, which is intended | **MET** |
| Netlify is re-linked, **read back from the provider** | `GET https://api.netlify.com/api/v1/sites/6b39b212-…` → `repo_url https://github.com/SeanJ22/meanwhile`, `repo_path SeanJ22/meanwhile`, `installation_id 123276790` | **MET.** Two things to know: the brief's premise was stale (the BEFORE read already showed the new name, so the PATCH was a re-assert), and the first PATCH **nulled `installation_id`** — the GitHub App link — by omitting it. It was re-PATCHed and the integration owner re-read it independently. **Netlify treats `build_settings` as a replacement; read back every field you care about, not only the one you changed** |
| Live references changed, records left alone | Inclusion rule: *change a reference only if it is an ADDRESS used to reach the repository today; leave it if it is a RECORD of something that happened.* **8 changed** — `docs/deploy-key-setup.md`, `docs/refresh-unblock-runbook.md`, `lib/ops/required-checks.ts`, `scripts/extract.mts`, `scripts/protection-verify.mjs`, `scripts/stage-own03-portraits.mts`, `tests/deploy-key-ssh.test.ts`, `tests/push-main.test.ts`. **19 left** — captured logs, recorded fixtures, dated provenance, the governance ledger and history, generated views | **MET** |
| Workflows needed nothing | `git grep -n "SeanJ22" -- .github` — zero hits; already name-independent | **MET** |
| Nothing depended on the old literal | One observer cycle, run **read-only** with `WTP_RUN_ID` declared: 30 probes to `https://meanwhileusa.com/api/build`, exit 0, **nothing recorded** | **MET** |
| Branch protection survived the rename | `gh api repos/SeanJ22/meanwhile/rulesets/21572280` — active, `pull_request`, `required_status_checks` strict with the three contexts, `deletion` and `non_fast_forward`. Note `branches/main/protection` returns **404**: protection is a RULESET, and the 404 is expected rather than alarming | **MET** |
| **Result** | **MET.** Organization transfer to `meanwhileusa/meanwhile` is deferred to incorporation and recorded on `docs/frontier.md`; nothing is blocked on it |

### Item H — the admin control centre

| | |
| --- | --- |
| Claim | Where to verify | Result |
| --- | --- | --- |
| The alias exists and resolves over HTTPS | `GET /sites/6b39b212-…` → `domain_aliases ["admin.meanwhileusa.com"]` (was `[]`); DNS zone `6a96f46e…` holds `NETLIFY admin.meanwhileusa.com`, `managed: true`; `curl -sI https://admin.meanwhileusa.com/api/build` → **200, `ssl_verify_result=0`** | **MET, provider-confirmed** |
| The certificate covers it, and did not re-issue | `GET /sites/…/ssl` → `issued`, `["*.meanwhileusa.com","meanwhileusa.com"]`, expires 2026-11-30 <!-- expected-future: the TLS certificate expiry read from the Netlify API GET /sites/6b39b212-.../ssl on 2026-09-01. A provider fact about a certificate, not a stamp on this document. -->, **re-read after both the alias and the branch-suffix change** | **MET** |
| Admin routes 404 on the public host | `tests/admin-control-centre.test.ts`; and against a local production build with a `Host:` header — `/admin`, `/admin/login`, `/api/admin/session`, `/api/admin/decision` all **404** on the public host while `/api/build` still 200s | **MET (seeded failure 1)** |
| Unauthenticated requests on the admin host are refused | admin host: `/admin` → 307 to `/admin/login?why=NOT_CONFIGURED`; `/api/admin/decision` → **401**; `/ballot` → 404 | **MET (seeded failure 2)** |
| A number rendered without a denominator fails the page's own check | `tests/admin-control-centre.test.ts`, the render audit | **MET (seeded failure 3)** |
| The session cookie is what it must be | wrong secret → 303 `?why=REFUSED`; cross-origin → 303 `?why=ORIGIN`; correct → `Set-Cookie: __Host-wtp-admin=…; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`, **no `Domain=`** | **MET** |
| PILOT HEALTH matches `pnpm pilot:health` | Structurally — the publisher calls the same pure functions rather than parsing stdout. Both at `35afd378`: READER `NOT_READY`, TRUTH `NOT_READY`, FRESHNESS `NOT_READY`, PILOT **NOT GREEN** | **MET** |
| Heartbeat and digest equal the runner's durable records | `pnpm owner:readback` → **READ-BACK HELD**; 1 digest, **47 lines stored exactly as the runner emitted them**; every number survived the round trip with its denominator; control plane at schema v3, 20 of 20 tables, no drift | **MET** |
| One decision travels intent → canonicalization | Driven through the real route handler (three refusals first: 404 public host, 403 cross-origin, 401 no session), then `pnpm owner:canonicalize` → **`CANONICALIZED`**. To be exact: it resolved to an **existing** current ruling rather than creating one, and is recorded as a **mechanism proof, not an owner decision** | **MET, with the caveat stated in the record itself** |
| Env vars on Netlify, by NAME | `WTP_CONTROL_PLANE_DATABASE_URL`, `WTP_ADMIN_SECRET`, `WTP_ADMIN_SESSION_KEY` — all `is_secret=true`, contexts `[production, branch-deploy]`. **No value was read or printed** | **MET** |
| **Result** | **MET in the tree and at the provider; NOT YET LIVE.** `middleware.ts` ships with the RULING-1 merge, so until that merge `admin.meanwhileusa.com` serves the public app. Re-verify after the merge with the HTTPS probe above |
| **You must do one thing** | `WTP_ADMIN_SECRET` was generated and set via the API **without ever being printed**. Read its value from the Netlify UI (Site configuration → Environment variables) to log in, or replace it with one of your own |

### Item I — staging

| | |
| --- | --- |
| **Note** | RULING 233 (alias `R-C10`) — staging-first — is recorded as **adopted but NOT operative until the session after Session C closes**. Nothing below reads as though it were already binding. |

| Claim | Where to verify | Result |
| --- | --- | --- |
| DNS, TLS and host routing for the staging subdomain | `curl -sI https://test.meanwhileusa.com/api/build` → **404 with `ssl_verify_result=0`** before the branch exists, which is the correct pre-branch state: the host resolves on the wildcard and Netlify answers "no branch deploy by that name" | **MET** |
| Netlify is configured for exactly one branch deploy | `allowed_branches ["main","test"]`, read back from the API; plus `scripts/netlify-staging-ignore.mjs`, which **derives** the branch from `hostOf(STAGING_RENDER_ORIGIN)` rather than hardcoding it | **MET** |
| **The branch is named `test`, and RULING 233 says `staging`** | **RULING 235** records the measurement as a **FACT** — four ways against the live API, with a positive control — and deliberately does **not** amend the ruling. **NH304** carries the choice to you | **CONFLICT REPRESENTED, NOT RESOLVED.** The session shipped under `test` only because RULING 233 is not operative yet; nothing is decided that you cannot undo |
| Database isolation | **NOT MET — NEEDS SEAN.** There is no Neon control-plane API key in this environment, so a database branch cannot be created. Nothing pretends isolation exists | **NOT MET, named** |
| The isolation seeded failure works anyway | `pnpm staging:isolation` — branch-deploy context resolving the production `DATABASE_URL` → **`REFUSED`**, printing variable NAMES only; an `unknown` resolution also refuses (CANNOT_TELL fails safe) | **MET** |
| `STAGING_RENDER` exists as a target without becoming an activation bypass | `EVALUATION_TARGETS`; the duplicate union in `capability-registry.ts` replaced by an import; `satisfiesActivationGate` requires target **and** proof class in one call. `scripts/reader-suite.mts`'s RULING-125 host refusal is untouched | **MET** |
| Promotion proved in BOTH directions, without moving `main` | `pnpm promote:staging` — eligible run exits 0 `PROMOTION ELIGIBLE`; refused run collects **7 refusals by name** (`STALE_HEAD, SUITE_RED, VISUAL_RED, REQUIRED_CHECKS_NOT_GREEN, WRONG_DATABASE, FREEZE_NOT_CLEAR, NOT_FAST_FORWARD`) and exits 1; no flags exits 2 (could-not-tell) | **MET.** `--execute` needs `WTP_PROMOTION_ARMED=1` and opens a **PR**, because ruleset 21572280's `pull_request` rule makes a direct fast-forward unavailable and the exempt deploy key must never carry code |
| The second observer | `pnpm staging:observe` run live → `OUTCOME: COULD_NOT_TELL`, `probe 1 NO ANSWER … HTTP 404`, **nothing recorded**. It opens no database and refuses structurally to write the production record path | **MET** |
| Deploy Previews | The brief says they "remain available"; they have been **cancelled since g17**. Left cancelled, and the conflict is represented in `netlify.toml` rather than resolved — re-enabling amends a ruling | **CONFLICT REPRESENTED** |
| **Result** | **PARTIALLY MET.** Everything that does not require a Neon branch or the integration head is built and proved. Database isolation is a named NEEDS_SEAN blocker |

### Item J — brand identity

| | |
| --- | --- |
| **Open owner row** | `B01` — *settle the product's name* — has been in your queue 21 days and is listed below. A brand item shipped while that row is open is a decision this package cannot make. |

| Claim | Where to verify | Result |
| --- | --- | --- |
| `--font-record` and `--mark` declared dark-first with the scoping comment | `app/globals.css`; verified in the **built chunk** with no `colorScheme` override: `--mark` → `#00b894` (no `data-theme`) and `#00896e` (`data-theme="light"`) | **MET** |
| Contrast measured as NUMBERS, four surfaces, both themes | `--mark` vs `--bg` / `--panel` / `--panel-bg` / `--surface`: dark **7.44 / 6.86 / 6.41 / 6.11**; light **3.90 / 4.37 / 4.15 / 3.73**. `--mark` is a non-text graphic, so the applicable bar is 3:1 and the lowest reading is 3.73 | **MET — no applicable bar fails, and no exemption was written** |
| EB Garamond self-hosted, no reader address reaches Google | `app/layout.tsx`, `next/font/google`, privacy reasoning in a comment. **Network capture: 344 requests, exactly two hosts** (`127.0.0.1:3000`, `api.maptiler.com`), **zero** to `fonts.googleapis.com` or `fonts.gstatic.com`. The count is floored (RULING 159), so a browser that never started cannot print the same reassuring zero | **MET** |
| One Logo component, both variants, drawn not typed | `components/brand/logo.tsx` — `<circle>`×2 and `<rect>`, no `…` or `.` glyph; `role="img" aria-label="Meanwhile"`; the 18px floor is enforced **in the component** | **MET** |
| No inline brand display text in the app shell | **8 call sites converted.** Three `PRODUCT_NAME` uses survive deliberately and are not display text: two share/calendar payload strings, and a `ctx.fillText` into a downloadable canvas PNG, which cannot consume a React component | **MET** |
| Both pins removed, and `--link` is off every brand element | `.welcome-icon` deleted. **Two live defects, not one:** the overlay's pin wore `var(--link)`, the "tappable" accent; the sidebar's wore `var(--accent-local)`, a **tier** colour a reader learns from the map legend — so the brand was making a tier claim. The brief named only the first | **MET** |
| Icons and OG present and serving | `app/icon.svg`, `app/apple-icon.png` (180×180), `app/opengraph-image.png` (1200×630), and `app/favicon.ico` **replaced** — it was the create-next-app default, listed by Next *ahead* of `icon.svg`. `og:image` resolves absolute via `PUBLIC_SITE_ORIGIN`, no literal | **MET** |
| The undeclared-token class | **18 found, 18 fixed** — `--border` ×10, `--rule` ×4, `--destructive` ×2, `--paper` ×1, and one visible only in the built chunk. Verified in a browser before and after: `.voting-panel` went from `border-top-style: none` to `solid` | **MET — the brief said nine** |
| **The eighteenth is worth reading** | Tailwind v4 scans every tracked file **including comments**, and the BAL-26 paragraph in `tests/ballot-ask-pill.test.ts` quoted the broken class literally — so **a fixed defect's own documentation was compiling a live `border-color: var(--line)` rule into production CSS.** Dead, but shipping | Recorded |
| Hardcoded-hex sweep | **35 found, 3 fixed, 32 classified.** The fix that mattered: `components/ui/button.tsx` had an **amber** hover on a **cyan** button, left by the palette pass — the one loud control on the screen changed hue on hover | **MET** |
| **The sidebar adjacency — YOUR DECISION** | Six captures at `docs/evidence/brand-2026-09-01/after/sidebar-{dark,light}-{local,state,national}.png`. **In dark theme the mark and the selected State tab are the same hex, `#00b894`.** The lane's read is that they do not collapse — a ~4px square terminating a serif wordmark against a ~130px filled pill, with two controls between — and light separates on lightness. But the dark identity is exact, including on Local and Federal screens where nothing teal is selected. **No adjustment was made; the brief said this is yours** | **OPEN — owner decision** |
| **Result** | **MET**, with one open owner decision (the dark adjacency) and one open owner row (`B01`, the name) |

### Item K — the Ask model switch

| Claim | Where to verify | Result |
| --- | --- | --- |
| Exactly one function emits a `SwitchVerdict` | `git grep -nE "\)\s*:\s*SwitchVerdict"` — one line, `lib/ask/model-economics.ts` | **MET** (also Item 2 above) |
| The switch away from the incumbent is an OWNER override, not a measurement | **RULING 234** (alias `R-C11`) records the owner overriding the H2 `RETAIN` verdict, **for the Sonnet 5 switch only**. `model.switch_rule` is **untouched** | **MET** |
| **THE SWITCH WAS REVERTED THE SAME DAY, BY RULING 234'S OWN CLAUSE** | `lib/ask/model.ts` reads `claude-opus-5`. **RULING 236** records the measurement. The named question is *"what will the weather be like on election day"* — `walk:all` `[g12]`, all four pilot ZIPs: the incumbent REFUSES it, the challenger ANSWERS it. Proved on ONE build with the model as the only variable (`WTP_ASK_MODEL`). Re-check with `pnpm walk:all` against a local production build and read the four `[g12]` weather rows | **REVERTED ON EVIDENCE — the mechanism working, not a failure of it** |
| The model moved, in one constant | `lib/ask/model.ts` with the measurement-integrity comment; `WTP_ASK_MODEL` / `WTP_ASK_EFFORT` overrides default to it, and an invalid effort is **refused** rather than passed through to a 400 | **MET** |
| Nothing had to be removed from the request | `temperature`, `top_p`, `top_k` and `budget_tokens` **appear nowhere in this repository**, and thinking was already `{type:"adaptive"}`. All four rung shapes verified against Sonnet 5 by **live request, HTTP 200 each**, before anything was switched | **MET** |
| The suite was re-run per question, both arms *(and this measurement is what made the revert cheap)* | 7 canonical questions, 3 passes per arm, one pack proven identical by digest, caches cold. **Sonnet held every question Opus held, and strictly more on both contested ones** — Q3 1/3 vs 0/3, Q5 2/3 vs 0/3. **No question held on Opus and failed on Sonnet.** Cold cost `$0.34649` → `$0.13103`, a measured **2.64×** against a 2.5× rate card | **MET** |
| Effort was measured, not reasoned | low 3/4, medium 3/4, high 3/4; **`xhigh` and `max` BREAK the output contract** at `max_tokens: 2048` — thinking counts against the ceiling and the JSON truncates mid-string. `medium` retained | **MET** |
| Token budgets recounted | **2 found, 2 corrected.** The system prompt 478 → 471 — and **identical on both models**, so the brief's "counts run higher" **did not hold** and is reported as a disagreement. And the minimum cacheable prefix 512 → **1024**, measured by request | **MET** |
| Every model-ID call site found; only Ask changed | 4 Ask files changed; `lib/control-plane/model-cost.ts` (workers) and `tests/executor-identity.test.ts` **deliberately untouched** | **MET** |
| Sonnet 5 was genuinely served and measured before the revert | `synthesis.model claude-sonnet-5`, `synthesis.effort medium`; startup line `ask · model claude-sonnet-5 · effort medium`. **This row is kept deliberately**: the switch was really made and really measured, which is what made reverting it a one-constant edit rather than an argument | **MET, then reverted — see the row above** |
| **Production serves the reverted model** | Requires the deploy. After the merge: `POST https://meanwhileusa.com/api/ask/grounded` with `x-wtp-synthetic-run`, and read `trace.synthesis.model`. **Pass = `claude-opus-5 medium`** — the revert target, not Sonnet 5. Anything else, or a null model, is a fail | **PENDING THE MERGE** |
| The override reaches EVERY Ask rung | Three of four call sites bound the constant at module load, so `WTP_ASK_MODEL` reached only `synthesize.ts`. **That broke the reversibility mechanism this ruling depends on**, and it is how the first isolation run reached the wrong answer. All four now resolve at call time; `tests/ask-model-constant.test.ts` refuses a module-bound binding | **FIXED — found by the attribution, not by the tests** |
| A harness defect was found and fixed rather than reported | `derive()` FILTERED incomparable questions out instead of carrying them as unmeasured, so a sweep emitted `SWITCH` over **one row** and reported `questions: 1` as though that were the plan. Now carried as `held: null`, so RULING 230's own guard fires; the record states its denominator | **MET** |
| A second defect, found by running the first fix | `--regenerate` read the arm names from **today's constants**, which the switch had swapped — so re-deriving a pre-switch record stamped a real measurement with **reversed roles**. Three such records were written and **deleted**; the path now refuses a mismatch with the correct command | **MET** |
| The measured comparison record still says what it said | `data/health/ask-model-compare-runs/2026-09-01-1788271705266.json` — `verdict.kind` `HOLD`, `decision` `RETAIN:claude-opus-5` | **MET** |

**The three rulings adopted this session**, for the record: **RULING 232**
(alias `R-C9`, labelling), **RULING 233** (`R-C10`, staging-first — adopted, not
yet operative), **RULING 234** (`R-C11`, the owner override of the H2 `RETAIN`
verdict for the Sonnet 5 switch only). They land in the canonical ledger from
the integration branch, not from any lane. Verify with `pnpm governance:check`
at the integrated head, and `pnpm governance:open --task meta-governance` to
read them; both the `RULING n` and the `R-Cn` names resolve.

---

## The test-count denominator — 4,555 against 4,562

The session report said **4,555 tests**. The pull-request close-out said
**4,562**. The gate run record could not settle it, and the reason it could not
is worth more than the number.

**Both were correct measurements of the same test tree.** No test file changed
between the two commits — `git diff --stat 7514e68e f2e1aa9b -- tests/` reports
one file, `tests/generator-digests.json`, which is a digest record and not a
test. So the tree cannot explain a seven-test difference.

**The environment does, exactly — and this was proved by running it, not
argued.** `tests/control-plane-conformance.test.ts` runs one fixed sequence
against every available provider. The Postgres provider registers only when
`WTP_CONTROL_PLANE_DATABASE_URL` is set, and **`pnpm test` does not load
`.env.local`** (`package.json` — the `test` script carries no `--env-file`).

The same file, the same tree, the same command, differing only in whether the
environment file is loaded:

```
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  tests/control-plane-conformance.test.ts
                                        →  tests 18, pass 18, fail 0

node --env-file=.env.local --test --experimental-strip-types \
  --import ./scripts/register-test-loader.mjs tests/control-plane-conformance.test.ts
                                        →  tests 25, pass 25, fail 0
```

**25 − 18 = 7**, and the seven are named. **Compared by NAME, not by count** —
every name in the 18 is present in the 25, and the additions are exactly:

```
postgres: an identical re-put is a NO-OP SUCCESS, not a second record
postgres: a DIFFERENT value under a derived id REFUSES
postgres: compare-and-set refuses a STALE revision and says how far behind
postgres: mustRead on an absent aggregate REFUSES rather than defaulting
postgres: an append-only log refuses a rewrite and accepts a retry
postgres: list is ordered by id, so a report is diffable
postgres: durable says what it means
```

**Three of those seven are the three that failed in gate record
`2026-09-01-05`** — the re-put, the compare-and-set and the append-only log —
which is the same lane, named, from the other direction. So: **4,555 + 7 =
4,562.**

**The other three candidates were checked and each is ruled out by name:**

- **Not a test file added or removed.** `git diff --stat 7514e68e f2e1aa9b -- tests/`
  reports one path, `tests/generator-digests.json`, which is a digest record and
  contains no tests.
- **Not a whole file killed at load by `--experimental-strip-types`** (a
  parameter property or an `enum`). A file that fails to load makes
  `node --test` report a FAILURE; both runs above report `fail 0`, and the file
  loads under both.
- **Not an aborted run.** Record `2026-09-01-05` reached its summary — that is
  where `4562 / 4559 / 3` came from — and its `failureKind` is
  `ASSERTION_FAILURE`, not `EARLY_ABORT`.

- **4,562** is the COMPLETE run — all three providers. It is on disk in
  `data/ops/gate-runs/2026-09-01-05.json`, tested SHA `f2e1aa9b`. **It is also a
  FAILING run:** `ASSERTION_FAILURE`, `4562 tests, 4559 pass, 3 fail`, and the
  three are the Postgres lane's own — they were fixed at `c389cbd6`.
- **4,555** is the same tree with a whole lane that never executed. It appears
  exactly once in the repository, at `docs/state.md` line 22848, and **no gate
  run record anywhere holds it.**

**So the correct denominator is 4,562, and 4,555 is a run that silently did
less.** Neither number was a lie; the smaller one was a measurement of a
narrower thing, and nothing on disk said so.

**4,555 was then measured directly rather than inferred from arithmetic.** This
lane's branch is `origin/main` plus one new test file:
`git diff --stat 82c3a419 HEAD -- tests/` shows `tests/origins.test.ts` added
with **6** tests, and the two other files it touches carry the same number of
tests on both sides (8 and 33). Running the whole suite with that one file
excluded from the glob:

```
FILES=$(ls tests/*.test.ts | grep -v "^tests/origins.test.ts$")
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs $FILES
             →  413 files (against 414), tests 4555, suites 32, pass 4554, fail 1
```

**`tests 4555`, exactly.** So the three numbers are one tree seen three ways:
**4,555** is `main` in a shell without the Postgres lane, **4,561** is this
branch in the same shell, **4,562** is `main` in a shell that has it.

*(The single failure in that run is `RULING 102: no generator has moved since
its artifact was last regenerated` — the digest for `scripts/gates.mjs`, edited
minutes earlier and not yet re-recorded. It is unrelated to the exclusion and
changes nothing about how many tests registered.)*

**Measured here, in this lane's tree** (`35afd378`, which adds
`tests/origins.test.ts` — six tests — for Item F): `tests 4561, pass 4560,
fail 0, skipped 1`. That is 4,555 + 6, so this run also skipped the Postgres
lane. The skipped test is the built-chunk scan, which reports CANNOT RUN without
`.next/static`.

**What now makes the number derivable.** The gate record's schema **already
declared `suiteTotals`, and nothing ever filled it in on a green run.**
`scripts/gates.mjs` parsed the suite summary only inside its `catch` block, so
**every passing gate run wrote `"suiteTotals": null`** — records `01`, `03`, `04`
and `06` all did. The only totals this repository had ever persisted came from
runs that were red, which is exactly backwards: a close-out quotes the number
from the run it shipped on, and that run is green.

Three things changed, all in `scripts/gates.mjs`:

1. **The summary is read on the success path too**, not only in `catch`.
2. **It carries `suites`, `skipped`, `todo` and `cancelled`** beside `tests`,
   `pass` and `fail` — because *fewer tests registered* is the only shape a
   skipped lane has, and a difference between two runs can live in `skipped` or
   `cancelled` rather than in `pass`.
3. **A total that could not be read records `read: false` with the reason in
   words, and never `0`.** Zero tests is a measurement; "the summary was never
   printed" is not, and a record that wrote `0` for the second would be a false
   claim about the suite. Every counter inside `totals` obeys the same rule —
   `null` when the runner did not print that line, never a defaulted zero.

The record now carries a hoisted `suiteDenominator` block so nobody has to hunt
through fourteen gate entries for the one that answers:

```
node -e 'const fs=require("fs"),d="data/ops/gate-runs";
const f=fs.readdirSync(d).filter(n=>/^\d{4}-\d\d-\d\d-\d+\.json$/.test(n)).sort().pop();
const r=JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));
console.log(f, r.testedSha); console.log(JSON.stringify(r.suiteDenominator, null, 1));'
```

`pnpm gates` also prints one `suite denominator:` line at the end of its run,
and says `NOT MEASURED` rather than a number when the gate printed no summary.

**And the record now says which lanes were even ELIGIBLE.** A total is only
comparable against a total taken under the same environment, so the record
carries a `suiteLaneEnv` block naming each environment variable that gates a
test lane and whether it was **present** — presence only, never the value,
because a gate record is committed and a connection string has no business in
one. Without it, a run that skipped a lane and a run that lost seven tests look
identical, which is the whole reason 4,555 and 4,562 could not be adjudicated.

**Two honest cautions about any single suite total on this machine:**

- **The number depends on the shell.** This lane's green run reports **4,561**
  with `WTP_CONTROL_PLANE_DATABASE_URL` **not present**, so the Postgres lane
  did not register. A run of the same tree from a shell that has it will report
  seven more. Neither is wrong; they are answers to different questions, and the
  record now says which question was asked.
- **A single run is not a stable denominator while five lanes build in
  parallel.** The integration owner met a Windows sharing violation
  (`errno -4094`) twice, running the suite directly, while
  `tests/generated-artifacts.test.ts` was executing a generator that writes
  `docs/governance/index.json` — and the same suite passed inside `pnpm gates`
  at the same commit. That is host contention, the same class as the recorded
  `EARLY_ABORT` false red, and **a flaky run must not become anyone's
  denominator.** Take the number from a green gate run's record.

**The authoritative number for this close-out is the one in the gate record at
the INTEGRATED head**, not this lane's branch — and it is now in the record
rather than in a sentence.

---

## The Needs-Sean queue, oldest first

**Sixty-five rows, and the table below renders sixty-five ids.** Each one's full
card — what is needed, why no machine can decide it, the options and their
consequences — is in `docs/tracker-owner-view.md`, which is generated from the
stores and cannot disagree with them. Count them yourself:

```
grep -cE "^#### " docs/tracker-owner-view.md
```

→ `65`, against the `**65 row(s).**` that file states above its own list. The
remaining four of the sixty-nine are in the section after this one; they are not
decisions.

| Age | Row | What it is |
| ---: | --- | --- |
| 21 days | `T05` | Abuse policy live — the review path behind the written policy |
| 21 days | `B01` | Settle the product's name |
| 21 days | `B03` | Entity decision |
| 21 days | `B04` | Data broker registration |
| 21 days | `T01` | Transparency page |
| 21 days | `T03` | Security review |
| 21 days | `D70` | Agenda-platform tenant enumeration crawler |
| 21 days | `PB10` | FEC client beyond totals — blocked on election-law counsel |
| 21 days | `B02` | Trademark search |
| 21 days | `B05` | Find counsel |
| 21 days | `B07` | Pricing methodology |
| 21 days | `C01`–`C04` | Mock export, buyer dashboard, export format, calibration log |
| 21 days | `T02`, `T06`, `T07` | Identity verification, manual tier calibration, escalation contacts |
| 21 days | `V01`, `V03`–`V06` | Five buyer calls, Legistar prototype, alignment grid, tracking-poll answer, reading-level test |
| 20 days | `B09` | Counsel question — vendor terms vs. public records duty |
| 19 days | `D23` | FEC contributor information — commercial-use restriction |
| 18 days | `X02`, `X03` | Instagram presence, podcast pitch |
| 11 days | `NH43` | Three bodies at 03255 that no branch and no manual route reached |
| 10 days | `NS01` | Whether this project seeks a Meta Ad Library API token |
| 9 days | `NH108` | Four decisions before any candidate questionnaire is sent |
| 9 days | `NH105` | Approve the questionnaire message before 272 real candidates receive it |
| 8 days | `NH165` | Severe Speak Your Mind rows waiting, and `T05` is the reason |
| 8 days | `NS12` | No Netlify credential on this machine |
| 8 days | `NS13` | Close-out refusal collides with the merge-cadence rule |
| 8 days | `NS14` | VOTE411 publishes no terms of use |
| 8 days | `V07`, `V08` | Ed-tech version (parked), candidate coverage-gap report |
| 8 days | `NH164` | Speak Your Mind disclosure copy, as shipped |
| 7 days | `NH174` | Four door-2 portraits of sitting officials, queued |
| 7 days | `NS16` | The 8/25 feedback document is not anywhere a session can reach |
| 7 days | `NH166` | Dr. Gabriel Trujillo's photo — TUSD superintendent |
| 7 days | `NS10` | Propose a tribal division type to the national identifier list? |
| 7 days | `NH194` | Dark-mode map contrast proposal |
| 6 days | `NS17` | BC-14's fourth source link is on the votes |
| 5 days | `ASK03` | Ask signal capture is built and gated off pending disclosure copy |
| 5 days | `NH225` | `azdor.gov` disallows ClaudeBot by name while allowing everyone else |
| 5 days | `NH246` | The disclosure exists and a tester could not find it |
| 4 days | `NH274` | Install tesseract so 151 Arizona Governor letters can be read |
| 4 days | `NH275` | `claude/g17-audit` carries unshipped work and must not be deleted unread |
| 4 days | `NH277` | May a corroborating meeting route become an ingestion source? |
| 4 days | `NS19` | BAL-12 uniform pill sizing |
| 3 days | `NH282` | Choose a durable workflow driver |
| 3 days | `NH283` | `RESTRICTED_RAW` evidence needs an encrypted store |
| 3 days | `NH287` | Method store records outcome jurisdiction at state granularity |
| 2 days | `NH299` | The owner corpus is two facts and zero questions |
| 2 days | `NS22`, `NS23` | Author the reader-question corpus and the known-answer control set |
| 1 day | `OWN01` | WGH-20 — body count mismatch (card above) |
| 1 day | `OWN02` | OFF-8 — photo resolution too low for the display |
| 1 day | `OWN04` | OFF-10 — Katie Hobbs's photo renders badly on the ballot |
| 1 day | `OWN05` | BAL-36 — no legislative record for the governor (card above) |
| 1 day | `OWN06` | BAL-37 — no address autocomplete (card above) |
| today | `NH200` | Dark-mode map: three options captured, which one |
| today | `NH303` | **New today** — the four full-resolution AZCC portraits |
| age unknown | `NH276` | Is an owner-created branch ever retired automatically? |

**`NH303` is the one this session added.** Four of the nine portraits you
approved are Arizona Corporation Commissioners, and all four are under the large
card's resolution floor — because the URLs the original hunt took were **CMS
renditions**, not files. Removing the rendition parameters on the same host
returns the same photographs at 2,533–3,275px wide. They are staged rather than
shipped, because a decision is about an image and a 3,275px original is not the
133px crop you approved. Nothing is blocked meanwhile: the approved thumbnails
render.

### The other four — nothing to decide, only to acknowledge

These complete the sixty-nine. Each closes the moment you say you have read it.

| Age | Row | What it is |
| ---: | --- | --- |
| 7 days | `NS18` | Confirm the BC-23 answer: the Sources tab counts 2 because it is only GIVEN 2 — neither capped nor filtered |
| 6 days | `NH208` | Acknowledge the correction: nothing is wrong with your ruleset and no setting needs changing |
| 6 days | `NH212` | Confirm the NH206 serving-edge guard change: it asserted a number the architecture guarantees is non-zero |
| age unknown | `NH08` | Confirm that Newbury's Selectboard reads right now that it shows meetings from two sources at once |

**65 + 4 = 69**, and `docs/tracker-owner-view.md` states both halves and renders
both lists.

---

## Regeneration and gates, at the head this page was written from

This section is about **this lane's branch** (`sc-final/l2-closeout`), not the
integrated head. The integrated head gets its own run, and that is the one the
close-out stands on.

- **`pnpm regen`** — `CURRENT 37 · STALE 0 · UNRECORDED 0 · UNRESOLVABLE 0
  of 37`, *"every registered artifact is current against its generator."* Every
  generated artifact was regenerated with its own generator and the digests
  recorded with `pnpm regen --write`; `pnpm regen` alone only reports.
- **`pnpm gates`** — **14 of 14 green**, and **the run's own record is the
  answer, not this sentence.** `data/ops/gate-runs/2026-09-01-09.json`, tested
  SHA `35afd378`, no gate other than PASS, `suiteDenominator` `4561 tests / 4561
  pass / 0 fail / 0 skipped`, and `suiteLaneEnv` recording
  `WTP_CONTROL_PLANE_DATABASE_URL: present false` — so the Postgres lane's seven
  tests were not eligible in that shell, and the record says so instead of
  leaving a later reader to wonder. Read the newest record, whatever it is:

  ```
  node -e 'const fs=require("fs"),d="data/ops/gate-runs";
  const f=fs.readdirSync(d).filter(n=>/^\d{4}-\d\d-\d\d-\d+\.json$/.test(n)).sort().pop();
  const r=JSON.parse(fs.readFileSync(d+"/"+f,"utf8"));
  console.log(f, r.testedSha);
  console.log(r.gates.filter(g=>g.status!=="PASS").map(g=>g.id+" "+g.status).join(", ") || "all PASS");
  console.log(JSON.stringify(r.suiteDenominator));'
  ```

- **`pnpm handoff --check`** — writes nothing: each generator runs with its own
  `--check`, which reports staleness rather than repairing it.
- **`docs/context.md`** is a known hazard — a `pnpm test` run can overwrite it
  with a placeholder stamped *at test*. It was checked after every run here and
  **was not modified**; the committed copy still carries the real git facts
  written by `pnpm handoff`. Checked, not assumed: `git status --short docs/context.md`.

**One thing a gate run caught, recorded because it is the mechanism working.**
`scripts/repo-map.mts` imports `GATES` from `scripts/gates.mjs`, so **editing
the gate runner puts `docs/repo-inventory.md` out of date** — the digest register
tracks a generator's whole import closure, not the artifact's own bytes. The
inventory was regenerated but its digest had not yet been re-recorded, and the
suite failed on *"RULING 102: no generator has moved since its artifact was last
regenerated"*. That is the gate doing exactly its job: a regenerated artifact
whose digest is unrecorded is indistinguishable from one that was never
regenerated at all. The sequence that satisfies it is `pnpm repo-map`, then
`pnpm regen --write`, then the gates.

---

## How to disbelieve all of this

Run `pnpm walk:all` against production. It is the standing regression net; every
check carries the session that shipped it, and the suite only ever grows. A
check that cannot run says so by name and is never counted as passing.

For the tracker, run `pnpm tracker:views` — every count in the section above is
printed by it, derived from the stores, and cannot disagree with them.
