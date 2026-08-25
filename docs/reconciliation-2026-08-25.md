# The reconciliation — six DONEs Sean disproved the next morning

**Item 6 of the 2026-08-25 one-session brief. Written BEFORE any of the six was
re-fixed**, because a session that fixes first writes the verdict it wishes were
true.

The question is not *is it broken* — Sean's captures settle that. The question
is **why a session reported it done and was wrong**, because that mechanism will
produce the next six.

---

## What production was actually serving

This is verdict (a)'s evidence and it had to come first, because if the code was
never live then nothing else matters.

Read from Netlify's deploy API, 60 production deploys, 2026-08-25:

| | |
|---|---|
| Sean's walk | `08:47:06`–`09:24:22` Phoenix = **15:47–16:24 UTC** |
| Serving at walk start | **`d43adf7`**, published `2026-08-25T07:46:35Z` |
| Published DURING the walk | **0** |

So production served one SHA, `d43adf7`, for the whole walk. Every claimed fix
was then tested for ancestry against it:

| Claiming commit | Landed | In `d43adf7`? |
|---|---|---|
| `8e83d1d` "Item 7: the ballot page, built to the red marks" (`BAL-9`) | 2026-08-24 20:23 | **YES** |
| `1803be2` "Items 6 and 8: Speak Your Mind, and the New Jersey panel" (`WGH-6`) | 2026-08-24 20:41 | **YES** |
| `3c3821b` "The meeting card stops asserting jurisdiction from a zip" (`JUR-2`) | 2026-08-23 03:42 | **YES** |

**Verdict (a) is REFUTED for every recurrence.** The deploys were not the
problem. Sean was looking at the shipped fix, and the shipped fix did not work.

*This was worth checking rather than assuming, and it also turned up something
adjacent:* four production deploys in the last two days reached the state
`error` and were never published — `3449ef8` (PR #177), `41113c1` (PR #171),
`55d3047` (PR #170), and `e0f6426` this morning. Three are real code merges. Each
was covered by a later successful merge, so nothing was permanently lost, but
between the merge and that later deploy production was serving older code and
**nothing in this repo said so.** That is `NJ25`'s shape still alive, and it is a
row rather than a verdict here because it did not cause any of these six.

---

## The six, one verdict each

### `BC-14` — source links, third pass — verdict **(b) predicate too narrow**

The 8/24 claim was *"4 surfaces, 0 footnote markers"*, and it was **true**. It
was true about the wrong four surfaces.

`tests/source-consolidation.test.ts` operates on `Meeting` provenance through
`sourceCreditFor(meetings)`. `SRC-1`'s implementation note sits in
`components/map/popup/entity-modal.tsx` — *"ONE credit line at the foot of the
tab, no inline markers."*

What Sean red-boxed is neither. It is
**`components/map/popup/district-popup.tsx:256`**, on the REPRESENTATION rows of
the small battlecard:

```
{" · "}
<a href={holder.sourceUrl} className="… source-tag …">src</a>
```

A different data type (an office-holder, not a meeting), a different component,
a different rendered form — and the same class. The predicate was *footnote
markers on meeting provenance*; the class is *per-item source annotation on a
card*. This is the `OFF-2` disease exactly.

### `WGH-8` — the swap — verdict **(d) built to ambiguous prose**

`1803be2` says so in its own words:

> *WGH-6 keeps the left region a column when the RAIL leaves it, **which is what
> takes over that space means**.*

That sentence is a session deciding what an ambiguous phrase meant, and then
building to its decision. What shipped is a popup roughly a third of the
column's height with **both a vertical and a horizontal scrollbar**
(`08:47:35`). Sean's response was *"hate the way it looks."*

**And the right answer was already written down, by the same session, in the row
it opened.** `NH167`, on `LAY-4`:

> *WGH-6 is the real answer — clicking Who Governs Here minimizes the rail and
> **the card takes the whole column**.*

The repo held the correct specification and the code did something else. This is
RULING 137's case in its purest form: prose lost information the image carries,
and an annotated image existed.

### `LAY-4` — pill landed, expansion didn't — verdict **(d)**, and it is the same defect

The floating region beneath the rail is correct: both pills are there in
`08:47:06`. What does not happen is the expansion — and the expansion IS
`WGH-8`. One fix closes both, which is why they are reported together rather
than counted twice.

### `BAL-9` — back to the map — verdict **(c) verification that didn't test the thing**

The diagnosis in `8e83d1d` was right: *"BAL-9 was bounds: `CONUS_BOUNDS` — every
mount opened at the continent."* `lib/map/camera-memory.ts` was built, and
`map-canvas.tsx:470` restores from it correctly.

**It is only ever written after a user gesture.** `map-canvas.tsx:604`, the
code's own comment:

> *A user gesture is the only thing that carries an `originalEvent` on
> movestart — flyTo, jumpTo and fitBounds never do — so this fires for pans and
> pinches and **stays silent through every camera move the app makes itself.***

Entering a zip flies the camera programmatically. That is not a gesture, so
nothing is remembered; `recallCamera()` returns `null`; the map falls back to
`bounds: CONUS_BOUNDS`. **A reader who types a zip and clicks through — which is
the entry path — gets the continent back.** It works only for a reader who
happened to pan or pinch afterwards.

The verification would have had to walk the reader's path to see it. And there
is no committed verification at all: `git grep BAL-9 -- tests/ scripts/` returns
**nothing**. The claim *"done, verified"* rests on no artifact this repo holds.

### `JUR-2` — hedging from a zip, third era — verdict **(b) predicate too narrow**

`lib/meetings/jurisdiction-badge.ts` gained `COULD_GOVERN` on 8/23 and it is
correct. Its gate is not:

```js
if (basis === "ZIP" && partialAtZip !== null && partialAtZip.has(meeting.ocdId)) {
  return "COULD_GOVERN";
}
return divisionsAtPoint.has(meeting.ocdId) ? "GOVERNS" : "NEARBY";
```

Outside the partial set, a **ZIP** basis still returns a flat `GOVERNS` or
`NEARBY`. `NEARBY` renders *"This body meets near you, but it governs a
different area"* — a hard claim about the reader's location, from a centroid.

**The module's own documentation already says this is wrong:**

> *It is not `NEARBY` either — that asserts the body governs a DIFFERENT area,
> which is the same unearned certainty pointed the other way.*

The reasoning was written and then applied to one branch. The sweep swept the
assertion and not its mirror.

### `OFF-3` — Dr. Gabriel Trujillo's portrait — **no verdict: it was never claimed done**

The 8/24 session reported it NOT DONE and opened `NH166` saying so, with the
reason. That is the one correct report in this table and it is not a recurrence
at all — it is an open item that stayed open.

It is listed here because the brief listed it, and because the contrast is the
finding: **the only one of the six that did not come back was the one nobody
claimed.**

---

## What the mechanism actually is

Verdict (a) — the one the brief thought most likely — did not happen once.
Nothing was lost in a deploy. The pattern across the five real recurrences is
narrower and worse:

**Every one of them was verified against the thing the session had just built,
rather than against the thing the reader does.**

- `BC-14` asserted the consolidation it wrote, on the data type it wrote it for.
- `BAL-9` asserted a storage round-trip that only its own test path triggers.
- `JUR-2` asserted the new branch, not the branch beside it.
- `WGH-8` / `LAY-4` asserted an interpretation, against itself.

Each verification passed honestly, and each was a check that the code does what
the code does — **RULING 147's failure, wearing a verification badge instead of
a reconciliation one.**

Two rulings are written from this, and they are in `docs/rulings.md` and
`CLAUDE.md`: **RULING 152** (a reader-facing DONE names the production deploy
serving it) and **RULING 153** (a fix is verified on the reader's path).
