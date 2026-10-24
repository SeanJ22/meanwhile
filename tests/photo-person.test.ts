import assert from "node:assert/strict";
import test from "node:test";
import {personIdentityKeys,sameNativePerson} from "../lib/officials/people-identity.ts";
import { photoForPerson } from "../lib/photos/person.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { primeStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
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
    nativeIds:{reader:[executive.holder.id]},name:executive.holder.name,level:'STATE',state:'NH',termStart:'',termEnd:'',photo:null,
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
  }));
});
