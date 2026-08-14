# Tester pass — 2026-08-16

The final gate of the correctness session: the product walked as the first
outside tester will, at phone width (390×844), zip entered cold, every
rendered surface read. Four zips: 03255 (Newbury NH), 07866 (Rockaway NJ),
85701 (Tucson), 85641 (Vail). Criteria per surface: 15-year-old test, every
link real (fetched), every number honest, every control does what it looks
like it does. Screenshots in `screenshots/tester-*.png` and
`screenshots/shading-*.png`; drivers in `scripts/tester-drive.mts`,
`scripts/shading-check.mts`, `scripts/meeting-card-check.mts`.

This log is the release evidence the final session builds its punch list
from. Fixed-during-pass items are marked FIXED; anything left is OPEN.

## The map, per zip

| Surface | 03255 | 07866 | 85701 | 85641 |
|---|---|---|---|---|
| Zip entry cold → map lands | PASS | PASS | PASS | PASS |
| Narrowing modal (3b): centered, blurred ground, approved wording, computed counts, two equal buttons, no X | PASS (3 municipalities, 1 school district) | PASS | PASS | PASS |
| Decline is one tap, recorded, not re-asked | PASS | PASS | PASS | PASS |
| Who-governs card: honest coverage lead | PASS | PASS ("3 of the 4 bodies… being added") | PASS ("4 bodies… we watch all") | PASS (no-mayor stated as fact) |
| Mayor at the Kelly standard in who-governs (3e) | n/a (no mayor) | n/a | PASS — "Mayor · Regina Romero · source", opens her card | n/a (stated: no mayor) |
| U.S. Senators label on its own line (3h) | PASS | PASS | PASS | PASS |
| Seats show named reps with sources | PASS | PASS (NJ-11 shows Mejia — the special-election winner, roster current) | PASS | PASS |
| Meeting list rows what-first, said once (3a) | PASS | PASS | PASS | PASS — FIXED during pass: rows read "Governing Board Meeting · Governing Board Meeting…"; list now uses the shared headline |
| District shading: click shades, click again unshades (3f) | — | — | PASS — FIXED during pass, see below | — |
| Legend never covers a card (3h) | code-verified (legend z 1100 < popup layer 1200) | ″ | ″ | ″ |

### The 3f diagnosis, measured

With the overlay on, a click at downtown Tucson opens the picker (3 rows),
choosing Pima County shades it (the whole-viewport fill is visible in
`shading-1-selected.png`) and opens the district card — selection itself was
never broken. What reproduced: a click is almost never a single hit, so the
6d same-gesture deselect (which lived only on the single-hit path) never
engaged — the second click reopened the picker and re-selecting was the only
option. There was no gesture that unshaded. FIXED: the picker now marks the
already-selected district (✓, "tap to unselect") and choosing it deselects —
verified by screenshot pair (`shading-2-after-second-click.png`: tint gone,
card closed, boundaries intact).

One non-defect recorded: driving the overlay from storage requires
`wtp.show_districts` = `"1"` (not `"true"`) — a test-harness lesson, not a
product bug.

## The ballot, per zip (server-rendered — verified from the served HTML plus phone screenshots)

| Check | 03255 | 07866 | 85701 | 85641 |
|---|---|---|---|---|
| Registration checker prominent (2c), state's own tool | PASS ("Look up your voter registration", sos.nh.gov app) | PASS (voter.svrs.nj.gov) | PASS (my.arizona.vote) | PASS |
| Dates strip, mm/dd/yyyy (3h) | PASS (03/10, 09/08, 11/03) | PASS | PASS | PASS |
| The November slate complete (item 1) | PASS — 12 contests including Executive Councilor D2 and County Commissioner D2 with filed candidates | PASS (6 contests) | PASS (lineup) | PASS (lineup) |
| Candidate links, labeled, official first (2b) | PASS (20 campaign / 8 official link renders) | PASS | PASS (34/22) | PASS (38/22) |
| "Would you vote for them?" on every candidate (3d) | PASS (47 controls) | PASS (15) | PASS | PASS |
| One-time disclosure notice on first-ever tap (3c) | — | — | — | PASS — notice renders, OK records, never re-shown (`tester-85641-ballot-notice.png`) |
| Nomination-papers honesty note (NH) | PASS | n/a | n/a | n/a |
| Nothing speaks database | PASS | PASS | PASS | PASS |

## Links fetched this session

Every candidate link shipped was fetched and read (40 links,
`data/ballot/candidate-links-2026.json` carries the verification sentence per
link; misses recorded as MISS or NOT_ATTEMPTED). All three registration
checkers verified — two directly, AZ via the SOS's own page linking it. The
NH ballot's new provenance PDFs (EC districts, commissioner districts, house
districts, cumulative filing) fetched and read this session. 577 official
member pages verified by the audit (`docs/officials-audit.md`); gc.nh.gov's
84 remain inline-unverifiable (TLS wall, ladder rung).

## Open items for the final session's punch list

- The vote-record popup's plain-language bill summaries and the larger
  portraits shipped this session were not walked in a live popup at phone
  width — the code paths are tested and built, but no screenshot exists.
  Walk the rep popup once.
- The pin-tap meeting card at phone width resisted the headless driver
  (marker locator flaky); the card's header code is shared with the list and
  panel (both verified). Tap one pin by hand.
- 07866's first-view framing starts north of Rockaway on a phone; the author
  should confirm the deliberate zoom (6f) still reads right at 390×844.
- NH candidate hunts recorded NOT_ATTEMPTED (10 fringe US Senate, 4 US House,
  county offices) — work items, not absences.
- The concluded/canceled backward window (3g) renders what the snapshot
  holds; sources that publish little past will show little — per-adapter
  backward fetch windows are a recorded follow-up.
