import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {neonConfig} from "@neondatabase/serverless";
import {withMigratedRoutineStore} from "./helpers/migrated-routine-store.ts";
import {MemoryRoutineDataStore} from "../lib/civic-data/store.ts";
import {publishBulkCandidate} from "../lib/sources/legiscan/publication.ts";
import {readBillsForState,readBillStateCatalog,readBulkProjection} from "../lib/sources/legiscan/reader.ts";
import {LEGISCAN_BULK_SCOPE,legiscanStateId,type Dataset,type HeldPerson} from "../lib/sources/legiscan/bills.ts";
import {promotedEdgeEntryOf} from "../lib/civic-data/read-model.ts";
import {withReaderAuthorityEdge} from "../lib/registry/runtime-edge.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";

const at="2026-10-26T12:00:00.000Z",hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const native=readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8"),raw=JSON.parse(native).bill;
const marker="UNRELATED_STATE_CATALOG_",person:HeldPerson={id:"held:ak:gatto",nativeIds:{legiscan:["6033"]}};
const datasets:Dataset[]=[
  {state_id:2,session_id:101,session_name:"Old regular session",dataset_hash:hash("old"),dataset_date:"2024-12-30",year_start:2023,year_end:2024,special:0,prefile:0},
  {state_id:2,session_id:122,session_name:"Current special session",dataset_hash:hash("special"),dataset_date:"2026-10-20",year_start:2025,year_end:2026,special:1,prefile:0},
  {state_id:2,session_id:130,session_name:"Future prefile session",dataset_hash:hash("prefile"),dataset_date:"2026-10-20",year_start:2027,year_end:2028,special:0,prefile:1},
];
const unrelated:Dataset[]=Array.from({length:768},(_,index)=>({state_id:3,session_id:10000+index,
  session_name:marker.repeat(12)+index,dataset_hash:hash(String(index)),dataset_date:"2026-10-20",
  year_start:2025,year_end:2026,special:0,prefile:0}));
const capture=(body:string,op:string)=>({body,requestedUrl:`https://api.legiscan.com/?op=${op}`,finalUrl:`https://api.legiscan.com/?op=${op}`,
  httpStatus:200,retrievedAt:at,rawHash:hash(body)});

test("a source-pinned state catalog reads only its state and preserves full state/person answers",async context=>{
  await withMigratedRoutineStore("legiscan-bulk",async store=>{
    const memory=new MemoryRoutineDataStore(),catalog=[...datasets,...unrelated],indexBody=JSON.stringify({status:"OK",datasetlist:catalog});
    for(const target of [memory,store]){
      const index=await publishBulkCandidate(target,{capture:capture(indexBody,"getDatasetList"),datasets:catalog},at);
      assert.ok(index.outcome.promoted);
      for(const [offset,dataset] of datasets.entries()){
        const source=JSON.parse(native);Object.assign(source.bill,{bill_id:raw.bill_id+offset,session_id:dataset.session_id});
        const bodies=[JSON.stringify(source)],archiveHash=hash(bodies[0]),body=JSON.stringify({dataset,archiveHash,memberHashes:bodies.map(hash)});
        assert.ok((await publishBulkCandidate(target,{capture:capture(body,"getDataset"),dataset,bodies,people:[person],archiveHash},at)).outcome.promoted);
      }
    }
    const fullState=await readBillsForState("AK",{store:memory,now:at}),fullPerson=await readBillsForState("AK",{store:memory,now:at,person});
    assert.equal(fullState.bills.length,1);assert.equal(fullState.complete,true);
    assert.deepEqual(fullState.bills.map(bill=>bill.sessionId),[datasets[1].session_id],"public answers retain main130's current-session selection");
    const originalPromotion=store.readPromotion.bind(store),originalCandidate=store.readCandidate.bind(store);
    store.readPromotion=async<T,>(recordClass:import("../lib/civic-data/types.ts").RoutineRecordClass,scope:string)=>{
      assert.notEqual(scope,LEGISCAN_BULK_SCOPE,"state readers never fetch the national INDEX payload");return originalPromotion<T>(recordClass,scope);
    };
    store.readCandidate=async id=>{assert.notEqual(id,(await memory.readPromotion("STATE_BILL",LEGISCAN_BULK_SCOPE))?.versionId,
      "state readers never fetch the national source candidate");return originalCandidate(id);};
    const transport=neonConfig.fetchFunction;assert.ok(transport);const wire:string[]=[];
    neonConfig.fetchFunction=(async(...args:Parameters<typeof transport>)=>{
      const response=await transport(...args);wire.push(await response.clone().text());return response;
    }) as typeof transport;
    try{
      const ordered=(read:typeof fullState)=>({...read,bills:[...read.bills].sort((left,right)=>left.id.localeCompare(right.id))});
      assert.deepEqual(ordered(await readBillsForState("AK",{store,now:at})),ordered(fullState));
      assert.deepEqual(ordered(await readBillsForState("AK",{store,now:at,person})),ordered(fullPerson));
      const selected=await readBillStateCatalog("AK",{store,now:at});
      assert.deepEqual(selected.datasets,datasets,"older, special and future prefile rows all remain selected");
      assert.equal(selected.checkedAt,at);assert.equal(selected.capturedAt,at,"current-session selection uses the original source catalog clock");
      assert.deepEqual(await readBillStateCatalog("AK",{store,now:at},true),{recorded:true,datasets:[],checkedAt:at,capturedAt:at});
      assert.deepEqual(await readBillsForState("WA",{store,now:at}),{bills:[],complete:false,checkedAt:at});
      assert.deepEqual(await readBillStateCatalog("ZZ",{store,now:at}),{recorded:true,datasets:[],checkedAt:at,capturedAt:at});
    }finally{neonConfig.fetchFunction=transport;}
    assert.equal(wire.some(response=>response.includes(marker)),false,"no unrelated state catalog row crosses the connection");
    const source=await readBulkProjection(LEGISCAN_BULK_SCOPE,{store:memory,now:at});assert.equal(source.kind,"PROMOTED");
    if(source.kind!=="PROMOTED")throw Error("Missing owned source fixture");
    const entry=promotedEdgeEntryOf(source,"STATE_BILL",LEGISCAN_BULK_SCOPE,memory);assert.ok(entry);
    const edge=await withReaderAuthorityEdge({edgeOnly:true},()=>readBillStateCatalog("AK",{edge:entry,now:at}));
    assert.deepEqual(edge.datasets,datasets,"already owned full canonical/edge values keep the same state selection");
    let forbidden=0;installReaderDatabaseQuery(async()=>{forbidden++;return [[]];});
    try{await assert.rejects(withReaderAuthorityEdge({edgeOnly:true},()=>readBillStateCatalog("AK")),/never reads the database/);assert.equal(forbidden,0);}
    finally{installReaderDatabaseQuery(undefined);}
    assert.equal(legiscanStateId("TX"),43);assert.equal(legiscanStateId("DC"),51);assert.equal(legiscanStateId("US"),52);
    context.diagnostic(JSON.stringify({fixtureNationalCatalogBytes:Buffer.byteLength(JSON.stringify(source.value)),
      fixtureStateCatalogBytes:Buffer.byteLength(JSON.stringify({...source.value,datasets})),
      allMeasuredReaderWireBytes:wire.reduce((total,response)=>total+Buffer.byteLength(response),0),requests:wire.length,
      note:"Synthetic source fixture and local transport measurements; not live production transfer."}));
  });
});
