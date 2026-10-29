import assert from "node:assert/strict";
import test from "node:test";
import { readMeetingBodies, readReaderEdgeMeetings, type ReaderMeetingsContext } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { snapshotCounts } from "../lib/meetings/snapshot.ts";
import { PLACE_PAGES_SQL, READY_PLACE_SQL, readPlacePackage, placePageCacheIds } from "../lib/reader/place.ts";
import { rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { unpackPlaceContextRow, unpackReadyPlace } from "../lib/reader/place-ready.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { seedPlacePages } from "./helpers/place-pages.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { Division } from "../lib/registry/types.ts";
import { readerCacheTags } from "../lib/reader/cache.ts";

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
    return [bodyRow(bodies[0]!, bodies[0] === FIRST ? [meeting(FIRST, "old", "2020-01-01T12:00:00Z"), soon,
      meeting(FIRST, "future", "2028-01-01T12:00:00Z")] : [])];
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

test("state selection reads individual body contexts and direct pages select separate current/history answers", async () => {
  const { pg, publish } = await migratedReaderDb();
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const current = meeting(FIRST, "current", AT), other = meeting(SECOND, "other", AT), past = meeting(FIRST, "past", "2020-01-01T12:00:00Z");
  try {
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ'),($2,'body','Council','AZ'),($3,'body','Planning','AZ'),($4,'body','Elsewhere','CA')", [AZ, FIRST, SECOND, FOREIGN]);
    await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias','former-council-id')", [FIRST]);
    for (const [id, scope, meetings] of [["current", "source:derived:family:US-AZ", [current, other]], ["history", "source:derived:family:US-AZ:history", [past]]] as const) {
      await publish({ id, recordClass: "MEETING", scope, sourceId: "fixture", at: AT,
        value: { formatVersion: 1, generatedAt: AT, meetings, sources: [], agendaDocuments: [], counts: snapshotCounts(meetings, 0) } });
    }
    await seedPlacePages(query, { state: "AZ", divisionIds: [], bodyIds: [FIRST, SECOND] });
    let reads = 0;
    const state = await readPlacePackage({ state: "AZ", divisionIds: [], allBodies: true }, async (text, params) => {
      reads++;
      assert.equal(text, PLACE_PAGES_SQL);
      const rows = await query(text, params);
      assert.deepEqual(rows.map(row => row.page_id), [FIRST, SECOND]);
      for (const row of rows) assert.deepEqual((unpackPlaceContextRow(row.row).entities as { id: string }[]).map(body => body.id), [row.page_id]);
      return rows;
    });
    assert.equal(reads, 1);
    assert.deepEqual(placePageCacheIds(state),[FIRST,SECOND]);
    assert.deepEqual(state.meetings.map(row => row.id).sort(), [current.id, other.id].sort());
    await seedPlacePages(query, { state: "WA", divisionIds: [] });
    const empty = await readPlacePackage({ state: "WA", divisionIds: [], allBodies: true }, async (text, params) => {
      const rows = await query(text, params);
      assert.deepEqual(rows.map(row => row.page_kind), ["empty"], "a state with no bodies uses only its saved empty shell");
      return rows;
    });
    assert.deepEqual(empty.bodies, []);
    assert.equal(empty.snapshotHeldAt, null);
    const alias = await readPlacePackage({ state: "AZ", divisionIds: [], bodyIds: ["former-council-id"] }, query);
    assert.deepEqual(alias.bodies.map(body => body.id), [FIRST]);
    assert.deepEqual(alias.meetings.map(row => row.id), [current.id]);
    assert.deepEqual(placePageCacheIds(alias),[FIRST],"cache tags use the selected canonical page instead of its requested alias");
    for (const includeHistory of [false, true]) {
      const ready = await readPlacePackage({ state: "AZ", placeId: FIRST, divisionIds: [], includeHistory }, async (text, params) => {
        assert.equal(text, READY_PLACE_SQL);
        return query(text, params);
      });
      assert.deepEqual(ready.meetings.map(row => row.id).sort(), (includeHistory ? [past.id, current.id] : [current.id]).sort());
      assert.deepEqual(placePageCacheIds(ready),[FIRST]);
    }
    const zip = "zip:85701";
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Fixture ZIP','AZ')", [zip]);
    await query(`INSERT INTO place_page(place_id,body,history_body,context)
      SELECT $1,body,'{}'::jsonb,'{"formatVersion":1}'::jsonb FROM place_page WHERE place_id=$2`, [zip, FIRST]);
    for (const includeHistory of [false, true]) {
      let zipReads = 0;
      const selected = await readPlacePackage({ state: "AZ", placeId: zip, divisionIds: [], bodyIds: [FIRST], includeHistory }, async (text, params) => {
        zipReads++;
        assert.equal(text, includeHistory ? PLACE_PAGES_SQL : READY_PLACE_SQL, "ZIP history uses the existing bounded place/body context");
        return query(text, params);
      });
      assert.equal(zipReads, 1);
      assert.deepEqual(selected.meetings.map(row => row.id).sort(), (includeHistory ? [past.id, current.id] : [current.id]).sort());
    }
    const [stored] = await query("SELECT body->>'encoding' AS direct_current,history_body->>'encoding' AS direct_history,context ? 'current' AS raw_current FROM place_page WHERE place_id=$1", [FIRST]);
    assert.deepEqual(stored, { direct_current: "br-json-v1", direct_history: "br-json-v1", raw_current: true });
  } finally { await pg.close(); }
});

test("the real worker stores agenda-free ready body pages and preserves full current and permanent history agendas in context", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("The body-page fixture must stay local"); });
  const { pg, publish } = await migratedReaderDb();
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const db: FactDb = { transaction: run => pg.transaction(tx => run(async (text, params = []) =>
    (await tx.query<Record<string, unknown>>(text, [...params])).rows)) };
  const old = meeting(FIRST, "old", "2020-01-01T12:00:00Z"), soon = meeting(FIRST, "soon", "2026-10-27T12:00:00Z");
  const future = meeting(FIRST, "far-future", "2028-01-01T12:00:00Z");
  const currentDocument = { id: "document:current", meetingId: soon.id, text: "CURRENT SOURCE AGENDA: public hearing and budget consideration.\n".repeat(300) };
  const pastDocument = { id: "document:past", meetingId: old.id, text: "PERMANENT SOURCE AGENDA: land use hearing and recorded decisions.\n".repeat(300) };
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'body','Council','AZ',$1)", [AZ, FIRST]);
    for (const [id, meetings, agendaDocuments, history] of [
      ["current", [soon, future], [currentDocument], false], ["past", [old], [pastDocument], true],
    ] as const) {
      await publish({ id, recordClass: "MEETING", scope: `source:fixture:body:${encodeURIComponent(FIRST)}${history ? ":history" : ""}`, sourceId: "fixture", at: AT,
        value: { formatVersion: 1, generatedAt: AT, meetings, agendaDocuments, sources: [], counts: snapshotCounts(meetings, 0) } });
    }
    await query("INSERT INTO rebuild_queue(place_id) VALUES($1)", [FIRST]);
    assert.deepEqual(await rebuildPlacePages({ db, limit: 1, concurrency: 1, purge: async () => ({ purged: true }) }),
      { rebuilt: 1, failed: 0, remaining: 0 });
    const [stored] = await query("SELECT body,history_body,context FROM place_page WHERE place_id=$1", [FIRST]);
    for (const ready of [stored!.body, stored!.history_body]) assert.equal((ready as { encoding: string }).encoding, "br-json-v1");
    const readyWire = JSON.stringify([unpackReadyPlace(stored!.body), unpackReadyPlace(stored!.history_body)]);
    assert.equal(readyWire.includes("SOURCE AGENDA"), false, "neither ready encoding stores source agenda text");
    const context = stored!.context as { current: {full:unknown}; history: {full:unknown} };
    const documents = (row:unknown) => (unpackPlaceContextRow(row).meeting_rows as {payload:{agendaDocuments:unknown[]}}[]).flatMap(partition=>partition.payload.agendaDocuments);
    assert.deepEqual(documents(context.current.full), [currentDocument]);
    assert.deepEqual(documents(context.history.full).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      [currentDocument, pastDocument].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    let pageReads = 0, compactWire = "", uncompressedBytes = 0;
    const compactQuery: Query = async (text, params = []) => {
      if (!text.startsWith("SELECT id FROM entity")) {
        assert.equal(text, READY_PLACE_SQL);
        assert.deepEqual(params, [FIRST, true]);
        pageReads++;
      }
      const rows = await query(text, params);
      if (text === READY_PLACE_SQL) {
        compactWire = JSON.stringify(rows);
        uncompressedBytes = Buffer.byteLength(JSON.stringify(rows.map(row => ({ ...row, page: unpackReadyPlace(row.page) }))));
      }
      return rows;
    };
    const iterator = readMeetingBodies({ states: ["AZ"], includeAgenda: false, window: "HELD", now: AT, settings: meetingSettingsFromValues(), query: compactQuery });
    const body = await iterator.next();
    if (body.done) throw new Error("The held body was not listed");
    assert.equal(pageReads, 0);
    const loaded = await body.value.load();
    assert.equal(pageReads, 1);
    assert.deepEqual(loaded?.snapshot.meetings.map(row => row.id), [old.id, soon.id]);
    assert.deepEqual(loaded?.snapshot.agendaDocuments, []);
    assert.equal(compactWire.includes("SOURCE AGENDA"), false, "the actual compact SELECT transfers no agenda text");
    await iterator.return(undefined);
    const selected = { state: "AZ", placeId: FIRST, divisionIds: [], bodyIds: [FIRST], includeHistory: true };
    const defaultRead = await readPlacePackage(selected, compactQuery);
    assert.deepEqual(defaultRead.snapshot.agendaDocuments, [], "omitting the agenda flag retains the existing compact default");
    let agendaWire = "";
    const opened = await readPlacePackage({ ...selected, includeAgenda: true }, async (text, params) => {
      assert.equal(text, PLACE_PAGES_SQL);
      const rows = await query(text, params);
      agendaWire = JSON.stringify(rows);
      return rows;
    });
    assert.deepEqual(opened.meetings.map(row => row.id), [old.id, soon.id, future.id]);
    assert.deepEqual([...opened.snapshot.agendaDocuments].sort((a, b) => a.id.localeCompare(b.id)), [currentDocument, pastDocument]);
    const compactBytes = Buffer.byteLength(compactWire), agendaBytes = Buffer.byteLength(agendaWire);
    assert.ok(compactBytes < uncompressedBytes / 3, `gzip transferred ${compactBytes} bytes versus ${uncompressedBytes} as complete JSON`);
    assert.ok(compactBytes < agendaBytes, `the compact read was ${compactBytes} bytes versus ${agendaBytes} with compressed source agendas`);
    t.diagnostic(JSON.stringify({ compactBytes, uncompressedBytes, agendaBytes, sourceAgendaBytes: Buffer.byteLength(currentDocument.text + pastDocument.text) }));
  } finally { await pg.close(); }
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
    await query('DELETE FROM rebuild_queue');
    await query('INSERT INTO rebuild_queue(place_id) VALUES($1)',[division]);
    assert.equal((await rebuildPlacePages({db,limit:1,concurrency:1,purge:async()=>({purged:true})})).rebuilt,1);
    const [saved]=await query('SELECT context FROM place_page WHERE place_id=$1',[division]);
    for(const key of ['current','history'])for(const mode of ['full','brief','facts'])
      assert.equal(Object.hasOwn(unpackPlaceContextRow((saved.context as Record<string,Record<string,unknown>>)[key]![mode]),'body_aliases'),false);
    for(const includeHistory of [false,true]) {
      let reads=0;
      const place=await readPlacePackage({state:'AZ',divisionIds:[division],includeHistory},async(text,params)=>{
        reads++;assert.equal(text,PLACE_PAGES_SQL);
        const rows=await query(text,params);
        assert.deepEqual(rows[0]?.body_headers,{[alias]:{id:body,name:'City Council'},[body]:{id:body,name:'City Council'}},'one indexed query supplies only this saved page\'s identity headers');
        return rows;
      });
      assert.equal(reads,1);
      assert.deepEqual(place.meetings.map(meeting=>meeting.id).sort(),(includeHistory?[current.id,past.id]:[current.id]).sort());
      assert.ok(place.meetings.every(meeting=>meeting.bodyId===body&&meeting.bodyName==='City Council'));
    }
  }finally{await pg.close();}
});

test("a queued body fold immediately corrects ready ZIP and saved contexts before their rebuild",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const query:Query=async(text,params=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const db={query,transaction:<T>(work:(q:Query)=>Promise<T>)=>pg.transaction(tx=>work(async(text,params=[])=>(await tx.query<Record<string,unknown>>(text,[...params])).rows))};
  const division=`${AZ}/place:queued-example`,body=`${division}#governing`,alias=`${division}#body:special-meeting`,zip='zip:85701';
  const current={...meeting(alias,'queued-current',AT),bodyName:'Special Meeting'};
  const past={...meeting(alias,'queued-past','2020-01-01T12:00:00Z'),bodyName:'Special Meeting'};
  const normal={...meeting(body,'queued-normal',AT),bodyName:'City Council'};
  const fresh={...meeting(body,'queued-duplicate','2026-10-25T16:00:00Z'),bodyName:'City Council',status:'CANCELED' as const,
    provenance:{...normal.provenance,collectedAt:'2026-10-25T12:00:00Z'}};
  const older={...fresh,bodyId:alias,bodyName:'Special Meeting',startsAt:AT,status:'SCHEDULED' as const,
    agendaUrl:'https://example.gov/held-agenda',provenance:normal.provenance};
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Example','AZ',NULL),($2,'body','City Council','AZ',$1),($3,'body','Special Meeting','AZ',$1),($4,'place','Fixture ZIP','AZ',NULL)",[division,body,alias,zip]);
    await query('INSERT INTO entity_place(entity_id,place_id) VALUES($1,$3),($2,$3)',[body,alias,division]);
    for(const [suffix,sitting,history] of [['current',current,false],['past',past,true]] as const)await publish({id:`queued-${suffix}`,recordClass:'MEETING',scope:`source:fixture:body:${encodeURIComponent(alias)}${history?':history':''}`,sourceId:'fixture',at:AT,
      value:{formatVersion:1,generatedAt:AT,meetings:history?[sitting]:[sitting,older],sources:[],counts:snapshotCounts(history?[sitting]:[sitting,older],0),agendaDocuments:[]}});
    await publish({id:'queued-normal',recordClass:'MEETING',scope:`source:fixture:body:${encodeURIComponent(body)}`,sourceId:'fixture',at:AT,
      value:{formatVersion:1,generatedAt:AT,meetings:[normal,fresh],sources:[],counts:snapshotCounts([normal,fresh],0),agendaDocuments:[]}});
    await query('DELETE FROM rebuild_queue');
    await query('INSERT INTO rebuild_queue(place_id) SELECT unnest($1::text[])',[[division,body,alias]]);
    assert.equal((await rebuildPlacePages({db,limit:3,concurrency:1,purge:async()=>({purged:true})})).rebuilt,3);
    // A ZIP's ready payload is the same composed answer stored by the worker, without source contexts.
    await query(`INSERT INTO place_page(place_id,body,history_body,context) SELECT $1,body,history_body,'{"formatVersion":1}'::jsonb FROM place_page WHERE place_id=$2`,[zip,division]);
    await query('INSERT INTO place_page_dependency(page_id,entity_id) SELECT $1,entity_id FROM place_page_dependency WHERE page_id=$2',[zip,division]);
    const old=await readPlacePackage({state:'AZ',placeId:zip,divisionIds:[]},query);
    assert.ok(old.bodies.some(row=>row.name==='Special Meeting'),'the cached fixture starts with the reported defect');
    const {foldPortalBodyLabels}=await import('../lib/facts/portal-publication.ts');
    const purged:string[]=[];
    assert.equal((await foldPortalBodyLabels(db,'AZ',async tags=>{purged.push(...tags);return {purged:true};})).folded,1);
    assert.ok(readerCacheTags({places:[zip,division,body,alias]}).every(tag=>purged.includes(tag)),'cached ZIP, division and body responses are purged before queued rebuilds');
    assert.equal(purged.includes('reader-settings'),false);
    assert.ok(Number((await query('SELECT count(*) AS n FROM rebuild_queue'))[0]?.n)>0,'replacement pages are still queued');
    for(const selected of [
      {state:'AZ',placeId:zip,divisionIds:[]},
      {state:'AZ',divisionIds:[division]},
      {state:'AZ',placeId:alias,divisionIds:[],bodyIds:[alias]},
      {state:'AZ',placeId:body,divisionIds:[],bodyIds:[body]},
    ])for(const includeHistory of [false,true]) {
      const input=selected.placeId===zip&&includeHistory?{...selected,divisionIds:[division],includeHistory}:{...selected,includeHistory};
      const place=await readPlacePackage(input,query);
      assert.deepEqual(place.bodies.map(row=>[row.id,row.name]),[[body,'City Council']]);
      assert.deepEqual(place.meetings.map(row=>row.id).sort(),(includeHistory?[current.id,past.id,normal.id,fresh.id]:[current.id,normal.id,fresh.id]).sort());
      assert.ok(place.meetings.every(row=>row.bodyId===body&&row.bodyName==='City Council'));
      const duplicate=place.meetings.find(row=>row.id===fresh.id)!;
      assert.equal(duplicate.status,'CANCELED');assert.equal(duplicate.startsAt,fresh.startsAt);
      assert.equal(duplicate.agendaUrl,older.agendaUrl,'the newer cancellation retains its earlier published agenda link');
    }
    await query("UPDATE rebuild_queue SET queued_at='1970-01-01' WHERE place_id=$1",[body]);
    assert.equal((await rebuildPlacePages({db,limit:1,concurrency:1,purge:async()=>({purged:true})})).rebuilt,1);
    assert.equal((await query('SELECT 1 FROM rebuild_queue WHERE place_id=$1',[body])).length,0);
    assert.ok((await query('SELECT 1 FROM rebuild_queue WHERE place_id=$1',[alias])).length>0);
    for(const includeHistory of [false,true]) {
      const place=await readPlacePackage({state:'AZ',placeId:alias,divisionIds:[],includeHistory},query);
      assert.deepEqual(place.meetings.map(row=>row.id).sort(),(includeHistory?[normal.id,current.id,past.id,fresh.id]:[normal.id,current.id,fresh.id]).sort());
      assert.deepEqual(placePageCacheIds(place),[body],'an old alias URL uses the rebuilt canonical page while other rebuilds remain queued');
    }
  }finally{await pg.close();}
});
