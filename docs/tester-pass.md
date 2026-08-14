# Tester pass — 2026-08-17, phone width, walked as a stranger

Supersedes the 2026-08-16 pass. Every zip walked at 390×844 (the tester
tests on a phone; her zips first), cold entry through the welcome overlay,
the narrowing modal declined (the stranger's default), every new surface
read and exercised. Driver: `scripts/tester-walk-0817.mts` — the printed
PASS/FAIL log below is its output verbatim; screenshots
`screenshots/walk-<zip>-{1-map,2-door-officials,3-ballot,4-area}.png`.

The stranger test (CLAUDE.md, adopted this session) is the bar: any gap a
stranger would hit is a defect, and the walker knows nothing about any of
the four places by instruction.

## The defect the walk caught and the session fixed

**The door under the drawer (8b's clutter class).** At phone width, a
sidebar-count door opened from the drawer rendered UNDER the drawer's
backdrop — every tap on the door (including Close) was eaten by the
backdrop. Caught mechanically: Playwright's click retry log showed
`.sidebar-backdrop intercepts pointer events` 60 times before timeout;
that log is the "worst stack" record (the stack was untappable, which is
why there is no pretty screenshot of it). Fix: opening a door or the list
overlay dismisses the drawer, in the same adjust-during-render block that
enforces the one-large-surface rule. `walk-*-2-door-officials.png` is the
fixed behavior.

Two more findings during driver construction, not app defects: body-text
checks must be case-insensitive because chrome labels render through
`text-transform: uppercase`, and unattended sessions cannot drive the
in-app Browser pane (no compositing) — the repo's headless Playwright
drivers are the tester harness of record.

## 03255 — Newbury, NH (hers, first)

```
PASS welcome: mission text verbatim
PASS narrowing modal: shown and declinable
PASS map: meetings or honest coverage line
PASS 03255: Newbury no-mayor fact + Select Board members — who-governs select-board block
PASS 03255: Selectboard members named
PASS who-governs: about-area link
PASS door: officials list opens with names
PASS door: closes
PASS ballot: renders contests
PASS ballot: registration link prominent
PASS ballot: office explainer present
PASS ballot: pick control present and distinct
PASS ballot: device-only sentence
PASS ballot: about-area link
PASS 2a: statewide-measure absence stated
PASS 2b: NH card bios render
PASS 4b: executive councilor explainer
PASS 4a: My picks view appears after a tap
PASS about-area: renders state facts
PASS about-area: marijuana answered
PASS about-area: every fact cited
console errors: none
```

What the stranger now gets that they didn't before this session: "Newbury
isn't a city — it has no mayor. The Select Board runs the town." with the
three members named and tappable; the Kearsarge board fully peopled (nine
members, towns, terms); the Executive Council explained as the NH oddity
it is; the earned statement that no statewide question is on the November
ballot; and the mover's page answering the before-you-move questions with
NH-agency citations verified in a real browser.

## 07866 — Rockaway Township, NJ

```
PASS welcome: mission text verbatim
PASS narrowing modal: shown and declinable
PASS map: meetings or honest coverage line
PASS 07866: mayor line renders (roster mayor)
PASS who-governs: about-area link
PASS door: officials list opens with names
PASS door: closes
PASS ballot: renders contests
PASS ballot: registration link prominent
PASS ballot: office explainer present
PASS ballot: pick control present and distinct
PASS ballot: device-only sentence
PASS ballot: about-area link
PASS 2d: no shouting surnames (ROACH→Roach)
PASS 2b: card bios render
PASS 4a: My picks view appears after a tap
PASS about-area: renders state facts
PASS about-area: marijuana answered
PASS about-area: every fact cited
console errors: none
```

New for the stranger here: Mayor Joseph Jackson and the full nine-member
council with per-member phone extensions AND emails (the township
publishes both — the Kelly standard straight from the source); the county
commissioners; ledger-caps surnames rendering as names; candidate cards
with bios and photos on the Senate/House/commissioner races.

## 85701 / 85641 — Tucson and Vail, AZ

```
85701: 16/16 PASS · console errors: none
85641: 16/16 PASS · console errors: none
```

(Same check set minus the state-specific rows; full logs in the driver
output. AZ candidate cards carry links for all 26 candidates and bio/photo
for the governor race — deeper AZ card enrichment is recorded
NOT_ATTEMPTED per the NH/NJ-first directive.)

## Open items — the final session's punch list

1. **Rockaway Township BOE roster is surnames-only** — the district
   publishes members by surname in agendas; its Apptegy site defeated the
   pipeline. Needs an interactive browser session or a call sheet.
2. **gc.nh.gov is unreachable from this environment entirely** (TLS
   fingerprint wall; even the real-browser rung failed here). NH state
   legislator contacts (2c) and CACR docket pages remain unverifiable
   from this machine; the SOS-page absence evidence stands in.
3. **Goodlander's photo** — her House page offers an official-portrait
   download; the URL needs an interactive grab. maggiefornh.com 403s.
4. **Minutes summaries (6a)** are shipped as the structure with the honest
   "not yet summarized" state; the five most recent concluded meetings
   are the seed curation worklist.
5. **FEC (D34)** deferred whole again — the report says so plainly; next
   session's largest item.
6. **The interactive pane cannot run unattended** — if the author wants
   pane-driven walks, they must run attended; headless drivers otherwise.

## What was NOT walked

Reaction submission end-to-end against a live DATABASE_URL (still the
author's Netlify step); the SMS/attestation tiers (T02 — design only, by
standing decision); production deploy surfaces (verified post-ship by URL
instead).
