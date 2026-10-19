import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { derivedMeetingFamilyScope, meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { ReaderStatePackage } from "../lib/reader/state.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { factDb } from "./helpers/fact-db.ts";
import { EVERYDAY_ROUTING_POINTER } from "../lib/routing/everyday-data-plane.ts";
import { attemptsByFamily } from "../lib/registry/attempt-families.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";

const STATE = "ocd-division/country:us/state:az", COUNTY = `${STATE}/county:pima`, CITY = `${STATE}/place:tucson`;
const BODY = `${CITY}#governing`, COUNTY_BODY = `${COUNTY}#supervisors`, SPECIAL = "curated:az/pima/special";
const SOURCE = "https://tucsonaz.gov/council", AT = "2026-10-17T12:00:00.000Z";

const unrecorded = (recordClass: RoutineRecordClass,scope: string): Extract<CivicDataReadResult<never>,{kind:"NOT_RECORDED"}> => ({
  kind:"NOT_RECORDED",value:null,detail:"fixture",metadata:{recordClass,scope,sourceId:null,version:null,versionId:null,lastKnownGoodVersionId:null,
    sourceThrough:null,retrievedAt:null,promotedAt:null,stale:"UNKNOWN",staleAt:null},
});

async function canonicalTables(db: Awaited<ReturnType<typeof factDb>>) {
  await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb,promoted_at timestamptz,current_version_id text);
    CREATE TABLE cp_work_items(id text PRIMARY KEY,value jsonb);
    CREATE INDEX cp_work_items_publication_body ON cp_work_items ((value #>> '{autonomousPlan,publication,bodyId}'));
    CREATE TABLE civic_data_candidate_events(candidate_id text,detail text,sequence bigint);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,retrieved_at timestamptz,candidate jsonb,state text,
      acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,validation_receipt jsonb)`);
  const functions = readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint")
    .filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
  for (const sql of functions) await db.pg.exec(sql);
}

test("one indexed place read joins local facts and complete calendars from any source without installed adapters or copied documents", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    await db.pg.exec(readFileSync(new URL("../lib/db/migrations/RS-01_place_reads.sql",import.meta.url),"utf8"));
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
    const result = await readPlacePackage({state:"az",divisionIds:[CITY,COUNTY],includeAgenda:true},async (sql,params) => {calls++;return db.query(sql,params);});
    assert.equal(calls,1);
    assert.equal(result.registrationHeld,true);
    assert.deepEqual(result.divisions,[division]);
    assert.equal(result.governments.length,2);
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
    const history = await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[BODY],includeHistory:true},db.query);
    assert.equal(history.meetings.some(m => m.id === "past-sitting"),true);
    const all = await readPlacePackage({state:"AZ",divisionIds:[],allBodies:true},db.query);
    assert.ok(all.bodies.some(b => b.id === `${STATE}#executive`),"state streaming includes bodies outside the current ZIP");
    await fact(BODY,"office_address","255 W Alameda Street");
    const next = await readPlacePackage({state:"AZ",divisionIds:[CITY,COUNTY]},db.query);
    assert.equal(next.bodies.find(b => b.id === BODY)?.fields.officeAddress,"255 W Alameda Street","freshly published facts are read without a repack");
    assert.deepEqual(next.snapshot.agendaDocuments,[],"map loads exclude full agenda text while keeping each meeting's agenda link");
    assert.equal(next.meetings.find(m => m.id === "existing")?.agendaUrl,held.agendaUrl);
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
      const result = await readPlacePackage({state,divisionIds:[],bodyIds:[bodyId]},db.query);
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
      assert.deepEqual(coverage.bodies.map(b => [b.bodyId,b.name,b.agendaSourceRef]),[[bodyId,"Planning Board",SOURCE]],"the existing body-card model receives the independently sourced body");
    }
  } finally { await db.pg.close(); }
});

test("held history reads retain verified old calendar rows and agenda text from canonical source versions", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    const bodyId = `${CITY}#historic-board`, scope = meetingPartitionScope("ical",bodyId);
    const old: Meeting = {id:"ical:retained-old-calendar",bodyId,ocdId:CITY,bodyName:"Board",title:"Public hearing",startsAt:"2020-06-18T20:00:00Z",timeZone:"UTC",
      location:null,venueGap:{kind:"STATED_NOT_PLACED",publisher:"Town Clerk",publishedText:"Library room"},agendaUrl:null,status:"CONCLUDED",jurisdiction:"Town",
      provenance:{sourceUrl:SOURCE,sourceOrg:"Town Clerk",collectedAt:AT,verifiedAt:AT}};
    const live = {...old,id:"ical:still-held",title:"Current verified title"};
    const document = {id:"past-agenda",meetingId:old.id,text:"Meeting agenda ".repeat(3000)};
    const prior = {formatVersion:1,generatedAt:AT,meetings:[old,{...live,title:"Older title"},{...old,id:"ical:elsewhere",bodyId:"another-body"}],agendaDocuments:[document],sources:[],counts:{fresh:3,carried:0,total:3,duplicatesCollapsed:0}};
    const current = {...prior,meetings:[live],agendaDocuments:[]};
    const encoded = partitionCivicPayload(prior);
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    const candidate = async (id: string,payload: unknown,state = "PROMOTED") => {
      const receipt = {decision:"GOOD",candidateId:id,recordClass:"MEETING",scope,sourceId:"meeting-source"};
      await db.query("INSERT INTO civic_data_candidates VALUES($1,'MEETING',$2,'meeting-source',$3,$4,$5,true,$1,$1,$6,$7)",
        [id,scope,AT,JSON.stringify({readModel:payload}),state,canonicalCivicDataHash(id === "old-version" ? prior : current),JSON.stringify(receipt)]);
    };
    await candidate("old-version",encoded.value);
    await candidate("current-version",current);
    await candidate("never-published",{...prior,meetings:[{...old,id:"ical:not-verified"}]},"VALIDATED");
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,'current-version')",[`MEETING:${scope}`,scope,JSON.stringify(current),AT]);
    const shown = await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[bodyId]},db.query);
    assert.deepEqual(shown.meetings.map(m => m.id),[live.id],"cold map loads do not scan historical candidates");
    let calls = 0;
    const held = await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[bodyId],includeHistory:true,includeAgenda:true},async(sql,params) => {calls++;return db.query(sql,params);});
    assert.equal(calls,1);
    assert.deepEqual(held.meetings.map(m => m.id).sort(),[old.id,live.id].sort());
    assert.deepEqual(held.meetings.find(m => m.id === old.id),old);
    assert.equal(held.meetings.find(m => m.id === live.id)?.title,live.title,"live source rows take precedence over prior versions");
    assert.deepEqual(held.snapshot.agendaDocuments,[document]);
  } finally { await db.pg.close(); }
});

test("a place transfers only its family meetings and opens its encoded agenda text on request", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    const siblingBody = `${CITY}#elsewhere`;
    const held: Meeting = {id:"ical:own",bodyId:BODY,ocdId:CITY,bodyName:"Mayor and Council",title:"Public hearing",
      startsAt:"2026-10-21T18:00:00-07:00",timeZone:"America/Phoenix",location:null,agendaUrl:"https://tucsonaz.gov/agenda",
      jurisdiction:"Tucson, AZ",status:"SCHEDULED",provenance:{sourceUrl:SOURCE,sourceOrg:"Tucson",collectedAt:AT,verifiedAt:AT},
      carried:{source:"ical",lastFreshAt:AT}};
    const unowned = {...held,id:"ical:elsewhere",bodyId:siblingBody,title:"ELSEWHERE ".repeat(6000)};
    const document = {id:"own-agenda",meetingId:held.id,text:"OWN AGENDA ".repeat(6000)};
    const sources = [{source:"ical",ok:false,error:"Calendar unavailable",failure:"WALL",fetched:0,normalized:0,
      drops:{placeless:0,unknownVenue:0,unplaceableInTime:0,notConfigured:0},carriedForward:2}];
    const member = {id:`ical:${BODY}`,source:"ical",bodyId:BODY,status:"ACTIVE",outcome:"HELD",detail:"Calendar unavailable"};
    const family = {formatVersion:1,generatedAt:AT,meetings:[held,unowned],agendaDocuments:[document,
      {id:"elsewhere-agenda",meetingId:unowned.id,text:"ELSEWHERE AGENDA ".repeat(6000)}],sources,
      counts:{fresh:0,carried:2,total:2,duplicatesCollapsed:0},carriedSummary:{count:2,lastFreshAt:AT},
      derivedMembers:[member,{...member,id:`ical:${siblingBody}`,bodyId:siblingBody,detail:"ELSEWHERE MEMBER ".repeat(6000)}]};
    const scope = derivedMeetingFamilyScope("US-AZ");
    const encoded = partitionCivicPayload(family);
    assert.ok(encoded.parts.length > 10,"fixture uses encoded root, collection and text parts");
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,'family-version')",
      [`MEETING:${scope}`,scope,JSON.stringify(encoded.value),AT]);
    let wire = "", calls = 0;
    const cold = await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[BODY]},async(sql,params) => {
      calls++;
      const rows = await db.query(sql,params);
      wire = JSON.stringify(rows);
      const payload = (rows[0].meeting_rows as {payload:Record<string,unknown>}[])[0].payload;
      assert.deepEqual(payload.carriedSummary,family.carriedSummary,"the family freshness summary survives selection");
      assert.deepEqual(payload.sources,sources,"source attribution survives selection");
      assert.deepEqual(payload.derivedMembers,[member],"only this body's source outcome crosses the database connection");
      return rows;
    });
    assert.equal(calls,1);
    assert.ok(Buffer.byteLength(wire)<12_000,`cold place transfer was ${Buffer.byteLength(wire)} bytes`);
    assert.equal(wire.includes("ELSEWHERE"),false,"unrelated meeting, agenda and source-member parts stay at the database");
    assert.equal(wire.includes("OWN AGENDA"),false,"even an encoded root does not transfer agenda text before it is opened");
    assert.deepEqual(cold.meetings.map(meeting => meeting.id),[held.id]);
    assert.deepEqual(cold.meetings[0].carried,held.carried);
    assert.deepEqual(cold.snapshot.agendaDocuments,[]);
    assert.equal(cold.snapshot.sources[0].error,member.detail);
    assert.equal(cold.snapshot.sources[0].carriedForward,1);
    const opened = await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[BODY],includeAgenda:true},async(sql,params) => {
      const rows = await db.query(sql,params);
      assert.equal(JSON.stringify(rows).includes("ELSEWHERE"),false,"opening an agenda still reads only this body");
      return rows;
    });
    assert.deepEqual(opened.snapshot.agendaDocuments,[document]);
    assert.equal(opened.meetings[0].agendaUrl,held.agendaUrl);
  } finally { await db.pg.close(); }
});

test("one place query preserves source-only bodies, local runtime records and their calendars without a state read", async () => {
  const db = await factDb();
  try {
    await canonicalTables(db);
    const elsewhere = `${STATE}/place:elsewhere`, elsewhereBody = `${elsewhere}#governing`;
    const member = {id:`roster:${BODY}#1`,personId:"person:local",sourceRecordId:"source:local",nativeIds:{official:["alias:local"]},
      name:"Jane Mayor",officeTitle:"Mayor",phone:"520-555-0123",email:"mayor@tucsonaz.gov",websiteUrl:SOURCE,termNote:"Through 2028",
      membershipSource:{sourceUrl:SOURCE,sourceOrg:"Tucson",collectedAt:AT},fieldSources:{phone:{sourceUrl:SOURCE,sourceOrg:"Tucson",collectedAt:AT,verifiedAt:AT}}};
    const specialMember = {...member,id:`roster:${SPECIAL}#1`,personId:"person:special",sourceRecordId:"source:special",nativeIds:{official:["alias:special"]}};
    const body = {id:BODY,ocdId:CITY,name:"Mayor and Council",homepageUrl:SOURCE,officePhone:"520-555-0123",officeAddress:"City Hall",
      provenance:{sourceUrl:SOURCE,sourceOrg:"Tucson",collectedAt:AT,verifiedAt:AT},fieldSources:{officePhone:member.fieldSources.phone}};
    const special = {...body,id:SPECIAL,ocdId:COUNTY,name:"Water district"};
    const roster = {bodyId:BODY,bodyName:body.name,members:[member],sourceUrl:SOURCE,sourceOrg:"Tucson",collectedAt:AT,partisanship:"NONPARTISAN"};
    const specialRoster = {...roster,bodyId:SPECIAL,bodyName:special.name,members:[specialMember]};
    const eligible = {sourceId:member.id,canonicalId:member.id,state:"READER_ELIGIBLE",reason:"Sourced member"};
    const unresolved = {...eligible,sourceId:`roster:${BODY}#missing`,canonicalId:null,state:"IDENTITY_UNRESOLVED",reason:"The published slot is still unresolved"};
    const candidacy = {holder:{id:member.id,name:member.name,officeTitle:"Mayor",divisions:[CITY],authority:"REGISTRY_BODY_ROSTER",sourceUrl:SOURCE},
      status:"NOT_CHECKED",candidacy:null,reason:"Not yet checked",unresolvedCandidacyIds:[]};
    const photo = {officeholderId:"alias:local",personId:member.personId,name:member.name,url:"/officials/mayor.jpg",sourceUrl:SOURCE,license:"CC0",collectedAt:AT};
    const localDivision = {ocdId:CITY,parentOcdId:STATE,label:"Tucson",divisionType:"place",state:"AZ",provenance:body.provenance};
    const countyDivision = {...localDivision,ocdId:COUNTY,label:"Pima"}, stateDivision = {...localDivision,ocdId:STATE,parentOcdId:"ocd-division/country:us",label:"Arizona"};
    const runtime = {formatVersion:1,registry:{generatedAt:AT,divisions:[localDivision,countyDivision,stateDivision,{...localDivision,ocdId:elsewhere,label:"ELSEWHERE"}],
      bodies:[body,special,{...body,id:elsewhereBody,ocdId:elsewhere,name:"ELSEWHERE ".repeat(6000)}]},
      bodyRosters:[roster,specialRoster,{...roster,bodyId:elsewhereBody,members:[{...member,id:"elsewhere-member",name:"ELSEWHERE ".repeat(6000)}]}],
      rosterReaderDispositions:[eligible,unresolved,{...eligible,sourceId:"elsewhere-member",canonicalId:"elsewhere-member"}],statewideExecutives:[],
      officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[candidacy,{...candidacy,holder:{...candidacy.holder,id:"elsewhere-member",divisions:[elsewhere]}}]},
      officialPhotos:{photos:[photo,{...photo,officeholderId:"elsewhere-member",personId:"elsewhere-member",name:"ELSEWHERE"}]},
      rosterPhotos:{[member.id]:photo.url,"elsewhere-member":"/officials/elsewhere.jpg"}};
    const encoded = partitionCivicPayload(runtime);
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'REGISTRY_RUNTIME_BINDING',$2,$3,$4,'runtime-version')",
      ["REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime","US-AZ:reader-registry-runtime",JSON.stringify(encoded.value),AT]);
    const routing = {kind:"everyday-routing",formatVersion:1,denominator:{zips:["85701"]},records:[{id:"local-route",sourceUrl:SOURCE}]};
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'CURATED_READER_RECORD',$2,$3,$4,'routing-version')",
      [`${EVERYDAY_ROUTING_POINTER.recordClass}:${EVERYDAY_ROUTING_POINTER.scope}`,EVERYDAY_ROUTING_POINTER.scope,JSON.stringify(routing),AT]);
    const attempt = (id:string,at:string,status:string,accepted:unknown,bodyId = BODY) => db.query("INSERT INTO cp_work_items VALUES($1,$2)",[id,JSON.stringify({
      autonomousPlan:{publication:{bodyId,contractId:"comment-access"},contract:{schemaVersion:2,sourceScope:{canonicalUrls:[SOURCE]}}},
      publicationOutcome:{at,status,code:status,versionId:status==="HELD"?null:"published-version",...accepted as object}})]);
    await attempt("older-good","2026-10-16T12:00:00.000Z","PUBLISHED",{acceptedMembers:[{recordId:"one",memberId:"member-one"}],acceptedRecordIds:["a","b"],bodyIds:[BODY,SPECIAL]});
    await attempt("newer-held",AT,"HELD",{});
    await attempt("elsewhere",AT,"PUBLISHED",{acceptedRecordIds:["ELSEWHERE"]},elsewhereBody);
    const meeting = {id:"ical:source-only",bodyId:BODY,ocdId:CITY,bodyName:body.name,title:"Public hearing",startsAt:"2026-10-21T18:00:00-07:00",
      timeZone:"America/Phoenix",location:null,agendaUrl:SOURCE,jurisdiction:"Tucson, AZ",status:"SCHEDULED",provenance:body.provenance};
    const family = {formatVersion:1,generatedAt:AT,meetings:[meeting,{...meeting,id:"ical:special",bodyId:SPECIAL,bodyName:special.name},
      {...meeting,id:"ical:elsewhere",bodyId:elsewhereBody}],agendaDocuments:[],sources:[],counts:{fresh:3,carried:0,total:3}};
    const scope = derivedMeetingFamilyScope("US-AZ");
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$4,'family-version')",
      [`MEETING:${scope}`,scope,JSON.stringify(family),AT]);
    let calls = 0;
    const result = await readPlacePackage({state:"AZ",divisionIds:[CITY],bodyIds:[SPECIAL]},async(sql,params) => {
      calls++;const rows = await db.query(sql,params);
      assert.equal(JSON.stringify(rows).includes("ELSEWHERE"),false,"unrelated runtime records remain in the store");
      return rows;
    });
    assert.equal(calls,1);
    assert.deepEqual(result.bodies.map(row => row.id).sort(),[BODY,SPECIAL].sort(),"registry bodies are selected even without fact-store entity rows");
    assert.deepEqual(result.meetings.map(row => row.id).sort(),["ical:source-only","ical:special"]);
    assert.deepEqual(result.registry?.registry,{generatedAt:AT,bodies:[body,special],divisions:[localDivision,countyDivision,stateDivision]});
    assert.deepEqual(result.registry?.bodyRosters,[roster,specialRoster]);
    assert.deepEqual(result.registry?.rosterReaderDispositions,[eligible,unresolved]);
    assert.deepEqual(result.registry?.officialCandidacies,{...runtime.officialCandidacies,rows:[candidacy]});
    assert.deepEqual(result.registry?.officialPhotos,{photos:[photo]});
    assert.deepEqual(result.registry?.rosterPhotos,{[member.id]:photo.url});
    assert.deepEqual(result.everydayRouting,routing,"global routing accompanies the local answer without a state read");
    assert.equal(result.publicationAttempts.length,2,"only this body's original publication outcomes are read");
    const attempts = attemptsByFamily(result.publicationAttempts).meetings!;
    assert.equal(attempts.latest.status,"HELD");
    assert.equal(attempts.lastGood?.status,"PUBLISHED","a later held attempt does not hide the last successful publication");
    assert.equal(attempts.lastGood?.acceptedCount,1,"exact accepted members take precedence over legacy record and body counts");
    assert.equal(attempts.lastGood?.sourceUrl,SOURCE);
    assert.equal(attempts.publishedNow?.versionId,"published-version");
  } finally { await db.pg.close(); }
});

test("the map and ballot reuse one place read for their request, and a later request reads current data", async () => {
  const { installFactReader } = await import("../lib/facts/db.ts");
  let reads = 0, release: (() => void) | undefined;
  installFactReader(async () => {
    reads++;
    if (reads === 1) await new Promise<void>(resolve => { release = resolve; });
    return [{ registration_held: true, governments: [], divisions: [], entities: [], fields: [], rosters: [], comments: [], sittings: [],
      meeting_rows: [], archived_meetings: [], archived_documents: [], parts: {} }];
  });
  try {
    let first: Awaited<ReturnType<typeof readPlacePackage>> | undefined;
    await withReaderSelection({ keys: new Set(["85701"]), states: ["AZ"] }, async () => {
      const map = readPlacePackage({ state: "az", divisionIds: [CITY, COUNTY], bodyIds: [BODY] });
      const ballot = readPlacePackage({ state: "AZ", divisionIds: [COUNTY, CITY, CITY], bodyIds: [BODY] });
      assert.equal(map, ballot);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reads, 1);
      release!();
      const [loaded, second] = await Promise.all([map, ballot]);
      first = loaded;
      assert.equal(first, second);
      assert.equal(await readPlacePackage({ state: "AZ", divisionIds: [COUNTY, CITY], bodyIds: [BODY] }), first);
      assert.equal(reads, 1);
    });
    const next = await withReaderSelection({ keys: new Set(["85701"]), states: ["AZ"] }, () =>
      readPlacePackage({ state: "AZ", divisionIds: [COUNTY, CITY], bodyIds: [BODY] }));
    assert.notEqual(next, first, "a settled place response cannot outlive its reader request after a data-tag purge");
    assert.equal(reads, 2);
  } finally { installFactReader(undefined); }
});

test("a shared cold place failure reaches both readers without a second query", async () => {
  const { installFactReader } = await import("../lib/facts/db.ts");
  const failure = new Error("First place read failed");
  let reads = 0, rejectRead: ((error: Error) => void) | undefined;
  installFactReader(async () => {
    reads++;
    await new Promise<void>((_resolve, reject) => { rejectRead = reject; });
    return [];
  });
  try {
    const first = readPlacePackage({ state: "AZ", divisionIds: [`${CITY}/bs01-failure`] });
    const second = readPlacePackage({ state: "AZ", divisionIds: [`${CITY}/bs01-failure`] });
    const outcomes = Promise.allSettled([first, second]);
    await new Promise(resolve => setImmediate(resolve));
    rejectRead!(failure);
    for (const result of await outcomes) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.equal(result.reason, failure);
    }
    assert.equal(reads, 1);
  } finally { installFactReader(undefined); }
});
