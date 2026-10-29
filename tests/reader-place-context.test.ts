import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {buildPlacePackage,rebuildPlacePages} from "../lib/reader/place-builder.ts";
import {PLACE_PAGES_SQL,readPlacePackage,type PlaceInput} from "../lib/reader/place.ts";
import {preparePlaceRosters} from "../lib/reader/body-roster.ts";
import {unpackPlaceContextRow} from "../lib/reader/place-ready.ts";
import type {FactDb,Query} from "../lib/facts/publish.ts";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";

const AT="2026-10-24T12:00:00.000Z",ROOT="ocd-division/country:us/state:az",CITY=`${ROOT}/place:wire-fixture`,BODY=`${CITY}#governing`;

test("the real worker transfers only the requested compressed context and keeps exact current, history and empty answers",async t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw Error("The context fixture must stay local");});
  const {pg,publish}=await migratedReaderDb();
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const db:FactDb={transaction:work=>pg.transaction(tx=>work(async(text,params=[])=>(await tx.query<Record<string,unknown>>(text,[...params])).rows))};
  const person="person:wire-fixture",agendaText=Array.from({length:3000},(_,i)=>`Agenda ${i}: ${createHash("sha256").update(`agenda-${i}`).digest("hex")} — 予算\n`).join("");
  const metadata=Array.from({length:300},(_,i)=>`Holder ${i}: ${createHash("sha256").update(`holder-${i}`).digest("hex")} — é\n`).join("");
  try {
    await query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Wire fixture','AZ',$1),
      ($3,'body','Council','AZ',$2),($4,'person','Exact member','AZ',NULL),('meeting:fixture:fact-only','meeting','Held sitting','AZ',$3)`,[ROOT,CITY,BODY,person]);
    await query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)",[BODY,CITY]);
    await query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/calendar','https://example.gov/calendar',$1,$2,'wire-fixture')",[AT,"a".repeat(64)]);
    for(const [entity,field,value] of [[BODY,"office_phone","520-555-0100"],[BODY,`member:${person}`,{name:"Exact member — é",office:"Council Member"}],
      [person,"name","Exact member — é"],["meeting:fixture:fact-only","title","An independently published sitting"],
      ["meeting:fixture:fact-only","starts_at",{startsAt:AT,timeZone:"UTC"}]] as const) {
      await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
        VALUES($1,$2,$3::jsonb,'Saved value','live','OFFICIAL',1,'Verified source',$4,'fixture')`,[entity,field,JSON.stringify(value),AT]);
    }
    for(const [id,history,startsAt] of [["current",false,AT],["history",true,"2020-01-01T12:00:00Z"]] as const) {
      const meeting={id:`fixture:${id}`,bodyId:BODY,ocdId:CITY,bodyName:"Council",title:`Public meeting ${id} — 予算`,startsAt,timeZone:"UTC",location:null,
        agendaUrl:`https://example.gov/${id}`,jurisdiction:"Local",status:"SCHEDULED",futureSourceFields:{blank:"",absent:null,enabled:false},
        provenance:{sourceUrl:"https://example.gov/calendar",sourceOrg:"Council",collectedAt:AT,verifiedAt:AT}};
      await publish({id,recordClass:"MEETING",scope:`source:fixture:body:${encodeURIComponent(BODY)}${history?":history":""}`,sourceId:"fixture",at:AT,
        value:{formatVersion:1,generatedAt:AT,meetings:[meeting],sources:[],counts:{fresh:1,carried:0,total:1},
          agendaDocuments:[{id:`document:${id}`,meetingId:meeting.id,documentUrl:meeting.agendaUrl,text:`${agendaText}${id}`}]} });
    }
    await publish({id:"family",recordClass:"MEETING",scope:"source:derived:family:US-AZ",sourceId:"fixture",at:AT,
      value:{formatVersion:1,generatedAt:AT,meetings:[],agendaDocuments:[],sources:[],counts:{fresh:0,carried:0,total:0}}});
    await publish({id:"runtime",recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-AZ:reader-registry-runtime",sourceId:"fixture",at:AT,
      value:{formatVersion:1,registry:{generatedAt:AT,bodies:[{id:BODY,ocdId:CITY,name:"Council"}],divisions:[{ocdId:CITY,parentOcdId:ROOT},{ocdId:ROOT,parentOcdId:null}]},
        bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{rows:[{holder:{id:person,officeTitle:"Member",divisions:[CITY],futureMetadata:metadata}}]},
        officialPhotos:{photos:[]},rosterPhotos:{}}});
    await publish({id:"registration",recordClass:"REGISTRATION",scope:"US-AZ:registration:v1",sourceId:"fixture",at:AT,
      value:{formatVersion:1,state:"AZ",governments:[],divisions:[{ocdId:ROOT,label:"Arizona"},{ocdId:CITY,label:"Wire fixture"}]}});
    await query("INSERT INTO rebuild_queue(place_id) VALUES($1),($2)",[ROOT,CITY]);
    assert.deepEqual(await rebuildPlacePages({db,limit:2,concurrency:1,purge:async()=>({purged:true})}),{rebuilt:2,failed:0,remaining:0});
    const stored=await query("SELECT place_id,context FROM place_page ORDER BY place_id");
    const contexts=new Map(stored.map(row=>[String(row.place_id),row.context as Record<string,Record<string,unknown>>]));
    for(const [id,context] of contexts) for(const key of ["current","history",...(id===ROOT?["emptyCurrent","emptyHistory"]:[])]) {
      assert.deepEqual(Object.keys(context[key]!),["full","brief","facts"]);
    }
    const cases:PlaceInput[]=[];
    for(const divisionIds of [[CITY],[]]) for(const includeHistory of [false,true]) for(const flags of [{},{bodyFactsOnly:true},{includeAgenda:true},{bodyFactsOnly:true,includeAgenda:true}])
      cases.push({state:"AZ",divisionIds,includeHistory,...flags});
    const expected=new Map<string,Awaited<ReturnType<typeof buildPlacePackage>>>();
    const bytes=new Map<string,number>();
    const labels=(input:PlaceInput)=>`${input.divisionIds.length?"place":"empty"}:${input.includeHistory?"history":"current"}:${input.includeAgenda?"agenda":input.bodyFactsOnly?"facts":"brief"}${input.bodyFactsOnly&&input.includeAgenda?"+facts":""}`;
    const readings:{mode:string;compressedBytes:number;legacyBytes?:number}[]=[];
    for(const input of cases) {
      const label=labels(input),canonical=await buildPlacePackage({...input,includeAgenda:input.includeAgenda??false},query);
      expected.set(label,canonical);
      let reads=0;
      const actual=await readPlacePackage(input,async(text,params)=>{
        reads++;assert.equal(text,PLACE_PAGES_SQL,"every selection reads only saved context in one query");
        const rows=await query(text,params);
        bytes.set(label,Buffer.byteLength(JSON.stringify(rows)));
        for(const {row} of rows) {
          assert.equal((row as {encoding:string}).encoding,"br-json-v1");
          const decoded=unpackPlaceContextRow(row);
          if(!input.includeAgenda) {
            assert.deepEqual(decoded.archived_documents,[]);
            assert.deepEqual(decoded.agenda_texts,[]);
            for(const partition of decoded.meeting_rows as {payload:{agendaDocuments:unknown[]}}[])assert.deepEqual(partition.payload.agendaDocuments,[]);
            if(input.bodyFactsOnly) {
              assert.equal(decoded.registry,null);assert.equal(decoded.everyday_routing,null);
              assert.equal(decoded.registration_held,false);assert.deepEqual(decoded.governments,[]);assert.deepEqual(decoded.divisions,[]);
            }
          }
        }
        return rows;
      });
      assert.equal(reads,1);
      const visible=(value:object)=>Object.fromEntries(Object.entries(value).filter(([key])=>!['rosterRefs','rosterPreviews','rosterIds'].includes(key)));
      assert.deepEqual(visible(actual),visible(input.bodyFactsOnly||input.includeAgenda?canonical:preparePlaceRosters(canonical).place),`${label}: every visible field keeps its canonical value`);
      if(input.divisionIds.length) {
        if(input.bodyFactsOnly||input.includeAgenda)assert.equal(actual.bodies[0]!.roster!.members[0]!.name,"Exact member — é");
        else assert.ok(actual.rosterIds?.[BODY]?.length===1,"the unopened page carries the exact identity without the full member card");
        assert.ok(actual.meetings.some(row=>row.id==="fixture:fact-only"));
        assert.equal(actual.snapshot.agendaDocuments.length,input.includeAgenda?(input.includeHistory?2:1):0);
      }else assert.equal(actual.snapshotHeldAt,AT,"the empty family's checked time stays visible");
      readings.push({mode:label,compressedBytes:bytes.get(label)!});
    }
    for(const [id,context] of contexts) {
      const raw:Record<string,unknown>={formatVersion:1};
      for(const key of ["current","history","emptyCurrent","emptyHistory"])if(context[key])raw[key]=unpackPlaceContextRow(context[key]!.full);
      await query("UPDATE place_page SET context=$2::jsonb WHERE place_id=$1",[id,JSON.stringify(raw)]);
    }
    for(const input of cases) {
      const label=labels(input);let reads=0,legacyBytes=0;
      const legacy=await readPlacePackage(input,async(text,params)=>{
        reads++;assert.equal(text,PLACE_PAGES_SQL,"legacy raw contexts never query source tables");
        const rows=await query(text,params);legacyBytes=Buffer.byteLength(JSON.stringify(rows));return rows;
      });
      assert.equal(reads,1);assert.deepEqual(legacy,expected.get(label),`${label}: legacy raw fallback preserves every field`);
      readings.find(row=>row.mode===label)!.legacyBytes=legacyBytes;
      if(input.divisionIds.length)assert.ok(bytes.get(label)!<legacyBytes/(input.includeAgenda?1:10),`${label}: ${bytes.get(label)} compressed bytes versus ${legacyBytes} legacy bytes`);
    }
    t.diagnostic(JSON.stringify({sourceAgendaBytes:Buffer.byteLength(agendaText),readings}));
  }finally{await pg.close();}
});
