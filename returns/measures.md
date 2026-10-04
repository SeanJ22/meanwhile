# Returns and hook requests for measures

River writes this file.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- BR-23: no Scoreboard view or code on main (it waited on admin's BR-01; it should not have been marked READY).
- SC-13: gate-health.ts is called only by tests; nothing shows it.
- SC-16: readiness-counts.ts is called only by tests; nothing shows it.
