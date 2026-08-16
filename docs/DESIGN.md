# DESIGN.md — the committed system

Established by the design pass, 2026-08-15. The author's bar, verbatim:
"Clean. Like Apple level clean." This file is the prose spec; the tokens in
`app/globals.css` are the single source of truth for every value. A future
session polishing a surface builds FROM this system — it does not improvise
a new one, and a new pattern earns its place by landing here in the same
commit that uses it.

The one-line law (also in CLAUDE.md): **structural labels organize, content
leads, flagship surfaces get flagship treatment, and reader-facing polish
follows these tokens.**

## Type scale

DM Sans carries UI text; JetBrains Mono carries every numeral, date, count
and identifier (anything compared column-wise). Sizes in rem, on the scale
components actually use:

| Rung | Size | Weight | Use |
|---|---|---|---|
| Display | 1.5rem (24) | 600, tracking-tight | Page h1 (the ballot) |
| Title | 1.0625–1.125rem (17–18) | 600, tracking-tight | Contest titles, modal titles |
| Heading | 0.9375rem (15) | 600 | Card headings, candidate names, the ask box question |
| Body | 0.8125–0.875rem (13–14) | 400 | Reading text |
| Detail | 0.75rem (12) | 400 | Secondary rows, link lists |
| Caption | 0.625–0.6875rem (10–11) | 400 | Provenance lines, disclosures |

Structural rungs, shared as CLASSES (never re-typed as utility strings):

- `.t-structure` — tier/section headers (LOCAL / STATE / FEDERAL, "Statewide
  measures", door groups). Mono, 0.6875rem, 700, 0.16em tracking, uppercase,
  with a hairline "shelf" rule after the text (`.t-structure--bare` drops the
  rule). Color from the caller: tier accent or `text-paper-dim`.
- `.t-eyebrow` — the small mono caption naming what a block IS ("Campaign
  money · FEC"). Mono, 0.625rem, 600, 0.15em tracking, uppercase.

The rule these encode: **a structural label organizes, so it carries weight —
confident without dwarfing the content it organizes.** The pre-pass 9px
whisper (smaller than the names under it) is the defect this replaces.

## The palette's distribution (the mobile round-two pass, 2026-08-15)

The system's second law, beside the one above: **one interactive accent, and
it only ever marks things a reader can tap.** The design pass established the
registers; this pass fixed how much of the screen each one was allowed to
occupy. `--link` used to alias `--accent-local`, and `--signal` aliased it
again, so a single amber carried links, structural labels, seat titles,
counters, tier headers, focus rings and active chips. A colour that means
seven things means nothing.

| Token | What wears it |
|---|---|
| `--link` | Anything tappable. Nothing else. |
| `--action` / `--action-on` | The FILLED primary action — the ballot pill, Ask, a dialog's affirmative. Reserved. |
| `--label` | Structural labels: type tags, seat titles, section eyebrows. Neutral and confident; weight, not colour. |
| `--text` | Data. Numerals, counts, amounts, names. The brightest thing on any surface. |
| tier accents | Structure only — tier headers, legend dots, boundary lines, the tier toggles. |
| `--tier-fill-*` | The readable form of a tier accent, for a FILLED tier control. The map accents sit at mid luminance and cannot carry text. |

**The sun bar is 7:1, not WCAG's 4.5.** The tester's field finding: gold on
light is unreadable in phone glare. `pnpm contrast` reads the tokens out of
`globals.css` and checks every reader-facing pair against the surfaces it
actually renders on, in both themes, exempting only tokens that carry neither
guidance nor record — each exemption listed with its reason. A change that
drops a pair below the bar fails the run.

`pnpm overlaps` is its sibling for layout: nine states at 390px, and no
floating element may cover a readable surface in any of them.

## The three registers

Who is speaking decides how text renders. Three registers, tokens
`--voice` / `--link`, data in the default text color:

1. **Voice** (`text-voice`) — the app's explainer/guidance voice: coverage
   leads, office blurbs, honesty lines, disclosures. Slate-blue
   (#a4b1c9 dark / #52627e light), visibly apart from the neutral grays.
2. **Link** (`text-link` + `underline decoration-dotted underline-offset-2`,
   solid on hover) — anything tappable. Amber (the brand accent — the focus
   ring, active chips and hovers already speak it). Tiny mono `source` links
   keep their size but still carry the dotted underline.
3. **Data** — the sourced record: full-contrast `--text`, names at
   500–600 weight, numerals/dates/amounts in mono with `tabular-nums`.
   Data is the brightest thing on any surface; the other registers exist so
   it stays that way.

`text-muted` remains for pure metadata (separators, timestamps) — it is not
a register and must not carry guidance or record.

## Color roles

Unchanged from the token file's first half: two themes, one token set,
every color through a token (a literal hex in a component is a bug). Tier
accents (local amber / state teal / federal blue / school magenta) mark
STRUCTURE — dots, tags, tier headers — never body text. Party colors apply
to party-label text only, and never to anything else.

**Funding pills** (`.pill`, `.pill--<family>`): six families — teal, cyan,
amber, gold, slate, stone — tuned per theme (`--pill-<family>-text/bg`),
chosen to never use or approach the party palette so no committee type
reads as partisan and no color implies good or bad money. The type → family
assignment lives in `lib/funding/pill-colors.ts` ONLY, and
`tests/pill-colors.test.ts` pins completeness and the palette boundary.
The pill is the tap target for the type explainer.

## Spacing and shape

- Card: `rounded-[10px]` (the `--radius` token), `p-4`/`p-5` on flagship
  surfaces, `border-[var(--panel-border)]`, `bg-[var(--panel-bg)]` when
  raised, `shadow-[var(--shadow-panel)]`.
- Inner blocks: `rounded-md`, `p-3`.
- Chips and pills: `rounded-full`.
- List rhythm on flagship lists: `space-y-3`, rows `pb-3` with hairline
  separators, `last:` cleanup.
- Dashed borders mean DEVICE-LOCAL (picks, "not here yet") — a semantic,
  not a decoration. Don't use dashed for anything that leaves the device.

## Component patterns (the flagships)

- **The ask box** (`components/ask/ask-box.tsx`): raised block; the question
  as a real heading; one voice-register sub-line; large input + filled amber
  Ask button; the beat in italic voice with its cycling dots (words and
  timing are pinned by tests — dress only); the answer under a signal
  eyebrow ("The answer"), contacts as bordered cards with the phone as a
  large mono link.
- **Contest cards** (`app/ballot/page.tsx`): title + right-aligned eyebrow
  meta on one line; office blurb in voice; candidates as designed rows
  (64px photo, semibold name, link-register links); reaction and pick
  prompts at standing prominence — the ask never whispers.
- **The funding section** (`components/funding/funding-section.tsx`):
  its own framed block; sentences at body size; contributor rows as
  records — name medium, amount right in mono tabular — with the type pill
  beneath; provenance caption at the foot.
- **Provenance footnotes** (ballot): when the IDENTICAL source line repeats
  across contests it renders once at the page foot with `*` `†` `‡` markers
  at each contest title. Distinct sources never collapse. De-cluttering,
  never de-sourcing.
- **Dialogs** (`picks-card.tsx` clear dialog is the reference): portaled
  overlay, `bg-black/45 backdrop-blur-sm`, `.panel` at `max-w-sm`+, a real
  question as the heading, one voice sentence, two buttons in a grid —
  destructive action in the danger treatment, safe action focused.
- **The narrowing chip** (`components/map/narrowing-prompt.tsx`, the
  reference for passive affordances): a quiet `rounded-full` chip in the
  card's flow that never overlays the map, never blocks panning, expands in
  place on tap, and decides nothing until the reader does.

## The person card's information order (2026-08-15, the author's design)

Every person battlecard — senator, governor, ward council member, a
challenger with two links to their name — renders the SAME sections in the
SAME order. Identity is open; everything else is a collapsed pill header.

1. **Identity** — open. Name, portrait or initials, office, party, "In seat
   until", age where sourced. What a stranger sees in the first
   screen-height before any tap is the card's argument, and the argument is
   who this is.
2. **What this office does** — the stranger test. A reader who does not know
   what a ward council member IS cannot use a phone number or a donor list,
   so the explainer sits ahead of the author's four.
3. **How to reach them.**
4. **Campaign money.**
5. **Their votes** — two columns, both collapsed: *Recent* (the last 20 roll
   calls, all of them, procedural included) and *When it mattered* (the
   curated list with its published criteria at its head, and its own two
   collapsed sub-groups).

Items 3–5 are the author's stated order: identity → contact → funding →
votes.

**The section SET is identical per office class, and that is an
equal-effort rule, not a layout preference.** A thin challenger renders the
same headers as a thirty-year incumbent with honest content behind each.
Hiding a section because it would be empty makes the well-covered
candidate's card taller and more substantial — a layout thumb on the scale,
which is exactly the information asymmetry the equal-effort rule exists to
catch. The only permitted exception is structural: a person with no
roll-call store at all has no votes section, because there is no such thing
as their voting record to be missing.

The header is a pill (`.card-section-header`) because a pill is already this
system's word for "tappable and not a link". It pops by CONTRAST with the
palette distribution above rather than by being another loud element — which
is why the two were designed together and share one token family.

## What this system never does

The non-negotiables reach into rendering: no rank/score/match affordances,
no characterizing colors (party hues stay on party labels; pill families
stay off the party palette), identifiers never render outside a
technical-details disclosure, and the four sanctioned frictions (capture
disclosure, narrowing optionality, consent, honest gaps) keep their
weight — polish may never smooth them away.

---

# The 0816 pass — the cards take their final face

Adopted 2026-08-16, the author's rulings. Everything below is committed
grammar: a new surface uses these, it does not invent a neighbour.

## The interactive accent is AZURE. The brown is gone.

The author: *"I hate this brown throughout. Change it to something else
entirely."* It was `#ffb000` in dark and a deep amber `#6d4600` in light,
which reads brown on every surface it touched — the Ask button, the Ballot
pill, links, selected states, the section-header pills.

`--link`, `--action` and `--signal` are one azure family now
(`#4fc9e8` dark / `#0a4f61` light), and both spellings of the token finally
agree: `--color-signal` aliased `--accent-local` while the real `--signal`
property aliased `--link`, so `text-signal` and `var(--signal)` were two
different colours. They are both `--link`.

**Why azure and not something warmer.** The palette here is crowded and most
of it is politically load-bearing. The accent had to sit clear of the party
colours (Democratic blue 217°, Republican red 5°, Green 140°, Independent
purple 273°), the tier accents (local amber 41°, state teal-green 165°,
national periwinkle 219°, school magenta 330°, all-tiers orange 25°),
`--danger`, and `--voice`. The gaps left were lime, cyan/azure (~195°) and
indigo. Lime is unreadable at these sizes; indigo sits between national blue
and Independent purple, **and an accent a reader could mistake for a party
colour is a worse defect than a brown one — a link that reads as a party mark
is a claim.** Azure is 30° clear of the nearest tier accent on either side and
is nobody's party. Both values clear the 7:1 sun bar in both themes.

**The tier accents did NOT move, and that is a recorded decision with a
remainder.** The brief permits moving Local off gold provided the map legend
and tier toggles move with it — one token family, both move. They are tuned
to sit between the basemap's roads and the meeting markers, so moving one
means retuning the legend against the basemap, which is the author's eye's
call and not a side effect of a link colour. **The remainder:
`--tier-fill-local` in the light theme is still a deep amber on the selected
Local toggle.** Named rather than quietly left.

## The pill is the house grammar for "tappable fact"

Three pill families, and they are not interchangeable:

| Class | What it means | Form |
| --- | --- | --- |
| `.contact-pill` | a channel that opens something — phone, form, page, account | outlined, 44px min, icon + label |
| `.id-chip` | an identity fact — party, state, chamber, standing | 24/28px, party FILLED, everything else outlined |
| `.vote-pill` | a recorded position, or a settled reaction | filled, deep, near-white text |
| `.card-section-header` | a collapsible section of a card | full-width pill in the accent |

**They wrap; they never shrink.** A pill below tap size is a defect, so
`.contact-pill` has a 44px floor (40px compact) and no flex-shrink. At 390px
a row runs to two or three lines and every pill stays tappable.

**Absent channels are absent pills.** Never a placeholder, never a greyed
"no website", never padding to make a row look full. Equal effort means the
HUNT is equal, not that the ROW is padded to equal length.

## The identity header

On every person battlecard, and scaled down on the small popup:

1. **Circle portrait with a NEUTRAL ring** (`--panel-border`, 3px). The
   reference screenshot rings it in the party's red; that is the one thing
   not adopted. A ring in a party colour makes the photograph itself a
   partisan mark, and a nonpartisan office would then wear either a colour it
   has no claim to or a visibly lesser frame.
2. **The initials avatar occupies the IDENTICAL circle** — same diameter,
   same ring, same ground. This extends 6b3's uniform geometry. Layout weight
   tracks OUR research, never the person.
3. **Name as the dominant type** — 28px on the large card, 17px on the small.
4. **One chip row, uniform height.** Party FILLED in its assigned colour
   (every filed party fills: Republican red, Democrat blue, Independent
   purple, Green green); then state, chamber/office, and
   incumbent-or-challenger as OUTLINED neutrals. **Fill-versus-outline carries
   the emphasis, never size** — a bigger chip would make the same claim a
   second time, and sizes creep.
5. **No party filed renders NOTHING** (M62). Never a "Nonpartisan" pill
   dressed as an affiliation. Absence never wears a colour.
6. **"Incumbent" and "Challenger" render in the identical chip**, through one
   code path, so neither can grow a treatment the other lacks.

State and chamber come off the member's own current term in the pinned
congress-legislators file — never guessed from a seat label. A local roster
publishes neither and the row says the tier instead.

The card header above it carries the tier eyebrow and the close control and
**nothing else**: it used to repeat the name and the office four pixels above
an identity block that says both again.

## Voting Record: one header, two views, full width

`Recent` and `When it mattered` used to float as two headers with no parent
("recent WHAT?") in a two-column grid that gave each half the card. Now:

- **One `Voting Record` section header**, at the same full width as Campaign
  money and the rest — one of the collapsible sections, not a special case.
- **Two selectors inside it.** The selected view consumes the full width;
  selecting one collapses the other. **The accordion is scoped INSIDE Voting
  Record only** — the sections above are unaffected.
- Information architecture otherwise unchanged: both views keep their
  complete answers, newest first, overlap unmarked.

**Chevron state-direction, everywhere.** Closed points down, open points up.
The rotation rule must use a CHILD combinator — as a descendant selector it
rotated every nested chevron when an outer section opened, so the closed
sub-groups pointed up while shut.

## The who-governs card and the counters

- **The counters are a 2×2 grid.** Four flex tiles in a 340px rail gave each
  about 70px to hold a 10px uppercase label, so "DISTRICTS IN VIEW"
  overflowed its tile. Two per row at ~144px, sentence case, wrapping inside
  its own tile. The honest modes from M87 are truth rules and did not move.
- **Person rows are `.person-row`**, stacked: name at full width, party as an
  `.id-chip`, and BOTH affordances rendered — the name opens the battlecard,
  "Their site →" goes out to the officeholder's own page (M92's two-action
  model, extended to people rows).
- **Information order, open by default vs one tap down** (M93): the ballot
  entry, the coverage sentence and the LOCAL/STATE/FEDERAL lists are OPEN —
  they are the card's argument. "Why these N?", the per-body detail, and the
  moving-here link are one tap down. **Collapse is organization, never
  deletion**: nothing is removed by being collapsed, and a collapsed section
  still renders its header so the reader knows it exists.

## Register on a prompt is set by prominence, not by subject

A proposition's prompt is as loud as a person's — same frame, same prompt
weight. **What stays different is the KIND of thing**: a pick is the reader's
private note that never leaves the device and wears a DASHED border; a
reaction joins anonymous totals and says so at capture, and wears a solid
one. Equally loud, visibly different.

## The two-column trap, named once so it stops recurring

A row that puts a `white-space: nowrap` label and a value in competition for
a fixed width **will always eventually starve the value**. It rendered
"Dr. Matt Heinz" one character per line inside a 300px popup, and it was
about to do the same to the who-governs seat rows. Where a label can be
arbitrarily long — an office title, a body name — **stack it**. Do not tune
the width.

## The who-governs list is the one surface with no pills (2026-08-16, the author's ruling)

The previous pass gave this list the battlecards' full element grammar — a
filled party chip and an outbound "Their site →" beside every name — and the
author's verdict on the result was "way overcrowded... a forever scroll". It
was: the card carries twenty-odd people at 85701, and twenty rows each
wearing a chip, a link and a source mark is a wall rather than a list.

**The register here is DENSITY.** Three things per row and nothing else:

- the **name**, which opens that person's small battlecard;
- the **party as PLAIN TEXT** in its party colour (`.person-row-party`) —
  never a filled pill. The pill is banned from this surface and from this
  surface only;
- the **source mark**, where the standing per-surface sourcing rules require
  one. Sourcing did not change; this is layout and link grammar.

## The click grammar on the map's cards (2026-08-16, the author's ruling)

Exactly two moves, and every door out of the product is behind one of them:

- a **PERSON's name** opens their **small battlecard**;
- a **BODY's row** opens its **large battlecard**.

**No external link lives in a list.** Pima and Tucson used to link straight
out to their own websites from the who-governs rows, throwing a reader out of
the product before it had told them anything about the body. The official
site is a fact INSIDE the body's card now, beside the roster, the sittings
and the records behind them — and no such row renders where no hunt found a
homepage, rather than a guessed URL. This supersedes the click-out half of
M92 on this surface.

## The small popup is three things (2026-08-16, the author's ruling)

The author on the previous form: "ugly and scattered, too much info." It
carried a name, a party pill, outlined chips (state, chamber, incumbent), an
office line, an in-seat date and a wrapped grid of up to ten contact pills,
inside 300px.

It is:

1. the **name**, with the photo-or-initials circle;
2. the **party as the FILLED PILL** — the pill belongs on battlecards, small
   and large;
3. the **contact pills in ONE VERTICAL COLUMN** — phone, email, contact form,
   official page, campaign site, X where held. Facebook, YouTube, Instagram
   and Mastodon are large-card only.

**More** sits at the bottom, full width, aligned with the column, and opens
the large battlecard — which carries the office, the in-seat line, the chips,
the full social row, the record and everything else. **Nothing is deleted; it
moved one tap down.** Measured at 1440: 1 chip, 0 role lines, 0 in-seat lines,
3 pills in 1 column at 262px each, More at 262px, card 300px.

The card's **eyebrow keeps the office title**: it is the structural label —
what kind of card this is, in the tier's colour — that every popup in this
system carries. What went is the role line inside the body, which said the
same words a second time four pixels lower.

`identityOnly` on `PersonIdentity` is what enforces this, and it suppresses
all three of the office line, the in-seat line and the outlined chips at
their own lines rather than being a prop that reads well and does nothing.

## A section inside a pane indents (2026-08-16)

`CardSection` takes `level="sub"`. A sub-group insets behind a rule and steps
down in type size, corner radius and fill, while keeping its header, its
count, its chevron and its tap target.

The defect it fixes: "Votes on laws" and "Votes on people" rendered at the
top level's size and colour INSIDE the Voting Record pane, both closed by
default, so selecting "When it mattered" produced one small paragraph above
two bars that read as neither content nor controls — the author's report was
that the pane rendered nothing. **A view the reader has just chosen opens
with its content**; none of the four sanctioned friction exceptions covers
making them tap twice more. Measured after: 2137px tall, 6227 characters,
2 sub-groups both open, 20 entries, indented 10px.

## The confirmation pill, and why its guard measures a ratio

A settled reaction renders as a filled pill in the vote grammar — green for
yes, red for no, dark gray for unsure, the five-point funding scale in its own
deeper shades. `SAVING` and `NOT_COUNTED` never reach it.

It shipped once as `.reaction-choice--settled` written ABOVE `.reaction-choice`
at the same specificity, so the base control's `background: var(--panel-bg)`
won on source order and took the fill back, leaving near-white `--vote-text`
on the panel ground at **1.01:1** in light theme. Every class name in the
component read correctly and the button blanked on screen. **The rule is
`.reaction-choice.reaction-choice--settled`, doubled deliberately, so source
order can never decide it again** — and the guard resolves the class list
through the stylesheet to a literal colour and a contrast ratio rather than
reading class names and believing them.

## Interactive is AZURE, tier accents are not interactive (2026-08-16)

The brown-dies pass moved the interactive accent through three TOKENS —
`--link`, `--action`, `--signal`. Every rule written against `--accent-local`
DIRECTLY kept the amber, and twenty-eight of them did: the page's focus ring,
icon-button hovers, the selects, the search input's focus, the autocomplete's
selection and match bold, the filter chips and their counter, the count
badges, the notice FAB, and the welcome overlay's submit button.

**`--accent-local` is a TIER token.** It may be read only where the tier is
the meaning — the token aliases and the map pins. Never by a hover, a focus,
a selection or a filled action. Guarded in `tests/amber-remnant.test.ts`,
which allowlists the tier-semantic declarations one whole line at a time.

The selected tier toggle's fill is on `pnpm contrast`'s list now. It was not,
which is how the light theme's Local fill stayed `#6d4600` — the dead
interactive brown's own hex — through a palette pass whose whole point was
killing that colour. **A fill nobody measures is a fill nobody notices.**

## The state EXTRUDES from the map — it does not float above it (2026-08-16)

**Reference, required reading before touching this:**
<https://www.breakfreegraphics.com/design-blog/neumorphism-in-user-interfaces/>

The distinction that article draws IS the spec, and it is the whole of it. A
**Material card floats above** its background and drops a shadow onto it. A
**neumorphic element extrudes from** the background — the same material,
pushed up out of it. The active state is the second kind.

Everything follows from that one sentence:

- **Inside the border, the map is UNCHANGED.** No fill, no tint, no wash.
  Arizona is made of the same terrain as the map around it. A fill would make
  it a card sitting on the map, which is exactly what the reference exists to
  distinguish this from — and it is the mistake to expect, because a fill is
  the easy way to make a shape read as selected.
- **The rise is the dual shadow**, translated from CSS to map layers. One
  light source, top-left: a soft LIGHT edge along the NW border, a soft DARK
  edge along the SE. Two opposed blurred line layers, offsets in SCREEN space
  (`line-translate-anchor: viewport`) because the sun does not rotate with the
  map. Both under the first symbol layer — an ambient effect that paints over
  a town's name has started carrying information.
- **Outside is MUTED AND SLIGHTLY BLURRED.** Desaturation alone is not the
  spec. The blur is half of it, and it is why this half is a DOM scrim with
  `backdrop-filter` rather than a MapLibre fill: no WebGL paint property can
  blur what is painted underneath it. A tint pretending to be a blur is half
  the work looking like the whole of it.

**Zoom invariance.** The author's test: look at 85701, zoom ALL THE WAY OUT —
Arizona still reads raised, everything else still reads muted and slightly
blurred. The effect never disappears. Only the shadow's spread scales with
zoom, so the edge stays subtle at continental scale instead of becoming a
cartoon outline; the interpolation bottoms out at a visible width, never at
zero.

**It carries NO information, and that is a rule, not an omission.** The
reference's own accessibility caution is that a low-contrast extrusion cannot
be asked to mean something. So: labels in the muted area stay legible, pins
inside the active state keep full contrast, the scrim sits UNDER every
control (measured — at `z-index: 5` it blurred the count badge and the
freshness line, which is the warning happening in practice), and it is
dropped entirely under `prefers-contrast: more`. The border-crossing prompt
does all the communicating.

**Where the pieces live.** `lib/map/state-focus.ts` (the edge layers and the
point-in-polygon), `components/map/state-focus-overlay.tsx` (the scrim and
its even-odd clip), `.state-focus-*` in `app/globals.css`,
`hooks/use-state-focus.ts` (activation and crossing). Geometry is Census
TIGERweb, generalized — it decides pixels and never answers a question.

**Two implementation traps, both measured rather than eyeballed.** The CSS
compiler dropped the standard `backdrop-filter` and emitted only the
`-webkit-` alias when both were written by hand; write the standard property
alone and let the compiler prefix. And the scrim must be bounded to the MAP's
box, not the viewport's — `map.project()` speaks in canvas pixels, so the
clip has to be measured in the same box the projection speaks in.
