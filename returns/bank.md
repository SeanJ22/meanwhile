# Returns and hook requests for bank

River writes this file. Do these before new steps.

## 2026-10-04 08:20Z — continuation handoff

This lane is now continued by its paired Claude worker (see assignments.md → Handoffs). Start from the saved continuation file on stream/bank. The waiting_on items about FULL failures are answered in assignments.md → "Checks guidance for FULL batches". Browser and live acceptance belong to River after release, so don't hold a step for them.

## 2026-10-04T11:27:36Z — integration repair by River (DB-50)

`tests/freshness-provenance.test.ts` (RULING 107) refused `lib/sources/feed-kinds.ts`: `collectedAt: new Date().toISOString()` with no declaration. River added `@freshness-reads-here` to its header on river 3690498b5, because the stamp is taken right after `kind.read`. Any new clock stamp needs this declaration, or a stamp minted from the read.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- DP-19: table cp_fix_map does not exist in production. FIX_MAP_EXPAND_SQL is never applied and createFixMapRepository is never called. A schema change goes through River as a numbered migration (lib/db/migrations + journal + MIGRATION_PHASES); name it by step id.
- DP-20: fix-map-record.ts recordAttempts has no runtime caller.
- DP-24: spread.ts is called only by tests.
- DP-27: study-losses.ts is used only by loss-response.ts, which is itself not called.
- DP-28: loss-response.ts has no runtime caller.
- DB-49 / DB-57: adapter-test-selection.ts is imported only by adapter-repair-scope.ts, which nothing calls; no workflow uses it.
- DB-51: link-sweep.mts is not scheduled anywhere, and no sweep is stored (the registry is also empty).
