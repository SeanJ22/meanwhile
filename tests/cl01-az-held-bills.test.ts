import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {mergePeopleSets} from "../lib/officials/merge-people.ts";
import {nativePersonIdFromUrl,personIdentityKeys} from "../lib/officials/people-identity.ts";
import {hydrateBillPart,type BillPart} from "../lib/sources/legiscan/bills.ts";
import type {Officeholder,OfficeholderSet} from "../lib/officials/types.ts";
import {portraitBindingMatches} from "../lib/photos/binding.ts";
import {toSeatHolder} from "../lib/officials/lookup.ts";
import {heldPersonSources} from "../lib/officials/held-sources.ts";

const captured=JSON.parse(readFileSync(new URL("./fixtures/cl01-az-person-native-profiles.json",import.meta.url),"utf8")) as {key:string;version:string;roster:OfficeholderSet}[];
const official=captured.find(row=>row.key==="STATE_LEGISLATOR:US-AZ")!.roster;
const plural=captured.find(row=>row.key.endsWith(":openstates-people:v1"))!.roster;
const betty=official.officeholders.find(person=>person.id==="az-legislature:2346")!;
const reference=plural.officeholders.find(person=>person.name==="Betty Villegas")!;
const roster=(person:Officeholder):OfficeholderSet=>({scope:"US-AZ",generatedAt:official.generatedAt,officeholders:[person],divisions:[],unmatched:[]});
const pair=(source:Officeholder,target=betty)=>mergePeopleSets([roster(source),roster(target)])!;

test("held short Arizona official URLs resolve exact member IDs and reject broad or off-host links",()=>{
  for(const [url,id] of [["https://www.azleg.gov/senate-member/?legislature=57&legislator=2381","2381"],["https://www.azleg.gov/house-member/?legislature=57&session=129&legislator=2346","2346"],["https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2312","2312"]])assert.deepEqual(nativePersonIdFromUrl(url),{source:"az-legislature",id});
  for(const url of ["https://www.azleg.gov/memberroster/?body=H&legislator=2346","https://example.com/house-member/?legislator=2346","https://www.azleg.gov.evil.test/house-member/?legislator=2346","https://www.azleg.gov/House/House-member/other?legislator=2346","https://www.azleg.gov/house-member/?legislator=2346&legislator=2274","ftp://www.azleg.gov/house-member/?legislator=2346"])assert.equal(nativePersonIdFromUrl(url),null,url);
});

test("exact current official profile IDs connect each held person while all historical source aliases survive",()=>{
  for(const sets of [[plural,official],[official,plural]]){
    const merged=mergePeopleSets(sets)!;
    assert.equal(merged.officeholders.length,3);
    for(const source of [...plural.officeholders,...official.officeholders]){
      const matches=merged.officeholders.filter(person=>personIdentityKeys(person).has(source.id));
      assert.equal(matches.length,1,source.id);
      for(const key of personIdentityKeys(source))assert.ok(personIdentityKeys(matches[0]).has(key),key);
    }
    const current=merged.officeholders.find(person=>personIdentityKeys(person).has(betty.id))!;
    assert.ok(personIdentityKeys(current).has("az-legislature:2274"),"a historical ID carried by Betty's own Plural record remains her alias");
  }
});

test("the merged native identities select only their own held bill sponsors",()=>{
  const people=mergePeopleSets([plural,official])!.officeholders;
  const examples=[
    {id:"az-legislature:2381",uuid:"3c965e03-1e51-4f10-a037-4fb2f35292c5",peopleId:10704,billId:2078606,number:"HB2316",title:"Middle school students; CTE courses",government:"84053"},
    {id:"az-legislature:2346",uuid:"81d12f3a-b635-4111-be8d-a71d2f7565f2",peopleId:24950,billId:2073716,number:"HB2293",title:"Public policy; wage contracts; repeal",government:"84028"},
    {id:"az-legislature:2312",uuid:"6dba6afa-b274-4273-b8c6-270d27214eee",peopleId:20571,billId:2080349,number:"HB2393",title:"Alternative products; furnishing underage persons",government:"84154"},
  ];
  const part:BillPart={kind:"PART",parserVersion:"legiscan-bulk/4",capturedAt:"2026-10-24T16:14:26.678Z",state:"AZ",dataset:{state_id:3,session_id:2235,session_name:"Fifty-seventh Legislature - Second Regular Session (2026)",dataset_hash:"83f2c678f12c01973028288d930b4e44",dataset_date:"2026-09-06"},counts:{rows:3,joined:3,unjoined:0,sponsorsJoined:3,sponsorsUnjoined:0},
    sponsors:examples.map(row=>({peopleId:row.peopleId,name:people.find(person=>personIdentityKeys(person).has(row.id))!.name,committee:false,nativeIds:{legiscan:[String(row.peopleId)],"ocd-person":[`ocd-person/${row.uuid}`]},officeholderId:`plural:az:${row.uuid}`,joinReason:null})),
    bills:examples.map((row,index)=>({id:`legiscan:bill:${row.billId}`,billId:row.billId,state:"AZ",sessionId:2235,sessionName:"2026",ocdId:"ocd-division/country:us/state:az",fips:"04",number:row.number,title:row.title,description:row.title,status:1,statusLabel:"Introduced",statusDate:null,sourceUrl:`https://legiscan.com/AZ/bill/${row.number}/2026`,governmentUrl:`https://apps.azleg.gov/BillStatus/BillOverview/${row.government}`,governmentSourceOfficial:true,sponsorRefs:[index],texts:[]}))};
  for(const row of examples){
    const person=people.find(person=>personIdentityKeys(person).has(row.id))!;
    const own=hydrateBillPart(part,person);
    assert.deepEqual(own.map(bill=>bill.id),[`legiscan:bill:${row.billId}`]);
    assert.equal(own[0].governmentUrl,`https://apps.azleg.gov/BillStatus/BillOverview/${row.government}`);
  }
});

test("a verified own portrait follows only its proven native person alias and keeps every image/source proof",()=>{
  const portraits=captured.find(row=>row.key.endsWith(":people:portraits:v1"))!.roster;
  const merged=mergePeopleSets([plural,official,portraits])!;
  for(const source of portraits.officeholders){
    assert.ok(source.photo);
    const person=merged.officeholders.find(person=>personIdentityKeys(person).has(source.id))!;
    assert.ok(person.photo);
    assert.ok(portraitBindingMatches(person.personId??person.id,person.photo));
    assert.deepEqual({...person.photo.verification,personId:source.photo.verification!.personId},source.photo.verification);
    assert.equal(person.photo.url,source.photo.url);
    assert.equal(person.photo.sourceUrl,source.photo.sourceUrl);
  }
  const unrelated={...portraits.officeholders.find(row=>row.id===betty.id)!};
  unrelated.photo={...unrelated.photo!,verification:{...unrelated.photo!.verification!,personId:"az-legislature:another-person"}};
  assert.equal(mergePeopleSets([plural,official,roster(unrelated)])!.officeholders.find(row=>personIdentityKeys(row).has(betty.id))!.photo,null,"a portrait bound to another person is not inherited");
});

test("every original held contact, term, membership, social account and source survives behind the merged reader person",()=>{
  const sources=captured.map(row=>row.roster),original=JSON.stringify(sources);
  const merged=mergePeopleSets(sources)!;
  assert.equal(JSON.stringify(sources),original,"merging never rewrites a publisher's held record or original portrait binding");
  for(const source of sources.flatMap(set=>set.officeholders)){
    const person=merged.officeholders.find(person=>personIdentityKeys(person).has(source.id))!;
    const raw=heldPersonSources(person).find(row=>JSON.stringify(row)===JSON.stringify(source));
    assert.deepEqual(raw,source,source.id);
    const holder=toSeatHolder(person),expected=toSeatHolder(source);
    assert.ok(heldPersonSources(holder).some(row=>JSON.stringify(row)===JSON.stringify(expected)),`${source.id}: original reader contact, term, portrait and source metadata remain accessible`);
    for(const field of ["name","officeTitle","termStart","termEnd","birthDate","websiteUrl","contactFormUrl","phone","email","campaignUrl"] as const){
      if(!person[field])continue;
      const selected=person.fieldSources?.[field]??person.provenance;
      assert.ok(heldPersonSources(person).some(row=>row[field]===person[field]&&(row.fieldSources?.[field]??row.provenance).sourceUrl===selected.sourceUrl),`${person.id}: selected ${field} keeps the source that supplied its value`);
    }
  }
});

test("wrong person, seat, publisher identity or stale profile cannot attach another person's native ID",()=>{
  const changed=(changes:Partial<Officeholder>)=>({...structuredClone(reference),websiteUrl:null,profileUrls:["https://www.azleg.gov/house-member/?legislature=57&legislator=2346"],...changes});
  const variants=[
    changed({name:"Rebecca Villegas"}),
    changed({officeTitle:"State Senator",chamber:"upper"}),
    changed({state:"NM"}),
    changed({memberships:reference.memberships?.map(row=>({...row,divisionId:"ocd-division/country:us/state:az/sldl:21"}))}),
    changed({profileUrls:["https://www.azleg.gov/house-member/?legislature=56&legislator=2346"]}),
    changed({profileUrls:["https://www.azleg.gov/memberroster/?body=H"]}),
    changed({profileUrls:["https://other.example/house-member/?legislator=2346"]}),
  ];
  for(const source of variants)assert.equal(pair(source).officeholders.length,2,JSON.stringify({name:source.name,state:source.state,office:source.officeTitle,urls:source.profileUrls}));
  const conflict={...betty,nativeIds:{...betty.nativeIds,"ocd-person":["ocd-person/00000000-0000-4000-8000-000000000001"]}};
  assert.equal(pair(changed({}),conflict).officeholders.length,2,"conflicting exact publisher identities are withheld");
  const statewide="ocd-division/country:us/state:az";
  const broadTarget={...betty,memberships:[...betty.memberships!,{...betty.memberships![0],id:"statewide-target",divisionId:statewide}]};
  const wrongDistrict=changed({memberships:[...reference.memberships!.map(row=>({...row,divisionId:"ocd-division/country:us/state:az/sldl:21"})),{...reference.memberships![0],id:"statewide-source",divisionId:statewide}]});
  assert.equal(pair(wrongDistrict,broadTarget).officeholders.length,2,"a common statewide division cannot hide conflicting current districts");
  assert.equal(pair({...wrongDistrict,name:betty.name},broadTarget).officeholders.length,2,"identical names cannot bypass conflicting district refusal through the existing fallback");
  assert.equal(pair(changed({name:betty.name}),conflict).officeholders.length,2,"identical names cannot bypass conflicting native identity refusal");
  const stale=changed({id:"az-legislature:2274",personId:"az-legislature:2274",name:betty.name,nativeIds:{reader:["az-legislature:2274"],"az-legislature":["2274"]},provenance:{...reference.provenance,sourceUrl:"https://www.azleg.gov/house-member/?legislature=56&legislator=2274"}});
  const held=pair(stale);
  assert.equal(held.officeholders.length,2,"an explicit stale official namespace2274 cannot be reassigned to2346 by a profile or name fallback");
  assert.ok(!personIdentityKeys(held.officeholders.find(person=>person.id===betty.id)!).has(stale.id));
});

test("profile links to multiple distinct held officials remain unresolved",()=>{
  const other={...betty,id:"az-legislature:9999",personId:"az-legislature:9999",nativeIds:{"az-legislature":["9999"]},provenance:{...betty.provenance,sourceUrl:"https://www.azleg.gov/house-member/?legislature=57&legislator=9999"}};
  const source={...reference,profileUrls:["https://www.azleg.gov/house-member/?legislature=57&legislator=2346","https://www.azleg.gov/house-member/?legislature=57&legislator=9999"]};
  assert.equal(mergePeopleSets([roster(source),{...roster(betty),officeholders:[betty,other]}])!.officeholders.length,3);
});
