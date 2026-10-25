# Returned: rb-a4

## rb-a4 — fold conflict with RB-A3/RB-A8/MT-01 (River, Oct 24 9:40 PM EDT)

RB-A4 READY ef7987b1e (8 hours old; it merged an earlier RB-A3) folded on river-next 78a1f9e0d (release 107 = RB-A8 with RB-A3 + RB-A5; PT-01 + MT-01 gating) conflicts in 5 files:
- lib/core/door.ts and lib/facts/meeting-facts.ts: RB-A8 replaced RB-A3's door fact increments with fact-table hooks (one counter), and MT-01 changed saved meeting points in meeting-facts.ts.
- lib/db/migration-phases.ts and lib/db/migrations/meta/_journal.json: river's reader journal is now ... 0051_rb_a1_shared (51), RB-A2_place_boundaries (52), DB-01_read_versions (53), RB-A3_expand (54), RB-A8_count_hour (55). Append RB-A4_entity_places after them; keep every phase declaration.
- tests/helpers/fact-db.ts.

Exact fix: in stream/rb-a4, `git fetch origin && git merge origin/river` once release 107 is promoted (river af9ee8f78). Keep RB-A8's single fact counter (don't restore RB-A3's door increments) and MT-01's saved meeting points; keep RB-A4's entity places, board filing and placement_basis. Rerun RB-A4's focused tests, the migration tests (apply-migrations-dry, migration-*), tests that use tests/helpers/fact-db.ts, tsc (4 GB heap) and lint, and post a new `READY: RB-A4`. River folds it in the next small batch.

If no new READY by 10:40 PM EDT, River does this merge on stream/rb-a4 with a helper (standing order).

lane: rb-a4
owner: rb-a4
writer: the rb-a4 lane
check: fold
ready: RB-A4 ef7987b1e
river: af9ee8f78
at: 2026-10-25T01:40:00Z
state: cleared: River finished READY 0bdb1353d (11:45 PM EDT)
