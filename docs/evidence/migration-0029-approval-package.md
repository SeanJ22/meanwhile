# Migration 0029: approval package (not applied to production)

Prepared 2026-09-25, Arizona MST. Branch `claude/migration-0029-r23` (not merged; no PR). The TypeScript half
(R23) is on `claude/ac-r23-derived-confirm` and is safe to merge without the migration.

## The decision needed

**Approve or decline applying migration 0029 to the production reader database.** Sean's rule: no database
migration without his approval. Nothing is broken while it waits; readers get correct data either way.

## What it changes

One database function, `enforce_civic_data_candidate_event_insert` (from migration 0026), is replaced. Every
0026 rule survives line for line (a test checks this). It adds two strictly checked cases:

1. An **unchanged-confirmation receipt** (`UNCHANGED_CONFIRMATION_V1`) on the version readers already have. It must
   name the same source, record class, scope and version, carry that version's own read-model hash, point at the
   version the pointer currently names (current and last known good), have a 2xx HTTP status, and give
   consistent times. A **derived** version (a C16 meeting family or the source wiring, built from promoted inputs,
   which fetches nothing) may omit the status only when the receipt names that version's own
   `derived:<source>:<scope>` route (R23).
2. Its companion **sources event**, only directly after its own receipt at the same instant.

Anything else repeated after PROMOTED is still refused with the same message.

**What it does not change:** no table, column, constraint, index or row; nothing is deleted; nothing readers see
changes. It is an "expand" migration (`lib/db/migration-phases.ts`).

## What it unlocks

Today a re-check that finds nothing new still publishes a whole new version, which triggers a reader read-back
and an edge republish. With 0029, the four opted-in families (meetings, NJ roll calls, state legislators, NH
members) plus the C16 derived families and wiring record a small receipt on the current version instead.
Admin then shows "re-checked, unchanged".

Measured bases (production, 2026-09-24, by the Neon cost session): 954 of 1,119 promotions in 24 hours were
unchanged; NJ roll calls were republished 18 times in 24 hours from the same raw file at about 9.8 MB each.
**Not measured:** how many bytes each avoided republish saves. The earlier isolated measurements did not separate
the promotion's own share (readback, recomposition, edge republish) from the re-check's read, so no daily figure
is claimed here. The NJ roll-call case alone is about 176 MB/day of republished payload (18 × 9.8 MB, derived
from measured values). The billed effect cannot be confirmed while Neon's usage counters stay frozen (they have
not moved since 2026-09-24 4:47 AM MST).

## How it was verified (this session, isolated, 2026-09-25)

- **Tests:** `tests/unchanged-confirmation-migration.test.ts` (6) and the R23 test in
  `tests/derived-meeting-family.test.ts`; 11 of 11 pass; a mutation disabling the derived rule fails both new tests.
- **Isolated Neon copy** of reader production (`ac-0029-verify-20260925`, branch br-patient-queen-axorg6t3, copied
  10:25 AM MST, 608 pointers, migrations 0000-0028; set to expire by itself at 2026-09-27 10:30 AM MST). Every <!-- expected-future: the isolated copy's own expiry, set by this session -->
  process ran with a guard that refuses any request to another database. The repository's own
  `PostgresRoutineDataStore.confirmUnchanged` (the production guarded insert) was run on three real pointed
  versions: a fetched meeting (New London Planning Board), the derived US-AZ family, and the source wiring.
  - Before 0029: all three `STORE_REFUSED` (the runner promotes exactly as today).
  - `pnpm db:apply` (the production apply tool, pointed at the copy): 1 pending, 1 statement, journalled
    (hash 6cbae31f…), 30 of 30.
  - After 0029: all three `CONFIRMED`; the scheduling clock reads the receipt as the newest attempt and success.
    Wrong read-model hash → `HASH_DIFFERS`; a null status on a fetched route → `EVIDENCE_INVALID`; a derived
    route naming another scope → `EVIDENCE_INVALID`; a raw insert that bypasses our code with a null status on a
    non-derived route → refused by the database.
  - Rollback (restore 0026's function): all three back to `STORE_REFUSED`. 0029 re-applied afterwards.
  - Evidence: `meanwhile-evidence/admin-completion/2026-09-25/migration-0029/`.

## Steps if approved (engineering does all of them)

1. Merge R23 (`claude/ac-r23-derived-confirm`) with the next reader batch if it has not merged already.
2. `pnpm db:apply --target=production --dry` → expect exactly `0029_unchanged_confirmation_receipts` pending.
3. `pnpm db:apply --target=production` → 1 statement, journalled.
4. Open the 0029 PR (the database gate refuses an unapplied expand migration, so apply comes first), CI, merge.
5. Confirm on production: the next unchanged meeting re-check writes a receipt instead of a new version, and the
   runner's receipt check passes on `confirmedAt`.

## Recovery if anything goes wrong

Restore the 0026 rule with `0029-rollback-restores-0026-rule.sql` (in the evidence folder; sha256 ad11e5d3…;
exactly 0026's function text). Receipts already written stay in history and remain readable; new re-checks
promote as they do today. Tested on the copy.

## If declined

Nothing changes. The TypeScript stays switched off by the database, and the branch can be deleted later.
