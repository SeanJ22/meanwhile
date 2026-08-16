# Session brief — mobile round two: the phone feels native, and the palette gets reconsidered

Delivered by the author, 2026-08-15. Committed for the record; the narrative
is `docs/state.md` §30 and the rows are `M89`–`M99`, `R21`, `M91`–`M95`.

This session runs unattended. Nobody is available to answer.

* Reversible: cheaper-to-undo, recorded with the rejected alternative, keep
  going. Browser-heavy throughout — strictly sequential rendering checks, no
  parallel browser work, no background agents, commit per completed item.
* Live on every push; `pnpm handoff --ship`, verify deploy, standing report
  ending with "Needs your hands." Probe rows named.

Session-open: read `docs/defects.md` and triage.

## 0 — One venue row before the design pass: Newbury's ZBA goes live

The author's finding, from his own browser: 937 New Hampshire Rte 103,
Newbury, NH 03255 is the meeting address for Newbury's Planning Board AND
Zoning Board of Adjustment. The site labels it only "Newbury Offices" — the
street address lives behind the Google-map link under that label, not in the
page text. Source: newbury.nh.gov/planning-board plus the author's map-link
read.

* Add the ONE curated venue row for the Zoning Board of Adjustment (label as
  the town does — "Newbury Offices" — with the address). Per f's report this
  makes the ZBA and its four 2026 agendas LIVE with no other change. Verify
  on production at 03255.
* Playbook entries (the author's rung notes, verbatim in substance): (1)
  newbury.nh.gov's boards list reveals on HOVER only — no click — so a
  click-walking rung misses it; (2) the town's convention is that every
  physical town meeting happens at "Newbury Offices", with the address behind
  the map link; (3) the full boards list observed by the author (Advisory
  Budget, Blodgett Sewer, Cemetery Trustees, Conservation Commission, Joint
  Assessing, Joint Loss Management, Beautification, Energy, Library Trustees,
  Septic, Planning, Selectboard, Trust Funds Trustees, Zoning Board of
  Adjustment) is recorded as the observed universe — a denominator, not
  scoped work.

## The mandate

The author's mobile pass, plus the standing bar: "Apple level clean."
Everything here is interaction and rendering; no data rules change.
BEFORE/AFTER screenshot pairs for every numbered item — the author judges by
eye.

## 1 — The who-governs card dismisses like a native sheet

Tap/click anywhere outside the card dismisses (minimizes) it — the author:
"that's natural mobile behavior." The explicit minimize control stays.
Applies to the officials popup and districts popup too. The back-button rule
from M52 is unchanged.

## 2 — The ballot floater earns its size, and Ask joins it

* The BALLOT pill top-right is a standout entry and renders like one: larger,
  confident, unmistakable at phone width.
* Beside it, a new "Ask" pill — the ask box's mobile entry ("Ask about this
  area" affordance, opening the ask box focused). The author: "I don't want
  to have to dig to find it."
* On desktop, the ask box ALSO moves to the top of the sidebar, directly
  under the what's-on-the-ballot entry — first things first.
* "Show me my actual ballot": on the ballot page, under the zip-is-
  orientation definer, a link — "Narrow this to where you live →" —
  prompting for street + house number (the D53 ask-for-number machinery),
  resolving the point, and re-scoping the ballot to the districts containing
  it. Point never stored, same as everywhere.

## 3 — Rapid zip switching

Changing zips currently means opening the sidebar. Build a faster path:
tapping the current zip (in the BALLOT pill or map header) opens a compact
zip entry with recent zips listed one-tap. Device-local recents only; design
per tokens.

## 4 — The calendar chooser becomes a centered dialog

The current popup clips off the right edge at phone width (author
screenshot: Apple/Google/Outlook cut off). Rebuild: tapping "Add to calendar"
opens a CENTERED modal chooser, backdrop blurred/dimmed, three clear options
— EACH WITH ITS LOGO (Apple, Google, Outlook marks at icon size; standard
practice for calendar choosers), cancel by tapping outside. Same .ics/Google
links underneath. Every surface that offers calendar links uses the one
chooser.

## 5 — The footer collision and the gold reconsideration

* Fix: the sidebar footer ("LAST CHECKED …") collides with the map legend at
  mobile width. Layout/layering so no fixed elements overlap at 390px —
  audit all of them.
* The palette pass: the author's note — "I don't know how I feel about all
  this gold font." Reconsider the accent system: gold/amber currently carries
  links, labels, values, and emphasis all at once, which dilutes hierarchy
  and reads heavy. Propose and apply a calmer distribution per the three-
  register system (guidance / tappable / data): keep ONE clear interactive
  accent; let structural labels and data carry neutral confident tones;
  reserve saturated accents for genuinely primary actions. Party colors and
  pill families untouched. BEFORE/AFTER pairs on who-governs, the ballot
  header, and a funding section — the author rules on the direction; the
  tokens file updates so the change is system-wide, not sprinkled.
* The tier toggles, specifically (author + the 15-year-old tester):
  Local/State/National selected-states use EACH TIER'S OWN color (Local gold,
  State green, National blue — the map's legend colors), never the uniform
  orange mass that renders when all three are selected. Unselected stays
  grayed. The map's boundary/legend colors and the toggles stay one token
  family — change one, both move.
* The sun test: the tester's field finding — gold-on-light is unreadable in
  phone glare. Contrast targets account for outdoor readability, not just
  WCAG-in-a-dark-room.
* County vs state boundary lines look identical on the map — solved by the
  author's STATE-FOCUS treatment (below); any residual county-line styling
  follows the tokens.

## 6 — The clear-picks dialog loses its false sentence

The dialog currently claims "your picks were never sent anywhere, so there is
nothing to clear elsewhere" — half-true (picks weren't sent; the taps that
created them joined anonymous totals per the capture disclosure). The fix is
SUBTRACTION, the author's order: the dialog becomes "Really clear every pick
on this device?" — Clear / Keep. Nothing else. The data story lives at the
capture disclosure and "What this site collects," where it already is.

## 6b — The battlecard's votes: two columns, the author's architecture

The official/candidate large popup ("battlecard") renders votes as TWO
side-by-side collapsed columns (desktop; tabbed or stacked at 390px — same
information architecture, width-appropriate form):

* "Recent" — the member's last 20 roll calls, count-based (no time window;
  self-adjusts to congressional rhythm). ALL of them: procedural votes
  (tabling, cloture, rules) are relevant by the author's order — voting to
  table a bill is voting to kill it without going on record — so nothing is
  filtered and nothing is footnoted as lesser. Each row renders in plain
  function via the existing machinery ("voted to set the bill aside without a
  direct vote on it") with the formal question one tap down.
* "When it mattered" — the B15 curated list (exact label, the author's
  words). The published criteria sentence renders at this column's head.
  Expanding it reveals TWO collapsible sub-groups: Votes on laws and Votes on
  people. On House members' cards, Votes on people renders once as the single
  honest line "the House doesn't vote on nominations," collapsed and inert —
  never repeated per entry, never an empty section. Senators get both groups
  full.
* Overlap is expected and unmarked: a recent vote that is also a
  when-it-mattered vote appears in both columns — each column keeps its own
  complete answer; time deduplicates naturally.
* Ordering: newest first in every column and sub-group — the whole card reads
  consistently backward through time.
* Both columns collapsed by default: the card's opening view stays identity,
  contact, and funding, with depth one tap down.
* The card's information order is a design decision in itself: what a
  stranger sees in the first screen-height before any tap is the card's
  argument. Define it deliberately (identity → contact → funding → votes) and
  record it in DESIGN.md with the tokens.

B15/B17 HAVE LANDED (the f session): the key-votes machinery is live and 18
of 20 law entries carry chamber-verified roll calls. Build both columns FULL
— the not-yet fallback is dead. The two law entries whose roll calls were
correctly refused render an honest per-entry absence line ("no verified roll
call for this entry yet"), never an empty row and never a silent drop; the
When-it-mattered laws group's stated N counts all 20 with the two absences
visible.

## 6b2 — The state-focus map: the active state is vivid, the rest recede

The author's design. The map treats one state as ACTIVE at a time. This is
fully general — fifty states plus DC from day one: the mechanics run on the
TIGER state boundaries already in the stack (vivid/dim masking, border
emphasis, and crossing detection are the same point-in-polygon machinery used
everywhere else), so no state is special-cased and AZ/NM in the dialog copy
below is example text with real names substituted at render.

* The active state renders full-color; every neighboring state renders grayed
  and slightly blurred; the state border renders subtly raised/emphasized
  (casing/shadow per tokens) — the boundary between vivid and dimmed makes
  the state line unmistakable and retires the county-vs-state confusion.
* Crossing the STATE border while panning fires a REAL DIALOG — the author's
  ruling, and the reason is semantic, not stylistic: inside a state, panning
  is browsing (same laws, same deadlines, same bodies) and the quiet rules
  stand absolutely; crossing a state line is a CONTEXT SWITCH where every
  fact the app asserts changes, and the interruption IS information. The
  dialog: "You're leaving Arizona. New Mexico is a different world —
  different governments, different laws, different election deadlines. Want
  to see their info?" with See New Mexico / Stay in Arizona. Stay keeps
  panning free (the neighbor stays dimmed); the dialog fires ONCE per border
  per session — a clarification, not a toll booth on every wobble across the
  line. Switch performs the vivid/dim flip. The doctrine, recorded beside the
  interaction rules: quiet within a state, explicit between states.
* Activation is coverage-honest: federal representation renders for any state
  (the congressional roster is fifty-state); state/local surfaces render what
  is held, and where a state isn't covered yet, the honest empty state with
  its denominator renders — which is also the demand signal for which states
  get built next. Never an implied fullness.
* Zooming out releases focus — leaving the conversation is always free: when
  the active state no longer meaningfully occupies the view (threshold tuned
  in build — roughly "looking at a region, not a state"), the vivid/dim
  treatment releases and the whole map renders normally: no dimming, no
  dialog — surveying the country is browsing, not context-switching. The
  active state's DATA (sidebar, ballot, who-governs) is untouched; only
  visual focus lets go. Zooming back into the same state resumes focus
  quietly, no dialog. Zooming INTO a different state until it dominates the
  view IS the context switch — the dialog fires exactly as on a
  pan-crossing, once per state per session. One line for the rules doc: focus
  follows meaningful presence; the dialog fires only on entering a different
  state's context, by pan, zoom, or zip.
* Zip entry in a new state activates that state the same way. The active
  state is device-local view state, never logged beyond existing rules.

## 6b3 — Ballot cards: uniform geometry, neutral order (the author's scattered-photos fix, the neutrality-preserving version)

Photos scattered through a contest read as broken. The fix is GEOMETRY, not
ordering: every candidate card in a contest renders identical tile size and
visual weight — the initials avatar occupies exactly the portrait's box, same
background treatment per tokens — so a mixed contest reads as one clean
rhythm. Candidate ORDER stays as-filed (the neutral ground; photo-first
ordering would stack the layout advantage on the candidates who already have
the information advantage — the thin-card bias, enforced). If the geometry
fix fails the author's eye once built, ordering is revisited as an explicit
author decision.

## 6b4 — Every battlecard section collapses, and the headers beg to be tapped (the author's design)

On EVERY person battlecard — representatives, senators, governors, local
officeholders, candidates, anyone — the major sections render as COLLAPSED,
EXPANDABLE sections so the card never reads as infinite scroll. Identity
(name, photo, office, party, in-seat-until) stays open; contact, campaign
money, largest contributions, recent votes, when-it-mattered, and every other
major block collapses to a section header.

* The header must make the author want to open it — that is the bar, the
  shape is the design's call. Pill/bubble is the author's instinct; if the
  session finds a form that hits the bar harder within the tokens, build that
  instead and record the choice. Either way it reads unmistakably tappable,
  and it draws its strength from item 5's quieting — the gold-everywhere
  theme comes DOWN, the interactive accent concentrates here, and the header
  pops by contrast, not by adding another loud element. One consistent
  component per tokens; design it together with 5, one token family. The test
  is the author's eye on the BEFORE/AFTER pair.
* Expanded state per section, chevron or equivalent affordance, smooth at
  390px; tap targets at full comfortable size.
* The section SET is identical per office class — a thin challenger renders
  the same pills as the incumbent, honest content behind each; collapse is
  organization, never a way to render some people smaller than others
  (equal-effort, enforced at the component).
* This generalizes 6b (vote columns collapsed by default) and 6e3 (the
  who-governs information-order rule) into one card-wide discipline; the
  first-screen order from 6b (identity → contact → funding → votes) is now
  the order of the SECTION HEADERS, recorded in DESIGN.md.

## 6c — The question boxes get the next-election treatment

Every reaction prompt — "Would you vote for them?", "What do you think?", and
the funding question, which SHIPPED IN F as "How do you feel about how this
campaign is funded?" with FIVE options (Love it / Like it / Don't like it /
Hate it / Don't care) — renders as a clearly framed box (the shaded/outlined
treatment of THE NEXT ELECTION box), so the sensor reads as the point, not an
afterthought. The five-option funding row is the geometry test: it must hold
cleanly at 390px per tokens (wrap or stack, never truncate, never shrink
below tap size), and the framed component is designed around it, not
retrofitted. Question wording and option sets are as shipped — this item
styles them, never edits them. In the battlecard's vote rows, "Do you like
this vote?" gets the same treatment SMALLER — as prominent, not as large.
Consistent component, per tokens.

## 6d — "In seat until," age, and the small cards say what offices are

* Every officeholder row (small card AND battlecard) renders "In seat until
  [date]" next to the name/title — the full date where held, the year where
  that's all the source gives. Where the term isn't sourced, nothing renders
  — never computed by guesswork from election cycles.
* Age renders on battlecards where a birthdate is held from an authoritative
  source (the federal roster's bioguide carries them; state and local render
  age ONLY when a sourced birthdate exists) — computed from birthdate at
  render so it never staleness-drifts, source recorded like everything else.
  No sourced birthdate, no age — never scraped from news or guessed.
* The municipal/body "overview" cards are too light (the author:
  type/tier/upcoming and nothing else). Each office row gains the existing
  what-this-office-does explainer machinery in compact form — what a ward
  council member IS and when to contact them — plus party where held.
  Explainers from the shipped per-office-type library; no new prose classes.

## 6e — Bodies and districts: "See information / Go to website"

The author + tester's interaction model, replacing bare click-out links:

* Clicking a body or district name offers TWO actions: "See information" and
  "Go to website."
* See information: other cards minimize; the map zooms to the entity's bounds
  (outlined); a compact card renders — type, the office location pinned on
  the map, representation (superintendent/board/members from data held),
  address, phone, next meeting.
* Go to website: opens their site (current behavior), and on return the map
  is zoomed to that entity — the last click has a place.
* Districts-in-view rows link their representation for EVERY district where
  we hold it — AZ-6's member exists in the roster and doesn't link today
  while AZ-7's does. Any district row whose officeholder is held renders the
  link; the current-zip-only linking is a defect.

## 6e2 — The welcome overlay: the subtitle dies, the type grows

* "NOTICE OF PUBLIC MEETINGS" is removed — it undersells the mission text
  doing the real work below it. The header is the name and the mission,
  nothing institutional.
* The overlay's type is too small even for good vision (the author, on both
  desktop and phone) — bring it up to the token scale's readable sizes; the
  mission text is the product's opening argument and should read like one.

## 6e3 — The who-governs card gets the information-order discipline

The card is crowding (the author, as content accumulates). Apply the
battlecard's rule to it: define deliberately what is OPEN BY DEFAULT (the
ballot entry, the body count, the top bodies, the ask box) versus ONE TAP
DOWN (full rosters, the everyday explainers, secondary links), and record the
order in DESIGN.md. Collapse is organization, never deletion — everything
stays reachable.

## 6f — The map stays quiet while the reader moves

* The who-governs card, once dismissed, STAYS dismissed during panning — the
  tester: it "keeps reappearing and disappearing" while scrolling, which is
  clutter. It returns only on explicit reopen, zip change, or an entity
  selection that summons it. Extends the settle/chip interaction rules;
  record it beside them.
* Near me now resolves districts. The current "moves the map only" is
  counterintuitive (the author). Selecting Near me geolocates on-device,
  resolves the containing districts exactly as a typed address does, with the
  approximate caveat kept. The point is used and discarded — nothing stored,
  per the constitution (orientation, not identity).
* Fresh open prompts for zip. Reopening the app does NOT restore the last map
  position/zip — it asks where you are. Picks and device-local reactions
  persist as always; only the location resets.
* The sidebar counter highlight (MEETINGS colored while others aren't,
  unmoving when other boxes are tapped) — make selection state consistent and
  meaningful, or remove the highlight.

## 6f2 — Four rulings from the author's live pass

* "Not independently verified" retires. When a meeting/record's source IS the
  body's own site or feed — which is nearly everything — the SOURCE link is
  the verification and the disclaimer is self-undermining noise. The line
  renders ONLY where data genuinely came from somewhere other than the body's
  own publication; audit current uses and strip the rest. The provenance data
  underneath is untouched.
* Date range defaults to 90 days back → 60 days forward in the sidebar
  (currently now→60d). Matches the served window.
* District battlecards get the enrichment treatment. Overview currently
  renders type/tier/state and nothing else; the tabs exist but starve. Bring
  them to the officeholder-card standard: the what-this-district-is explainer
  (from the office-type library), its representation, its meetings where
  held, sources. Same register.
* "NATIONAL" → "FEDERAL" on district battlecards — the tier-label rule
  (Local/State/Federal, everywhere) shipped for officials surfaces and missed
  the district cards. One label, everywhere, per the standing rule; audit all
  surfaces for stragglers.

## 6f3 — Two rulings from the author on f's report, recorded

* The ask-box classifier is author-approved as built. The author has reviewed
  how it operates — one identifier from a closed list, zero reader-facing
  sentences — and rules it acceptable. `ripcord.askClassifier` stays LIVE;
  its registry entry's closer note updates to record the author's ruling
  (author-ruled, the flag remains a one-flip pull if doctrine ever changes).
  No behavior change.
* The last-passage rule is author-approved. Where a chamber voted twice on a
  law, the card shows the last passage/concurrence vote — the author blesses
  this as the standing rule, and the sixteen entries that took it as default
  stand as author-approved. Record the ruling beside the B15/B17 rows and in
  the key-votes file's comment header. Any future per-entry override is an
  explicit author decision.

Both are documents-and-registry work, minutes not hours; never cut.

## 6g — Small honesty-of-rendering fixes

* SRC overflow: the SOURCE label wraps to "SR / C" beside long names (Lane
  Santa Cruz). Fix the truncation/wrap; audit every source-tag render at
  390px and desktop narrow panels.
* "Why these five?" — the who-governs top-list (which surfaces Board of
  Adjustment beside county/city/school) gains a small link/explainer: why
  these bodies lead the list. One honest sentence about the selection (the
  bodies whose calendars are watched), not a new ranking.
* Repeated notices collapse to footnotes, two more cases: the proposition
  "final ballot wording not yet published" blurb (once per page with an
  asterisk per prop, not per-prop paragraphs) and the ask box's repeated "We
  haven't sourced who sits on this body yet" (say it once when it applies to
  multiple bodies in one answer). Extends the shipped footnote system.
* Moving-here randomizes its question order per open — marijuana shouldn't
  lead every time (the author). Device-side shuffle, content unchanged.

## 7 — Final pass and handoff

Walk at 390×844 on both a fresh and a returning profile: dismiss the card by
tapping outside, reach the ballot and the ask box in one tap each, switch
zips fast, open the calendar chooser centered, no overlaps at any scroll
position, the recolored surfaces, the trimmed dialog, one battlecard fully
collapsed to its section headers and expanded section by section (a senator
AND a thin local challenger — same section set on both), the ZBA's meetings
live at 03255, and one battlecard's two vote columns opened end to end (a
House member AND a senator — the nominations line on the former), the framed
question boxes on a ballot card and a vote row, "In seat until" on Hobbs's
small card, See-information on TUSD end to end (zoom, bounds, compact card),
a pan after dismissing the card with nothing reappearing, a state-border
cross firing the dialog once (and NOT re-firing on a second cross the same
session), one activation end to end (vivid/dim flip), Near me resolving
districts, a fresh open prompting for zip, and the calendar logos.
BEFORE/AFTER pairs in screenshots/ for every item. Documents: state.md via
pnpm stamp, tokens updated, tracker rows, next free IDs verified. Overwrite
docs/session-brief.md. Ship, verify deploy, standing report ending with
"Needs your hands."

## Order, and cuts if short

0 → 1 → 2 → 3 → 4 → 5 → 6 → 6b → 6b2 → 6b3 → 6b4 → 6c → 6d → 6e → 6e2 → 6e3
→ 6f → 6f2 → 6f3 → 6g → 7.

If short: defer 3 (zip switching) first, then 6e (the See-information model)
whole, then 6d's explainer half (the "in seat until" line still ships), then
5's palette pass (the collision fix is never cut). Never cut 0, 1, 2, 4, 6,
6b, 6b3, 6b4, 6c, 6f, 6f2, 6f3, 6g, or 7. Documents never cut.

## Standing rules

All of CLAUDE.md's non-negotiables. The playbook clause. The stranger test.
Denominators with counts; stated N equals rendered rows; screenshot before
believing green; diagnose before fixing; never assert absence; no empty
success; wall-clock dates via pnpm stamp; a URL cited must have been fetched
and verified.
