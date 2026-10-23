import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { factDb } from "./helpers/fact-db.ts";
import { canonicalSubject, ensureGoverningBody, learnDoorChannel } from "../lib/facts/entities.ts";
import { nameKey, publishBodyFacts, publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { publishCommentFacts } from "../lib/facts/comment-facts.ts";
import { publishMeetingFacts } from "../lib/facts/meeting-facts.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { readFactCommentAccess } from "../lib/facts/comment-read.ts";
import { meetingEntityId } from "../lib/facts/meeting-read.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readHeldRoster } from "../lib/civic-data/worker-held-roster.ts";
import { importCartonComments, importCartonOffices, importCartonRosters } from "../lib/facts/carton-import.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { Body } from "../lib/registry/types.ts";
import type { Meeting } from "../lib/sources/types.ts";

const PLACE = "ocd-division/country:us/state:az/place:tucson";
const CANONICAL = `${PLACE}#tucson-convention-center-commission`;
const ALIAS = "curated:az/tucson-convention-center-commission#governing";
const NAME = "Tucson Convention Center Commission";
const URL = "https://clerksboards.tucsonaz.gov/boards/15";
const CLOCKS = factClocks(null);
const TODAY = "2026-08-14T19:00:00Z", TOMORROW = "2026-08-15T19:00:00Z";
const BODY = { id: CANONICAL, name: NAME, state: "AZ", parentId: PLACE };
const STALE_BODY = { ...BODY, id: ALIAS, state: "OR", parentId: "ocd-division/country:us/state:or" };
const PAGE = readFileSync(new globalThis.URL("./fixtures/clerksboards/b15.html", import.meta.url), "utf8");
const rows = (page: string) => readHeldRoster(page, URL)!.rows.map((row, i) => ({ recordId: `native-row:${i}`,
  fields: Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) }));
function capture(text: string, at: string): WorkerPublicationCapture {
  const hash = createHash("sha256").update(text).digest("hex");
  return { evidence: { artifactId: `ar-${hash.slice(0, 24)}`, contentHash: `sha256-${hash}`, text,
    acquiredByAttemptId: "roster-refresh", canonicalUrl: URL, retrievedAt: at, sourceId: "clerksboards.tucsonaz.gov", methodRouteId: "scheduled" },
    observedAt: at, httpStatus: 200, transport: "REACHABLE", partial: false };
}
async function seeded() {
  const db = await factDb();
  await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Tucson','AZ',NULL),($2,'body',$3,'AZ',$1)", [PLACE,CANONICAL,NAME]);
  await db.query("INSERT INTO entity_place VALUES($1,$2)",[CANONICAL,PLACE]);
  await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'clerksboards.tucsonaz.gov')",[CANONICAL]);
  await db.query("INSERT INTO entity_external_id VALUES($1,'body-alias',$2)",[CANONICAL,ALIAS]);
  return db;
}

test("tomorrow's roster refresh through a retired board id preserves people, source ids, departures and blanks on the surviving board", async () => {
  const db = await seeded();
  try {
    const members = rows(PAGE), shown = new Map(members.map((row,i) => [nameKey(String(row.fields.name)),`native-member:${i}`]));
    const first = await publishRosterFacts(db,{body:BODY,capture:capture(PAGE,TODAY),members,shownMemberIds:shown,complete:true,producedBy:"scheduled"},CLOCKS,new Date(TODAY));
    await db.query("UPDATE entity_external_id SET scheme=$2 WHERE scheme=$1",["roster-name:"+CANONICAL,"roster-name:"+ALIAS]);
    const without = PAGE.replace(/<tr>(?:(?!<\/tr>)[\s\S])*Ronnie Reyna[\s\S]*?<\/tr>/, "");
    const later = await publishRosterFacts(db,{body:STALE_BODY,capture:capture(without,TOMORROW),members:[...rows(without),{recordId:"native-navigation",fields:{name:"Actions"}}],
      complete:true,producedBy:"scheduled"},CLOCKS,new Date(TOMORROW));
    assert.equal(later.departed,1); assert.equal(later.blanks,1);
    assert.ok([...later.people.values()].every(id => [...first.people.values()].includes(id)),"a body alias cannot mint new people");
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=$1",[ALIAS]),[]);
    assert.deepEqual(await db.query("SELECT DISTINCT state FROM entity WHERE kind='person'"),[{state:"AZ"}],"the obsolete writer's state cannot move people");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE kind='person'"))[0]!.n,4);
    assert.deepEqual(await db.query("SELECT entity_id,field FROM blank"),[{entity_id:CANONICAL,field:"member-row:native-navigation"}]);
    const [roster] = (await readFactRosters(db.query,[CANONICAL])).rosters;
    assert.equal(roster!.members.length,3);
    assert.ok(roster!.members.every(member => [...shown.values()].includes(member.id)),"published source-member links keep their original identities");
    assert.deepEqual(await db.query("SELECT field FROM fact WHERE field LIKE $1",[`%:${ALIAS}`]),[],"body-scoped person fields use the surviving board");
    await learnDoorChannel(db.query,ALIAS,"https://webapi.legistar.com/v1/fixture/officerecords");
    assert.ok((await db.query("SELECT 1 FROM entity_host WHERE entity_id=$1 AND host='webapi.legistar.com/v1/fixture'",[CANONICAL])).length);
  } finally { await db.pg.close(); }
});

test("retired ids publish comments, office contacts and meetings on their canonical board and local place", async () => {
  const db = await seeded();
  try {
    const text = `${NAME}. Regular Commission Meeting 2026-08-15T18:00:00-07:00. Public comment is three minutes per speaker. Office phone 520-555-0111.`;
    const saved = capture(text,TOMORROW);
    const comments = await publishCommentFacts(db,{body:STALE_BODY,capture:saved,reading:{fields:{commentPeriod:"YES",timeLimit:"three minutes"}},producedBy:"scheduled"},CLOCKS,new Date(TOMORROW));
    assert.ok(comments.every(outcome => "decision" in outcome));
    const [rules] = await readFactCommentAccess(db.query,[CANONICAL]);
    assert.equal(rules!.commentPeriod,"YES"); assert.equal(rules!.timeLimit,"three minutes");
    const offices = await publishBodyFacts(db,{bodyId:ALIAS,capture:saved,producedBy:"scheduled",facts:[{field:"office_phone",value:"520-555-0111",quote:"520-555-0111"}]},CLOCKS,new Date(TOMORROW));
    assert.ok(offices.every(outcome => "decision" in outcome));
    const meeting: Meeting = {id:"native-meeting:123",bodyId:ALIAS,bodyName:NAME,ocdId:STALE_BODY.parentId,title:"Regular Commission Meeting",
      startsAt:"2026-08-15T18:00:00-07:00",timeZone:"America/Phoenix",location:null,agendaUrl:null,jurisdiction:"Local",status:"SCHEDULED",
      provenance:{sourceUrl:URL,sourceOrg:NAME,collectedAt:TOMORROW,verifiedAt:null}};
    const result = await publishMeetingFacts(db,{meeting,capture:saved,producedBy:"scheduled"},CLOCKS,new Date(TOMORROW));
    assert.equal(result.live,2);
    assert.deepEqual(await db.query("SELECT parent_id,state FROM entity WHERE id=$1",[meetingEntityId(meeting.id)]),[{parent_id:CANONICAL,state:"AZ"}]);
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1",[meetingEntityId(meeting.id)]),[{place_id:PLACE}]);
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=$1",[ALIAS]),[]);
    const neverMinted = "government:US-AK:cog:unused#board";
    await db.query("INSERT INTO entity_external_id VALUES($1,'body-alias',$2)",[CANONICAL,neverMinted]);
    assert.equal(await canonicalSubject(db.query,neverMinted),CANONICAL);
    assert.equal((await ensureGoverningBody(db.query,neverMinted))!.id,CANONICAL,"an alias target with a nonstandard board suffix remains the exact board");
  } finally { await db.pg.close(); }
});

test("blocked carton refreshes keep roster, comment and office work on the surviving board", async () => {
  const db = await seeded();
  try {
    const common = {facts:db,clocks:CLOCKS,repos:createMemoryRepositories(),vault:new MemoryEvidenceStore(),now:TOMORROW,
      fetch:async () => ({status:404,headers:{get:()=>null},bytes:async()=>new TextEncoder().encode("Not Found")})};
    await importCartonRosters({...common,state:"AZ",versionId:"tomorrow-roster",rosters:[{bodyId:ALIAS,bodyName:NAME,sourceUrl:URL,sourceOrg:NAME,collectedAt:TODAY,
      partisanship:"NONPARTISAN",members:[{id:"native-member:unread",name:"Ned Beman",officeTitle:"Chairperson",termNote:null,email:null,phone:null,websiteUrl:null}]}]});
    await importCartonComments({...common,versionId:"tomorrow-comment",records:[{bodyId:ALIAS,ocdId:PLACE,commentPeriod:"YES",commentPeriodDetail:null,signup:null,
      writtenComment:null,attend:null,timeLimit:null,sourceUrl:URL,collectedAt:TODAY,verifiedAt:null}]});
    const body: Body = {id:ALIAS,ocdId:PLACE,name:NAME,bodyClass:"ADVISORY_BODY",bodyOrigin:"SOURCED",coverageStatus:"NOT_ATTEMPTED",agendaSourceType:"NONE",
      agendaSourceRef:null,meetingCadence:null,homepageUrl:URL,officePhone:"520-555-0111",demandCount:0,sourceDataset:"GOV_DIRECTORY",
      provenance:{sourceUrl:URL,sourceOrg:NAME,collectedAt:TODAY,verifiedAt:null}};
    await importCartonOffices({...common,state:"AZ",versionId:"tomorrow-office",bodies:[body]});
    assert.deepEqual(await db.query("SELECT entity_id,field FROM blank ORDER BY field"),[
      {entity_id:CANONICAL,field:"comment:period"},{entity_id:CANONICAL,field:"member-row:native-member:unread"},{entity_id:CANONICAL,field:"office_phone"}]);
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=$1",[ALIAS]),[]);
  } finally { await db.pg.close(); }
});
