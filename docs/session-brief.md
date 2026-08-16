# Session brief — 2026-08-16, second of the day

**Post-e: the cards take their final face, the brown dies, and the federal
directory problem gets solved in one fetch.**

Committed for the record. The narrative is `docs/state.md` §32; the row
pointers are below. Branch `claude/final-face-0816`.

Two reference screenshots arrived attached to the prompt as STRUCTURAL
references — geometry, hierarchy, fill-vs-outline — with the tokens as law for
everything visual. **They could not be saved to `screenshots/`**: an attached
image in a prompt is visible to the session but its bytes are not reachable
by any tool here, so `ref-header-ciscomani.png` and `ref-contact-pills.png`
do not exist on disk. What was built from them is written out in DESIGN.md
instead — the skeleton is described in words, including the one thing
deliberately not adopted (the party-coloured ring).

## Session-open triage

`docs/defects.md` read first. **No untriaged entries** — every entry already
carried its row pointer, including the 2026-08-16 hotfix block.

## What the brief asked, and what it got

| # | Item | Row | Outcome |
|---|---|---|---|
| 1 | The false Sources sentence | **M100** | Done |
| 2 | The mini cards rebuilt whole | **M101** | Done |
| 3 | The identity header | **M102** | Done |
| 4 | Voting Record + the chevrons | **M103** | Done |
| 5 | Yes/no as pills | **M104**, **M105** | Done |
| 5b | Pictures first | **M107** | Done |
| 6 | The brown dies; counters; who-governs | **M102**, **M108**, **M109** | Done (one named remainder) |
| 7 | congress-legislators | **D63** | Done |
| 8 | The full contact pill row | **M106** | Done |
| 9 | The dotgov registry | — | **NOT BUILT** |
| 10 | Four source-ladder entries | **R26** | Done |
| 11 | M91 / M92 / M94 / M95 | — | Partial — see below |
| 12 | The render-default rule | **M111** | Done |
| 13 | The Lombardo photo-badge ruling | **D60** | Skipped — the ruling did not arrive |
| 14 | Final pass and handoff | — | Done |

## What was NOT built, and why

Stated plainly rather than left to be discovered.

- **Item 9, the dotgov registry (cisagov/dotgov-data)** — not fetched. The
  brief's cut order names item 9's *wiring* as the second cut and says the
  snapshot itself should still land; it did not. Nothing half-built, no
  partial adapter, no tracker row claiming otherwise. It is the first thing
  the next session should pick up.
- **M91, the state-focus map** — deferred, the brief's own sanctioned first
  cut. The e-session design capture stands unchanged.
- **M92** — the PEOPLE-row half shipped inside M109 (name opens the
  battlecard, "Their site →" goes out). The bodies/districts half and the
  AZ-6 linking defect are not done.
- **M94** — the ask-box half shipped (**M110**). **The proposition
  not-yet-published blurb was searched for and NOT FOUND** as a repeated
  string on the ballot page; the only near match is the per-measure
  `extractionNote`, which is correctly per-measure. Recorded as a question
  rather than claimed as absent: **which surface was it on?**
- **M95, sourced term ends for the three governors** — not built. It needs
  each state's own election authority or constitution read and verified, and
  a term end guessed from an election cycle is exactly the fabrication the
  provenance discipline refuses. The three still render no "In seat until",
  which is the honest state.
- **A MEASURE/PROVISION reaction target type** — not added. Item 5's third
  bullet was delivered as styling (the measure prompt takes the person
  prompt's frame and weight, **M105**); creating a new reaction target
  changes how reactions are bucketed and collected, which is on CLAUDE.md's
  ask-before list, and nobody was available.

## The one named remainder inside a Done item

`--tier-fill-local` in the **light** theme is still a deep amber on the
selected Local tier toggle. The interactive accent moved off amber entirely;
the tier accents did not, because they are tuned to sit between the basemap's
roads and the meeting markers and moving one means retuning the legend
against the basemap. The brief permits moving Local provided the legend moves
with it — that is the author's eye's call, not a side effect of a link
colour.

## Probe rows

**None.** Nothing was written against production this session. The walk drove
`localhost:3000`; production verification was GETs only. No reaction tapped,
no log event fired.

## Playbook diff

**Two entries added** to `docs/zip-playbook.md`:

1. **The federal rung is solved once, nationally.** A new state's depth run
   starts with the federal tier already done — roster, contact, district
   offices, committees, official accounts, all bioguide-joined from one
   SHA-pinned snapshot. What it does NOT solve is stated too: no votes, no
   money, no statements, and no state or local scope at all.
2. **The two-column trap**, with the measurement that detects it
   (`lab.scrollWidth > lab.clientWidth`). A row that puts a nowrap label
   beside a value in a fixed-width card will always eventually starve the
   value, and the failure is silent.

## Needs your hands

1. **Item 9 is untouched.** The dotgov registry snapshot did not land. It is
   the cleanest single piece of work waiting.
2. **M94's other half: which surface showed the repeated proposition
   blurb?** It was searched for and not found; a pointer would close it in
   minutes.
3. **The light-theme Local tier toggle is still amber.** If you want the
   whole gold family gone, say so and the map legend moves with it.
4. **D60, the Lombardo photo badge — pin vs logo — is still open.**
5. **`docs/congress-legislators-diff.md` found 0 disagreements.** Nothing to
   rule on today; the file exists so that the day it finds one, it is already
   the place you look.
6. **`docs/stamp-audit.md`** carries 2 disagreements with git history and 1
   NOT FOUND (this session's own new rule, which resolves once its commit
   exists). Nothing was corrected automatically.
