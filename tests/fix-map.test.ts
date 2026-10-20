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

test("place and tried checks read only the requested places", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const repo = createFixMapRepository(async (sql, params) => { calls.push({ sql, params }); return []; });
  await repo.forPlace("division");
  await repo.forPlaces("method", ["division"]);
  await repo.put(row);
  assert.match(calls[0]!.sql, /WHERE place_id = \$1/);
  assert.deepEqual(calls[0]!.params, ["division", 200]);
  assert.match(calls[1]!.sql, /WHERE method_id = \$1/);
  assert.deepEqual(calls[1]!.params, ["method", ["division"]]);
  assert.match(calls[2]!.sql, /ON CONFLICT \(method_id, place_id\)/);
});

test("a first trial replaces scheduled work, and ordering compares instants across offsets", () => {
  const pending = { ...row, state: "UNTRIED" as const, triedAt: null, attemptId: null, updatedAt: "2026-10-05T00:00:00Z" };
  assert.equal(applyFixResult(pending, row).state, "WORKS");
  assert.equal(applyFixResult(pending, { ...pending, updatedAt: "2026-10-04T00:00:00Z" }), pending);
  assert.equal(applyFixResult(row, { ...row, triedAt: "2026-10-04T00:30:00+01:00" }), row);
});

test("method evidence and proof cover places beyond the first thousand without returning their histories", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { FIX_MAP_DDL, methodStatistics, methodWorksOf } = await import("../lib/method/fix-map.ts");
  const { proofFromStatistics, DEFAULT_FIX_PROOF_BAR } = await import("../lib/method/fix-status.ts");
  const db = new PGlite();
  try {
    for (const ddl of FIX_MAP_DDL) await db.exec(ddl);
    const observations: FixMapRow[] = Array.from({ length: 2005 }, (_, i) => ({ ...row, methodId: "national",
      placeId: `ocd-division/country:us/state:${["az", "nj", "wy"][i % 3]}/county:${String(i).padStart(5, "0")}`,
      state: i < 1500 ? "WORKS" : "FAILS", triedAt: new Date(Date.parse(row.triedAt!) + i * 1000).toISOString() }));
    await db.query(`INSERT INTO cp_fix_map (method_id, place_id, state, tried_at, attempt_id, cause, updated_at)
      SELECT e->>'methodId', e->>'placeId', e->>'state', (e->>'triedAt')::timestamptz, e->>'attemptId', e->>'cause', (e->>'updatedAt')::timestamptz
      FROM jsonb_array_elements($1::jsonb) e`, [JSON.stringify(observations)]);
    const reads: string[] = [];
    const responses: Record<string, unknown>[][] = [];
    const map = createFixMapRepository(async (sql, params) => { reads.push(sql); const rows = (await db.query(sql, [...params])).rows as Record<string, unknown>[]; responses.push(rows); return rows; });
    const recentSince = "2026-10-04T00:25:00Z";
    const before = "2026-10-04T00:30:00Z";
    const counts = await map.statistics("national", recentSince, before);
    assert.deepEqual(counts, methodStatistics(observations, recentSince, before));
    assert.equal(proofFromStatistics(counts, DEFAULT_FIX_PROOF_BAR, false).status, "TESTING");
    assert.equal(proofFromStatistics(counts, DEFAULT_FIX_PROOF_BAR).status, "TESTING");
    assert.deepEqual(await map.worksFor(["national"]), methodWorksOf(observations, ["national"]));
    assert.match(reads.at(-1)!, /FROM cp_fix_map/);
    const oncePerCycle=reads.length;
    assert.deepEqual(await map.worksFor(["national"]), methodWorksOf(observations, ["national"]));
    assert.equal(reads.length,oncePerCycle,"an unchanged method is aggregated only once in this cycle");
    const last = observations.at(-1)!;
    assert.equal((await map.forPlaces("national", [last.placeId]))[0]!.state, "FAILS");
    const newest = observations[1499]!;
    await map.put({ ...newest, state: "FAILS", triedAt: "2026-10-06T00:00:00Z" });
    assert.deepEqual(await map.worksFor(["national"]), methodWorksOf(observations.map(r => r.placeId === newest.placeId ? { ...r, state: "FAILS" } : r), ["national"]));
    await db.query("DELETE FROM cp_fix_map WHERE method_id = $1 AND place_id LIKE $2", ["national", "%state:az/%"]);
    const nextCycle=createFixMapRepository(async(sql,params)=>(await db.query(sql,[...params])).rows as Record<string,unknown>[]);
    assert.deepEqual((await nextCycle.worksFor(["national"])).get("national")!.states, ["nj", "wy"]);
    await map.put({...row,methodId:"census",placeId:"government:US-PR:123456",state:"WORKS"});
    assert.equal((await map.statistics("census")).states,1);
    assert.deepEqual((await map.worksFor(["census"])).get("census")?.states,["pr"]);
  } finally { await db.close(); }
});
