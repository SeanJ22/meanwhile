import { getRegistryRuntimeReadModel, selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { portraitBindingMatches, type PortraitVerification } from "./binding.ts";
import { currentStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { personIdentityKeys, type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import { currentDerivedCandidatePortraits } from "../civic-data/derived-campaign-sites.ts";
import type { Officeholder } from "../officials/types.ts";
import type { Provenance } from "../sources/types.ts";
import { sameSourcedExecutivePerson } from "../registry/candidacy-holder-identity.ts";
import type { StatewideExecutive } from "../officials/statewide-executives.ts";

export interface PersonPhoto {
  url: string;
  source: string;
  verification?: PortraitVerification;
  provenance?: Provenance;
}

function candidatePhoto(id:string,url:string,source:string,verification?:PortraitVerification,collectedAt=""):PersonPhoto & {id:string} {
  const capture=verification?.sources[0];
  return {id,url,source,verification,provenance:{
    sourceUrl:verification?.attribution?.sourceUrl ?? capture?.url ?? (/^https?:\/\//.test(source) ? source : url),
    sourceOrg:source,collectedAt:capture?.retrievedAt ?? collectedAt,verifiedAt:verification?.checkedAt ?? null,
  }};
}

const rosterPhotos=new WeakMap<readonly Officeholder[],ReadonlyMap<string,Officeholder[]>>();
function matchingPortraits(people:readonly Officeholder[],keys:ReadonlySet<string>):Officeholder[] {
  let index=rosterPhotos.get(people);
  if(!index){const built=new Map<string,Officeholder[]>();for(const person of people)if(person.photo)
    for(const key of personIdentityKeys(person))built.set(key,[...built.get(key) ?? [],person]);index=built;rosterPhotos.set(people,index);}
  return [...new Set([...keys].flatMap(key=>index.get(key) ?? []))];
}

type NativePerson=Pick<Officeholder,'id'|'personId'|'nativeIds'>;
const nativeAliases=new WeakMap<object,ReadonlyMap<string,readonly string[]>>();
function aliasIndex(source:object,people:()=>readonly NativePerson[]):ReadonlyMap<string,readonly string[]> {
  let index=nativeAliases.get(source);
  if(!index){const built=new Map<string,readonly string[]>();for(const person of people()){
    const aliases=[...personIdentityKeys(person)];for(const key of aliases)built.set(key,[...new Set([...built.get(key) ?? [],...aliases])]);
  }index=built;nativeAliases.set(source,index);}
  return index;
}

const statewideAliases=new WeakMap<readonly StatewideExecutive[],ReadonlyMap<string,readonly string[]>>();
function statewideAliasIndex(people:readonly StatewideExecutive[]):ReadonlyMap<string,readonly string[]> {
  const index=statewideAliases.get(people);
  if(index)return index;
  const aliases=new Map(aliasIndex(people,()=>people.map(row=>row.holder)));
  const holders=people.map(row=>({...row.holder,authority:'REGISTRY_STATEWIDE_EXECUTIVE' as const,
    sourceUrl:row.sourceUrl,officialProfileUrl:row.holder.websiteUrl,divisions:[row.stateOcdId]}));
  const remaining=new Set(holders);
  while(remaining.size){
    const pending=[remaining.values().next().value!],linked:typeof holders=[];
    while(pending.length){
      const holder=pending.pop()!;
      if(!remaining.delete(holder))continue;
      linked.push(holder);
      for(const other of remaining)if(sameSourcedExecutivePerson(holder,other))pending.push(other);
    }
    // Use CL-01's same pairwise rule as its publication path. An unidentified
    // office slot cannot bridge two conflicting native people.
    if(!linked.every(left=>linked.every(right=>sameSourcedExecutivePerson(left,right))))continue;
    const keys=[...new Set(linked.flatMap(person=>[...personIdentityKeys(person)]))];
    for(const key of keys)aliases.set(key,[...new Set([...aliases.get(key) ?? [],...keys])]);
  }
  statewideAliases.set(people,aliases);return aliases;
}

/** CL-01's person links and the held sources' native aliases form one person. */
function portraitPersonKeys(subjectId:string,state?:string):Set<string> {
  const indexes:ReadonlyMap<string,readonly string[]>[]=[];
  for(const selected of new Set([...selectedRegistryStates(),...state ? [state.toUpperCase()] : []])) {
    const people=currentStatePeopleProjection(`US-${selected}` as StatePeopleJurisdiction)?.roster.officeholders;
    if(people)indexes.push(aliasIndex(people,()=>people));
  }
  try {const people=getFederalOfficeholderSet().officeholders;indexes.push(aliasIndex(people,()=>people));} catch { /* This request has no federal directory. */ }
  try {
    const runtime=getRegistryRuntimeReadModel();
    indexes.push(statewideAliasIndex(runtime.statewideExecutives),
      aliasIndex(runtime.bodyRosters,()=>runtime.bodyRosters.flatMap(row=>row.members)));
  } catch { /* Source-native identities remain usable without registry enrichment. */ }
  const keys=new Set<string>(),pending=[subjectId];
  while(pending.length){const key=pending.shift()!;if(keys.has(key))continue;keys.add(key);
    try {const identity=readerPersonKeys(key);
      // An unresolved ballot/funding bridge supplies no extra aliases. It does
      // not suppress this person's independently verified official portrait.
      if(identity.status !== 'IDENTITY_UNRESOLVED')for(const related of identity.keys)if(!keys.has(related))pending.push(related);
    } catch { /* An unavailable enrichment never discards an exact native identity. */ }
    for(const index of indexes)for(const related of index.get(key) ?? [])if(!keys.has(related))pending.push(related);
  }
  return keys;
}

/** Exact committed identity relationships only; a name is display text. */
export function officialPhotoForPerson(subjectId: string,state?:string): PersonPhoto | null {
  const keys=portraitPersonKeys(subjectId,state);
  if(!keys.size)return null;
  const states=state ? [...new Set([...selectedRegistryStates(),state.toUpperCase()])] : selectedRegistryStates();
  const holders = states.flatMap(state => {
    const people=currentStatePeopleProjection(`US-${state}` as StatePeopleJurisdiction)?.roster.officeholders;
    return people ? matchingPortraits(people,keys) : [];
  });
  try { holders.push(...matchingPortraits(getFederalOfficeholderSet().officeholders,keys)); } catch { /* No federal projection in this request. */ }
  const held = holders
    .sort((a,b) => (b.photo?.verification?.checkedAt ?? b.photo?.collectedAt ?? "").localeCompare(a.photo?.verification?.checkedAt ?? a.photo?.collectedAt ?? "") || a.id.localeCompare(b.id))[0];
  if (held?.photo) return {url:held.photo.url,source:[held.photo.license,held.photo.attribution].filter(Boolean).join(" — ") || "Official portrait",
    verification:held.photo.verification,provenance:held.fieldSources?.photo ?? {
      sourceUrl:held.photo.verification?.attribution?.sourceUrl ?? held.photo.sourceUrl,sourceOrg:held.provenance.sourceOrg,
      collectedAt:held.photo.collectedAt,verifiedAt:held.photo.verification?.checkedAt ?? null}};
  let runtime: ReturnType<typeof getRegistryRuntimeReadModel>;
  try {runtime = getRegistryRuntimeReadModel();} catch {return null;}
  const photos = runtime.officialPhotos.photos.filter(row => keys.has(row.personId ?? row.officeholderId) || keys.has(row.officeholderId))
    .filter(row => row.verification ? portraitBindingMatches(row.personId ?? row.officeholderId,row) : Boolean(row.license))
    .sort((a,b)=>(b.collectedAt ?? "").localeCompare(a.collectedAt ?? "") || a.officeholderId.localeCompare(b.officeholderId));
  const photo = photos[0];
  if (photo) return {url:photo.url,source:[photo.license,photo.attribution].filter(Boolean).join(" — ") || "Official portrait published by the office",verification:photo.verification,
    provenance:{sourceUrl:photo.verification?.attribution?.sourceUrl ?? photo.sourceUrl ?? photo.url,
      sourceOrg:[photo.license,photo.attribution].filter(Boolean).join(" — ") || "Official portrait",
      collectedAt:photo.collectedAt ?? "",verifiedAt:photo.verification?.checkedAt ?? null}};
  const executive = runtime.statewideExecutives.find(row => keys.has(row.holder.personId ?? row.holder.id) && row.holder.photoUrl);
  return executive ? {url:executive.holder.photoUrl!,source:executive.sourceOrg ? `Portrait published by ${executive.sourceOrg}` : "Official portrait published by the office",
    provenance:executive.holder.fieldSources?.photoUrl ?? {sourceUrl:executive.sourceUrl,sourceOrg:executive.sourceOrg,collectedAt:executive.collectedAt,verifiedAt:null}} : null;
}

/** All reader surfaces use the same identity links and the same source order. */
export function photoForPerson(subjectId:string, state?:string):PersonPhoto|null {
  const official=officialPhotoForPerson(subjectId,state);
  if(official)return official;
  const keys=portraitPersonKeys(subjectId,state);
  if(!keys.size)return null;
  const candidates:(PersonPhoto & {id:string})[]=[];
  for(const selected of state ? [state.toUpperCase()] : selectedRegistryStates()) {
    try {
      const profiles=currentCandidateProfilesProjection(selected);
      for(const [id,card] of Object.entries(profiles.cards.cards)) if(card.photoUrl && (keys.has(id) || card.personId && keys.has(card.personId)))
        candidates.push(candidatePhoto(id,card.photoUrl,card.photoSource ?? "Campaign portrait",card.photoVerification,profiles.cards.curatedAt));
      for(const row of currentDerivedCandidatePortraits(selected)) if(row.portrait.photoUrl && [row.id,row.candidacyId,row.portrait.personId].some(id=>id && keys.has(id)))
        candidates.push(candidatePhoto(row.id,row.portrait.photoUrl,row.portrait.photoSource ?? "Campaign portrait",row.portrait.photoVerification));
    } catch { /* Unavailable enrichment retains the photo already on the reader's record. */ }
  }
  return candidates.sort((a,b)=>(b.verification?.checkedAt ?? "").localeCompare(a.verification?.checkedAt ?? "") || a.id.localeCompare(b.id))[0] ?? null;
}
