# Returns and hook requests for auditors

River writes this file. Do these before new steps; a hook is a small connection in a file you own. Record each one as done in your status, with its commit.

## 2026-10-04 06:45Z — hook from admin

DP-02: read the shut-door escalation threshold from admin's `DETECTIVE_SHUT_THRESHOLD` setting (default 3) once it is on river.

## 2026-10-04T10:58:17Z — integration repair by River (FE-01 live-write guard)

Two tests failed on the fold: `tests/origins.test.ts` (the test wrote the production host instead of importing `PUBLIC_SITE_ORIGIN` from `lib/ops/origins.ts`) and `tests/path-separator.test.ts` (RULING 14 sweep: `new URL(requestUrl).pathname`). River fixed both on river 8bbe9eeb5. The test now uses PUBLIC_SITE_ORIGIN, and the guard's expression joined the sweep's expression-exact HTTPS list. Catch up before editing those files.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- DP-10: lib/.../absence-reopen.ts is called only by tests (no runtime caller).
- DP-13: live-audit.ts has no runtime caller; v6-audit-read.ts is not served by any Admin route.
- DP-14: live-audit-response.ts is called only by tests.
- DP-16: the audit card read (v6-audit-read) is not served by any Admin route.
- DP-18: only the core is built; no Scoreboard exists on main, so nothing shows it.
- FE-17: data/health/resident-tasks.json exists but nothing outside tests reads it.
- FE-18: no FE-18 code on main; nothing runs the resident tasks or shows them in Admin.

## 2026-10-05 16:50Z: release frontend (Sean's instruction)

Sean handed frontend back to codex-frontend. Stop claiming stream/frontend. If you hold its lock, push your checkpoint with `lock: none` and leave it. Keep working your primary lane. See assignments.md, "Handback to Codex".

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.
