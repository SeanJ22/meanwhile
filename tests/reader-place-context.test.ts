import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {deflateRawSync} from "node:zlib";
import {PAGE_DICTIONARY} from "../lib/reader/page-dictionary.ts";
import {buildPlacePackage} from "../lib/reader/place-builder.ts";
import {readPlacePackage,type PlaceInput} from "../lib/reader/place.ts";
import {packPlaceContext,unpackPlaceContextRow} from "../lib/reader/place-ready.ts";
import type {Query} from "../lib/facts/publish.ts";
import {installReaderOn,migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {seedPlaceSlices} from "./helpers/place-pages.ts";

const AT="2026-10-24T12:00:00.000Z",ROOT="ocd-division/country:us/state:az",CITY=`${ROOT}/place:wire-fixture`,BODY=`${CITY}#governing`;

test("the slices keep exact current, history and empty answers, agenda papers only when asked for, and read in one statement",async t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw Error("The context fixture must stay local");});
  const {pg,publish}=await migratedReaderDb();
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const undo=await installReaderOn(pg);
  const person="person:wire-fixture",agendaText=Array.from({length:3000},(_,i)=>`Agenda ${i}: ${createHash("sha256").update(`agenda-${i}`).digest("hex")} — 予算\n`).join("");
  const metadata=Array.from({length:300},(_,i)=>`Holder ${i}: ${createHash("sha256").update(`holder-${i}`).digest("hex")} — é\n`).join("");
  try {
    await query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Wire fixture','AZ',$1),
      ($3,'body','Council','AZ',$2),($4,'person','Exact member','AZ',NULL),('meeting:fixture:fact-only','meeting','Held sitting','AZ',$3)`,[ROOT,CITY,BODY,person]);
    await query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$3),($2,$3)",[BODY,person,CITY]);
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
      value:{formatVersion:1,state:"AZ",governments:[{id:"g-city",name:"Wire fixture",jurisdictionId:"g-city",associations:[{divisionId:CITY}]}],divisions:[{ocdId:ROOT,label:"Arizona"},{ocdId:CITY,label:"Wire fixture"}]}});
    await seedPlaceSlices(query,{state:"AZ",divisionIds:[CITY]});
    const cases:PlaceInput[]=[];
    for(const divisionIds of [[CITY],[]]) for(const includeHistory of [false,true]) for(const flags of [{},{includeAgenda:true}])
      cases.push({state:"AZ",divisionIds,includeHistory,...flags});
    const labels=(input:PlaceInput)=>`${input.divisionIds.length?"place":"empty"}:${input.includeHistory?"history":"current"}:${input.includeAgenda?"agenda":"brief"}`;
    const readings:{mode:string;bytes:number}[]=[];
    for(const input of cases) {
      const label=labels(input),canonical=await buildPlacePackage({...input,includeAgenda:input.includeAgenda??false},query);
      let reads=0,bytes=0;
      const actual=await readPlacePackage(input,async(text,params)=>{
        reads++;
        const rows=await query(text,params);
        bytes=Buffer.byteLength(JSON.stringify(rows));
        return rows;
      });
      assert.equal(reads,input.divisionIds.length?1:0,"a place is one statement; no place and no board is nothing from the places");
      const ordered=(place:typeof actual)=>({...place,bodies:place.bodies.map(body=>({...body,sittings:[...body.sittings].sort((a,b)=>a.field.localeCompare(b.field))}))});
      assert.deepEqual(ordered(actual),ordered(canonical),`${label}: every visible field keeps its canonical value, a sitting's facts in the order they were filed`);
      if(input.divisionIds.length) {
        assert.equal(actual.bodies[0]!.roster!.members[0]!.name,"Exact member — é");
        assert.ok(actual.meetings.some(row=>row.id==="fixture:fact-only"));
        assert.equal(actual.snapshot.agendaDocuments.length,input.includeAgenda?(input.includeHistory?2:1):0);
        if(!input.includeAgenda)assert.ok(bytes<Buffer.byteLength(agendaText),`${label}: ${bytes} bytes cross the connection for a page whose agenda text alone is ${Buffer.byteLength(agendaText)}`);
      }else assert.equal(actual.snapshotHeldAt,AT,"the empty family's checked time stays visible");
      readings.push({mode:label,bytes});
    }
    t.diagnostic(JSON.stringify({sourceAgendaBytes:Buffer.byteLength(agendaText),readings}));
  }finally{await undo();await pg.close();}
});

test("saved pages are written in brotli, which the earlier release reads, and a page saved against the shared dictionary still reads back",()=>{
  const small={division_ids:[CITY],divisions:[{ocdId:CITY,label:"Wire fixture"}],entities:[],meeting_rows:[]};
  const large={...small,sittings:Array.from({length:400},(_,i)=>({entity_id:`meeting:${i}`,value:createHash("sha256").update(String(i)).digest("hex")})),meeting_rows:[]};
  const packed=packPlaceContext({formatVersion:1,current:small,history:large}) as Record<string,Record<string,{encoding:string}>>;
  assert.equal(packed.current!.brief!.encoding,"br-json-v1");
  assert.equal(packed.history!.brief!.encoding,"br-json-v1");
  assert.deepEqual(unpackPlaceContextRow(packed.current!.brief),{...small,agenda_texts:[],archived_documents:[],archived_document_links:[]});
  assert.deepEqual(unpackPlaceContextRow(packed.history!.full),large);
  assert.deepEqual(unpackPlaceContextRow({encoding:"dfl-dict-v1",data:deflateRawSync(JSON.stringify(small),{dictionary:PAGE_DICTIONARY}).toString("base64")}),small);
});

