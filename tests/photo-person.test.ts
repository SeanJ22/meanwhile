import assert from "node:assert/strict";
import test from "node:test";
import {personIdentityKeys,sameNativePerson} from "../lib/officials/people-identity.ts";
import { photoForPerson } from "../lib/photos/person.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { primeStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { STATEWIDE_EXECUTIVES, statewideExecutivesFor } from "../lib/officials/statewide-executives.ts";
import { indexByOfficeholderId } from "../lib/officials/lookup.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";

test("same names do not join people and declared native aliases do",()=>{
  const one={id:"plural:az:one",personId:"plural:one",nativeIds:{"az-legislature":["123"]}};
  assert.equal(sameNativePerson(one,{id:"az-legislature:123"}),true);
  assert.equal(sameNativePerson(one,{id:"plural:az:two",personId:"plural:two"}),false);
  assert.ok(personIdentityKeys(one).has("plural:one"));
  assert.equal(personIdentityKeys(one).has("Jane Doe"),false);
});

test("a canonical person and its declared source aliases use one portrait without a name join",()=>{
  const executive=STATEWIDE_EXECUTIVES.find(row=>row.holder.id === 'statewide:nh/governor')!;
  const person:Officeholder={...executive.holder,id:'plural:nh:source-person',personId:'plural:source-person',
    nativeIds:{reader:[executive.holder.id]},sourceHolders:undefined,name:executive.holder.name,level:'STATE',state:'NH',termStart:'',termEnd:'',photo:null,
    provenance:{sourceUrl:executive.sourceUrl,sourceOrg:executive.sourceOrg,collectedAt:executive.collectedAt,verifiedAt:null}};
  const roster:OfficeholderSet={scope:'NH',generatedAt:executive.collectedAt,officeholders:[person],divisions:[],unmatched:[]};
  const runtime={formatVersion:1,registry:{generatedAt:executive.collectedAt,divisions:[],bodies:[]},statewideExecutives:[executive],
    officialPhotos:{photos:[]},officialCandidacies:{formatVersion:1,rule:'EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE',rows:[]},
    bodyRosters:[],rosterPhotos:{},rosterReaderDispositions:[]} as RegistryRuntimeReadModel;
  withReaderAuthorityEdge({},()=>withRegistryRuntimeProjection(runtime,['NH'],()=>{
    primeStatePeopleProjection({formatVersion:1,sourceId:'plural-openstates',jurisdiction:'US-NH',term:'2026',generatedAt:roster.generatedAt,roster});
    assert.equal(photoForPerson(person.personId!,'NH')?.url,executive.holder.photoUrl);
    assert.equal(photoForPerson(person.id,'NH')?.url,executive.holder.photoUrl);
    assert.equal(photoForPerson('unrelated-same-name','NH'),null);
    const card=indexByOfficeholderId([roster]).get(person.id)!;
    assert.equal(card.photoUrl,executive.holder.photoUrl);
    assert.equal(card.fieldSources?.photoUrl.sourceUrl,executive.holder.fieldSources?.photoUrl?.sourceUrl ?? executive.sourceUrl);
    assert.equal(card.id,person.id);assert.equal(card.personId,person.personId);
    const alias={...executive,holder:{...executive.holder,id:'statewide:nh/source-alias',photoUrl:null,
      nativeIds:{reader:[person.personId!]}}};
    withRegistryRuntimeProjection({...runtime,statewideExecutives:[alias,executive]},['NH'],()=>{
      const holders=statewideExecutivesFor([executive.stateOcdId]);
      assert.equal(holders.length,1);
      for (const id of [alias.holder.id,executive.holder.id]) assert.ok(personIdentityKeys(holders[0]).has(id));
      assert.equal(holders[0].photoUrl,executive.holder.photoUrl);
      assert.equal(holders[0].fieldSources?.photoUrl.sourceUrl,executive.sourceUrl);
      assert.equal(holders[0].fieldSources?.partyLabel.sourceUrl,executive.partySourceUrl);
    });
  }));
});

test("CL-01's official statewide source links share a photo before the next source rebuild",()=>{
  const executive=STATEWIDE_EXECUTIVES.find(row=>row.holder.id === 'statewide:az/governor')!;
  const alias={...executive,sourceUrl:'https://raw.githubusercontent.com/openstates/people/current/katie.yml',
    holder:{...executive.holder,id:'statewide:az/native-source',photoUrl:null,websiteUrl:'https://www.usa.gov/states/arizona',
      nativeIds:{plural:['native-person-one']}}};
  const runtime={formatVersion:1,registry:{generatedAt:executive.collectedAt,divisions:[],bodies:[]},statewideExecutives:[alias,executive],
    officialPhotos:{photos:[]},officialCandidacies:{formatVersion:1,rule:'EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE',rows:[]},
    bodyRosters:[],rosterPhotos:{},rosterReaderDispositions:[]} as RegistryRuntimeReadModel;
  withReaderAuthorityEdge({},()=>withRegistryRuntimeProjection(runtime,['AZ'],()=>{
    assert.equal(photoForPerson(alias.holder.id,'AZ')?.url,executive.holder.photoUrl);
    assert.equal(photoForPerson('plural:native-person-one','AZ')?.url,executive.holder.photoUrl);
    const holders=statewideExecutivesFor([executive.stateOcdId]);
    assert.deepEqual(holders.map(holder=>holder.photoUrl),[executive.holder.photoUrl]);
    for (const id of [alias.holder.id,executive.holder.id]) assert.ok(personIdentityKeys(holders[0]).has(id));
    const conflicting={...alias,holder:{...alias.holder,id:'statewide:az/other-native-source',nativeIds:{plural:['native-person-two']}}};
    withRegistryRuntimeProjection({...runtime,statewideExecutives:[alias,executive,conflicting]},['AZ'],()=>{
      assert.equal(photoForPerson(alias.holder.id,'AZ'),null);
      assert.equal(photoForPerson(conflicting.holder.id,'AZ'),null);
      assert.equal(photoForPerson(executive.holder.id,'AZ')?.url,executive.holder.photoUrl);
    });
  }));
});

test("a held record that collapsed several OpenStates people links none of them to each other's portraits",()=>{
  const at='2026-10-15T00:00:00.000Z';
  const provenance={sourceUrl:'https://legislature.idaho.gov/house/membership/',sourceOrg:'Idaho Legislature',collectedAt:at,verifiedAt:null};
  const person=(id:string,personId:string,collectedAt:string,nativeIds?:Record<string,string[]>):Officeholder=>({id,personId,nativeIds,name:id,
    officeTitle:'State Representative',level:'STATE',state:'ID',termStart:'',termEnd:'',provenance,
    photo:{url:`/officials/${personId}.jpg`,sourceUrl:`https://example.org/${personId}.jpg`,attribution:null,license:'Public domain',collectedAt}}) as Officeholder;
  const one=person('plural:id:one','plural:one','2026-01-01T00:00:00.000Z');
  const two=person('plural:id:two','plural:two','2026-03-01T00:00:00.000Z');
  // One official record that absorbed every member sharing the chamber's membership page.
  const collapsed=person('official-legislature:id:collapsed','official-legislature:collapsed','2026-02-01T00:00:00.000Z',
    {plural:['one','two'],'ocd-person':['one','two'],reader:['plural:id:one','plural:one','plural:id:two','plural:two']});
  const roster:OfficeholderSet={scope:'ID',generatedAt:at,officeholders:[one,two,collapsed],divisions:[],unmatched:[]};
  withReaderAuthorityEdge({},()=>{
    primeStatePeopleProjection({formatVersion:1,sourceId:'plural-openstates',jurisdiction:'US-ID',term:'2026',generatedAt:at,roster});
    assert.equal(photoForPerson(one.personId!,'ID')?.url,one.photo!.url);
    assert.equal(photoForPerson(two.personId!,'ID')?.url,two.photo!.url);
    assert.equal(photoForPerson(collapsed.id,'ID')?.url,collapsed.photo!.url);
  });
});
