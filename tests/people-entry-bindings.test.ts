import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOfficialLegislaturePage } from "../lib/sources/people/legislature.ts";
import { emptyPerson, emptyRoster, provenance } from "../lib/sources/people/common.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import { personIdentityKeys } from "../lib/officials/people-identity.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";

const at="2026-10-26T06:00:00.000Z",page="https://legislature.example.gov/house/membership/";
function reference(name:string,uuid:string,district:string) {
  const person=emptyPerson(`plural:id:${uuid}`,name,"State Representative","ID",provenance(`https://raw.githubusercontent.com/openstates/people/${"a".repeat(40)}/data/id/legislature/${uuid}.yml`,"Open States",at));
  person.personId=`plural:${uuid}`;person.chamber="lower";person.websiteUrl=page;
  person.nativeIds={plural:[uuid],"ocd-person":[`ocd-person/${uuid}`]};
  person.memberships=[{id:`plural:id:${uuid}:lower:${district}`,personId:person.personId,officeId:`house:${district}`,jurisdiction:"US-ID",level:"STATE",chamber:"lower",district,divisionId:`ocd-division/country:us/state:id/sldl:${district}`,current:true,sourceUrl:person.provenance.sourceUrl!}];
  return person;
}
const people=[reference("Vito Barbieri","vito","3"),reference("Jane Member","jane","4")];
function roster(rows:Officeholder[]):OfficeholderSet {
  return {...emptyRoster("id",at),officeholders:rows,divisions:rows.flatMap(person=>person.memberships?.flatMap(row=>row.divisionId?[{officeholderId:person.id,membershipId:row.id,ocdId:row.divisionId,bodyId:null}]:[])??[])};
}
const html=`<h1>House Membership</h1><section>
<div class="member"><img src="/vito.jpg"><div><p><strong>Vito Barbieri</strong>(R)<br>District 3 House Seat A</p><a href="tel:2085550003">208-555-0003</a><a href="mailto:vito@house.example.gov">Email</a></div></div>
<div class="member"><img src="/jane.jpg"><div><p><strong>Jane Member</strong>(D)<br>District 4 House Seat B</p><a href="tel:2085550004">208-555-0004</a><a href="mailto:jane@house.example.gov">Email</a></div></div></section>`;
const parse=(body=html,held=roster(people))=>normalizeOfficialLegislaturePage(body,page,{sourceId:"official-state-people",state:"id",asOf:at,signal:new AbortController().signal,roster:held},at);

test("a shared member-list route binds each entry's identity, district, contact and image",()=>{
  const parsed=parse();assert.equal(parsed.officeholders.length,2);
  assert.equal(new Set(parsed.officeholders.map(person=>person.personId)).size,2);
  for(const [i,person]of parsed.officeholders.entries()) {
    assert.deepEqual(person.nativeIds?.["ocd-person"],[`ocd-person/${i?"jane":"vito"}`]);
    assert.equal(person.phone,`208-555-000${i?4:3}`);assert.equal(person.email,`${i?"jane":"vito"}@house.example.gov`);
    assert.equal(person.portraitCandidate?.imageUrl,`https://legislature.example.gov/${i?"jane":"vito"}.jpg`);
    assert.equal(person.memberships?.[0].district,i?"4":"3");
    assert.ok(!person.provenance.quote?.includes(i?"Vito":"Jane"));
  }
  assert.equal(mergePeopleSets([roster(people),parsed])!.officeholders.length,2);
});

test("a list discovers every named entry even without an aggregator or linked name",()=>{
  const parsed=parse(html,roster([]));assert.deepEqual(parsed.officeholders.map(person=>person.name),["Vito Barbieri","Jane Member"]);
  assert.equal(mergePeopleSets([parsed])!.officeholders.length,2);
});

test("a list header and a different member's entry cannot lend fields to a profile route",()=>{
  const parsed=parse(html.replace(/<div class="member"><img src="\/vito.jpg">[\s\S]*?<\/div><\/div>/,""));
  assert.deepEqual(parsed.officeholders.map(person=>person.name),["Jane Member"]);
  assert.equal(parsed.officeholders[0].phone,"208-555-0004");
});

function collapsed():Officeholder {
  return {...people[0],id:"official-legislature:id:old-list",personId:"official-legislature:old-list",websiteUrl:page,
    nativeIds:{plural:["vito","jane"],"ocd-person":["ocd-person/vito","ocd-person/jane"],reader:["plural:id:vito","plural:vito","plural:id:jane","plural:jane","old-vito-reader"]},
    memberships:people.flatMap(person=>person.memberships??[]),provenance:provenance(page,"State legislature",at,"Vito Barbieri")};
}

test("old collapsed records and portrait copies return native aliases to the right source people",()=>{
  const old=roster([collapsed()]),parsed=parse();
  for(const sets of [[roster(people),old,parsed,old],[old,parsed,roster(people),old]]) {
    const merged=mergePeopleSets(sets)!;assert.equal(merged.officeholders.length,2);
    const vito=merged.officeholders.find(person=>person.name==="Vito Barbieri")!,jane=merged.officeholders.find(person=>person.name==="Jane Member")!;
    assert.deepEqual(vito.nativeIds?.["ocd-person"],["ocd-person/vito"]);assert.deepEqual(jane.nativeIds?.["ocd-person"],["ocd-person/jane"]);
    for(const id of ["official-legislature:id:old-list","official-legislature:old-list","old-vito-reader","plural:vito","plural:id:vito"])assert.ok(personIdentityKeys(vito).has(id),id);
    for(const id of ["plural:jane","plural:id:jane","ocd-person/jane"]) {
      assert.ok(personIdentityKeys(jane).has(id),id);assert.ok(!personIdentityKeys(vito).has(id),id);
    }
    assert.equal(merged.divisions.filter(link=>link.officeholderId===vito.id&&link.ocdId.endsWith(":4")).length,0);
  }
});

test("normal publication replaces a collapsed held record and keeps its named reader ID",async()=>{
  const publication=await publishPeopleSource({store:new MemoryRoutineDataStore(),vault:new MemoryEvidenceStore(),state:"id",sourceId:"official-state-people",now:at,releaseId:"entries",
    held:{versionId:null,normalizedPayload:{},roster:roster([collapsed()])},roster:parse(),acquisitions:[{requestedUrl:page,finalUrl:page,body:html,httpStatus:200,retrievedAt:at}]});
  assert.ok(publication.outcome.promoted,JSON.stringify(publication.outcome.candidate.receipt));
  const published=(publication.candidate.readModel as {roster:OfficeholderSet}).roster;
  assert.equal(published.officeholders.length,2);
  assert.ok(published.officeholders.every(person=>person.nativeIds?.["ocd-person"]?.length===1));
  assert.ok(personIdentityKeys(published.officeholders.find(person=>person.name==="Vito Barbieri")!).has("official-legislature:old-list"));
});

test("a valid portrait held by the collapsed copy returns to its named person",()=>{
  const old=collapsed(),hash=`sha256-${"a".repeat(64)}`;
  old.photo={url:`/api/portraits/officials/${"a".repeat(64)}.jpg`,sourceUrl:"https://legislature.example.gov/jane.jpg",attribution:"Open States",license:null,collectedAt:at,
    verification:{personId:old.personId!,name:"Jane Member",basis:"SOURCE_FEED",imageUrl:"https://legislature.example.gov/jane.jpg",checkedAt:at,imageHash:hash,sourceImageHash:hash,
      attribution:{sourceUrl:people[1].provenance.sourceUrl!,name:"Jane Member"},sources:[{url:people[1].provenance.sourceUrl!,artifactId:"fixture:jane",contentHash:hash,retrievedAt:at}]}};
  const merged=mergePeopleSets([roster(people),roster([old]),parse()])!;
  assert.equal(merged.officeholders.find(person=>person.name==="Vito Barbieri")!.photo,null);
  const jane=merged.officeholders.find(person=>person.name==="Jane Member")!;
  assert.equal(jane.photo?.url,old.photo.url);assert.equal(jane.photo?.verification?.personId,jane.personId);
  assert.ok(!personIdentityKeys(jane).has(old.personId!));
});

test("two primary IDs independently naming the same person remain a single real person",()=>{
  const other={...people[0],id:"plural:id:earlier",personId:"plural:earlier",nativeIds:{"ocd-person":["ocd-person/earlier"]}};
  const bridge={...people[0],id:"crosswalk",nativeIds:{"ocd-person":["ocd-person/vito","ocd-person/earlier"]}};
  const merged=mergePeopleSets([roster([people[0],other]),roster([bridge])])!;
  assert.equal(merged.officeholders.length,1);assert.equal(merged.officeholders[0].nativeIds?.["ocd-person"]?.length,2);
});

test("a portrait save with no new images still repairs its held bindings from the already-read people",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const source=await publishPeopleSource({store,vault,state:"id",sourceId:"official-state-people",now:at,releaseId:"entries",roster:parse(),
    acquisitions:[{requestedUrl:page,finalUrl:page,body:html,httpStatus:200,retrievedAt:at}]});
  assert.ok(source.outcome.promoted);
  const binding=(source.candidate.readModel as {roster:OfficeholderSet}).roster;
  const ref=promotedInputRef("STATE_LEGISLATOR",source.candidate.scope,source.outcome.promoted.versionId,source.candidate.readModel,at)!;
  const portraits=await publishPeopleSource({store,vault,state:"id",sourceId:"people-portraits",now:at,releaseId:"bindings",roster:roster([]),bindingPeople:binding.officeholders,
    held:{versionId:null,normalizedPayload:{},roster:roster([collapsed()])},derivedInputs:[ref],acquisitions:[]});
  assert.ok(portraits.outcome.promoted,JSON.stringify(portraits.outcome.candidate.receipt));
  const saved=(portraits.candidate.readModel as {roster:OfficeholderSet}).roster;
  assert.deepEqual(saved.officeholders[0].nativeIds?.["ocd-person"],["ocd-person/vito"]);
  assert.equal(mergePeopleSets([binding,saved])!.officeholders.length,2);
});

test("a borrowed canonical ID returns to its source owner rather than the collapsed display name",()=>{
  const bad={...collapsed(),id:people[1].id,personId:people[1].personId};
  const merged=mergePeopleSets([roster(people),roster([bad])])!;
  assert.equal(merged.officeholders.length,2);
  const vito=merged.officeholders.find(person=>person.name==="Vito Barbieri")!,jane=merged.officeholders.find(person=>person.name==="Jane Member")!;
  assert.deepEqual(vito.nativeIds?.["ocd-person"],["ocd-person/vito"]);assert.deepEqual(jane.nativeIds?.["ocd-person"],["ocd-person/jane"]);
  assert.ok(!personIdentityKeys(vito).has(people[1].id));assert.ok(personIdentityKeys(jane).has(people[1].id));
  const repaired=mergePeopleSets([roster([bad]),roster(people)])!;
  assert.equal(repaired.officeholders.length,2);
});

test("a derived portrait copy cannot erase the membership used to bind an expanded official name",()=>{
  const stripped={...people[0],memberships:[],email:null};
  const parsed=parse(html.replaceAll("Vito Barbieri","Vito M. Barbieri"),roster([...people,stripped]));
  assert.equal(parsed.officeholders.length,2);
  const vito=parsed.officeholders.find(person=>person.name.includes("Barbieri"))!;
  assert.deepEqual(vito.nativeIds?.["ocd-person"],["ocd-person/vito"]);assert.equal(vito.memberships?.[0].district,"3");
});

test("a state-scoped borrowed alias cannot join members on the next publication",()=>{
  const a=reference("Vito Barbieri","11111111-1111-4111-8111-111111111111","3"),b=reference("Jane Member","22222222-2222-4222-8222-222222222222","4");
  const bad={...a,id:"old-list",personId:"old-list",nativeIds:{...a.nativeIds,reader:[b.id]},sourceHolders:[{...a,id:"official-a",personId:"official-a"}]};
  const first=mergePeopleSets([roster([bad]),roster([{...a,id:"new-a",personId:"new-a"},b])])!;
  assert.equal(first.officeholders.length,2);
  const vito=first.officeholders.find(person=>person.name===a.name)!,jane=first.officeholders.find(person=>person.name===b.name)!;
  assert.ok(!personIdentityKeys(vito).has(b.id));assert.ok(personIdentityKeys(jane).has(b.id));
  assert.equal(mergePeopleSets([first,roster([a,b])])!.officeholders.length,2);
});

test("several source entries for one membership show the person once without dropping another holder",()=>{
  const parsed=parse(),combined=mergePeopleSets([roster(people),parsed])!;
  const vito=combined.officeholders.find(person=>person.name==="Vito Barbieri")!;
  combined.divisions.push({...combined.divisions.find(link=>link.officeholderId===vito.id)!,membershipId:undefined});
  const other={...people[1],memberships:people[1].memberships?.map(row=>({...row,divisionId:vito.memberships![0].divisionId}))};
  const index=indexByDivision([combined,roster([other])]);
  assert.deepEqual(index.get(vito.memberships![0].divisionId!)?.map(person=>person.name),["Jane Member","Vito Barbieri"]);
});

test("an exact native ID keeps a person's expanded published name from looking like a foreign alias",()=>{
  const a=reference("David Leavitt","11111111-1111-4111-8111-111111111111","3");
  const expanded={...a,name:"David J. Leavitt",id:"official-entry",personId:"official-entry"};
  const held={...a,id:expanded.id,personId:expanded.personId,sourceHolders:[expanded]};
  const merged=mergePeopleSets([roster([held]),roster([a])])!;
  assert.equal(merged.officeholders.length,1);assert.equal(merged.officeholders[0].id,held.id);
});
