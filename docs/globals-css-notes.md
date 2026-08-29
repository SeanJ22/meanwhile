# The reasoning behind `app/globals.css`

**Split out of the stylesheet on 2026-08-25, `NH180`, by Sean's ruling.**

`app/globals.css` stood at **206,120 bytes and 56.7% comment prose**, and it had
hit the Drive code mirror's per-file cap **twice** — once on 2026-08-17, when the
cap went from 120 KB to 200 KB, and again on 2026-08-25, when it went from 200 KB
to 256 KB. **RULING 106 forbids a third raise**: raising a limit treats a symptom,
and by the third time the limit is the problem. His ruling was to strip the prose
into its own file and put the cap back where it was.

**Nothing here was deleted and nothing was rewritten.** Every block below is the
comment exactly as it stood in the stylesheet, in file order. Where a reader of
the CSS needs to know a rule has reasoning behind it, a one-line pointer stays at
the rule naming the section here — so the trail from a declaration to the
decision behind it is unbroken, which is the whole reason the prose was in the
stylesheet in the first place.

**This is a companion, not a summary.** If a rule changes, its note changes here.
A note that no longer describes the CSS is drift, and drift in a file this size
is exactly what RULING 106 says to fix at the source rather than by clipping.

---

## Design tokens, ported from EdiaStratMap's src/styles/main.css

<a id="design-tokens-ported-from-ediastratmap-s-src-styles-main-css-1"></a>

```
/*
  Design tokens, ported from EdiaStratMap's `src/styles/main.css`.

  Two themes, one token set. Dark is the default; `[data-theme="light"]` on
  <html> swaps the values and nothing downstream needs to know. Every colour a
  component uses comes from here — a literal hex in a component is a bug, because
  it will be wrong in one of the two themes.

  Edia drives its whole UI from three accents (--accent-strat / -cust / -both).
  Ours are the three tiers of government, which is the axis this product filters
  on. See lib/ocd/tiers.ts for the OCD-segment mapping: a tier is decided by
  OCD-ID depth, never by string-matching a label.
*/
```

---

## The FILLED form of a tier accent (item 5, 2026-08-15) — the selected tier

<a id="the-filled-form-of-a-tier-accent-item-5-2026-08-15-the-selected-tier-2"></a>

```
/* The FILLED form of a tier accent (item 5, 2026-08-15) — the selected tier
     toggle, and nothing else yet.

     Why a second set rather than filling with the accents above: a tier accent
     is tuned to sit on the BASEMAP, between the roads and the markers, which
     puts it at mid luminance. Mid luminance is exactly the worst place to be
     when text has to sit ON it — light `--accent-local` (#b8860b) takes
     `--bg` at 2.8:1 and white at 3.0:1, so a filled button in it is
     unreadable EITHER way. In dark the accents themselves are bright enough
     to fill with (`--bg` on them clears 5.8–10.3:1); in light they are
     replaced by deeper versions of the same hues, carrying near-white text.

     The map's colours are untouched: change a tier's accent and its fill has
     to move with it, which is why they sit together here. */
```

---

## Meeting status. Concluded is cool and quiet — present, clearly not

<a id="meeting-status-concluded-is-cool-and-quiet-present-clearly-not-3"></a>

```
/* Meeting status. Concluded is cool and quiet — present, clearly not
     something you can still attend. Canceled shares the danger hue.

     Online (D18) is a THIRD fact of the same kind and takes the same
     treatment: a filled pill, because it is a present value and not a named
     gap — we know exactly where this meeting is, and "nowhere you can drive
     to" is knowledge, not absence. Its own hue rather than a shared one,
     for the reason Canceled has its own: "it is over", "it was called off"
     and "it is held online" are three different things to know before
     leaving the house, and one shade for any two of them flattens them.
     Violet is the only unused hue in the palette above — no tier, no
     accent and no other status claims it, so the pill cannot be mistaken
     for a tier marker. */
```

---

## Boundary strokes. docs/state.md §4.1: the basemap draws its roads as one

<a id="boundary-strokes-docs-state-md-4-1-the-basemap-draws-its-roads-as-one-4"></a>

```
/*
    Boundary strokes. docs/state.md §4.1: the basemap draws its roads as one
    flat #454545 (luminance 0.059) and meeting markers are --accent-local
    (0.523). This sits between the two — clearly above the roads so a boundary
    reads as a real edge, clearly below the markers so nothing ever competes
    with a meeting, and in a different hue so it reads as a different kind of
    thing rather than a brighter road.

    lib/map/districts.ts reads this token off the document when it builds the
    layers, so this is the single source of truth for it. MapLibre paint
    properties cannot take a var() directly.
  */
```

---

## Party affiliation colors (3a, 2026-08-19) — display only, applied to

<a id="party-affiliation-colors-3a-2026-08-19-display-only-applied-to-5"></a>

```
/* Party affiliation colors (3a, 2026-08-19) — display only, applied to
     the party LABEL text wherever it renders, never used to infer
     anything. The author's palette: Democratic blue, Republican red,
     Green green, Independent purple, no-affiliation/unknown gray. Values
     are tuned per theme to clear WCAG AA against --panel-bg at the small
     sizes party labels render at (lib/officials/party-color.ts maps
     label → token). */
```

---

## The design pass (2026-08-15) — the committed system. DESIGN.md is

<a id="the-design-pass-2026-08-15-the-committed-system-design-md-is-6"></a>

```
/* ------------------------------------------------------------------
     The design pass (2026-08-15) — the committed system. DESIGN.md is
     the prose spec; these tokens are the single source of truth.

     THE THREE REGISTERS (who is speaking):
     - voice  — the app's explainer/guidance voice. Slate-blue, set apart
       from the neutral grays so guidance never reads as record.
     - link   — anything tappable. The brand amber plus an underline;
       interactive amber is already the app's language (focus ring,
       active chips, hovers).
     - data   — the sourced record: full-contrast --text, numerals and
       identifiers in the mono face. Data is the brightest thing on any
       surface; the registers exist so it stays that way.
  */
```

---

## THE PALETTE PASS (item 5, 2026-08-15). The author: "I don't know how

<a id="the-palette-pass-item-5-2026-08-15-the-author-i-don-t-know-how-7"></a>

```
/* ------------------------------------------------------------------
     THE PALETTE PASS (item 5, 2026-08-15). The author: "I don't know how
     I feel about all this gold font."

     He was describing a real defect, not a preference. `--link` aliased
     `--accent-local`, and `--signal` (the Tailwind alias) aliased it too —
     so ONE colour was carrying links AND structural labels AND seat titles
     AND counters AND tier headers AND focus rings AND active chips. A
     colour that means seven things means nothing, and the screen reads
     heavy because the eye has no idea which gold is the one to act on.

     The distribution, not the hue, is what changed:

     - `--link` is the ONE interactive accent. Amber, and now ONLY on
       things a reader can tap.
     - `--action` / `--action-on` are the FILLED primary action — the
       ballot pill, the Ask button. Saturated accent is reserved for these.
     - `--label` is new: structural labels (type tags, seat titles, section
       eyebrows) render neutral and confident, at weight rather than in
       colour. This is where most of the gold went.
     - Data stays `--text`. It was never supposed to be gold; the counters
       were, and are not any more.

     Tier accents and party colours are UNTOUCHED, and so are the pill
     families — they mark structure and identity, and item 5 says so
     explicitly.

     Every value here clears 7:1 against the surfaces it renders on, in
     both themes, checked by `pnpm contrast`. That bar is the tester's
     field finding rather than WCAG's: gold-on-light measured 2.90:1 in the
     light theme — below AA, never mind glare — which is why the light
     `--link` below is a deep amber rather than the brand's.
  */
```

---

## THE BROWN DIES (item 6, 2026-08-16). The author: "I hate this brown

<a id="the-brown-dies-item-6-2026-08-16-the-author-i-hate-this-brown-8"></a>

```
/* ------------------------------------------------------------------
     THE BROWN DIES (item 6, 2026-08-16). The author: "I hate this brown
     throughout. Change it to something else entirely."

     The interactive accent was amber — `#ffb000` in dark, and in light a
     deep amber `#6d4600` that reads as brown on every surface it touches.
     It is replaced ENTIRELY, system-wide, through these three tokens:
     `--link` (anything tappable), `--action` (the filled primary action),
     and `--signal` (the alias every arbitrary usage goes through).

     WHY AZURE, and what it had to avoid. The palette here is crowded and
     most of it is politically load-bearing, so the new accent had to sit
     clear of: the party colours (Democratic blue 217°, Republican red 5°,
     Green 140°, Independent purple 273°), the tier accents (local amber
     41°, state teal-green 165°, national periwinkle 219°, school magenta
     330°, all-tiers orange 25°), `--danger`, and `--voice` (slate-blue
     218°). The gaps left are lime, cyan/azure (~195°) and indigo. Lime is
     unreadable at these sizes; indigo sits between national blue and
     Independent purple, and an accent a reader could mistake for a party
     colour is a worse defect than a brown one — a link that reads as a
     party mark is a claim. Azure is 30° clear of the nearest tier accent
     on either side and is nobody's party.

     REJECTED, and recorded so nobody re-proposes it: moving Local's tier
     accent off gold at the same time. The brief permits it — "if Local's
     tier color moves off gold/brown, the map legend and the tier toggles
     move with it" — but the tier accents are tuned to sit BETWEEN the
     basemap's roads and the meeting markers, and moving one means retuning
     the legend against the basemap. That is the author's eye's call, not a
     side effect of a link colour. `--tier-fill-local` in the light theme
     is therefore still a deep amber on the selected Local toggle; it is
     named as a remainder rather than quietly left.

     Both values clear the 7:1 sun bar against every surface they render on
     — dark 8.40–9.75:1, light 8.13–9.11:1 — measured by `pnpm contrast`. */
```

---

## VOTE AND REACTION PILLS (item 5)

<a id="vote-and-reaction-pills-item-5-9"></a>

```
/* VOTE AND REACTION PILLS (item 5).

     These deliberately invert the party chip's fill strategy — a party chip
     is a PALE fill with dark text, a vote pill is a DEEP fill with near-white
     text — and that inversion, not the hue, is what guarantees a no-vote can
     never read as a party mark at a glance. Hue alone could not: dark
     `--party-republican` is a pale salmon at 5° and any bright red sits
     within a few degrees of it. The shades are separated too — `--vote-no`
     is a deeper, more saturated vermilion than either party red — but the
     register is the real guard.

     Green YES, red NO, gray for present / position-recorded / not-voting and
     for the unsure reaction. A NAMED GAP wears none of them (`.vote-pill--gap`
     is an outline): absence is not a position and never gets a position's
     colour. */
```

---

## The five-point funding scale's own shades (D61's scale, item 5's

<a id="the-five-point-funding-scale-s-own-shades-d61-s-scale-item-5-s-10"></a>

```
/* The five-point funding scale's own shades (D61's scale, item 5's
     treatment). DEEPER reads as more emphatic, which is the intuitive
     direction: Love it is a deeper green than Like it, Hate it a deeper red
     than Don't like it. Don't care takes the neutral. Nothing here is summed,
     scored or ordered — the shades label the answer the reader gave. */
```

---

## --signal IS A REAL PROPERTY NOW, and it was not before

<a id="signal-is-a-real-property-now-and-it-was-not-before-11"></a>

```
/* ------------------------------------------------------------------
     `--signal` IS A REAL PROPERTY NOW, and it was not before.

     Found by the palette pass, 2026-08-15, by reading a computed style
     instead of a stylesheet. `--signal` and `--signal-dim` existed ONLY
     inside `@theme inline`, which is Tailwind's *inline* form: it teaches
     the compiler to substitute values into utilities like `text-signal`
     and deliberately emits NO custom property. So `text-signal` worked,
     and every one of the ~20 arbitrary usages — `border-[var(--signal)]`,
     `bg-[var(--signal)]/5`, and the raw `var(--signal)` in this
     stylesheet — resolved to nothing at all.

     What that meant on screen, all of it invisible in code review because
     the class names read correctly:

       • the ask box's "filled amber Ask button" (DESIGN.md's own words)
         was an unfilled outline;
       • "What's on the ballot" inside the who-governs card — the entry a
         whole session was spent making findable — had no accent border and
         no tint;
       • every reaction control's selected state, the funding pill frame,
         the tutorial's step dots, and the agenda notice were unstyled.

     This is the empty-success shape in CSS: a declaration that names a
     variable nobody defined fails silently and looks exactly like one that
     works. The fix is one line; the lesson is in the playbook — verify a
     token by reading `getComputedStyle`, never by reading the stylesheet.
  */
```

---

## PILL FAMILIES (funding type labels, item 2b). Six families, chosen

<a id="pill-families-funding-type-labels-item-2b-six-families-chosen-12"></a>

```
/* PILL FAMILIES (funding type labels, item 2b). Six families, chosen
     to never use or approach the party palette (Democratic blue,
     Republican red, Green green, Independent purple, unknown gray) —
     teals, ambers, slates, warm neutrals only, so no committee type
     reads as partisan and no color implies good or bad money. The
     type → family assignment is arbitrary but CONSISTENT, and lives in
     lib/funding/pill-colors.ts — nowhere else. Text/bg pairs are tuned
     per theme to hold WCAG AA at pill size on a phone. */
```

---

## ITEM 10 (2026-08-16): THE AMBER REMNANT. These three were near-black

<a id="item-10-2026-08-16-the-amber-remnant-these-three-were-near-black-13"></a>

```
/* ITEM 10 (2026-08-16): THE AMBER REMNANT. These three were near-black
     tints carrying near-white text, and the local one was #6d4600 — the exact
     hex the dead interactive brown used to be, left behind on the selected
     Local toggle. That is what the author saw. They also disagreed with the
     LEGEND, which draws the same tiers in their bright accents, so the
     control and the key to the map were two different colours for one tier.

     The light theme now fills the way the dark theme already does — bright,
     carrying DARK text — so the toggle reads as its tier's own colour beside
     the legend instead of as a near-black tint. Not the identical hex: the
     light map accents sit at mid luminance and cannot carry text either way
     (`--accent-local` takes `--bg` at 2.8:1 and white at 3.0:1), so these are
     the readable-fill versions of the same hues. The map is untouched — no
     tier accent moved, which keeps the legend tuned against the basemap as
     the author left it. Measured by `pnpm contrast`, both themes. */
```

---

## The design-pass tokens, light theme. Same roles as dark

<a id="the-design-pass-tokens-light-theme-same-roles-as-dark-14"></a>

```
/* The design-pass tokens, light theme. Same roles as dark.

     Item 5, 2026-08-15 — the sun test, and this is where it bites hardest.
     `--link` used to alias `--accent-local` (#b8860b), which measures
     **2.90:1** against this theme's page background. That is below AA, let
     alone the 7:1 sun bar, and it is precisely the tester's field finding:
     gold-on-light is unreadable in phone glare because it was barely
     readable indoors. The interactive accent here is a deep amber that
     keeps the brand's hue and clears the bar.

     `--action` is the FILLED primary action, and it is measured the other
     way round: the text sits ON the accent, so `--action` stays saturated
     enough to read as an action and `--action-on` is the light text that
     runs across it. */
```

---

## LEGACY ALIASES — delete as Phase 2/3 replaces the components that use them

<a id="legacy-aliases-delete-as-phase-2-3-replaces-the-components-that-use-them-15"></a>

```
/*
  LEGACY ALIASES — delete as Phase 2/3 replaces the components that use them.

  The entry screen was built against a "public notice" palette (ink / paper /
  signal / rule). Rather than rename every utility in one pass and land a diff
  where nothing is verifiable, these map the old names onto the new tokens so
  the existing screen keeps rendering and picks up the new palette immediately.
  Nothing new should reference them.
*/
```

---

## Item 6 (2026-08-16): these aliased --accent-local, so text-signal

<a id="item-6-2026-08-16-these-aliased-accent-local-so-text-signal-16"></a>

```
/* Item 6 (2026-08-16): these aliased `--accent-local`, so `text-signal`
     stayed GOLD while the real `--signal` property moved to the new accent —
     the M96 trap running the other way, one colour with two values depending
     on which spelling a component happened to use. Both spellings resolve to
     `--link` now, so changing the interactive accent changes all of it. */
```

---

## The design pass (2026-08-15): the type scale's structural rungs

<a id="the-design-pass-2026-08-15-the-type-scale-s-structural-rungs-17"></a>

```
/* ------------------------------------------------------------------
     The design pass (2026-08-15): the type scale's structural rungs.
     DESIGN.md carries the whole scale; these two classes are the rungs
     components share by name rather than by copied utility strings.

     Structural labels ORGANIZE and content LEADS: a structural label is
     confident — weight, tracking, a hairline rule — without dwarfing
     the names under it. The old 9px whisper read as the least important
     thing on the card while doing the most important job.
  */
```

---

## ============================================================================

<a id="note-18"></a>

```
/* ============================================================================
   SHELL — ported from EdiaStratMap src/styles/main.css.

   Class names and metrics are kept as close to the original as the port allows,
   so someone who knows that stylesheet can find their way around this one.
   Every colour goes through a token, so all of it themes.
   ========================================================================== */
```

---

## G05 RULE 4f — THE RAIL IS A CARD OVER THE MAP, AND IT ENDS WHERE ITS

<a id="g05-rule-4f-the-rail-is-a-card-over-the-map-and-it-ends-where-its-19"></a>

```
/* G05 RULE 4f — THE RAIL IS A CARD OVER THE MAP, AND IT ENDS WHERE ITS
   CONTENT ENDS.
 *
 * *"The sidebar sizes to its contents - a card over the map whose height ends
 * where its content ends, growing and shrinking as the Ask box and sections
 * open. BOUND: ... the card never exceeds viewport minus safe areas and map
 * chrome; beyond that it scrolls internally and both its top and bottom stay
 * reachable."*
 *
 * It was `height: 100vh` — a full-height column whose footer sat under
 * `mt-auto` at the bottom of the screen with dead space above it whenever the
 * content was short, which at 03255 is most of the time.
 *
 * THE BOUND IS THE HALF THAT MATTERS AND IT IS WRITTEN AS ONE EXPRESSION.
 * M54/M55 were one root cause: an unbounded overlay grew to 893px against an
 * 844px viewport, put its own top at y = −113, and made the ballot entry
 * untappable. `height: auto` without a ceiling re-opens exactly that, because
 * the rail now grows with the Ask expansion and an answer inside it. So the
 * ceiling is stated here, in the same rule as the growth:
 *
 *   max-height = viewport − (top inset + bottom inset) − both safe areas
 *
 * and `.sidebar-scroll` takes the overflow internally. The top is pinned at
 * `--rail-inset`, so it is on screen by construction; the bottom is reachable
 * because the scroller, not the card, is what runs out of room. */
```

---

## One pattern at every width (2f): visible by default, slides left to hide

<a id="one-pattern-at-every-width-2f-visible-by-default-slides-left-to-hide-20"></a>

```
/* One pattern at every width (2f): visible by default, slides left to hide,
   the hamburger brings it back. The phone drawer was already this shape —
   the desktop rail joins it. `data-sidebar` on <main> carries the state:
   "default" is per-width (desktop visible, phone hidden), "open"/"closed"
   are the reader's explicit choice and win at any width. */
```

---

## 4f: the scroller takes what is left and NO MORE. flex: 1 made it claim

<a id="4f-the-scroller-takes-what-is-left-and-no-more-flex-1-made-it-claim-21"></a>

```
/* 4f: the scroller takes what is left and NO MORE. `flex: 1` made it claim
   the whole column even when its content was three rows, which is where the
   dead space above the footer came from. `0 1 auto` lets the card shrink to
   its content and lets the scroller absorb the overflow only once the card's
   ceiling is reached. */
```

---

## Item 5 (2026-08-15): a selected tier wears ITS OWN colour, never the

<a id="item-5-2026-08-15-a-selected-tier-wears-its-own-colour-never-the-22"></a>

```
/* Item 5 (2026-08-15): a selected tier wears ITS OWN colour, never the
   all-tiers orange — which is what the default view (all three on) used to
   render as, matching nothing else on the screen. Unselected stays grey, as
   it was. The fill tokens are the readable form of each tier accent; see
   their note in the token block. */
```

---

## Item 6 (2026-08-16): the counters redesigned

<a id="item-6-2026-08-16-the-counters-redesigned-23"></a>

```
/* Item 6 (2026-08-16): the counters redesigned.
 *
 * They were four flex tiles with `min-width: 64px` in a 340px rail, so at
 * every width each tile was about 70px wide and had to hold a 10px uppercase
 * label with half a pixel of tracking. "DISTRICTS IN VIEW" and "OFFICIALS"
 * overflowed their tiles and the row read as clutter — four numbers you
 * could not attach to their nouns.
 *
 * A 2×2 GRID is the form. Two per row at ~148px each is twice the width, so
 * the longest label wraps inside its own tile instead of out of it, and the
 * block reads as four things rather than as a strip. The door behaviour is
 * untouched: every tile is still the door to what it counts, and the
 * highlight still means "this door is open" and nothing else.
 *
 * The HONEST MODES from M87 are truth rules, not styling, and none of them
 * moved: the "in view" labelling, the governing-set mode, "Off" when the
 * overlay is off, and the couldn't-check dash. */
```

---

## LAY-5 (2026-08-24, the author's capture 11-57-33) — THE TOP'S TREATMENT

<a id="lay-5-2026-08-24-the-author-s-capture-11-57-33-the-top-s-treatment-24"></a>

```
/* ---------------------------------------------------------------------------
   LAY-5 (2026-08-24, the author's capture 11-57-33) — THE TOP'S TREATMENT,
   CARRIED ALL THE WAY DOWN.

   His words: the rail's top — the Ballot pill, the zip, the Ask line and the
   four tiles — is the reference, and below the tiles it degrades into
   unstyled raw text. The capture is exactly that: four rounded surface tiles,
   and then a bare toggle, a bare paragraph, a bare uppercase label and two
   bare underlined links, none of them on anything.

   So every section below the tiles takes the tile's own chrome — the same
   surface, the same committed radius token, the same inset — rather than a
   new scale invented here. Content sits at 22px + 12px from the rail's edge
   in EVERY section, tiles included, so the column has one left edge instead
   of four.
   --------------------------------------------------------------------------- */
```

---

## A collapsible filter group's header (g4 item 14)

<a id="a-collapsible-filter-group-s-header-g4-item-14-25"></a>

```
/*
 * A collapsible filter group's header (g4 item 14).
 *
 * Inherits the `.filter-label` type rather than restating it — the header IS
 * the label, and the only thing that changes is that it has become the
 * control that opens the group. Nothing about a closed group is styled as
 * disabled: it is closed, not unavailable.
 */
```

---

## The top-right floaters (item 2, 2026-08-15): the ballot entry, the zip, and

<a id="the-top-right-floaters-item-2-2026-08-15-the-ballot-entry-the-zip-and-26"></a>

```
/* The top-right floaters (item 2, 2026-08-15): the ballot entry, the zip, and
   Ask. Replaces `.ballot-bubble`, which was a 10px uppercase mono whisper —
   correct as a map control, wrong as the product's flagship entry, which is
   what the author's note ("a standout entry and renders like one") says it
   has to be. Sizes here are the type scale's Detail/Body rungs rather than
   the Caption rung the old pill sat on, and the ballot half is FILLED: it is
   the one genuinely primary action on the map, which under item 5's palette
   rule is exactly what earns the saturated accent. */
```

---

## G07 (2026-08-17): THE LABEL GOT LONGER, SO THE ROW HAS TO BE ABLE TO WRAP

<a id="g07-2026-08-17-the-label-got-longer-so-the-row-has-to-be-able-to-wrap-27"></a>

```
/* G07 (2026-08-17): THE LABEL GOT LONGER, SO THE ROW HAS TO BE ABLE TO WRAP.
   *
   * The pill used to read a bare "Ask" and two pills fitted on one line at
   * 390px. G07 makes the label carry a concrete example, and `pnpm overlaps`
   * caught the consequence immediately: the row grew to 350px inside a ~334px
   * band, its left edge landed at −16, and the hamburger at (12,12) was
   * sitting on top of it. Shortening the label further would answer the
   * measurement by giving up the rule; wrapping answers it by giving the row
   * a second line, which is what the corner has room for. */
```

---

## F01 10.2 (2026-08-19, the author): "The order — Ballot, then zip, then Ask

<a id="f01-10-2-2026-08-19-the-author-the-order-ballot-then-zip-then-ask-28"></a>

```
/*
 * F01 10.2 (2026-08-19, the author): *"The order — Ballot, then zip, then Ask
 * — is right. However Ballot and zip should be the same width as Ask about a
 * pothole or meeting. That should also be the case in the who-governs-here
 * pop-up."*
 *
 * In the two RAIL placements the cluster owns its whole row, and the two rows
 * each sized to their own content — a short [Ballot|85701] pair above a much
 * wider Ask pill, ragged on both edges. The MAP placement is deliberately
 * excluded: there the cluster floats in a corner beside MapLibre's zoom column
 * and shrink-to-fit is the whole point, so stretching it would be applying a
 * rail rule to a floater.
 *
 * Stretching rather than fixing a width: both children fill the container, so
 * they are equal BY CONSTRUCTION and stay equal when the rail's width changes
 * or the label does. Inside the ballot pill the zip half keeps its natural
 * width and the "Ballot" half absorbs the rest, which is what "filling the
 * width without stretching" means for a two-part control.
 */
```

---

## The map placement starts CLEAR OF THE HAMBURGER, which is fixed at (12,12)

<a id="the-map-placement-starts-clear-of-the-hamburger-which-is-fixed-at-12-12-29"></a>

```
/* The map placement starts CLEAR OF THE HAMBURGER, which is fixed at (12,12)
   and paints over everything.
 *
 * Wrapping alone was not enough and the difference is worth writing down: the
 * pills wrapped to the right and nothing was painted under the button, but the
 * cluster's BOX still spanned the full band and still began at x = 12. `pnpm
 * overlaps` measures boxes, and it is right to — an element the reader cannot
 * tap through is covered whether or not it currently has ink there, and the
 * next longer label would put ink there. So the band itself begins after the
 * control rather than under it. */
```

---

## G05 rule 4e: THE SAME CLUSTER, IN A BOUNDED CONTAINER

<a id="g05-rule-4e-the-same-cluster-in-a-bounded-container-30"></a>

```
/* G05 rule 4e: THE SAME CLUSTER, IN A BOUNDED CONTAINER.
 *
 * The rules above were written for one placement — the map's top-right
 * corner, where the cluster floats against an unbounded viewport and is right
 * aligned so it hugs the edge. Rule 4e now puts the SAME cluster at the top of
 * the who-governs card and at the top of the rail, both of which are ~340px
 * boxes, and `align-items: flex-end` on a `nowrap` row of `white-space:
 * nowrap` pills does not shrink inside a bounded box — it overflows to the
 * LEFT. Caught in a 390px screenshot before this shipped: the card's text ran
 * off the left edge of the phone.
 *
 * So the two bounded placements get the opposite of the floating one: full
 * width, left aligned, and a row that WRAPS. Nothing about the map placement
 * changes, which is why this is scoped by the placement attribute rather than
 * written into the base rules. */
```

---

## The ballot pill keeps its intrinsic size; the Ask pill takes whatever is

<a id="the-ballot-pill-keeps-its-intrinsic-size-the-ask-pill-takes-whatever-is-31"></a>

```
/* The ballot pill keeps its intrinsic size; the Ask pill takes whatever is
   left on the row and truncates rather than pushing the row wider. G07's
   label is chosen per placement to fit (lib/routing/ask-pill-labels.ts), and
   this is the belt to that braces: a longer label degrades to an ellipsis
   inside the pill instead of off the side of the card. */
```

---

## F01 8.2 (2026-08-19, the author): "the expanded Ask bar is enormously wide

<a id="f01-8-2-2026-08-19-the-author-the-expanded-ask-bar-is-enormously-wide-32"></a>

```
/* F01 8.2 (2026-08-19, the author): "the expanded Ask bar is enormously wide
   on desktop. Narrow it substantially; it can grow slightly taller in
   exchange."
 *
 * `width: 100%` is correct in the two RAIL placements — the sidebar and the
 * who-governs card are ~340px envelopes and the panel should fill them. On the
 * MAP placement the same rule let the panel take the whole top band, which at
 * 1440px is a ~1400px-wide box holding one input: a line of body text at that
 * measure is unreadable and the box reads as a takeover rather than a panel
 * hanging off a pill.
 *
 * So the width stays 100% and gains a CEILING. 30rem is a comfortable reading
 * measure for the explainer sentence and still wide enough that the input and
 * the Ask button sit on one line at every size; below 640px nothing changes,
 * because there the ceiling is already above the viewport. Taller is the
 * accepted trade — the explainer wraps to three lines instead of one. */
```

---

## M139 (2026-08-18) — the two halves carry the pill's own curve

<a id="m139-2026-08-18-the-two-halves-carry-the-pill-s-own-curve-33"></a>

```
/* M139 (2026-08-18) — the two halves carry the pill's own curve.

   The zip half reads as "a SQUARE outline inside a rounded pill" because it
   had square corners and a CONTRASTING border (1px solid var(--signal))
   against a rounded parent. `.ballot-pill` has overflow: hidden, so the
   corners were being cut off mid-line rather than following the curve — the
   border ran straight to the clip and stopped.

   `.ballot-pill-main` had the same square corners all along and nobody saw
   it, because its border colour and its background are both var(--action):
   there was no line to see being cut. Giving both halves the matching radius
   fixes the visible defect and the invisible one in the same rule, which is
   the point — the next colour change to the left half would have exposed it. */
```

---

## 6g (2026-08-15, the author): the SOURCE tag broke to "SR / C" beside a long

<a id="6g-2026-08-15-the-author-the-source-tag-broke-to-sr-c-beside-a-long-34"></a>

```
/* 6g (2026-08-15, the author): the SOURCE tag broke to "SR / C" beside a long
   name — "Lane Santa Cruz" pushed it into a 2-character column and a
   nine-letter mono word with 0.1em tracking wrapped mid-word.

   Two rules, and both are needed: the tag never wraps, and it never shrinks
   below its own width. `flex-shrink: 0` is what actually fixes it — the tag
   lives in flex rows beside names that can be arbitrarily long, and without
   it the tag is the flexible thing in the row. Applied at the CLASS rather
   than per-site so a sixth render of this tag cannot arrive without it. */
```

---

## The collapsible battlecard section (item 6b4, 2026-08-15). The header is a

<a id="the-collapsible-battlecard-section-item-6b4-2026-08-15-the-header-is-a-35"></a>

```
/* The collapsible battlecard section (item 6b4, 2026-08-15). The header is a
   pill because a pill is already this system's word for "tappable, and not a
   link", and it pops by CONTRAST with item 5's quieting rather than by being
   another loud element — which is why the two items were built together and
   share one token family. Change `--link` and both move. */
```

---

## Item 4 (2026-08-16) — THE CHEVRON DEFECT, diagnosed

<a id="item-4-2026-08-16-the-chevron-defect-diagnosed-36"></a>

```
/* Item 4 (2026-08-16) — THE CHEVRON DEFECT, diagnosed.
 *
 * This was a DESCENDANT selector: `.card-section[data-open] .card-section-
 * chevron`. CardSections NEST — "When it mattered" contains "Votes on laws"
 * and "Votes on people" — so opening the outer section rotated every chevron
 * inside it, including the CLOSED sub-groups', which then pointed UP while
 * shut. Exactly the author's report: arrows pointing the wrong way for their
 * state, on those two sub-groups.
 *
 * The child combinator scopes the rotation to the section's OWN header. Note
 * the rule two blocks up already used `>` for the background — half the pair
 * was right, which is why it looked correct in a diff. */
```

---

## SUB-GROUPS INSIDE A PANE (item 6, 2026-08-16, the author's ruling)

<a id="sub-groups-inside-a-pane-item-6-2026-08-16-the-author-s-ruling-37"></a>

```
/* SUB-GROUPS INSIDE A PANE (item 6, 2026-08-16, the author's ruling).
 *
 * "Votes on laws" and "Votes on people" are sections INSIDE the Voting Record
 * pane, and at the same size and colour as the pane's own header they read as
 * three peers rather than as a thing containing two things. The author's
 * report was that "When it mattered" appeared to render NOTHING: the pane's
 * whole visible content was one small paragraph and two closed bars that did
 * not look like content or like controls.
 *
 * So a sub-group INDENTS behind a rule, and steps down in size — smaller
 * type, squarer corners, quieter fill — while keeping the chevron and the
 * tap target that say it is a thing to click. Hierarchy by inset and scale,
 * in the committed grammar; no new affordance language. */
```

---

## Item 4 (2026-08-16): the two views INSIDE Voting Record

<a id="item-4-2026-08-16-the-two-views-inside-voting-record-38"></a>

```
/* Item 4 (2026-08-16): the two views INSIDE Voting Record.
 *
 * This replaces 6b's `.vote-columns` grid, which put Recent beside When it
 * mattered and gave each half the card — so on a desktop the record read as
 * two narrow gutters with the middle of the card empty, and each header
 * floated with no parent saying what it was recent OF.
 *
 * One selected at a time; the selected view consumes the FULL width. The
 * selectors are visibly a pair, so it reads as one control with two
 * positions rather than as two independent things that happen to be
 * adjacent. */
```

---

## ==========================================================================

<a id="note-39"></a>

```
/* ==========================================================================
   THE IDENTITY HEADER AND THE PILL GRAMMAR — items 2, 3, 5 and 8, 2026-08-16.

   The author's ruling: circle portrait with a NEUTRAL ring, name as the
   dominant type, one chip row where PARTY FILLS in its assigned colour and
   everything else is an outlined neutral. Fill-versus-outline carries the
   emphasis, never size — every chip is one height.

   The reference screenshot rings the portrait in the party's red. That is the
   one thing NOT adopted: a party-coloured ring makes the photograph itself a
   partisan mark, and then a nonpartisan office has to wear either a colour it
   has no claim to or a visibly lesser frame.
   ========================================================================== */
```

---

## THE CONTACT PILL ROW (items 2 and 8)

<a id="the-contact-pill-row-items-2-and-8-40"></a>

```
/* --------------------------------------------------------------------------
   THE CONTACT PILL ROW (items 2 and 8).

   It replaces the REACH THEM label/value ledger, which was a flex row with a
   `white-space: nowrap` key column: inside a 300px popup a long office title
   ate the whole width, the value collapsed to a few pixels, and
   `word-break: break-word` broke the name ONE CHARACTER PER LINE. That is the
   production defect the author reported — Pima's supervisors reading
   vertically, "Dr. Matt Heinz" as a vertical column of letters.

   A pill carries its own label, so nothing competes for a fixed width.

   THEY WRAP, THEY NEVER SHRINK: below a tap target a pill is a defect, so
   there is a 44px floor and no flex-shrink. At 390px the row runs to two or
   three lines and every pill stays tappable.

   This is the house grammar for "tappable fact" — recorded in DESIGN.md. */
```

---

## ONE CLEAN COLUMN (item 4, 2026-08-16, the author's ruling)

<a id="one-clean-column-item-4-2026-08-16-the-author-s-ruling-41"></a>

```
/* ONE CLEAN COLUMN (item 4, 2026-08-16, the author's ruling).
 *
 * The small popup's contact pills stack instead of wrapping. Wrapping filled
 * the card with ragged half-rows — the "ugly and scattered" the author sent
 * this back for — and a column of full-width pills reads as a list of ways to
 * reach one person, which is what it is. The "More" footer below is
 * full-width too, so the column and the way deeper line up on both edges. */
```

---

## THE PERSON ROW (item 2) — a representation list that stays horizontally

<a id="the-person-row-item-2-a-representation-list-that-stays-horizontally-42"></a>

```
/* --------------------------------------------------------------------------
   THE PERSON ROW (item 2) — a representation list that stays horizontally
   sane at every width.

   It replaces a `.popup-row` whose key was the OFFICE TITLE. `.pk` is
   `white-space: nowrap`, so "County Supervisor, District 2 (Vice Chair)"
   consumed the whole 264px content box, the value column collapsed, and
   `.pv`'s `word-break: break-word` rendered the person's NAME one character
   per line. Stacked, nothing competes for the width: the name leads at full
   width and the office sits under it. */
```

---

## F01 7.1 (2026-08-19, the author's walkthrough): "Section headers get one

<a id="f01-7-1-2026-08-19-the-author-s-walkthrough-section-headers-get-one-43"></a>

```
/* F01 7.1 (2026-08-19, the author's walkthrough): "Section headers get one
   line and that's it."
 *
 * Every person row used to draw its own rule, so a STATE section with four
 * officials in it rendered five horizontal lines — one per row plus the
 * section's own — and the reader could not tell which line meant "new
 * section" and which meant "new person". The author's named instances were
 * the orphan rule between Alma Hernández and Betty Villegas in Tucson and the
 * same shape between Greg Sargent and Karen Ebel at 03255; his pattern to
 * copy is New Hampshire's LOCAL section, which draws exactly one.
 *
 * The rules are gone; the vertical rhythm does the separating. Padding went
 * up to keep the rows from reading as one block now that nothing divides
 * them. This is the class fix — `.person-row` is the shared row on the
 * who-governs card AND the map's district popup, so both surfaces change
 * together, which is the point. */
```

---

## NH-1 (2026-08-23, the author's 8/22 walkthrough; tracker NH77)

<a id="nh-1-2026-08-23-the-author-s-8-22-walkthrough-tracker-nh77-44"></a>

```
/*
 * NH-1 (2026-08-23, the author's 8/22 walkthrough; tracker `NH77`).
 *
 * This was `flex-direction: column`, so the party and the source mark sat on
 * their own line UNDER the name and every person in Who Governs Here took two
 * rows. At 03255 that is Kristen Schultz, Scott Wheeler and Sandra Warde each
 * occupying twice the height they need, and the panel holds far more people
 * than three.
 *
 * A row, wrapping. The name, its party and its source read as one line, and a
 * name long enough to need a second line still gets one rather than
 * truncating — a truncated name is a different person's name.
 *
 * `.person-row` is the SHARED row on the who-governs card and the map's
 * district popup, so both surfaces change together. That was already the
 * stated point of this class and it is why the fix lands here rather than on
 * the one panel the author was looking at.
 */
```

---

## ALIGN-1 (2026-08-25) — EVERYTHING READS LEFT TO RIGHT. NOTHING INDENTS

<a id="align-1-2026-08-25-everything-reads-left-to-right-nothing-indents-45"></a>

```
/*
 * **ALIGN-1 (2026-08-25) — EVERYTHING READS LEFT TO RIGHT. NOTHING INDENTS
 * RIGHT.** The most repeated complaint of the 8/25 evening walkthrough, and one
 * declaration behind all of it: `justify-content` was `flex-end`, so every
 * name sat pushed right of the district it serves while the district's own
 * label sat at the left margin. Drawn in his `17-18-44`, `17-30-58` and
 * `17-53-26`, each with an arrow pointing left.
 *
 * `.person-row` is SHARED — the who-governs card and both blocks of the small
 * battlecard — which is why the four surfaces he named are one line of CSS.
 * `flex-start` is stated rather than deleted so the next edit cannot
 * reintroduce this by leaving it out. `tests/person-row-alignment.test.ts`.
 */
```

---

## PARTY AS PLAIN TEXT (item 3, 2026-08-16, the author's ruling)

<a id="party-as-plain-text-item-3-2026-08-16-the-author-s-ruling-46"></a>

```
/* PARTY AS PLAIN TEXT (item 3, 2026-08-16, the author's ruling).
 *
 * The who-governs list is the one surface where party is NOT a pill. Twenty
 * rows of filled chips is the overcrowding the author sent this item back
 * for; the pill stays on the battlecards, small and large, where there is one
 * person and the chip is the identity. Here it is the word, in the party's
 * colour, and the colour is display only — nothing infers a position from it. */
```

---

## VOTE AND REACTION PILLS (item 5)

<a id="vote-and-reaction-pills-item-5-47"></a>

```
/* --------------------------------------------------------------------------
   VOTE AND REACTION PILLS (item 5).

   A recorded position renders as a FILLED pill in the chip grammar, in both
   vote views, replacing the bare bold text and the coloured YES/NO.

   The no-red is deliberately a DIFFERENT SHADE from the party red — a
   no-vote must never read as a party mark at a glance. `--vote-no` sits
   warmer and darker than `--party-republican` in both themes. */
```

---

## Item 6b3 (2026-08-15): one silhouette per contest, whatever the source

<a id="item-6b3-2026-08-15-one-silhouette-per-contest-whatever-the-source-48"></a>

```
/* Item 6b3 (2026-08-15): one silhouette per contest, whatever the source
   published. The tile is a surface in its own right — fixed size, its own
   ground, its own border — so a circular PNG on transparency and a
   full-bleed rectangle and a pair of initials all occupy the identical box.
   Collapse is organization; so is this. Neither renders anyone smaller. */
```

---

## The reaction box (item 6c, 2026-08-15) — the sensor as the point of the

<a id="the-reaction-box-item-6c-2026-08-15-the-sensor-as-the-point-of-the-49"></a>

```
/* The reaction box (item 6c, 2026-08-15) — the sensor as the point of the
   surface, not a footer under it. Same framed language as THE NEXT ELECTION.

   `data-frame="compact"` is the author's smaller form for the battlecard's
   vote rows: "as prominent, not as large". Same component, same colours, same
   tap sizes — only the padding and the prompt's size change, because what
   makes a dozen of these readable in one card is the space between them, not
   a quieter colour. */
```

---

## Item 5 (2026-08-16): the measure/proposition PICK takes the same frame and

<a id="item-5-2026-08-16-the-measure-proposition-pick-takes-the-same-frame-and-50"></a>

```
/* Item 5 (2026-08-16): the measure/proposition PICK takes the same frame and
   the same prompt weight as the person prompt — "no prompt renders quieter
   because its subject is a measure instead of a person."

   The DASHED border is what still separates the two, and it is not
   decoration: a pick is the reader's private note that never leaves the
   device, a reaction joins anonymous totals and says so at capture. Equally
   loud, visibly different kinds of thing. */
```

---

## The five-point scale's group separators (g3 item 7, 2026-08-16)

<a id="the-five-point-scale-s-group-separators-g3-item-7-2026-08-16-51"></a>

```
/*
 * The five-point scale's group separators (g3 item 7, 2026-08-16).
 *
 * The author's find: on the funding row "Don't like it" sat dead centre, and
 * the eye defaults to the middle of a row of equal buttons — a sensor reading
 * its own layout, on the path whose aggregates are sold. Which options lead a
 * group is decided in lib/reactions/pill.ts (SCALE_GROUP_LEADERS); this is
 * only how the boundary looks: a hairline the width of the gap, dimmer than a
 * border, carrying no information of its own.
 *
 * `align-self: stretch` rather than a fixed height, so it matches whatever
 * the row's tallest control is after wrapping at 390px.
 */
```

---

## The five-point scale's group dividers (g3 item 7, BOLDER for g4 item 7)

<a id="the-five-point-scale-s-group-dividers-g3-item-7-bolder-for-g4-item-7-52"></a>

```
/*
 * The five-point scale's group dividers (g3 item 7, BOLDER for g4 item 7).
 *
 * They split the row into favourable | unfavourable | abstain so no option
 * owns the visual centre. At 1px of `--panel-border` at 0.85 they were
 * "barely visible" (the author) — which is the same as absent, because a
 * divider a reader does not register cannot stop the middle button reading as
 * the default. Two pixels, full opacity, inset from the row's own edges so it
 * reads as a boundary between groups rather than as a border on a button.
 */
```

---

## A meeting's status, as a FILLED pill (g4 item 11)

<a id="a-meeting-s-status-as-a-filled-pill-g4-item-11-53"></a>

```
/*
 * A meeting's status, as a FILLED pill (g4 item 11).
 *
 * Filled rather than outlined, because this is a present value and not a
 * named gap — the render-default rule's other side. An outline is what an
 * absence wears here; a sitting that has finished is a fact we hold.
 *
 * Cancelled takes its own token rather than sharing Concluded's: "it happened
 * and is over" and "it was called off" are different things to know before
 * travelling to a building, and one shade for both would flatten them.
 */
```

---

## THE SETTLED REACTION (item 5, corrected 2026-08-16)

<a id="the-settled-reaction-item-5-corrected-2026-08-16-54"></a>

```
/* THE SETTLED REACTION (item 5, corrected 2026-08-16).
 *
 * The reader's own answer, wearing the same grammar as a recorded vote. It
 * is the CONFIRMATION'S FACE, not its truth — `SAVING` and `NOT_COUNTED`
 * never reach this class, so a write that did not land can never render as
 * one that did.
 *
 * TWO CLASSES, DELIBERATELY, and it must stay that way. This rule first
 * shipped as a bare `.reaction-choice--settled` written ABOVE
 * `.reaction-choice` — same specificity, earlier in the file — so the base
 * control's `background: var(--panel-bg)` won the cascade and took the fill
 * back, leaving near-white `--vote-text` on the panel ground at 1.01:1 in
 * light theme. Every class name read correctly in review; the button blanked
 * on screen the moment a reader tapped it, and the row had landed every
 * time. The doubled class means source order can never decide this again.
 * Guarded by measuring the ratio, not by reading the file:
 * `tests/reaction-pill.test.ts`. */
```

---

## RULING 71 (NJ Hunt 3, 2026-08-22) — "Could govern you"

<a id="ruling-71-nj-hunt-3-2026-08-22-could-govern-you-55"></a>

```
/* RULING 71 (NJ Hunt 3, 2026-08-22) — "Could govern you".
 *
 * On a contest whose DIVISION covers only part of the reader's zip. It is an
 * INVITATION, not a disclosure of our incompleteness, and the styling carries
 * that: it reads as an offer in the link colour, not as a warning and not as a
 * deficiency badge. RULING 44 bans a per-card completeness marker; this is a
 * fact about the reader's street, not about our data, and it never wears the
 * clothes of the thing it is not.
 *
 * A named gap in this product renders in the gap's own register — an outline
 * where a recorded value renders as a filled pill. This is deliberately NOT
 * that register either: nothing here is absent.
 *
 * `[data-could-govern]` is toggled off by ballot-narrowing.tsx on contests a
 * session address confirms (RULING 74), so the pill disappears from exactly
 * the bodies the reader has settled and stays on the rest.
 */
```

---

## The pill is per BODY, so on a narrow viewport it wraps under the title

<a id="the-pill-is-per-body-so-on-a-narrow-viewport-it-wraps-under-the-title-56"></a>

```
/* The pill is per BODY, so on a narrow viewport it wraps under the title
   rather than pushing the heading into a two-line ragged column.
 *
 * **THE ACTION HALF IS NEVER HIDDEN.** The first version dropped
 * `.could-govern-action` under 460px to keep the pill on one line, and a
 * production capture read as an image showed the result: at 430×932 the pill
 * said only "Could govern you". That is the invitation stripped out, leaving a
 * bare uncertainty marker beside a body's name — which is much closer to the
 * per-card completeness statement RULING 44 deleted than to the offer RULING 71
 * specifies. The distinction that keeps this pill legitimate lives in the words
 * "add your address to confirm", so those words are the last thing that may be
 * dropped to save a line. It wraps instead. */
```

---

## WGH-9 (2026-08-25) — THE TWO PILLS ARE ONE PILL WITH TWO LABELS

<a id="wgh-9-2026-08-25-the-two-pills-are-one-pill-with-two-labels-57"></a>

```
/* ---------------------------------------------------------------------------
   WGH-9 (2026-08-25) — THE TWO PILLS ARE ONE PILL WITH TWO LABELS.

   The author: *the WGH pill matches the Meetings pill — width, height, fonts,
   border; a left-edge colour band is the only permitted difference.*

   They sit one above the other in the same region and in `08-47-06` they
   agreed on nothing: 999px against a 6px radius, 0.625rem uppercase with
   0.18em tracking against 13px plain, 9x13 padding against 10x16, and two
   different shadows. Two controls that do the same kind of job, drawn as
   though they came from different products.

   **So the numbers live in ONE declaration block for both**, which is the only
   version of this that stays true. Two blocks that happen to agree today is
   the pair-that-has-to-agree written twice, and it drifts the first time one
   of them is touched.

   `min-width` is what makes WIDTH match rather than merely correspond: the
   labels are different lengths, so equal padding gives unequal boxes. 220px
   is the wider label's natural width at these numbers, so neither is
   stretched and both land on the same right edge.
   --------------------------------------------------------------------------- */
```

---

## Everything this shares with .notice-fab is in the joint block above

<a id="everything-this-shares-with-notice-fab-is-in-the-joint-block-above-58"></a>

```
/* Everything this shares with `.notice-fab` is in the joint block above
   (WGH-9). What is left here is the ONE permitted difference and the
   transition. The tier accent moved to this edge from the numeral (item 5): a
   left edge in the showing tiers' colour says what the gold digits said, in
   the place a structural mark belongs. */
```

---

## Item 5 (2026-08-15): the counters are DATA, and data renders in the data

<a id="item-5-2026-08-15-the-counters-are-data-and-data-renders-in-the-data-59"></a>

```
/* Item 5 (2026-08-15): the counters are DATA, and data renders in the data
   register — full-contrast `--text`, mono, at weight. They were tier-accented,
   which is how "21 meetings · 7 venues" arrived on screen as two gold numbers
   competing with the ballot entry and the links for the same eye. The tier
   accent still lives on this badge, on its BORDER (below), where it marks
   which tiers are showing without shouting a number. */
```

---

## MTG-1, second pass (2026-08-23). The jurisdiction badge moved out of the

<a id="mtg-1-second-pass-2026-08-23-the-jurisdiction-badge-moved-out-of-the-60"></a>

```
/*
 * MTG-1, second pass (2026-08-23). The jurisdiction badge moved out of the
 * meta line and under the title. Its own block, so the title keeps the full
 * row width — the fix for the overlap had squeezed the body name to
 * "Rockaway Tow…", which a reader scanning nineteen rows cannot use.
 *
 * `white-space: normal` because `.al-row-title` sets `nowrap` for its own
 * ellipsis and a pill inheriting that cannot wrap at a narrow width.
 */
```

---

## MTG-1 (2026-08-23, the author's 8/22 walkthrough). The meta line was a plain

<a id="mtg-1-2026-08-23-the-author-s-8-22-walkthrough-the-meta-line-was-a-plain-61"></a>

```
/*
 * MTG-1 (2026-08-23, the author's 8/22 walkthrough). The meta line was a plain
 * inline run, so the jurisdiction pill and the date shared a line box and the
 * pill painted over the date in every row of the 48-meetings list. An
 * inline-block pill beside inline text does not push it; it sits on it.
 *
 * A flex row with a real gap fixes it structurally rather than by nudging a
 * margin: the pill takes its own width, the date takes what is left, and at a
 * narrow width the line wraps rather than overlapping. `flex-shrink: 0` stays
 * on the CONTAINER — the meta column is still allowed to keep its size against
 * the title beside it.
 */
```

---

## F01 9.1 (2026-08-19): the cap follows the VIEWPORT as well as the design

<a id="f01-9-1-2026-08-19-the-cap-follows-the-viewport-as-well-as-the-design-62"></a>

```
/* F01 9.1 (2026-08-19): the cap follows the VIEWPORT as well as the design
     token, so a box on a short screen can always be placed whole and scrolls
     inside itself instead of running off the bottom. The `translate` that used
     to nudge it away from the cursor is GONE — that offset is now data
     (`anchorInViewport`’s offsetX/offsetY), because a transform the placement
     arithmetic cannot see is an offset it cannot clamp against. */
```

---

## F01 13.2: "we can make this box wider if necessary to accommodate" — the

<a id="f01-13-2-we-can-make-this-box-wider-if-necessary-to-accommodate-the-63"></a>

```
/* F01 13.2: "we can make this box wider if necessary to accommodate" — the
     author's own trade. Wider means fewer wrapped lines, which is the biggest
     saving available without touching a word or a type size. `width: 92%` keeps
     the phone case unchanged, where the viewport is the constraint anyway. */
```

---

## 6e2 (2026-08-15, the author, on BOTH desktop and phone): "the overlay's

<a id="6e2-2026-08-15-the-author-on-both-desktop-and-phone-the-overlay-s-64"></a>

```
/* 6e2 (2026-08-15, the author, on BOTH desktop and phone): "the overlay's
   type is too small even for good vision". The mission text is the product's
   opening argument and was set at 13px — under the type scale's Body rung and
   smaller than anything else a reader is asked to actually read. Both rungs
   move onto the committed scale: Display for the name, Body for the
   argument. */
```

---

## F01 13.2 (2026-08-19, the author): "The mission also can be shrunk

<a id="f01-13-2-2026-08-19-the-author-the-mission-also-can-be-shrunk-65"></a>

```
/* F01 13.2 (2026-08-19, the author): *"The mission also can be shrunk
   vertically. It's definitely too long on mobile... not in terms of what the
   words are saying, we just need to not even make the words smaller. We can
   make this box wider if necessary to accommodate but it's too vertically
   long."*

   Every constraint he set is kept. The WORDS are untouched —
   `tests/welcome-copy.test.ts` pins every sentence and still passes — and the
   TYPE SIZE is untouched at 0.9375rem, which 6e2 raised for a reason. What
   gives is the air: leading from 1.65 to 1.5, the gap between paragraphs from
   8px to 5px, and the space below the block from 26px to 18px. The card is
   wider too (see .welcome-card), which is the trade he offered — fewer wrapped
   lines is the largest single saving and it costs nothing but width. */
```

---

## THE JURISDICTION BADGE — M81

<a id="the-jurisdiction-badge-m81-66"></a>

```
/* ---------------------------------------------------------------------- *
 * THE JURISDICTION BADGE — M81.
 *
 * Three states, three registers. "Governs your area" is a positive claim and
 * is filled. The other two are NOT the same thing as each other and must not
 * look alike: "Nearby, different jurisdiction" is a real answer about a real
 * boundary and gets a quiet outline; "Boundary not published" is a NAMED GAP
 * and gets the dashed outline every named gap in this product wears, because
 * a colour is a claim too.
 * ---------------------------------------------------------------------- */
```

---

## FILLED, and deliberately not a tier colour. --accent-local is a TIER

<a id="filled-and-deliberately-not-a-tier-colour-accent-local-is-a-tier-67"></a>

```
/* FILLED, and deliberately not a tier colour. `--accent-local` is a TIER
   token and may only be read where the tier is the meaning; a jurisdiction is
   not a tier, and borrowing amber here would have said "local government"
   where the badge means "governs you". Caught by tests/amber-remnant.test.ts,
   which is exactly the guard that rule exists for.

   So the distinction is FILL versus OUTLINE rather than hue — the same
   grammar the status pills already use, and one a colour-blind reader can
   still use. */
```

---

## JUR-2 (2026-08-23). The zip could not settle this, so the pill does not

<a id="jur-2-2026-08-23-the-zip-could-not-settle-this-so-the-pill-does-not-68"></a>

```
/*
 * JUR-2 (2026-08-23). The zip could not settle this, so the pill does not
 * wear a settled pill's clothes. An OUTLINE where GOVERNS is filled, because
 * a colour is a claim too and the render-default rule says absence never
 * borrows a present value's styling.
 *
 * It is also the only one of the four that is an AFFORDANCE, so it says so —
 * a dotted underline and a pointer, the same vocabulary the could-govern pill
 * on the map panel already uses.
 */
```

---

## WHERE CAN I VOTE — B19's panel

<a id="where-can-i-vote-b19-s-panel-69"></a>

```
/* ---------------------------------------------------------------------- *
 * WHERE CAN I VOTE — B19's panel.
 *
 * Built on the committed tokens, never a new ad-hoc scale: surfaces, radii,
 * text colours and the violet accent all come from the variables above.
 * ---------------------------------------------------------------------- */
```

---

## F01 1e (2026-08-19, the author): "make the box pill-shaped, matching the

<a id="f01-1e-2026-08-19-the-author-make-the-box-pill-shaped-matching-the-70"></a>

```
/* F01 1e (2026-08-19, the author): "make the box pill-shaped, matching the
   pills beside it." This button sits in the same top band as the Ballot / zip
   / Ask cluster, and it was the one rounded-rectangle in a row of pills. The
   geometry now matches `.ask-pill` exactly — radius, min-height and vertical
   rhythm — while the voting accent stays, so it still reads as its own thing
   without reading as a different SHAPE of thing. */
```

---

## BAL-8 (2026-08-24) — "What's in it, part by part" COLLAPSES, and the control

<a id="bal-8-2026-08-24-what-s-in-it-part-by-part-collapses-and-the-control-71"></a>

```
/* ---------------------------------------------------------------------------
   BAL-8 (2026-08-24) — "What's in it, part by part" COLLAPSES, and the control
   is the voting pill's family because the author named that pattern by sight:
   light-purple, bolded, a right-pointing arrow.

   It is not `.voting-open-button` itself. That pill is a 44px call to action
   sitting alone in a card; this is a disclosure control repeated once per
   proposition down a page, and reusing the tap target verbatim would put three
   full-size buttons in a column and re-create the wall it exists to remove. It
   borrows the palette and the shape and takes its own size.
   --------------------------------------------------------------------------- */
```

---

## WHERE YOU VOTE (B19)

<a id="where-you-vote-b19-72"></a>

```
/*
 * WHERE YOU VOTE (B19).
 *
 * A different SHAPE as well as a different colour. Colour alone is not a
 * distinction a colour-blind reader can use, and this pin has to be
 * unmistakable against a meeting pin by the row's own spec — so it is a
 * teardrop with a hole, anchored at its point, where a meeting pin is a
 * round dot anchored at its centre.
 */
```

---

## A FANNED PIN SAYS IT MOVED (M19, 2026-08-17, the author's ruling: spiderfy)

<a id="a-fanned-pin-says-it-moved-m19-2026-08-17-the-author-s-ruling-spiderfy-73"></a>

```
/*
 * A FANNED PIN SAYS IT MOVED (M19, 2026-08-17, the author's ruling: spiderfy).
 *
 * The offset itself is MapLibre's, applied in screen pixels on every frame.
 * What CSS owns is the reason a reader is not misled by it: a pin sitting
 * somewhere other than its building is a WRONG LOCATION unless something says
 * otherwise, and this product does not get to be casually wrong about where a
 * government meets. The dashed halo is the "these have been moved apart to be
 * pickable" mark — deliberately not a colour, because colour on a pin already
 * means which level of government meets there and a second meaning would
 * corrupt the first.
 */
```

---

## F01 9.3 (2026-08-19, the author) — THE FAN READS AS A SPIDER

<a id="f01-9-3-2026-08-19-the-author-the-fan-reads-as-a-spider-74"></a>

```
/*
 * F01 9.3 (2026-08-19, the author) — THE FAN READS AS A SPIDER.
 *
 * *"When those are spidered it looks like it just simply is moving. It's not
 * like a spider effect... the spidering effect is not very clear at all."* His
 * before/after pair (Drive, 2026-08-18_14-29-42 and _14-30-01) differs only in
 * where two dots sit, which is exactly his complaint.
 *
 * The halo above says "this pin moved". It cannot say WHERE FROM, and that is
 * the missing half: without a visible origin the fan is indistinguishable from
 * two pins drifting apart. Each fanned pin now draws a LEG back to the shared
 * anchor, with the anchor dot on the leg's far end — N legs meeting at one
 * point, which is the shape that reads as "these all live here".
 *
 * `--spider-len` and `--spider-angle` are written per pin by `applySpiderfy`,
 * because only it knows the offset. They are custom properties and not a
 * transform on the element itself: MapLibre owns that transform and rewrites
 * it every frame, which is the same reason the offset goes through
 * `setOffset`. A pseudo-element's transform is ours alone.
 *
 * Under the dot in z-order and never interactive: a leg is an explanation, not
 * a target, and it must not steal the tap the fan exists to make possible.
 */
```

---

## NH144 — THIS RULE WAS THE FAN COLLAPSING, AND IT SAID relative

<a id="nh144-this-rule-was-the-fan-collapsing-and-it-said-relative-75"></a>

```
/*
 * **`NH144` — THIS RULE WAS THE FAN COLLAPSING, AND IT SAID `relative`.**
 * (Diagnosed and fixed 2026-08-24, the NJ depth session.)
 *
 * The legs need this element to be a containing block, which is all the rule
 * was ever for. `relative` gives that — and it also takes the marker OUT OF
 * MAPLIBRE'S ABSOLUTE POSITIONING and drops it into normal flow, where each
 * marker sits one pin-height below the previous sibling. MapLibre then applies
 * its transform ON TOP of that flow offset.
 *
 * Measured at 85701 against a local production build, a stack of four:
 *
 * | pin | MapLibre's transform | painted box | drift |
 * |---|---|---|---|
 * | 1st fanned | 764, 429 | 764, 429 | 0 |
 * | 2nd | 808, 475 | 808, 511 | +36 |
 * | 3rd | 859, 434 | 859, 506 | +72 |
 * | 4th | 822, 390 | 822, 498 | +108 |
 *
 * 36px is the pin's own height, and the drift is exactly one pin-height per
 * preceding sibling. The fan geometry was never wrong — `fanOffsets` puts four
 * pins on a 46px circle, 65px apart at the nearest pair — but two pairs landed
 * **19.1px apart on screen**, which is closer than they were before the fan.
 * That is the defect the fan exists to fix, reintroduced by the fan.
 *
 * `absolute` is what MapLibre sets on an unfanned marker (measured: computed
 * `position` is `absolute` on every pin until this rule fires), and it is
 * equally a containing block for the two pseudo-elements. So the legs keep
 * working and the marker keeps its own positioning.
 *
 * The walk check `g9` has been failing on this since it was written; it was
 * reported as carried-in and pre-existing, and it was a real reader-facing
 * defect the whole time.
 */
```

---

## ==========================================================================

<a id="note-76"></a>

```
/* ==========================================================================
   Popup card — the port of EdiaStratMap's `.popup-card`.

   Kept as plain CSS rather than Tailwind utilities because the measurements
   are the spec: 300px, 16px/18px padding, 55vh, a 5px scrollbar. Those are
   ported values, and burying them in a class string makes them look like
   choices somebody made here.
   ========================================================================== */
```

---

## BC-7 (2026-08-24) — THE SPURIOUS BLANK LINE, AND WHAT IT ACTUALLY WAS

<a id="bc-7-2026-08-24-the-spurious-blank-line-and-what-it-actually-was-77"></a>

```
/* ---------------------------------------------------------------------------
   BC-7 (2026-08-24) — THE SPURIOUS BLANK LINE, AND WHAT IT ACTUALLY WAS.

   The author red-boxed an empty band between "Upcoming 5" and "Who runs it" on
   the Tucson Unified small card (`12-06-33`). Nothing was rendering there. It
   is TWO RULES: the last `.popup-row` draws a `border-bottom`, and the section
   label immediately below draws a `border-top` 20px later, so the card shows a
   pair of hairlines with a band of nothing between them — which reads as a
   dropped row rather than as a divider.

   A row followed by a section label hands the divider to the label, which is
   the one that means something: the label IS the break. The `:last-child` rule
   above cannot reach this, because the row is not the last child — the section
   label is.
   --------------------------------------------------------------------------- */
```

---

## A 40px invisible touch target under the 14px dot

<a id="a-40px-invisible-touch-target-under-the-14px-dot-78"></a>

```
/* A 40px invisible touch target under the 14px dot.
 *
 * Ported from Edia's mobile block, and scoped there rather than applied at
 * every size. `pointer: coarse` is the honest condition: the problem is a
 * fingertip against a 14px dot, and a mouse is precise enough not to need the
 * help — while a 40px target on every pin makes neighbours overlap where
 * venues are close together.
 *
 * A note on how that was established, because the first version of this comment
 * got it wrong. Pins around downtown Tucson *do* overlap and swallow each
 * other's clicks, which a headless capture surfaced as one marker intercepting
 * pointer events for another — but that happens with or without this rule, at
 * 14px, because two venues sit within a few metres on screen. The overlap is
 * real and is tracker M19; it is not caused by this block. */
```

---

## ==========================================================================

<a id="note-79"></a>

```
/* ==========================================================================
   Phone width — Phase 8, no longer deferred: the demo is opened on a phone.

   Below Tailwind's `sm` (640px) the fixed 340px sidebar would eat the
   screen, so it becomes a slide-over drawer behind a 44px toggle, and the
   map takes the full width (the companion left-0/sm:left-[340px] classes
   live in map-entry.tsx). The page itself never scrolls — the map owns its
   gestures — which is why every tall surface here scrolls internally.
   ========================================================================== */
```

---

## The legend was hidden at phone width while every pin shared one color

<a id="the-legend-was-hidden-at-phone-width-while-every-pin-shared-one-color-80"></a>

```
/* The legend was hidden at phone width while every pin shared one color.
     With dots colored by government level (2g) the mapping is no longer
     learnable from the pins alone, so the legend returns in compact form:
     one slim row, raised above the attribution line. The bottom sheet may
     cover it while a venue is open — the sheet is the reader's current
     focus, and the legend is one tap of the close button away. */
```

---

## Item 5 (2026-08-15, the author's production pass): "the sidebar footer

<a id="item-5-2026-08-15-the-author-s-production-pass-the-sidebar-footer-81"></a>

```
/* Item 5 (2026-08-15, the author's production pass): "the sidebar footer
     collides with the map legend at mobile width."

     Measured before touching it, and the diagnosis is not what the report
     said — nothing about the FOOTER is special. The legend is `position:
     fixed` at z-1100 and the drawer is z-1000, so at 390px the legend paints
     over WHATEVER part of the drawer it happens to land on: at the author's
     scroll position that was the footer, at ours it was the DATE RANGE
     heading. A fix aimed at the footer would have moved the collision rather
     than ending it.

     The legend explains the pin colours on a map the open drawer is
     covering. So it goes away while the drawer is open and comes back when
     the reader closes it — the honest fix, and the only one that holds at
     every scroll position. `pnpm overlaps` walks all of them. */
```

---

## ==========================================================================

<a id="note-82"></a>

```
/* ==========================================================================
   The map overlay stack — items 2 and 3 of the tester's mobile pass
   (2026-08-14). Measured at 390×844 before the fix: the bottom stack had no
   upper bound, the who-governs card reached 893px against an 844px
   viewport, and its top sat at y = −113. The ballot bubble rendered at y=12
   and was painted over by it (the tester: "the floater never appears"); the
   count badge sat at y = −166; the card's own minimize control at y = −104.
   Meanwhile the two fixed controls that DO stay above everything — the
   hamburger at (12,12,44×44) and MapLibre's zoom column at (349,0,41×70) —
   sat on top of card text.

   Both are the same defect: an unbounded overlay in a bounded viewport. The
   band below reserves the top strip for the fixed controls and the ballot
   entry, and the card is held inside what is left over.
   ========================================================================== */
```

---

## The bottom counterpart of the control band (4c, 2026-08-15)

<a id="the-bottom-counterpart-of-the-control-band-4c-2026-08-15-83"></a>

```
/* The bottom counterpart of the control band (4c, 2026-08-15).
     `--map-legend-bottom` is where the legend sits above the attribution
     line; `--map-legend-height` is the slim phone row's measured height
     (5px padding, an 8px label, 5px padding, plus its border). Both are
     named because TWO rules depend on them: the legend's own placement, and
     the bottom stack's reserved gutter. The author's production pass found
     the sidebar footer's "Last checked" line painted under the legend at
     390px — the legend is z-1100 ambient chrome, so it simply covered the
     text. One number in two places is how that happens; one name in two
     places is how it stops. */
```

---

## At phone width the legend is raised clear of the map attribution line

<a id="at-phone-width-the-legend-is-raised-clear-of-the-map-attribution-line-84"></a>

```
/* At phone width the legend is raised clear of the map attribution line.
   Declared here, AFTER the base :root above, because custom properties at
   equal specificity are decided by source order — the first attempt at this
   fix put the override earlier in the file, it lost silently, and the legend
   stayed exactly where it was. Measured, not assumed. */
```

---

## F01 7.3 (2026-08-19), caught by MEASURING rather than by looking

<a id="f01-7-3-2026-08-19-caught-by-measuring-rather-than-by-looking-85"></a>

```
/* F01 7.3 (2026-08-19), caught by MEASURING rather than by looking.

   The row is `justify-end` and did not wrap, so its first child overflowed to
   the LEFT the moment the row's content exceeded the band. Measured at 390×844
   with a battlecard open: the pill cluster sat at x = −8, under the hamburger
   and under the new map reset.

   The trigger was F01 1e in this same session — making "Where can I vote?"
   pill-shaped gave it a 44px min-height and wider padding, and the row it
   shares had no slack left. That is worth saying plainly: a change to one
   control's SHAPE moved a different control off the screen, and nothing in
   either change would have shown it. `pnpm overlaps` and this measurement are
   the only instruments that catch this class.

   Wrapping is the same answer G07 reached for the cluster's own row when its
   label got longer: the corner has vertical room and does not have horizontal
   room. `justify-end` is kept so wrapped lines stay right-aligned against the
   zoom column. */
```

---

## A definite top gives the stack a definite height, which is what makes the

<a id="a-definite-top-gives-the-stack-a-definite-height-which-is-what-makes-the-86"></a>

```
/* A definite top gives the stack a definite height, which is what makes the
   shrink above possible at all — and it is the reserved gutter that keeps
   every top-strip control off readable content.

   **At every width, since 2026-08-15 (4c).** This lived inside a
   `max-width: 639px` query because the defect that produced it was found on
   a phone, and the scoping quietly assumed a desktop viewport is always
   taller than the card. It is not: the author's production pass caught the
   New Hampshire who-governs card at 03255 running off the top at desktop,
   and measuring it at 1280×800 gave the same signature as the phone bug —
   the stack 1072px tall against an 800px viewport, its top at y = −272.
   A bound that only holds at one width is not a bound; it is a coincidence
   that happens to be true on the machine somebody tested on. */
```

---

## The gutter the LEGEND needs, the bottom counterpart of the band above

<a id="the-gutter-the-legend-needs-the-bottom-counterpart-of-the-band-above-87"></a>

```
/* The gutter the LEGEND needs, the bottom counterpart of the band above.
   The stack's own `pb-9` cleared the map attribution and nothing else, so
   the last line in the stack — the "Last checked" footnote — landed under
   the legend, which is ambient chrome at z-1100 and simply painted over it
   (the author's production pass, 390px). Computed from the legend's own two
   numbers, so a taller legend pushes the text up instead of hiding it.
   `!important` because this competes with a Tailwind padding utility on the
   same element and losing that race is precisely how the first attempt at
   this fix passed review and changed nothing. */
```

---

## F01 12.1 (2026-08-19, the author) — THE PICKS CARD AS A PHONE

<a id="f01-12-1-2026-08-19-the-author-the-picks-card-as-a-phone-88"></a>

```
/* F01 12.1 (2026-08-19, the author) — THE PICKS CARD AS A PHONE.

   *"It should pop up as if it's its own phone kind of screenshot, rounded at
   the edges, so that I can still see the background."*

   A bezel, not a decoration: the frame is what tells the reader the thing
   inside is a PICTURE they are about to take out of the app, rather than
   another panel of the app. The inner image keeps its own rounding so the
   screenshot itself looks like a screenshot, and the frame's padding is the
   bezel. It scrolls inside itself on a short screen — a card with twelve picks
   on it is taller than a phone. */
```

---

## BESIDE the hamburger, not under it. Measured at 390×844 before this moved

<a id="beside-the-hamburger-not-under-it-measured-at-390-844-before-this-moved-89"></a>

```
/* BESIDE the hamburger, not under it. Measured at 390×844 before this moved:
   at top: 62px the 32px button ran from y 62 to 94 and the count badge starts
   at y 88 — a six-pixel overlap, the new control sitting on an existing one.
   `pnpm overlaps` exists because this class of defect is invisible in code and
   obvious in a measurement. 18px top centres the 32px button against the 44px
   hamburger; 64px left clears it with the same 8px gutter the pills use. */
```

---

## F01 7.3: the top row starts AFTER the fixed control band, whenever that band

<a id="f01-7-3-the-top-row-starts-after-the-fixed-control-band-whenever-that-band-90"></a>

```
/* F01 7.3: the top row starts AFTER the fixed control band, whenever that band
   is on screen. The hamburger and the reset are absolutely positioned and take
   no space in the flow, so a right-aligned row that wrapped to two lines put
   its second line straight under them — measured, 28px of overlap at 390px.
   104px is the reset's right edge (96) plus the 8px gutter the pills use. The
   rule is bound to the SAME condition that shows the controls, so the padding
   cannot outlive them. */
```

---

## F01 2.5 (2026-08-19, the author): "those need to be fully in view at all

<a id="f01-2-5-2026-08-19-the-author-those-need-to-be-fully-in-view-at-all-91"></a>

```
/* F01 2.5 (2026-08-19, the author): "those need to be fully in view at all
   times."
 *
 * The header and the tab row are FIXED furniture in a flex column whose body
 * scrolls — but neither declared `flex-shrink: 0`, so the flexbox default of
 * `flex-shrink: 1` let a tall Meetings list squeeze them. The tab row kept its
 * labels and lost its height, and the first meeting painted over the bottom
 * half of "Overview / Representation / Activity / Notes / Sources". A fixed
 * row that can be compressed is not fixed. Both now refuse to shrink, so the
 * only thing that scrolls is the thing that is supposed to.
 *
 * This is the class, not the instance: the same two lines are applied to the
 * official card's header and pill rail below, which is the same shape. */
```

---

## WHICH LINE? — R39, 2026-08-17, the author's production feedback

<a id="which-line-r39-2026-08-17-the-author-s-production-feedback-92"></a>

```
/*
 * WHICH LINE? — R39, 2026-08-17, the author's production feedback.
 *
 * The multi-number phone chooser. It sits OVER the battlecard rather than
 * replacing it, so its z-index is one band above `.account-modal-overlay`'s
 * 1300; dismissing it leaves the card exactly where it was.
 *
 * Deliberately its own small dialog rather than a reuse of `.account-modal`:
 * that one is a 680px tabbed surface with a max-height near the whole
 * viewport, and a list of three phone numbers inside it would read as a page
 * that failed to load. This is sized to its content and centred.
 */
```

---

## The state extrusion's mute-and-blur (g3 item 10, M91 — the author's design

<a id="the-state-extrusion-s-mute-and-blur-g3-item-10-m91-the-author-s-design-93"></a>

```
/*
 * The state extrusion's mute-and-blur (g3 item 10, M91 — the author's design,
 * against his neumorphism reference).
 *
 * The raised EDGE is map layers (lib/map/state-focus.ts). This is the other
 * half: everything OUTSIDE the active state is muted in colour and very
 * slightly blurred, so the state reads as pushed up out of the same material
 * rather than as a card floating over it.
 *
 * `backdrop-filter` is the only thing that can blur what is painted
 * underneath it — a WebGL layer cannot, which is why this is DOM and not a
 * MapLibre fill. The blur is deliberately tiny: 1.1px is what "very slightly"
 * costs, and it is the knob to turn if a device struggles. The effect itself
 * never turns off — the author's test is that it holds at every zoom.
 *
 * `pointer-events: none` is load-bearing: this covers most of the viewport
 * and the map underneath must stay fully draggable and clickable through it.
 *
 * The scrim is ambient and carries NO information (the reference's own
 * accessibility caution). It is light enough that place labels in the muted
 * area stay readable, and it is identical in both themes' intent — a scrim
 * the colour of the page's own ground, so nothing outside picks up a hue the
 * map did not have.
 */
```

---

## The rise itself (g4 item 2). Two blurred silhouettes of the state, masked

<a id="the-rise-itself-g4-item-2-two-blurred-silhouettes-of-the-state-masked-94"></a>

```
/*
 * The rise itself (g4 item 2). Two blurred silhouettes of the state, masked
 * to the outside — see components/map/state-focus-overlay.tsx for why a
 * shadow cast by the shape replaced the two line layers that read as a grey
 * stroke.
 *
 * Sized in JS to the map's box and positioned at its origin, because the
 * coordinates inside it are `map.project()` output and must not be rescaled
 * by any CSS sizing of the SVG element.
 */
```

---

## BELOW every piece of chrome, above the terrain

<a id="below-every-piece-of-chrome-above-the-terrain-95"></a>

```
/*
   * BELOW every piece of chrome, above the terrain.
   *
   * Measured, not guessed. At z-index 5 this sat over `.map-bottom-stack`
   * (z-index 1) and the first screenshot pair came back with the count badge,
   * the freshness line and the WHO GOVERNS HERE floater all softly blurred —
   * an ambient effect degrading the controls, which is the reference's own
   * accessibility warning happening in practice. Zero puts it above the map
   * canvas (a sibling earlier in the same wrapper, z-index auto) and under
   * everything positive: the bottom stack at 1, the legend at 1100, the
   * cards above that.
   */
```

---

## Blur and desaturation ONLY. The mute's colour moved into the SVG

<a id="blur-and-desaturation-only-the-mute-s-colour-moved-into-the-svg-96"></a>

```
/* Blur and desaturation ONLY. The mute's colour moved into the SVG
     (state-focus-overlay.tsx) so its edge can be feathered by the same mask
     the shadows use; this element keeps the two things only the compositor
     can do, and both are gentle enough that its hard clip no longer reads as
     a line. */
```

---

## A reader who has asked for less motion has not asked for less contrast, and

<a id="a-reader-who-has-asked-for-less-motion-has-not-asked-for-less-contrast-and-97"></a>

```
/*
 * A reader who has asked for less motion has not asked for less contrast, and
 * this effect does not animate — so it stays. But a reader who has asked for
 * MORE contrast has asked for exactly the thing an ambient scrim reduces, and
 * the scrim carries no information, so it is the right thing to drop.
 */
```

---

## The border-crossing prompt (e's 6b2, built in g3 item 10)

<a id="the-border-crossing-prompt-e-s-6b2-built-in-g3-item-10-98"></a>

```
/*
 * The border-crossing prompt (e's 6b2, built in g3 item 10).
 *
 * A card, not a modal: it sits above the map and the reader can keep panning
 * underneath it. The doctrine is "quiet within a state, explicit between
 * states" — explicit, not blocking.
 *
 * z-index sits above the state-focus scrim (5) and below the who-governs
 * card's own stack, so it never buries the answer it is annotating.
 */
```

---

## THE ADDRESS PROMPT — one component, every surface (WGH-5, 2026-08-22)

<a id="the-address-prompt-one-component-every-surface-wgh-5-2026-08-22-99"></a>

```
/* ---------------------------------------------------------------------------
   THE ADDRESS PROMPT — one component, every surface (WGH-5, 2026-08-22).

   Replaces two divergent implementations of the same feature: the map's
   narrowing chip and the ballot's bottom box, which disagreed on the screen
   about whether a house number was ever needed.

   Dashed borders mean DEVICE-LOCAL in this system, and that is exactly what a
   resolved address is here: it lives in one tab, in sessionStorage, and is
   stored nowhere else.
   --------------------------------------------------------------------------- */
```

---

## WGH-1 (2026-08-22) — the ROW MARK and the ONE NOTICE

<a id="wgh-1-2026-08-22-the-row-mark-and-the-one-notice-100"></a>

```
/* ---------------------------------------------------------------------------
   WGH-1 (2026-08-22) — the ROW MARK and the ONE NOTICE.

   Who Governs Here used to print the whole sentence "Could govern you — add
   your address to confirm" on every affected row. At 12 bodies that was noise;
   the registry now holds 174, and the repetition is what made the product look
   like it was ballparking — the author's headline UX finding of the New Jersey
   pass, not a cosmetic note.

   So the rows carry a mark and the sentence is said once. The mark is the LINK
   colour, not a warning colour and not the named-gap register: nothing here is
   absent and nothing here is wrong. It is an offer.
   --------------------------------------------------------------------------- */
```

---

## The action half is never hidden, at any width. The first version of the old

<a id="the-action-half-is-never-hidden-at-any-width-the-first-version-of-the-old-101"></a>

```
/* The action half is never hidden, at any width. The first version of the old
   pill dropped it under 460px and a production capture read as an image showed
   the result: "Could govern you" alone beside a body's name, which is the bare
   uncertainty marker RULING 44 deleted rather than the offer RULING 71
   specifies. It wraps instead. */
```

---

## MTG-5 — "Make your voice heard", collapsed (2026-08-23)

<a id="mtg-5-make-your-voice-heard-collapsed-2026-08-23-102"></a>

```
/* ---------------------------------------------------------------------- *
 * MTG-5 — "Make your voice heard", collapsed (2026-08-23)
 *
 * The block runs to four or five paragraphs on the bodies that publish
 * proper standing rules, and it sat between the reader and the next meeting
 * date on every card. The content is unchanged; it waits to be asked for.
 * ---------------------------------------------------------------------- */
```

---

## JUR-4 (2026-08-23) — the jurisdiction answer, once per group

<a id="jur-4-2026-08-23-the-jurisdiction-answer-once-per-group-103"></a>

```
/*
 * JUR-4 (2026-08-23) — the jurisdiction answer, once per group.
 *
 * Nineteen consecutive rows under one heading each carried "Could govern you",
 * which is the repetition the author named the headline UX problem of the New
 * Jersey pass. It sits under the group heading now, where it is one deliberate
 * annotation rather than a tic.
 */
```

---

## LBL-2 — LETTER-SPACED UPPERCASE LOSES ITS LAST LETTER AT AN EDGE

<a id="lbl-2-letter-spaced-uppercase-loses-its-last-letter-at-an-edge-104"></a>

```
/* ---------------------------------------------------------------------- *
 * LBL-2 — LETTER-SPACED UPPERCASE LOSES ITS LAST LETTER AT AN EDGE
 * (`VF03`, reopened 2026-08-23 under RULING 97.)
 *
 * `letter-spacing` adds its space AFTER the final glyph, not between glyphs
 * only. A run set at `0.15em` is therefore about one seventh of a character
 * wider than the characters in it, and every one of that width lands past the
 * last letter. Wherever such a run meets a right edge that clips — a flex item
 * at its container's boundary, an `overflow: hidden` ancestor, a rounded pill
 * — the clip takes the trailing space first and then bites into the glyph. The
 * result reads exactly as the author described it: the role loses its final
 * letter.
 *
 * The compensation is the standard one and it is not a nudge: the trailing
 * space is REMOVED from the layout box with a negative margin equal to the
 * tracking, so the box is the width of the glyphs it contains. Nothing moves
 * visually except that the last letter now has room.
 *
 * Applied at the shared classes rather than at the one row the author saw,
 * because the cause is the tracking and every letter-spaced uppercase run in
 * this product has it. `tests/label-tracking.test.ts` sweeps for new ones.
 * ---------------------------------------------------------------------- */
```

---

## OFF-2 (2026-08-24) — THE SAME DEFECT, OUTSIDE THE SWEPT CLASS

<a id="off-2-2026-08-24-the-same-defect-outside-the-swept-class-105"></a>

```
/* ---------------------------------------------------------------------------
   OFF-2 (2026-08-24) — THE SAME DEFECT, OUTSIDE THE SWEPT CLASS.

   THE RECONCILIATION, because the brief asks for it rather than for a fix.
   `LBL-2` was closed 2026-08-23 at "6 found, 6 fixed" and it did NOT regress:
   all six still carry their compensation. What was wrong was the PREDICATE.
   It tested for `shrink-0` ON THE ELEMENT — one way of pinning a run against a
   container's right edge — and the author's 8/24 capture `12-06-33` shows the
   role column clipped on the TUSD small card, where the run is pinned by its
   PARENT instead: `.person-row` is `justify-content: flex-end`, in this
   stylesheet, where a line-based grep over `.tsx` cannot see it.

   Measured: 23 letter-spaced runs in `app/` and `components/`; 6 inside the
   old predicate, 17 outside it and uncompensated — including all four
   `.source-tag` sites, one of which is the row he photographed.

   SO THE PREDICATE IS RETIRED RATHER THAN WIDENED. Every way of pinning an
   element at an edge would have to be enumerated, and the next one nobody
   thought of would be the next `OFF-2`. The physics does not need the
   enumeration: `letter-spacing` adds its space after the FINAL glyph, always,
   so that space is spurious on every uppercase letter-spaced run whether or
   not anything clips it today. Compensating unconditionally has no blind spot
   to have.

   One utility per tracking value in use, so the trim MATCHES its run — a
   -0.15em compensation on a 0.1em run would pull the label 0.05em into
   whatever precedes it, which is a smaller version of the same carelessness.
   --------------------------------------------------------------------------- */
```

---

## LBL-2, THIRD PASS (2026-08-25) — THE PREDICATE COULD NOT SEE 0.2em, AND HAD

<a id="lbl-2-third-pass-2026-08-25-the-predicate-could-not-see-0-2em-and-had-106"></a>

```
/* ---------------------------------------------------------------------------
   LBL-2, THIRD PASS (2026-08-25) — THE PREDICATE COULD NOT SEE 0.2em, AND HAD
   NEVER READ THIS FILE.

   Every `margin-inline-end: -Xem` beside a `letter-spacing: X` in this
   stylesheet is one of these: the tracking's space sits past the final glyph,
   so any clipping right edge takes the space and then the letter.

   Measured on adoption — 41 inline runs in `app/`+`components/`, 20 visible to
   the old `0.1[0-9]*em` predicate and 21 not; 38 letter-spaced selectors here,
   4 compensated and 14 at 0.05em or more with none. The reconciliation, the
   two named exemptions and their reasons are in
   `tests/label-tracking.test.ts`, which is where they are enforced.
   --------------------------------------------------------------------------- */
```

---

## LAY-4 / LAY-3 (2026-08-24, the author's annotated capture 11-55-29)

<a id="lay-4-lay-3-2026-08-24-the-author-s-annotated-capture-11-55-29-107"></a>

```
/* ---------------------------------------------------------------------------
   LAY-4 / LAY-3 (2026-08-24, the author's annotated capture 11-55-29) —
   THE FLOATING CARDS BELONG UNDER THE RAIL, AND THE COLUMN IS WHAT PROVES
   THEY CANNOT COLLIDE.

   **LAY-1 IS SUPERSEDED AND ITS CSS IS DELETED RATHER THAN LEFT DARK.**
   .sidebar-wgh, .sidebar-wgh-pill and the .stats-collapsed family were
   the nesting build of 2026-08-23: the who-governs card inside the rail's
   scrolling column, one card expanded at a time, the other a pill IN the rail.
   The author's arrows say the cards float BENEATH the rail, and the 8/24
   brief's supersession table says LAY-1 must not exist as built. A superseded
   rule kept as dead CSS is how it comes back as drift.

   THE CONSTRUCTION, and why it is a flex column rather than a measured bound.
   LAY-3 asks that nothing overlap the rail or anything else at any tested
   viewport. Every previous answer here was a NUMBER — a max-height, a top
   band, a reserved gutter — and every one of them held until the content
   changed underneath it. The who-governs card went from 12 bodies to 174 in
   one hunt. Flex children of one fixed column cannot be laid out on top of
   each other at ANY viewport, at any content length, with no number to keep
   current. That is the whole reason for this wrapper.

   The rail shrinks first (flex-shrink 2 against 1) because the floaters
   carry the answer the reader came for; both shrink to their own scroll
   rather than overflowing, so neither can grow off the top of the screen —
   the M54/M55 failure, which is what the child-combinator rules below bind
   against here exactly as they do in .map-bottom-stack.
   --------------------------------------------------------------------------- */
```

---

## WGH-6 (2026-08-24) — WITH THE RAIL MINIMIZED, THE CARD TAKES THE SPACE

<a id="wgh-6-2026-08-24-with-the-rail-minimized-the-card-takes-the-space-108"></a>

```
/* ---------------------------------------------------------------------------
   WGH-6 (2026-08-24) — WITH THE RAIL MINIMIZED, THE CARD TAKES THE SPACE.

   The author, on the 07866 panel (`12-21-07`): clicking Who Governs Here
   minimizes the sidebar and the card takes over that space, WIDE ENOUGH THAT
   EVERY ENTRY FITS ON ONE LINE — he named "Morris Hills Regional School
   District", which wraps to two lines in that capture with its
   SCHOOL DISTRICT type label beside it.

   That is NH-1's one-line requirement, and this is the mechanism that makes it
   possible: the requirement was unmeetable at the rail's 340px because the
   longest body name and its type label do not fit, and no amount of type
   tuning changes that without shrinking the name.

   The width is a token so the row's own measurement and this rule read ONE
   number — the pair that has to agree cannot be written twice (`4c`'s lesson).
   Capped against the viewport so a narrow laptop gets a card it can see rather
   than one that runs off the edge.
   --------------------------------------------------------------------------- */
```

---

## WGH-8 (2026-08-25) — THEY SWAP, THEY DO NOT DIFFER

<a id="wgh-8-2026-08-25-they-swap-they-do-not-differ-109"></a>

```
/* ---------------------------------------------------------------------------
   WGH-8 (2026-08-25) — THEY SWAP, THEY DO NOT DIFFER.

   The author: *"If WGH needs more width, the sidebar matches it — they swap,
   they don't differ."* So the width is a property of the COLUMN and not of
   whichever surface is currently in it, and the `data-sidebar="closed"`
   conditional that used to carry it is gone.

   What that conditional produced is visible in his `08-47-35`: the rail at
   340px, then a 460px card appearing where it had been, so the left edge of
   the page moved when he clicked a pill. One width, one edge, no movement.
   --------------------------------------------------------------------------- */
```

---

## WHICH CHILD YIELDS, and the first version of this got it backwards

<a id="which-child-yields-and-the-first-version-of-this-got-it-backwards-110"></a>

```
/*
 * **WHICH CHILD YIELDS, and the first version of this got it backwards.**
 *
 * It gave the rail `flex-shrink: 2` against the floaters' 1, reasoning that the
 * floaters carry the answer the reader came for. Read as an image at 1440×900
 * the result was the rail SQUEEZED TO 230px with its stat tiles sliced through
 * the middle — half a "60" and no "147 Meetings" — while the who-governs card
 * below it had room to spare.
 *
 * The reasoning was fine and the arithmetic was the problem: the who-governs
 * card is 500px+ at a covered zip and it ALREADY SCROLLS INSIDE ITSELF, so
 * giving it priority costs the rail real content to buy the card space it does
 * not need. The rail's top is the treatment the author named as the reference
 * — the Ballot pill, the zip, the Ask line, the four tiles — and clipping it
 * mid-tile is the one outcome LAY-5 exists to prevent.
 *
 * So the rail keeps its content height up to a CEILING and the floaters take
 * the rest. The ceiling is a PROPORTION rather than a pixel count on purpose:
 * a pixel budget is a number that drifts the moment a section is added to the
 * rail, and a proportion holds at any viewport and any content length.
 */
```

---

## LAY-7 (2026-08-25): THE RAIL GROWS TO THE FOOT OF THE COLUMN

<a id="lay-7-2026-08-25-the-rail-grows-to-the-foot-of-the-column-111"></a>

```
/*
   * **LAY-7 (2026-08-25): THE RAIL GROWS TO THE FOOT OF THE COLUMN.**
   *
   * The author extended its red rectangle down past its own bottom edge in
   * `08-53-15`, with the two pills sitting BELOW the rectangle. So the rail
   * takes the remainder and the floaters take their content height — the
   * reverse of what this rule used to say, and only safe now because the
   * who-governs card is no longer in the column beside it.
   *
   * It still NEVER SHRINKS below its content: the `0` shrink factor is kept
   * from the previous version and its reason has not expired. A shrink factor
   * of 1 let the floaters' own content push the rail to 340px against 662px
   * and sliced its stat tiles through the middle — measured at 1440x900, not
   * guessed.
   */
```

---

## 58%, and the number is a JUDGEMENT that is stated rather than hidden

<a id="58-and-the-number-is-a-judgement-that-is-stated-rather-than-hidden-112"></a>

```
/*
   * **58%, and the number is a JUDGEMENT that is stated rather than hidden.**
   *
   * At 1440x900 the rail wants 662px and the who-governs card wants 350px or
   * more, against 876px of column. They do not both fit, so something is
   * always scrolling and the only question is which.
   *
   * 70% gave the rail everything and left the card 100px — less than its own
   * header — which is a card that is present and unusable. 58% leaves the rail
   * showing its top treatment through the Filters row with the footer
   * scrolling, and leaves the card enough to read. Both scroll internally, so
   * nothing is unreachable either way.
   *
   * **THE 58% CEILING IS GONE (LAY-7 / WGH-8, 2026-08-25), AND SO IS THE
   * PROBLEM IT WAS SOLVING.**
   *
   * Everything above was correct arithmetic about a state that no longer
   * exists. It reads *"the cramped-both state is the DEFAULT rather than the
   * answer"* — and the author's answer to that is that there is no both. The
   * rail and the who-governs card are now mutually exclusive at every width
   * (`map-entry.tsx`, `sidebarUp`), so nothing is competing for this column
   * and there is nothing left to apportion.
   *
   * His `08-53-15` draws the rail's red rectangle extended DOWN past its own
   * bottom edge to the foot of the viewport. That is this line: the rail takes
   * the column.
   *
   * `NH167` — *"58% is a judgement that wants a second look"* — is answered by
   * deletion rather than by a better number, which is the outcome that row was
   * hoping for.
   *
   * It still SCROLLS when it has to. LAY-9 asks that the collapsed state not
   * scroll internally, and at full height it does not; with Filters open the
   * rail is legitimately longer than the viewport and the author accepted
   * scrolling there.
   */
```

---

## The region the author's two arrows point into: under the rail, the rail's

<a id="the-region-the-author-s-two-arrows-point-into-under-the-rail-the-rail-s-113"></a>

```
/* The region the author's two arrows point into: under the rail, the rail's
   own width, the bottom of the viewport. margin-top: auto is what puts it
   at the BOTTOM of the column rather than immediately under the rail — which
   is where both arrows land, and where the count chip already sat before this
   change moved it left out of the map. */
```

---

## Takes whatever the rail leaves, and scrolls its own card rather than

<a id="takes-whatever-the-rail-leaves-and-scrolls-its-own-card-rather-than-114"></a>

```
/* Takes whatever the rail leaves, and scrolls its own card rather than
     pushing the rail out of the way. `justify-content: flex-end` is what puts
     the group at the BOTTOM of the space — where both of the author's arrows
     land — now that `margin-top: auto` has nothing left to push against. */
```

---

## LAY-7 (2026-08-25): the floaters take their CONTENT height and the rail

<a id="lay-7-2026-08-25-the-floaters-take-their-content-height-and-the-rail-115"></a>

```
/*
   * LAY-7 (2026-08-25): the floaters take their CONTENT height and the rail
   * takes the remainder. Basis zero was correct while the who-governs card
   * lived here beside a capped rail; with the card and the rail now mutually
   * exclusive, a basis of zero would leave the two pills floating in the
   * middle of a column the rail had already claimed.
   *
   * It still grows when it is the only thing in the column — which is exactly
   * the who-governs-open state, where the card wants every pixel.
   */
```

---

## LAY-7 (2026-08-25) — WHICH CHILD TAKES THE REMAINDER DEPENDS ON WHICH

<a id="lay-7-2026-08-25-which-child-takes-the-remainder-depends-on-which-116"></a>

```
/* ---------------------------------------------------------------------------
   LAY-7 (2026-08-25) — WHICH CHILD TAKES THE REMAINDER DEPENDS ON WHICH
   SURFACE IS UP, AND IT IS STATED RATHER THAN INFERRED.

   The first attempt gave BOTH children a grow factor, on the reasoning that
   the rail should reach the foot and the card should too. They then split the
   free space between them and the rail came up 229px short at 1440x900 —
   measured, which is the only reason it was caught.

   There is no single pair of flex factors that is right in both states,
   because the two states want opposite things:

     rail up   — the rail takes the remainder, the two pills take their
                 content height and sit BELOW it, which is where the author
                 drew them in `08-53-15`.
     card up   — the floaters take the whole column, because the card is the
                 only thing in it.

   `data-sidebar` already carries which state we are in, and `map-entry.tsx`
   derives it from the exclusion so it cannot disagree with what is painted.
   Keying on it says the thing directly instead of hoping one set of factors
   happens to produce both outcomes.
   --------------------------------------------------------------------------- */
```

---

## A HIDDEN RAIL STILL TAKES ITS FLEX SHARE, and that is what kept the card

<a id="a-hidden-rail-still-takes-its-flex-share-and-that-is-what-kept-the-card-117"></a>

```
/*
 * **A HIDDEN RAIL STILL TAKES ITS FLEX SHARE, and that is what kept the card
 * at 186px in a 876px column.**
 *
 * The rail is hidden with `transform` and `visibility: hidden` — never
 * `display: none`, because it slides. Both of those PRESERVE LAYOUT, so with
 * `flex-grow: 1` on the base rule the invisible rail went on claiming the
 * remainder and the who-governs card was left with the scraps.
 *
 * This is the same fact that made the first version of the verification
 * shooter report "both surfaces up" — an off-screen rail is still a laid-out
 * box, in the stylesheet exactly as in getBoundingClientRect. Zero basis and
 * no grow is what actually takes it out of the main axis while leaving the
 * transform free to animate.
 */
```

---

## ...AND THE FLOATERS THEN START AT THE TOP OF THE COLUMN, WHERE THE

<a id="and-the-floaters-then-start-at-the-top-of-the-column-where-the-118"></a>

```
/*
 * ...AND THE FLOATERS THEN START AT THE TOP OF THE COLUMN, WHERE THE
 * HAMBURGER IS.
 *
 * With the rail out of the main axis the who-governs card takes the whole
 * column, which pushes the meetings pill above it to y=24 — directly under the
 * 44px hamburger and the reset button beside it. Two controls in one place,
 * one of them unclickable.
 *
 * The gutter is computed from the controls it clears rather than typed as a
 * number: they are the same rail inset plus the hamburger, so a change to
 * either moves this with it instead of leaving it a stale constant.
 */
```

---

## ...AND SO DOES THE CARD INSIDE IT. Giving the region the column was not

<a id="and-so-does-the-card-inside-it-giving-the-region-the-column-was-not-119"></a>

```
/*
 * ...AND SO DOES THE CARD INSIDE IT. Giving the region the column was not
 * enough: `.rail-floaters` is `justify-content: flex-end`, so a
 * content-height card sat at the BOTTOM of a full-height region, ~180px tall
 * and clipped mid-sentence — "We watch all of their calendars" cut off after
 * "their".
 *
 * **Every DOM number said this was fine.** The card bottom was 105px above the
 * column foot, which is the reserved legend gutter and exactly right; the card
 * width equalled the column width; nothing scrolled sideways. The defect was
 * at the card TOP, which nothing was measuring — and only reading the capture
 * as an image caught it. That is the read-as-an-image rule earning its place
 * inside the session that wrote RULING 153 about this exact failure.
 */
```

---

## LAY-2 (item 4, 2026-08-23) — THE FILTER PANEL WAS OFF-CENTRE, AND THIS IS

<a id="lay-2-item-4-2026-08-23-the-filter-panel-was-off-centre-and-this-is-120"></a>

```
/* ---------------------------------------------------------------------------
   LAY-2 (item 4, 2026-08-23) — THE FILTER PANEL WAS OFF-CENTRE, AND THIS IS
   WHY.

   The author's words: *the filter panel is off-center and crammed — coverage
   block, body-type block, meeting status, date range, district types and the
   coverage-quality toggle all competing.*

   The off-centre half was not a judgement call, it was arithmetic.
   `.filters-area` carries `padding: 14px 22px 20px`, and the two controls that
   moved inside it in g4 item 14 — the radius slider and the districts toggle —
   are `.prox-control`, which carries its own `padding: 10px 22px` from the days
   when it sat loose in the rail. Nested, they inset 44px while every group
   label beside them inset 22px, and the panel read as two columns that did not
   line up. Zeroing the horizontal padding for the nested case aligns every
   control in the panel to one left edge.

   Their bottom rule goes with it: a full-width divider drawn 22px inside a
   panel that is already ruled at its own edge is a second grid asserting
   itself over the first.

   The crammed half is `openWhenNarrowed` in `filters-area.tsx` — every group
   collapses to a header carrying its own state, and a group the reader has
   narrowed opens itself so a set filter can never hide behind a closed header.
   --------------------------------------------------------------------------- */
```

---

## BC-11 (2026-08-24) — SPEAK YOUR MIND

<a id="bc-11-2026-08-24-speak-your-mind-121"></a>

```
/* ---------------------------------------------------------------------------
   BC-11 (2026-08-24) — SPEAK YOUR MIND.

   The author asked for the pill by sight: DEEP NAVY FILL, WHITE TEXT,
   deliberately distinct from the gray pills so it reads as the thing to click.

   Why a filled control among outline controls: every other pill on a
   battlecard is a label or a disclosure, and this is the one thing a reader is
   INVITED to do. The design system reserves saturated fill for a primary
   action for exactly this reason, and it is the grammar the ballot pill and
   the Ask button already use — a reader has learned it before arriving here.

   The navy is its own token rather than a reuse. `--action` is the app's
   interactive azure and `--accent-national` is a TIER colour, and a reader who
   has learned that periwinkle means federal must not meet it as a button. Navy
   is dark enough to carry white text at any size in either theme, and it is
   nobody's tier and nobody's party.
   --------------------------------------------------------------------------- */
```

---

## BC-21 (2026-08-25) — THE PILL IS THE SAME BAR AS THE SECTIONS AROUND IT

<a id="bc-21-2026-08-25-the-pill-is-the-same-bar-as-the-sections-around-it-122"></a>

```
/* ---------------------------------------------------------------------------
   BC-21 (2026-08-25) — THE PILL IS THE SAME BAR AS THE SECTIONS AROUND IT.

   The author: *pill width matches Voting record and Campaign money exactly;
   navy and white stay.* On `09-06-08` it sits under six full-width section
   bars as a short navy tab about a third their length, reading as a stray
   control rather than as the next thing in the list.

   So every geometric value below is `.card-section-header`'s, deliberately and
   line for line — width, min-height, padding, radius, gap, alignment. What
   does NOT come from it is the COLOUR, which is the whole point of the
   control: a filled navy bar among outline bars reads as the one thing a
   reader is invited to DO, without a word of instruction.

   `.speak-fine-print` below is the other half of BC-19.
   --------------------------------------------------------------------------- */
```

---

## BAL-11 (2026-08-25) — THE BALLOT'S TWO TOP LINKS ARE PILLS

<a id="bal-11-2026-08-25-the-ballot-s-two-top-links-are-pills-123"></a>

```
/* ---------------------------------------------------------------------------
   BAL-11 (2026-08-25) — THE BALLOT'S TWO TOP LINKS ARE PILLS.

   His `09-08-18` draws four reader actions on one page as two kinds of object:
   two pills inside the election box, and two underlined links a screen apart.
   These are the two links, and they take the same shape as the pills they sit
   above — the lavender action treatment the election box already uses.

   The narrowing control passes this class down to its own trigger, so the two
   are one rule rather than a pill and something that resembles a pill.
   --------------------------------------------------------------------------- */
```

---

## BAL-23 (2026-08-25) — the open form takes its OWN ROW

<a id="bal-23-2026-08-25-the-open-form-takes-its-own-row-124"></a>

```
/*
 * **BAL-23 (2026-08-25) — the open form takes its OWN ROW.** The pill class no
 * longer reaches the form (see `address-prompt.tsx`); this fixes the
 * PLACEMENT, because the form is a flex item in a row it shares with the
 * *Moving here?* pill and without a basis it gets whatever is left. Covers
 * every state of the prompt, not only the street ask.
 */
```

---

## BAL-10 (2026-08-25): the ballot route's loading indicator. A quiet pulse

<a id="bal-10-2026-08-25-the-ballot-route-s-loading-indicator-a-quiet-pulse-125"></a>

```
/* BAL-10 (2026-08-25): the ballot route's loading indicator. A quiet pulse
   rather than a spinner — it says "working" without asking for attention the
   answer is about to want. Reduced motion gets a steady dot, because the
   information is that something is happening and an animation is only one way
   of saying it. */
```

---

## LAY-11 — the rail ends where its content ends

<a id="lay-11-the-rail-ends-where-its-content-ends"></a>

```
/*
 * **LAY-11 (2026-08-25, Sean's capture `17-17-53`) — THE RAIL ENDS WHERE ITS
 * CONTENT ENDS. This supersedes LAY-7's grow factor and nothing else.**
 *
 * LAY-7, earlier the same day, gave the rail `flex: 1 0 auto` so it took the
 * remainder of the column and the floaters took their content height. That was
 * built from his `08-53-15` capture, where he drew the rail's rectangle down
 * past its own bottom edge. It produced the defect he photographed nine hours
 * later: with Filters CLOSED, the rail's white panel ran on past the FILTERS
 * row into nothing.
 *
 * Measured before the fix, Filters closed, against a local production build:
 * **395px of empty panel at 430x932, 283px at 834x1112, 71px at 1440x900.**
 * Dead space is a defect with the same standing as a wrong number.
 *
 * So the two children SWAP which one takes the remainder. The rail is
 * `flex: 0 0 auto` — it hugs its content and, keeping LAY-7's zero shrink
 * factor for LAY-7's still-valid reason, it never compresses its own stat
 * tiles. The floaters become `flex: 1 1 auto`; they were already
 * `justify-content: flex-end`, so their cards stay anchored near the foot of
 * the column, which is where `17-17-53` shows them.
 *
 * **THE PUSH-DOWN IS PROTECTED AND IT SURVIVES BY CONSTRUCTION, NOT BY
 * PROMISE.** Sean: *"I like that, I think that is smart."* Opening Filters
 * grows the rail's content; a zero shrink factor means the rail cannot give
 * that height back, so it takes it from the floaters' remainder and their
 * cards go down and off — exactly what `17-18-13` photographs. It is the same
 * mechanism as before, driven from the other side.
 */
```

## ALIGN-2 (2026-08-26) — the names sit under their heading, indented

**This is a SPECIFICATION CHANGE and not a recurrence.** `ALIGN-1` (2026-08-25)
ruled that names indented to the RIGHT of their heading were wrong, and that
session removed the indentation across 21 person rows at 3 viewports —
correctly, to the spec it was given. Sean changed the spec on 2026-08-26.

The new spec, from his 8/26 walkthrough: the heading sits at the margin and the
people sit a small step in beneath it, so `AZ-6` reads as the container and the
name below it as its occupant. A subparagraph indent — deliberate and small,
not a column.

`10px` rather than a token step: the person rows are `0.8125rem` and the
headings `0.6875rem`, and anything larger reads as a second column, which is
the arrangement `ALIGN-1` was adopted to remove. The class is applied to the
block that WRAPS the holders, never to a row, so a body with five members
indents once as a group rather than five times as five rows.

Paired with the seat-label collapse in `lib/officials/seat-grouping.ts`: one
heading per body, however many seats it holds.

## BAL-25 (2026-08-28) — the ballot's desktop second column

<a id="bal-25-2026-08-28-the-ballot-s-desktop-second-column"></a>

`app/ballot/page.tsx` had **no responsive breakpoint at all** — not one `sm:`,
`md:`, `lg:` or `xl:` utility in 2,282 lines of page or in any of the thirteen
`components/ballot/*.tsx` files. The container was `max-w-2xl`, so a 2,000px
desktop rendered a 672px column of ballot and 1,328px of background.

**The width is spent on a second column of CARDS, never on longer lines.**
Prose stays capped at `lg:max-w-2xl` — the same 42rem measure a phone reader
gets — because a 1,600px paragraph is the mobile page with the guard rails
taken off, not a desktop composition. What the extra width buys is roughly
twice as much ballot per screen at exactly the same line length.

**Why a grid of whole cards and not a two-column row.** `docs/DESIGN.md`, "The
two-column trap": a row that puts a `nowrap` label and a value in competition
for a fixed width will eventually starve the value, and where the label can be
arbitrarily long — an office title, a body name — the answer is to stack, not
to tune the width. Contest headings here are exactly that kind of label. So the
columns divide CARDS and never FIELDS: each card spans its whole grid cell and
stacks internally exactly as it does at 390px, and the trap has nothing to bite.

**Row-major, not multi-column.** CSS `columns` would balance the ragged bottom
edge, but it flows column-major: a reader would scroll the whole left column of
a 20,000px ballot and then scroll back up for the right. Grid keeps ballot
order reading left-to-right and down. The ragged bottom is the price and it is
the cheaper one.

The class is a single column at every width below `1024px`, so the phone render
is unchanged by construction rather than by inspection.

## BAL-26 (2026-08-28) — Ask, in the pill row under the heading

<a id="bal-26-2026-08-28-ask-in-the-pill-row-under-the-heading"></a>

`<BallotAsk>` was mounted dead last on the ballot page — below every contest,
every footnote, the measures, the notes block and the absence blocks. On this
page that is roughly 20,000px at 1280 and 25,000px at 390, which is a feature
no reader finds. The engine was never the problem: it posts to
`/api/ask/grounded` with `surface: "BALLOT"`, the same pipeline the map panel
uses. This is placement.

It moves into `.ballot-top-pills`, the flex row directly under the `<h1>` that
already carries the narrowing pill and the movers link. The affordance is
borrowed from the map's `.ask-pill` — a pill with `aria-expanded`, an expansion
that hangs under the row at the row's full width, a one-frame focus into the
input on open, Escape and an outside press to dismiss — but not the COMPONENT:
`components/shell/pill-cluster.tsx` mounts `AskBox`, which reads
`useShellData()` and `useUi()`, providers that exist only inside
`map-entry.tsx`. Reusing it would mean standing the map shell up behind a page
that has no map.

`.ballot-ask-pill` is a `signal`-tinted variant of `.ballot-top-pill` rather
than a second pill grammar, so the three pills in that row read as peers.
