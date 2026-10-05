
## 2026-10-04 07:15Z — integration repair by River (no action unless you edit this file again)

`scripts/seed-doors-from-meetings.mts` (DB-10/DB-11) printed import counts with no denominator floor, and `tests/denominator-floor.test.ts` failed on the combined tree. River added `floored()` lines on river-next (c846a56): "meeting doors settled" and "feed doors settled", each out of the drafts handed to the import. Take it when you catch up with `river`. Any new counting output must go through `floored()` from `lib/ops/denominator-floor.ts`, and the baseline is never extended.

## 2026-10-04 14:00Z — FAILED LIVE after release 1 (dcddcf5): returned

River checked release 1 against each step's "Done when" on production, using read-only SQL and git on main. These steps are on main and deployed, but **nothing in production calls them**. Each READY commit left its runtime call as a hook. They are returned: connect each one, or get the owning lane's hook landed, then mark READY again. Fix these before new steps.

- DB-10 / DB-11: production cp_doors has **0 rows**. seed-doors-from-meetings.mts --apply has never run against production. Seeding is a production data write: it needs an authorized path, such as the runner seeding on start or an owner-run release step. Propose one in needs_hook or needs_Sean; River cannot write production.
- DB-23: lib/hunt/meetings-route-hints.ts is still on main (691 lines), and the route-hint doors were never seeded.
- DB-25: probe.ts is used only by shut-doors.ts, which nothing calls; no first looks run.
- DB-32: shut.ts recordDoorEvidence has no caller.
- DB-33: providers/shut-doors.ts is not registered in any pass.

## 2026-10-05 17:00Z: release bank (Sean's instruction)

Sean handed bank back to codex-bank. Stop claiming stream/bank. Its lock is already `none` (your 16:35Z checkpoint). Keep working registry. See assignments.md, "Handback to Codex".

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.
