# Returns and hook requests for people

River writes this file.

## 2026-10-04T08:39:26Z — integration repair by River

SC-18 deleted the tests pinning ADM-1 and ADM-23 but left `data/feedback/sweeps/9.4.26*.json` citing them, so `pnpm feedback:sweep --check` refused. River moved both to `checkDebt` on river (8c67d4b65). When you remove a test, run `pnpm feedback:sweep --check`; it's part of `pnpm gates`.
