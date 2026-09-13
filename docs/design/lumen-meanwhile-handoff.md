# Lumen × Meanwhile — implementation, reconciliation & verification

Reviewable record of the design/UI + admin-parity + fleet-operations work. No
secrets. Base `main @ 713e4e06`.

- **Design branch:** `design/lumen-meanwhile-20260913` — the Reader + Admin design layer.
- **Integration branch:** `integration/lumen-fleet-20260913` — the design branch **plus** the
  cherry-picked fleet commit (`58d5cdc7` → `c60be045`) and the Admin consumer for it.
- No push / merge / deploy / production write / live dispatch; PDC untouched.

## 1. Token reconciliation (globals.css)

Package derived from `codex/reader-visual-9-7-26` (PR #303, open); its paths/"as-shipped" claims
are historical and were reconciled against current `globals.css`.

| Token | Current (main) | Change | Purpose | Verification |
| --- | --- | --- | --- | --- |
| `--action` | `#4fc9e8` dark (== `--link`) | dark → **`#43b4d1`**; light `#0a4f61` kept | filled interactive azure | `pnpm contrast`: `--action-on` on `--action` 7.81:1 dark / 8.75:1 light (bar 4.5, filled) |
| `--ring` / `--link-glow` | absent | **added** (`#4fc9e8`/`#17809e`) | hover ring, kept ≠ `--link` so focus stays `--link` | light 4.05:1 > 3:1 graphics floor |
| `--lumen-peak/floor/rim/rim-strong/horizon`, `--dur-lumen`, `--ease-lumen`, `--shadow-app-card` | absent | **added** (dark + re-declared light) | the Lumen material | rendered dark+light |
| `--radius-card` | absent (`--radius` 10) | **added** = `var(--radius)` | card corner | — |
| `--shadow-popup` | `0 10px 40px …` | **enriched** both themes | popup/modal depth | 8 consumers, all in globals.css |
| `--ask` | absent | **added** = `var(--online)` | Ask pearl fill, can diverge later | Pearl reads `--ask` |
| light `--lumen-horizon` | purple `--online` mix | → `var(--ring)` | one horizon language | popup module fixed too |
| `--party-democratic/republican` (fills) | themed (dark light-tints) | **@proposed**: non-themed deep `#2457b8`/`#b3362a`, cream `--party-on` | party CHIP fill | `pnpm contrast`: dem 6.44 / rep 5.80 / green 5.16 / independent 7.09 / none 4.79 (bar **4.5**, filled) |
| `--party-text-*` | absent (main dual-used `--party-*`) | **added** themed = main's former `--party-*` | party as plain text | party text unchanged; `partyColorVar`→text, new `partyFillVar`→fill |

NOT changed: `--text-muted` (app layer, ~40 readers + logo dots); `--mark` (Logo-scoped);
`--online` `#9b7fd4` / `--canceled` `#e17055` (main's audited values kept — the package's
differing values are snapshot drift). Reserved red `#b53c37` not reintroduced (dead dup;
use `#b3362a`). Naming: package `--font-app-mono`→main `--font-mono`; `--radius-card`→`--radius`.

## 2. Contrast — the applicable requirement per use

`scripts/contrast-audit.mts` (`pnpm contrast`, docs/DESIGN.md §sun bar) enforces **two** bars:
- **7:1 (sun bar)** for reader-facing TEXT on a surface (`PAIRS`).
- **4.5:1 (AA)** for a text label ON a filled control (`FILLED`) — "a large, bold, isolated target"
  (contrast-audit.mts line 224).

The **party chip is a FILLED control** (audit lines 125–129), so its applicable bar is **4.5:1**,
which all five fills clear in both themes (4.79–7.09:1). `--action-on`/`--action` clears too.
`pnpm contrast` exits 0 ("all pairs clear their bar"). The hover `--ring` is a graphic (3:1 floor,
light 4.05:1), not on the 7:1 text list; focus uses `--link` (a 7:1 PAIR).
Party-as-TEXT (`--party-text-*`) is unchanged in value and, like the prior `--party-*`, is not in
the audit's PAIRS — a **pre-existing** coverage gap, not introduced here.

## 3. Reader components (design branch)

`contact-pills` (Lumen material, hover ring, focus `--link`), `pill-cluster` (Ballot pair-ring +
20px sheet glyph; Ask Pearl at every placement + speech-bubble glyph), `meeting-status-pill`
(mono→sans register), `jurisdiction-pill` (ring on COULD_GOVERN only; phrase labels kept readable
— the package's tiny-uppercase register was designed for one-word labels), `funding-section` +
`lib/funding/committee-types.ts` (family ring outside the untouched fill; `committeePillLabel`
drops the leading article without touching the prose `label`), `popup-card` tier ring (real `tier`
prop), `candidate-battlecard` (CTA Lumen green; section rows; **real tier** via
`tierForOcdId(contestOcdId)` — neutral when unknown, never guessed). `IdentityChip` already matched
the spec. Verified live (both themes) at `/lumen-preview`, incl. real components mounted
(MeetingStatusPill, IdentityChip, Logo) and CSS specimens.

## 4. PR #302 / #303 reconciliation (design/UI scope)

Main @ 713e4e06 does **not** include either open PR. #303 uses per-component CSS-modules + new
components; the approved design uses one shared token layer + existing global classes.

| PR | Item | Category | Note |
| --- | --- | --- | --- |
| #303 | Lumen material/tokens, glyphs, Pearl-everywhere, party fill/text split, funding article-drop, popup tier, CTA, section rows | **Superseded** | Same intent, done via shared `globals.css` + existing classes (design commits) instead of #303's per-module re-derivation |
| #303 | Second-hop `pill pill--cyan` | **Already on main** | `.pill--cyan` exists in `globals.css` |
| #303 | Social-channel badges + `lib/officials/social-channels.ts`; body-purpose; saved picks + `/api/picks`; map/officials CSS-module reskin; card-composition | **Pending** | Reader-lane; blocked on the shared-file/data contracts named in #303's own body (official/body social holdings, body-purpose defs, saved-pick schema). Not in the approved component language. |
| #302 | Admin `Logo` in header | **Preserved (design branch)** | Wired in `console-nav.tsx` |
| #302 | Nav completeness (all views), queue-card selector fix, refusal/tile UX | **Pending** | Admin-IA/CSS on the `--ce-*` system; co-edits `console-nav.tsx`/`layout.tsx` cleanly with the design branch |
| #302 | Admin design-system boundary | **Superseded** | The parity bridge (below) now points `--ce-*` at the shared tokens |

Backend/data/proof/fleet changes in both PRs are out of design scope and were not enumerated or merged.

## 5. Admin parity

The whole `--ce-*` recipe is unchanged; only the token VALUES are re-pointed at the shared reader
tokens via `var(--shared, <original literal>)` — production (globals.css loaded) gets parity; an
isolated render without globals.css falls back to the admin's original palette (so
`tests/admin-readiness-cell-state` and the 98 admin tests pass). Level cards wear the reader tier
ring; the `.op-badge` operational grammar (fresh=filled, stale=outline, blocked=dashed,
exporting=accent, plus `--canceled`/`--concluded`) carries operational state by SHAPE with its own
labels — never a tier/party/funding hue. The health-grade legend and chart bar tone stay
admin-local. Verified live both themes at `/lumen-admin-preview`. Supersedes ADM-21 per the newer
ADMIN-PARITY directive; the shared `Logo` is consumed in the shell.

## 6. Fleet operations — producer → consumer (integration branch)

Consumes the fleet session's committed `fleet-operations/v1` contract
(`lib/control-plane/fleet-operations.ts`, `GET /api/admin/fleet/operations`) — no competing
interface. Consumer: `lib/admin/fleet-operations-view.ts` (pure honesty logic) +
`components/admin/fleet-operations-panel.tsx` (on-demand fetch; the 8s heartbeat in
`app/api/admin/live` is untouched). Honesty rules honored and tested:
delivery≠source freshness; HTTP 200 ≠ every section measured; publication UNKNOWN in v1;
acquired≠published; heartbeat≠progress; unknown/incomplete spending never $0; next prerequisite ≠
dispatch time; retain-timestamp on a failed refresh (never restamp); unknown version refused.
`tests/fleet-operations-consumer.test.ts` drives the REAL read service against in-memory repos and
folds its output through the consumer (the contract's required producer→consumer test) — 5/5 pass;
the fleet's own tests pass here too (16/16). ZIP preparation (`fleet/zip-preparation@1`) rendered as
inactive PREPARATION_ONLY with evidence dates + limitations: historical TIER_0/people:0 not shown as
live coverage; `requiredFreshAcquisition:[]` not shown as acquired; activation NOT_AUTHORIZED.

## 7. Remaining backend dependencies (post-integration)

The contract itself scopes these to the fleet/PDC owners (not this assignment):
- **Publication truth:** v1 `publication.status` is UNKNOWN; a future per-record promotion +
  served-reader-proof join must carry item/result/artifact identity. Consumer already renders UNKNOWN.
- **Runner liveness:** the report is work-item operations, not runner heartbeat; "is the runner
  connected" stays the existing cheap `/api/admin/live` pulse. Consumer keeps them separate.
- **Live verification:** actual admission/recovery/cost-attribution/served-output proof requires the
  integration owner to deploy and read production records. This assignment did none.
- **ZIP live expansion:** disabled; the queue is preparation evidence only.

## 8. Verification & reproduction

- `npx tsc --noEmit` — clean. `npx eslint <changed files>` — clean.
- `pnpm contrast` — exits 0 (all bars).
- Targeted tests (design): party, pill-colors, funding, brand, focus-visible, battlecard, jurisdiction,
  pill-cluster, pill-sizing, motion-tokens, small-popup, who-governs, amber-remnant, admin-* — pass.
- Fleet: `tests/fleet-operations*.test.ts`, `tests/zip-queue.test.ts`, `tests/fleet-operations-consumer.test.ts` — pass.
- Live: `next dev` (isolated port 3187) → `/lumen-preview` (Reader) and `/lumen-admin-preview`
  (Admin + fleet). Screenshots captured dark + light; contrast + focus measured via Playwright.
  Preview routes are git-excluded dev harnesses.
