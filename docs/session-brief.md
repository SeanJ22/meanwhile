# Session brief — the tester's feedback lands: two defects, one insight, and the ballot becomes a call to action

**Executed 2026-08-14 (third session of the day), branch
`claude/tester-feedback-0814`. All items closed or recorded; see
state.md §19, the tracker rows named below, and docs/tester-pass.md.**

Context — the author demoed the product live to the outside tester and
recorded it; this brief is her feedback, triaged. Her core finding:
"For me to stay in this app and answer these questions truthfully and
not just click buttons and give you shitty data, I have to understand
more." Context is signal quality.

Correct first. Fast second. Nothing third.

## 1 — The Rockaway mayor is wearing Tucson's language (GATED) → M46 Done

Diagnosed before fixing: the per-office-TYPE mayor blurb carried
Tucson's charter copy and hyperlink and rendered on every mayor. Fixed
(jurisdiction-neutral generic + per-division override), audited
mechanically (the only contamination), guarded as the uniqueness
invariant's sibling. Gate passed: `walk0814c-07866-mayor-GATE.png`,
spot-verified against the township's own site.

## 2 — Kearsarge missing at 03255 → M47 Done

Diagnosis: default layer selection. All district-type layers now
default ON at every zip; the claims-reachable guard extends the
stated-N family.

## 2b — The governor missing from who-governs → B11 Done

Statewide executives as a first-class attachment (AZ/NJ/NH), Kelly
standard, each verified in a real browser against the state's own site
before ship. Honest coverage language (governor only, said).

## 2c — Three tiers everywhere → M48 Done

Local → State → Federal, closest-first, on every officials surface;
one derivation; membership by structure. "Federal", never "National".

## 2d — The ask box named a wrong body at 85723 → A11 Done

Tie-or-zero refuses: a routed step names only a division's own
governing body (the #governing/#board slot). The PHA never answers for
potholes again; every topic audited at 85723.

## 3 — Party breakdown on every roll call → B12 Done

Real numbers from the roll-call record, sum-gated to the chamber's
tally, no characterization, honest when unavailable.

## 4 — The ballot becomes a call to action → M49 Done

The standing header (election date + add-to-calendar, registration
deadline + link, early voting, "Everyone below is on this ballot");
calendar links consolidated to ONE popup control everywhere; "Make your
voice heard"; the incumbent-record line.

## 5 — The picks card (APPROVED) → M50 Done

Device-local picks drawn client-side to a downloadable image; hard
constraints held in source; Clear-my-picks with confirm; transparency
page extended in the same commit.

## 6 — Copy and truth batch → M51 Done

6a measure-ask weight; 6b the wall-clock dates sweep (246 provenance
fields corrected via git-history mapping, future-date guard); 6c the
five-step tutorial; 6d the moving-here state-picker line (comparison
parked, D47); 6e the 3-second beat with animated dots.

## 7 — Two standing rules → X04 Done + CLAUDE.md

Organizations render as filed, never characterized. Every blurb carries
its source class.

## 8 — Recorded, not built

P12 (people's voice, TABLED), T10 (demo-deletion promise, due at
testing end), D46 (prop sponsors, parked), D47 (state comparison,
parked), V07 (ed-tech, parked), R13 (the playbook clause, standing),
D35 (tester's independent top-issues request noted).

## 9 — Final pass and handoff → this document, tester-pass.md, state.md §19

The walk's own catch became M52: overlays pushed history state, Next
remounted them, and no official's full card could open at phone width —
the prior session's "click dead" mystery, solved and fixed.

Cuts taken: none — every numbered item shipped, including 6c.
