import assert from "node:assert/strict";
import test from "node:test";
import { controlPlaneMigrationDb } from "./helpers/dg-migration-db.ts";
import { configuredHeldDiggerReads, createHeldDiggerReads, HELD_DIGGER_GAP_ROUTES, HELD_DIGGER_PENDING_SQL,
  HELD_DIGGER_READ_CLOCK_SQL, HELD_DIGGER_SOURCES_SQL, type HeldDiggerSourceRow } from "../lib/control-plane/workers/held-digger-sources.ts";

const AT = new Date(Date.now() - 60_000).toISOString(), NOW = new Date(Date.now() + 60_000).toISOString();
const SOURCE_SECRET = "SOURCE_CONTENT_MUST_STAY_ON_SERVER", WORKER_SECRET = "UNRELATED_WORKER_CONTRACT";
const source = (routeId = "held-subject-details:profile", overrides: Record<string, unknown> = {}) => ({
  workItemId: "held-item", routeId, state: "DISPOSED", disposition: { disposition: "INGESTED", artifactIds: ["owned-capture"] },
  target: "https://example.gov/only-full-task-lookup", sourceBody: SOURCE_SECRET.repeat(100), ...overrides,
});
async function fixture() {
  const { pg } = await controlPlaneMigrationDb();
  const calls: { text: string; params: readonly unknown[]; output: readonly Record<string, unknown>[] }[] = [];
  const sql = { query: async (text: string, params: readonly unknown[] = []) => {
    const output = text === HELD_DIGGER_READ_CLOCK_SQL ? [{ read_at: NOW }] : (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    calls.push({ text, params, output }); return output;
  } };
  const save = (id: string, value: unknown, at = AT) => pg.query("INSERT INTO cp_route_tasks(id,revision,updated_at,value,changed_at) VALUES($1,1,$3,$2,$3) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,changed_at=excluded.changed_at",
    [id, JSON.stringify({ id, ...(value as object) }), at]);
  return { pg, sql, calls, save };
}

test("only recognized closed acquisition metadata leaves SQL; unrelated histories and worker contracts remain on the server", async () => {
  const f = await fixture();
  try {
    await f.pg.exec(`INSERT INTO cp_route_tasks(id,revision,updated_at,value,changed_at) SELECT 'unrelated-'||n,1,'${AT}'::timestamptz,
      jsonb_build_object('routeId','research-source','state','DISPOSED','sourceBody',repeat('${SOURCE_SECRET}',100),
        'workerTask',jsonb_build_object('contract',jsonb_build_object('text','${WORKER_SECRET}'))), '${AT}'::timestamptz
      FROM generate_series(1,500) n`);
    for (const [n, code] of [...HELD_DIGGER_GAP_ROUTES, "held-subject-details:profile"].entries()) await f.save(`eligible-${n}`, source(code));
    await f.save("open", source(undefined, { state: "CLAIMED", disposition: null }));
    await f.save("not-closed", source(undefined, { state: "PENDING" }));
    await f.save("worker", source(undefined, { workerTask: { role: "ACQUIRER", contract: { text: WORKER_SECRET } } }));
    await f.save("empty", source(undefined, { disposition: { disposition: "INGESTED", artifactIds: [] } }));
    await f.save("malformed", source(undefined, { disposition: { disposition: "INGESTED", artifactIds: {} } }));
    await f.save("miss", source(undefined, { disposition: { disposition: "WALKED_NO_YIELD", artifactIds: ["capture"] } }));
    await f.save("older", source(), "2026-10-19T07:00:00.000Z");
    await f.save("future", source(), new Date(Date.parse(NOW) + 1).toISOString());
    const rows: HeldDiggerSourceRow[] = [], sizes: number[] = [];
    const result = await createHeldDiggerReads(f.sql, 2).sourceChanges(AT, async page => { rows.push(...page); sizes.push(page.length); });
    assert.equal(result.through, NOW); assert.deepEqual(sizes, [2, 2, 2]);
    assert.deepEqual(rows.map(row => row.id), [0, 1, 2, 3, 4, 5].map(n => `eligible-${n}`));
    assert.equal(f.calls[0]!.text, HELD_DIGGER_READ_CLOCK_SQL, "the DB clock is read before any page");
    assert.deepEqual(f.calls.filter(call => call.text === HELD_DIGGER_SOURCES_SQL).map(call => call.params[2]), [null, "eligible-1", "eligible-3", "eligible-5"]);
    for (const row of rows) assert.deepEqual(Object.keys(row.value).sort(), ["disposition", "id", "routeId", "state", "workItemId"]);
    const transferred = JSON.stringify(f.calls.map(call => call.output));
    assert.ok(!transferred.includes(SOURCE_SECRET)); assert.ok(!transferred.includes(WORKER_SECRET));
    assert.ok(!transferred.includes("unrelated-")); assert.ok(!transferred.includes("future"));
    assert.ok(Buffer.byteLength(transferred) < 3000, "only the six tiny closure headers leave the test database");
    assert.equal((await f.pg.query<{ n: number }>("SELECT count(*)::int n FROM cp_route_tasks")).rows[0]!.n, 514);
  } finally { await f.pg.close(); }
});

test("a capture acquired before HTTP closure appears on the closure change and a failed later page never returns an advance clock", async () => {
  const f = await fixture();
  try {
    await f.save("acquired-first", source(undefined, { state: "CLAIMED", disposition: null }));
    const reads = createHeldDiggerReads(f.sql, 1), rows: HeldDiggerSourceRow[] = [];
    const first = await reads.sourceChanges(null, async page => { rows.push(...page); });
    assert.equal(rows.length, 0);
    await f.save("acquired-first", source(), NOW);
    const second = await reads.sourceChanges(new Date(Date.parse(first.through) - 60_000).toISOString(), async page => { rows.push(...page); });
    assert.equal(second.through, NOW); assert.equal(rows[0]!.value.disposition!.artifactIds[0], "owned-capture");
    await f.save("second", source("AGENDA_NOT_HELD"));
    const seen: string[] = [];
    await assert.rejects(reads.sourceChanges(null, async page => {
      if (seen.length) throw Error("SECOND_PAGE_UNAVAILABLE");
      seen.push(page[0]!.id);
    }), /SECOND_PAGE_UNAVAILABLE/);
    assert.deepEqual(seen, ["acquired-first"]);
    let queries = 0;
    const failed = createHeldDiggerReads({ query: async (text, params) => {
      if (text === HELD_DIGGER_SOURCES_SQL && ++queries === 2) throw Error("QUERY_PAGE_UNAVAILABLE");
      return f.sql.query(text, params);
    } }, 1);
    await assert.rejects(failed.sourceChanges(null, async () => {}), /QUERY_PAGE_UNAVAILABLE/);
    const replay: string[] = [];
    await reads.sourceChanges(null, async page => { replay.push(...page.map(row => row.id)); });
    assert.deepEqual(replay, ["acquired-first", "second"], "a caller retaining its old cursor can replay every page");
  } finally { await f.pg.close(); }
});

test("due metadata contains only pending or reclaimable held-worker IDs, with no completed or claimed history", async () => {
  const f = await fixture();
  try {
    for (const [id, kind, state] of [["due-a", "HELD_SUBJECT_DETAILS", "PENDING"], ["due-b", "HELD_MEETING_DETAILS", "RECLAIMABLE"],
      ["done", "HELD_SUBJECT_DETAILS", "RESULT_RECORDED"], ["disposed", "HELD_MEETING_DETAILS", "DISPOSED"],
      ["claimed", "HELD_SUBJECT_DETAILS", "CLAIMED"], ["research", "OTHER_RECORD", "PENDING"]]) {
      await f.save(id!, { state, workerTask: { role: "ACQUIRER", contract: { schemaVersion: 2, recordClass: kind, largePayload: WORKER_SECRET.repeat(100) } } });
    }
    await f.save("wrong-role", { state: "PENDING", workerTask: { role: "VALIDATOR", contract: { schemaVersion: 2, recordClass: "HELD_SUBJECT_DETAILS" } } });
    await f.save("old-schema", { state: "PENDING", workerTask: { role: "ACQUIRER", contract: { schemaVersion: 1, recordClass: "HELD_SUBJECT_DETAILS" } } });
    await f.save("string-schema", { state: "PENDING", workerTask: { role: "ACQUIRER", contract: { schemaVersion: "2", recordClass: "HELD_SUBJECT_DETAILS" } } });
    assert.deepEqual(await createHeldDiggerReads(f.sql, 1).pendingTaskIds(), ["due-a", "due-b"]);
    assert.ok(f.calls.every(call => call.text === HELD_DIGGER_PENDING_SQL));
    assert.deepEqual(f.calls.flatMap(call => call.output), [{ id: "due-a" }, { id: "due-b" }]);
    assert.ok(!JSON.stringify(f.calls.map(call => call.output)).includes(WORKER_SECRET));
  } finally { await f.pg.close(); }
});

test("production requires a configured filtered reader instead of silently scanning repository history", () => {
  assert.throws(() => configuredHeldDiggerReads({ NODE_ENV: "production" }), /HELD_DIGGER_SOURCE_DATABASE_UNCONFIGURED/);
});
