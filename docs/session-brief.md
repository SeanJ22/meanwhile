# Session brief — g2, the correction pass

*The author's production pass, delivered as the brief. Committed for the
record, 2026-08-16. Outcome per item is appended at the end.*

---

Session brief — g2, the correction pass: the sensor proves it counts,
who-governs goes back to clean, and the map learns state lines

On completion, overwrite `docs/session-brief.md`.

QUEUE POSITION: runs before h (NH finance). h drops when this reports clean.

This session runs unattended. Nobody is available to answer.

* Reversible: cheaper-to-undo, recorded with the rejected alternative, keep
  going. Irreversible: skip, tracker row, continue.
* Browser-heavy steps LAST, strictly sequential, no background agents, commit
  per completed item. REAL-PAGE verification with measurements (g's standard)
  on anything visual.
* Live on every push; `pnpm handoff --ship` with the R22 gate; verify every
  deploy LANDS on production. Standing report ending with "Needs your hands."
  Probe rows named. Playbook diff or "nothing new," stated — including g's
  standing entry: REFERENCE IMAGES COMMIT TO `screenshots/` BEFORE a session;
  briefs point at repo paths.

Session-open: read `docs/defects.md` and triage.

Correct first. Fast second. Nothing third. Items 1 and 2 are truth defects
live on production; they lead in that order.

**1 — Reactions blank out when tapped — diagnose whether the sensor is losing
data (P1, leads).** The author, on production: tapping Yes on "Do you like
this vote?" BLANKS the button; tapping Love it on the funding question makes
it DISAPPEAR. The reader cannot tell whether their reaction counted. Diagnose
FIRST, in one of two directions, and say which: (a) the POST lands (204, row
written) and only the confirmation render is broken — a display defect; or
(b) the POST is failing or never firing and the blank is a swallowed error —
a DATA-LOSS defect on the product's core sensor. Check the Neon table's
recent rows against test taps before touching any component. If (b), the
honest-outcome rule (P11's COUNTED/NOT_COUNTED) has been violated on
production and the diagnosis paragraph says for how long, as bounded by
evidence. The fix renders the captured state as the pill g's item 5
specified: green fill for yes, red for no, dark gray for unsure; the
five-point funding scale in its own token shades. A captured reaction NEVER
renders as blank; a failed one renders NOT_COUNTED honestly. Guard: a test
that taps each reaction type and asserts the confirmation pill renders with
the captured value; proven to fail against the broken state.

**2 — M112: the district card denies officeholders we hold (P1).** Diagnosis
already recorded in the tracker: `representationForDivision` reads
point-scoped `coverage.seats`, so any division not containing the reader's
point renders "No sourced officeholder for this division yet" over people we
hold. The fix is RESOLUTION: seats resolve by the clicked division's OCD-ID,
independent of the reader's point. Guard in the M86 pattern, listing the
divisions it fails on. Fallback ONLY if division-keyed resolution cannot be
verified on production by session end; the false sentence does not survive
this session either way.

**3 — Who-governs goes back to what it was, in azure (the author's ruling).**
Revert the LIST to its pre-g cleanliness, keeping ONLY the new colour scheme:
no pills (party as plain text in its party colour), "Their site →" removed
from every row, and the click grammar — a PERSON's name opens their SMALL
battlecard, a BODY row opens its LARGE battlecard, with all external links
inside the cards. Density returns to the pre-g register.

**4 — The small popup slims to name, party, contact (the author's ruling).**
Exactly three things: the name with its circle, the party as the FILLED PILL,
and the contact pills stacked VERTICALLY in one clean column. No role line, no
in-seat line, no chips. The full social row stays large-card-only. More sits
at the bottom, aligned with the column.

**5 — Campaign money asks once per object, and the two sensors are provably
distinct.** The second prompt becomes "How do you feel about these
contributions?" Verify the two prompts write DISTINCT reaction targets; if
they write the SAME target that is a sensor defect and the aggregate honesty
rules apply.

**6 — Voting Record: the accordion's empty half, and the sub-groups indent.**
"When it mattered" appears to render NOTHING when selected. Diagnose — empty
state, broken accordion pane, or data not reaching the view — then fix. Votes
on laws / Votes on people indent clearly as sub-groups.

**7 — One search bar (the author's ruling).** Merge the ask box and the
entity search into ONE input: keyword-first, anything else routing as an ask
through the existing curated path.

**8 — M91 builds now: the state knows its borders.** The active state vivid
and slightly raised, neighbours dim, the border-crossing prompt, and the drag
rubber-band dies.

**9 — The dotgov snapshot lands.** cisagov/dotgov-data `current-full.csv`,
SHA-pinned, thin-guard, weekly D54 slot; the 693-domain election subset as a
named rung list; the domains-not-denominator boundary recorded.

**10 — The amber remnant dies in both themes.** Hunt every remaining
amber/brown token use in BOTH themes; the map legend and tier toggles move in
lockstep. Verify with computed-value measurement, both themes.

**11 — M94 resolves either way: the proposition-blurb hunt.** Walk every
surface at all four zips, both card sizes. Never assert absence without the
walk.

**12 — Final pass and handoff.** Walk at 390×844 and desktop; documents;
overwrite `docs/session-brief.md`; ship; verify the deploy LANDS; standing
report ending with "Needs your hands."

Order: 1 → 12. If short: defer 8 first (its rubber-band kill still ships);
then 11 (named); then 7; then 9's wiring extras. Never cut 1, 2, 3, 4, 5, 6,
10, or 12. Documents never cut.

---

## What this session did with it

**Shipped: 1, 2, 3, 4, 5, 6, 9, 10, 12.** **Cut in the brief's own order: 8,
then 11, then 7** — three of the four the brief named cuttable, nothing
half-built, each with a tracker row carrying its whole spec.

| Item | Row | Outcome |
|---|---|---|
| 1 — the blanking reaction | **M113** | Done. Direction **(a)**: the POST lands, the row was in the store every time. A CASCADE defect, light theme only, 1.012:1. |
| 2 — M112 | **M112** | Done, by RESOLUTION. 24 of 24 non-containing divisions were denying people we hold. |
| 3 — who-governs | **M114** | Done. Reverses half of M109 deliberately. |
| 4 — the small popup | **M115** | Done. Two judgment calls stated in the row. |
| 5 — one ask per object | **M116** | Done. The sensors were already distinct; the QUESTION LABEL was not. |
| 6 — the empty pane | **M117** | Done. Diagnosed against production first: the data was never missing. |
| 7 — one search bar | **M119** | **CUT**, spec kept whole. Both inputs keep working. |
| 8 — M91 state focus | **M91**, **M120** | **CUT** (the brief's own first cut). The rubber-band was NOT REPRODUCED; M120 records what was ruled out. |
| 9 — the dotgov snapshot | **D64** | Done. 16,501 domains, 693 election-typed. Wiring named as the remainder. |
| 10 — the amber remnant | **M118** | Done. Twenty-eight declarations, not one toggle. |
| 11 — M94's hunt | **M94** | **CUT**. Stays In progress; absence is not claimable without the walk. |
| 12 — documents and handoff | — | Done. `state.md` §33. |

The narrative is `docs/state.md` §33. Probe rows: **seven** — five from the local walk and two from the post-deploy
verification against production — all named there with their timestamps,
targets and browser keys.
