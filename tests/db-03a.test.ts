import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrateLinkingPages } from "../lib/control-plane/repository/migrations/DB-03A.ts";
import { LINKING_COPY_SCHEMA, linkingCopyIdentity, openLinkingCopy, saveLinkingCopy } from "../lib/facts/linking-copy.ts";
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
