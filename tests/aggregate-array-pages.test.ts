import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgAggregateRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { memoryAggregateRepository } from "../lib/control-plane/repository/memory.ts";
import { fileAggregateRepository } from "../lib/control-plane/repository/file-store.ts";
import type { AggregateRepository } from "../lib/control-plane/repository/types.ts";
import { addFixItem, completeFixItem, startFixItem, fixItems } from "../lib/control-plane/fix-list.ts";
import { defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { addUpdate } from "../lib/control-plane/updates.ts";

const NOW = "2026-10-20T10:00:00.000Z", LATER = "2026-10-20T11:00:00.000Z";
async function parity(repo: AggregateRepository<Record<string, unknown>>) {
  const source = {opaque: {unrelated: "untouched country data"}, updatedAt: NOW,
    members: [{id: "a", state: "FIXED", at: "1"}, {id: "b", state: "OPEN", at: "2"}, {id: "c", state: "FIXED", at: "3"},
      {id: "d", state: "OPEN", at: "4"}, {id: "e", state: "OPEN", at: "5"}]};
  await repo.put("current", source, NOW);
  const first = await repo.readArrayPage!("current", "members", {limit: 2, projection: {id: true}});
  assert.deepEqual(first?.values, [{id: "a"}, {id: "b"}]);
  assert.equal(first?.next, 2);
  const second = await repo.readArrayPage!("current", "members", {after: first!.next!, limit: 2, match: {path: ["state"], value: "OPEN"}});
  assert.deepEqual(second?.values, [source.members[3], source.members[4]]);
  assert.equal(second?.next, 5);
  assert.deepEqual((await repo.readArrayPage!("current", "members", {after: 5}))?.values, []);
  await repo.put("nested", { payload: { outcomes: source.members }, other: ["unrelated"] }, NOW);
  assert.deepEqual((await repo.readArrayPage!("nested", ["payload", "outcomes"], { after: 1, limit: 2, projection: { id: true } }))?.values,
    [{ id: "b" }, { id: "c" }], "nested histories are paged at their source rather than materialized with their parent");
  const changed = {id: "b", state: "OPEN", at: "6", detail: "only this member changed"};
  const written = await repo.compareAndSetArrayItem!("current", 1, "members", ["id"], "b", changed, LATER,
    {limit: 3, discardPath: ["state"], discardValue: "FIXED", oldestPath: ["at"]}, {small: "new field", updatedAt: "ignored"});
  assert.deepEqual(written.value, changed);
  assert.equal(written.revision, 2);
  const held = (await repo.mustRead("current")).value;
  assert.deepEqual(held, {...source, updatedAt: LATER, members: [changed, source.members[3], source.members[4]], small: "new field"});
  await assert.rejects(repo.compareAndSetArrayItem!("current", 1, "members", ["id"], "b", null, LATER), /[Cc]oncurrent|revision/);
  await repo.compareAndSetFields!("current", 2, {small: "patched"}, LATER);
  assert.deepEqual((await repo.mustRead("current")).value.opaque, source.opaque);
  await repo.compareAndSetArrayItem!("current", 3, "members", ["id"], "b", null, LATER);
  assert.deepEqual((await repo.readArrayPage!("current", "members"))?.values, [source.members[3], source.members[4]]);
  await assert.rejects(repo.readArrayPage!("current", "members", {limit: 129}), /PAGE_INVALID/);
  const expired="2026-10-18T00:00:00Z", boundary="2026-10-19T00:00:00Z";
  await repo.put("time",{members:[{id:"z",at:expired},{id:"c",at:NOW},{id:"a",at:boundary},{id:"b",at:NOW}]},NOW);
  const keyed=await repo.readArrayPage!("time","members",{limit:2,order:{path:["id"]},projection:{id:true}});
  assert.deepEqual(keyed?.values,[{id:"a"},{id:"b"}]);
  assert.equal(keyed?.next,null);assert.equal(keyed?.nextKey,"b");
  const pruning={limit:100,discardPath:["id"],discardValue:"",oldestPath:["at"],pruneBefore:{path:["at"],at:boundary}};
  await repo.compareAndSetArrayItem!("time",1,"members",["id"],"n",{id:"n",at:NOW},LATER,pruning);
  assert.deepEqual((await repo.readArrayPage!("time","members",{limit:2,order:{path:["id"],after:keyed!.nextKey!},projection:{id:true}}))?.values,[{id:"c"},{id:"n"}],"prefix pruning never skips a live keyset member");
  await repo.compareAndSetArrayItem!("time",2,"members",["id"],"past",{id:"past",at:expired},LATER,pruning);
  assert.deepEqual(((await repo.readArrayPage!("time","members",{order:{path:["id"]}}))?.values as {id:string}[]).map(row=>row.id),["a","b","c","n"],"expired appends are pruned and the exact boundary stays");
}

test("memory, file and Postgres array pages, retained member changes and finite field patches have the same revision-fenced semantics", async () => {
  await parity(memoryAggregateRepository("fixture"));
  const directory = await mkdtemp(join(tmpdir(), "array-pages-"));
  try { await parity(fileAggregateRepository(directory, "fixture", "fixture")); }
  finally { await rm(directory, {recursive: true, force: true}); }
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE aggregates(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz)");
    const sql: Sql = {query: async (text, params) => (await db.query(text, params ? [...params] : [])).rows};
    await parity(pgAggregateRepository(sql, "fixture", "aggregates"));
  } finally { await db.close(); }
});

test("a fix or update reads and writes only its selected member or bounded feed, leaving other open fixes in Postgres", async () => {
  const db = new PGlite(); const transferred: unknown[] = [];
  try {
    await db.exec("CREATE TABLE cp_admin_config(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz)");
    const sql: Sql = {query: async (text, params) => { const rows = (await db.query(text, params ? [...params] : [])).rows; transferred.push(rows); return rows; }};
    const adminConfig = pgAggregateRepository<AdminConfig>(sql, "AdminConfig", "cp_admin_config");
    const others = Array.from({length: 1000}, (_,index) => ({id: `other-${index}`, where: `other-place-${index}`, says: "unrelated saved evidence ".repeat(80),
      addedBy: "fixture", addedAt: NOW, state: "OPEN" as const}));
    await adminConfig.put("current", {...defaultAdminConfig(NOW), fixList: others, settings: {kept: true}}, NOW);
    transferred.length = 0;
    const repos = {adminConfig};
    const id = await addFixItem(repos, {where: "own place", says: "its source changed", by: "fixture", at: LATER});
    await startFixItem(repos, id, LATER);
    await completeFixItem(repos, id, {whatChanged: "source repaired", changedBy: "fixture", before: "old", after: "new"}, LATER);
    await addUpdate(repos, {id: "own-update", what: "One source was repaired", at: LATER, label: "TESTING"});
    assert.ok(!JSON.stringify(transferred).includes("unrelated saved evidence"), "country fixes never enter the worker for a native member change");
    assert.ok(JSON.stringify(transferred).length < 10_000);
    const current = (await adminConfig.mustRead("current")).value;
    assert.equal(fixItems(current).filter(row => row.id.startsWith("other-")).length, 1000, "open fixes remain owed above the quiet-item cap");
    assert.deepEqual(current.settings, {kept: true});
    assert.equal(current.updates?.[0].id, "own-update");
    assert.equal(fixItems(current).find(row => row.id === id), undefined, "the completed quiet item follows the existing retention rule");
  } finally { await db.close(); }
});
