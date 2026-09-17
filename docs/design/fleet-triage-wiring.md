# Wiring: the nine things the fleet page cannot see or do

Every item below was found by reading the repository at
`codex/reader-visual-9-7-26`, not inferred from the screen. Paths were read on **2026-09-15** —
verify each against HEAD before you start.

Each section ends with a **paste-ready brief**. Copy it verbatim into Claude Code; it is written to
stand alone without this document.

**Do these in this order.** §5 and §6a first — they are the cheapest on the list and the only two that
let the owner *act* on anything. Then §1 and §2, which are what make the rest of the page readable at
all. §3, §4 and §7 are an afternoon each. §8 and §9 are presentation, and only worth doing once the
reads underneath them are honest.

**§6b is the exception: it is the only backend item here.** It is listed inside §6 because the field
lives on the same object as ten renderable ones, and it is the single most likely item in this
document to be closed without being done. Read §6b before you estimate §6.

---

## §5 — You cannot answer a decision from this page (do this first)

**Files:** `components/admin/fleet-operations-map.tsx` (the `NeedsYou` block),
`app/(admin)/admin/decisions.tsx`, `app/api/admin/decision/route.ts`

The fleet page says **69 things need you** and offers no control that answers any of them. The titles
render as static text.

This is not missing functionality. A complete decision queue **already exists** at
`app/(admin)/admin/decisions.tsx`, mounted on the control centre, built in response to the owner's
earlier complaint that clicking a decision "looks like I'm clicking on nothing". It already has:

- priority groups and owner-type grouping,
- per-card options rendered **with their consequence text**,
- a free-text "answer in my own words" path, recorded as the literal `ANSWERED_IN_OWN_WORDS`,
- optimistic decide with a `Recording…` → `PENDING_CANONICALIZATION` phase,
- undo by **superseding record** (the log is append-only; nothing is erased),
- `requiresStateVersion`, so the gateway refuses an answer submitted against a queue revision that
  has since moved,
- the three-leg receipt: intent appended → tracker row closed at next sync → implied work opened.

It posts `decision.record` to the one-door admin action gateway, which is already in the registry.

So the fix is a mount, not a build. Either render `DecisionQueue` on `/admin/fleet` scoped to the
fleet-relevant cards, or make each row a link into `/admin/decisions` deep-linked to its `rowId`.
Rendering a read-only shadow of cards that are answerable two routes away is the defect.

**Paste-ready brief:**

> Fleet operations: the 'Needs you' list in components/admin/fleet-operations-map.tsx renders
> decision titles with no way to answer them, while app/(admin)/admin/decisions.tsx already
> implements the full queue — priority groups, per-card options with consequences, optimistic decide,
> undo by superseding record, and the three-leg receipt — posting decision.record to the admin action
> gateway. Mount that existing DecisionQueue component on the fleet page (or link each row to
> /admin/decisions deep-linked to its rowId) instead of rendering a read-only shadow of the same
> cards. Nothing new needs building.

---

## §6 — The projection drops nine of the card's eleven fields

**This section contains two different jobs. Do not close it having done only the first.**

- **§6a is a render.** Every field exists on the object; the page throws it away. An afternoon.
- **§6b is backend work with a schema question in front of it.** Nothing to render, because nothing
  computes the value. Do not attempt it as part of §6a.

### §6a — render the fields that are already there

**Files:** `lib/control-plane/owner-surface.ts` (`OwnerDecisionCard`, line ~1359),
`components/admin/fleet-operations-map.tsx`

`OwnerDecisionCard` publishes eleven fields:

```
rowId · title · whatIsNeeded · whyNoMachineCanDecide · options[]{option, consequence} ·
blockedDescendants · openedOn · ageDays · priority · verifiability · blocker
```

**Note (2026-09-15 session):** three additional optional fields exist on `OwnerDecisionCard` that
this list does not name: `kind?: OwnerDecisionCardKind` (absent on a snapshot published before
9.4.26; a reader treats absent as DECISION), `checkedThisRun?: string | null` (BLOCKED_WHILE only:
what the last tracker generation found when it rechecked), and `lastVerified?: string | null` (the
tracker row's own "Last verified" stamp). All three are backward-compatible and should be rendered
where meaningful — `kind` for grouping, `checkedThisRun` and `lastVerified` as metadata on
BLOCKED_WHILE cards.

`NeedsYou` renders **`rowId` and `title`**. Nine fields are fetched and thrown away, which is why the
page cannot group by priority, sort by age, or show a single option — and why the rework's Decisions
tab has to group by `rowId` prefix, a string convention, instead of by the `priority` field sitting
on the same object.

Ten of the eleven fields can be rendered today (plus the three optional ones above).
`blockedDescendants` cannot — see §6b.

**Paste-ready brief:**

> Fleet operations: OwnerDecisionCard in lib/control-plane/owner-surface.ts publishes rowId, title,
> whatIsNeeded, whyNoMachineCanDecide, options[]{option,consequence}, blockedDescendants, openedOn,
> ageDays, priority, verifiability and blocker. The NeedsYou component in
> components/admin/fleet-operations-map.tsx renders rowId and title only, so the page cannot group by
> priority, sort by age, or show a single option. Render the fields that are already on the object,
> and group by priority rather than by rowId prefix. Do NOT try to make blockedDescendants work as
> part of this change — it is null on every card and has no producer; render the literal 'not
> measured' and file the separate ticket described in §6b of this document.

### §6b — `blockedDescendants` has no producer (separate ticket, backend)

**Field:** `OwnerDecisionCard.blockedDescendants`, typed `number | null`, **null on every card**.

This is the field that would say *"answering this frees N work items"* — the only number that answers
"which of the 69 do I do first". It is the one item in this whole document that is not
read-and-render work, and it is the one most likely to be mis-filed as one, because it is listed on
the same object as ten fields that are.

**Answer this before estimating:** does the tracker record *which decision* a work item is waiting
on? If that link is not stored, the count cannot be derived at all and the link has to be added
first. That is a schema change, not a query.

If the link does exist, the work is: walk the work items, select those whose next action or blocker
names a given decision `rowId`, count them, and populate the field at projection time. Then sort the
queue by it descending, which is the ordering the owner actually wants.

**Until it lands, print the literal `not measured`.** Never `0` — zero asserts that answering the
card unblocks nothing, which is the opposite of unknown, and it is the specific wrong answer that
would make the owner skip the most important decision in the queue.

**Do not close this ticket by rendering the placeholder.** The placeholder is correct and permanent
until a producer exists; shipping it is §6a finishing, not §6b.

**Paste-ready brief:**

> Fleet operations, separate backend ticket: OwnerDecisionCard.blockedDescendants is typed
> number|null and is null on every card because nothing computes it. It is the count of work items
> blocked behind a decision — the field needed to answer 'which of the 69 decisions should I answer
> first'. First determine whether the tracker records which decision a work item is waiting on; if
> that link is not stored, adding it is a schema change and must come first. If it is stored, derive
> the count at projection time (work items whose next action or blocker names the decision rowId) and
> sort the decision queue by it descending. This is NOT a UI task: the admin page already renders the
> honest placeholder 'not measured', and rendering that placeholder does not resolve this ticket.

---

## §1 — Deferral counters cover one lane out of two

**File:** `lib/control-plane/research-progress-health.ts` (the `queue` block, consumed by
`components/admin/research-progress.tsx`)

Observed on the live page, 2026-09-15:

| Reading | Value |
| --- | --- |
| Due this cycle | 2 454 |
| Scheduled | 7 |
| Downstream dispatches | 0 |
| Deferred — execution budget | 0 |
| Deferred — dispatch-count limit | 0 |
| Deferred — model-spend ceiling | 0 |
| Deferred — lane state | 0 |
| **Unaccounted** | **2 447** |

Every deferral counter is named `modelClassDeferredFor…`. `due` sums `modelClassDue +
deterministicDue`. So deterministic non-dispatch has **no deferral accounting at all**, and the four
zeros cannot possibly explain the 2 447 — not because something is broken, but by construction.

The damage is that a row of four zeros reads as *"nothing is holding work back"*, which it cannot
mean. This is the item that makes every other number on the page untrustworthy, which is why the
rework promotes it to a red band.

Either add `deterministicDeferredFor*` counters to `ResearchState.queue`, or scope the sentence to
model-class units so the zeros stop reading as fleet-wide. The first is correct; the second is honest
and takes an hour.

**Paste-ready brief:**

> Fleet operations: the 'Why work waits' row prints four deferral counters
> (modelClassDeferredForBudget, ForCycleMax, ForCeiling, ForLane) in
> lib/control-plane/research-progress-health.ts, but 'due' sums modelClassDue + deterministicDue.
> Deterministic non-dispatch therefore has no deferral accounting and the four zeros cannot explain
> 2447 undispatched units. Either add deterministicDeferredFor* counters to ResearchState.queue, or
> scope the sentence to model-class units so the zeros stop reading as fleet-wide.

---

## §2 — Stage zeros print without their denominator

**Files:** `lib/control-plane/research-progress-health.ts`,
`components/admin/research-progress.tsx`

Six stage counts — `acquired`, `extracted`, `canonicallyLinked`, `verified`, `audited`,
`promotionReady` — all read `0`. They describe **7 registered investigations**. The fleet holds
**2 665** work items.

The scope statement exists and is correct: *"7 registered investigations; 2 658 other work items are
not classified in this report."* It is the **last clause of the sentence**, after the numbers it
invalidates. So six zeros that describe 0.26% of the fleet read as fleet-wide.

**Fix:** render each stage count as `N / scope.obligations`, and move
`excludedUnclassifiedWorkItems` **in front of** the numbers rather than after them. Nobody can
currently say from this page whether the other 2 658 items have stages at all — which is itself worth
answering.

**Paste-ready brief:**

> Fleet operations: researchProgressHealth's advancement string lists six stage counts and then
> states 'Scope: 7 registered investigations; 2658 other work items are not classified in this
> report' as its final clause. The zeros therefore read as fleet-wide when they describe 0.26% of
> 2665 items. Render each stage count as N / scope.obligations, and put
> excludedUnclassifiedWorkItems in front of the numbers rather than after them. File:
> lib/control-plane/research-progress-health.ts, consumed by
> components/admin/research-progress.tsx.

---

## §3 — Two clocks on one page, neither labelled

**File:** `app/(admin)/admin/fleet/page.tsx`

**Correction (2026-09-15 session):** the original text said the fleet page renders
`ResearchProgress` from `state.beatAt`. That is wrong. `beatAt` lives on `LivePulse.runner` and
reaches the **control centre** (`app/(admin)/admin/page.tsx`), not the fleet page. The fleet page
reads `progressState` via `readFleetSafety()` at `fleet/page.tsx:90` and feeds it through
`researchProgressHealth()`. The underlying finding stands — two unlabelled time sources on one page,
34 minutes apart — only the data paths differ.

`page.tsx` renders `ResearchProgress` from `progressState` — read via `readFleetSafety()` and
transformed through `researchProgressHealth()` — and `FleetOperationsMap` from `report.observedAt` —
the time this report was read. On 2026-09-15 those were **20:21:09Z** and **20:55:49Z**: 34 minutes
and 40 seconds apart, presented as one moment, with nothing on the page saying they are different
clocks.

**Fix:** label each timestamp with what it measures, and surface the gap when it exceeds
`HEARTBEAT_LATE_MINUTES` (already exported from `lib/control-plane/owner-surface.ts`).

**Paste-ready brief:**

> Fleet operations: app/(admin)/admin/fleet/page.tsx renders ResearchProgress from progressState
> (read via readFleetSafety(), not from beatAt which belongs to the control centre's LivePulse) and
> FleetOperationsMap from report.observedAt (the read time). On 2026-09-15 those were 20:21:09Z and
> 20:55:49Z — 34 minutes apart — with no label saying they are different clocks. Label each
> timestamp with what it measures, and surface the gap when it exceeds the heartbeat-late threshold.

---

## §4 — The read's age is an ISO string, and nothing re-reads

**File:** `components/admin/fleet-operations-map.tsx`

The page prints `observedAt 2026-09-15T20:55:49.443Z` verbatim. A raw timestamp is not an age.

There is also **no auto re-read on this surface** — correctly, because this is not the heartbeat; but
the sibling control centre refreshes every 45 seconds, which sets an expectation this page silently
breaks. An hour-old read looks identical to a live one.

**Fix:** show the age in human terms ("read 34 minutes ago") beside the Refresh control, and state
plainly that nothing re-reads it.

**Paste-ready brief:**

> Fleet operations: components/admin/fleet-operations-map.tsx prints 'observedAt
> 2026-09-15T20:55:49.443Z' verbatim and there is no auto re-read on this surface (correctly — it is
> not the heartbeat). Show the age in human terms ('read 34 minutes ago') next to the Refresh
> control, and state that nothing re-reads it, so an operator cannot mistake an hour-old read for
> live. The control centre's 45-second cycle sets the expectation this page then breaks.

---

## §7 — The decision store is project-wide; the page is not

**File:** `components/admin/fleet-operations-map.tsx` (`NeedsYou`)

`report.ownerDecisions` holds the **whole project's** decision store. Of the 69 cards on the fleet
page, **43 are not fleet work**: business incorporation, buyer pricing, trademark search, counsel
questions, a podcast pitch, Instagram presence, console design calls, and five defect reports filed as
decisions.

By `rowId` prefix:

| Group | Count | Prefixes |
| --- | --- | --- |
| Fleet — research findings | 21 | `NH*` |
| Fleet — data and sources | 5 | `D*` `ASK*` `NW*` `R*` |
| Commercial and product | 14 | `C01–C04` `V01–V08` `X02` `X03` `PB19` |
| Business, legal and trust | 12 | `B02–B09` `T01–T07` |
| Design and console calls | 12 | `NS01` `NS13–NS27` |
| Defect reports | 5 | `OWN01` `OWN02` `OWN04` `OWN05` `OWN06` |

The exclusion rule is stated **only in the empty state** — the one case where nobody needs it.

Scope the list to cards that reference a work item, or state the rule on the list itself. Note that
the five `OWN*` rows are bugs filed as decisions: they want a fix, not an answer, and arguably do not
belong in a decision queue at all.

**Paste-ready brief:**

> Fleet operations: report.ownerDecisions holds the whole project's decision store, so the fleet
> page's 'Needs you' shows 69 cards of which 43 are business, legal, commercial and design decisions
> (rowId prefixes B, T, C, V, X, PB, NS, OWN) unrelated to fleet work. The control centre shows 74
> from the same family of data. Either scope this list to cards that reference a work item, or state
> the exclusion rule on the list itself — today it appears only in the empty state, which is the one
> case nobody needs it.

---

## §8 — 2 665 rows ship to the browser, sorted by hex id

**Files:** `components/admin/fleet-operations-map.tsx`, `GET /api/admin/fleet/operations`

All 2 665 operations are held client-side and paginated at 50 per page — **54 pages** — in the order
the endpoint returns them: ascending `workItemId`, a hexadecimal identifier, and therefore an
arbitrary order for a human.

Consequences visible on the live page:

- The **single failing item** is findable only by clicking the lane filter. Its `tasks[].blocker`
  string — the one field a failing row exists to show — is visible only after expanding that row.
- `lastActivity.at` is on every item and is **never sorted on**, so the oldest owed row sits four
  places from the top by coincidence.
- 50 `recovering` rows (expired leases, re-admitted by the sweep, nothing owed from the operator)
  outnumber the one row that needs attention 50:1 in the same undifferentiated list.

**Fix:** server-side sort and filter — default `lastActivity.at` ascending (oldest owed first), a
subject-substring search, and a record-class facet derived from the subject prefix. The record class
and the state are already inside the subject string the page holds; nothing groups on them.

**Paste-ready brief:**

> Fleet operations: components/admin/fleet-operations-map.tsx holds all 2665 operations client-side
> and paginates at 50 per page (54 pages), in the order the endpoint returns them — ascending
> workItemId, which is a hexadecimal identifier and so an arbitrary order for a human. Add
> server-side sort and filter: default sort on lastActivity.at ascending (oldest owed first), a
> subject-substring search, and a record-class facet derived from the subject prefix. The single
> failing item is currently findable only by clicking the lane filter.

---

## §9 — Empty panels sit at the weight of measured ones

**Files:** `lib/admin/fleet-map-meta.ts`, `components/admin/fleet-operations-map.tsx`

`FLEET_MAP_PANELS` renders all six panels into one auto-fill grid. Three of them have **no
producer** — served publication, throughput over time, reader demand — and differ from the wired ones
only by a badge.

The honest empty statements are already written and are good (`UNKNOWN` as a literal, the reason
naming per-record promotion and served-reader proof as unjoined). They are just filed next to
answers, so the page's honesty is legible only on inspection.

This one is presentation only, no data work: split the grid into a **"reads something"** group and a
**"no producer"** group with a dashed rim.

**Paste-ready brief:**

> Fleet operations: FLEET_MAP_PANELS renders all six panels into one auto-fill grid, so the three
> NO_PRODUCER panels (served publication, throughput, reader demand) carry the same card weight as
> the wired ones and differ only by a badge. Split the grid into a 'reads something' group and a 'no
> producer' group with a dashed rim, so the page's honesty is legible at a glance. Files:
> lib/admin/fleet-map-meta.ts, components/admin/fleet-operations-map.tsx.

---

## Correction to the control centre handoff

`design_handoff_control_centre/WIRING.md` §6 lists **eleven** gateway actions and names
`decision.record` among them. That is accurate. What the fleet-page review adds: `decision.record` is
not only registered, it is **fully consumed** by a working UI at `app/(admin)/admin/decisions.tsx`,
with undo, state-version refusal, and a three-leg receipt.

Any future "the owner can't resolve X from the console" finding should check that file first. The
pattern to copy — optimistic write, superseding undo, refuse on stale revision, and say in words what
has and has not happened yet — is already established there, and should not be re-invented per
surface.
