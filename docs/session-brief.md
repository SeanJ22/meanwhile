# Session brief — g3: the regression net, everything broken or lying gets fixed, and the state rises out of the map

Committed for the record. The author's brief is reproduced first, then what
this session did with it. Narrative: `docs/state.md` §34.

---

## The brief, as given

QUEUE POSITION: runs now. g4 (the remaining design pass) is written after this
reports; h (NH finance) is parked behind both. This session runs unattended.
Nobody is available to answer.

- Reversible: cheaper-to-undo, recorded with the rejected alternative, keep
  going. Irreversible: skip, tracker row, continue.
- Browser-heavy steps LAST, strictly sequential, no background agents, commit
  per completed item.
- Live on every push; `pnpm handoff --ship` with the R22 gate; verify every
  deploy LANDS on production. Standing report ending with "Needs your hands."
  Probe rows named. Playbook diff or "nothing new," stated.

Session-open: read `docs/defects.md` and triage. Correct first. Fast second.
Nothing third.

**1 — The regression net: `walk:all` exists and runs FIRST.** Past wins die
silently because each session's walk checks only its own brief. Build
`pnpm walk:all`; RUN IT NOW against production before fixing anything; every
failure is a NAMED REGRESSION ROW with the session that shipped the win. The
standing rule into CLAUDE.md; the suite only grows.

**2 — `/about-area` is down (P1).** 500 on production. Diagnose, fix, verify
at all four zips.

**3 — Kearsarge is dark and the schedulepage fetch is failing NOW (P1).**
Diagnosis lead: the refresh runtime may not have `curl`. Restore to f's counts
or better; state the N against f's N. A failed fetch never silently empties a
previously-full calendar. The neighbouring towns: wire what the ladder
reaches; what it does not lands as named rows per town.

**4 — The WGH footnotes collapse (M94).** Once per body; identical footnotes
across bodies collapse to once per panel with the bodies named inline.

**5 — The sources vocabulary stops slandering official reads.** A fact read
from the body's own official site IS verified. Audit every surface.

**6 — Zooming out never removes pins (P1-adjacent).**

**7 — The ballot page:** your-picks returns; the contest four-way is reframed
as a ballot-building action; names open large battlecards; scale v3 for the
contributions prompt; the funding row's centre-bias separators.

**8 — Governors get in-seat-until and age, sourced (M95).**

**9 — The duplicate contact section dies.** Audit before deleting.

**10 — The state rises out of the map, at every zoom.** The author's reference
is REQUIRED READING. The active state EXTRUDES; inside its border the map is
unchanged; outside is muted AND slightly blurred; zoom-invariant; ambient,
carrying no information; the border-crossing prompt per e's 6b2.

**11 — Final pass and handoff.**

Order: 1 → 11. If short: 8 defers first; then 3's neighbouring-towns half
(Kearsarge itself never cut); then 9. Never cut 1, 2, 3's Kearsarge
restoration, 4, 5, 6, 7, 10, or 11. Documents never cut.

---

## What this session did with it

**Shipped: 1, 2, 3 (Kearsarge), 4, 5, 6, 7, 9, 10, 11.** **Cut in the brief's
own order: 8, then 3's neighbouring-towns half** — the two the brief named
cuttable, in the order it named them, nothing half-built, each with a tracker
row carrying its whole spec and every rung already walked.

`pnpm walk:all` against production: **111 checks, 0 regressions, 0 could not
run.** Its first run, before any fix, returned 20 named regressions and 5
checks that could not run.

Three things the session found that the brief did not ask about, and one place
the brief was wrong:

- **The brief's Kearsarge lead was wrong**, and the log disproves it rather
  than an opinion doing so. `curl` is present on the runner; a missing binary
  rejects with `spawn curl ENOENT` and every failed run recorded `HTTP 403`,
  which is curl's own non-2xx message. The wall is the runner's **egress IP**.
- **Your-picks was never gone from production.** Measured working before it
  was touched. What was true is why it read as gone: the ballot-builder and
  the sold sensor said the same sentence.
- **Four of the first run's twenty regressions were the walk's own aim**, and
  are corrected rather than softened.
- **One conflict is left for the author**, not resolved here: e's 6b2 releases
  the state focus on zoom-out; this brief says twice, as his own test, that
  the effect holds at every zoom and never disappears. The later explicit
  instruction shipped.
