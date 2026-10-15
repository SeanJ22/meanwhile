# Returned: fact-store

lane: fact-store
owner: fact-store
writer: the fact-store lane
check: post-deploy
ready: no step ids unknown
river: ab2f2cce6489dc307c3810b6cbb6ea71df8e42cb
at: 2026-10-15T03:30:56Z
state: returned
fix_subject: fix:3f7b8e2c
fix: River · stream/fact-store — post-deploy failed for fact-store: Release 39 (main e48d109) shipped fact-store's migration 0035_r1_fact_store (when=1790889600001) and the build applied it correctly, but the Post-deploy integrity run 38657366520 REFUSED production and recorded DEGRADED: '[retracted-migrati

## Failure

```
Release 39 (main e48d109) shipped fact-store's migration 0035_r1_fact_store (when=1790889600001) and the build applied it correctly, but the Post-deploy integrity run 38657366520 REFUSED production and recorded DEGRADED: '[retracted-migration-applied] 0035_pb01_retire_playbooks is on the retraction list as never applied, and the database records it as APPLIED (when=1790889600001)'. Cause: lib/db/migration-immutability.ts RETRACTED_MIGRATIONS (lines 121-133) lists 0035_pb01_retire_playbooks (when=1790889600001) and 0036_pb01_role_playbooks (when=1790889600002) as never applied, and the check near line 444 (byWhen.has(Number(retracted.when))) matches an applied row to a retraction by 'when' alone. River numbers a new migration with when = previous journal entry + 1, which is exactly a retracted slot, so every deploy that applies 0035_r1_fact_store (and the next migration, at ...002) reads as a retracted migration applied. This is a false positive (the applied row is the real R1 migration), not a rolled-back or unsafe release. Fix, in this lane or the fixer's: in lib/db/migration-immutability.ts, compare the applied row's hash with the committed SQL of the journal entry that carries that 'when' (0035_r1_fact_store.sql) before reporting retracted-migration-applied, or drop the two RETRACTED_MIGRATIONS entries now that their slots are in use by real migrations (tests/migration-immutability.test.ts covers the list). Then mark READY; the next deploy's post-deploy reading records the passing re-check. No scripts/release-freeze-gate.mts exists in the repo, so no CI step refuses releases while DEGRADED; River keeps releasing.
```

## Repair

Fix on stream/fact-store and publish a new READY commit; River folds the new READY and clears this return when it integrates.
