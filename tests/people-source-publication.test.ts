import assert from "node:assert/strict";
import test from "node:test";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import { personIdentityKeys, statePeopleSourcePointers, statePeopleScopeForId } from "../lib/officials/people-identity.ts";
import { indexByDivision, indexByOfficeholderId } from "../lib/officials/lookup.ts";
import { isStatewideExecutive, scopedHolders } from "../lib/officials/scoped-holders.ts";
import { identityChipsFor } from "../lib/officials/identity-chips.ts";
import { officeholderEvidence } from "../lib/ask/officeholder.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { peopleSourceContractId } from "../lib/civic-data/people-source-contracts.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { verifyStatewideOfficialPage, statewideRoster } from "../lib/sources/statewide/parse.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import { collectPeopleCoverage,comparePeopleCoverage } from "../lib/officials/people-coverage-report.ts";
import { civicRecordFacts } from "../lib/civic-data/changes.ts";

const at="2026-10-12T00:00:00.000Z";
function person(id:string,changes:Partial<Officeholder>={}):Officeholder {
  return {id,personId:id,state:"AZ",level:"STATE",name:"Jordan Reader",officeTitle:"Secretary of State",termStart:"",termEnd:"",birthDate:null,partyLabel:null,
    websiteUrl:null,contactFormUrl:null,phone:null,email:null,campaignUrl:null,photo:null,
    provenance:{sourceUrl:`https://reference.example/${id}`,sourceOrg:"Reference fixture",collectedAt:at,verifiedAt:at},...changes};
}
const set=(...officeholders:Officeholder[]):OfficeholderSet=>({scope:"US-AZ",generatedAt:at,officeholders,divisions:[],unmatched:[]});

test("shared cross-source IDs join transitively and every source's IDs survives",()=>{
  const a=person("openstates:a",{nativeIds:{"ocd-person":["ocd-person/a"],votesmart:["27"]}});
  const b=person("legiscan:9",{name:"J. Reader",nativeIds:{legiscan:["9"],wikidata:["Q91"]}});
  const bridge=person("wikidata:Q91",{nativeIds:{wikidata:["Q91"],vote_smart:["27"],bioguide:["R000001"]}});
  const merged=mergePeopleSets([set(a,b),set(bridge)])!;
  assert.equal(merged.officeholders.length,1);
  const keys=personIdentityKeys(merged.officeholders[0]);
  for(const key of ["ocd-person:a","legiscan:9","wikidata:Q91","votesmart:27","congress:R000001"])assert.ok(keys.has(key),key);
});
test("unique full name, office and state binds an association lead without merging namesakes in another state",()=>{
  const merged=mergePeopleSets([set(person("openstates:a")),set(person("association:a")),set(person("association:b",{state:"NM"}))])!;
  assert.equal(merged.officeholders.length,2);
  assert.ok(merged.officeholders[0].nativeIds?.reader?.includes("association:a"));
  const ambiguous=mergePeopleSets([set(person("a"),person("b")),set(person("c"))])!;
  assert.equal(ambiguous.officeholders.length,3,"two same-source namesakes prevent a name-only binding");
});
test("an official person's page wins disagreements and a later blank retains its field and source",()=>{
  const unofficial=person("ref:a",{phone:"202-555-0101",selectionMethod:"ELECTED_STATEWIDE"});
  const official=person("official:a",{phone:"202-555-0102",websiteUrl:"https://state.example.gov/jordan",selectionMethod:"APPOINTED",
    memberships:[{id:"official:membership",personId:"official:a",officeId:"secretary",jurisdiction:"US-AZ",officeTitle:"Secretary of State",level:"STATE",current:true,
      divisionId:"ocd-division/country:us/state:az",selectionMethod:"APPOINTED",selectionMethodSourceUrl:"https://state.example.gov/jordan",sourceUrl:"https://state.example.gov/jordan"}],
    provenance:{sourceUrl:"https://state.example.gov/jordan",sourceOrg:"Official state page",collectedAt:"2026-10-11T00:00:00.000Z",verifiedAt:at}});
  const merged=mergePeopleSets([set(unofficial),set(official)])!;
  assert.equal(merged.officeholders.length,1);assert.equal(merged.officeholders[0].phone,official.phone);
  assert.equal(merged.officeholders[0].fieldSources?.phone.sourceUrl,official.websiteUrl);
  assert.equal(merged.disagreements?.find(row=>row.field==="phone")?.owner,"BL-01");
  assert.equal(merged.disagreements?.find(row=>row.field==="phone")?.status,"OPEN");
  const partial=mergePeopleSets([merged,set({...official,phone:null,selectionMethod:"UNKNOWN",memberships:official.memberships?.map(row=>({...row,divisionId:undefined,selectionMethod:"UNKNOWN"}))})])!;
  assert.equal(partial.officeholders[0].phone,official.phone);
  assert.equal(partial.officeholders[0].selectionMethod,"APPOINTED");
  assert.equal(partial.officeholders[0].memberships?.[0].selectionMethod,"APPOINTED");
  assert.equal(partial.officeholders[0].memberships?.[0].divisionId,"ocd-division/country:us/state:az");
});
test("a verified appointed secretary reaches the state root, its card and Ask",async()=>{
  const sourceUrl="https://office.example.gov/about-jordan";
  const html="<h1>Jordan Reader, Secretary of State</h1><p>New Jersey Secretary of State Jordan Reader was appointed by the Governor.</p><a href='tel:202-555-0102'>Office phone</a>";
  const lead={sourceId:"association",sourceOrg:"Association fixture",sourceUrl:"https://association.example/members",collectedAt:at,state:"nj",name:"Jordan Reader",officeTitle:"Secretary of State",profileUrls:[sourceUrl]};
  const verified=verifyStatewideOfficialPage(lead,{url:sourceUrl,html,retrievedAt:at});
  assert.ok("person" in verified);if(!("person" in verified))return;
  const store=new MemoryRoutineDataStore(),roster=statewideRoster("nj",[verified.person],at);
  const published=await publishPeopleSource({store,state:"nj",sourceId:"statewide-executive-sources",roster,
    acquisitions:[{requestedUrl:sourceUrl,finalUrl:sourceUrl,httpStatus:200,body:html,retrievedAt:at}],releaseId:"fixture-1",now:at});
  assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
  const read=await readStatePeopleProjection("US-NJ",{store,now:at,bypassCache:true});assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
  const holder=indexByDivision([read.value.roster]).get("ocd-division/country:us/state:nj")![0];
  assert.ok(isStatewideExecutive(holder));assert.equal(holder.selectionMethod,"APPOINTED");
  assert.ok(identityChipsFor(holder,"state","INCUMBENT").includes("Appointed"));
  assert.ok(!identityChipsFor(holder,"state","INCUMBENT").includes("Incumbent"));
  assert.match(officeholderEvidence(holder).text,/Secretary of State, appointed/);
});
test("Open States and an official association officer produce one reader person with both identifiers",async()=>{
  const store=new MemoryRoutineDataStore(),revision="a".repeat(40),pluralUrl=`https://raw.githubusercontent.com/openstates/people/${revision}/data/nj/executive/reader.yml`;
  const body="id: ocd-person/00000000-0000-0000-0000-000000000001\nname: Jordan Reader\nroles:\n- type: secretary_of_state\n  jurisdiction: ocd-jurisdiction/country:us/state:nj/government\nlinks:\n- url: https://office.example.gov/about-jordan\n";
  const roster=normalize(yamlToPeople(body,"nj",pluralUrl,at),new Map(),at,"US-NJ");
  const initial=await publishStatePeople({store,state:"nj",roster,acquisitions:[{requestedUrl:pluralUrl,finalUrl:pluralUrl,httpStatus:200,body,retrievedAt:at}],releaseId:revision,now:at});
  assert.ok(initial.outcome.promoted);
  const url="https://office.example.gov/about-jordan",html="<h1>Jordan Reader</h1><p>New Jersey Secretary of State Jordan Reader was appointed by the Governor.</p>";
  const bound=verifyStatewideOfficialPage({sourceId:"nass",sourceOrg:"Association",sourceUrl:"https://www.nass.org/members",collectedAt:at,state:"nj",name:"Jordan Reader",officeTitle:"Secretary of State",profileUrls:[url],nativeIds:{nass:["member-1"]}}, {url,html,retrievedAt:at});
  assert.ok("person" in bound);if(!("person" in bound))return;
  const official=await publishPeopleSource({store,state:"nj",sourceId:"statewide-executive-sources",contractId:peopleSourceContractId("nj","statewide-executive-sources"),
    roster:statewideRoster("nj",[bound.person],at),acquisitions:[{requestedUrl:url,finalUrl:url,httpStatus:200,body:html,retrievedAt:at}],releaseId:"association-1",now:at});
  assert.ok(official.outcome.promoted,JSON.stringify(official.outcome.candidate.receipt));
  const read=await readStatePeopleProjection("US-NJ",{store,now:at,bypassCache:true});assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")return;
  assert.equal(read.value.roster.officeholders.length,1);
  const ids=indexByOfficeholderId([read.value.roster]);assert.equal(ids.get(roster.officeholders[0].id),ids.get(bound.person.id));
  const holder=ids.get(bound.person.id)!;assert.equal(holder.selectionMethod,"APPOINTED");
  assert.equal(scopedHolders([holder],[{...holder,id:"legacy:nj/secretary",nativeIds:undefined,personId:undefined}]).length,1);
});
test("state-source reader pointers include federal shards and arbitrary statewide offices",()=>{
  const pointers=statePeopleSourcePointers("US-WA");
  assert.ok(pointers.some(row=>row.recordClass==="FEDERAL_DIRECTORY"&&row.scope.includes("congress-api")));
  assert.ok(pointers.some(row=>row.scope.includes("portraits")));
  const holder=indexByDivision([{...set(person("arbitrary",{state:"WA",officeTitle:"Public Lands Commissioner",
    memberships:[{id:"m",personId:"arbitrary",officeId:"o",jurisdiction:"US-WA",officeTitle:"Public Lands Commissioner",level:"STATE",current:true,divisionId:"ocd-division/country:us/state:wa",sourceUrl:"https://lands.example.gov"}]})),
    divisions:[{officeholderId:"arbitrary",membershipId:"m",ocdId:"ocd-division/country:us/state:wa",bodyId:null}]}]).get("ocd-division/country:us/state:wa")![0];
  assert.ok(isStatewideExecutive(holder));
});
test("each new person reader ID selects one state, including global aliases with an exact state hint",()=>{
  for(const prefix of ["legiscan","official-legislature","wikidata","congress-api","govinfo","statewide"])
    assert.equal(statePeopleScopeForId(`${prefix}:wa:subject`),"US-WA");
  assert.equal(statePeopleScopeForId("wikidata:Q91","WA"),"US-WA");
  assert.equal(statePeopleScopeForId("wikidata:Q91"),null);
  assert.equal(statePeopleScopeForId("legiscan:xx:123"),null);
});
test("field source rechecks retain the same facts and disagreement blank identity",()=>{
  const source={sourceUrl:"https://office.example.gov/person",sourceOrg:"Official",collectedAt:at,verifiedAt:at};
  const first=person("person",{phone:"202-555-0102",provenance:source,fieldSources:{phone:source}});
  const next={...first,provenance:{...source,collectedAt:"2026-10-13T00:00:00Z"},fieldSources:{phone:{...source,collectedAt:"2026-10-13T00:00:00Z"}}};
  assert.deepEqual(civicRecordFacts("STATE_LEGISLATOR",{key:"member:person",record:first}),civicRecordFacts("STATE_LEGISLATOR",{key:"member:person",record:next}));
  const prior=person("ref",{phone:"202-555-0101"});
  assert.equal(mergePeopleSets([set(prior),set(first)])!.disagreements?.[0].key,mergePeopleSets([set(prior),set(next)])!.disagreements?.[0].key);
});
test("coverage reports preserve unknown sources and refuse a one-day claim before its observation exists",async()=>{
  const before=await collectPeopleCoverage({store:new MemoryRoutineDataStore(),now:at,bypassCache:true});
  assert.equal(before.states.length,56);
  const state=before.states.find(row=>(row as {state:string}).state==="WA") as {sources:{people:number|null}[];photos:null};
  assert.ok(state.sources.every(source=>source.people===null));assert.equal(state.photos,null);
  assert.throws(()=>comparePeopleCoverage(before,{...before,observedAt:"2026-10-12T23:59:59Z"}),/ONE_DAY_OBSERVATION_NOT_YET_HELD/);
  assert.equal(comparePeopleCoverage(before,{...before,observedAt:"2026-10-13T00:00:00Z"}).elapsedMs,86400000);
});
