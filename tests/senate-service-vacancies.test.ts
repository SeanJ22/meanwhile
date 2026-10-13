import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseSenateServiceTable } from "../lib/sources/official-rosters/senate-vacancies.ts";
import { parseSenateRoster, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL } from "../lib/sources/official-rosters/federal.ts";

const root=new URL("./fixtures/official-rosters/",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("senate-service-sources.json",root),"utf8")) as {sources:{file:string;url:string;retrievedAt:string;sha256:string;bytes:number}[]};
const document=(state:string)=>{
  const metadata=manifest.sources.find(row=>row.url.includes(`/states/${state}/`))!;
  return {...metadata,body:readFileSync(new URL(metadata.file,root),"utf8")};
};
const federalManifest=JSON.parse(readFileSync(new URL("federal-sources.json",root),"utf8")) as typeof manifest;
const federalDocument=(url:string)=>{
  const metadata=federalManifest.sources.find(row=>row.url===url)!;
  return {...metadata,body:readFileSync(new URL(metadata.file,root),"utf8")};
};
const xml=federalDocument(SENATE_ROSTER_URL),appointments=federalDocument(SENATE_APPOINTMENTS_URL);
const memberRow=(bioguide:string)=>[...xml.body.matchAll(/<member>[\s\S]*?<\/member>/g)].find(row=>row[0].includes(`<bioguide_id>${bioguide}</bioguide_id>`))![0];
test("the supplemental Senate service fixtures retain their exact official bytes and retrieval dates",()=>{
  for(const source of manifest.sources){const bytes=readFileSync(new URL(source.file,root));assert.equal(createHash("sha256").update(bytes).digest("hex"),source.sha256);assert.equal(bytes.length,source.bytes);}
});
test("Florida's real 2025 vacancy and appointment use exact source Bioguide IDs and class three",()=>{
  const source=document("FL"),vacant=parseSenateServiceTable(source,"2025-01-20T23:00:00Z");
  assert.equal(vacant.vacancies.length,1);assert.equal(vacant.vacancies[0]!.id,"US:sen:FL:3");assert.equal(vacant.vacancies[0]!.since,"2025-01-20");
  assert.equal(vacant.vacancies[0]!.provenance.collectedAt,source.retrievedAt);
  assert.ok(vacant.endedMemberships.some(row=>row.personId==="congress:R000595" && row.termEnd==="2025-01-20"));
  const appointed=parseSenateServiceTable(source,"2025-01-21T23:00:00Z");
  assert.equal(appointed.vacancies.length,0);assert.ok(appointed.seats.some(row=>row.bioguide==="M001244" && row.officeId==="US:sen:FL:3" && row.present));
});
test("Ohio's real eleven-day vacancy does not retire the state's other Senate class",()=>{
  const source=document("OH"),vacant=parseSenateServiceTable(source,"2025-01-15T23:00:00Z");
  assert.deepEqual(vacant.vacancies.map(row=>[row.id,row.since]),[["US:sen:OH:3","2025-01-10"]]);
  assert.ok(vacant.endedMemberships.some(row=>row.personId==="congress:V000137" && row.officeId==="US:sen:OH:3" && row.termEnd==="2025-01-10"));
  assert.ok(vacant.seats.some(row=>row.bioguide==="M001242" && row.officeId==="US:sen:OH:1" && row.present));
  assert.equal(parseSenateServiceTable(source,"2025-01-21T23:00:00Z").vacancies.length,0);
});
test("a partial senators list can publish an exact service-table vacancy while preserving the other occupied class",()=>{
  const moreno=memberRow("M001242");
  const roster=parseSenateRoster([{url:SENATE_ROSTER_URL,body:`<contact_information>${moreno}</contact_information>`,retrievedAt:document("OH").retrievedAt},document("OH")],"2025-01-15T23:00:00Z");
  assert.equal(roster.officeholders.length,1);assert.equal(roster.officeholders[0]!.id,"congress:M001242");
  assert.equal(roster.vacancies?.[0]?.id,"US:sen:OH:3");assert.equal(roster.vacancies?.[0]?.since,"2025-01-10");
  assert.equal(roster.currentMembershipComplete,false);
});
test("Florida's service-table successor replaces an exact departed XML predecessor with fresh minimum facts",()=>{
  const service=document("FL"),evidence=parseSenateServiceTable(service,service.retrievedAt);
  const departed=evidence.endedMemberships.find(row=>row.personId==="congress:R000595" && row.officeId==="US:sen:FL:3")!;
  // Replay the real official roster with its class-three identity lagging at
  // the source-documented predecessor; optional XML fields deliberately lag too.
  const moodyRow=memberRow("M001244");
  const predecessorRow=moodyRow.replace("M001244","R000595").replace(/<first_name>[\s\S]*?<\/first_name>/,"<first_name>Marco</first_name>")
    .replace(/<last_name>[\s\S]*?<\/last_name>/,"<last_name>Rubio</last_name>");
  const roster=parseSenateRoster([{...xml,body:xml.body.replace(moodyRow,predecessorRow)},appointments,service],"2026-10-14T00:00:00Z");
  const moody=roster.officeholders.find(row=>row.id==="congress:M001244")!;
  assert.ok(moody);assert.equal(moody.name,"Ashley Moody");assert.equal(moody.memberships?.[0]?.officeId,"US:sen:FL:3");
  assert.equal(moody.termStart,"2025-01-21");assert.equal(moody.memberships?.[0]?.termStart,"2025-01-21");
  assert.equal(moody.provenance.sourceUrl,service.url);assert.equal(moody.provenance.collectedAt,service.retrievedAt);
  assert.equal(moody.fieldSources?.termStart?.sourceUrl,SENATE_APPOINTMENTS_URL);
  assert.equal(moody.fieldSources?.termStart?.collectedAt,appointments.retrievedAt);
  assert.match(moody.provenance.evidenceExcerpt!,/Ashley Moody \(R\).*Jan\. 21, 2025.*Present/);
  for(const value of [moody.partyLabel,moody.phone,moody.websiteUrl,moody.contactFormUrl,moody.photo])assert.equal(value,null);
  assert.ok(!roster.officeholders.some(row=>row.id===departed.personId));
  assert.ok(roster.endedMemberships?.some(row=>row.personId===departed.personId && row.officeId===departed.officeId && row.termEnd==="2025-01-20"));
  assert.ok(!roster.divisions.some(row=>row.officeholderId===departed.personId));
  assert.deepEqual(roster.officeholders.find(row=>row.id==="congress:S001217"),parseSenateRoster([xml,appointments],service.retrievedAt).officeholders.find(row=>row.id==="congress:S001217"));
  assert.equal(roster.currentMembershipComplete,true);assert.equal(roster.officeholders.length,100);
  // An XML occupant already newer than the departure retains its own facts.
  const unchanged=parseSenateRoster([xml,appointments,service],service.retrievedAt);
  assert.deepEqual(unchanged.officeholders.find(row=>row.id===moody.id),parseSenateRoster([xml,appointments],service.retrievedAt).officeholders.find(row=>row.id===moody.id));
});
test("Ohio's dated service-table appointment closes a stale explicit XML vacancy without retiring the other class",()=>{
  const service=document("OH"),hustedRow=memberRow("H001104");
  // Only the source's class-three occupant is blanked to reproduce an XML
  // vacancy lag; the successor and its service dates come from saved HTML.
  const vacantRow=hustedRow.replace(/<bioguide_id>[\s\S]*?<\/bioguide_id>/,"<bioguide_id></bioguide_id>")
    .replace(/<first_name>[\s\S]*?<\/first_name>/,"<first_name>Vacant</first_name>")
    .replace(/<last_name>[\s\S]*?<\/last_name>/,"<last_name></last_name>");
  const staleXml={...xml,body:xml.body.replace(hustedRow,vacantRow)};
  const roster=parseSenateRoster([staleXml,appointments,service],"2026-10-14T00:00:00Z");
  const husted=roster.officeholders.find(row=>row.id==="congress:H001104")!;
  assert.ok(husted);assert.equal(husted.name,"Jon Husted");assert.equal(husted.memberships?.[0]?.officeId,"US:sen:OH:3");
  assert.equal(husted.provenance.sourceUrl,service.url);assert.equal(husted.provenance.collectedAt,service.retrievedAt);
  assert.equal(husted.fieldSources?.termStart?.collectedAt,appointments.retrievedAt);assert.equal(husted.termStart,"2025-01-21");
  assert.ok(!roster.vacancies?.some(row=>row.id==="US:sen:OH:3"));
  assert.ok(!roster.officeholders.some(row=>row.id==="congress:V000137"));
  assert.ok(roster.endedMemberships?.some(row=>row.personId==="congress:V000137" && row.officeId==="US:sen:OH:3" && row.termEnd==="2025-01-10"));
  assert.deepEqual(roster.officeholders.find(row=>row.id==="congress:M001242"),parseSenateRoster([xml,appointments],service.retrievedAt).officeholders.find(row=>row.id==="congress:M001242"));
  assert.equal(roster.currentMembershipComplete,true);assert.equal(roster.officeholders.length,100);
  const serviceOnlyDate=parseSenateRoster([staleXml,service],"2026-10-14T00:00:00Z").officeholders.find(row=>row.id===husted.id)!;
  assert.equal(serviceOnlyDate.termStart,"2025-01-21", "the service table's own term-began date remains usable without the appointment table");
  // During the documented gap the independently identified later XML occupant
  // is already authoritative; older historical evidence cannot erase it.
  const duringGap=parseSenateRoster([xml,appointments,service],"2025-01-15T23:00:00Z");
  assert.ok(duringGap.officeholders.some(row=>row.id===husted.id));assert.ok(!duringGap.vacancies?.some(row=>row.id==="US:sen:OH:3"));
  const fresherVacancy=parseSenateRoster([{...staleXml,retrievedAt:"2026-10-14T00:00:00Z"},appointments,service],"2026-10-14T00:00:00Z");
  assert.ok(fresherVacancy.vacancies?.some(row=>row.id==="US:sen:OH:3"),"an older unchanged service table cannot close a newer XML vacancy");
});
