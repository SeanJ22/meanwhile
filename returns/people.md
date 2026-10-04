# Returns and hook requests for people

River writes this file.

## 2026-10-04T08:39:26Z — integration repair by River

SC-18 deleted the tests pinning ADM-1 and ADM-23 but left `data/feedback/sweeps/9.4.26*.json` citing them, so `pnpm feedback:sweep --check` refused. River moved both to `checkDebt` on river (8c67d4b65). When you remove a test, run `pnpm feedback:sweep --check`; it's part of `pnpm gates`.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- CA-40: said-at-the-time.ts is called only by tests.
- CA-41: meeting-history-votes.ts is not imported by the Ask route or anything else.
- CA-42: departed-seat.ts is called only by tests (the Ask connection was requested as a hook and never landed).
