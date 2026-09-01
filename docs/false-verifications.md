# False verifications — what each instrument actually measured

*Opened 2026-08-31 (Part A remainder of WGH-22). Stamps come from `pnpm stamp`.*

A verification that measures the wrong thing is how a false claim about a
government ships. It is worse than no verification, because no verification
leaves a session looking; a false one closes the row, empties the queue and
sends the next session somewhere else.

This file records instruments that **reported green over a live defect**, and
for each one the thing it actually measured. It exists for the third column:
the individual failures are spent, and the SUBSTITUTIONS are reusable — each
one is a shape that will be available to the next instrument somebody writes.

**This is a record, not law.** Current law is `CLAUDE.md` and the delegated
policies. Nothing here amends either.

---

## The substitution table

Read this first. Everything below it is the evidence for one row.

| # | The substitution | In one sentence |
| --- | --- | --- |
| 1 | **A hand-built fixture for the production derivation** | The test agreed with the reasoning that produced it, and neither had met the surface. |
| 2 | **The presence of a citation for the existence of what it cited** | The gate required a non-empty string and never asked whether the string named anything. |
| 3 | **A harness-supplied signal for the publisher** | The harness sent the notification the product was failing to send, then measured everything downstream of it. |
| 4 | **A file's account of itself for the store's behaviour** | A comment saying a subscriber deliberately does not subscribe was accepted as a fact about the store, which had a publisher and two other subscribers. |
| 5 | **The host for the tree** | A gate reported RED about the code when what aborted was a suite starved by seven parallel lanes on one machine. |

Rows 1–3 are the three that certified `WGH-22` fixed while it was live. Row 4
is the class audit that followed them, and it is here for the same reason they
are: it was the instrument that established the DENOMINATOR, and its
denominator carried one misclassified row.

**Row 5 is the counter-example, and it is why this file is not called
"tests that pass too easily."** It reported RED. It is the same defect
regardless, because the defect is never the direction of the verdict — it is
that **the subject of the measurement is not the subject the reader of the
result assumes.** A green that measured the fixture and a red that measured the
host are one failure wearing two colours, and an instrument catalogue that only
collects the green ones will hand the next session a rule it can satisfy by
making things fail.

---

## 1 — The unit test (8/28)

**What it claimed.** That the who-governs panel shows the reader's own
districts after a confirmed address. `WGH-22` was closed on it.

**What it actually measured.** That `panelSeatsFor`, a pure function, returns
the desired rows when handed a `CoverageSummary` whose `divisions` carried
`sldl:17` while its `seats` did not.

**Why that is not the claim.** `summarizeCoverage` in `lib/registry/coverage.ts`
derives `seats` from `divisions` BY FILTERING to the seat types. At the seat
levels the two fields are ONE LIST. The fixture's shape is one the production
derivation cannot emit at any ZIP for any reader — so the fix it certified (add
the reader's missing districts from `coverage.divisions`) could never fire, and
the test could not notice, because the test was the only place that shape
existed.

**Why the gap let the defect survive.** The fixture was authored by the same
pass that authored the fix, from the same belief about the data. A test written
beside a fix encodes the fix's reasoning and cannot disagree with it. What
disagrees with a fix is the production derivation, and the fixture is exactly
the seam where it gets excused from turning up.

**What replaced it.** `tests/panel-seats.test.ts` now asserts the impossibility
DIRECTLY against `summarizeCoverage`, so the fixture cannot be written again.

**Reusable form.** *A fixture is an assertion about the data, and it is the one
assertion in a test that nothing checks.* When a fixture's shape decides the
outcome, derive it, or assert that the real deriver can produce it.

---

## 2 — The sweep row (8/30)

**What it claimed.** `WGH-22` `FIXED_VERIFIED`, closed against check id
`rq:wgh-22-panel-seats`.

**What it actually measured.** That the `checkId` field held a non-empty
string.

**Why that is not the claim.** `rq:` names the ReaderQuestion corpus.
`data/health/reader-questions.json` holds 7 rows, with ids `Q2`, `Q3`, `Q4` and
so on, and **none of them contains `wgh`** — verified against disk on
2026-08-31 by parsing the file rather than by grepping the prose about it. The
corpus is generated from the owner's own workbook and cannot be authored by a
session, so an `rq:` id a session invented could never have resolved. Resolving
every cited check in the record found **15 of 23 naming nothing**: 13 `vac:`
ids against `data/health/visual-checks.json`, which is not on disk, and 2 `rq:`
ids absent from the corpus.

**Why the gap let the defect survive.** A citation is cheap and a resolution is
not, so a gate that checks the field's TYPE will always be satisfied first. The
row then reads as verified in every later summary, and the summary is what the
next session inherits.

**What replaced it.** `resolveCheckId` resolves by namespace and the gate
refuses an unresolvable id; the carried rows are enumerated on `checkDebt` with
reasons and dates, printed every run, and not counted verified fixed.

**Reusable form.** *An id is a promise that something exists. Resolve every
cited id against disk before believing a disposition* — including ids in a
record you did not write.

---

## 3 — The walk block (8/31)

**What it claimed.** That confirming an address moves the panel — measured in a
real browser, on a real build, against the real DOM.

**What it actually measured.** Everything downstream of the notification, with
the notification supplied by the harness. The block wrote the scope into
`sessionStorage` and then executed:

```js
window.dispatchEvent(new StorageEvent('storage', { key: 'wtp.session_address_scope' }));
```

**Why that is not the claim.** A browser fires `storage` in every OTHER tab and
**never in the tab that performed the write.** That one event is the exact
signal `lib/geo/session-address.ts` was failing to send: the store had no
publisher, `hooks/use-resolved-location.ts` owned a listener set nothing
iterated, and the only notification a mounted surface could ever receive was
the cross-tab event a reader's single tab never produces. The walk manufactured
it and then measured the derivation, which was correct — and had been correct
through three passes, which is why three passes fixed nothing.

**Why the gap let the defect survive.** This is the one to keep, because it had
every mark of a real measurement. Real browser, real build, real DOM, real
production. **Fidelity of the harness is not fidelity of the measurement.** A
harness that supplies the missing piece proves everything except the piece.

**What replaced it.** A block in `scripts/walk-all.mts` that clicks the pill a
reader clicks, types into the field a reader types into, presses the button a
reader presses, and then reads the panel — same tab, no reload, no seeded
storage, no dispatched event. The expectation still comes from the product's
own resolver, because an answer key is not a supplied answer.

**Reusable form.** *Name every signal the harness produces, and check that none
of them is the signal under test.* Seeding INPUT is fine; seeding the
NOTIFICATION is the measurement.

---

## 4 — The class audit (8/31), found by the audit that followed it

**What it claimed.** That `WGH-22` was the class's only instance: *ten
browser-storage subscribers, seven notify correctly, `lib/ballot/picks.ts`
notifies through its own event, two — `reaction-control`, `shuffled-facts` —
deliberately do not subscribe and say so, exactly one was broken.*

**What it actually measured.** For eight of the ten, the code. For
`reaction-control`, **the file's own comment about itself.**

**Why that is not the claim.** The comment said taps land in a local `override`
state "so the selection updates without a store notification round-trip," which
is a true statement about the tap path and says nothing about the store. The
store is `wtp.reactions`, and it has a publisher — `REACTIONS_EVENT`, added for
M134 — with two other readers already subscribing to it through
`subscribeReactions`: `components/ballot/pick-control.tsx` and
`components/ballot/my-picks.tsx`. Its PRIMARY reader,
`components/reactions/reaction-control.tsx`, handed `useSyncExternalStore` a
local `emptySubscribe = () => () => {}`, so it could hear neither the same-tab
event nor the cross-tab `storage` event. `components/area/shuffled-facts.tsx`
was correctly classified: its store is a hydration flag that can never change,
reads no browser storage, and an inert subscribe is right there.

So the denominator was nine subscribed stores with one instance found, and it
was nine subscribed stores with two.

**Why the gap let the defect survive.** The orphan-listener-set sweep in
`tests/session-address-publish.test.ts` is a genuinely good guard and it cannot
see this shape — there is no orphaned set to find, because there is no set. A
sweep for the SHAPE of the last defect finds the last defect. The class is
"a mutation the subscriber never hears about", and the set is one of at least
three ways to fail it.

**What replaced it.** `tests/storage-subscriber-audit.test.ts` sweeps for the
other two shapes: an inert subscribe over a store that moves, and a publish
inside its own write's `try`. `scripts/subscriber-audit.mts` prints the
denominator so a later session states a number the tree produced rather than a
number it remembers. `scripts/prove-subscriber-guards.mts` reintroduces each
defect textually and watches the guard go red, because a green new test file is
not a verified fix.

**Reusable form.** *A file's comment is the author's account of the file, not
evidence about the store it reads.* Classify a subscriber by asking whether its
store has a publisher, never by reading what the subscriber says about itself —
and when a guard is written for one shape, say which shapes it cannot see.

---

## 5 — The test gate reporting RED about the host (2026-08-31)

*Measured by the integration owner during this session's parallel run. Evidence:
`data/health/gate-abort-evidence/2026-08-31-test-gate-false-red.md` on branch
`claude/sc2-governance`, with both gate records. Recorded here because it is the
class's counter-example, not because this lane investigated it.*

**What it claimed.** That the test gate failed — a statement about the code in
the tree.

**What it actually measured.** That a suite starved of CPU aborted. Seven
parallel worktree lanes were running installs, builds and test suites on one
Windows host.

**Why that is not the claim.** The readings are irreconcilable as statements
about a tree and trivial as statements about a host. On one tree: `pnpm gates`
gave `test FAIL` in **59s** (gate record 42); `pnpm test` standalone on the same
tree passed **4274 of 4274 in 75s**; `pnpm gates` minutes later gave
`test PASS` in **65s**, 14 of 14 green (record 43). `scripts/gates.mjs` line 174
invokes the literal string `pnpm test`, byte-identical to `package.json` line
294, so the command was not the variable.

**The tell is DURATION, and it inverts the intuition.** The failing run was
FASTER than a complete pass. A suite that fails an assertion runs to the end and
prints `fail N`; an aborted one never reaches the summary at all. So:

- `test FAIL` **with a named failing test** is REAL. Fix it.
- `test FAIL` **with no named failing test and a duration shorter than a full
  pass** is an ABORT. Re-run the gate isolated before believing it. Do not
  record it as a real failure, and do not record it as green either — say which
  reading is being given.

**Why the gap matters.** A false red costs differently from a false green and is
just as corrosive: it sends a session hunting a defect that is not there, and —
worse — it teaches the next session that a red from this gate is negotiable,
which is exactly the belief that lets a REAL red through.

**Reusable form.** *A pass/fail is a claim about a subject. Name the subject.*
When a result is unstable across runs of a byte-identical command on an
unchanged tree, the subject is not the tree, and the next question is what else
changed — here, the machine.

---

## The one rule under all five

Every row above is the same move: **something cheaper stood in for the thing
the claim was about.** A fixture for a derivation, a string for a record, a
harness for a publisher, a comment for a behaviour, a machine for a tree. The
substitution is never announced, because in each case the cheaper thing was a
genuine and correct measurement of SOMETHING — which is exactly what gives the
result its authority.

So the question that catches all five is not *did it pass?* It is:

> **Name the thing the claim is about, and name what was read. If they are not
> the same object, the verification is of the second one.**

And the verdict's colour is not part of the test. Four of the five above were
green; one was red; all five described something other than what their reader
took them to describe.

---

## Instruments this lane added, and what each of them measures

Stated plainly, because a file about instruments that measured the wrong thing
owes its own list the same scrutiny.

| Instrument | What it measures | What it does NOT |
| --- | --- | --- |
| `tests/storage-subscriber-audit.test.ts` | Source text: no inert subscribe over a store that moves; no publish inside its write's own `try`; both with a stated denominator that fails if the sweep collapses. | Whether any component RE-RENDERS. It is a text sweep and says so. |
| `scripts/subscriber-audit.mts` | The denominator — files, call sites, mutators, publishes — read as BYTES over tracked plus untracked files, so a NUL byte or a hidden path cannot hide one. | Correctness. It counts; it does not judge. |
| `scripts/prove-subscriber-guards.mts` | That each guard goes RED when its defect is reintroduced textually, and restores the file afterwards. | Anything about the product. It is a test of the tests. |
| `scripts/probe-reaction-subscribe.mts` | The rendered DOM, two tabs, one browser context: a reader answers in one and the other re-renders, with the browser's own `storage` event and nothing dispatched by the probe. | The beacon transport, and the server half of a reaction — the local build cannot store one, and the probe prints what it saw rather than inferring. |
| The `walk-all.mts` revisit checks | The banner and the list SEPARATELY, and pass only on the list; and on the ballot, the banner's stated hidden count against the sections actually carrying `data-scoped-out`. | Anything on a seeded scope or a dispatched event. Both were removed from these checks on purpose. |
