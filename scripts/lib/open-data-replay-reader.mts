/** Normal API/SQL/Netlify SDK readers over held local evidence, without external vault requests. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { EvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import type { ReadOnlyQuery } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import type { OpenDataFact } from "../../lib/sources/open-data/model.ts";
import { openDataFactIssue } from "../../lib/sources/open-data/model.ts";
import { GET } from "../../app/api/open-data/route.ts";
import { neon, neonConfig } from "@neondatabase/serverless";
import { installPlaceMapQuery } from "../../lib/place-map/reader.ts";

let mapHost: string | undefined;
/** Replay holdings stay local; place selection reads the imported production map. */
export function installOpenDataReplayMap(connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY) {
  assert.ok(connection, "A production readonly connection is required for the place map.");
  const url = new URL(connection);
  assert.equal(decodeURIComponent(url.username), "readonly");
  const endpoint = neonConfig.fetchEndpoint;
  mapHost = new URL(typeof endpoint === "function" ? endpoint(url.hostname, url.port || 5432) : endpoint).hostname;
  const sql = neon(connection);
  installPlaceMapQuery(async (text, params = []) =>
    (await sql.transaction([sql.query(text, [...params])], {readOnly:true}))[0]);
}

export async function installOpenDataReaderSql(query:ReadOnlyQuery) {
  const [functions]=await query([{text:"SELECT to_regprocedure('reader_place_payload(jsonb,text[],jsonb)')::text AS held",params:[]}]);
  if(functions[0]?.held)return;
  const [tables]=await query([{text:"SELECT to_regclass('public.database_transfer_daily')::text AS held",params:[]}]);
  if(!tables[0]?.held)await query([{text:await readFile(new URL("../../lib/db/migrations/0030_database_transfer_daily.sql",import.meta.url),"utf8"),params:[]}]);
  for(const statement of (await readFile(new URL("../../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8")).split("--> statement-breakpoint"))if(statement.trim())await query([{text:statement,params:[]}]);
}

export function installOpenDataReplayVault(vault:EvidenceStore) {
  const originalFetch=globalThis.fetch,names=["WTP_VAULT_PROVIDER","WTP_BLOBS_SITE_ID","WTP_BLOBS_TOKEN"],environment=new Map(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{WTP_VAULT_PROVIDER:"netlify",WTP_BLOBS_SITE_ID:"readonly-replay",WTP_BLOBS_TOKEN:"local-replay-token"});
  const requested:string[]=[];
  globalThis.fetch=(async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(mapHost&&url.hostname===mapHost)return originalFetch(input,init);
    if(url.hostname==="api.netlify.com"){
      const at=url.pathname.indexOf("/project/");assert.ok(at>=0);
      return Response.json({url:`https://replay-artifacts.local/${url.pathname.slice(at+1)}`});
    }
    assert.equal(url.hostname,"replay-artifacts.local","A read-only replay cannot send vault traffic outside its local transport.");
    const key=decodeURIComponent(url.pathname.slice(1));requested.push(key);
    const object=await vault.get(key);if(!object)return new Response(null,{status:404});
    return new Response(object.bytes as BodyInit,{headers:{"netlify-blobs-metadata":`b64;${Buffer.from(JSON.stringify({meta:object.meta,bodySha256:object.meta.contentHash})).toString("base64")}`}});
  }) as typeof fetch;
  return {requested,restore(){globalThis.fetch=originalFetch;for(const [name,value]of environment){if(value===undefined)delete process.env[name];else process.env[name]=value;}}};
}

export async function normalOpenDataPage(zip:string,expectedId:string,onPage?:(result:{offset:number;elapsedMs:number})=>void) {
  const started=performance.now(),pageElapsedMs:number[]=[],seen=new Set<string>();let offset=0,pages=0,cursor:string|null=null;
  for(;;){
    const pageStarted=performance.now();
    const params=new URLSearchParams({zip});if(cursor)params.set("cursor",cursor);
    const response=await GET(new Request(`http://readonly-replay.local/api/open-data?${params}`));
    const value=await response.json() as {records:OpenDataFact[];unavailable:string[];checkedAt:Record<string,string>;nextCursor:string|null};
    assert.equal(response.status,200);assert.deepEqual(value.unavailable,[]);assert.ok(Array.isArray(value.records));assert.ok(value.records.every(row=>!openDataFactIssue(row)));pages++;
    const elapsedMs=performance.now()-pageStarted;pageElapsedMs.push(elapsedMs);onPage?.({offset,elapsedMs});
    const row=value.records.find(row=>row.id===expectedId);
    offset+=value.records.length;
    if(row)return {row,checkedAt:value.checkedAt,pages,recordsRead:offset,pageElapsedMs,elapsedMs:performance.now()-started};
    assert.ok(value.nextCursor&&!seen.has(value.nextCursor),`Expected native facility ${expectedId} did not reach its actual GET page.`);seen.add(value.nextCursor);cursor=value.nextCursor;
  }
}
