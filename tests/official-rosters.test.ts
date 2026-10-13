import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseHouseRoster, parseSenateRoster, parseSenateAppointments, HOUSE_ROSTER_URL,
  SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL } from "../lib/sources/official-rosters/federal.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/official-rosters/${name}`,import.meta.url),"utf8");
const AT = "2026-10-13T04:15:32.259Z";
const senate = () => [{url:SENATE_ROSTER_URL,body:fixture("senate-current.xml")},{url:SENATE_APPOINTMENTS_URL,body:fixture("senate-appointed.html")}];
const house = () => [{url:HOUSE_ROSTER_URL,body:fixture("house-current.xml")}];

test("OR-01 federal fixtures bind tests to exact unmodified official response bytes",()=>{
  const manifest=JSON.parse(fixture("federal-sources.json")) as {sources:{file:string;url:string;sha256:string;bytes:number;httpStatus:number;retrievedAt:string}[]};
  assert.equal(manifest.sources.length,3);
  for(const source of manifest.sources){
    const bytes=readFileSync(new URL(`./fixtures/official-rosters/${source.file}`,import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),source.sha256);
    assert.equal(bytes.length,source.bytes);assert.equal(source.httpStatus,200);
    assert.ok(Number.isFinite(Date.parse(source.retrievedAt)));
    assert.ok([SENATE_ROSTER_URL,SENATE_APPOINTMENTS_URL,HOUSE_ROSTER_URL].includes(source.url));
  }
});

test("real House resignation leaves an explicitly dated vacant seat and removes the departed holder",()=>{
  const roster=parseHouseRoster(house(),AT);
  assert.equal(roster.officeholders.length,439);assert.equal(roster.currentMembershipComplete,true);
  assert.deepEqual(roster.coveredChambers,["house"]);
  const vacancy=roster.vacancies?.find(row=>row.id==="US:rep:FL:20");
  assert.ok(vacancy);assert.equal(vacancy.since,"2026-04-21");
  assert.equal(vacancy.divisionId,"ocd-division/country:us/state:fl/cd:20");
  assert.equal(vacancy.provenance.sourceUrl,HOUSE_ROSTER_URL);
  assert.match(vacancy.provenance.evidenceExcerpt!,/resignation of Sheila Cherfilus-McCormick, April 21, 2026/);
  assert.ok(!roster.officeholders.some(row=>row.id==="congress:C001127"));
  assert.ok(roster.endedMemberships?.some(row=>row.personId==="congress:C001127" && row.officeId==="US:rep:FL:20" && row.termEnd==="2026-04-21"));
});

test("real 2025 Senate appointment is bound to an exact official identity and seat",()=>{
  const roster=parseSenateRoster(senate(),AT);
  assert.equal(roster.officeholders.length,100);assert.equal(roster.currentMembershipComplete,true);
  assert.deepEqual(roster.coveredChambers,["senate"]);
  const moody=roster.officeholders.find(row=>row.id==="congress:M001244");
  assert.ok(moody);assert.equal(moody.name,"Ashley Moody");assert.equal(moody.termStart,"2025-01-21");
  assert.equal(moody.memberships?.[0]?.officeId,"US:sen:FL:3");
  assert.equal(moody.provenance.sourceUrl,SENATE_ROSTER_URL);
  assert.equal(moody.fieldSources?.termStart?.sourceUrl,SENATE_APPOINTMENTS_URL);
  assert.equal(parseSenateAppointments(fixture("senate-appointed.html")).get("M001244")?.appointed,"2025-01-21");
  assert.equal(roster.officeholders.find(row=>row.id==="congress:M001153")?.termStart,"","an older appointment followed by an election is not the current term start");
});

test("official special-election successor replaces the predecessor in the exact House district",()=>{
  const roster=parseHouseRoster(house(),AT);
  const grijalva=roster.officeholders.find(row=>row.id==="congress:G000606");
  assert.ok(grijalva);assert.equal(grijalva.termStart,"2025-11-12");
  assert.equal(grijalva.memberships?.[0]?.officeId,"US:rep:AZ:7");
  assert.ok(!roster.officeholders.some(row=>row.id==="congress:G000551"));
  assert.ok(!roster.vacancies?.some(row=>row.id==="US:rep:AZ:7"));
  assert.ok(roster.endedMemberships?.some(row=>row.personId==="congress:G000551" && row.termEnd==="2025-03-13"));
  assert.ok(roster.officeholders.some(row=>row.state==="AS" && row.memberships?.[0]?.officeId==="US:rep:AS:0"),"the Clerk's AQ00/AS crosswalk is source explicit");
});

test("truncated or duplicate official XML cannot retire held membership",()=>{
  const xml=fixture("senate-current.xml");
  assert.throws(()=>parseSenateRoster([{url:SENATE_ROSTER_URL,body:xml.slice(0,-20)}],AT),/complete contact_information/);
  const first=/<member>[\s\S]*?<\/member>/.exec(xml)![0];
  const partial=parseSenateRoster([{url:SENATE_ROSTER_URL,body:xml.replace(first,"")}],AT);
  assert.equal(partial.officeholders.length,99);assert.equal(partial.currentMembershipComplete,false);assert.deepEqual(partial.coveredChambers,[]);
  assert.throws(()=>parseSenateRoster([{url:SENATE_ROSTER_URL,body:xml.replace("</contact_information>",`${first}</contact_information>`)}],AT),/duplicate Senate seat/);
  const houseXml=fixture("house-current.xml");
  assert.throws(()=>parseHouseRoster([{url:HOUSE_ROSTER_URL,body:houseXml.replace('date="20260421"','date="20260231"')}],AT),/invalid official pred-vacate-date/);
});

test("source retrieval dates remain attached to each document rather than a replay clock",()=>{
  const documents=senate().map((row,index)=>({...row,retrievedAt:index===0?"2026-10-01T00:00:00Z":"2026-10-02T00:00:00Z"}));
  const roster=parseSenateRoster(documents,"2026-10-13T00:00:00Z"),moody=roster.officeholders.find(row=>row.id==="congress:M001244")!;
  assert.equal(moody.provenance.collectedAt,"2026-10-01T00:00:00Z");
  assert.equal(moody.fieldSources?.termStart?.collectedAt,"2026-10-02T00:00:00Z");
  assert.equal(parseSenateAppointments(fixture("senate-appointed.html")).get("A000383")?.sworn,"2026-03-24","visible source date takes precedence over its invalid hidden sort value");
});
