import assert from "node:assert/strict";
import test from "node:test";
import { failureRetryMs, repeatedFailureStreak } from "../lib/civic-data/failure-backoff.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const echo = ROUTINE_SOURCE_TASKS.find(task => task.id === "epa-echo")!;
const at = Date.parse("2026-10-01T08:00:00.000Z"), hour = 3_600_000;
test("ECHO's repeat failures move its next attempt later, cap at one day, and success resets it", async () => {
  const store = new MemoryRoutineDataStore();
  for (let index = 0; index < 7; index++) {
    const time = new Date(at + index * hour).toISOString();
    const candidate = failedAcquisitionCandidate({ sourceId: echo.sourceId, recordClass: echo.recordClass, scope: echo.scope,
      requestedUrl: echo.requestedUrl, attemptedAt: time, failureDetail: "PUBLISHER_UNAVAILABLE: EPA row has no native facility ID or name.", parserVersion: echo.parserVersion });
    await processRegisteredRoutineCandidate(store, echo.id, candidate, time);
    const clock = await store.clock(echo.sourceId, echo.recordClass, echo.scope, echo.parserVersion);
    assert.equal(clock.failureStreak, index + 1);
    const delay = Math.min(24 * hour, hour * 2 ** index);
    assert.equal(failureRetryMs(echo.retryMs, clock), delay);
    assert.equal(routineTaskDue(echo, clock, Date.parse(time) + delay - 1), false);
    assert.equal(routineTaskDue(echo, clock, Date.parse(time) + delay), true);
  }
  const clock = await store.clock(echo.sourceId, echo.recordClass, echo.scope, echo.parserVersion);
  const latest = await store.latestCandidate(echo.sourceId, echo.recordClass, echo.scope);
  const recheckedAt = new Date(at + 6 * hour + 60_000).toISOString();
  await store.recordRecheck(latest!.id, recheckedAt, "RECHECKED_UNCHANGED: same EPA refusal, held values unchanged.");
  const rechecked = await store.clock(echo.sourceId, echo.recordClass, echo.scope, echo.parserVersion);
  assert.equal(rechecked.failureStreak, 8, "rechecking the same held candidate is another failure too");
  assert.equal(rechecked.lastAttemptedAt, recheckedAt);
  const succeeded = { ...clock, lastSucceededObservedAt: new Date(at + 7 * hour).toISOString() };
  assert.equal(failureRetryMs(echo.retryMs, succeeded), hour, "a success cancels the entire old streak");
  const firstNewFailure = { failureStreak: 1, lastAttemptedAt: new Date(at + 8 * hour).toISOString(), lastSucceededObservedAt: succeeded.lastSucceededObservedAt };
  assert.equal(routineTaskDue(echo, firstNewFailure, at + 9 * hour), true, "the first failure after success gets the ordinary retry");
});

test("a different source failure or a successful candidate ends the repeated-failure streak", () => {
  const failure = (detail: string) => ({ failureCode: "SOURCE_RETRIEVAL_FAILED", failureDetail: detail });
  assert.equal(repeatedFailureStreak([failure("HTTP 503 at 2026-10-23"), failure("HTTP 503 at 2026-10-22"), failure("malformed EPA row")]), 2);
  assert.equal(repeatedFailureStreak([failure("malformed EPA row"), failure("HTTP 503")]), 1);
  assert.equal(repeatedFailureStreak([failure("HTTP 404"), failure("HTTP 503")]), 1);
  assert.equal(repeatedFailureStreak([{ failureCode: null, failureDetail: null }, failure("malformed EPA row")]), 0);
  assert.equal(repeatedFailureStreak([failure("malformed EPA row"), { failureCode: null, failureDetail: null }, failure("malformed EPA row")]), 1);
});
