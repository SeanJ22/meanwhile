# Tester pass — the walk, and what it found

The current walk. Supersedes every earlier pass in this file; the earlier
ones live in git history and in `docs/state.md`.

**2026-08-15 (second session) · party, meetings and faces · all four demo
zips at 390×844, plus a desktop bound check at 1280×800 · 0 failures.**

Run with `pnpm exec tsx scripts/tester-walk-0815b.mts <zip>` against a local
dev server at the shipping commits. Screenshots land in `screenshots/` as
`walk0815b-<zip>-*.png`.

## The score

| Zip | Pass | Skip | Fail |
|---|---|---|---|
| 07866 Rockaway Township, NJ | 14 | 0 | 0 |
| 03255 Newbury, NH | 12 | 3 | 0 |
| 85701 Tucson, AZ | 12 | 3 | 0 |
| 85641 Vail, AZ | 12 | 4 | 0 |

**SKIP is a third verdict this walk added, and it earns its place.** A check
that does not apply at a zip — asking Tucson about a New Jersey archive,
asking the Arizona ballot whether an Arizona pick is foreign — used to
report FAIL, and a walk that cries wolf teaches its reader to scroll past
real failures. Every skip below states why it does not apply.

## What the walk held

| # | Check | How, and what it showed |
|---|---|---|
| 1 | **M62** A local partisan official renders a party | 07866: the who-governs card's LOCAL section shows "Mayor · Joseph Jackson · Republican" with its SOURCE link. 85701: a Democratic local row, same shape. 8 party rows on each card across all three tiers. |
| 2 | **M62** A nonpartisan body renders nothing, and it is a stated fact | 03255 and 85641 SKIP: the local officials on those cards are a Selectboard and school boards, all recorded NONPARTISAN with the record that settled it. No party is the right answer, and the roster says so rather than the code assuming it. |
| 3 | **M59** The archive is served | 07866: 4 of 25 meetings served carry `startPrecision: DAY` — Rockaway Township council sittings on 05/26, 06/09, 07/14 (concluded) and 08/18 (scheduled). |
| 4 | **M59** A day-only meeting's card is reachable, and honest | Concluded chip → the meetings door → a council row. The card reads "Tue 05/26/2026 · Time not posted — check the agenda · Concluded 82 days ago", with READ THE AGENDA beneath it. No clock anywhere on it. |
| 5 | **M59** No day-only meeting renders midnight | The whole rendered page, all four zips: no "12:00 AM". The ordering midnight in `startsAt` never reaches a reader. |
| 6 | **M74** A pick from another ballot names its jurisdiction | 07866 and 03255 with an Arizona pick stored: "Governor: Katie Hobbs · Pima County, Arizona". 85701/85641 SKIP — there the Arizona ballot IS the ballot on screen, and the correct answer is no label. |
| 7 | **M74** No internal key reaches the reader | `az-pima` and `ocd-division` appear nowhere in the rendered ballot text at any zip. |
| 8 | **M72** The who-governs card stays inside the viewport | All four zips at 390×844 and at 1280×800: the bottom stack's top sits at 76px, the control band, never above it. Measured, not eyeballed. |
| 9 | **M73** Nothing sits under the map legend | All four zips: zero elements in the bottom stack painted over by the legend, checked with `elementFromPoint` after excluding rows clipped by their own scroll container. |
| 10 | **D50** A candidate we found nothing for says so | Every zip's ballot renders the standard line, "We haven't found much about this candidate yet." — the absence named as our research, never as a blank that reads as absence of the person. |
| — | No mojibake in any rendered text | Four zips, map and ballot. |
| — | No console errors | Four zips, whole walk. |

## Three things the walk found in ITSELF

Recorded because a walk is only worth its failures, and all three of these
were the walk lying rather than the product breaking. Each cost a run.

1. **It wrote to the wrong storage key.** `wtp.location` is not what
   `useStoredZip` reads — the key is `wtp.approximate_location` and the
   payload is `{zip, savedAt}`. The walk was measuring the welcome overlay
   and reporting "0 officials carry a party" as a product defect.
2. **It counted clipped rows as covered.** The who-governs body scrolls
   inside itself, so rows below its fold sit at coordinates the legend also
   occupies while being painted nowhere. `elementFromPoint` dutifully
   returned the legend. Fixed by skipping anything outside its own scroll
   container before asking what is on top.
3. **It matched the word "mayor" in a sentence saying there isn't one.**
   "Newbury isn't a city — it has no mayor" satisfied a loose
   `/Mayor|Council|.../ ` test for "is there a partisan local body here",
   and the zip then failed for not showing a party for the mayor it had
   just said did not exist. Tightened to an office title at the start of a
   line.

There is also a fourth, and it is about the product rather than the walk:
`tsx` compiles a `const fn = () => {}` inside `page.evaluate` into a call
to esbuild's `__name` helper, which does not exist in the browser and
throws. Any future walk must keep inner functions out of `evaluate`.

## What the walk saw and did not fix

The meeting panel's bottom edge sits under the legend chips at 390×844 —
visible in `screenshots/walk0815b-07866-concluded.png`, where the legend row
crosses the second "Rockaway Township, NJ — Township Council" heading. This
is a DIFFERENT surface from the one the author reported (that was the
sidebar footer, M73, fixed and verified above), it predates this session,
and it was recorded as **M75** rather than fixed late in a session with no
time left to re-walk four zips behind the change.
