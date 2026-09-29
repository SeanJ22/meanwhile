import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_CLAIM_PAGE_MAX,
  activeClaimPageSql,
  mapActiveClaim,
  pgActiveWorkClaimReader,
  unavailableActiveWorkClaims,
} from "../lib/control-plane/repository/active-work-claims.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

const nowIso = "2026-09-28T12:00:00.000Z";
const expiry = "2026-09-28T12:05:00.000Z";
const lease = { id: "lease-1", routeTaskId: "route-1", holder: "worker", claimedAt: nowIso,
  heartbeatAt: nowIso, expiresAt: expiry, released: false };
const task = { id: "route-1", workItemId: "work-1", state: "CLAIMED" };
const attempt = { id: "attempt-1", leaseId: "lease-1", routeTaskId: "route-1",
  workItemId: "work-1", worker: { role: "SCOUT" }, endedAt: null, outcome: null };
const claim = { leaseKey: "route-1", lease, task, attempts: [attempt], expiresAt: expiry };

test("SQL bounds the complete active lease universe, excluding only the runner lock", () => {
  for (const withCursor of [false, true]) {
    const sql = activeClaimPageSql(withCursor);
    assert.match(sql, /count\(\*\)::bigint AS total FROM cp_leases/);
    assert.equal((sql.match(/\(l\.value->>'expiresAt'\) > \$1/g) ?? []).length, 2);
    assert.equal((sql.match(/\(l\.value->>'released'\) = 'false'/g) ?? []).length, 2);
    assert.equal((sql.match(/l\.id <> 'nightly-window'/g) ?? []).length, 2);
    assert.match(sql, /ORDER BY \(l\.value->>'expiresAt'\), l\.id LIMIT \$[24]/);
    assert.match(sql, /t\.id = p\.id/);
    assert.match(sql, /value->>'leaseId' = p\.value->>'id'/);
    assert.match(sql, /ORDER BY id LIMIT 2/);
    assert.doesNotMatch(sql, /\.list\(/);
  }
  assert.match(activeClaimPageSql(true), /\(\(l\.value->>'expiresAt'\), l\.id\) > \(\$2::text, \$3::text\)/);
});

test("lease ID, RouteTask ID, and Attempt ID remain distinct verified links", () => {
  assert.equal(mapActiveClaim(claim, nowIso).state, "RUNNING_ATTEMPT");
  assert.deepEqual(mapActiveClaim(claim, nowIso), {
    leaseKey: "route-1", leaseId: "lease-1", routeTaskId: "route-1", workItemId: "work-1",
    attemptId: "attempt-1", workerRole: "SCOUT", expiresAt: expiry,
    state: "RUNNING_ATTEMPT", reason: null,
  });
  assert.equal(mapActiveClaim({ ...claim, attempts: [] }, nowIso).state, "CLAIMED_NO_ATTEMPT");
  assert.equal(mapActiveClaim({ ...claim, attempts: [{ ...attempt, endedAt: nowIso, outcome: "COMPLETED" }] }, nowIso).state, "ENDED_ATTEMPT");
  for (const corrupted of [
    { ...claim, leaseKey: "foreign" },
    { ...claim, task: { ...task, id: "foreign" } },
    { ...claim, attempts: [{ ...attempt, routeTaskId: "foreign" }] },
    { ...claim, attempts: [attempt, { ...attempt, id: "other" }] },
    { ...claim, lease: { ...lease, released: true } },
    { ...claim, lease: { ...lease, expiresAt: nowIso } },
  ]) assert.equal(mapActiveClaim(corrupted, nowIso).state, "UNVERIFIED");
});

test("missing join index refuses the read instead of scanning or reporting zero", async () => {
  const calls: string[] = [];
  const sql = { async query(text: string) { calls.push(text); return []; } } as Sql;
  const page = await pgActiveWorkClaimReader(sql).readPage({ nowIso });
  assert.equal(page.available, false);
  assert.equal(page.totalActiveClaims, null);
  assert.equal(page.runningAttemptCount, null);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /pg_index/);
  assert.equal((await unavailableActiveWorkClaims().readPage({ nowIso })).hasMore, null);
});

test("an invalid or absent expiry index also refuses the counted range query", async () => {
  for (const indexes of [
    [{ name: "cp_attempts_lease_id", valid: true, indexdef: "index on ('leaseId')" }],
    [{ name: "cp_attempts_lease_id", valid: true, indexdef: "index on ('leaseId')" },
      { name: "cp_leases_expiry", valid: false, indexdef: "index on ('expiresAt')" }],
  ]) {
    let calls = 0;
    const sql = { async query() { calls++; return indexes; } } as Sql;
    const result = await pgActiveWorkClaimReader(sql).readPage({ nowIso });
    assert.equal(result.available, false);
    assert.equal(calls, 1);
  }
});

test("indexed read returns exact total and bounded page without pretending routine source runs are Attempts", async () => {
  const calls: { text: string; params?: readonly unknown[] }[] = [];
  const sql = { async query(text: string, params?: readonly unknown[]) {
    calls.push({ text, params });
    if (/pg_index/.test(text)) return [
      { name: "cp_attempts_lease_id", valid: true, indexdef: "CREATE INDEX cp_attempts_lease_id ON cp_attempts ((value ->> 'leaseId'))" },
      { name: "cp_leases_expiry", valid: true, indexdef: "CREATE INDEX cp_leases_expiry ON cp_leases ((value ->> 'expiresAt'))" },
    ];
    return [{ total: "3", items: [claim, { ...claim, leaseKey: "route-2", lease: { ...lease, id: "lease-2", routeTaskId: "route-2" },
      task: { ...task, id: "route-2" }, attempts: [] },
      { ...claim, leaseKey: "route-3", lease: { ...lease, id: "lease-3", routeTaskId: "route-3" },
        task: { ...task, id: "route-3" }, attempts: [] }] }];
  } } as Sql;
  const reader = pgActiveWorkClaimReader(sql);
  const page = await reader.readPage({ nowIso, limit: 2 });
  assert.equal(page.totalActiveClaims, 3);
  assert.equal(page.rows.length, 2);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.nextCursor, { expiresAt: expiry, leaseKey: "route-2" });
  assert.equal(page.runningAttemptCount, null);
  assert.deepEqual(calls[1].params, [nowIso, 3]);
  const complete = await reader.readPage({ nowIso });
  assert.equal(complete.hasMore, false);
  assert.equal(complete.runningAttemptCount, 1);
  assert.equal(ACTIVE_CLAIM_PAGE_MAX, 50);
  await assert.rejects(reader.readPage({ nowIso, limit: 51 }), /INVALID_ACTIVE_CLAIM_PAGE/);
  await assert.rejects(reader.readPage({ nowIso: "2026-09-28" }), /INVALID_ACTIVE_CLAIM_TIME/);
});

test("a failed indexed query is not converted to an empty universe", async () => {
  const sql = { async query(text: string) {
    if (/pg_index/.test(text)) return [
      { name: "cp_attempts_lease_id", valid: true, indexdef: "index on ('leaseId')" },
      { name: "cp_leases_expiry", valid: true, indexdef: "index on ('expiresAt')" },
    ];
    throw new Error("STORE_UNREACHABLE");
  } } as Sql;
  await assert.rejects(pgActiveWorkClaimReader(sql).readPage({ nowIso }), /STORE_UNREACHABLE/);
});
