# Returns and hook requests for hunters

River writes this file. Do these before new steps; a hook is a small connection in a file you own. Record each one as done in your status, with its commit.

## 2026-10-04 06:45Z — hook from measures

BR-08: in `scripts/freshness-shadow.mts` around 1252-1278, make runner place ordering read the "state" scope type.

## 2026-10-04 06:45Z — hook from registry

DB-09: add "doors" to the AGGREGATES list in `scripts/pilot-runtime-publish.mts` so the console-input hash moves when a door changes.

## 2026-10-04 06:45Z — hook from admin

BR-05: re-read AdminConfig on each runner pass and call `readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3)` for the shut-door threshold. Use the code default 3 until admin's setting is on river.

## 2026-10-04 13:45Z — observation from production (read-only)

The control-plane `cp_runner_heartbeat` (pilot-runner) shows `lastCycleOk: false` on every reading River took today (06:00Z–13:44Z). `cycle.lastError` is null, and `nextCycleReason` reads "Directed hunt ZIP 85122 (Census ZCTA): eligible work remains without a dispatch; bounded retry in 10 minutes." If a cycle that leaves eligible work undispatched counts as not OK, Admin may be showing a false failure. If it's a real failure, it's yours: CH-01 and CH-08 live checks depend on it. Release 1 (dcddcf5) was adopted, with testedSha dcddcf5 at 13:43:56Z.

## 2026-10-04 14:00Z — production observation after release 1
- 174 of 179 aborted ACQUIRER attempts between 13:43Z and 13:51Z were dispatched to api.marginalia.nu while its circuit was latched until 14:00:59Z. They cost nothing, but every dispatch is wasted. Dispatch should skip a latched provider. This bears on CH-06 and the CH-28 throughput claims.
- No paid worker has dispatched since 05:52Z; the last paid Scouts were refused by SCOUT_COST_CEILING. The ceiling is Sean's spending setting and stays as it is. But CH-02, DB-37/40/42 and DP-08 can't be checked live until paid work runs.

## 2026-10-05 16:55Z: hooks from admin (overflow-1)

Admin BR-05 and BR-16/BR-37 are folding into river (gates running). Two runner connections are yours in scripts/pilot-runner.mts. See hooks.md, rows dated 2026-10-05 16:55Z. With these wired, BR-05, BR-16 and BR-37 count as connected.

## 2026-10-05 17:40Z: standing instruction from Sean (all lanes)

Sean, to River, word for word: "Builders don't send me notifications or ask me questions. Their questions go to you, and you answer every "how" decision yourself under rulings §8. Bring me only credentials, new paid services, spending beyond the budget, and D7. Tell every lane this in its returns file."

What this means for you, from now on:
- **Never notify Sean and never ask him anything.** No push notifications, no questions in a final reply, no "needs_Sean" for how-to choices.
- **Put every question under `needs_River:` in your status file.** River reads it each run and answers here in your returns file. Choices about which source, method, order, design, module, migration or fix are "how" decisions. River makes them under rulings §8. A design choice that touches spending controls is still "how", as long as it changes no limit and Sean's settings stay as they are.
- **`needs_Sean:` is only for** a missing credential, a new paid service, spending beyond the budget, or D7 (SC-17). River checks each entry and takes it to Sean. You don't.
- While you wait on an answer, keep building your other ready steps.

## 2026-10-05 17:40Z: answers to your CH-24 and CH-26 questions (Sean, through River)

Sean, word for word: "Answer hunters: CH-24, go ahead. Extract the shared spending-guard module behind a runner switch, keep the old path as the default until it's checked live, and prove in tests that the guards behave identically. Check it live after the next release. CH-26, go ahead with the lineage-keyed index. You number the migration."

**CH-24: go ahead.**
- Extract the paid-work guards into one shared module: spendHolds, assignmentBudget, areaGuardedTransport, fleetSafety, expansionBudget and place order, now built inside the research child (`scripts/freshness-shadow.mts` ~1089–2105). Both the research child and the new standing lease-worker lane in `scripts/pilot-runner.mts` build from it, reading the durable stores (budget ledger, intent log, expansion plan).
- Put the new lane behind a runner switch in the runner's environment file. **The old path stays the default.** Nothing changes in production until the switch is turned on after a live check.
- Prove in tests that the guards behave identically. For the same durable-store state, the extracted module must reach the same allow and refuse decisions, with the same amounts, as the current in-child code. Cover the refusal cases: ceiling reached, hold active, area guard, fleet safety, expansion budget. Spending limits and Admin settings don't change.
- River checks it live after the next release that carries it, then turns on the switch. CH-27 and CH-28 stay behind CH-24's live check, as the plan says.

**CH-26: go ahead with the lineage-keyed index.**
- **Migration number: control-plane schema version 20** (`BOOTSTRAP_VERSION = 20` in `lib/control-plane/repository/pg-schema.ts`). Version 19, DB-09's door registry, is the highest on river, release/2 and every stream. No other lane has claimed 20. Add a "What version 20 adds" note. Build the index online (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`), the way version 18's source-URL index is built. If you also need a Drizzle migration on the data-plane database, name it `CH-26_<name>.sql` and River numbers it at the fold (the next free number is 0035).
- Scoped reads go behind a runner switch. The old whole-table path stays the default until the live check (repository calls per task stay flat as history grows).
- Put the read-count evidence in your status. River does the live read after release.

## 2026-10-05 18:20Z: remove WTP_READER_EDGE_DIR from runner setup (reader harm, River-assigned; do before new steps)

Readers saw a six-day-old snapshot because `/etc/meanwhile/runner.env` on the Linux runner had `WTP_READER_EDGE_DIR=/var/lib/meanwhile/reader-edge`, which makes the runner publish reader pages to a local folder instead of the live site (`resolveReaderArtifactWriteStore()` in `lib/meetings/edge-store.ts` prefers it). Sean removed it on the host at 18:08Z. The default comes from `deploy/runner/setup.ps1`, `ConvertTo-LinuxRunnerSettings`, `$overrides` (`WTP_READER_EDGE_DIR = '/var/lib/meanwhile/reader-edge'`), so re-running setup would bring it back.

Build: remove that override entry. Keep stripping any incoming `WTP_READER_EDGE_DIR` line, so a stray copy from the source settings can't reach the Linux runner either. Do this by adding it to the skip condition next to `PROD` and `WTP_ADMIN_SESSION_KEY`, not by keeping it in `$overrides`. Check `deploy/runner/README.md` and the other deploy/runner scripts for the same default or instructions to set it, and remove them. You own this as runner deployment (with pilot-runner and runtime-release-handoff); River decided, no question for Sean.

Test: the existing setup converter check (the script is dot-sourceable for local verification), or a focused test: given input containing `WTP_READER_EDGE_DIR=...`, the output has no `WTP_READER_EDGE_DIR` line, and the other overrides are unchanged. Mark READY as usual. Evidence: releases/stale-reader-snapshot.md.
