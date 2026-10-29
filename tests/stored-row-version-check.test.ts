import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgAggregateRepository, pgAppendOnlyRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { shareVersionedRows, versionedRowsFor } from "../lib/db/versioned-rows.ts";
import { posixRelative } from "../scripts/repo-path.mjs";

const db=new PGlite();
after(()=>db.close());

test("every aggregate and log read checks database versions before a stored body crosses",async()=>{
  await db.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY,revision bigint,updated_at timestamptz,changed_at timestamptz,value jsonb);
    CREATE TABLE cp_log_worker_results(log_key text,record_id text,position bigint,changed_at timestamptz,recorded_at timestamptz,record jsonb,PRIMARY KEY(log_key,position));
    INSERT INTO cp_doors VALUES('a',1,now(),now(),'{"id":"a","status":"OPEN","large":"held"}');
    INSERT INTO cp_log_worker_results VALUES('work','r',0,now(),now(),'{"id":"r","kind":"found"}');`);
  const checked=new Set<string>(), held=new Map<string,string>();
  let bodies=0,versions=0;
  const sql:Sql={query:async(text,params=[])=>{
    const rows=(await db.query<Record<string,unknown>>(text,[...params])).rows;
    for (const row of rows) {
      const aggregate=Object.hasOwn(row,"id"),log=Object.hasOwn(row,"log_key")&&Object.hasOwn(row,"position");
      const key=aggregate?`row:${row.id}`:log?`log:${row.log_key}:${row.position}`:null;
      const body=Object.hasOwn(row,"value")||Object.hasOwn(row,"record");
      if(!key)continue;
      if(!body){checked.add(key);versions++;continue;}
      if(row.__unchanged===true)continue;
      // A CASE expression compares the held content version (or document
      // revision) and conditionally returns the body in the same statement.
      assert.ok(checked.has(key)||/CASE WHEN (?:revision::text|value_version)=\$2::text THEN NULL ELSE/.test(text),
        `stored body skipped the version check: ${text}`);
      bodies++;
    }
    return rows;
  }};
  shareVersionedRows(sql,"postgres://fixture:fixture@version-check.invalid/neondb",new CivicReadCache({
    read:async key=>held.get(key)??null,write:async(key,value)=>{held.set(key,value);},
  }));
  const aggregate=pgAggregateRepository<{id:string;status:string}>(sql,"Door","cp_doors");
  const log=pgAppendOnlyRepository<{id:string;kind:string}>(sql,"worker_results");
  const reads=[
    ()=>aggregate.read("a"),()=>aggregate.readNarrowed("a",{status:true}),()=>aggregate.list(),
    ()=>aggregate.listNarrowed({status:true}),()=>aggregate.readMany!(["a"]),
    ()=>aggregate.listWhere(["status"],"OPEN"),()=>aggregate.listWhereNarrowed(["status"],"OPEN",{status:true}),
    ()=>aggregate.listChangedSince!(null),()=>log.read("work"),()=>log.readEntry!("work","r"),()=>log.readWhere("work",["kind"],"found"),
    ()=>log.readRecentWhere("work",["kind"],"found",3,{kind:true}),()=>log.readSince("2000-01-01T00:00:00Z"),
    ()=>log.readStampedBetween!("2000-01-01T00:00:00Z","2100-01-01T00:00:00Z",()=>{}),
    ()=>log.readAll(),()=>log.readAllNarrowed({kind:true}),()=>log.readRecent("work",3),
    ()=>log.readLatest(["work"],{kind:true}),()=>log.readKeys!(["work"]),
  ];
  for(const read of reads){checked.clear();await read();}
  const before=bodies;
  for(const read of reads){checked.clear();await read();}
  assert.equal(bodies,before,"every unchanged shape is reused after its version check");
  assert.ok(versions>reads.length,"both passes ask the database for current versions");
  await db.exec(`UPDATE cp_doors SET revision=2,value=jsonb_set(value,'{status}','"CLOSED"');
    UPDATE cp_log_worker_results SET record=jsonb_set(record,'{kind}','"updated"')`);
  assert.equal((await aggregate.mustRead("a")).value.status,"CLOSED");
  assert.equal((await log.read("work"))[0].kind,"updated","even a log row changed outside the append API invalidates its copy");
});

test("owner snapshot projections reuse newer remembered full rows after the same SQL revision check", async () => {
  type Snapshot = { allRowsIndex: string[]; publishedAt: string; privatePayload: string };
  await db.exec(`CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,revision bigint,updated_at timestamptz,changed_at timestamptz,value jsonb)`);
  const first: Snapshot = { allRowsIndex: ["held"], publishedAt: "2026-10-26T20:00:00Z", privatePayload: "not selected" };
  await db.query("INSERT INTO cp_owner_snapshots VALUES('current',1,now(),now(),$1::jsonb)", [JSON.stringify(first)]);
  const held = new Map<string, string>(), selects: { text: string; params: readonly unknown[] }[] = [];
  let bodies = 0, beforeSelect: (() => Promise<void>) | null = null;
  const sql: Sql = { query: async (text, params = []) => {
    if (text.startsWith("SELECT")) {
      selects.push({ text, params });
      const race = beforeSelect; beforeSelect = null;
      await race?.();
    }
    const rows = (await db.query<Record<string, unknown>>(text, [...params])).rows;
    bodies += rows.filter(row => Object.hasOwn(row, "value") && row.value !== null).length;
    return rows;
  } };
  shareVersionedRows(sql, "postgres://fixture:fixture@owner-copy.invalid/neondb", new CivicReadCache({
    read: async key => held.get(key) ?? null, write: async (key, value) => { held.set(key, value); },
  }));
  const repo = pgAggregateRepository<Snapshot>(sql, "OwnerSnapshot", "cp_owner_snapshots");
  const project = () => repo.readNarrowed("current", { allRowsIndex: true });
  assert.deepEqual((await project())!.value, { allRowsIndex: ["held"] });
  assert.equal(bodies, 1);

  const second = { ...first, allRowsIndex: ["changed"], publishedAt: "2026-10-26T21:00:00Z" };
  await repo.compareAndSet("current", 1, second, second.publishedAt);
  selects.length = 0;
  assert.deepEqual((await project())!.value, { allRowsIndex: ["changed"] }, "only the named projection can leave the full local copy");
  assert.equal(selects.length, 1, "no separate database readback is added");
  assert.equal(selects[0]!.params[1], "2", "the newer full copy revision participates in the existing atomic comparison");
  assert.match(selects[0]!.text, /CASE WHEN revision::text=\$2::text THEN NULL ELSE/);
  assert.equal(bodies, 1, "an older projected copy cannot force a second body download after the write remembers the full row");
  assert.deepEqual((await project())!.value, { allRowsIndex: ["changed"] });
  assert.equal(bodies, 1, "the confirmed projection is reusable on the next read");

  const third = { ...second, publishedAt: "2026-10-26T22:00:00Z" };
  await repo.compareAndSet("current", 2, third, third.publishedAt);
  const unchanged = await project();
  assert.equal(unchanged!.revision, 3);
  assert.deepEqual(unchanged!.value, { allRowsIndex: ["changed"] });
  assert.equal(bodies, 1, "an unrelated publication timestamp does not redownload an already-held projection");

  await versionedRowsFor(sql).remember("cp_owner_snapshots", { id: "current", revision: 1, updated_at: first.publishedAt, value: first });
  selects.length = 0;
  assert.equal((await project())!.revision, 3);
  assert.equal(selects[0]!.params[1], "3", "a late older full copy cannot replace the newer narrowed copy");
  assert.equal(bodies, 1);

  const fourth = { ...third, allRowsIndex: ["fourth"], publishedAt: "2026-10-26T22:01:00Z" };
  await repo.compareAndSet("current", 3, fourth, fourth.publishedAt);
  beforeSelect = async () => { await db.query("UPDATE cp_owner_snapshots SET revision=5,value=jsonb_set(value,'{allRowsIndex}',$1::jsonb)", [JSON.stringify(["racing update"])]); };
  selects.length = 0;
  const raced = await project();
  assert.equal(selects.length, 1);
  assert.equal(selects[0]!.params[1], "4");
  assert.equal(raced!.revision, 5);
  assert.deepEqual(raced!.value, { allRowsIndex: ["racing update"] }, "a racing database revision returns its actual selected fields instead of the local write");
  assert.equal(bodies, 2);
  assert.deepEqual((await project())!.value, raced!.value);
  assert.equal(bodies, 2, "the older full write cannot invalidate the freshly read revision");
});

test("runtime sources expose no flag that can skip the shared version path",async()=>{
  const root = fileURLToPath(new URL("../", import.meta.url));
  const visit=async(directory:URL):Promise<void>=>{
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=new URL(entry.name+(entry.isDirectory()?"/":""),directory);
      if(entry.isDirectory())await visit(path);
      else if(/\.(?:ts|tsx|mts|mjs)$/.test(entry.name)){
        const source=await readFile(path,"utf8");
        assert.ok(!/\bbypassCache\b/.test(source),`${fileURLToPath(path)} can skip the version check`);
        // The accounting implementation needs the raw driver to record its own
        // traffic without recursively counting the recording query. Runtime
        // callers must enter through the shared database client.
        const rawDriverOwners = new Set(["lib/db/client.ts", "lib/db/transfer.ts"]);
        const isolatedReplayDrivers = new Set(["scripts/rb-a5-production-copy.mts", "scripts/rb-a5-connection-copy.mts",
          "scripts/lib/rb-a2-copy.ts", "scripts/lib/local-postgres-replay.mts", "scripts/lib/local-postgres-reader.mts"]);
        for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](@neondatabase\/serverless|pg|postgres)["']/g)) {
          const statement = source.slice(source.lastIndexOf(";", match.index) + 1, match.index);
          if (/\b(?:import|export)\s+type\b/.test(statement)) continue;
          const relative = posixRelative(root, fileURLToPath(path));
          assert.ok(match[1] === "@neondatabase/serverless" ? rawDriverOwners.has(relative) : isolatedReplayDrivers.has(relative),
            `${relative} imports a database driver outside the shared version path`);
        }
      }
    }
  };
  for(const directory of ["../lib/","../scripts/","../app/","../netlify/"])await visit(new URL(directory,import.meta.url));
  const adapter=await readFile(new URL("../lib/db/versioned-rows.ts",import.meta.url),"utf8");
  assert.doesNotMatch(adapter,/currentReaderRoute|readCheckpoint|jobState|new Map<string,\s*string>/,
    "all SQL adapters use the same body store, including Admin and fresh processes");
  const accounting=await readFile(new URL("../lib/db/transfer.ts",import.meta.url),"utf8");
  assert.equal([...accounting.matchAll(/\bneon\(url\)/g)].length,2,
    "only the counter writer and version-checked row adapter may own raw accounting clients");
  assert.equal([...accounting.matchAll(/\bsql\.query\(\s*[`"']SELECT\b/g)].length,2,
    "raw accounting SELECTs belong to the adapter's version and changed-body queries");
});
