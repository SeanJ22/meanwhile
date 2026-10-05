# Returns and hook requests for people

River writes this file.

## 2026-10-04T08:39:26Z — integration repair by River

SC-18 deleted the tests pinning ADM-1 and ADM-23 but left `data/feedback/sweeps/9.4.26*.json` citing them, so `pnpm feedback:sweep --check` refused. River moved both to `checkDebt` on river (8c67d4b65). When you remove a test, run `pnpm feedback:sweep --check`; it's part of `pnpm gates`.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- CA-40: said-at-the-time.ts is called only by tests.
- CA-41: meeting-history-votes.ts is not imported by the Ask route or anything else.
- CA-42: departed-seat.ts is called only by tests (the Ask connection was requested as a hook and never landed).

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.
