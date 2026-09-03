# Visual polish — motion, rhythm, states (2026-09-03)

The visual-polish session's close-out. It follows the brief's acceptance table
and the reader-first reporting order (RULING 225).

## What a reader gets

Nothing the product SAYS changed. What changed is how it MOVES and how it holds
together:

- **It moves deliberately, and never urgently.** Every transition and animation
  in the app now runs on one duration scale and one easing family — carets and
  hovers at 120ms, panels and pills at 200ms, the largest moves at 320ms, all on
  the same three decelerate/accelerate/symmetric curves. Nothing bounces.
- **It breathes the same everywhere it is switched off.** A reader who asks their
  operating system for less motion now gets it across the whole app from one
  floor, with every affordance still fully visible — measured: motion collapses
  to ~0 under `prefers-reduced-motion`.
- **Every rounded object reads as one family.** Every pill, chip and circle now
  draws its radius from one five-token family instead of ~20 ad-hoc values —
  value-identical, so nothing shifted, but the system now has one address.
- **A keyboard reader never loses their place**, and the palette is authored in
  full in both themes — both now held by a permanent check, not just convention.

## Acceptance table

| Row | Status | Evidence |
| --- | --- | --- |
| **P1 motion tokens everywhere; reduced-motion; seeded checks** | **MET** | `--dur-*`/`--ease-*` in globals.css; 40 declarations migrated, 0 raw remaining; global reduced-motion floor; `tests/motion-tokens.test.ts`; captures + measured collapse to 1e-05s |
| **P2 spacing/radius/elevation/type scales; sweep counts → checks** | **PARTIAL** | four scales defined as tokens; radius pill/circle family unified (44 sites, value-identical) + exact 6/16px; `tests/rhythm-tokens.test.ts` ratchets — baseline **spacing 248, radius 18, font-size 165, elevation 5**. Consolidation of those onto the scale is author's-eye work (RULING 137), carried. |
| **P3 surface × state matrix; skeletons + focus rings guarded** | **PARTIAL** | focus-visible guard `tests/focus-visible.test.ts` (global ring + no bare suppression); skeleton half: the one route-level loading surface deliberately declines a contest skeleton (RULING 28/137) — respected. Full four-content×four-interaction matrix with captures: carried. |
| **P4 perceived-speed before/after; shell-before-network** | **NOT MET (blocked)** | Ballot nav already a Next `<Link>` (prefetches); shell already renders before tiles/data (seen in captures). The **numbers** (TTFP/TTI/INP) need a hardware-accelerated Chrome; this machine reports HW-accel OFF and returns NaN for frame metrics (RULING 134). Env-blocked. |
| **P5 map feel; H3 re-measured** | **NOT MET (blocked/entangled)** | Basemap tiles unavailable locally ("BASEMAP UNAVAILABLE"), so boundary-fill/hover/marker changes cannot be proven by capture (forbidden to ship unproven). H3 fps re-measure needs HW accel (RULING 134). Also entangled with carried **LAY-12** (do not absorb). |
| **P6 density bounds; captures ×3 widths** | **NOT MET (entangled)** | Section-gap tuning is author's-eye (RULING 137); the ballot column work is the carried **BAL-43** restructure (do not collide). Carried. |
| **P7 both themes; contrast table; seeded check** | **MET** | `pnpm contrast` clears every reading pair ≥7:1 in both themes (all pairs pass); theme-parity guard `tests/theme-parity.test.ts` (a literal colour in one theme only fails). Captures desktop+phone × dark+light render clean. |
| **P8 zero unclassified discoveries; no Codex-owned path edited** | **MET** | discoveries classified below; only `app/`, `docs/DESIGN.md`, `docs/visual-polish-0903.md`, `lib/design/*`, `tests/*` touched — no `data/states`, `docs/states`, move-plan/manifest/generator. |

## What shipped, and the guard behind each

- **WI-1 motion** — `app/globals.css` tokens + reduced-motion floor;
  `lib/design/motion.ts`, `tests/motion-tokens.test.ts`.
- **WI-2 rhythm** — radius/spacing/type token scales; pill/circle family unified;
  `lib/design/rhythm.ts`, `tests/rhythm-tokens.test.ts`, baseline JSON.
- **WI-7 theme** — parity guard; `lib/design/theme-parity.ts`,
  `tests/theme-parity.test.ts`. Contrast already green via `pnpm contrast`.
- **WI-3 focus** — `lib/design/focus.ts`, `tests/focus-visible.test.ts`.
- **DESIGN.md** — the 0903 pass documents all of the above (the design system's
  own rule: a new pattern lands in the spec with the commit that uses it).

Each guard carries a planted instance proving it catches the real shape
(RULING 110). Every guard runs under `pnpm test`, so each is in the CI gate set.

## Carried — named resume points (NOT absorbed)

**From this session (visual-polish remainder):**

1. **WI-2 scale consolidation.** Snap the off-scale literals onto the scale, by
   the author's eye: spacing 248, font-size 165, radius 18 (16px/6px already
   done). The ratchet in `tests/rhythm-tokens.baseline.json` only shrinks;
   regenerate it to record each reduction. Resume: work category by category on
   flagship surfaces first, reviewing rhythm shifts with the author.
2. **WI-3 full surface × state matrix + skeletons.** Audit every reader surface
   for loading/empty/error/populated × hover/focus/active/disabled with a
   capture per changed cell. Skeletons only where they do not assert a shape the
   data may not take (the ballot's deliberate decline stands).
3. **WI-4 perceived speed — measurement.** Needs a hardware-accelerated Chrome
   (RULING 134). Then: TTFP of the shell, TTI of the panel, INP for the top ten
   interactions on the walk host, before/after. Implementation (prefetch,
   shell-first) is largely already present; the owed part is the numbers.
4. **WI-5 map feel.** Boundary-fill soft transition, district hover highlight,
   viewed-venue marker emphasis (interest, not urgency), label collision, zoom
   inertia. Verifiable only with basemap tiles present; H3 re-measure needs HW
   accel. **Do not absorb carried LAY-12.**
5. **WI-6 density.** Max content width per column, gutters, section-gap bounds,
   captured ×3 widths. Ballot column work is **carried BAL-43** — do not collide.

**Carried from 9.2.26 (recorded, NOT absorbed here):** LAY-12 (map panel/card
covers boundary on tablet/phone), BAL-43 (ballot desktop office-block
restructure, entangled with walk-all BAL25), ASK-25 (Ask live output
measurement, needs ANTHROPIC_API_KEY). Resume points are in
`data/feedback/sweeps/9.2.26.json`.

## Merge status — HELD behind a pre-existing, unrelated red

Local gates: **15 of 16 green** at the session head. Both builds (default +
standalone), `test:bundle`, and every design guard this session added pass. The
one failure is `tests/coverage-matrix.test.ts` → *"an ARGUED absence carries its
expiry"*, failing at line 83 (`checked > 0`): **every argued-absence record on
file has expired as of 2026-09-03 America/Phoenix** (RULING 53 — absences
expire and must be re-hunted). This session touched no coverage/kelly/absence/
data path; the failure is identical on clean `origin/main` today (its last green
CI ran at 06:30Z = 2026-09-02 23:30 Phoenix, before the expiry boundary).

So `main` is latently red today for a reason unrelated to this work, and it
blocks **every** merge, not only this PR. This visual work is complete and green
on its own and is **held**, not shipped. It may not be merged onto a red suite
(RULING 77), and the red may not be cleared by weakening a guard this session
does not own or by re-dating an expired absence without re-hunting (that would
falsify a coverage claim — the transparency mandate forbids it).

## Classified discoveries (§25)

- **DISC-PATH** — the brief named `feedback/SWEPT.md` as the gate witness. That
  path is gitignored and can never be on `origin/main`; the real mechanical
  witness of a sweep session's terminal state is
  `data/feedback/sweeps/<date>.json`. Confirmed by the author mid-session. Future
  gates should name the real artifact.
- **DISC-COVERAGE-MATRIX-TIMEBOMB** — `tests/coverage-matrix.test.ts`'s argued-
  absence guard turns `main` red on the calendar day the last argued absence
  expires, with no code change (RULING 53 working as designed: an expired
  absence needs re-hunting). Its resume is a data/coverage task, not visual:
  re-hunt the expired argued-absence subject(s) for the pilot ZIP so a valid
  argued absence is on file again, or the author's ruling on the guard. Until
  then no PR can merge today. NEEDS_SEAN.

## The plain answer

On production this morning: what moves is every state change — panels, pills,
tabs, disclosures, carets — now on one considered scale that never implies
urgency; what breathes the same is reduced motion, honored everywhere from one
floor; and what is measurably tighter is the object family — every rounded
surface on one radius system, the palette proven in both themes, the keyboard
ring proven present. What is measurably FASTER is not yet answered: the frame
numbers need a hardware-accelerated browser this machine does not provide
(RULING 134), so that claim is owed, not made.
