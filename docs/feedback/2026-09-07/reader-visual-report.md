# Reader visual feedback implementation report — 2026-09-07

## Status

The Reader-owned implementation is ready for code review. Overall acceptance is **not** complete: several rows require shared schema, API, privacy-contract, or canonical-holdings changes that were intentionally not touched in this lane.

- Canonical base: `87f79722ac627839330b2fe9c0485c83339a10f9`
- Branch: `codex/reader-visual-9-7-26`
- Ownership: Reader visual surfaces only
- Admin files changed: none
- Production mutations or deployments: none

## Implemented in this lane

### Ballot and My Picks

- Reworked ballot cards into responsive desktop columns while preserving the vertical office order and independent measure flow.
- Added contest-method-aware selection for vote-for-one, vote-for-N, and a future ordered-choice state shape.
- Made vote-for-one candidate reactions behave as one local selection group: the newest Yes visibly clears the prior Yes and survives reload.
- Fixed derived-pick toggling, clearing, and repeat-Yes restoration without claiming that local state retracts already-written server reaction rows.
- Added the floating Your Picks entry, responsive generated card, Download, Screenshot, Close, keyboard focus trap, and focus return.
- Added a named empty voting-record state when an officeholder has no supported vote store, avoiding blank expanded sections.

### Map, meetings, and responsive composition

- Added reviewable `A_SOFT_LIFT`, `B_MATERIAL_LIFT`, and `C_DEEP_LIFT` state treatments in both themes.
- All three treatments reuse the canonical Arizona geometry with `tolerance: 0`; district paint remains below the exact state seal and labels remain above it.
- Removed map navigation chrome while retaining attribution.
- Implemented the exact phone command order (`ZIP | Ballot | Ask | Vote`) and tablet six-command order (`Ballot | ZIP | Ask | Vote | People | Meetings`) with matching DOM/focus order.
- Kept the tablet district card behavior and collapsed phone boundary details behind the three-button context row.
- Made the three phone context controls discrete pearl pills.
- Prevented expanded ZIP, Ask, voting, and meeting panels from occupying the same responsive grid row.
- Fixed the mobile Ask panel anchor when its CSS grid wrapper uses `display: contents`.
- Added source-backed body-purpose labels only where authoritative descriptions support them; the source link is reachable by keyboard and touch and is no longer nested inside a meeting-row button.
- Applied the Reader Lumen treatment to the major map, meeting, official, entity, and candidate battlecard surfaces.

### Battlecards, statements, social channels, funding, and actions

- Added compact five-category Public Statements bars with independent accessible progress semantics, exact zero-width handling, count-once copy, and overlap caveat.
- Added a dynamic official-channel projection and light/dark badge treatments for supported Facebook, Instagram, X, LinkedIn, YouTube, TikTok, Nextdoor, and newsletter URLs.
- Added source-backed explanations for ActBlue/ActBlue Technical Services and WinRed/WinRed Technical Services; unknown entities stay on the filed FEC classification.
- Added plain one-line explanations for the held official actions while preserving raw details and sources.
- Preserved existing Positions behavior and did not claim that the separate source-depth work is complete.

## Shared-file requests and acceptance blockers

### `SHARED_FILE_REQUEST` — saved picks and server replacement

Rows BAL-51, BAL-53, and BAL-54 require an approved shared contract covering:

- pseudonymous saved-pick schema and immutable migration;
- `/api/picks` save, retrieve, replace, clear, and retention semantics;
- authenticated linkage as a separate opt-in contract;
- privacy/transparency copy and access policy;
- atomic vote-for-one replacement or retraction so Yes(A) then Yes(B) cannot leave both server reaction targets active.

Until that contract lands, this branch truthfully keeps My Picks device-local and does not imply that clearing the local Yes deleted a server aggregate row.

### `SHARED_FILE_REQUEST` — canonical Arizona ballot holdings

DATA-5 and BAL-55 require the canonical ballot-data owner to update generated/pinned holdings, including:

- removal or explicit non-display treatment for withdrawn Proposition 212;
- genuinely concise measure-summary rewrites rather than CSS clamping;
- provision/source reconciliation, integrity hashes, and the requested monitoring proposal.

No generated Arizona ballot holding was edited in this lane.

### `SHARED_FILE_REQUEST` — official and body holdings

OFF-11, BC-35, BC-38, and the remaining WGH-24 coverage require authoritative shared records for:

- state/local office addresses and contact provenance;
- official and body social/newsletter URLs;
- body-purpose definitions for bodies that currently lack an authoritative operational description;
- one canonical identity/contact record used by ballot and map projections.

The UI renders supported held values dynamically; it does not invent missing channels, addresses, or purpose labels.

### `SHARED_FILE_REQUEST` — unified Sources contract

BC-31 and BC-33 require the shared card-source assembler to include every dataset used by a card (PRL, money, votes/actions, office definitions, committees, and contact provenance) and to move PRL attribution to the single Sources presentation without losing required licence text.

### `SHARED_FILE_REQUEST` — section-specific demand signal

BC-36 requires a shared API/schema change so the demand prompt records a selected section, persists acknowledgement per card, uses the accepted acknowledgement copy, and stays dismissed when the card is reopened.

## Validation

- Reader-focused test matrix: **139/139 passed**.
- TypeScript: `tsc --noEmit` passed.
- ESLint on every changed TypeScript/TSX file passed.
- `git diff --check` passed.
- Definitive production build and postbuild Reader trace: passed; 25 static/dynamic pages generated and no trace failures.
- BAL-51 rendered proof at 390×844: prior Yes cleared, newest Yes selected, no conflict, state preserved through reload, and no stale prior-candidate outcome copy.
- MAP-8 rendered proof: A/B/C in light and dark, six cases, exact paint parameters and layer order, zero console/page errors.
- Responsive rendered proof: phone and tablet command order matched visual order and focus order; mobile Ask opened below the command band; all three phone context buttons rendered as separate pills.
- Browser guard: external map-provider access remained blocked and provider quota spend was zero.

## Explicitly open/nonblocking items

- Three-candidate composition and desktop `Where can I vote?` remain TEST/OPEN as directed.
- The large nested Public Statements deep dive remains a separate product branch.
- Positions source-depth work remains separate and is not claimed complete here.
