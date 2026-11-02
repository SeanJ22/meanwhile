import assert from "node:assert/strict";
import test from "node:test";
import { readMeetingBodies, readReaderEdgeMeetings, type ReaderMeetingsContext } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { snapshotCounts } from "../lib/meetings/snapshot.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { installReaderOn, migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { seedPlaceSlices } from "./helpers/place-pages.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { Division } from "../lib/registry/types.ts";

const AT = "2026-10-24T12:00:00.000Z", AZ = "ocd-division/country:us/state:az", CA = "ocd-division/country:us/state:ca";
const FIRST = `${AZ}/place:example#council`, SECOND = `${AZ}/place:example#planning`, FOREIGN = `${CA}/place:example#council`;

function meeting(bodyId: string, suffix: string, startsAt: string): Meeting {
  return { id: `fixture:${suffix}`, bodyId, ocdId: bodyId.split("#")[0]!, bodyName: "Public board", title: "Public meeting", startsAt,
    timeZone: "UTC", location: null, agendaUrl: null, jurisdiction: "Local", status: "SCHEDULED",
    provenance: { sourceUrl: "https://example.gov/meetings", sourceOrg: "Public board", collectedAt: AT, verifiedAt: AT } };
}

test("state jobs list IDs once per state and defer each bounded slice read until its body is loaded", async () => {
  const { pg, publish } = await migratedReaderDb();
  const undo = await installReaderOn(pg);
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const direct: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const query: Query = async (text, params = []) => { calls.push({ text, params }); return direct(text, params); };
  const soon = meeting(FIRST, "soon", "2026-10-27T12:00:00Z");
  try {
    await direct("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1),($3,'body','Council','AZ',$2),($4,'body','Planning','AZ',$2),($5,'body','California council','CA',NULL)", [AZ, `${AZ}/place:example`, FIRST, SECOND, FOREIGN]);
    await direct("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$3),($2,$3)", [FIRST, SECOND, `${AZ}/place:example`]);
    for (const [id, row] of [["first", [meeting(FIRST, "old", "2020-01-01T12:00:00Z"), soon, meeting(FIRST, "future", "2028-01-01T12:00:00Z")]], ["second", []]] as const) {
      const bodyId = id === "first" ? FIRST : SECOND;
      await publish({ id, recordClass: "MEETING", scope: `source:fixture:body:${encodeURIComponent(bodyId)}`, sourceId: "fixture", at: AT,
        value: { formatVersion: 1, generatedAt: AT, meetings: row, sources: [], counts: snapshotCounts(row, 0), agendaDocuments: [] } });
    }
    await seedPlaceSlices(direct, { state: "AZ", divisionIds: [`${AZ}/place:example`] });
    await seedPlaceSlices(direct, { state: "CA", divisionIds: [], bodyIds: [FOREIGN] });
    const iterator = readMeetingBodies({ states: ["az", "CA"], now: AT, settings: meetingSettingsFromValues(), query });
    const first = await iterator.next();
    assert.equal(first.done, false);
    assert.equal(first.value!.bodyId, FIRST);
    assert.equal(calls.length, 1, "listing does not load either body's slices");
    const loaded = await first.value!.load();
    assert.deepEqual(loaded?.snapshot.meetings.map(row => row.id), [soon.id], "the configured shown window is still applied");
    assert.equal(calls.length, 2, "one statement reads a body's slices");
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
  } finally { await undo(); await pg.close(); }
});

test("an explicit state resolves a short body alias for current and held agendas without opening a phantom national page", async () => {
  const {pg,publish} = await migratedReaderDb();
  const undo=await installReaderOn(pg);
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
    await seedPlaceSlices(query,{state:"OR",divisionIds:[],bodyIds:[alias],neighbors:true});
    await seedPlaceSlices(query,{state:"AZ",divisionIds:[],bodyIds:[FIRST]});
    await seedPlaceSlices(query,{state:"US",divisionIds:[country],bodyIds:[national]});
    const states:string[] = [];
    const saved:Query = async(text,params=[]) => {
      assert.ok(!/place_page/.test(text),"alias state selection reads no saved page");
      states.push(String(params[5]));
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
    assert.deepEqual([...states].sort(),["AZ","OR"],"an independently qualified body still selects its own state");
    if(combined.kind==="PROMOTED")assert.deepEqual(combined.value.meetings.map(row=>row.id).sort(),[current.id,arizona.id].sort());
    states.length=0;
    const nationalRead=await readReaderEdgeMeetings({states:["US"],bodyIds:["national-board-alias"],now:AT,query:saved,settings:meetingSettingsFromValues()});
    assert.equal(nationalRead.kind,"PROMOTED",JSON.stringify(nationalRead));
    assert.deepEqual(states,["US"]);
    if(nationalRead.kind==="PROMOTED")assert.deepEqual(nationalRead.value.meetings.map(row=>row.id),[federal.id]);
    states.length=0;
    const divisionRead=await readReaderEdgeMeetings({states:["OR"],ocdIds:[country],bodyIds:[national],now:AT,query:saved,settings:meetingSettingsFromValues()});
    assert.equal(divisionRead.kind,"PROMOTED",JSON.stringify(divisionRead));
    assert.deepEqual([...states].sort(),["OR","US"],"a named national division retains its national selection");
    if(divisionRead.kind==="PROMOTED")assert.deepEqual(divisionRead.value.meetings.map(row=>row.id),[federal.id]);
  } finally {await undo();await pg.close();}
});

test("an in-place governing-name correction reaches saved runtime bodies and current/history meetings",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const undo=await installReaderOn(pg);
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
    await seedPlaceSlices(query,{state:'AZ',divisionIds:[division],bodyIds:[body]});
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
  }finally{await undo();await pg.close();}
});

test("slices read current alias pointers, naming a folded board by the board it was folded into",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const undo=await installReaderOn(pg);
  const query:Query=async(text,params=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const division=`${AZ}/place:alias-example`,body=`${division}#governing`,alias=`${division}#body:special-meeting`;
  const current={...meeting(alias,'transient-current',AT),bodyName:'Special Meeting'};
  const past={...meeting(alias,'transient-past','2020-01-01T12:00:00Z'),bodyName:'Special Meeting'};
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Example','AZ',NULL),($2,'body','City Council','AZ',$1),($3,'body','Special Meeting','AZ',$1)",[division,body,alias]);
    await query('INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)',[body,division]);
    await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2)",[body,alias]);
    for(const [suffix,sitting,history] of [['current',current,false],['past',past,true]] as const)await publish({id:`transient-${suffix}`,recordClass:'MEETING',scope:`source:fixture:body:${encodeURIComponent(alias)}${history?':history':''}`,sourceId:'fixture',at:AT,
      value:{formatVersion:1,generatedAt:AT,meetings:[sitting],sources:[],counts:snapshotCounts([sitting],0),agendaDocuments:[]}});
    await seedPlaceSlices(query,{state:'AZ',divisionIds:[division],includeHistory:true});
    for(const includeHistory of [false,true]) {
      let reads=0;
      const place=await readPlacePackage({state:'AZ',divisionIds:[division],includeHistory},async(text,params)=>{reads++;return query(text,params);});
      assert.equal(reads,1);
      assert.deepEqual(place.meetings.map(meeting=>meeting.id).sort(),(includeHistory?[current.id,past.id]:[current.id]).sort());
      assert.ok(place.meetings.every(meeting=>meeting.bodyId===body&&meeting.bodyName==='City Council'));
    }
  }finally{await undo();await pg.close();}
});
