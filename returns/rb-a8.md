# Returned: rb-a8

## rb-a8 — fold conflict with RB-A3 and RB-A2 (River, Oct 24 7:15 PM EDT)

RB-A8 READY 39cc195df, folded after batch E (RB-A2 78a2a9f14 + RB-A3 d92e9a054 on DB-01, river-next 0873f9e42) and RB-A5, conflicts in 7 files:
- app/api/admin/v6/scoreboard/route.ts: the hourly reading. RB-A3 reads `factStore` (readFactStore via readerQuery) and takes gates/readiness from `keeper.hours[0]`. RB-A8 reads `vital` (readVitalSigns) and sets gates null and readiness {}. This is a logic merge.
- lib/db/identity-domains.ts: RB-A2's place_map_counts and place_boundary vs RB-A8's count_hour and line_keeper_run. Keep all four.
- lib/db/migration-phases.ts, lib/db/migrations/meta/_journal.json: keep RB-A2_place_boundaries, RB-A3_expand and RB-A8_count_hour (journal by date).
- lib/control-plane/repository/migrations/meta/_journal.json, scripts/control-plane-migrations.mts, tests/control-plane-migrations.test.ts: river now has RIVER-KEYS-FX_expand and (next batch) RB-A5_expand ahead of RB-A8's entry; append yours after them.
Also check for overlap: RB-A3 adds "hourly fact counts" and RB-A8 adds count_hour (reader) with writer hooks. If both count the same fact moves per state per hour, one must go (no old code beside new); say which in your READY.

Exact fix: in stream/rb-a8, `git fetch origin && git merge origin/river` once release 106 (batch E) is promoted; until then merge origin/river-next (0873f9e42 or later). Resolve the scoreboard route keeping RB-A3's fact-store counts and RB-A8's vital signs and keeper gates/readiness, unless one replaces the other (then delete the replaced one). Rerun RB-A8's focused tests, tests/control-plane-migrations.test.ts, tests/identity-boundary.test.ts, tests/apply-migrations-dry.test.ts, the scoreboard tests, and tsc (4 GB heap) and lint. Post a new `READY: RB-A8`. River folds it in the next small batch.

If no new READY by 8:15 PM EDT, River does this merge on stream/rb-a8 itself (standing order).

lane: rb-a8
owner: rb-a8
writer: the rb-a8 lane
check: fold
ready: RB-A8 39cc195df
river: 0873f9e42 (river-next, batch E)
at: 2026-10-24T23:15:00Z
state: cleared: lane posted READY fb1783a62 (8:03 PM EDT)
