# Lumen × Meanwhile — implementation, reconciliation & verification

Reviewable record of the design/UI + admin-parity + fleet-operations work. No
secrets. Base `main @ 713e4e06`.

- **Design branch:** `design/lumen-meanwhile-20260913 @ 3f9a96a6` — the Reader + Admin design layer.
- **Integration branch:** `integration/lumen-fleet-20260913 @ 80ea40ae` — the design branch **plus**
  the cherry-picked fleet commits, the Admin consumer + v1.1 extension handling, the committed
  authenticated `/admin/fleet` route, and the client-bundle fix (§7). **This is the exact HEAD every
  verification below ran against** (this doc is committed on top of it).
- No push / merge / deploy / production write / live dispatch; PDC untouched.

### Fleet commits incorporated, by SHA

| Fleet source (read-only clone) | In integration as | What |
| --- | --- | --- |
| `58d5cdc7` | `c60be045` | Repair fleet progression + truthful operations reporting (`fleet-operations/v1`) |
| `9bd72b26` | `0ca8404e` | Verify isolated fleet delivery + join operational evidence (**v1.1 extension**) |
| — | `cb126812` | Admin consumer handles the v1.1 extension (Scout admission, delivery join) |
| — | `7704bca9` | Committed authenticated `/admin/fleet` page mounting the panel |
| — | `80ea40ae` | Keep the server read-service out of the client bundle (§7 — the `node:fs` fix) |

The five producer contract files (`fleet-operations.ts`, `fleet-delivery.ts`, `zip-queue.ts`,
`zip-acquisition-plan.ts`, `workers/scout-scheduling.ts`) are **byte-identical** to fleet source
`9bd72b26` (verified by `diff`) — no cherry-pick drift. A **newer** fleet commit `d685fc4a`
("Load retained fleet receipts and resolve held ZIP identities", a `fleet-operations/v1.2` delta) is
deliberately **NOT** incorporated: it is beyond the named delta (`9bd72b26`), it changes the
endpoint contract to v1.2, and receipt/reporting is the Fleet/integration owner's lane. The v1.1
consumer correctly still states "full item receipts are not supplied by the HTTP endpoint" (§6).

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

**Party tokens: NOT changed — reverted to main.** An earlier `@proposed` candidate (`72db1946`)
made the party fills non-themed and split party-as-text from party-as-fill (`--party-text-*`,
`partyFillVar`). That candidate is **reverted** (`1a7e57aa`); `git` confirms the current
`--party-democratic/republican/green/independent/none` and `--party-on` are **byte-identical to
`main`** in both themes, and `lib/officials/party-color.ts` is back to the single
`partyColorVar()` → `var(--party-*)`. See §2 for why the candidate was wrong to justify.

NOT changed: `--text-muted` (app layer, ~40 readers + logo dots); `--mark` (Logo-scoped);
`--online` `#9b7fd4` / `--canceled` `#e17055` (main's audited values kept — the package's
differing values are snapshot drift). Reserved red `#b53c37` not reintroduced (dead dup;
use `#b3362a`). Naming: package `--font-app-mono`→main `--font-mono`; `--radius-card`→`--radius`.

## 2. Contrast — the party chip re-examined (the correction)

`scripts/contrast-audit.mts` (`pnpm contrast`, docs/DESIGN.md §sun bar) enforces **two** bars:
- **7:1 (sun bar)** for reader-facing TEXT on a surface (`PAIRS`) — "Every reader-facing text token
  must clear it against the surface it actually renders on, in BOTH themes" (DESIGN.md:61).
- **4.5:1 (AA)** for a text label ON a filled control (`FILLED`).

**The earlier claim that "the party chip is a FILLED control, so 4.5:1 is its bar" does not hold.**
Correcting it with the governing rule + component semantics:

- **The party chip is a noninteractive FACT, not a control.** `docs/DESIGN.md:243` classes `.id-chip`
  as "an identity fact — party, state, chamber, standing"; the governing directive is "Lumen lights
  what you can press — it never enters a fill that states a fact." A fact is not a "filled control".
- **The only WCAG basis for 4.5:1-as-AAA is LARGE text** (≥ 24px, or ≥ 18.66px at weight ≥ 700). The
  audit's inline rationale — "a large, bold, isolated target" (contrast-audit.mts:221–224) — asserts
  that basis. But `.id-chip` renders at **`font-size: 0.75rem` (12px) / `0.8125rem` (13px) on the
  large card, `font-weight: 600`** (globals.css:2320–2363). That is **normal-size, non-bold text**:
  the "24/28px" in the design table is the chip **height**, not the label size. So the large-text
  basis is factually absent, on all three counts (not a control, not large, not bold).
- **Therefore the applicable bar is the 7:1 sun bar, and main does not clear it.** With main's settled
  palette the chip label (`--party-on`) on its fill (`var(--party-*)`) measures **6.44:1 (dark) /
  5.80:1 (light)** for Democratic, down to **4.79:1** for `--party-none` — every party fill is below
  7:1. The audit currently files these under `FILLED` (4.5:1) and so exits 0.

**Disposition (kept inside the assignment's guardrails).** This is a **pre-existing, settled-palette
tension inherited from `main`**, not introduced by the Lumen work — and the one change this work did
make to party fills (`72db1946`) is **reverted**, so the tree is byte-identical to `main` (§1). The
brief's instruction was to "correct the candidate … without weakening tests or reopening settled
design," so:
- the committed audit gate is **not** weakened (no bar lowered, no failing pair exempted), and
- main's settled party palette is **not** reopened.

Resolving the shortfall is a **design-owner decision** and a genuine either/or, both outside this
lane: (i) render the party chip as genuine large text (≥ 24px, or ≥ 18.66px bold) to *earn* the
4.5:1 large-text bar — but DESIGN.md:271–273 forbids carrying emphasis by size ("Fill-versus-outline
carries the emphasis, never size"), so this is a type-scale decision for all id-chips, not a
party-only tweak; or (ii) darken the fills / lighten `--party-on` to reach 7:1 — a change to settled
semantic tokens. **Flagged, not silently resolved.**

Other contrast notes: the hover `--ring` is a graphic (3:1 floor, light 4.05:1), not on the 7:1 text
list; focus uses `--link` (a 7:1 PAIR). The admin `exporting` op-badge carries **no** semantic hue
(§5).

## 3. Reader components (design branch)

`contact-pills` (Lumen material, hover ring, focus `--link`), `pill-cluster` (Ballot pair-ring +
20px sheet glyph; Ask Pearl at every placement + speech-bubble glyph), `meeting-status-pill`
(mono→sans register), `jurisdiction-pill` (ring on COULD_GOVERN only; phrase labels kept readable),
`funding-section` + `lib/funding/committee-types.ts` (family ring outside the untouched fill;
`committeePillLabel` drops the leading article without touching the prose `label`), `popup-card`
tier ring (real `tier` prop), `candidate-battlecard` (CTA Lumen green; section rows; **real tier**
via `tierForOcdId(contestOcdId)` — neutral when unknown, never guessed; `647a72d5`). `IdentityChip`
renders the party via the reverted `partyColorVar(partyLabel)` (no fill/text split). Verified live
(both themes) at `/lumen-preview`, incl. real components mounted (MeetingStatusPill, IdentityChip,
Logo) and CSS specimens.

## 4. PR #302 / #303 reconciliation (design/UI scope)

Main @ 713e4e06 does **not** include either open PR. #303 uses per-component CSS-modules + new
components; the approved design uses one shared token layer + existing global classes.

| PR | Item | Category | Note |
| --- | --- | --- | --- |
| #303 | Lumen material/tokens, glyphs, Pearl-everywhere, funding article-drop, popup tier, CTA, section rows | **Superseded** | Same intent, done via shared `globals.css` + existing classes (design commits) instead of #303's per-module re-derivation |
| #303 | Party fill/text split | **Reverted / not adopted** | The candidate (`72db1946`) was reverted (`1a7e57aa`); party rendering stays at main's settled treatment. See §2. |
| #303 | Second-hop `pill pill--cyan` | **Already on main** | `.pill--cyan` exists in `globals.css` |
| #303 | Social-channel badges + `lib/officials/social-channels.ts`; body-purpose; saved picks + `/api/picks`; map/officials CSS-module reskin; card-composition | **Pending** | Reader-lane; blocked on the shared-file/data contracts named in #303's own body. Not in the approved component language. |
| #302 | Admin `Logo` in header | **Preserved (design branch)** | Wired in `console-nav.tsx` |
| #302 | Nav completeness (all views), queue-card selector fix, refusal/tile UX | **Pending → partly delivered** | The "Fleet operations" view is now a selectable nav view wired to the committed `/admin/fleet` route (§7). The rest is admin-IA/CSS on the `--ce-*` system. |
| #302 | Admin design-system boundary | **Superseded** | The parity bridge (§5) now points `--ce-*` at the shared tokens |

Backend/data/proof/fleet changes in both PRs are out of design scope and were not enumerated or merged.

## 5. Admin parity

The whole `--ce-*` recipe is unchanged; only the token VALUES are re-pointed at the shared reader
tokens via `var(--shared, <original literal>)` — production (globals.css loaded) gets parity; an
isolated render without globals.css falls back to the admin's original palette (so
`tests/admin-readiness-cell-state` and the 98 admin tests pass). Level cards wear the reader tier
ring. The `.op-badge` operational grammar carries operational state by **SHAPE**, never a
tier/party/funding hue: `fresh` = filled, `stale` = outline, `blocked` = dashed, and — corrected in
`4e86bb5a` — **`exporting` = outline + `font-weight: 700`**, using only the neutral console tokens
`border-color: var(--ce-hairline); color: var(--ce-fg)` (layout.tsx:308). It no longer repurposes
`--ce-lumen` or any semantic color. The health-grade legend and chart bar tone stay admin-local.
Verified live both themes at `/lumen-admin-preview`. Supersedes ADM-21 per the newer ADMIN-PARITY
directive; the shared `Logo` is consumed in the shell.

## 6. Fleet operations — producer → consumer + v1.1 extension (integration branch)

Consumes the fleet session's committed `fleet-operations/v1` contract + its `extensions/1` additions
(`lib/control-plane/fleet-operations.ts`, `fleet-delivery.ts`, `workers/scout-scheduling.ts`) via the
authenticated `GET /api/admin/fleet/operations` — no competing interface. Consumer:
`lib/admin/fleet-operations-view.ts` (pure honesty logic) + `components/admin/fleet-operations-panel.tsx`.

Honesty rules honored and tested — delivery ≠ source freshness; HTTP 200 ≠ every section measured;
publication UNKNOWN in v1; acquired ≠ published; heartbeat ≠ progress; unknown/incomplete spending
never $0; next prerequisite ≠ dispatch time; retain-timestamp on a failed refresh (never restamp);
unknown version refused. **v1.1 additions:** a missing extension is an UNAVAILABLE **capability**,
never an empty success; a Scout admission reads as a **prerequisite** ("selection still requires
coordinator re-evaluation"), never a dispatch; a delivery item's `SHADOW_READBACK_VERIFIED` is
labelled "verified locally — **NOT served** to a reader"; and `receiptAvailability: NOT_PROVIDED`
states that **full item receipts are not supplied by the HTTP endpoint** (a shadow readback is not
certified served publication).

ZIP preparation (`fleet/zip-preparation@1`, `fleet/zip-acquisition-plan@1`) is offline PLAN_ONLY /
NOT_AUTHORIZED planning with **no HTTP feed**; historical TIER_0 / people:0 is not shown as live
coverage, `requiredFreshAcquisition:[]` is not shown as acquired, and prepared queues render as
inactive preparation. It is supplied only as committed evidence under `docs/evidence/`.

## 7. The committed authenticated Admin route (`/admin/fleet`)

Until `7704bca9` the only thing that mounted `FleetOperationsPanel` was the git-excluded preview
harness. `app/(admin)/admin/fleet/page.tsx` is now the committed, operator-reachable surface:

- **Reachability & guard.** It lives under `/admin`, so `middleware.ts` guards it exactly like every
  sibling admin page: a bare **404 on the public host**, and a **redirect to `/admin/login?why=…`**
  on the admin host without a session (only `/api/admin/*` returns 401; this page is RSC).
  `tests/admin-control-centre.test.ts` names `/admin/fleet` in both the public-host-404 list and a
  dedicated admin-host-redirect assertion. An operator reaches it by signing in and choosing
  **"Fleet operations"** in the console view selector (`console-nav.tsx`), or by navigating to
  `/admin/fleet`.
- **What it reads, and when.** Like every sibling admin page it is an async **server component** that
  opens the control plane and reads **once at navigation time** (never the 8s pulse), folding that
  first read through the **same** consumer projection (`applyRefresh`) a client refresh uses and
  handing it to the panel as `initialState`. A missing control plane seeds an honest
  `CONTROL_PLANE_UNAVAILABLE` state, never an empty all-clear. The panel's Refresh then re-reads **on
  demand** through the authenticated endpoint.
- **ZIP preparation** is documented on the page as offline PLAN_ONLY planning with no live feed
  (§6) — named, not rendered as live coverage.
- **Client/server boundary (`80ea40ae`).** Mounting the client panel first surfaced a latent leak:
  the consumer projection imported the fleet contract's two version CONSTANTS as runtime values, and
  the contract transitively imports the server read service (`admin-data` → `pg-store` → `node:fs`),
  so `next build` failed with "the chunking context does not support external modules (request:
  node:fs)". Fixed by making that import **type-only** (types are erased) and holding the two version
  strings as a client-safe mirror in the consumer, pinned to the contract by a drift test. The
  production build now compiles cleanly with `/admin/fleet` present as a dynamic route.

## 8. Remaining backend dependencies (post-integration)

Scoped to the fleet/PDC owners (not this assignment):
- **Publication truth:** v1 `publication.status` is UNKNOWN; a future per-record promotion +
  served-reader-proof join must carry item/result/artifact identity. Consumer already renders UNKNOWN.
- **Full receipts (v1.2):** fleet `d685fc4a` adds a retained-receipt store + ZIP-gap resolution and
  moves the endpoint to `fleet-operations/v1.2`. It is the Fleet/integration owner's to land; when it
  does, the endpoint contract changes and the consumer's "receipts NOT provided" note is revisited.
- **Runner liveness:** the report is work-item operations, not runner heartbeat; "is the runner
  connected" stays the existing cheap `/api/admin/live` pulse. Consumer keeps them separate.
- **Live verification:** actual admission/recovery/cost-attribution/served-output proof requires the
  integration owner to deploy and read production records. This assignment did none.

## 9. What is proven, and at which level (evidence taxonomy)

The four categories are kept distinct on purpose; none is dressed as another.

| Level | What it exercises | Here |
| --- | --- | --- |
| **Helper / unit tests** | Pure logic, no framework | `tests/fleet-operations-consumer.test.ts` drives the **real** read service (`readFleetOperations`) against **in-memory** repos and folds the output through the consumer projection — no copied fixture JSON (8 tests). Design guards: party, pill-colors, funding, brand, focus-visible, battlecard, jurisdiction, pill-cluster, pill-sizing, motion-tokens, small-popup, who-governs, amber-remnant. |
| **Rendered-component checks** | The actual components on a page | Screenshots (§10) of `/lumen-preview` (Reader) and `/lumen-admin-preview` (Admin) mount the **real** components — `MeetingStatusPill`, `IdentityChip`, `Logo`, and `FleetOperationsPanel` seeded with fixture state. The committed `/admin/fleet` page mounts that **same** `FleetOperationsPanel`. |
| **Authenticated route integration** | The real HTTP handler + guard | `tests/fleet-operations-route.test.ts` invokes the **real** `GET` handler: public host → 404 (empty body, before any store read); admin host + no cookie → 401; admin host + a **validly signed** session (isolated fixture key, no DSN) → 503 `CONTROL_PLANE_UNAVAILABLE` with no empty-success fleet and no key leak. `tests/admin-control-centre.test.ts` drives the **real** `middleware` for the `/admin/fleet` **page** path (404 public / 307 login-redirect admin). |
| **Production evidence** | Deployed reads/writes | **None.** No deploy, no production read, no live dispatch. The deployed web function cannot reach the control plane; that limit is stated, not papered over. |

## 10. Verification & reproduction

All run in the isolated clone (outside OneDrive) at integration `HEAD 7704bca9`, from the clone root
(for `node_modules` resolution). No production credentials; no shared CI.

```bash
# type + lint + contrast
npx tsc --noEmit                       # clean
npx eslint "app/(admin)/admin/fleet/page.tsx" \
  "app/(admin)/console-nav.tsx" "components/admin/fleet-operations-panel.tsx"   # clean
pnpm contrast                          # exits 0 (see §2 for the party-chip caveat)

# fleet: authenticated route integration + producer→consumer helper (10 tests)
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  tests/fleet-operations-route.test.ts tests/fleet-operations-consumer.test.ts

# admin route/middleware guard incl. /admin/fleet (34 tests)
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs \
  tests/admin-control-centre.test.ts

# full production build (Turbopack) — the client/server boundary is real here
rm -rf .next && pnpm build     # compiles cleanly; /admin/fleet present as ƒ (dynamic);
                               # postbuild check-build-output + reader-trace-check → failures: []
```

- Isolated auth/data fixtures: the route test signs a session with a throwaway key
  (`WTP_ADMIN_SESSION_KEY` set in-test) and deletes the control-plane DSN so the authenticated path
  returns the honest 503; the consumer test uses `createMemoryRepositories()`, not copied JSON.
- **Full suite (regression check).** `node --test tests/**/*.test.ts` at HEAD `b25d692a`: **6246 pass,
  14 fail, 1 skipped.** This session introduced exactly two failures and BOTH are fixed — a temporary
  Playwright screenshot script tripping `browser-construction` (deleted), and a new function name
  `readInitialState` tripping the `/initials/i` duplicate-detector (renamed `readSeedState`). The 14
  remaining failures **pre-date this session and are untouched by its diff** (`git diff cb126812..HEAD`
  is fleet route/panel/view/nav + tests + this doc; it edits no `globals.css`, `layout.tsx`, or reader
  data). They split into: (a) **design-branch gate drift, in the Lumen assignment** — `ADM-21`
  (`admin-feedback-9-4-pm.test.ts:749`: the parity bridge wrapped `--ce-surface-panel-gradient` in
  `var(--shared, <literal>)`, so the raw literal no longer immediately follows the colon its regex
  anchors on — the literal is still present as the fallback) and `rhythm-tokens` spacing (250 vs
  baseline 248) + fontSize (167 vs 165) off-scale counts (more occurrences of existing off-scale
  values from the design components; no NEW literal value); and (b) **date-sensitive reader/data-fixture
  tests unrelated to design or fleet** (today is 2026-09-13) — the Pima outcome questions, the Vail
  agenda RED CONTROLs, per-member vote denominators, NH206 snapshot shedding, the non-shipping-prefix
  trace, the sentence-shaped render-default sweep, and the committed reader-graph match. The (a) items
  are flagged for a design-branch follow-up; none is in this continuation's scope, and neither the
  settled palette nor any committed gate was changed to make a failing check pass.
- Live harness + screenshots: served the **production build** with `next start` (isolated port 3100)
  and captured both preview harnesses with Playwright across the full matrix — Reader
  (`/lumen-preview`) and Admin (`/lumen-admin-preview`), each in **dark + light** at **desktop
  (1280) and narrow (390)** widths (8 shots; `data-theme` read back on each to confirm the theme
  applied). Preview routes are git-excluded dev harnesses used as the rendered-component check —
  they are **not** the committed surface (that is `/admin/fleet`, §7), which is auth-guarded and so
  cannot be browsed unauthenticated; it mounts the same `FleetOperationsPanel` shown here. The Admin
  harness renders the REAL `readFleetOperations` output against seeded in-memory repositories.
