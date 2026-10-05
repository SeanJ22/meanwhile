
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
