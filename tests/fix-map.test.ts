import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFixResult, createFixMapRepository, type FixMapRow } from "../lib/method/fix-map.ts";
const row: FixMapRow = { methodId: "method", placeId: "division", state: "WORKS", triedAt: "2026-10-04T00:00:00Z", attemptId: "first", cause: null, updatedAt: "2026-10-04T00:00:00Z" };

test("replays and future untried rows preserve the last result; a new attempt names its predecessor", () => {
  assert.equal(applyFixResult(row, { ...row, state: "UNTRIED", attemptId: null, updatedAt: "2026-10-05T00:00:00Z" }), row);
  assert.equal(applyFixResult(row, { ...row, triedAt: "2026-10-03T00:00:00Z" }), row);
  const next = applyFixResult(row, { ...row, state: "FAILS", cause: "listing changed", triedAt: "2026-10-04T01:00:00Z", attemptId: "second" });
  assert.equal(next.supersededAttemptId, "first");
  assert.equal(applyFixResult(next, next).supersededAttemptId, "first");
  assert.throws(() => applyFixResult(row, { ...row, placeId: "another" }), /identities/);
});

test("place workers read only their place; Admin reads only its selected method", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const repo = createFixMapRepository(async (sql, params) => { calls.push({ sql, params }); return []; });
  await repo.forPlace("division");
  await repo.forMethod("method", 20);
  await repo.put(row);
  assert.match(calls[0]!.sql, /WHERE place_id = \$1/);
  assert.deepEqual(calls[0]!.params, ["division", 200]);
  assert.match(calls[1]!.sql, /WHERE method_id = \$1/);
  assert.deepEqual(calls[1]!.params, ["method", 20]);
  assert.match(calls[2]!.sql, /ON CONFLICT \(method_id, place_id\)/);
});
