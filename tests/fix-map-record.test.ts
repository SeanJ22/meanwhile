import assert from "node:assert/strict";
import test from "node:test";

import { fixResultsFromAttempt, memoryFixMap, recordAttempts, type MethodAttempt } from "../lib/method/fix-map-record.ts";

const at = "2026-10-04T10:00:00Z";
const base: MethodAttempt = { kind: "SCOUT", attemptId: "a1", placeId: "place-1", methodIds: ["method-x", "method-x", " method-y "], outcome: "SUCCEEDED", at };

test("an attempt writes one result per distinct method it used, and nothing when it could not tell", () => {
  const rows = fixResultsFromAttempt(base);
  assert.deepEqual(rows.map((r) => [r.methodId, r.state, r.cause]), [["method-x", "WORKS", null], ["method-y", "WORKS", null]]);
  assert.deepEqual(fixResultsFromAttempt({ ...base, outcome: "INCONCLUSIVE" }), []);
  assert.deepEqual(fixResultsFromAttempt({ ...base, at: "not a time" }), []);
  const failed = fixResultsFromAttempt({ ...base, kind: "ROUTE_RUN", outcome: "FAILED", methodIds: ["m"] });
  assert.equal(failed[0]!.state, "FAILS");
  assert.equal(failed[0]!.cause, "the route run did not succeed");
});

test("a method used in three places shows three entries with the right outcomes, from each kind of attempt", async () => {
  const map = memoryFixMap();
  const result = await recordAttempts(map, [
    { ...base, kind: "SCOUT", attemptId: "s", placeId: "p1", methodIds: ["m"], outcome: "SUCCEEDED" },
    { ...base, kind: "DETECTIVE", attemptId: "d", placeId: "p2", methodIds: ["m"], outcome: "FAILED", cause: "the listing now sits behind a login" },
    { ...base, kind: "ACQUIRER_VERDICT", attemptId: "q", placeId: "p3", methodIds: ["m"], outcome: "SUCCEEDED" },
    { ...base, kind: "AUDIT", attemptId: "x", placeId: "p4", methodIds: ["m"], outcome: "INCONCLUSIVE" },
  ]);
  assert.deepEqual(result, { written: 3, skipped: 1, failed: 0 });
  const rows = await map.forPlaces("m", ["p1", "p2", "p3"]);
  assert.deepEqual(rows.map((r) => [r.placeId, r.state]), [["p1", "WORKS"], ["p2", "FAILS"], ["p3", "WORKS"]]);
  assert.equal(rows[1]!.cause, "the listing now sits behind a login");
});

test("one place's result never overwrites another's, a replay is the same write, and a later attempt names the one it replaced", async () => {
  const map = memoryFixMap();
  await recordAttempts(map, [{ ...base, attemptId: "one", placeId: "p1", methodIds: ["m"], outcome: "SUCCEEDED", at: "2026-10-04T10:00:00Z" },
    { ...base, attemptId: "two", placeId: "p2", methodIds: ["m"], outcome: "FAILED", cause: "moved", at: "2026-10-04T11:00:00Z" }]);
  await recordAttempts(map, [{ ...base, attemptId: "one", placeId: "p1", methodIds: ["m"], outcome: "SUCCEEDED", at: "2026-10-04T10:00:00Z" }]);
  await recordAttempts(map, [{ ...base, attemptId: "three", placeId: "p1", methodIds: ["m"], outcome: "FAILED", cause: "layout changed", at: "2026-10-04T12:00:00Z" }]);
  const byPlace = Object.fromEntries((await map.forPlaces("m", ["p1", "p2", "p3"])).map((r) => [r.placeId, r]));
  assert.equal(byPlace.p2!.state, "FAILS");
  assert.equal(byPlace.p1!.state, "FAILS");
  assert.equal(byPlace.p1!.supersededAttemptId, "one");
});

test("a write that fails is counted and never thrown into the attempt it describes", async () => {
  const broken = { put: async () => { throw new Error("store down"); } };
  assert.deepEqual(await recordAttempts(broken, [base]), { written: 0, skipped: 0, failed: 2 });
});
