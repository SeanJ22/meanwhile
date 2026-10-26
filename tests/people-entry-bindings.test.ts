import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOfficialLegislaturePage, legislatureRosterLinks } from "../lib/sources/people/legislature.ts";
import { emptyPerson, emptyRoster, provenance } from "../lib/sources/people/common.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import { personIdentityKeys,nativePersonIdFromUrl,memberProfileSubpageParentUrl } from "../lib/officials/people-identity.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import { promotedInputRef } from "../lib/civic-data/derived-authority.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import { retainsPeopleBindings } from "../lib/officials/people-bindings.ts";
import { verifyPortraitSources, portraitHash } from "../lib/photos/evidence.ts";

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
    assert.equal(person.portraitCandidate?.sourceUrl,page,"the image is on this roster entry; the linked profile is the member's route");
    assert.equal(person.phone,`208-555-000${i?4:3}`);assert.equal(person.email,`${i?"jane":"vito"}@house.example.gov`);
    assert.equal(person.portraitCandidate?.imageUrl,`https://legislature.example.gov/${i?"jane":"vito"}.jpg`);
    assert.equal(person.memberships?.[0].district,i?"4":"3");
    assert.ok(!person.provenance.quote?.includes(i?"Vito":"Jane"));
  }
  assert.equal(mergePeopleSets([roster(people),parsed])!.officeholders.length,2);
});

test("a verified official roster entry supplies only that member's portrait",()=>{
  const capture={transport:"REACHABLE" as const,partial:false,httpStatus:200,observedAt:at,evidence:{canonicalUrl:page,sourceId:"official-state-people",
    retrievedAt:at,text:html,vaultKey:"project/freshness/source/official-state-people/raw/fixture",contentHash:portraitHash(new TextEncoder().encode(html))}};
  const subject={personId:people[0].personId!,name:people[0].name,nativeIds:people[0].nativeIds,state:"ID",chamber:"lower",officeTitle:people[0].officeTitle,profileUrls:[page]};
  assert.equal(verifyPortraitSources(subject.personId,{subject,imageUrl:"https://legislature.example.gov/vito.jpg",captures:[capture]},at).basis,"OWN_PAGE");
  assert.throws(()=>verifyPortraitSources(subject.personId,{subject,imageUrl:"https://legislature.example.gov/jane.jpg",captures:[capture]},at),/PORTRAIT_SECOND_SOURCE_MISSING/);
});

test("a newer bound official entry replaces an older official profile's value",()=>{
  const source={...people[0].provenance,kind:"OFFICIAL" as const,sourceUrl:"https://legislature.example.gov/members/vito",collectedAt:"2026-10-20T00:00:00.000Z"};
  const old={...people[0],phone:"208-555-9999",websiteUrl:source.sourceUrl,provenance:source};
  assert.equal(mergePeopleSets([roster([old]),parse()])!.officeholders.find(person=>person.name==="Vito Barbieri")?.phone,"208-555-0003");
});

test("a member's news and photo-album titles never become people or member-list routes",()=>{
  const body='<h1>House Members</h1><div><a href="/members/vito">Vito Barbieri</a><p>Representative District 3</p><img src="/vito.jpg"></div><article><a href="/members/vito/photos/transportation-committee"><h2>Transportation Committee</h2></a><p>Representative District 3</p><img src="/committee.jpg"></article><a href="/members/vito/news/new-members">Members</a>';
  const parsed=parse(body);
  assert.deepEqual(parsed.officeholders.map(person=>person.name),["Vito Barbieri"]);
  for(const path of ["/members/vito/news/grants","/members/vito/photos/transportation-committee","/members/vito/newsletter-sign-up","/members/vito/newsletters/an-update"])
    assert.equal(normalizeOfficialLegislaturePage('<title>Representative Vito Barbieri</title><p>Representative Vito Barbieri, District 3</p><img src="/vito.jpg">',`https://legislature.example.gov${path}`,
      {state:"id",sourceId:"official-state-people",asOf:at,signal:new AbortController().signal,roster:roster(people)},at).officeholders.length,0);
  assert.deepEqual(legislatureRosterLinks(body,page),[]);
});

test("a member's old form-page IDs resolve to the person owning its explicit publisher profile",()=>{
  const member={...people[0],state:"OH",websiteUrl:"https://ohiosenate.gov/members/vito-barbieri",profileUrls:["https://ohiosenate.gov/senators/vito-barbieri"]};
  const form={...member,id:"old-form",personId:"old-form",name:"Sign Up",nativeIds:{"official-legislature":["https://www.ohiosenate.gov/members/vito-barbieri/newsletter-sign-up"]},memberships:[]};
  const repaired=mergePeopleSets([roster([form]),roster([member])])!;
  assert.equal(repaired.officeholders.length,1);
  assert.equal(repaired.officeholders[0].name,member.name);
  assert.ok(personIdentityKeys(repaired.officeholders[0]).has("old-form"));
  assert.deepEqual(repaired.officeholders[0].nativeIds?.["ocd-person"],["ocd-person/vito"]);
  assert.ok(retainsPeopleBindings([form],repaired.officeholders));
});

test("profile routes keep their own identity without treating a term or directory as a person",()=>{
  assert.deepEqual(nativePersonIdFromUrl("https://www.ohiosenate.gov/members/al-landis/biography"),{source:"oh-senate",id:"al-landis"});
  assert.equal(nativePersonIdFromUrl("https://ohiosenate.gov/members/member-directory"),null);
  assert.equal(nativePersonIdFromUrl("https://ohiosenate.gov/members/al-landis/newsletter-sign-up"),null);
  assert.equal(memberProfileSubpageParentUrl("https://flsenate.gov/Senators/2024-2026/S39"),null);
  assert.equal(memberProfileSubpageParentUrl("https://legislature.idaho.gov/legislators/membership/2026/id6687/"),null);
});

test("rechecking one person's same source entry keeps facts and every old ID without multiplying snapshots",()=>{
  let held=roster([{...people[0],email:"held@example.gov"}]);
  const oldIds=new Set<string>();
  for(let index=0;index<12;index++) {
    const id=`entry-read-${index}`;oldIds.add(id);
    held=mergePeopleSets([held,roster([{...people[0],id,personId:id,email:"held@example.gov",provenance:{...people[0].provenance,collectedAt:`2026-10-${String(index+1).padStart(2,"0")}T00:00:00.000Z`}}])])!;
  }
  const person=held.officeholders[0];
  assert.equal(person.email,"held@example.gov");
  assert.equal(person.sourceHolders?.length,1);
  assert.ok([...oldIds].every(id=>personIdentityKeys(person).has(id)));
  const changed=mergePeopleSets([held,roster([{...people[0],email:"new@example.gov",provenance:{...people[0].provenance,collectedAt:at}}])])!;
  assert.equal(changed.officeholders[0].sourceHolders?.length,2,"different sourced facts remain available");
});

test("a portrait lead keeps its own source time when another page changes the person's contact",()=>{
  const newer=parse().officeholders[0];
  const contact={...newer.provenance,sourceUrl:"https://legislature.example.gov/newsletter",collectedAt:"2026-10-27T00:00:00.000Z"};
  const held={...people[0],portraitCandidate:{imageUrl:"https://legislature.example.gov/old.jpg",sourceUrl:"https://legislature.example.gov/members/vito",collectedAt:"2026-10-20T00:00:00.000Z"},fieldSources:{portraitCandidate:contact}};
  const combined=mergePeopleSets([roster([newer]),roster([held])])!;
  assert.equal(combined.officeholders[0].portraitCandidate?.imageUrl,"https://legislature.example.gov/vito.jpg");
  assert.equal(combined.officeholders[0].fieldSources?.portraitCandidate?.sourceUrl,page);
});

test("a list discovers every named entry even without an aggregator or linked name",()=>{
  const parsed=parse(html,roster([]));assert.deepEqual(parsed.officeholders.map(person=>person.name),["Vito Barbieri","Jane Member"]);
  assert.equal(mergePeopleSets([parsed])!.officeholders.length,2);
});

test("a linked card uses its own name heading rather than its party, district or action links",()=>{
  const card=(id:string,name:string,district:string)=>`<div class="team-box"><a href="/Sections/Representatives/details.aspx?MemberId=${id}"><img data-src="/${id}.jpg"><div><h5>${name}</h5><p>Republican — District: ${district}</p></div></a><a href="/Sections/Representatives/contactmember.aspx?MemberId=${id}">Contact Member</a><a href="/Sections/Representatives/sponsoredbills.aspx?MemberId=${id}">Sponsored Bills</a></div>`;
  const parsed=parse(`<h1>Representatives Of The House</h1>${card("1","Barbieri, Vito","3")}${card("2","Member, Jane","4")}`);
  assert.equal(parsed.officeholders.length,2);
  for(const [i,person]of parsed.officeholders.entries()) {
    assert.equal(person.name,i?"Jane Member":"Vito Barbieri");
    assert.deepEqual(person.nativeIds?.["ocd-person"],[`ocd-person/${i?"jane":"vito"}`]);
    assert.equal(person.portraitCandidate?.imageUrl,`https://legislature.example.gov/${i?2:1}.jpg`);
    assert.equal(person.memberships?.[0].district,i?"4":"3");
  }
  const fresh=parse(`<h1>Representatives Of The House</h1>${card("1","Barbieri, Vito","3")}${card("2","Member, Jane","4")}`,roster([]));
  assert.deepEqual(fresh.officeholders.map(person=>person.name),["Vito Barbieri","Jane Member"]);
  assert.deepEqual(fresh.officeholders.map(person=>person.portraitCandidate?.imageUrl),["https://legislature.example.gov/1.jpg","https://legislature.example.gov/2.jpg"]);
});

test("roster discovery keeps a list's pagination while ignoring profile actions and sort duplicates",()=>{
  const links=legislatureRosterLinks(`<a href="/Senators?page=2&SortField=name&SortDirection=asc">Senators</a><a href="/Senators?page=2&SortField=district">Senators</a><a href="/Senators/S1">Senator Jane Member</a><a href="/Senators/subscribe">Subscribe to Senators</a><a href="/Senators/members.pdf">Members</a>`,page);
  assert.deepEqual(links,["https://legislature.example.gov/Senators?page=2"]);
  assert.equal(parse(html,roster(people)).officeholders.length,2);
  assert.equal(normalizeOfficialLegislaturePage(html,"https://www.house.gov/representatives",{sourceId:"official-state-people",state:"id",asOf:at,signal:new AbortController().signal},at).officeholders.length,0);
});

test("an observed publisher person ID binds an expanded name and its own current district",()=>{
  const held=reference("Toby Overdorf","11111111-1111-4111-8111-111111111111","4");
  held.state="FL";held.websiteUrl="https://www.myfloridahouse.gov/Sections/Representatives/details.aspx?MemberId=4666&LegislativeTermId=90";
  const body='<h1>Representatives</h1><div><a href="/Sections/Representatives/details.aspx?MemberId=4666&LegislativeTermId=91"><img data-src="/4666.jpg"><h5>Overdorf, Tobin Rogers "Toby"</h5><p>District: 85</p></a></div>';
  const parsed=normalizeOfficialLegislaturePage(body,"https://www.flhouse.gov/Representatives",{sourceId:"official-state-people",state:"fl",asOf:at,signal:new AbortController().signal,roster:roster([held]),divisions:[{ocdId:"ocd-division/country:us/state:fl/sldl:85",label:"District 85",divisionType:"sldl"}]},at);
  assert.equal(parsed.officeholders.length,1);
  const person=parsed.officeholders[0];assert.deepEqual(person.nativeIds?.["ocd-person"],held.nativeIds!["ocd-person"]);
  assert.deepEqual(person.nativeIds?.["fl-house"],["4666"]);assert.equal(person.memberships?.[0].district,"85");
  assert.equal(person.memberships?.[0].divisionId,"ocd-division/country:us/state:fl/sldl:85");
});

test("a member's publisher ID cannot turn its contact or sponsored-bills links into the member's name",()=>{
  const held={...people[0],state:"FL",websiteUrl:"https://www.myfloridahouse.gov/Sections/Representatives/details.aspx?MemberId=111"};
  const body='<h1>Representatives</h1><div><a href="/Sections/Representatives/details.aspx?MemberId=111"><h5>Barbieri, Vito</h5><p>District: 3</p><img data-src="/111.jpg"></a><a href="/Sections/Representatives/contactmember.aspx?MemberId=111">Contact Member</a><a href="/Sections/Representatives/sponsoredbills.aspx?MemberId=111">Sponsored Bills</a></div>';
  const parsed=normalizeOfficialLegislaturePage(body,"https://www.flhouse.gov/Representatives",{sourceId:"official-state-people",state:"fl",asOf:at,signal:new AbortController().signal,roster:roster([held])},at);
  assert.equal(parsed.officeholders.length,1);assert.equal(parsed.officeholders[0].name,"Vito Barbieri");
});

test("a list header and a different member's entry cannot lend fields to a profile route",()=>{
  const parsed=parse(html.replace(/<div class="member"><img src="\/vito.jpg">[\s\S]*?<\/div><\/div>/,""));
  assert.deepEqual(parsed.officeholders.map(person=>person.name),["Jane Member"]);
  assert.equal(parsed.officeholders[0].phone,"208-555-0004");
});

test("two named entries in different districts cannot lend one held person's ID to each other",()=>{
  const body='<h1>Representatives</h1><article><a href="/members/one">Vito Barbieri</a><p>District 3</p><img alt="Vito Barbieri" src="/one.jpg"></article><article><a href="/members/two">Vito Barbieri</a><p>District 4</p><img alt="Vito Barbieri" src="/two.jpg"></article>';
  const parsed=parse(body,roster([people[0]]));assert.equal(parsed.officeholders.length,2);
  const native=parsed.officeholders.filter(person=>person.nativeIds?.["ocd-person"]?.includes("ocd-person/vito"));
  assert.equal(native.length,1);assert.equal(native[0].memberships?.[0].district,"3");
});

test("an old document-link record returns its IDs to the explicitly headed member, never a whole chamber",()=>{
  const profile="https://legislature.example.gov/members/vito";
  const old=emptyPerson("old-news-link","Policy Roundtable","State Representative","ID",provenance(profile,"State legislature",at));old.chamber="lower";
  old.nativeIds={"official-legislature":["https://legislature.example.gov/policy-roundtable.pdf"],reader:["old-news-alias"]};
  const member={...people[0],websiteUrl:profile};
  const body='<h1>Legislature</h1><div><h2>Representative Vito Barbieri</h2><p>District 3</p><img src="/vito.jpg"></div><article><a href="/policy-roundtable.pdf">Policy Roundtable</a></article>';
  const parsed=normalizeOfficialLegislaturePage(body,profile,{sourceId:"official-state-people",state:"id",asOf:at,signal:new AbortController().signal,roster:roster([member,old])},at);
  assert.equal(parsed.officeholders.length,1);assert.ok(personIdentityKeys(parsed.officeholders[0]).has(old.id));
  const merged=mergePeopleSets([roster([member,old]),parsed])!;
  assert.equal(merged.officeholders.length,1);assert.equal(merged.officeholders[0].name,member.name);
  assert.ok(personIdentityKeys(merged.officeholders[0]).has("old-news-alias"));
  const shared=parse(html,{...roster([...people,old]),officeholders:[...people,{...old,provenance:{...old.provenance,sourceUrl:page}}]});
  assert.ok(shared.officeholders.every(person=>!personIdentityKeys(person).has(old.id)));
});

test("a held document entry is repaired by normal publication and an empty portrait save",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),profile="https://legislature.example.gov/members/vito";
  const old=emptyPerson("old-news-link","Policy Roundtable","State Representative","ID",provenance(profile,"State legislature",at,"Policy Roundtable"));old.chamber="lower";
  old.nativeIds={"official-legislature":["https://legislature.example.gov/policy-roundtable.pdf"]};
  const member={...people[0],websiteUrl:profile,provenance:provenance(profile,"State legislature",at,"Vito Barbieri")};
  const body='<h1>Legislature</h1><div><h2>State Representative Vito Barbieri</h2><p>District 3</p><img src="/vito.jpg"></div><article><a href="/policy-roundtable.pdf">Policy Roundtable</a></article>';
  const base={store,vault,state:"id",sourceId:"official-state-people",now:at,releaseId:"old-doc",acquisitions:[{requestedUrl:profile,finalUrl:profile,body,httpStatus:200,retrievedAt:at}]};
  const held=await publishPeopleSource({...base,roster:roster([member,old])});assert.ok(held.outcome.promoted);
  const parsed=normalizeOfficialLegislaturePage(body,profile,{sourceId:"official-state-people",state:"id",asOf:at,signal:new AbortController().signal,roster:roster([member,old])},at);
  const publication=await publishPeopleSource({...base,releaseId:"doc-owner",now:"2026-10-26T06:01:00.000Z",roster:parsed});
  assert.ok(publication.outcome.promoted,JSON.stringify(publication.outcome.candidate.receipt?.checks));
  assert.equal((publication.candidate.readModel as {roster:OfficeholderSet}).roster.officeholders.length,1);
  const ref=promotedInputRef("STATE_LEGISLATOR",publication.candidate.scope,publication.outcome.promoted.versionId,publication.candidate.readModel,at)!;
  const portraits=await publishPeopleSource({store,vault,state:"id",sourceId:"people-portraits",now:at,releaseId:"doc-portrait",roster:roster([]),bindingPeople:parsed.officeholders,
    held:{versionId:null,normalizedPayload:{},roster:roster([old])},derivedInputs:[ref],acquisitions:[]});
  assert.ok(portraits.outcome.promoted,JSON.stringify(portraits.outcome.candidate.receipt?.checks));
  const person=(portraits.candidate.readModel as {roster:OfficeholderSet}).roster.officeholders[0];
  assert.equal(person.name,"Vito Barbieri");assert.ok(personIdentityKeys(person).has(old.id));
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

test("the member's explicitly quoted nickname still binds the whole entry and its portrait",()=>{
  const ali={...people[0],name:"Ali Rabe"};
  const body=html.replaceAll("Vito Barbieri",'Alison “Ali” Rabe');
  const parsed=parse(body,roster([ali,people[1]]));assert.equal(parsed.officeholders.length,2);
  const member=parsed.officeholders.find(person=>person.nativeIds?.["ocd-person"]?.includes("ocd-person/vito"))!;
  assert.equal(member.portraitCandidate?.imageUrl,"https://legislature.example.gov/vito.jpg");
  assert.equal(member.memberships?.[0].district,"3");
});

test("a published leading initial does not turn one member entry into two people",()=>{
  const scott={...people[0],name:"Scott Grow"};
  const parsed=parse(html.replaceAll("Vito Barbieri","C. Scott Grow"),roster([scott,people[1]]));
  assert.equal(parsed.officeholders.length,2);
  const member=parsed.officeholders.find(person=>person.nativeIds?.["ocd-person"]?.includes("ocd-person/vito"))!;
  assert.equal(member.portraitCandidate?.imageUrl,"https://legislature.example.gov/vito.jpg");
  assert.equal(member.memberships?.[0].district,"3");
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

test("a changed display ID retains every reader reference and refuses a missing or ambiguously bound person",()=>{
  const a=reference("Vito Barbieri","11111111-1111-4111-8111-111111111111","3"),b=reference("Jane Member","22222222-2222-4222-8222-222222222222","4");
  const old={...a,id:b.id,personId:b.personId,nativeIds:{"ocd-person":[...a.nativeIds!["ocd-person"],...b.nativeIds!["ocd-person"]],reader:[a.id,a.personId!,b.id,b.personId!]}};
  const next=[a,b];
  assert.ok(retainsPeopleBindings([old],next));
  assert.ok(!retainsPeopleBindings([old],[a]));
  assert.ok(!retainsPeopleBindings([old],[a,b,{...b,id:"duplicate"}]));
  assert.ok(!retainsPeopleBindings([old],[old]));
  assert.ok(!retainsPeopleBindings([old],[{...a,nativeIds:{...a.nativeIds,reader:[b.id,b.personId!,...b.nativeIds!["ocd-person"]]}}]));
});

test("normal publication accepts an ID correction only while every old reference still resolves",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const a=reference("Vito Barbieri","11111111-1111-4111-8111-111111111111","3"),b=reference("Jane Member","22222222-2222-4222-8222-222222222222","4");
  const bad={...collapsed(),id:b.id,personId:b.personId,nativeIds:{plural:[...a.nativeIds!.plural,...b.nativeIds!.plural],"ocd-person":[...a.nativeIds!["ocd-person"],...b.nativeIds!["ocd-person"]],reader:[a.id,a.personId!,b.id,b.personId!]}};
  const body=`<h2>State Representative</h2>${html}`;
  const input={store,vault,state:"id",sourceId:"official-state-people",now:at,releaseId:"old",acquisitions:[{requestedUrl:page,finalUrl:page,body,httpStatus:200,retrievedAt:at}]};
  const old=await publishPeopleSource({...input,roster:roster([bad])});assert.ok(old.outcome.promoted,JSON.stringify(old.outcome.candidate.receipt?.checks));
  const next=await publishPeopleSource({...input,releaseId:"repaired",now:"2026-10-26T06:01:00.000Z",roster:parse(html,roster([a,b]))});
  assert.ok(next.outcome.promoted,JSON.stringify(next.outcome.candidate.receipt?.checks));
  const current=(next.candidate.readModel as {roster:OfficeholderSet}).roster;
  assert.equal(current.officeholders.length,2);
  assert.ok(retainsPeopleBindings([bad],current.officeholders));
});
