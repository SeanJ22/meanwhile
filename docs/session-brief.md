# Session brief — the design pass: flagships look like flagships

Committed for the record by the session that executed it (2026-08-15,
second session of the day; branch `claude/design-pass-0815`). Row
pointers: M64–M71, D53, X05, B15. The walk superseded
`docs/tester-pass.md`; the session narrative is `docs/state.md` §25.

PREREQUISITE: the truth-and-faces session's DEFECT rows (counters,
concluded meetings, mojibake, party rendering, "Someone else") must be
Done before this brief runs — this session restyles surfaces that session
fixed. D50 (photos) being In Progress does NOT block this session.
Session-open: confirm the defect rows, or STOP and report. *(Confirmed at
open: M57, M58, M60, M61, M63 all Done.)*

This session runs unattended. Nobody is available to answer.

- Reversible: cheaper-to-undo, recorded with the rejected alternative,
  keep going. Irreversible: skip, tracker row, continue.
- Browser-heavy steps LAST where possible — this session is inherently
  browser-heavy, so: strictly sequential rendering checks, no parallel
  browser work, no background agents, commit per completed item so a
  crash loses nothing.
- Live on every push; nothing half-finished to `main`. End with
  `pnpm handoff --ship`, verify on `main`, verify the deploy, standing
  report ending with "Needs your hands" — probe rows named if any are
  created.

Session-open: read `docs/defects.md` and triage.

## The mandate

The author's bar, verbatim: "Clean. Like Apple level clean." This session
is dedicated to it — a real pass with real deliverables, not adjective
sprinkling. Use the frontend-design skill. Establish tokens; apply them
everywhere; commit the system so future sessions inherit it instead of
improvising.

NOTHING behavioral changes in this session except where an item says so:
routing stays deterministic, reactions stay honest-outcome, all data
rules stand. This is how it all LOOKS and FEELS.

## 1 — The ask box becomes a flagship

"Who do I talk to about…?" is a standout feature currently rendered as a
form fragment (plain text, dotted border). Redesign it — the input AND
its answer rendering — with presence, weight, and polish: an input that
invites, answers that feel authoritative. The "I got you... hang
tight..." beat keeps its timing and words; give it visual grace. No
behavior changes.

## 2 — The ballot gets the same elevation

The tester loved using it; it should look like the product's centerpiece.
Typography, spacing, card rhythm, the CTA header's presence, and the
reaction controls' prominence (the standing "What do you think?"
prominence rule folds in here). Candidate cards read as designed objects,
not stacked divs.

## 2b — The funding section is a flagship too

The money surface is the product's most distinctive content and it just
gained plain-language PAC typing — render it like it matters. Contributor
rows read as designed records (name, typed label, amount in clear
rhythm); the candidate's-own-money and self-funding labels sit naturally
in the hierarchy. No data or label changes — the mapping table and
organizations-as-filed rule are untouched. Rendering only.

The type labels render as pill badges, the author's spec: a small rounded
bubble, light tinted background with darker same-hue text (e.g., light
teal bubble, dark teal text), small font, one pill per typed label.
Rules:

- The pill palette NEVER uses or approaches the party colors (Democratic
  blue, Republican red, Green green, Independent purple, unknown gray).
  PAC-type pills draw from a separate family — teals, ambers, slates,
  warm neutrals — so no type reads as partisan and no color implies good
  or bad money. Assignment is arbitrary but CONSISTENT: the same type is
  always the same color, defined once in the tokens file.
- Contrast passes at phone size (the light-bg/dark-text pair must stay
  legible small); verified in the walk.
- The tap-open explainer behavior is unchanged; the pill is the tap
  target.

## 3 — Visual hierarchy: structure reads as structure

Tier headers (LOCAL / STATE / FEDERAL) currently render SMALLER than the
names under them. Define the type scale as tokens: structural labels
distinct, confident, clearly organizational — without dwarfing content.
Apply product-wide (who-governs, officials popup, ballot sections,
filters).

## 4 — Three registers, not three grays

Explainer voice, tappable links, and sourced data currently render as
shades of gray. Define three visually distinct registers: the app's
explainer voice reads as guidance; links look tappable; data reads as
record. Apply everywhere explainers render.

## 5 — Repeated provenance collapses to footnotes

When the IDENTICAL source line repeats on a surface (e.g., "From the New
Hampshire Secretary of State (2026–2027 political calendar), read
08/14/2026" on every contest), render it once: an asterisk/dagger at each
item, the full citation once at the surface's foot. Distinct sources
never collapse together; provenance stays one glance away. De-cluttering,
not de-sourcing — the blurb-source rule is untouched.

## 6 — The map's "narrow it?" prompt never interrupts

Free panning currently triggers the narrowing popup constantly. Replace
it with a passive affordance: a quiet chip on settle ("Narrow to this
area?") that never blocks panning, is never modal, and doesn't repeat
within a session unless the viewport changes meaningfully. Record the
interaction rule beside the existing popup-trigger rule.

## 7 — The street input visibly does something

On entering a street name: geocode within the active zip, SHADE the
containing district(s) on the map, and refresh the sidebar numbers,
meetings, and officials to that point. The act gets a visible payoff.
Device-side; no new logging beyond existing search-log rules.

## 8 — "Clear my picks" confirms via a dialog

A real confirmation popup (same question), not an inline line change.
Consistent with the new visual language.

## 9 — The system, committed

- A tokens file / DESIGN.md: type scale, spacing, color roles, the three
  registers, component patterns for the flagship surfaces. Future
  sessions build from it.
- Into CLAUDE.md, one line: structural labels organize, content leads,
  flagship surfaces get flagship treatment, and reader-facing polish
  follows the committed tokens.

## 10 — Final pass and handoff

One tracker row recorded this session (recorded, NOT built — the
author's next content feature, fully specified in conversation and
preserved here):

- Key votes tracker (the tester's ask): an author-curated "notable
  votes" section on member cards. Doctrine locked at recording time:
  author-approved list file (like the PAC mapping table); inclusion
  criteria PUBLISHED on the surface; VOTES ONLY (recorded roll calls —
  executive actions and introduced-but-unvoted bills are excluded or
  rendered as "Congress has not voted on this"); both parties' signature
  items by construction; rendered with existing machinery (plain-language
  summary, party breakdown, member's vote, source); NEVER aggregated into
  a score, grade, or alignment; "no vote exists" and "the Senate hasn't
  acted" are first-class honest answers; the list carries read-dates and
  gets a review pass each cycle. Candidate entries preserved: CARES, ARP,
  IIJA, IRA, CHIPS, Safer Communities, Respect for Marriage, the 2024
  foreign-aid/TikTok package, Laken Riley, OBBBA, the Fiscal
  Responsibility Act, the 2025 cabinet confirmations (Senate-only, House
  says so honestly), the late-2025 shutdown reopening votes (framing
  verified from the bills' own contents, never characterized), the
  Consolidated Appropriations Act 2026, the ROAD to Housing Act, the
  House stock-trading-ban vote (Senate pending, stated), and the Blanche
  AG confirmation (50-49, 2026-08-08).

Walk at 390×844 AND desktop as a stranger: the redesigned ask box (ask
the pothole question, watch the beat), the ballot end to end, tier
hierarchy on who-governs, one footnoted surface, free panning with the
chip (never a popup), the street-input shade-and-refresh, the
clear-picks dialog. Screenshot BEFORE/AFTER pairs for the ask box, the
ballot, and who-governs — the author judges by eye. Supersede
docs/tester-pass.md. Documents: state.md (real-date header, every item),
DESIGN.md/tokens committed, tracker in place, next free IDs verified.
Overwrite docs/session-brief.md. Ship, verify deploy, standing report
ending with "Needs your hands."

## Order, and cuts if short

1 → 2 → 2b → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

If short: defer 7 (street input) first, then 6 (map chip), then 5
(footnotes). Never cut 1, 2, 2b, 3, 4, 8, 9, or 10. Documents never cut.

## Standing rules

All of CLAUDE.md's non-negotiables. The playbook clause stands. The
stranger test. Denominators with counts; stated N equals rendered rows;
screenshot before believing green; diagnose before fixing; never assert
absence; a failed operation may not render as an empty success;
reader-facing dates are wall clock; every date written into any document
comes from `pnpm stamp`, never typed from assumption (R14's law); a URL
cited must have been fetched and verified.
