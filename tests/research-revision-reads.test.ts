import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { pgAggregateRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { archivedAggregateRepository } from "../lib/control-plane/repository/dispatch-state.ts";
import { shareVersionedRows } from "../lib/db/versioned-rows.ts";
import { isControlPlaneRequestTimeout } from "../lib/control-plane/repository/request-bounds.ts";

const db = new PGlite();
after(() => db.close());
const at = "2026-10-25T07:00:00.000Z";
type Value = { id: string; state: string; active: boolean; text: string };

async function fixture() {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE FUNCTION cp_control_state(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT v->>'state' $$;
    CREATE TABLE cp_obligations(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now());
    CREATE TABLE cp_work_items(LIKE cp_obligations INCLUDING ALL);
    CREATE TABLE cp_work_items_archive(LIKE cp_obligations INCLUDING ALL);
    CREATE VIEW cp_work_items_history AS SELECT * FROM cp_work_items UNION ALL SELECT * FROM cp_work_items_archive;`);
  const held = new Map<string, string>();
  const statements: { text: string; params: readonly unknown[]; valueIds?: string[] }[] = [];
  const hook: { afterVersions?: () => Promise<void>; failed?: boolean } = {};
  const connection = () => {
    const sql: Sql = { query: async (text, params = []) => {
      if (hook.failed) throw Error("database unavailable");
      const statement: typeof statements[number] = { text, params };
      statements.push(statement);
      const rows = (await db.query<Record<string, unknown>>(text, [...params])).rows;
      statement.valueIds = rows.filter(row => Object.hasOwn(row, "value") && row.__unchanged !== true).map(row => String(row.id));
      if (/^SELECT id,revision FROM/.test(text) && hook.afterVersions) {
        const run = hook.afterVersions; delete hook.afterVersions; await run();
      }
      return rows;
    } };
    shareVersionedRows(sql, "postgres://test:test@db03.example/test", new CivicReadCache({
      read: async key => held.get(key) ?? null,
      write: async (key, value) => { held.set(key, value); },
    }));
    return sql;
  };
  const put = async (table: string, value: Value) => {
    await db.query(`INSERT INTO ${table}(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)
      ON CONFLICT(id) DO UPDATE SET revision=${table}.revision+1,value=EXCLUDED.value`, [value.id, at, JSON.stringify(value)]);
  };
  const values = () => statements.filter(row => row.valueIds?.length);
  return { connection, statements, hook, put, values };
}

test("research waves fetch changed values across repository instances and remove inactive rows from membership", async () => {
  const f = await fixture();
  const value = (id: string, state = "az", active = true): Value => ({ id, state, active, text: "held evidence ".repeat(10_000) });
  for (const row of [value("a"), value("b"), value("other-state", "nd")]) await f.put("cp_obligations", row);
  const open = () => pgAggregateRepository<Value>(f.connection(), "StandingObligation", "cp_obligations", { state: "az", activeOnly: true });
  assert.deepEqual((await open().list()).map(row => row.id), ["a", "b"]);
  f.statements.length = 0;
  assert.deepEqual((await open().list()).map(row => row.id), ["a", "b"]);
  assert.equal(f.values().length, 0, "a new wave asks only for current row revisions");
  await f.put("cp_obligations", value("a", "az", false));
  await f.put("cp_obligations", { ...value("b"), text: "new verified evidence" });
  await f.put("cp_obligations", value("c"));
  f.statements.length = 0;
  const rows = await open().list();
  assert.deepEqual(rows.map(row => row.id), ["b", "c"]);
  assert.equal(rows[0].value.text, "new verified evidence");
  assert.deepEqual(f.values().flatMap(row => row.params.at(-1)), ["b", "c"]);
});

test("archiving keeps the same held row and later history updates are fetched once", async () => {
  const f = await fixture(), sql = f.connection();
  const value: Value = { id: "work", state: "az", active: true, text: "reader data retained" };
  await f.put("cp_work_items", value);
  const hot = pgAggregateRepository<Value>(sql, "WorkItem", "cp_work_items");
  const archive = pgAggregateRepository<Value>(sql, "WorkItem", "cp_work_items_archive");
  const history = pgAggregateRepository<Value>(sql, "WorkItem", "cp_work_items_history");
  const repo = archivedAggregateRepository(hot, archive);
  assert.deepEqual((await repo.list()).map(row => row.value), [value]);
  await db.exec("INSERT INTO cp_work_items_archive SELECT * FROM cp_work_items; DELETE FROM cp_work_items;");
  f.statements.length = 0;
  assert.deepEqual((await repo.list()).map(row => row.value), [value]);
  assert.deepEqual((await history.readMany!(["work"])).map(row => row.value), [value]);
  assert.equal(f.values().length, 0, "an archive move preserves the revision and needs no second copy");
  await f.put("cp_work_items_archive", { ...value, text: "updated after closure" });
  assert.equal((await history.mustRead("work")).value.text, "updated after closure");
  assert.equal((await repo.list())[0].value.text, "updated after closure");
  assert.equal(f.values().length, 1);
});

test("a revision racing the value read is cached at its own revision, and outages never serve a stale held answer", async () => {
  const f = await fixture();
  const before: Value = { id: "race", state: "az", active: true, text: "old" };
  await f.put("cp_obligations", before);
  const repo = pgAggregateRepository<Value>(f.connection(), "StandingObligation", "cp_obligations");
  f.hook.afterVersions = () => f.put("cp_obligations", { ...before, text: "concurrent update" });
  assert.equal((await repo.list())[0].value.text, "concurrent update");
  f.statements.length = 0;
  assert.equal((await repo.mustRead("race")).revision, 2);
  assert.equal(f.values().length, 0);
  f.hook.failed = true;
  await assert.rejects(repo.read("race"), /database unavailable/);
});

test("a cut-off selection restarts in a fresh repository without fetching unchanged bodies", async t => {
  const f = await fixture();
  for (let i=0;i<205;i++) await f.put("cp_obligations",{id:`item-${String(i).padStart(3,"0")}`,state:"az",active:true,text:"held"});
  const before=process.env.WTP_PASS_DEADLINE_AT;
  t.after(()=>{if(before===undefined)delete process.env.WTP_PASS_DEADLINE_AT;else process.env.WTP_PASS_DEADLINE_AT=before;});
  const first=f.connection(), run=first.query.bind(first);
  first.query=async(text,params)=>{
    const rows=await run(text,params);
    if(text.includes("AS value") && text.includes("id=ANY"))process.env.WTP_PASS_DEADLINE_AT=new Date(0).toISOString();
    return rows;
  };
  const repo=pgAggregateRepository<Value>(first,"StandingObligation","cp_obligations",{state:"az",activeOnly:true});
  await assert.rejects(repo.list(),error=>isControlPlaneRequestTimeout(error)&&error.kind==="DEADLINE");
  delete process.env.WTP_PASS_DEADLINE_AT;
  await f.put("cp_obligations",{id:"item-001",state:"az",active:false,text:"stopped"});
  await f.put("cp_obligations",{id:"before-cursor",state:"az",active:true,text:"new"});
  f.statements.length=0;
  const resumed=pgAggregateRepository<Value>(f.connection(),"StandingObligation","cp_obligations",{state:"az",activeOnly:true});
  const rows=await resumed.list();
  const firstVersions=f.statements.find(row=>row.text.startsWith("SELECT id,revision FROM"))!;
  assert.doesNotMatch(firstVersions.text,/id > /,"restart needs no continuation path; confirmed copies avoid unchanged bodies");
  assert.equal(rows.length,205);assert.ok(rows.some(row=>row.id==="before-cursor"));assert.ok(!rows.some(row=>row.id==="item-001"));
  const transferred=f.values().flatMap(row=>row.valueIds??[]);
  assert.ok(!transferred.includes("item-002"),"the completed prefix stays held, rather than rebuilding its history");
  assert.ok(transferred.includes("item-204"));
});
