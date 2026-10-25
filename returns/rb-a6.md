# Returned: rb-a6

## rb-a6 — fold conflict with RB-A8 (River, Oct 24 9:40 PM EDT)

RB-A6 READY 50405245e, folded on river-next 78a1f9e0d (release 107 = RB-A8 fb1783a62 with RB-A3 + RB-A5, plus PT-01 + MT-01 gating), conflicts in 4 files:
- lib/control-plane/line-keeper/country.ts: RB-A8 removed the country cache's held-place capture (CountryCache, readHeldPlaceCapture, captureAt and COUNTRY_CHANGES_SQL; "removes the 65 MB inventory", the keeper reads only counters and grouped ages). RB-A6 builds on that capture (place target scores, owed lists, meeting freshness).
- tests/could-govern-pill.test.ts, tests/line-keeper.test.ts, tests/zip-census-districts.test.ts (1 hunk each).
This is a logic merge between two lanes' designs for the line keeper, so River didn't resolve it inside a batch.

Exact fix: in stream/rb-a6, `git fetch origin && git merge origin/river` once release 107 is promoted (river af9ee8f78 has RB-A8 now). Rebuild RB-A6's per-place owed/score reading on RB-A8's counters, or read the held capture where RB-A6 needs it without restoring the inventory RB-A8 deleted (no old code beside new). Keep the hunters' missing-fields handoff and Admin's baseline/state edits. Rerun RB-A6's focused tests, the three test files above, tsc (NODE_OPTIONS=--max-old-space-size=4096) and lint, and post a new `READY: RB-A6`. River folds it in the next small batch.

If no new READY by 10:40 PM EDT, River does this merge on stream/rb-a6 with a helper (standing order).

lane: rb-a6
owner: rb-a6
writer: the rb-a6 lane
check: fold
ready: RB-A6 50405245e
river: af9ee8f78
at: 2026-10-25T01:40:00Z
state: returned
