# Common rules for builders on Meanwhile (SeanJ22/meanwhile)

Read first: `docs/rulings.md` (the only rulebook; NEVER edit it) and `CLAUDE.md`.

Hard rules (from Sean, binding):
- Production databases are READ-ONLY. Never write to them. Env has WTP_PRODUCTION_DATABASE_URL_READONLY and WTP_CONTROL_PLANE_DATABASE_URL_READONLY; reach Neon only via the @neondatabase/serverless HTTP driver with NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt. Read sparingly (Neon transfer costs money).
- Never print a secret. Never change Admin settings. Never add a paid service.
- Rulings §5: replaced code is DELETED in the same change. No on/off switches or env flags that keep the old way. No commented-out code, no "historical" notes, no comments that cite rulings. Match the surrounding code's comment density (sparse) and idiom.
- No new gate, proof step, certification, ledger or scoring system.
- Admin and reader copy: plain English, no code names/IDs on Admin screens.
- New database migrations go in lib/db/migrations or the control-plane schema mechanism the repo uses — find it. Name new migration files by step id (e.g. `IR-02_changed_at.sql`) — River numbers them later. Follow how existing migrations/control-plane schema versions are declared (look at lib/db/migration-phases.ts, lib/db/migrations/meta/_journal.json, and how cp_schema_version / control-plane bootstrap DDL is versioned in lib/control-plane/repository/*). Contract vs expand phases matter: production migrations apply themselves (expand during build, contract after deploy by the runner).
- Do NOT push, do NOT open PRs, do NOT touch remote branches. Commit locally on your worktree branch with clear messages. Do not commit generated junk (.next, data/ops/gate-runs, .scratch).
- Tests: `node scripts/ci-tests.mjs <files>` or see package.json `test`; run focused tests for what you touch plus `pnpm exec tsc --noEmit` and `pnpm lint` (eslint) on changed files. Unset DATABASE_URL and WTP_ASSET_STORE when running tests (CI does not have them). Before you finish, run the whole suite once (`env -u DATABASE_URL -u WTP_ASSET_STORE node scripts/ci-tests.mjs`) if feasible and report the counts; fix failures your change causes. Tests that only exercised deleted code are deleted with it; tests that pinned old behavior are updated to the new behavior.
- Never report a skipped or failed check as passing.

Report back: what you changed (files), design decisions, test results (exact counts), anything unfinished, and anything that needs Sean.
