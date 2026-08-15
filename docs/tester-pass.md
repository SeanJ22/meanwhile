# Tester pass — the walk, and what it found

The current walk. Supersedes every earlier pass in this file; the earlier
ones live in git history and in `docs/state.md`.

**2026-08-15 · the design-pass walk · 85701 at desktop (1440×900) AND
390×844 · all seven checks green at both widths.**

This walk verified the DESIGN PASS (the session dedicated to the author's
bar: "Clean. Like Apple level clean") — it checks the redesigned surfaces
against the session brief, walked as a stranger. Every check ran against a
local dev server at the exact commits that shipped; screenshots land in
`screenshots/` as `before-*` / `after-*` pairs plus `check*-*` working
shots. The author judges by eye: the pairs to compare are
`before-whogoverns-desktop` → `after-whogoverns-desktop`,
`before-ballot-desktop` → `after-ballot-desktop`, and the phone variants.

## What the walk held

| # | Check | How, and what it showed |
|---|---|---|
| 1 | The ask box is a flagship | Asked "who fixes potholes" at both widths. The beat renders "I got you... hang tight..." (exact words, ~3s, cycling dots) in the voice register; the answer renders under a signal eyebrow with the contact card — 311 as a large amber tel link, source line attached. |
| 2 | The ballot end to end | Top (CTA header with shelf rule, mono date, amber links), contest cards (title + right-aligned meta, office blurb in voice, 64px photos, semibold names), pick/reaction prompts at prominence, measures, footnote foot — desktop and phone. |
| 3 | Tier hierarchy on who-governs | LOCAL / STATE / FEDERAL render as confident structural shelves (11px mono 700 + hairline rule in the tier accent), no longer smaller than the names they organize. Both widths. |
| 4 | One footnoted surface | The AZ ballot: every canvass-sourced contest carries `*` at its title; the citation renders ONCE at the page foot ("Nominees per the certified primary canvass (Arizona Secretary of State) · read 08/13/2026"). |
| 5 | Free panning, chip never a popup | Real mouse drag on the map; the view settled on a new area, NO modal appeared, and the narrowing affordance stayed a quiet chip in the card ("Narrow to this area?"). The pre-pass modal is in `before-narrowing-modal-desktop.png` for contrast. |
| 6 | Street input visibly does something | Chip → "STONE" → "N STONE AVE": the boundary overlay turned itself on with municipal + school layers, Tucson and Tucson Unified shaded, DISTRICTS counter refreshed to the drawn count (29), who-governs narrowed with the undo line. |
| 7 | Clear-picks dialog | A pick made, "Clear my picks" tapped: a real dialog (blurred backdrop, same question, Clear in danger treatment, Keep focused) at desktop and 390×844. |
| — | Pill contrast at phone size | Funding pills ("a leadership PAC" slate, "a PAC connected to a membership organization" cyan) read clearly at 390px; light-on-tint pairs hold. |
| — | No console errors on any surface | The shoot harness reports page errors per shot; none appeared across all walk shots. |

## Honest bounds

- The walk ran at 85701 (the ballot + funding + footnotes + streets surface
  all exist there). The redesign is token-driven and product-wide, but only
  85701 was walked end to end this session — the standing four-zip walk
  (`scripts/tester-walk-0815.mts`) still describes the truth-and-faces
  checks, and its 60/60 result from earlier on 2026-08-15 predates this
  restyle. A future session re-running it should expect COSMETIC
  differences only.
- Reactions were NOT tapped in this walk — no reaction-store row was
  written. But the walk's dev server carries the production
  `DATABASE_URL`, so its log writes ARE production rows (probe-rows rule):
  **six `QUESTION_ASKED` events** — "a pothole on my street" ×3
  (≈09:55–10:11 local, one from the sidebar instance, two from the card)
  and "who fixes potholes" ×3 (≈10:34–10:36, phone-width beat + answer +
  one retake), all routed (topic id only, no question text stored), all
  against 85701's divisions, proving the redesigned ask box — plus the
  **zip-search rows** of the walk's map-page loads at 85701 (about
  eighteen, ~09:55–10:38 local) and **one settled-view row** from the
  pan test (~10:37). All are plumbing wearing reader clothes; exclude them
  from any aggregate over 2026-08-15 at 85701.
