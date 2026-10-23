# Returned: cal-01

lane: cal-01
owner: cal-01
writer: the cal-01 lane
check: merge-main-r85
ready: CAL-01 1ac756930120a9e2b965d08965d7c011b5903946
river: 3e7ee0d759a423b9e3e16e7de878d051fcff5c2d
at: 2026-10-23T01:17:46Z
state: returned
fix_subject: fix:a0766e1c
fix: River · stream/cal-01 — merge-main-r85 failed for cal-01: 3. lib/facts/box-publication.ts, end of the publish pass. Keep both: PM-01's `try { await nameBoardsFromTheirPages(input); } catch (error) { console.error("Governing boards could not be named from their pages", ...) }` and your `report.defe

## Failure

```
CAL-01 READY 1ac756930 (clear release gates and unblock fresh fact delivery) does not merge with main as it stands, so it is not in a release yet. It branched before releases 83 (DS-01 NE-01) and 84 (PM-01 Legistar names). River's fold stops on three file conflicts, and River cannot ship a hand-resolved merge for a lane that is alone in a fold, so please merge origin/main (035a48044 or newer) into stream/cal-01 yourself and post a new READY. The resolution, already tried and tested here (all 124 tests in routine-civic-data-runner, legistar-members-freshness, legistar-members and box-publication pass with it; run them with `node scripts/ci-tests.mjs`'s flags: --experimental-strip-types --import ./scripts/register-test-loader.mjs --import ./tests/helpers/install-fixture-doors.ts):

1. scripts/routine-civic-data-runner.mts, acquireChildMemory. DS-01 passes a memory-queue order (WorkerMemoryOrder: { priority, hold }) as the THIRD argument and your tests pin a read deadline in ms as the THIRD argument. Keep both: make the third parameter `orderOrDeadline?: WorkerMemoryOrder | number`; a number is your deadlineOverrideMs, anything else is DS-01's order (passed to routineMemorySlots.acquire as its third argument). Your caller `acquireChildMemory(command, [run.id], readDeadlineMs)` stays as it is.
2. lib/sources/legistar/members-refresh.ts. PM-01 and you fix the same bug (a page saved after the pass began is checked against the pass-start clock). One clock: `const checkedAt = new Date(Math.max(Date.now(), Date.parse(raw.collectedAt), Date.parse(input.now))).toISOString();` then `saveLegistarMembers(vault, raw, checkedAt)` and `publishLegistarMembers({ ..., now: checkedAt })`.
3. lib/facts/box-publication.ts, end of the publish pass. Keep both: PM-01's `try { await nameBoardsFromTheirPages(input); } catch (error) { console.error("Governing boards could not be named from their pages", ...) }` and your `report.deferred = [...deferred].filter(id => !settled.has(id)).length;`, then `return report;`.
4. tests/routine-civic-data-runner.test.ts, test "a single calendar child explicitly deferred before acquisition stays owed without a missing-receipt failure": add `notStarted: [] as string[]` to its context (settlePendingRunResult now pushes to your notStarted list).
5. tests/legistar-members-freshness.test.ts, first test: `assert.equal(copies.length, 2)` (the members reading and the bodies reading PM-01 now saves to name each board), with a one-line comment.

After the merge, run `pnpm gates` (or at least the four test files above plus the civic-data firewall) and post the new READY. The earlier contract-handoff firewall finding (returned 23:16 UTC) is already cleared by this READY: the firewall passed on the release 83 and 84 trees and I did not see it on this one.
```

## Repair

Fix on stream/cal-01 and publish a new READY commit; River folds the new READY and clears this return when it integrates.
