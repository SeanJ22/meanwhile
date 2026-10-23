import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { normalizeEcho,openDataReports } from "../lib/sources/open-data/normalize.ts";
import { saveOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import { publishOpenData } from "../lib/sources/open-data/publication.ts";
import { ECHO_EXPORT,openDataFactIssue,type OpenDataFact,type OpenDataPartitionRef } from "../lib/sources/open-data/model.ts";
import { streamCsvObjects } from "../lib/sources/prl/streaming.ts";
import { facilityCell,facilityPoint } from "../lib/sources/open-data/geography.ts";
import { OPEN_DATA_READER_PAYLOAD } from "../lib/sources/open-data/reader-sql.ts";
import { installOpenDataReplayVault } from "../scripts/lib/open-data-replay-reader.mts";
import { GET } from "../app/api/open-data/route.ts";

const sample=(name:string)=>readFileSync(new URL(`./fixtures/src-so/${name}`,import.meta.url),"utf8");
const NOW="2026-10-23T09:06:56.174Z";
test("The actual open-data GET uses normal selected SQL and reads native ZIP/cell chunks and blank-FRS identities",async()=>{
  await withMigratedRoutineStore("epa-echo",async(store,vault,pg)=>{
    await pg.exec(readFileSync(new URL("../lib/db/migrations/0030_database_transfer_daily.sql",import.meta.url),"utf8"));
    await pg.exec(readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8"));
    const rows:OpenDataFact[]=[];
    for await(const raw of streamCsvObjects((async function*(){yield sample("echo-exporter-sample.csv");})()))rows.push(normalizeEcho(raw,NOW,null));
    rows.push(...(JSON.parse(sample("echo-program-identities.json")) as Record<string,unknown>[]).map(raw=>normalizeEcho(raw,NOW,null)));
    const references:OpenDataPartitionRef[]=[],capture={url:ECHO_EXPORT,retrievedAt:NOW,rawHash:createHash("sha256").update(sample("echo-exporter-sample.csv")+sample("echo-program-identities.json")).digest("hex"),sourceRows:rows.map(row=>row.sourceRow)};
    const grouped=new Map<string,OpenDataFact[]>();
    for(const row of rows){
      const partitions=[`zip:${row.zip}:state:${row.state}:part:0`],point=facilityPoint(row);if(point)partitions.push(`${facilityCell(point.lat,point.lng)}:state:${row.state}:part:0`);
      for(const partition of partitions)grouped.set(partition,[...grouped.get(partition)??[],row]);
    }
    for(const [partition,records]of grouped)references.push(await saveOpenDataPartition({source:"epa-echo",partition,rows:records,captures:[capture],now:NOW},vault));
    await publishOpenData({store,source:"epa-echo",rows:[],reports:openDataReports(rows),partitions:references,captures:[capture],now:NOW});
    const selected:Record<string,unknown>[]=[];
    installReaderDatabaseQuery(async statements=>{
      const results=[];for(const statement of statements){const value=(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;selected.push(...value);results.push(value);}return results;
    });
    const transport=installOpenDataReplayVault(vault);
    try {
      for(const row of [rows[0],rows.at(-2)!]){
        clearPromotedReadModelCache();selected.length=0;
        const response=await GET(new Request(`http://readonly-replay.local/api/open-data?zip=${row.zip}`));
        const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.deepEqual(value.unavailable,[],JSON.stringify({requested:transport.requested,selectedRefCounts:selected.map(row=>((row.payload as {partitions?:unknown[]})?.partitions??[]).length)}));
        const native=value.records.find((record:OpenDataFact)=>record.id===row.id);assert.ok(native);assert.equal(openDataFactIssue(native),null);
        if(row.id.includes(":program:")){assert.equal(native.sourceRow.REGISTRY_ID,"");assert.equal(native.nativeIds.registry_id,undefined);}
        assert.ok(selected.some(value=>((value.payload as {partitions?:OpenDataPartitionRef[]})?.partitions??[]).some(reference=>reference.id.startsWith(`zip:${row.zip}:state:`))));
        assert.ok(selected.every(value=>!((value.payload as {partitions?:OpenDataPartitionRef[]})?.partitions??[]).some(reference=>reference.id.includes(":state:NY:"))));
      }
      const division="ocd-division/country:us/state:ny",payload={kind:"open-data",sourceId:"socrata-discovery",records:[],reports:[],partitions:[{id:`division:${division}`,key:"saved-source-ref",sha256:"a".repeat(64),count:2},{id:"division:ocd-division/country:us/state:tx",key:"other",sha256:"b".repeat(64),count:2}]};
      const query=`WITH p AS (SELECT 'CURATED_READER_RECORD'::text record_class,'socrata-discovery'::text source_id,'socrata-discovery:national'::text scope,$1::jsonb payload) SELECT ${OPEN_DATA_READER_PAYLOAD} payload FROM p WHERE $2::text IS NOT NULL`;
      const sliced=await pg.query<{payload:typeof payload}>(query,[payload,"socrata-discovery:national",[`open-data-partition:division:${division}`]]);
      assert.deepEqual(sliced.rows[0].payload.partitions,[payload.partitions[0]]);
      const wrongSource=await pg.query<{payload:unknown}>(query.replace("'socrata-discovery'::text source_id","'unrelated-source'::text source_id"),[payload,"socrata-discovery:national",[`open-data-partition:division:${division}`]]);
      assert.equal(wrongSource.rows[0].payload,null);
      const zipRefs=["zip:85331:state:AZ:part:0","zip:85331:state:AZ:part:1","zip:853310:state:AZ:part:0"].map((id,index)=>({id,key:`source-${index}`,sha256:String(index).repeat(64),count:1}));
      const arrayPart={kind:"array",groups:[zipRefs],order:JSON.stringify([0,0,0])},arrayHash=createHash("sha256").update(JSON.stringify(arrayPart)).digest("hex");
      const objectPart={kind:"object",value:{kind:"open-data",sourceId:"epa-echo",records:[],reports:[],partitions:{$civicPayloadPart:arrayHash}}},objectHash=createHash("sha256").update(JSON.stringify(objectPart)).digest("hex");
      await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2),($3,$4)",[arrayHash,arrayPart,objectHash,objectPart]);
      const encoded=await pg.query<{payload:{partitions:typeof zipRefs}}>(query.replaceAll("socrata-discovery","epa-echo"),[{$civicPayloadPart:objectHash},"epa-echo:national",["open-data-partition:zip:85331"]]);
      assert.deepEqual(encoded.rows[0].payload.partitions,zipRefs.slice(0,2));
      const epaQuery=query.replaceAll("socrata-discovery","epa-echo"),plain={kind:"open-data",sourceId:"epa-echo",records:[],reports:[],partitions:zipRefs};
      const native=await pg.query<{payload:{partitions:typeof zipRefs}}>(epaQuery,[plain,"epa-echo:national",["open-data-partition:zip:85331"]]);assert.deepEqual(native.rows[0].payload.partitions,zipRefs.slice(0,2));
      const quoted=await pg.query<{payload:{partitions:typeof zipRefs}}>(epaQuery,[plain,"epa-echo:national",['open-data-partition:zip:85331" || true || @.id == "']]);assert.deepEqual(quoted.rows[0].payload.partitions,[]);
      const encodedPayload=async(groups:unknown[],order:unknown)=>{
        const array={kind:"array",groups,order},arraySha=createHash("sha256").update(JSON.stringify(array)).digest("hex"),object={kind:"object",value:{...plain,partitions:{$civicPayloadPart:arraySha}}},objectSha=createHash("sha256").update(JSON.stringify(object)).digest("hex");
        await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2),($3,$4) ON CONFLICT DO NOTHING",[arraySha,array,objectSha,object]);return {$civicPayloadPart:objectSha};
      };
      const interleaved=await encodedPayload([[zipRefs[0],zipRefs[2]],[zipRefs[1]]],JSON.stringify([0,1,0]));
      const inOrder=await pg.query<{payload:{partitions:typeof zipRefs}}>(epaQuery,[interleaved,"epa-echo:national",["open-data-partition:zip:85331"]]);assert.deepEqual(inOrder.rows[0].payload.partitions,zipRefs.slice(0,2));
      const badOrder=await encodedPayload([[zipRefs[0]]],JSON.stringify([99]));
      const refused=await pg.query<{payload:unknown}>(epaQuery,[badOrder,"epa-echo:national",["open-data-partition:zip:85331"]]);assert.equal(refused.rows[0].payload,null);
      const missingGroup=await encodedPayload([{$civicPayloadPart:"f".repeat(64)}],JSON.stringify([0]));
      await assert.rejects(pg.query(epaQuery,[missingGroup,"epa-echo:national",["open-data-partition:zip:85331"]]),/CIVIC_PAYLOAD_PART_MISSING/);
      const missingOrder=await encodedPayload([[zipRefs[0]]],{$civicPayloadPart:"e".repeat(64)});
      await assert.rejects(pg.query(epaQuery,[missingOrder,"epa-echo:national",["open-data-partition:zip:85331"]]),/CIVIC_PAYLOAD_PART_MISSING/);
      const guarded=await pg.query<{payload:unknown}>(epaQuery.replace("'epa-echo'::text source_id","'unrelated-source'::text source_id"),[missingGroup,"epa-echo:national",["open-data-partition:zip:85331"]]);assert.equal(guarded.rows[0].payload,null);
      const bulk=Array.from({length:80},(_,index)=>normalizeEcho({...rows[0].sourceRow,REGISTRY_ID:String(110900000000+index),FAC_NAME:`Cursor API fixture ${index}`,FAC_STATE:"AK",FAC_ZIP:"99501",FAC_LAT:"",FAC_LONG:""},NOW,null));
      const promote=async(records:OpenDataFact[],now:string)=>{
        const captures=[{...capture,sourceRows:[...rows,...records].map(row=>row.sourceRow)}],partitions=[...references];
        for(let offset=0;offset<records.length;offset+=40)partitions.push(await saveOpenDataPartition({source:"epa-echo",partition:`zip:99501:state:AK:part:${offset/40}`,rows:records.slice(offset,offset+40),captures,now},vault));
        await publishOpenData({store,source:"epa-echo",rows:[],reports:openDataReports([...rows,...records]),partitions,captures,replace:true,now});clearPromotedReadModelCache();
      };
      await promote(bulk,NOW);
      const first=await GET(new Request("http://readonly-replay.local/api/open-data?zip=99501")),firstPage=await first.json();
      assert.equal(first.status,200);assert.equal(firstPage.records.length,50);assert.equal(typeof firstPage.nextCursor,"string");assert.equal(firstPage.total,undefined);
      const more=await GET(new Request(`http://readonly-replay.local/api/open-data?zip=99501&cursor=${firstPage.nextCursor}`)),morePage=await more.json();
      assert.equal(more.status,200);assert.equal(morePage.records.length,30);assert.equal(morePage.nextCursor,null);assert.equal(new Set([...firstPage.records,...morePage.records].map(row=>row.id)).size,80);
      const wrongPlace=await GET(new Request(`http://readonly-replay.local/api/open-data?zip=85332&cursor=${firstPage.nextCursor}`));assert.equal(wrongPlace.status,400);
      const changed=bulk.map((row,index)=>index===0?normalizeEcho({...row.sourceRow,FAC_INSPECTION_COUNT:"37"},NOW,null):row);
      await promote(changed,"2026-10-23T09:07:56.174Z");
      const reset=await GET(new Request(`http://readonly-replay.local/api/open-data?zip=99501&cursor=${firstPage.nextCursor}`));assert.equal(reset.status,409);assert.equal((await reset.json()).reset,true);
      const restarted=await GET(new Request("http://readonly-replay.local/api/open-data?zip=99501"));assert.equal((await restarted.json()).records[0].fields.inspectionCount,"37");
    }finally{
      transport.restore();installReaderDatabaseQuery(undefined);clearPromotedReadModelCache();
    }
  });
});
