# Tester pass — 2026-08-14 (third session of 2026-08-14), phone width, walked as a stranger

Supersedes the second-session pass. This session executed the outside
tester's recorded feedback; every changed surface walked at 390×844, cold
entry through the welcome overlay, all four zips plus the uncovered-zip
refusal at 85723. Driver: `scripts/tester-walk-0814c.mts` — the PASS/FAIL
counts below are its output; screenshots `screenshots/walk0814c-<zip>-*.png`.
All dates in this document are wall clock.

**136 checks green: 85701 32/32 · 07866 34/34 · 03255 31/31 · 85641
31/31 · 85723 8/8.**

## The item-1 gate, passed with the screenshot

At 07866, the Rockaway Township mayor's full card
(`walk0814c-07866-mayor-GATE.png`): **Joseph Jackson, LOCAL · MAYOR, no
Tucson content anywhere on the card**, the jurisdiction-neutral office
blurb ("how much day-to-day power a mayor has depends on the city's own
charter"), phone 973-627-7200, official page rockawaytownship.org.
Spot-verified against the township's own About-the-Mayor page in a real
browser this session (Mayor Joe Jackson, in office since February 2022).
The cause was the per-office-TYPE mayor blurb carrying Tucson's charter
copy and Tucson's charter hyperlink — one jurisdiction's content bound to
another jurisdiction's key. Tucson's verified copy now lives in a
per-division override and renders only for Tucson's mayor; the
cross-jurisdiction guard (`tests/jurisdiction-content.test.ts`) audits
every curated roster, curated body, and everyday contact mechanically —
the mayor blurb was the only contamination found.

## The walk's own catch: overlays were killing themselves at phone width

The biggest finding of the session came from clicking instead of
believing green: **the large official modal could not open at any phone
viewport, on the map and the ballot both.** The back-button-closes-modal
behavior pushed `{overlay:true}` onto `window.history`; Next's App Router
owns history, and the push re-renders the route and remounts the island
holding the modal's open state — the modal died the tick it opened.
Proven by toggling exactly that line: works at 1280px (the effect skips),
dies at 390px, with both push shapes. This was the prior session's queued
"hydration live, click dead" item on the incumbent record link — and it
meant phone readers could not open any official's full card. The pattern
is removed from the official modal, the entity modal, and the list
overlay; Escape, the close control, and backdrop click all close.

## What each zip proved

Per zip (except where noted): the first-run tour appears once, is
skippable at every step, and never reappears (walked whole at 85701,
5 of 5 steps); the who-governs card groups LOCAL → STATE → FEDERAL,
closest-first, "Federal" never "National"; the state's governor renders
under STATE with a working contact and the honesty line ("The governor is
the only statewide office listed so far"); all six district types default
ON with the overlay master on; the officials door groups in the same
three tiers and includes the local rosters the old flat list omitted; a
federal official's card shows "How the parties voted" with real numbers
and no characterization; the ask-box beat holds ~3 seconds with the
answer withheld for the duration; the ballot opens on THE NEXT ELECTION
with one-tap add-to-calendar, the registration deadline and link, early
voting dates, and "Everyone below is on this ballot." (the propositions
sentence only where propositions exist); the single Add-to-calendar
control opens the Apple/Google/Outlook popup (the two-link render is
gone); the incumbent-record modal OPENS (the prior session's unproven
item, now proven); the picks card renders as a screenshot-ready image
with the download offer and the nothing-is-sent line; Clear-my-picks
confirms then clears.

Zip-specific: 03255 names **Kearsarge Regional** on who-governs and its
school layer draws by default (the tester asked for it by name and the
map never showed it — the layer defaulted off; diagnosis: default layer
selection, not the registry join and not geometry). 07866 carries the
item-1 gate above and governor **Mikie Sherrill**. 85701/85641 carry
governor **Katie Hobbs** and the AZ propositions sentence. 85723 (outside
the curated everyday map): "pothole in front of my house" routes to
**Tucson** — the city, the correct general owner — with the honest
who-sits-on-it gap, and **the Public Housing Authority never appears in
the routed answer** (it was the answer in production; the join now
matches only a division's own governing body).

## Governor verification (2b), done before ship

All three state sites wall plain clients; each was read in a real
browser this session (rungs in `docs/source-ladder.md`): AZ — "Office of
the Arizona Governor Katie Hobbs", 602-542-4331 and engage@az.gov off the
constituent-services page (the draft's contact path 404'd and was
corrected); NH — "Welcome | Governor Kelly Ayotte", 603-271-2121
published; NJ — "Office of New Jersey Governor Mikie Sherrill", which
publishes **no phone** — the row ships the live contact form and a null
phone, because an absence is an absence.

## Honest notes

- The walk runs headless (the session was unattended); screenshots are
  the walk's own captures, and the gate image was verified by eye in the
  session log. Production re-verification after deploy is recorded in the
  session report.
- The "Mayor · Mayor" seat-label echo caught on the gate screenshot was
  suppressed (a label identical to the office title is noise).
- Console: the only errors during walks are MapLibre WebGL performance
  warnings, pre-existing.
