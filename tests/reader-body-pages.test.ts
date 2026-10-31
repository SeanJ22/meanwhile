import assert from "node:assert/strict";
import { placePagesAnswer } from "./helpers/place-pages-answer.ts";
import test from "node:test";
import { readMeetingBodies, readReaderEdgeMeetings, type ReaderMeetingsContext } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { snapshotCounts } from "../lib/meetings/snapshot.ts";
import { PLACE_PAGES_SQL, readPlacePackage } from "../lib/reader/place.ts";
import { rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { unpackPlaceContextRow } from "../lib/reader/place-ready.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { seedPlacePages } from "./helpers/place-pages.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { Division } from "../lib/registry/types.ts";

const AT = "2026-10-24T12:00:00.000Z", AZ = "ocd-division/country:us/state:az", CA = "ocd-division/country:us/state:ca";
const FIRST = `${AZ}/place:example#council`, SECOND = `${AZ}/place:example#planning`, FOREIGN = `${CA}/place:example#council`;

function meeting(bodyId: string, suffix: string, startsAt: string): Meeting {
  return { id: `fixture:${suffix}`, bodyId, ocdId: bodyId.split("#")[0]!, bodyName: "Public board", title: "Public meeting", startsAt,
    timeZone: "UTC", location: null, agendaUrl: null, jurisdiction: "Local", status: "SCHEDULED",
    provenance: { sourceUrl: "https://example.gov/meetings", sourceOrg: "Public board", collectedAt: AT, verifiedAt: AT } };
}

function bodyRow(bodyId: string, meetings: Meeting[]) {
  const state = bodyId.includes("state:az") ? "AZ" : "CA";
  return { page_id: bodyId, page_kind: "body", built_at: AT, body_ids: [bodyId], row: {
    division_ids: [], entities: [{ id: bodyId, kind: "body", state, division: bodyId.split("#")[0] }],
    fields: [], rosters: [], comments: [], sittings: [], governments: [], divisions: [], registration_held: false, parts: {},
    meeting_rows: [{ scope: `source:fixture:body:${encodeURIComponent(bodyId)}`, current_version_id: bodyId, confirmation: null,
      payload: { formatVersion: 1, generatedAt: AT, meetings, sources: [], agendaDocuments: [], counts: snapshotCounts(meetings, 0) } }],
  } };
}

test("state jobs list IDs once per state and defer each bounded page read until its body is loaded", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const soon = meeting(FIRST, "soon", "2026-10-27T12:00:00Z");
  const query: Query = async (text, params = []) => {
    calls.push({ text, params });
    if (text.startsWith("SELECT id FROM entity")) {
      assert.deepEqual(params, [calls.filter(call => call.text.startsWith("SELECT id FROM entity")).length === 1 ? ["AZ"] : ["CA"]]);
      return (params[0] as string[]).includes("AZ") ? [{ id: FIRST }, { id: SECOND }] : [{ id: FOREIGN }];
    }
    assert.equal(text, PLACE_PAGES_SQL);
    assert.equal(params[5], false, "a worker never opens a complete state aggregate");
    const bodies = params[2] as string[];
    assert.equal(bodies.length, 1, "one body calendar crosses the connection");
    return placePagesAnswer([bodyRow(bodies[0]!, bodies[0] === FIRST ? [meeting(FIRST, "old", "2020-01-01T12:00:00Z"), soon,
      meeting(FIRST, "future", "2028-01-01T12:00:00Z")] : [])]);
  };
  const iterator = readMeetingBodies({ states: ["az", "CA"], now: AT, settings: meetingSettingsFromValues(), query });
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value!.bodyId, FIRST);
  assert.equal(calls.length, 1, "listing does not load either body's page");
  const loaded = await first.value!.load();
  assert.deepEqual(loaded?.snapshot.meetings.map(row => row.id), [soon.id], "the configured shown window is still applied");
  assert.equal(calls.length, 2);
  const second = await iterator.next();
  assert.equal(second.value!.bodyId, SECOND);
  assert.equal(calls.length, 2, "moving to the next body loads no calendar");
  assert.deepEqual((await second.value!.load())?.snapshot.meetings, []);
  assert.equal(calls.length, 3);
  const foreign = await iterator.next();
  assert.equal(foreign.value!.state, "CA");
  assert.equal(foreign.value!.bodyId, FOREIGN);
  assert.equal(calls.length, 4, "the next state's ID list is read after this state's IDs are consumed");
  await iterator.return(undefined);
});

test("an explicit state resolves a short body alias for current and held agendas without opening a phantom national page", async () => {
  const {pg,publish} = await migratedReaderDb();
  const query:Query = async(text,params=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const root="ocd-division/country:us/state:or", division=`${root}/county:multnomah`, body="or:special:metro#governing", alias="old-metro-id";
  const country="ocd-division/country:us", national=`${country}#national-board`;
  const current=meeting(body,"oregon-current",AT), past=meeting(body,"oregon-past","2020-01-01T12:00:00Z");
  const arizona=meeting(FIRST,"arizona-current",AT), federal=meeting(national,"national-current",AT);
  try {
    await query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Oregon','OR',NULL),($2,'place','Multnomah','OR',$1),($3,'body','Metro','OR',$2),
      ($4,'body','Arizona Council','AZ',NULL),($5,'place','United States',NULL,NULL),($6,'body','National Board','US',$5)`,
    [root,division,body,FIRST,country,national]);
    await query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)",[body,division]);
    await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2),($3,'body-alias','national-board-alias')",[body,alias,national]);
    for(const [state,bodyId,ocdId] of [["OR",body,division],["AZ",FIRST,FIRST.split("#")[0]!]]) {
      await publish({id:`runtime-${state}`,recordClass:"REGISTRY_RUNTIME_BINDING",scope:`US-${state}:reader-registry-runtime`,sourceId:"fixture",at:AT,
        value:{formatVersion:1,registry:{generatedAt:AT,bodies:[{id:bodyId,ocdId,name:"Public Board"}],divisions:[]},
          bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}}});
    }
    for(const [id,row,history] of [["current",current,false],["past",past,true],["arizona",arizona,false],["national",federal,false]] as const) {
      await publish({id,recordClass:"MEETING",scope:`source:fixture:body:${encodeURIComponent(row.bodyId!)}${history?":history":""}`,sourceId:"fixture",at:AT,
        value:{formatVersion:1,generatedAt:AT,meetings:[row],sources:[],counts:snapshotCounts([row],0),
          agendaDocuments:[{id:`document:${id}`,meetingId:row.id,documentUrl:`https://example.gov/${id}`,text:`Exact ${id} agenda`}]}});
    }
    await seedPlacePages(query,{state:"OR",divisionIds:[],bodyIds:[alias],neighbors:true});
    await seedPlacePages(query,{state:"AZ",divisionIds:[],bodyIds:[FIRST]});
    await seedPlacePages(query,{state:"US",divisionIds:[country],bodyIds:[national]});
    const states:string[] = [];
    const saved:Query = async(text,params=[]) => {
      assert.equal(text,PLACE_PAGES_SQL,"alias state selection adds no identity query");
      states.push(String(params[0]));
      return query(text,params);
    };
    for(const window of ["SHOWN","HELD"] as const) {
      states.length=0;
      let context:ReaderMeetingsContext|undefined;
      const read=await readReaderEdgeMeetings({states:["or"],bodyIds:[alias],neighbors:true,window,includeAgenda:true,
        meetingIds:[window==="HELD"?past.id:current.id],now:AT,settings:meetingSettingsFromValues(),query:saved,onContext:value=>{context=value;}});
      assert.equal(read.kind,"PROMOTED",JSON.stringify(read));
      assert.deepEqual(states,["OR"],"the explicit state supplies the short alias's only page selection");
      if(read.kind!=="PROMOTED")throw Error("The alias's saved calendar was not read");
      assert.deepEqual(read.value.meetings.map(row=>row.id).sort(),(window==="HELD"?[past.id,current.id]:[current.id]).sort());
      assert.deepEqual(read.value.agendaDocuments.map(row=>row.text).sort(),(window==="HELD"?["Exact past agenda","Exact current agenda"]:["Exact current agenda"]).sort());
      assert.deepEqual(context?.states,["OR"]);
      assert.deepEqual(context?.registry?.registry.bodies.map(row=>row.id),[body],"the alias keeps its canonical registry context");
    }
    states.length=0;
    const combined=await readReaderEdgeMeetings({states:["OR"],bodyIds:[alias,FIRST],now:AT,query:saved,settings:meetingSettingsFromValues()});
    assert.equal(combined.kind,"PROMOTED",JSON.stringify(combined));
    assert.deepEqual(states,["OR","AZ"],"an independently qualified body still selects its own state");
    if(combined.kind==="PROMOTED")assert.deepEqual(combined.value.meetings.map(row=>row.id).sort(),[current.id,arizona.id].sort());
    states.length=0;
    const nationalRead=await readReaderEdgeMeetings({states:["US"],bodyIds:["national-board-alias"],now:AT,query:saved,settings:meetingSettingsFromValues()});
    assert.equal(nationalRead.kind,"PROMOTED",JSON.stringify(nationalRead));
    assert.deepEqual(states,["US"]);
    if(nationalRead.kind==="PROMOTED")assert.deepEqual(nationalRead.value.meetings.map(row=>row.id),[federal.id]);
    states.length=0;
    const divisionRead=await readReaderEdgeMeetings({states:["OR"],ocdIds:[country],bodyIds:[national],now:AT,query:saved,settings:meetingSettingsFromValues()});
    assert.equal(divisionRead.kind,"PROMOTED",JSON.stringify(divisionRead));
    assert.deepEqual(states,["OR","US"],"a named national division retains its national selection");
    if(divisionRead.kind==="PROMOTED")assert.deepEqual(divisionRead.value.meetings.map(row=>row.id),[federal.id]);
  } finally {await pg.close();}
});

test("an in-place governing-name correction reaches saved runtime bodies and current/history meetings",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const query:Query=async(text,params=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const division=`${AZ}/place:mesa`,body=`${division}#governing`;
  const source={sourceUrl:'https://example.gov/council',sourceOrg:'City Council',collectedAt:AT,verifiedAt:AT};
  const geography:Division={ocdId:division,divisionType:'place',label:'Mesa',tier:'local',state:'AZ',parentOcdId:null,
    lsad:null,funcstat:null,classfp:null,geoid:null,canonicalOcdId:division,canonicalMatch:'exact',sourceDataset:'TIGER_CB2023',provenance:source};
  const current={...meeting(body,'renamed-current',AT),bodyName:'City Council Special Meeting'};
  const past={...meeting(body,'renamed-past','2020-01-01T12:00:00Z'),bodyName:'City Council Special Meeting'};
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Mesa','AZ',NULL),($2,'body','City Council','AZ',$1)",[division,body]);
    await query('INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)',[body,division]);
    await publish({id:'runtime-renamed',recordClass:'REGISTRY_RUNTIME_BINDING',scope:'US-AZ:reader-registry-runtime',sourceId:'fixture',at:AT,
      value:{formatVersion:1,registry:{generatedAt:AT,bodies:[{id:body,ocdId:division,name:'City Council Special Meeting',bodyClass:'GOVERNING',
        bodyOrigin:'SOURCED',coverageStatus:'NOT_ATTEMPTED',agendaSourceType:'NONE',agendaSourceRef:null,meetingCadence:null,
        homepageUrl:null,demandCount:0,sourceDataset:'GOV_DIRECTORY',provenance:source}],divisions:[geography]},
        bodyRosters:[{bodyId:body,bodyName:'City Council Special Meeting',members:[],partisanship:'NONPARTISAN',...source}],
        rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}}});
    for(const [suffix,sitting,history] of [['current',current,false],['past',past,true]] as const)await publish({id:`renamed-${suffix}`,recordClass:'MEETING',scope:`source:fixture:body:${encodeURIComponent(body)}${history?':history':''}`,sourceId:'fixture',at:AT,
      value:{formatVersion:1,generatedAt:AT,meetings:[sitting],sources:[],counts:snapshotCounts([sitting],0),agendaDocuments:[]}});
    await seedPlacePages(query,{state:'AZ',divisionIds:[division],bodyIds:[body]});
    for(const includeHistory of [false,true]) {
      const place=await readPlacePackage({state:'AZ',divisionIds:[division],includeHistory},query);
      assert.equal(place.registry?.registry.bodies[0]?.name,'City Council');
      assert.equal(place.registry?.bodyRosters[0]?.bodyName,'City Council');
      assert.equal(place.bodies[0]?.name,'City Council');
      assert.ok(place.meetings.every(meeting=>meeting.bodyId===body&&meeting.bodyName==='City Council'));
      assert.deepEqual(place.meetings.map(meeting=>meeting.id).sort(),(includeHistory?[current.id,past.id]:[current.id]).sort());
      const coverage=stateCoverage({state:'AZ',registry:place.registry!,version:'renamed-body'},[division],0,0,place.meetings,place.bodies);
      assert.equal(coverage.bodies.find(shown=>shown.bodyId===body)?.name,'City of Mesa Council');
    }
    assert.deepEqual(await query("SELECT value FROM entity_external_id WHERE scheme='body-alias'"),[],"the same governing ID needed no alias");
  }finally{await pg.close();}
});

test("saved division contexts read current alias pointers without storing a second alias map",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const query:Query=async(text,params=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const db:FactDb={transaction:work=>pg.transaction(tx=>work(async(text,params=[])=>(await tx.query<Record<string,unknown>>(text,[...params])).rows))};
  const division=`${AZ}/place:alias-example`,body=`${division}#governing`,alias=`${division}#body:special-meeting`;
  const current={...meeting(alias,'transient-current',AT),bodyName:'Special Meeting'};
  const past={...meeting(alias,'transient-past','2020-01-01T12:00:00Z'),bodyName:'Special Meeting'};
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Example','AZ',NULL),($2,'body','City Council','AZ',$1),($3,'body','Special Meeting','AZ',$1)",[division,body,alias]);
    await query('INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)',[body,division]);
    await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2)",[body,alias]);
    for(const [suffix,sitting,history] of [['current',current,false],['past',past,true]] as const)await publish({id:`transient-${suffix}`,recordClass:'MEETING',scope:`source:fixture:body:${encodeURIComponent(alias)}${history?':history':''}`,sourceId:'fixture',at:AT,
      value:{formatVersion:1,generatedAt:AT,meetings:[sitting],sources:[],counts:snapshotCounts([sitting],0),agendaDocuments:[]}});
    await query('UPDATE place_page SET stale_at=NULL');
    await query('INSERT INTO place_page(place_id,stale_at) VALUES($1,clock_timestamp()) ON CONFLICT(place_id) DO UPDATE SET stale_at=clock_timestamp()',[division]);
    assert.equal((await rebuildPlacePages({db,limit:1,concurrency:1,purge:async()=>({purged:true})})).rebuilt,1);
    const [saved]=await query('SELECT context FROM place_page WHERE place_id=$1',[division]);
    for(const key of ['current','history'])for(const mode of ['full','brief','facts'])
      assert.equal(Object.hasOwn(unpackPlaceContextRow((saved.context as Record<string,Record<string,unknown>>)[key]![mode]),'body_aliases'),false);
    for(const includeHistory of [false,true]) {
      let reads=0;
      const place=await readPlacePackage({state:'AZ',divisionIds:[division],includeHistory},async(text,params)=>{
        reads++;assert.equal(text,PLACE_PAGES_SQL);
        const rows=await query(text,params);
        assert.deepEqual((rows[0] as {read:{headers:unknown}}).read.headers,{[alias]:{id:body,name:'City Council'},[body]:{id:body,name:'City Council'}},'one indexed query supplies only this saved page\'s identity headers');
        return rows;
      });
      assert.equal(reads,1);
      assert.deepEqual(place.meetings.map(meeting=>meeting.id).sort(),(includeHistory?[current.id,past.id]:[current.id]).sort());
      assert.ok(place.meetings.every(meeting=>meeting.bodyId===body&&meeting.bodyName==='City Council'));
    }
  }finally{await pg.close();}
});

