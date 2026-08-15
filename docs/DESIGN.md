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

## What this system never does

The non-negotiables reach into rendering: no rank/score/match affordances,
no characterizing colors (party hues stay on party labels; pill families
stay off the party palette), identifiers never render outside a
technical-details disclosure, and the four sanctioned frictions (capture
disclosure, narrowing optionality, consent, honest gaps) keep their
weight — polish may never smooth them away.
