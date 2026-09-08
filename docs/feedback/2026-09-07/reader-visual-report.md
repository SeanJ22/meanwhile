# Reader visual feedback implementation report — 2026-09-07

## Status

The Reader-local closure work is complete and ready for owner review. Overall
acceptance is **not** complete: several rows require shared schema, API,
privacy-contract, canonical-holdings, or generated-manifest reconciliation
that was intentionally not touched in this lane.

- Canonical base: `87f79722ac627839330b2fe9c0485c83339a10f9`
- Branch: `codex/reader-visual-9-7-26`
- Remote PR #303 head: `375a68760d7ebc88d15d8531718201eadf8332f5`
- Local closure evidence head before this report-only update:
  `c6eba445dc3623402e09b3e7e189ad497e186820`
- Ownership: Reader visual surfaces only
- Admin files changed: none
- Production mutations or deployments: none
- Rebase or merge performed: none
- Push status: intentionally withheld; the draft-CI cost amendment was not
  landed or open when audited, so the new local commits have not triggered the
  currently expensive PR checks.

## Implemented in this lane

### Ballot and My Picks

- Reworked ballot cards into responsive desktop columns while preserving the vertical office order and independent measure flow.
- Added contest-method-aware selection for vote-for-one, vote-for-N, and a future ordered-choice state shape.
- Made vote-for-one candidate reactions behave as one local selection group: the newest Yes visibly clears the prior Yes and survives reload.
- Fixed derived-pick toggling, clearing, and repeat-Yes restoration without claiming that local state retracts already-written server reaction rows.
- Added the floating Your Picks entry, responsive generated card, Download, Screenshot, Close, keyboard focus trap, and focus return.
- Added a named empty voting-record state when an officeholder has no supported vote store, avoiding blank expanded sections.
- Added three development-only, exactly-three-candidate desktop review layouts:
  A is three equal columns, B is an equal-width centered 2+1 composition, and C
  is three equal full-width rows. Candidate DOM order is unchanged, and absent,
  invalid, responsive, or production input retains the established production
  layout.

### Map, meetings, and responsive composition

- Kept `A_SOFT_LIFT`, `B_MATERIAL_LIFT`, and `C_DEEP_LIFT` as development-only
  review treatments in both themes. Missing or invalid input now selects no
  experiment; production always uses the established non-experimental state
  relief instead of silently defaulting to B.
- All three treatments reuse the canonical Arizona geometry with `tolerance: 0`; district paint remains below the exact state seal and labels remain above it.
- Removed map navigation chrome while retaining attribution.
- Implemented the exact phone command order (`ZIP | Ballot | Ask | Vote`) and tablet six-command order (`Ballot | ZIP | Ask | Vote | People | Meetings`) with matching DOM/focus order.
- Kept the tablet district card behavior and collapsed phone boundary details behind the three-button context row.
- Made the three phone context controls discrete pearl pills.
- Prevented expanded ZIP, Ask, voting, and meeting panels from occupying the same responsive grid row.
- Fixed the mobile Ask panel anchor when its CSS grid wrapper uses `display: contents`.
- Added source-backed body-purpose labels only where authoritative descriptions support them; the source link is reachable by keyboard and touch and is no longer nested inside a meeting-row button.
- Applied the Reader Lumen treatment to the major map, meeting, official, entity, and candidate battlecard surfaces.
- Added development-only desktop `Where can I vote?` placements: A standalone
  at top right, B as the fourth command-cluster segment, and C as a full-width
  row under the cluster. Each placement reuses one Vote control and preserves
  one-at-a-time panel behavior. Responsive and production requests retain the
  established placement.

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

### `SHARED_FILE_REQUEST` — generated state-manifest reconciliation

PR #303's gates job fails only at `state-manifest --check`; both build jobs and
the immediately preceding holdings check pass. The Reader diff adds four social
channel fields to shared `lib/officials/types.ts`, which is an input to every
generated state digest. That makes all 56 manifests stale (`7ce44f01...`
committed versus `fe20f334...` expected); Arizona's 2,184-line manifest differs
only on the digest line, not in holdings content. The PDC/shared owner must
reconcile the shared type or regenerate manifests after integration. This
Reader-local pass did not edit generated manifests, infrastructure, workflows,
middleware, schema, Admin, or civic-data-plane files.

## Validation

- Reader-focused test matrix: **139/139 passed**.
- Closure-focused tests: **28/28 passed** (21 map/one-at-a-time and 7 ballot
  composition cases).
- TypeScript: `tsc --noEmit` passed.
- ESLint on every changed TypeScript/TSX file passed.
- `git diff --check` passed.
- Definitive production build and postbuild Reader trace: passed; 25 static/dynamic pages generated and no trace failures.
- BAL-51 rendered proof at 390×844: prior Yes cleared, newest Yes selected, no conflict, state preserved through reload, and no stale prior-candidate outcome copy.
- MAP-8 rendered proof: A/B/C in light and dark, six cases, exact paint parameters and layer order, zero console/page errors.
- Responsive rendered proof: phone and tablet command order matched visual order and focus order; mobile Ask opened below the command band; all three phone context buttons rendered as separate pills.
- Browser guard: external map-provider access remained blocked and provider quota spend was zero.
- Rendered closure evidence: 16 original-resolution captures covering ballot
  A/B/C desktop, production phone/tablet ballot flow, map A/B/C in both themes,
  all three open Vote panels, and production phone/tablet map composition. No
  horizontal clipping, duplicate Vote control, or responsive command-order
  regression was observed. Google Fonts were unavailable on the capture host,
  so the application fallback fonts were used.
- Controlled before/after evidence: 80 cold load samples and 12 cold fly samples
  in sequential ABBA order. All targets were reached and every repository
  budget passed. Pooled medians before -> after were desktop ballot 175 ->
  160 ms, desktop map first marker 905 -> 830 ms, phone ballot 175 -> 180 ms,
  phone map first marker 575 -> 545 ms, FCP 136 -> 114 ms, LCP 298 -> 258 ms,
  and map ready 268.5 -> 229 ms. The 5 ms phone-ballot increase is within local
  run noise. See `reader-closure-evidence/PERFORMANCE.md` for protocol and
  limitations.

## Explicitly open/nonblocking items

- Three-candidate, desktop Vote-placement, and raised-state A/B/C remain
  presentation-only owner-review choices. They are complete as test variants,
  but no experimental choice has been promoted to the production default.
- The large nested Public Statements deep dive remains a separate product branch.
- Positions source-depth work remains separate and is not claimed complete here.

## Local closure commits

- `29c43b8343fc97baa4b211d12dd000471c777cd5` — keep raised-state variants
  review-only.
- `60e78fdabcecaf5ce9923320641b7c35f7aafded` — add desktop voting-placement
  variants.
- `b19e638b1fb5dab543e965c6acbe6293638962dd` — add three-candidate ballot
  layouts.
- `526d2b661b9fa3ee8ba29330a28431256ddb0b86` — add rendered closure evidence.
- `c6eba445dc3623402e09b3e7e189ad497e186820` — add controlled before/after
  performance evidence.

The final report-only commit SHA is reported in the handoff outside this file.

## Complete changed-file inventory versus canonical base

`A` means added and `M` means modified. The inventory contains 100 files; this
report-only update does not add another path.

```text
M app/ballot/page.tsx
M components/address/jurisdiction-pill.tsx
A components/ballot/candidate-battlecard.module.css
M components/ballot/candidate-battlecard.tsx
A components/ballot/candidate-card.module.css
M components/ballot/candidate-card.tsx
A components/ballot/my-picks.module.css
M components/ballot/my-picks.tsx
A components/ballot/pick-control.module.css
M components/ballot/pick-control.tsx
A components/ballot/picks-card.module.css
M components/ballot/picks-card.tsx
M components/funding/funding-section.tsx
A components/map/body-purpose-label.tsx
M components/map/coverage-notice.tsx
M components/map/district-toggle.tsx
M components/map/door-overlay.tsx
M components/map/governing-skeleton.tsx
M components/map/list-overlay.tsx
M components/map/location-bar.tsx
M components/map/map-canvas.tsx
A components/map/map-entry.module.css
M components/map/map-entry.tsx
M components/map/meeting-panel.tsx
M components/map/popup/entity-modal.tsx
M components/map/popup/lumen-popup.module.css
M components/map/popup/meeting-popup.tsx
M components/map/popup/official-modal.tsx
M components/map/popup/official-popup.tsx
M components/map/voting-sites-panel.tsx
M components/map/welcome-overlay.tsx
M components/map/zip-switcher.tsx
M components/officials/channel-marks.tsx
M components/officials/contact-pills.tsx
A components/officials/official-actions.module.css
M components/officials/official-actions.tsx
A components/officials/public-statements-profile.module.css
M components/officials/public-statements-profile.tsx
A components/officials/social-channel-badges.module.css
A components/officials/social-channel-badges.tsx
A components/officials/social-channel-mark.tsx
M components/reactions/reaction-control.tsx
M components/shell/pill-cluster.tsx
A docs/feedback/2026-09-07/reader-closure-evidence/PERFORMANCE.md
A docs/feedback/2026-09-07/reader-closure-evidence/README.md
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-ballot-a-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-ballot-b-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-ballot-c-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-ballot-phone.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-ballot-tablet.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-a-dark-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-a-light-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-a-vote-open-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-b-dark-desktop-state.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-b-light-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-b-vote-open-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-c-dark-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-c-light-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-c-vote-open-desktop.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-phone.png
A docs/feedback/2026-09-07/reader-closure-evidence/reader-closure-map-tablet.png
A docs/feedback/2026-09-07/reader-visual-report.md
M hooks/use-compact-map.ts
A hooks/use-desktop-vote-placement-variant.ts
A hooks/use-raised-state-variant.ts
M lib/ballot/derived-picks.ts
M lib/ballot/pick-tally.ts
M lib/ballot/picks.ts
A lib/ballot/selection-method.ts
A lib/ballot/three-candidate-review.ts
A lib/funding/contributor-entity.ts
A lib/map/body-purpose.ts
M lib/map/districts.ts
A lib/map/meeting-area-label.ts
A lib/map/raised-state-variants.ts
A lib/map/reader-review-variants.ts
M lib/map/state-relief.ts
M lib/officials/executive-actions.ts
M lib/officials/reader-actions.ts
A lib/officials/social-channels.ts
M lib/officials/types.ts
A lib/officials/vote-record.ts
M lib/reactions/client.ts
M lib/sources/prl/snapshot.ts
M tests/ballot-desktop-composition.test.ts
M tests/ballot-picks.test.ts
M tests/battlecard-pill.test.ts
A tests/body-purpose.test.ts
M tests/could-govern-pill.test.ts
M tests/derived-picks.test.ts
M tests/jurisdiction-note.test.ts
A tests/jurisdiction-pill-trigger.test.ts
M tests/one-at-a-time.test.ts
M tests/pick-tally.test.ts
M tests/reactions.test.ts
A tests/reader-contributor-entity.test.ts
A tests/reader-map-visual-9-7.test.ts
M tests/reader-official-actions.test.ts
M tests/reader-prl-delivery.test.ts
A tests/reader-social-channels.test.ts
```
