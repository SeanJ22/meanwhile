import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLinkingPages } from "../lib/control-plane/repository/migrations/DB-03A.ts";
import { moveRetiredDoorPages } from "../lib/control-plane/repository/migrations/RIVER-DOORCFG-149.ts";
import { LINKING_COPY_SCHEMA, installLinkingCopyQuery, linkingCopyIdentity, openLinkingCopy, saveLinkingCopy } from "../lib/facts/linking-copy.ts";
import { refreshVotingSources } from "../scripts/fetch-voting-sites.mts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../lib/civic-data/source-authority.ts";

const at = "2026-10-25T05:15:00Z";
const root = { url: "https://state.gov/elections", html: '<a href="https://county.example.org">County</a>' };
const page: OfficialLinkingPage = { url: "https://county.example.org/elections", html: '<a href="https://vendor.example.com/polls">Polls</a>'.repeat(2000), linkingPage: root };
const source = (id: string, url = "https://vendor.example.com/polls") => ({ id, url, scope: { state: "AZ" }, officialLinkingPage: page });
const connect = (db: PGlite) => ({ query: async (sql: string, params: readonly unknown[] = []) => (await db.query<Record<string, unknown>>(sql, [...params])).rows });
async function setup(government = false) {
  const control = new PGlite(), reader = new PGlite();
  await control.exec("CREATE TABLE cp_doors(id text PRIMARY KEY,revision integer,updated_at timestamptz,value jsonb)");
  await reader.exec(`CREATE TABLE source_copy(id bigint PRIMARY KEY,url text,final_url text,fetched_at timestamptz,http_status int,sha256 char(64),blob_key text UNIQUE,is_archive boolean)`);
  for (const id of ["one", "two"]) await control.query("INSERT INTO cp_doors VALUES($1,1,$2,$3)", [id,at,JSON.stringify({ config: { votingSource: JSON.stringify(source(id,government ? "https://polling.gov/places" : undefined)), votingMappings: JSON.stringify([source(id+"-mapping",government ? "https://polling.gov/places" : undefined)]) }, status: "OPEN" })]);
  return { control,reader,cp:connect(control),copies:connect(reader) };
}

test(".gov returns without opening a saved page; vendor decisions open only the necessary chain", async () => {
  const { id } = linkingCopyIdentity(page.url, page.html), rootId = linkingCopyIdentity(root.url, root.html).id;
  const ref = { url: page.url,sourceCopyId:id,linkingPage:{url:root.url,sourceCopyId:rootId} };
  const opened: number[] = [];
  const open = async (p: typeof ref | typeof ref.linkingPage) => { opened.push(p.sourceCopyId); return p.sourceCopyId === id ? page : root; };
  assert.equal(await isOfficialSource("https://anything.gov/polls",ref,undefined,async () => { throw Error("must not open"); }),true);
  assert.equal(await isOfficialSource("https://vendor.example.com/polls",ref,undefined,open),true);
  assert.deepEqual(opened,[rootId,id]);
  assert.equal(await isOfficialSource("https://unlinked.example.net",ref,undefined,open),false);
});

test("one migration deduplicates pages and mappings without changing authority or unrelated door data", async () => {
  const {control,reader,cp,copies}=await setup();
  try {
    const before=await control.query<{bytes:number}>("SELECT sum(octet_length(value::text))::int AS bytes FROM cp_doors");
    await migrateLinkingPages(cp,copies);
    const rows=await control.query<{value:{config:{votingSource:string;votingMappings:string};status:string}}>("SELECT value FROM cp_doors");
    const ids=new Set<number>();
    for(const row of rows.rows) {
      assert.equal(row.value.status,"OPEN");
      assert.equal(JSON.stringify(row.value).includes("officialLinkingPage"),false);
      assert.equal(JSON.stringify(row.value).includes("<a"),false);
      for(const door of [JSON.parse(row.value.config.votingSource),...JSON.parse(row.value.config.votingMappings)]) {
        ids.add(door.linkingPage.sourceCopyId);
        assert.equal(await isOfficialSource(door.url,door.linkingPage,undefined,p=>openLinkingCopy(p,copies.query)),isOfficialSource(door.url,page));
      }
    }
    assert.equal(ids.size,1);
    const held=await reader.query<{content:string;sha256:string}>("SELECT content,sha256 FROM source_copy WHERE id=$1",[...ids]);
    assert.equal(held.rows[0].content,page.html);
    assert.equal(createHash("sha256").update(held.rows[0].content).digest("hex"),held.rows[0].sha256);
    const after=await control.query<{bytes:number}>("SELECT sum(octet_length(value::text))::int AS bytes FROM cp_doors");
    assert.ok(after.rows[0].bytes < before.rows[0].bytes * .2);
    const count=(await reader.query<{n:number}>("SELECT count(*)::int AS n FROM source_copy")).rows[0].n;
    const revisions=JSON.stringify((await control.query("SELECT id,revision FROM cp_doors ORDER BY id")).rows);
    await migrateLinkingPages(cp,copies);
    assert.equal((await reader.query<{n:number}>("SELECT count(*)::int AS n FROM source_copy")).rows[0].n,count);
    assert.equal(JSON.stringify((await control.query("SELECT id,revision FROM cp_doors ORDER BY id")).rows),revisions);
  } finally {await control.close();await reader.close();}
});

test("a mismatched saved sha256 aborts before any door loses its inline page", async () => {
  const {control,reader,cp,copies}=await setup(true);
  try {
    await copies.query(LINKING_COPY_SCHEMA);
    const ref=await saveLinkingCopy(page,at,copies.query);
    await reader.query("UPDATE source_copy SET content='corrupt',sha256=$2 WHERE id=$1",[ref.sourceCopyId,createHash("sha256").update("corrupt").digest("hex")]);
    const before=JSON.stringify((await control.query("SELECT * FROM cp_doors ORDER BY id")).rows);
    await assert.rejects(migrateLinkingPages(cp,copies),/sha256/);
    assert.equal(JSON.stringify((await control.query("SELECT * FROM cp_doors ORDER BY id")).rows),before);
    await assert.rejects(openLinkingCopy({url:root.url,sourceCopyId:123},copies.query),/unavailable/);
  } finally {await control.close();await reader.close();}
});

test("cp_doors is locked only after the walk and saves, and a door written meanwhile is read again under the lock", async () => {
  // Oct 25: 1,517 voting doors carried 393 MB of pages; walking them under the lock would hold every runner door write for minutes.
  const {control,reader,cp,copies}=await setup();
  try {
    const statements: string[] = [];
    let wrote = false;
    const watched = { query: async (sql: string, params: readonly unknown[] = []) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql === "BEGIN" && !wrote) {
        wrote = true;
        const moved = { ...source("two-renamed"), url: "https://vendor.example.com/polls" };
        await control.query("UPDATE cp_doors SET value=jsonb_set(value,'{config,votingSource}',to_jsonb($1::text)) WHERE id='two'", [JSON.stringify(moved)]);
      }
      return cp.query(sql, params);
    } };
    await migrateLinkingPages(watched, copies);
    const lock = statements.findIndex(s => s.startsWith("LOCK TABLE cp_doors"));
    const lastWalk = statements.map((s, i) => [s, i] as const).filter(([s]) => s.startsWith("SELECT id,value#>>'{config,votingSource}'")).at(-1)![1];
    assert.ok(lock > lastWalk, `the lock follows the walk: ${statements.join(" | ")}`);
    assert.ok(statements.slice(0, lock).includes("SET LOCAL lock_timeout"));
    const two = (await control.query<{value:{config:{votingSource:string}}}>("SELECT value FROM cp_doors WHERE id='two'")).rows[0].value;
    const primary = JSON.parse(two.config.votingSource);
    assert.equal(primary.id, "two-renamed", "the door written after the walk keeps its newer value");
    assert.equal(JSON.stringify(two).includes("officialLinkingPage"), false);
    assert.ok(primary.linkingPage.sourceCopyId);
  } finally {await control.close();await reader.close();}
});

test("a door written back with its retired page keeps its newer reference, moves the rest, and publishes the same voting sites", async () => {
  // Oct 25: runs that read doors before DB-03A wrote 283 pages back (72 MB), 213 beside the reference discovery saved since.
  const {control,reader,cp,copies}=await setup(true);
  try {
    await copies.query(LINKING_COPY_SCHEMA);
    installLinkingCopyQuery(copies.query);
    const wheeling={...JSON.parse(readFileSync("data/reference/voting-source-doors.json","utf8")).find((door: {id: string}) => door.id === "vs07-cook-wheeling-early"),
      officialLinkingPage: page};
    const newer=await saveLinkingCopy({url:page.url,html:page.html+"<p>Updated</p>"},at,copies.query);
    await control.query("UPDATE cp_doors SET value=jsonb_set(value,'{config,votingSource}',to_jsonb($1::text)) WHERE id='one'",[JSON.stringify({...wheeling,linkingPage:newer})]);
    await control.query("UPDATE cp_doors SET value=jsonb_set(value,'{config,votingSource}',to_jsonb($1::text)) WHERE id='two'",[JSON.stringify({...wheeling,id:"wheeling-two"})]);
    const doors=async () => (await control.query<{id:string;revision:number;source:string}>("SELECT id,revision,value#>>'{config,votingSource}' AS source FROM cp_doors ORDER BY id")).rows;
    const before=await doors();
    assert.match(await moveRetiredDoorPages(cp,copies),/^1 voting doors kept their newer reference/);
    const after=await doors();
    assert.equal(JSON.stringify(after).includes("officialLinkingPage"),false);
    assert.deepEqual(JSON.parse(after[0].source).linkingPage,newer);
    assert.equal(JSON.parse(after[1].source).linkingPage.sourceCopyId,linkingCopyIdentity(page.url,page.html).id);
    await moveRetiredDoorPages(cp,copies);
    assert.deepEqual(await doors(),after,"a repeated move changes no door");
    const now="2026-10-24T12:00:00.000Z";
    const published=async (seed: unknown) => {
      const store=new MemoryRoutineDataStore(), root=await mkdtemp(join(tmpdir(),"doorcfg-"));
      try {
        await refreshVotingSources({ state:"IL", store, context:{repos:createMemoryRepositories()}, now:() => now, deadlineMs:Date.now()+60_000,
          fetch:(async (input: string | URL | Request) => String(input) === wheeling.url ? new Response(readFileSync(
            "tests/fixtures/voting-sources/vs-07-counties/wheeling-election.html"),{headers:{"content-type":"text/html"}}) : new Response(null,{status:404})) as typeof fetch,
          geocode:async () => null, registry:{divisions:[],bodies:[]}, vault:cycleVault(root), seeds:[seed as never] });
        const read=await readVotingSitesProjection("IL",{store,now});
        assert.equal(read.kind,"PROMOTED");
        return read.kind === "PROMOTED" ? read.value.jurisdictions : [];
      } finally { await rm(root,{recursive:true,force:true}); }
    };
    for (const at of [0,1]) {
      const sites=await published(JSON.parse(before[at].source));
      assert.equal(sites.flatMap(row => row.sites).length,1);
      assert.deepEqual(await published(JSON.parse(after[at].source)),sites);
    }
  } finally {installLinkingCopyQuery();await control.close();await reader.close();}
});
