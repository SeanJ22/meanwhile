# Session brief — g4: Apple-level clean

The author's directive for the 2026-08-16 session (fifth of the day),
committed here for the record. The narrative of what happened is
`docs/state.md` §35; the row-by-row account is `docs/tracker.csv`
(M128–M139, B19, C05, R28).

---

Session brief — g4: Apple-level clean. One search, one popup, one
state raised, and every row opens a card instead of leaving

On completion, overwrite `docs/session-brief.md`.

QUEUE POSITION: runs now. h (NH finance) is parked behind it.

NOTHING IN THIS BRIEF IS CUTTABLE. The author's instruction: "Do it
all this session. Do it all right. PERFECTION first." The ORDER
below is a completion order, not a cut order — it exists so that if
the session runs out of room, what is unfinished is the work with
external dependencies rather than the work the author is waiting to
see. An item that cannot land does NOT half-build: it lands as a
tracker row carrying its WHOLE spec and every rung walked, named in
the standing report in the item's own words. Silence, or a thinned
version reported as done, is the one unacceptable outcome.

This session runs unattended. Nobody is available to answer.

* Reversible: cheaper-to-undo, recorded with the rejected alternative, keep going. Irreversible: skip, tracker row, continue.
* Browser-heavy steps LAST, strictly sequential, no background agents, commit per completed item.
* Live on every push; `pnpm handoff --ship` with the R22 gate; verify every deploy LANDS on production. End with `pnpm walk:all` against production. Every new check this brief names is ADDED TO THE SUITE PERMANENTLY, not run once — that is the g3 rule: a prior win that fails later is a named regression.
* Standing report ending with "Needs your hands." Probe rows named (including SEARCH rows — §34: every /api/meetings GET writes one). Playbook diff or "nothing new," stated.

Session-open: read `docs/defects.md` and triage.

Correct first. Fast second. Nothing third.

The governing standard for every visual item is the author's: Apple-level clean. Fewer surfaces on screen, nothing repeated, nothing half-open, no element whose geometry fights its container.

## 1 — The blur follows the reader (P1, leads)

Changing the zip from an NH zip to an AZ zip zooms to Arizona and Arizona is STILL BLURRED AND MUTED — the mask kept the old active state.

* Diagnose the mask's binding (presumably keyed to the activation event rather than the current resolved state) and fix so the clear/raised region ALWAYS equals the current resolved state.
* When no state is active (an unmapped zip, a national view): no state is raised and NOTHING is muted — the map renders plain. A stale mask over a state the reader has left is the defect this item exists to kill; a mask with no owner is the same defect.
* Walk check both directions: 03255 → 85701 → 07866 → 03255. Each hop verifies the newly active state is crisp and its neighbors muted; no hop leaves the old state clear or the new one blurred.

## 2 — The extrusion gets sharp: Apple-level, per the reference

Re-read https://www.breakfreegraphics.com/design-blog/neumorphism-in-user-interfaces/ INCLUDING its screenshots. What shipped reads SLOPPY (the author, on the NH-coast frames): the raised edge renders as a visible STROKE — a gray band tracing the polygon with every coastal vertex showing. The reference's mechanic is two SOFT BLURRED shadows from ONE light source, where the eye cannot find where the shadow begins.

* No visible line anywhere. The edge is a soft gradient falloff, never a stroke. If a line layer is used, its blur must be large relative to its width; if the seam still shows, use a blurred fill/shadow layer instead and record the rejected alternative.
* One light source, two opposed shadows — light NW, dark SE, equal softness; neither reads as an outline alone.
* Simplify geometry by zoom: the coastline's vertices saw when zoomed out. The silhouette reads; the digitization must not.
* Same material inside and out. Water inside the state is the identical blue to water outside; land identical to land. Only the edge and the outside treatment differ. Nothing inside the active state is ever tinted.
* Outside stays muted and very slightly blurred at every zoom. The author has ruled the zoom-release conflict: the effect NEVER releases — e's 6b2 release rule is retired. Record in DESIGN.md.
* A MEASURED acceptance check, not an eyeball one (g3's lesson — three defects survived screenshots and died to measurement): sample the rendered canvas along a normal crossing the border at several points, at two zooms, and assert the luminance profile is a GRADIENT — no adjacent-pixel step above a stated threshold, and no local extremum that reads as a line. Record the numbers in the report. The author still rules on four frames (city, state, regional, fully zoomed out, both themes) — the measurement is the floor, his eye is the ceiling.

## 3 — Only the active state draws its districts

District boundaries from NON-active states render at regional zoom (NJ lines visible while NH is active). At fifty states this is unreadable, and it costs load.

* District boundary layers render ONLY for the active state. Selecting a new state or entering a new zip depopulates the old state's and populates the new one's.
* No active state → no district boundaries anywhere.
* Measure and state tile/layer counts before and after — this is also a load win, which serves item 15.
* Pins are unaffected: g3 item 6 stands (more viewport never means fewer pins).

## 4 — The current zip is shaded (the author's ask, not yet built)

The reader must be able to see which zip they are looking at.

* A clear but not overwhelming shading covering the current zip's polygon, inside the raised active state — subtle enough that it never competes with the extrusion or with pins, distinct enough to answer "which zip am I in" at a glance.
* It carries no data — like the extrusion, it is orientation only, never a coverage or quality signal.
* Behaves with item 1: it follows the current zip, and disappears when no zip is resolved.
* Author rules on a screenshot pair (with and without pins visible).

## 5 — The map stops dragging the reader back

Free panning glides the reader back to where they started. The author's own report: it returned to the STARTING POINT, which rules out drag inertia (inertia continues motion; it does not return home) and points at the auto-frame refit.

* Gate the auto-frame on user interaction: once the reader pans or zooms by hand, no automatic reframe may move the camera until a new explicit action (zip change, card open, search result) justifies it.
* The 2800ms auto-frame is the named suspect from g2's investigation; if the cause proves otherwise, the diagnosis paragraph says what it actually was.
* Walk check: pan the map, wait four seconds, assert the camera center has not moved.

## 6 — A Yes becomes the pick; the race stops asking twice

The author answered "Would you vote for them?" → Yes for Kris Mayes and the race still asked "Your pick for this race."

* A Yes on exactly ONE candidate RECORDS that candidate as the reader's pick — the pick section renders it chosen (checkmark) with a clear change/clear affordance, and does NOT ask again.
* It ASKS only when the reader has said Yes to nobody, or Yes to more than one.
* A recorded pick is never silently overwritten. If a reader with a pick (derived or explicit) then says Yes to a second candidate, the pick does not flip on its own — the section surfaces the conflict and asks which one. An EXPLICIT pick always outranks a derived one.
* Changing the pick does not alter per-candidate reactions; the two records stay separate. Safe because your-picks is device-local and never sold — a derived pick writes NOTHING into any aggregate, so the sold per-candidate count remains explicit answers only.
* Same rule for measures: a Yes/No on the measure IS the pick.

## 7 — Yes and no look the same everywhere, and the MARK carries it

* Proposition Yes/No adopts the SAME treatment as candidate votes: green fill for yes, red fill for no (g2's pill shades).
* Keep the checkmark on Yes and add its counterpart: a small × on No, everywhere a negative is the selected state — props, candidates, picks, votes.
* The mark is the carrier, the color is reinforcement. A reader who cannot distinguish the two fills must still read the state from the mark alone — the same accessibility discipline the author's own neumorphism reference insists on for active elements. Verify by measurement: the selected state is identifiable with color stripped.
* Unsure/abstain keeps dark gray, no mark.
* The five-point funding row's dividers get BOLDER — barely visible today. They must clearly group favorable | unfavorable | abstain so no option owns the visual center. Everywhere the scale renders.

## 8 — Contact pills carry both numbers, labeled

Grijalva's card holds a DC number and a Tucson district number; the pill row shows one.

* Where both are held, BOTH render at the TOP of the row, labeled which is which ("District office" / "Washington office" — the district city where held). District first: it is the one that answers.
* Multiple district offices: pills carry the city; the full list stays in Offices-near-you.
* Only one held: one pill, labeled honestly. Bodies and non-federal officials follow the same rule with whatever numbers are held.

## 9 — Every row opens a card. Nothing leaves the app. (mechanical half — do this before the depth build)

The author's ruling: the goal is keeping people IN the product.

* Selecting a body ANYWHERE — the sidebar's Bodies list, WGH, the districts panel, the meetings list, search results — opens that body's LARGE BATTLECARD. Never an external navigation. Today the sidebar's Bodies list sends Pima straight to Pima's site; that ends. External links live INSIDE the card, where the reader chooses them.
* Audit EVERY list surface for stray external links and convert them all; state how many were found and how many converted — the count is the finding.
* The same rule for district rows, official rows, and meeting rows (a meeting row opens its meeting card; the agenda link lives inside).

## 10 — Body battlecards get built to person-card depth

"The battlecards should be the ultimate 'holy shit there is a ton of info in here.'" A body card carries, in the collapsible-section grammar, in this order:

* Identity block: body name, tier/type chip row, jurisdiction.
* What this body does — plain-language role and powers, sourced.
* Representation — every seat held, each row opening that person's card. School districts carry the SUPERINTENDENT (the author's earlier note, not yet built), sourced like any other seat.
* Meetings — item 11's ordering and pills, upcoming first.
* Contact — the pill row (item 8's rules).
* Places within / jurisdiction facts where held.
* Sources — populated, per g2 item 1's assembler.
* Where something is not held, the honest absence line for that section — never an empty section, never a hidden one.
* Done is testable: Pima (county), Tucson (municipal), and Tucson Unified (school) each render every applicable section with either content or an honest line, and the walk asserts it on all three.

## 11 — Meetings: collapsed by default, upcoming first, concluded marked

* The meetings panel opens with ALL GROUPS COLLAPSED — the author's comparison screenshots: grouped-and-collapsed is right, auto-expanded is wrong.
* Upcoming meetings render FIRST, then past — in the panel, in the map-pin card, and on body battlecards.
* A past meeting carries a filled "Concluded" pill; a cancelled meeting a filled "Cancelled" pill in its own token shade.
* Within groups: soonest-first upcoming, most-recent-first past.

## 12 — ONE search box, and it answers everything (the author's ruling — this is the point of the model)

The sidebar carries "Who do I talk to about…?" AND "Search meetings, bodies, districts…", plus a duplicate ask box inside WGH. One box.

* A single input handles meetings, bodies, districts, officials AND plain-language questions (a pothole, the library, my kid's school).
* Cost and latency discipline, explicit: entity matching runs LOCALLY FIRST over what we already hold — free, instant, and it answers most queries. The keyword layer runs next. The model is reached ONLY on no-match, ONLY on submit, NEVER as-you-type. `ripcord.askClassifier` unchanged; A07's no-source refusal unchanged.
* Results distinguish honestly between "here is the thing you named" and "here is the office that owns what you asked about" — a match never masquerades as an answer.
* The duplicate ask INPUT inside WGH is removed. WGH keeps its "What's on the ballot" action — that is a different thing and it stays.
* The top-right control: ASK with its question-bubble icon, redrawn per tokens (the current bubble "looks terrible"). Expanding reveals, in order: "What's on the ballot?" then "Who do I talk to about…?" with the single input.
* Search-log and refusal-log rules apply unchanged to whichever path fires.

## 13 — One popup at a time; the sidebar is a drawer, not a popup

The author's screenshot shows FOUR surfaces open at once. That ends.

* The law: opening any card or panel CLOSES whatever card or panel is open. Everywhere, no exceptions. Audit every pair: districts panel → battlecard, WGH row → battlecard, small popup → large card, meeting card, calendar chooser, meetings list, ask-answer drawer. Record in DESIGN.md; the walk checks four pairs.
* The sidebar is a DRAWER, not a popup — it is not governed by the one-popup law; item 14 governs it. This distinction is written into DESIGN.md so no future session collapses the two.

## 14 — The sidebar behaves: auto-collapse, and Filters holds the right things

* On desktop, the sidebar AUTO-COLLAPSES when the reader opens a map surface — clicking WGH, a pin, a district, a body. It does NOT collapse on mere pan or zoom (that would fight the reader). Mobile is unchanged — the sidebar is the primary surface there.
* The expand control stays visible at all times — collapsing is never a trap; one tap restores it.
* FILTERS renders COLLAPSED by default. "Limit radius" and "Show districts" MOVE INSIDE Filters. "Near me" stays OUTSIDE where it is now, with its honest approximate-location note.
* DISTRICT TYPES also collapsed by default. Counts stay visible on collapsed headers where cheap.

## 15 — The panels stop repeating and stop half-loading; the app loads faster

* WGH section rules: dividing lines ONLY between LOCAL / STATE / FEDERAL. No line between people inside a section (Alma/Betty, Greg/Karen).
* The moving-here line reads exactly: "Moving here? Know the basics →" — nothing longer. Ordered before and not built.
* The half-load defect: arriving from an NH zip, or returning from the ballot page, the sidebar sometimes renders BLANK and WGH sometimes half. Diagnose (suspects: a race between zip resolution and panel mount; state retained across navigation) and fix. Walk adds navigate-away-and-back at two zips.
* The Ballot/zip control: the zip's outline is SQUARE inside a rounded pill. One clean rounded element.
* The districts panel splits: "Districts in this zip" first, dividing line, then "Districts in view." Rows open large battlecards (item 9); the panel closes (item 13). Stated N per section; never conflated.
* Load: clicking Ballot and the initial map load are slow. Measure on production, cold cache, stating the method and profile so future sessions can compare. Budget: ballot interactive under 2.5s, map first meaningful paint under 3.0s. Item 3's layer reduction counts here. If the budget is not met, the row states the measured gap and the diagnosis — never a silent pass.

## 16 — Polling place, in the app (the author's ask, not yet built)

"Find your polling place" currently sends the reader away.

* The reader enters an address IN THE APP; their polling place drops a distinctly colored pin on the map, visually unmistakable against meeting pins, with the location's name and address.
* Directions available via an external maps handoff from the pin's card (the one link that is allowed to leave, because turn-by-turn is not something we do).
* Sourcing law applies: the polling place comes from the jurisdiction's own election authority, cited with a read-date. If the authority publishes no machine-readable answer for a zip, the honest line renders with the rungs walked — never a guess, never a nearest-guess pin.
* The address is orientation, not identity (P02): used to resolve, never stored, never logged, and the copy says so where the reader enters it.

## 17 — Governors and the Kearsarge towns (M95, M123 — deferred twice, landing now; browser-heavy, therefore last)

* M95 — governors' age and in-seat-until, sourced (AZ, NH, NJ): the governor's official page, the state constitution/statute for the term, SoS results for the start. Where a rung fails the value stays absent with rungs recorded — never computed from cycle guesswork. Grijalva's card is the shape to match.
* M123 — neighboring towns' meetings around 03255 (New London, Sutton, and the rest of the Kearsarge towns): wire what the rung ladder reaches; what it does not reach lands as a named row per town. g3's six-town rung table is the starting point, and g3's finding governs: a rung is (client, headers, URL, egress). If the CI runner's egress is the wall, say so and name the alternative rung rather than hunting headers.

## 18 — One documents note: the aggregate is a BUYER surface, not a reader surface

Record in state.md (no product change this session): reactions are never rendered back to READERS — a visible tally would poison the sensor — while the aggregate count sold to a campaign ("N said they would vote for you," with its denominator) is a DIFFERENT surface for a different audience, and is the company's product. Item 6's derived pick is device-local and enters no aggregate. The denominator, and the exclusion of our own probe and walk rows from any sold aggregate, belong to C01 — open a tracker row for it here, build nothing.

## 19 — Final pass and handoff

`pnpm walk:all` against production, with every check below ADDED TO THE SUITE PERMANENTLY: the zip-hop mask test and the no-active-state case; the extrusion's measured gradient at two zooms plus four author frames; non-active states drawing no district lines; zip shading present and following the zip; pan-and-wait with no camera drift; a Yes recording as the pick, no re-ask, and the two-Yes conflict asking rather than flipping; prop yes/no with check and ×, identifiable with color stripped; both phone numbers labeled on Grijalva, district first; the converted-link count; Pima, Tucson, and Tucson Unified rendering every applicable card section; the meetings panel opening fully collapsed with upcoming first and Concluded pills; ONE search box answering an entity query and a pothole question, with the model firing only on no-match; four one-popup pairs; sidebar auto-collapsing on map surface open (desktop) and restorable in one tap; Filters collapsed holding radius and districts, Near me outside; WGH lines only between tiers; the exact moving-here string; navigate-away-and-back at two zips with no blank sidebar; the zip control's geometry; the districts panel's two sections; load measurements against budget; the polling-place flow end to end at one zip with its source; governors' two facts with sources; the Kearsarge towns' outcome per town. Documents: state.md via pnpm stamp (including item 18); DESIGN.md (extrusion correction, no-release ruling, one-popup law, drawer-vs-popup taxonomy, pick derivation, check/× grammar, the single search box, sidebar behavior, zip shading); tracker rows; playbook diff. Overwrite docs/session-brief.md. Ship, verify the deploy LANDS, standing report ending with "Needs your hands."

## Completion order (not a cut order — see the header)

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19.

The order puts the author's live defects first, the mechanical high-value fixes next, the large builds after, and the externally-dependent hunts (17) last — so that anything unfinished is work blocked by someone else's server, not work the author is waiting to see. Nothing is cuttable; an item that cannot land lands as a whole-spec row with its rungs, named in the report.

## Standing rules

All of CLAUDE.md's non-negotiables. The render-default rule. The refresh corollary (a failed fetch never silently empties a previously-full surface). Reactions write-only and never rendered back to readers in any form; your-picks device-local; zip and address are orientation, not identity. Equal-effort-per-candidate. Diagnose before fixing; never assert absence; no empty success; screenshot before believing green — and where a screenshot can lie, measure; stated N equals rendered rows; wall-clock dates via pnpm stamp; a URL cited must have been fetched and verified.
