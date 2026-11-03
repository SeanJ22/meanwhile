import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { derivedMeetingFamilyScope, meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import { readPlacePackage, type PlaceInput } from "../lib/reader/place.ts";
import { buildPlacePackage } from "../lib/reader/place-builder.ts";
import { seedPlaceSlices } from "./helpers/place-pages.ts";
import { installReaderOn } from "./helpers/migrated-reader-db.ts";
import type { Query } from "../lib/facts/publish.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { ReaderStatePackage } from "../lib/reader/state.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { installKeyedRows } from "./helpers/keyed-rows.ts";
import { factDb } from "./helpers/fact-db.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";

const STATE = "ocd-division/country:us/state:az", COUNTY = `${STATE}/county:pima`, CITY = `${STATE}/place:tucson`;
const BODY = `${CITY}#governing`, COUNTY_BODY = `${COUNTY}#supervisors`, SPECIAL = "curated:az/pima/special";
const SOURCE = "https://tucsonaz.gov/council", AT = "2026-10-17T12:00:00.000Z";

const unrecorded = (recordClass: RoutineRecordClass,scope: string): Extract<CivicDataReadResult<never>,{kind:"NOT_RECORDED"}> => ({
  kind:"NOT_RECORDED",value:null,detail:"fixture",metadata:{recordClass,scope,sourceId:null,version:null,versionId:null,lastKnownGoodVersionId:null,
    sourceThrough:null,retrievedAt:null,promotedAt:null,stale:"UNKNOWN",staleAt:null},
});

async function canonicalTables(db: Awaited<ReturnType<typeof factDb>>) {
  await db.pg.exec("CREATE TABLE IF NOT EXISTS place_slice(place_id text NOT NULL,card text NOT NULL,body jsonb,fingerprint text NOT NULL,inputs text,built_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(place_id,card))");
  await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb,promoted_at timestamptz,current_version_id text,source_id text,last_known_good_version_id text,validation_receipt jsonb);
    CREATE TABLE civic_data_candidate_events(candidate_id text,detail text,sequence bigint);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,retrieved_at timestamptz,candidate jsonb,state text,
      acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,validation_receipt jsonb)`);
  const functions = readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint")
    .filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
  for (const sql of functions) await db.pg.exec(sql);
  await installKeyedRows(db.pg);
}

async function readReadyPackage(db: Awaited<ReturnType<typeof factDb>>,input: PlaceInput,query: Query = db.query) {
  await seedPlaceSlices(db.query,input);
  const undo = await installReaderOn(db.pg);
  try {
    return await readPlacePackage(input,async(text,params)=>{
      assert.ok(!/place_page/.test(text),"the reader never queries a saved page");
      return query(text,params);
    });
  } finally { await undo(); }
}

test("the page builder joins local facts and complete calendars from every held source", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    await db.pg.exec(readFileSync(new URL("../lib/db/migrations/0043_rs01_place_reads.sql",import.meta.url),"utf8"));
    const entity = (id: string, kind: string, name: string, parent: string | null = null, state = "AZ") => db.query(
      "INSERT INTO entity(id,kind,name,parent_id,state) VALUES($1,$2,$3,$4,$5)",[id,kind,name,parent,state]);
    await entity(STATE,"place","Arizona");
    await entity(COUNTY,"place","Pima",STATE);
    await entity(CITY,"place","Tucson",STATE);
    await entity("pima-government","government","Pima County",COUNTY);
    await entity(BODY,"body","Mayor and Council",CITY);
    await entity(COUNTY_BODY,"body","Supervisors","pima-government");
    await entity(SPECIAL,"body","Water district");
    await entity(`${STATE}#executive`,"body","Statewide official",STATE);
    await entity("unrelated-body","body","Elsewhere");
    await db.query("INSERT INTO entity_place VALUES($1,$2)",[SPECIAL,COUNTY]);
    await entity("person:mayor","person","Mayor");
    await entity("meeting:new","meeting","Council",BODY);
    await entity("meeting:existing","meeting","Council",BODY);
    await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'source')`,[SOURCE,AT,"a".repeat(64)]);
    const fact = (id: string,field: string,value: unknown,status = "live") => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,$2,$3,'saved quote',$4,'OFFICIAL',1,'saved quote',$5,'test')`,[id,field,JSON.stringify(value),status,AT]);
    await fact(BODY,"name","Tucson Mayor and Council");
    await fact(BODY,"office_phone","520-555-0100");
    await fact(BODY,"member:person:mayor",{name:"Mayor",office:"Mayor"});
    await fact("person:mayor","name","Jane Mayor");
    await fact("person:mayor",`office:${BODY}`,"Mayor");
    await fact("person:mayor","phone","520-555-0101");
    await fact(BODY,"comment:period","YES");
    await fact(BODY,"comment:signup","Sign up at the door");
    await fact("unrelated-body","office_phone","not this place");
    await fact("meeting:new","title","New public hearing");
    await fact("meeting:new","starts_at",{startsAt:"2026-10-20T19:00:00-07:00",timeZone:"America/Phoenix",precision:"MINUTE"});
    await fact("meeting:existing","title","Current title");
    await fact("meeting:existing","title","Held title","held");
    const held: Meeting = { id:"existing",bodyId:BODY,ocdId:CITY,bodyName:"Mayor and Council",title:"Older title",startsAt:"2026-10-19T19:00:00-07:00",timeZone:"America/Phoenix",
      location:{name:"City Hall",address:"255 W Alameda",lat:32.22,lng:-110.97},agendaUrl:"https://tucsonaz.gov/agenda",videoUrl:"https://tucsonaz.gov/video",jurisdiction:"Tucson, AZ",status:"CANCELED",
      provenance:{sourceUrl:SOURCE,sourceOrg:"Tucson",collectedAt:AT,verifiedAt:AT,doorId:`meetings:new-custom-source:${encodeURIComponent(BODY)}`},mergedMeetingIds:["other"],publicationConflicts:[] };
    const snapshot = {formatVersion:1,generatedAt:AT,counts:{fresh:1,carried:0,total:1,duplicatesCollapsed:0},sources:[],meetings:[held],agendaDocuments:[{id:"agenda",meetingId:"existing",text:"x".repeat(40_000)}]};
    const row = snapshot;
    const encoded = partitionCivicPayload(row);
    assert.ok(encoded.parts.length > 0,"canonical meeting metadata exercises nested payload parts");
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    const scope = meetingPartitionScope("new-custom-source",BODY);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,'version')",[`MEETING:${scope}`,scope,JSON.stringify(encoded.value),AT]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,'history-version')",
      [`MEETING:${scope}:history`,`${scope}:history`,JSON.stringify({...snapshot,meetings:[{...held,id:"past-sitting"}],agendaDocuments:[]}),AT]);
    const inventory = [
      {id:"government:US-AZ:cog:city",state:"AZ",name:"City of Tucson",associations:[{divisionId:CITY}],officePhone:"520-555-0111",officeAddress:"City Hall",nativeIds:{census_pid6:"1"}},
      {id:"government:US-AZ:cog:pima",state:"AZ",name:"County of Pima",associations:[{divisionId:COUNTY}]},
      {id:"government:US-AZ:cog:other-pima",state:"AZ",name:"County of Pima",associations:[{divisionId:"elsewhere"}]},
    ];
    const division = {ocdId:CITY,label:"Tucson",divisionType:"place",state:"AZ",parentOcdId:STATE};
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'REGISTRATION',$2,$3,$4,'inventory-version')",
      ["REGISTRATION:US-AZ:registration:v1","US-AZ:registration:v1",JSON.stringify({governments:inventory,divisions:[division,{ocdId:"elsewhere"}]}),AT]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'DOTGOV_REFERENCE',$2,$3,$4,'domain-version')",
      ["DOTGOV_REFERENCE:US:current-full:domains","US:current-full:domains",JSON.stringify({source:{url:"https://get.gov/registry",readAt:AT},domains:[
        {domain:"tucsonaz.gov",state:"AZ",organization:"Tucson, City of"},
        {domain:"pima.gov",state:"AZ",organization:"County of Pima"},
        {domain:"elsewhere.gov",state:"NM",organization:"City of Tucson"},
      ]}),AT]);
    let calls = 0;
    const result = await buildPlacePackage({state:"az",divisionIds:[CITY,COUNTY],includeAgenda:true},async (sql,params) => {calls++;return db.query(sql,params);});
    assert.equal(calls,1);
    assert.equal(result.registrationHeld,true);
    assert.deepEqual(result.divisions,[division]);
    assert.equal(result.governments.length,2);
    assert.equal(result.governments.find(g => g.id.endsWith(":city"))?.recipientNameUnique,true);
    assert.equal(result.governments.find(g => g.id.endsWith(":pima"))?.recipientNameUnique,false,
      "an identically named government elsewhere in the state remains ambiguous after the place is selected");
    assert.equal(result.governments.find(g => g.id.endsWith(":city"))?.officePhone,"520-555-0111");
    assert.deepEqual(result.governments.find(g => g.id.endsWith(":city"))?.govDomains,[{domain:"tucsonaz.gov",website:"https://tucsonaz.gov",sourceUrl:"https://get.gov/registry",checkedAt:AT}]);
    assert.deepEqual(result.governments.find(g => g.id.endsWith(":pima"))?.govDomains,[],"statewide duplicate identities stay ambiguous after narrowing to this ZIP");
    assert.deepEqual(result.bodies.map(b => b.id).sort(),[BODY,COUNTY_BODY,SPECIAL].sort());
    const council = result.bodies.find(b => b.id === BODY)!;
    assert.equal(council.fields.name,"Tucson Mayor and Council");
    assert.equal(council.fields.officePhone,"520-555-0100");
    assert.equal(council.roster?.members[0]?.name,"Jane Mayor");
    assert.equal(council.roster?.members[0]?.phone,"520-555-0101");
    assert.equal(council.comment?.signup,"Sign up at the door");
    const old = result.meetings.find(m => m.id === "existing")!;
    assert.deepEqual({...old,title:held.title,fieldSources:undefined},{...held,fieldSources:undefined});
    assert.equal(old.title,"Current title");
    assert.equal(result.meetings.find(m => m.id === "new")?.title,"New public hearing");
    assert.deepEqual(result.snapshot.agendaDocuments,snapshot.agendaDocuments);
    assert.equal(result.meetings.some(m => m.id === "past-sitting"),false,"kept history is loaded only when requested");
    const history = await buildPlacePackage({state:"AZ",divisionIds:[],bodyIds:[BODY],includeHistory:true},db.query);
    assert.equal(history.meetings.some(m => m.id === "past-sitting"),true);
    const all = await buildPlacePackage({state:"AZ",divisionIds:[],allBodies:true},db.query);
    assert.ok(all.bodies.some(b => b.id === `${STATE}#executive`),"state streaming includes bodies outside the current ZIP");
    await fact(BODY,"office_address","255 W Alameda Street");
    const next = await buildPlacePackage({state:"AZ",divisionIds:[CITY,COUNTY]},db.query);
    assert.equal(next.bodies.find(b => b.id === BODY)?.fields.officeAddress,"255 W Alameda Street","the next page build includes newly published facts");
    assert.deepEqual(next.snapshot.agendaDocuments,[],"map loads exclude full agenda text while keeping each meeting's agenda link");
    assert.equal(next.meetings.find(m => m.id === "existing")?.agendaUrl,held.agendaUrl);
    let neighborQueries = 0;
    const neighbors = await buildPlacePackage({state:"AZ",divisionIds:[],bodyIds:[SPECIAL],neighbors:true},async(sql,params) => {
      neighborQueries++;return db.query(sql,params);
    });
    assert.equal(neighborQueries,1,"the body's places and neighbouring governments resolve in the same query");
    assert.deepEqual(neighbors.bodies.map(body => body.id).sort(),[SPECIAL,COUNTY_BODY].sort());
    const agendaOnly = await readReadyPackage(db,{state:"AZ",divisionIds:[CITY,COUNTY],bodyIds:[BODY],meetingIds:["existing"],includeAgenda:true});
    assert.equal(agendaOnly.registrationHeld,false,"agenda mode omits the registration inventory while the full place read above retains it");
    assert.deepEqual(agendaOnly.governments,[]);
    assert.deepEqual(agendaOnly.divisions,[]);
    assert.equal(agendaOnly.bodies.find(body => body.id===BODY)?.roster,null,"opening an agenda does not read unrelated membership/person facts");
    assert.deepEqual(agendaOnly.meetings,next.meetings,"sitting facts still overlay every held calendar row");
  } finally { await db.pg.close(); }
});

test("canonical state-family scopes preserve meetings and venue details independently of partial sitting facts", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'family-source')",[SOURCE,AT,"b".repeat(64)]);
    for (const state of ["AZ","NH","NJ"] as const) {
      const division = `ocd-division/country:us/state:${state.toLowerCase()}/place:example`;
      const bodyId = `${division}#planning-board`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Planning Board',$2)",[bodyId,state]);
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'meeting','Public Hearing',$2,$3)",[`meeting:ical:${state}:1`,state,bodyId]);
      await db.query("INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by) VALUES($1,'title',$2,'Public Hearing','live','OFFICIAL',1,'Public Hearing',$3,'fixture')",
        [`meeting:ical:${state}:1`,JSON.stringify("Public Hearing"),AT]);
      const gap: Meeting = { id:`ical:${state}:1`,bodyId,ocdId:division,bodyName:"Planning Board",title:"Public Hearing",startsAt:"2026-10-21T18:00:00-04:00",timeZone:"America/New_York",
        location:null,venueGap:{kind:"STATED_NOT_PLACED",publishedText:"Library meeting room",publisher:"Town Clerk"},agendaUrl:"https://example.gov/agenda",videoUrl:"https://example.gov/video",
        status:"CANCELED",jurisdiction:`Example, ${state}`,provenance:{kind:"OFFICIAL",sourceUrl:SOURCE,sourceOrg:"Town Clerk",collectedAt:AT,verifiedAt:AT},mergedMeetingIds:[`ical:${state}:prior-id`] };
      const online: Meeting = {...gap,id:`ical:${state}:2`,startsAt:"2026-11-04T18:00:00-05:00",status:"SCHEDULED",venueGap:undefined,mergedMeetingIds:[],online:{label:"Video meeting",joinUrl:"https://example.gov/join"}};
      const sibling: Meeting = {...gap,id:`ical:${state}:sibling`,bodyId:`${division}#unrelated-body`,mergedMeetingIds:[]};
      const snapshot = {formatVersion:1,generatedAt:AT,meetings:[gap,online,sibling],agendaDocuments:[],sources:[],counts:{fresh:3,carried:0,total:3,duplicatesCollapsed:0},
        derivedMembers:[{id:`ical:${bodyId}`,source:"ical",bodyId,status:"ACTIVE",outcome:"FRESH"}]};
      const scope = derivedMeetingFamilyScope(`US-${state}`);
      await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,$5)",[`MEETING:${scope}`,scope,JSON.stringify(snapshot),AT,`family-${state}`]);
      const result = await buildPlacePackage({state,divisionIds:[],bodyIds:[bodyId]},db.query);
      assert.deepEqual(result.meetings.map(m => m.id),[gap.id,online.id]);
      const held = result.meetings[0]!;
      assert.deepEqual(held.venueGap,gap.venueGap);
      assert.equal(held.status,"CANCELED");
      assert.equal(held.agendaUrl,gap.agendaUrl);
      assert.equal(held.videoUrl,gap.videoUrl);
      assert.deepEqual(held.mergedMeetingIds,gap.mergedMeetingIds);
      assert.deepEqual(result.meetings[1]!.online,online.online);
      assert.deepEqual(result.bodySnapshots[bodyId].meetings,result.meetings);
      assert.equal(result.bodies[0].fields.name,"Planning Board","a canonical calendar supplies its independently named body");
      assert.equal(result.bodies[0].fields.provenance?.sourceUrl,SOURCE);
      assert.equal(result.bodies[0].fields.sourceDataset,"DERIVED");
      const runtime: RegistryRuntimeReadModel = {formatVersion:1,registry:{generatedAt:AT,bodies:[],divisions:[{ocdId:division,label:"Example",divisionType:"place",tier:"local",state,
        parentOcdId:`ocd-division/country:us/state:${state.toLowerCase()}`,lsad:null,funcstat:null,classfp:null,geoid:null,canonicalOcdId:null,canonicalMatch:"none",
        sourceDataset:"TIGER_CB2023",provenance:gap.provenance}]},bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialPhotos:{photos:[]},rosterPhotos:{},
        officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[]}};
      const peopleRead = unrecorded("STATE_LEGISLATOR",`US-${state}`);
      const statePackage: ReaderStatePackage = {state,version:`fixture-${state}`,boundaryUrl:"/boundaries.pmtiles",districts:{kind:"NOT_PUBLISHED"},registry:runtime,
        registryRead:{kind:"BOOTSTRAP",value:runtime,metadata:unrecorded("REGISTRY_RUNTIME_BINDING",`US-${state}`).metadata,detail:"fixture"},
        federalRead:unrecorded("FEDERAL_DIRECTORY",`US-${state}`),peopleRead,everyday:unrecorded("CURATED_READER_RECORD",`US-${state}`),
        federal:null,president:null,people:null,legislativePeople:null,memberOffices:[],
        stateLegislatorAuthority:{scope:`US-${state}`,kind:"NOT_RECORDED",metadata:peopleRead.metadata,code:null,detail:"fixture"},
      };
      const coverage = stateCoverage(statePackage,[division],0,0,result.meetings,result.bodies);
      assert.deepEqual(coverage.bodies.map(b => [b.bodyId,b.name,b.agendaSourceRef]),[[bodyId,"City of Example Planning Board",SOURCE]],"the body card carries its owning government and independently sourced body");
    }
  } finally { await db.pg.close(); }
});

test("one operation's cold place failure reaches its composed readers without a second query", async () => {
  const failure = new Error("First place read failed");
  let reads = 0, rejectRead: ((error: Error) => void) | undefined;
  installReaderDatabaseQuery(async () => {
    reads++;
    await new Promise<void>((_resolve, reject) => { rejectRead = reject; });
    return [];
  });
  try {
    await withReaderSelection({states:["AZ"],keys:new Set([CITY])},async()=>{
      const first = readPlacePackage({ state: "AZ", divisionIds: [`${CITY}/bs01-failure`] });
      const second = readPlacePackage({ state: "AZ", divisionIds: [`${CITY}/bs01-failure`] });
      const outcomes = Promise.allSettled([first, second]);
      assert.equal(first,second,"both readers compose the same operation's source read");
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reads, 1);
      rejectRead!(failure);
      for (const result of await outcomes) {
        assert.equal(result.status, "rejected");
        if (result.status === "rejected") assert.equal(result.reason, failure);
      }
    });
  } finally { rejectRead?.(failure);installReaderDatabaseQuery(undefined); }
});

test("a special district's board on a city's territory reads under the district, not under the city", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    const al = "ocd-division/country:us/state:al", mobile = `${al}/place:mobile`, housing = "al:special:mobile-housing-authority";
    const board = `${housing}#governing`, council = `${mobile}#governing`, at = "2026-10-20T12:00:00.000Z";
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Alabama','AL',NULL),($2,'place','Mobile city','AL',$1),
      ($3,'government','Mobile Housing Authority','AL',$2),($4,'body','Mobile Housing Authority governing board','AL',$3),($5,'body','City Council','AL',$2)`,
    [al, mobile, housing, board, council]);
    await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2),($3,$2)", [housing, mobile, board]);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'housing')", ["https://www.mobilehousing.org/board", at, "c".repeat(64)]);
    for (const [entity, name] of [[board, "Board of Commissioners"], [council, "City Council"]]) await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'name',$2,$3,'live','OFFICIAL',1,$3,$4,'fixture')`, [entity, JSON.stringify(name), name, at]);
    const result = await buildPlacePackage({ state: "AL", divisionIds: [mobile] }, db.query);
    assert.deepEqual(result.bodies.map(b => [b.id, b.division, b.government ?? null]).sort(), [[board, mobile, "Mobile Housing Authority"], [council, mobile, null]]);
    const runtime: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: at, bodies: [], divisions: [{ ocdId: mobile, label: "Mobile city", divisionType: "place", tier: "local", state: "AL",
      parentOcdId: al, lsad: null, funcstat: null, classfp: null, geoid: null, canonicalOcdId: null, canonicalMatch: "none", sourceDataset: "TIGER_CB2023",
      provenance: { kind: "OFFICIAL", sourceUrl: "https://www2.census.gov/", sourceOrg: "Census", collectedAt: at, verifiedAt: at } }] }, bodyRosters: [], rosterReaderDispositions: [],
      statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {}, officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
    const coverage = stateCoverage({ state: "AL", registry: runtime, version: "fixture" }, [mobile], 0, 0, [], result.bodies);
    assert.deepEqual(coverage.bodies.map(b => [b.name, b.divisionLabel]).sort(), [["City of Mobile Council", "Mobile city"], ["Mobile Housing Authority Board of Commissioners", "Mobile Housing Authority"]]);
    assert.equal(coverage.bodies.find(b=>b.bodyId===board)?.bodyClass,"GOVERNING");
  } finally { await db.pg.close(); }
});


test("derived body pointer cutover keeps other governments and historical agendas while an empty body edition cannot revive legacy sittings",async()=>{
  const db=await factDb();
  try{
    await canonicalTables(db);
    const first=BODY,second=COUNTY_BODY;
    for(const id of [first,second])await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$1,'AZ')",[id]);
    const meeting=(id:string,bodyId:string,startsAt:string):Meeting=>({id,bodyId,ocdId:bodyId.split("#")[0]!,bodyName:bodyId,title:id,startsAt,timeZone:"America/Phoenix",location:null,
      agendaUrl:`https://example.gov/${id}`,jurisdiction:"Held government",status:"SCHEDULED",provenance:{sourceUrl:SOURCE,sourceOrg:"Government",collectedAt:AT,verifiedAt:AT,doorId:`ical:${bodyId}`}});
    const a=meeting("ical:first-live",first,"2026-10-22T17:00:00Z"),b=meeting("ical:second-live",second,"2026-10-23T17:00:00Z");
    const oldA=meeting("ical:first-history",first,"2020-10-22T17:00:00Z"),oldB=meeting("ical:second-history",second,"2020-10-23T17:00:00Z");
    const doc=(row:Meeting)=>({id:`agenda:${row.id}`,meetingId:row.id,documentUrl:row.agendaUrl,text:`All original agenda words for ${row.id} α𐐀`,sourceOrg:"Government",extraction:"html",collectedAt:AT,retrievedAt:AT});
    const snapshot=(rows:Meeting[])=>({formatVersion:1,generatedAt:AT,meetings:rows,agendaDocuments:rows.map(doc),sources:[],counts:{fresh:rows.length,carried:0,total:rows.length},
      derivedMembers:[first,second].map(bodyId=>({id:`ical:${bodyId}`,source:"ical",bodyId,status:"ACTIVE",outcome:"FRESH"}))});
    let serial=0;
    const put=async(scope:string,value:unknown)=>{const encoded=partitionCivicPayload(value);for(const part of encoded.parts)await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
      await db.query(`INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,$5) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,current_version_id=excluded.current_version_id`,
        [`MEETING:${scope}`,scope,JSON.stringify(encoded.value),AT,`body-version-${++serial}`]);};
    const family=derivedMeetingFamilyScope("US-AZ"),bodyScope=meetingPartitionScope("derived~US-AZ",first);
    await put(family,snapshot([a,b]));await put(`${family}:history`,snapshot([oldA,oldB]));
    const input={state:"AZ",divisionIds:[],bodyIds:[first,second],includeHistory:true,includeAgenda:true};
    const baseline=await buildPlacePackage(input,db.query);
    assert.deepEqual(baseline.meetings.map(row=>row.id).sort(),[a.id,b.id,oldA.id,oldB.id].sort());
    const changed={...a,title:"New verified first-body title"},own={...snapshot([changed]),derivedMembers:snapshot([changed]).derivedMembers.filter(member=>member.bodyId===first)};
    await put(bodyScope,own);
    const after=await buildPlacePackage(input,db.query);
    assert.equal(after.meetings.find(row=>row.id===a.id)?.title,changed.title);
    assert.deepEqual(after.bodySnapshots[second].meetings,baseline.bodySnapshots[second].meetings,"another government's meetings stay exactly as shown before cutover");
    assert.deepEqual(after.snapshot.agendaDocuments.map(row=>[row.id,row.text]).sort(),baseline.snapshot.agendaDocuments.map(row=>[row.id,row.text]).sort());
    assert.deepEqual(after.meetings.find(row=>row.id===a.id)?.provenance,a.provenance,"native member source/door evidence stays attached");
    await put(bodyScope,{...own,meetings:[],agendaDocuments:[],counts:{fresh:0,carried:0,total:0}});
    const empty=await buildPlacePackage(input,db.query);
    assert.equal(empty.meetings.some(row=>row.id===a.id),false,"an accepted empty body edition overrides the old live family body");
    assert.deepEqual(empty.meetings.map(row=>row.id).sort(),[b.id,oldA.id,oldB.id].sort(),"all independently held historical facts and other bodies remain visible");
  }finally{await db.pg.close();}
});
