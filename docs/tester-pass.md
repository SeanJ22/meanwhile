# Tester pass — 2026-08-18 (final), phone width, walked as a stranger

Supersedes the 2026-08-17 pass. Every zip walked at 390×844 (the tester
tests on a phone; her zips first), cold entry through the welcome overlay,
the narrowing modal declined (the stranger's default), every surface of
this session's build read and exercised on top of everything the prior
pass covered. Driver: `scripts/tester-walk-0818.mts` — the printed
PASS/FAIL logs below are its output verbatim; screenshots
`screenshots/walk18-<zip>-*.png`. Wall clock for this session is
2026-08-14; the session label is 2026-08-18.

**89 checks green across the four zips, zero console errors.**

New this session, all in the walk: the Funding sections (D34 — committee
totals in plain sentences, contributor lists as filed, reaction controls,
earned absences, the state-systems note), the wired Sunnyside and
Amphitheater boards with their people (D39), the Rockaway Township BOE
full names (4a), the NH legislator directory contacts (item 3), and
Goodlander's portrait on her ballot card (4b).

## 03255 — Newbury, NH (hers, first) — 25/25

```
PASS welcome: mission text verbatim
PASS narrowing modal: shown and declinable
PASS map: meetings or honest coverage line
PASS 03255: Newbury no-mayor fact + Select Board members — who-governs select-board block
PASS 03255: Selectboard members named
PASS who-governs: about-area link
PASS door: officials list opens with names
PASS door: closes
PASS 3: NH legislator contact renders (phone + email)
PASS ballot: renders contests
PASS ballot: registration link prominent
PASS ballot: office explainer present
PASS ballot: pick control present and distinct
PASS ballot: device-only sentence
PASS ballot: about-area link
PASS D34: funding sections on federal candidates — 19 sections, 9 total-reactions, 9 contributor lists
PASS D34: state races carry the honest state-systems note — 10 notes
PASS 2a: statewide-measure absence stated
PASS 2b: NH card bios render
PASS 4b: executive councilor explainer
PASS 4b: Goodlander portrait on her card
PASS 4a: My picks view appears after a tap
PASS about-area: renders state facts
PASS about-area: marijuana answered
PASS about-area: every fact cited
console errors: none
```

What the stranger now gets that they didn't before this session: Greg
Sargent's and Karen Ebel's cards carry the General Court directory's own
phone and email (the wall didn't come down — the directory was reached
through the Archive's capture of the legislature's own download); every
federal candidate on the huge NH ballot shows campaign money or an earned
"no money reported" with the FEC-registration explanation; and
Goodlander's card has her public-domain official portrait.

## 07866 — Rockaway Township, NJ — 24/24

```
PASS welcome: mission text verbatim
PASS narrowing modal: shown and declinable
PASS map: meetings or honest coverage line
PASS 07866: mayor line renders (roster mayor)
PASS who-governs: about-area link
PASS list: Rockaway BOE full names row present
PASS card: Rockaway BOE full names render
PASS door: officials list opens with names
PASS door: closes
PASS ballot: renders contests
PASS ballot: registration link prominent
PASS ballot: office explainer present
PASS ballot: pick control present and distinct
PASS ballot: device-only sentence
PASS ballot: about-area link
PASS D34: funding sections on federal candidates — 7 sections, 4 total-reactions, 4 contributor lists
PASS D34: state races carry the honest state-systems note — 4 notes
PASS 2d: no shouting surnames (ROACH→Roach)
PASS 2b: card bios render
PASS 4a: My picks view appears after a tap
PASS about-area: renders state facts
PASS about-area: marijuana answered
PASS about-area: every fact cited
console errors: none
```

New for the stranger here: the Board of Education's seven members with
full names, roles, terms, and per-member emails (from the district's own
board-members page — the surnames-only defect is closed), reachable from
the BOE meeting card; Booker's and every other federal candidate's
campaign money with contributors as filed.

## 85701 — Tucson, AZ — 21/21 · 85641 — Vail, AZ — 19/19

```
85701:
PASS list: Sunnyside board + members row present
PASS card: Sunnyside board + members render
PASS D34: funding sections on federal candidates — 2 sections, 2 total-reactions, 2 contributor lists
(… full check set green; log in the driver output)

85641:
PASS D34: funding sections on federal candidates — 4 sections, 3 total-reactions, 2 contributor lists
PASS D34: an earned absence renders with its reason
(… full check set green; log in the driver output)
```

New for the stranger in Tucson/Vail: Sunnyside's board meetings are pins
downtown with the five members named on the card (the author's catch,
closed); Amphitheater's board reaches the reader through its district
with the roster (verified separately — `wiring-amphitheater-85701.png`);
Ciscomani's official modal carries the full Funding section
(`funding-ciscomani-modal.png`); Gary Swing's no-filings state renders as
an earned absence with the FEC-registration explanation, never silence.

## Defects the walk caught and the session fixed

1. **The school-board roster hole (M31-class).** The district popup's
   roster lookup was `#governing`-only while school boards are `#board` —
   every school district, TUSD included, rendered "no sourced
   officeholder" over a curated roster. Fixed with the both-suffix
   division lookup, wired into the district popup, the meeting-popup
   fallback, and `holdersFor`; test-pinned.
2. **Stale dev-server module after enrichment** — walk harness finding,
   not an app defect: the NH phone numbers appeared only after a server
   restart. Production builds fresh; nothing to fix in the app.
3. **Two harness findings** recorded in the driver: the sidebar is an
   `aside` too (venue-panel selectors must scope by aria-label), and the
   bottom sheet's scroll container stalls Playwright's scroll-into-view
   for rows a human can simply tap — clicks dispatch in the DOM.

## Open items — none blocking the tester

1. **Grijalva and Mejia portraits** — still 404 in the public-domain
   repo; the Congress.gov depiction is license-unknown and stays
   unshippable. Initials render. Re-run `pnpm officials:photos` after the
   next pictorial-directory update.
2. **NH legislator photos** — behind the gc.nh.gov wall; recorded miss.
3. **21 NH members not matched by the archived directory** (nickname
   collisions, post-capture seatings) keep their CSV fields; misses
   printed by `pnpm officials:enrich`.
4. **Minutes summaries** exist for the two concluded meetings with
   published minutes (Pima 7/28, Morris 7/22); the rest of the window
   renders the honest not-yet state — minutes lag sittings by design.
5. **FEC ripcords** — the build ships whole; counsel closes the flags
   (D23). `ripcord.fundingReactionsInAggregates` ships PULLED.
6. **The interactive pane cannot run unattended** — headless Playwright
   drivers remain the tester harness of record.

## What was NOT walked

Reaction submission end-to-end against a live DATABASE_URL (still the
author's Netlify step — includes the new FUNDING_TOTAL_REACTION and
CONTRIBUTOR_REACTION writes); the SMS/attestation tiers (T02 — design
only, by standing decision); production deploy surfaces (verified
post-ship by URL instead).
