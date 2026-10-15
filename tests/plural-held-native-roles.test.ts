import assert from "node:assert/strict";
import test from "node:test";
import { parse, stringify } from "yaml";
import held from "./fixtures/plural/held-native-edge-cases.json" with {type:"json"};
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { officeIdentity } from "../lib/officials/office-identity.ts";
import { holdPeopleCaptures, statePeopleCandidate, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";

const NOW="2026-10-10T02:00:00.000Z";
const sourceUrl=(row:typeof held[number])=>`https://raw.githubusercontent.com/openstates/people/${row.source_url.split("/").at(-1)}/${row.member}`;
function replay(row:typeof held[number],body=row.body,now=NOW){
  const state=row.scope.slice(3,5).toLowerCase(),gaps:string[]=[];
  const people=yamlToPeople(body,state,sourceUrl(row),now,detail=>gaps.push(detail),true);
  return {gaps,roster:normalize(people,new Map(),row.retrieved_at,`US-${state.toUpperCase()}`)};
}

test("held Hawaii mayors bind only to their explicit county government",()=>{
  const counties=new Map([["Derek-Kawakami-","kauai"],["Rick-Blangiardi-","honolulu"]]);
  for(const [member,county] of counties){
    const row=held.find(row=>row.member.includes(member))!;
    const {gaps,roster}=replay(row);
    assert.deepEqual(gaps,[]);assert.equal(roster.officeholders.length,1);
    const person=roster.officeholders[0];
    assert.equal(person.officeTitle,"Mayor");assert.equal(person.level,"LOCAL");
    assert.equal(person.memberships?.find(role=>role.current)?.jurisdiction,`ocd-jurisdiction/country:us/state:hi/county:${county}/government`);
    assert.deepEqual(roster.divisions.map(row=>row.ocdId),[`ocd-division/country:us/state:hi/county:${county}`]);
    assert.equal(replay(row,row.body,"2030-01-01T00:00:00.000Z").roster.officeholders.length,0);
    const unsupported=replay(row,row.body.replace(`/county:${county}`,""));
    assert.equal(unsupported.roster.officeholders.length,0,"a mayor cannot acquire a whole-state division from a missing county");
    assert.ok(unsupported.gaps.some(gap=>gap.startsWith("PLURAL_ROLE_JURISDICTION_MISMATCH")));
  }
});

test("held DC governor-category record names the Mayor of the exact District",()=>{
  const row=held.find(row=>row.member.includes("Muriel-Bowser-"))!;
  const {gaps,roster}=replay(row);
  assert.deepEqual(gaps,[]);assert.equal(roster.officeholders.length,1);
  const person=roster.officeholders[0],current=person.memberships?.find(role=>role.current);
  assert.ok(current);
  assert.equal(person.officeTitle,"Mayor");assert.equal(person.level,"STATE");
  assert.equal(current.officeTitle,"Mayor");assert.equal(current.termStart,"2023-01-02");
  assert.equal(current.sourceUrl,sourceUrl(row));
  assert.deepEqual(roster.divisions.map(row=>row.ocdId),["ocd-division/country:us/district:dc"]);
  assert.ok(!current.officeId.includes(":governor:"));
});

test("held chief election officers keep their literal native office and exact statewide tenure",()=>{
  const rows=held.filter(row=>row.body.includes("type: chief election officer"));
  assert.equal(rows.length,4);
  for(const row of rows){
    const {gaps,roster}=replay(row);
    assert.deepEqual(gaps,[]);assert.equal(roster.officeholders.length,1);
    const person=roster.officeholders[0],current=person.memberships?.find(role=>role.current);
    assert.ok(current);
    assert.equal(person.officeTitle,"Chief Election Officer");
    assert.equal(officeIdentity(person.officeTitle),"chief_election_officer");
    assert.equal(person.level,"STATE");assert.ok(current.termEnd);
    assert.equal(roster.divisions[0].ocdId,current.jurisdiction.replace("ocd-jurisdiction/","ocd-division/").replace(/\/government$/,""));
    assert.equal(current.sourceUrl,sourceUrl(row));
  }
});

test("a structured collective council record with its official council contact source is excluded durably",async ()=>{
  const row=held.find(row=>row.member.includes("Janesville-City-Council-"))!;
  const {gaps,roster}=replay(row);
  assert.equal(roster.officeholders.length,0);
  assert.equal(gaps.length,1);assert.match(gaps[0],/^PLURAL_PERSON_IS_GOVERNING_BODY:person=ocd-person\//);
  const captures=await holdPeopleCaptures(new MemoryEvidenceStore(),"plural-openstates",[{requestedUrl:sourceUrl(row),finalUrl:sourceUrl(row),
    httpStatus:200,body:row.body,retrievedAt:row.retrieved_at}]);
  const candidate=statePeopleCandidate({state:"wi",roster,captures,releaseId:row.source_url.split("/").at(-1)!,now:NOW,
    gaps:gaps.map(detail=>({sourceUrl:sourceUrl(row),detail}))});
  assert.ok(candidate.excludedFacts?.some(fact=>fact.code==="PLURAL_PERSON_IS_GOVERNING_BODY"));
  assert.ok((candidate.normalizedPayload as {captures:StatePeopleCapture[]}).captures.some(capture=>capture.capture.rawHash===captures[0]!.capture.rawHash));
  const native=parse(row.body);
  assert.equal(replay(row,stringify({...native,name:"Jane Council",given_name:"Jane",family_name:"Council"})).roster.officeholders.length,1,
    "a surname and council URL alone do not reject a real person");
  assert.equal(replay(row,stringify({...native,sources:[]})).roster.officeholders.length,1,
    "the exclusion needs the independent structured source contradiction, not a blanket name filter");
});
