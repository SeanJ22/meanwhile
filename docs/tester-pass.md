# Tester pass — the walk, and what it found

The current walk. Supersedes every earlier pass in this file; the earlier
ones live in git history and in `docs/state.md`.

**2026-08-15 · `scripts/tester-walk-0815.mts` · four zips at 390×844 ·
60 of 60 checks green.**

The walk is run as a **stranger**: someone in Tucson who has never been to
Newbury, NH, entering a zip cold and reading only what the screen says. It
is deliberately written to check what the author REPORTED rather than what
the code changed, so a fix that satisfies its own test but not the
complaint fails here.

Every check ran against the committed data on a local build at the exact
commit that shipped. Screenshots per surface land in `screenshots/` as
`walk0815-<zip>-*.png`.

## What the walk holds

| # | Rule | How it is checked |
|---|---|---|
| 1 | M57 — a counter states what its own door renders | all four cards read, each door opened, stated N compared to rendered rows |
| 1 | M57 — a dash means "we could not check", never "you switched this off" | DISTRICTS must not render "—" |
| 2 | M58 — the Concluded filter is answerable | tap the chip, assert the date window opened behind it |
| 2 | M58 — never a silent empty | concluded rows render, OR the honest line names the body and why |
| 3 | M60 — no decoding accidents reach a reader | the mojibake signature searched over the whole rendered text of the map AND the ballot |
| 4 | M61 — party renders wherever it is held | the Governor row must carry a party, in its colour |
| 5 | M63 — the uncontested-race answer | count the candidate controls offering "Someone else" |
| — | no console errors on any surface | |

## Results, 2026-08-15

| Zip | Place | Checks | Counters (Meetings / Bodies / Districts / Officials) |
|---|---|---|---|
| 85701 | Tucson, AZ | 15/15 | 22 / 60 / 26 / 24 |
| 85641 | Vail, AZ | 15/15 | 4 / 2 / 11 / 17 |
| 03255 | Newbury, NH | 15/15 | 1 / 3 / 37 / 22 |
| 07866 | Rockaway, NJ | 15/15 | 12 / 4 / 60 / 31 |

Every counter equalled its door's rendered rows at every zip. Before this
session, 85701 read **6 officials beside a door listing 24** and **13 bodies
beside a door listing 60**; 07866 read 6 officials beside 31.

**Concluded meetings, outside Tucson.** At 03255 the Concluded filter now
renders the Newbury Selectboard's sitting of **Mon 07/20/2026**; at 07866 it
renders **eight** past meetings including the Rockaway Township school
board's, which did not exist in our data before today because the adapter
had never asked its vendor for history. Tapping the chip moves the date
window to "90d back → 60d ahead" — before, it moved nothing and the list
said "nothing matches" at every zip including Tucson.

**Party.** Katie Hobbs · Democratic (blue), Kelly Ayotte · Republican (red),
Mikie Sherrill · Democratic (blue), each rendered in the palette's colour on
the who-governs card, each sourced to an election authority's own filing.

**"Someone else."** One candidate control per ballot offers the fourth
answer at 85701, 03255 and 07866; none at 85641, which has no uncontested
race — the count is derived from the ballot, so that zero is the data
speaking.

**Faces.** Twenty of this session's sixty-nine new portraits were fetched
back from our own origin and looked at on a contact sheet
(`screenshots/walk0815-faces.png`): 20/20 served 200 with real bytes, every
one a clean solo portrait, each labelled with the government host it came
from — gc.nh.gov, govboard.tusd1.org, www.pima.gov.

## What the walk cannot see

Stated so a green run is not read as more than it is:

- It runs against a **local build**, not the deployed site. The production
  check is a separate pass after the deploy, recorded in the session report.
- It reads the DOM. A portrait that serves real bytes can still be the wrong
  person — that is why the contact sheets exist and why every face was
  eyeballed before shipping, not after.
- It walks four zips. Four is the demo set, not the country.
