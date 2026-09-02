# Migration inventory — what still depends on the legacy refresh, and what has moved

*(Lane E, 2026-09-02. RULING 242. Companion to `docs/nightly-window.md`.
Every count below carries its denominator and names where it was read.)*

The legacy refresh is `.github/workflows/refresh-daily.yml` +
`scripts/refresh-daily.mts`, cadenced by `lib/ops/refresh-cadence.ts`
(`REFRESH_AUTHORITY = "LEGACY_NON_AUTHORITATIVE"`). The control plane is the
obligation-provider registry in `lib/control-plane/scheduler/providers/`, the
deterministic routes it dispatches, the dispositions it commits, and the STAGED
snapshots under `data/control-plane/staging/`. The nightly window
(`scripts/nightly-window.mts`) is the door both will eventually pass through;
today it runs the legacy refresh in shadow and promotes nothing.

---

## 1. Reader-facing sources that still depend on the legacy refresh

**5 of 5 legacy sources still refresh their reader-facing artifact only through
the legacy path.** Read from `REFRESH_SOURCES` in `lib/ops/refresh-cadence.ts`;
readers found by `grep` over `app/`, `lib/` and `components/` for each governed
path and for the module that loads it.

| Source | Governed path(s) | Cadence | Runtime readers (files that load it, of every `.ts`/`.tsx` under `app/`, `lib/`, `components/`) | Reader surfaces |
| --- | --- | --- | --- | --- |
| `meetings` | `data/meetings-snapshot.json` | weekly, elevated to daily until the 2026-11-03 election <!-- expected-future: 2026-11-03 — the general election date carried in a cadence reason --> | `lib/meetings/snapshot.ts` (the loader), read by `app/api/meetings/route.ts`, `app/api/agenda/route.ts`, `app/api/ask/agenda/route.ts`, `app/api/ask/grounded/route.ts`, `app/(admin)/admin/page.tsx`, `lib/meetings/freshness.ts`, `lib/ask/body-identity.ts`, `lib/ask/inventory.ts`, `lib/control-plane/admin-data.ts` — 10 readers | the map's meeting alerts, the agenda and Ask surfaces, the admin control centre |
| `nj-filing` | `data/ballot/`, `data/questionnaire/` | weekly, elevated to daily until 2026-11-03 <!-- expected-future: 2026-11-03 — the general election date carried in a cadence reason --> | `app/ballot/page.tsx` and 8 `lib/ballot/*` modules (`analyses`, `candidate-cards`, `candidate-sites`, `candidate-targets`, `general-lineup`, `hunt-state-server`, `incumbency-resolve`, `uncontested`) — 9 readers for `data/ballot/`; `data/questionnaire/invitations-nj-morris-2026.json` is a registered generated artifact (`lib/ops/generated-register.ts`) with 0 runtime readers | the ballot page for Morris County, NJ |
| `fec` | `data/fec/fec-2026.json` | weekly | `lib/funding/snapshot.ts` (the loader), read by `app/api/reactions/route.ts`, `lib/ballot/incumbent-record.ts`, `lib/funding/state-snapshot.ts`, and the control plane's `lib/control-plane/campaign-finance/{authority,held-records,model,obligations}.ts` — 8 readers | the federal money section on candidate cards |
| `legiscan` | `data/votes/state-votes-snapshot.json` | weekly | `lib/sources/legiscan/snapshot.ts` (the loader), read by `app/api/votes/route.ts`, `app/ballot/page.tsx`, `lib/ask/votes.ts`, `lib/ask/evidence.ts`, `lib/votes/bill-summaries.ts`, `lib/votes/key-votes-rows.ts` — 7 readers | state roll-call votes on candidate cards and in Ask |
| `dotgov` | `data/dotgov/snapshot.json` | monthly | **0 runtime readers.** The only consumers are build- and session-time scripts (`scripts/zip-add.mts`, `scripts/stamp-coverage-tiers.mts`, `scripts/jobs-status.mts`, `scripts/watch-workflows.mts`) and the ops allowlists | none directly; it is a registry input for `pnpm zip:add` and the coverage tiers |

**Which copy readers see, for every one of the five: the committed `data/` file,
always, today.** No reader surface reads a control-plane staged snapshot, a
vault artifact, or a control-plane aggregate. That is RULING 224's line as
implemented: the tail stages under `data/control-plane/staging/` and a session
carries the last mile.

## 2. What has moved into the control plane

Read from the newest freshness-shadow run record
(`data/health/freshness-shadow-runs/2026-09-02-02.json`, `registry`) and
`data/control-plane/staging/manifest.json` (98 entries).

| Provider | Records | Scheduled units (of 2,991 registered) | Obligation source | Deterministic routes | Staged entries (of 98) |
| --- | --- | --- | --- | --- | --- |
| `meetings` | 78 | 78 | **reads `data/meetings-snapshot.json`** — the legacy artifact is its denominator | one route per body, from the snapshot's own provenance | 0 |
| `campaign-finance` | 4 | 16 | descriptor files under the provider's directory; reads `data/ballot/` and `data/fec/fec-2026.json` for identity | AZ SeeTheMoney, NH CFS, Pima EasyVote, AZ SOS FTP, FEC calendar and Schedule E, NH lobbyist registry and records request | 16 — **2 STAGED_PROMOTION_READY** (AZ SeeTheMoney 370 of 370 for its query; NH CFS 5,743 of 5,743), 14 STAGED_GAP |
| `tracker-intake` | 0 | 0 | `lib/tracker/obligation-handoff.ts` | none — 7 owner-reported rows are PRESENT_UNSCHEDULABLE, each naming what it needs first | 0 |
| `local-jurisdictions` | 678 | 1,177 | the jurisdiction registry per state | meetings, campaign-finance and ballot-and-candidates routes per jurisdiction | 6 STAGED_GAP |
| `candidate-enrichment` | 576 | 1,720 | `data/hunt/<state>-candidate-universe-2026.json` | Wikipedia API, Marginalia index, 4get web index, candidate-authored sites | 76 STAGED_GAP |

**Staged by record class (of 98):** campaign-finance 16 (2 ready), candidate-enrichment 76 (0 ready), local-jurisdiction 6 (0 ready). `promotionEnabled: false` on the manifest.

## 3. In BOTH, and which copy wins

| Source | Legacy writes | Control plane | Readers see |
| --- | --- | --- | --- |
| `meetings` | the snapshot | the `meetings` provider READS the snapshot as its obligation denominator and the `local-jurisdictions` provider acquires meeting representations for AZ jurisdictions (6 staged gaps) | the committed snapshot |
| `fec` | the snapshot | the `campaign-finance` provider carries FEC routes (calendar, Schedule E — both STAGED_GAP) and `held-records.ts` reads the committed snapshot | the committed snapshot |
| `nj-filing` | `data/ballot/`, `data/questionnaire/` | the `campaign-finance` and `candidate-enrichment` providers read `data/ballot/` for identity; **no control-plane route acquires the Morris County clerk filing itself** | the committed files |
| `legiscan` | the snapshot | **nothing** — no votes provider exists | the committed snapshot |
| `dotgov` | the snapshot | **nothing** — no provider, and no reader | the committed snapshot (by scripts) |

So: 2 of 5 sources are in both (`meetings`, `fec`); 1 of 5 has its identity
consumed by the control plane but is acquired only by the legacy path
(`nj-filing`); 2 of 5 are legacy-only (`legiscan`, `dotgov`).

## 4. What must be true before each legacy responsibility retires into the window

Common to all five (the window's own preconditions, RULING 242):

- (W1) READER, TRUTH and FRESHNESS GREEN and INDEPENDENTLY_REPRODUCED — the
  activation gate reads them from the run record and opens on nothing less.
- (W2) The record class opened by name at the activation gate (`openRecordClasses`).
- (W3) The promotion path proven end to end on staging: one commit through the
  shipping door, then the production observer, the reader suite and the
  relevant visual checks; a seeded regression reverting the batch and opening an
  incident.
- (W4) Injected controls in the window batch, so AUDITED can be measured
  (recall, false-absence and false-presence rates with denominators).
- (W5) A callable neutrality and rendering-symmetry check over a pipeline item,
  so VERIFIED can be reached at all.
- (W6) Lane A's `docs/refresh-run.json` contract on `main`, so the window reads
  per-source outcomes exactly rather than through the Markdown fallback.

Per source:

**`meetings`**
1. A control-plane route portfolio that acquires every body in the snapshot's
   denominator (today the provider derives its obligations FROM the snapshot,
   so retiring the legacy writer would empty its own input — the denominator
   must move to the jurisdiction registry first).
2. A normalizer from the acquired representations to the snapshot's shape
   (`lib/meetings/snapshot.ts`'s contract), with a zero-row result refused.
3. `/api/meetings` and the agenda surfaces covered by reader-suite checks that
   run in post-promotion verification.
4. Record class `meeting-times` / `agendas` opened (a LOW_RISK candidate).

**`nj-filing`**
1. A provider and a route descriptor (with a yield contract) for the Morris
   County clerk's candidate page and filed-candidate PDFs — the acquisition the
   legacy `nj:ballot --write` performs.
2. A normalizer to the `data/ballot/` shape and the `questionnaire:invitations`
   regeneration inside the window (RULING 102: the generated artifact moves
   with its input).
3. `nj:filing:check` (the clerk's published count against ours) as a named
   VERIFIED check.
4. Record class `ballot` opened — OWNER-APPROVED, so an owner decision.

**`fec`**
1. The FEC routes in the `campaign-finance` provider yielding (today both are
   STAGED_GAP), plus the bulk candidate/committee files the legacy `fec:fetch`
   reads.
2. A normalizer to the `fec-2026.json` shape; the FEC's own processing lag
   carried as `declaredCycleHours`.
3. Record class `campaign-finance` opened — OWNER-APPROVED.

**`legiscan`**
1. A votes provider with a dataset_hash-gated route (the legacy fetch's own
   idempotency), keyed to the statewide candidate universe.
2. A normalizer to the `state-votes-snapshot.json` shape.
3. Record class `votes` opened — OWNER-APPROVED.

**`dotgov`**
1. A monthly obligation in the registry (the federal .gov list is a routine
   register — a LOW_RISK `routine-filings` candidate).
2. A normalizer to `snapshot.json`.
3. A decision on whether it is reader truth at all: with 0 runtime readers it
   is a registry input, and it may retire into a build-time step rather than
   the window.

## 5. Which record classes open first, and which stay owner-approved

From `lib/control-plane/promotion/activation-gate.ts`:

- **Open now: none** (`openRecordClasses: []`).
- **Low-risk candidates for the first decision:** `meeting-times`, `agendas`,
  `published-minutes`, `routine-filings`.
- **Owner-approved, closed until approved by name:** `candidate-positions`,
  `campaign-finance`, `candidate-enrichment`, `ballot`, `votes`.

The provider vocabulary today (`meetings`, `campaign-finance`,
`candidate-enrichment`, `local-jurisdiction`) is coarser than the gate's
classes; opening `meeting-times` means opening the meeting representations of
`meetings` and `local-jurisdiction`, not the whole provider. The mapping from
provider class to gate class is part of the opening decision, not something
the window infers.

## 6. The durable obligations

The remaining migration work is drafted as tracker rows in
`data/ops/migration-obligations.tracker-rows.json`, in the shape
`pnpm tracker:add` expects; the integration owner runs the add. No row is a
Needs Sean row except the one decision that is genuinely the owner's — which
record classes open first — and that row carries its decision card.
