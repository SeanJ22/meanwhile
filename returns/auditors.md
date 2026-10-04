# Returns and hook requests for auditors

River writes this file. Do these before new steps; a hook is a small connection in a file you own. Record each one as done in your status, with its commit.

## 2026-10-04 06:45Z — hook from admin

DP-02: read the shut-door escalation threshold from admin's `DETECTIVE_SHUT_THRESHOLD` setting (default 3) once it is on river.

## 2026-10-04T10:58:17Z — integration repair by River (FE-01 live-write guard)

Two tests failed on the fold: `tests/origins.test.ts` (the test wrote the production host instead of importing `PUBLIC_SITE_ORIGIN` from `lib/ops/origins.ts`) and `tests/path-separator.test.ts` (RULING 14 sweep: `new URL(requestUrl).pathname`). River fixed both on river 8bbe9eeb5. The test now uses PUBLIC_SITE_ORIGIN, and the guard's expression joined the sweep's expression-exact HTTPS list. Catch up before editing those files.
