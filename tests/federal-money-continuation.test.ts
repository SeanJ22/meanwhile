import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../lib/db/schema.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { federalMoneyContinuationPending, MemoryRoutineDataStore, routineClockPointerRead } from "../lib/civic-data/store.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { federalMoneyCandidate, type FederalMoneyNationalProjection } from "../lib/federal-money/candidate.ts";

const AT = "2026-10-12T23:01:00.000Z";
const FAILED_AT = "2026-10-12T23:06:00.000Z";
const COMPLETE_AT = "2026-10-13T00:06:00.000Z";
const counts = { loaded: 1, joined: 0, unjoined: 1 };
const task = routineTaskFromContract(requiredRoutineContract("openfema"));

function marker(complete: boolean): FederalMoneyNationalProjection {
  return { formatVersion: 2, source: "openfema", state: "US", counts, states: [{ state: "AR",
    status: complete ? "COMPLETE" : "BACKFILL", counts,
    cursor: complete ? null : { source: "openfema", phase: "declarations", offset: 1 },
    lastCompleteAt: complete ? COMPLETE_AT : null, reason: null }] };
}

test("verified partial national acquisition resumes on the next admission while complete sources keep their own clock", () => {
  for (const source of ["openfema", "usaspending", "federal-audit-clearinghouse", "sam-gov-entities"]) {
    const sourceTask = routineTaskFromContract(requiredRoutineContract(source));
    const complete = { lastAttemptedAt: AT, lastSucceededObservedAt: AT, continuationPending: false };
    assert.equal(routineTaskDue(sourceTask, complete, Date.parse(AT) + 5 * 60_000), false, source);
    assert.equal(routineTaskDue(sourceTask, { ...complete, continuationPending: true }, Date.parse(AT) + 5 * 60_000), true, source);
    assert.equal(routineTaskDue(sourceTask, complete, Date.parse(AT) + sourceTask.cadenceMs - 1), false, source);
    assert.equal(routineTaskDue(sourceTask, complete, Date.parse(AT) + sourceTask.cadenceMs), true, source);
  }
  const pending = { lastAttemptedAt: AT, lastSucceededObservedAt: AT, continuationPending: true };
  assert.equal(routineTaskDue({ ...task, scope: "openfema:AR" }, pending, Date.parse(AT) + 1), false, "state pointers never own source admission");
  assert.equal(routineTaskDue({ ...task, contract: { ...task.contract, fanOut: undefined } }, pending, Date.parse(AT) + 1), false);
  const fec = routineTaskFromContract(requiredRoutineContract("fec-funding"));
  assert.equal(routineTaskDue(fec, pending, Date.parse(AT) + 5 * 60_000), false, "unrelated schedules ignore continuation metadata");
});

test("the persisted pending marker survives a real failed attempt, whose retry clock postpones admission", async t => {
  t.mock.method(Date, "now", () => Date.parse(COMPLETE_AT));
  const store = new MemoryRoutineDataStore();
  const pending = federalMoneyCandidate({ projection: marker(false),
    page: { facts: [], captures: [], complete: false, declaredTotal: null }, now: AT });
  const first = await processRegisteredRoutineCandidate(store, "openfema", pending, AT);
  assert.equal(first.promoted?.versionId, pending.id, first.candidate.failureDetail ?? "");
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.continuationPending, true);
  assert.equal(routineTaskDue(task, clock, Date.parse(FAILED_AT)), true);
  await recordRegisteredSourceAcquisitionFailure({ store, contractId: "openfema", attemptedAt: FAILED_AT,
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "OpenFEMA did not answer the continued page.") });
  const failed = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(failed.continuationPending, true, "the previous verified progress remains held");
  assert.equal(failed.lastSucceededObservedAt, AT);
  assert.equal(failed.lastAttemptedAt, FAILED_AT);
  assert.equal(routineTaskDue(task, failed, Date.parse(FAILED_AT) + task.retryMs - 1), false);
  assert.equal(routineTaskDue(task, failed, Date.parse(FAILED_AT) + task.retryMs), true);
  const complete = federalMoneyCandidate({ projection: marker(true),
    page: { facts: [], captures: [], complete: true, declaredTotal: null }, now: COMPLETE_AT });
  const final = await processRegisteredRoutineCandidate(store, "openfema", complete, COMPLETE_AT);
  assert.equal(final.promoted?.versionId, complete.id, final.candidate.failureDetail ?? "");
  const settled = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(settled.continuationPending, false);
  assert.equal(routineTaskDue(task, settled, Date.parse(COMPLETE_AT) + 5 * 60_000), false);
});

test("Postgres computes only the marker's continuation flag inside the normal batched pointer read", () => {
  const query = routineClockPointerRead(drizzle.mock({ schema }), "FEDERAL_MONEY", "openfema:US").toSQL().sql;
  assert.match(query, /jsonb_array_elements/);
  assert.match(query, /'states'/);
  assert.match(query, /'BACKFILL'/);
  assert.match(query, /'cursor'/);
  assert.doesNotMatch(query, /"payload"\s*,/, "the complete marker payload never leaves Postgres for admission");
  assert.doesNotMatch(routineClockPointerRead(drizzle.mock({ schema }), "FEC_FUNDING", "federal-supported").toSQL().sql, /jsonb_array_elements/);
  assert.equal(federalMoneyContinuationPending(marker(false), "openfema"), true);
  assert.equal(federalMoneyContinuationPending(marker(true), "openfema"), false);
  assert.equal(federalMoneyContinuationPending({ ...marker(true), states: [{ ...marker(true).states[0], cursor: { source: "openfema", phase: "declarations" } }] }, "openfema"), true);
  assert.equal(federalMoneyContinuationPending(marker(false), "usaspending"), false);
  assert.equal(federalMoneyContinuationPending({ state: "AR", source: "openfema", states: [{ status: "BACKFILL" }] }, "openfema"), false);
});
