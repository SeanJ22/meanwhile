import { getRegistryRuntimeReadModel, selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { portraitBindingMatches, type PortraitVerification } from "./binding.ts";
import { currentStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { personIdentityKeys, type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import { currentDerivedCandidatePortraits } from "../civic-data/derived-campaign-sites.ts";
import type { Officeholder } from "../officials/types.ts";

export interface PersonPhoto {
  url: string;
  source: string;
  verification?: PortraitVerification;
}

const rosterPhotos=new WeakMap<readonly Officeholder[],ReadonlyMap<string,Officeholder[]>>();
function matchingPortraits(people:readonly Officeholder[],keys:ReadonlySet<string>):Officeholder[] {
  let index=rosterPhotos.get(people);
  if(!index){const built=new Map<string,Officeholder[]>();for(const person of people)if(person.photo)
    for(const key of personIdentityKeys(person))built.set(key,[...built.get(key) ?? [],person]);index=built;rosterPhotos.set(people,index);}
  return [...new Set([...keys].flatMap(key=>index.get(key) ?? []))];
}

/** Exact committed identity relationships only; a name is display text. */
export function officialPhotoForPerson(subjectId: string,state?:string): PersonPhoto | null {
  let keys = new Set([subjectId]);
  try {
    const identity = readerPersonKeys(subjectId);
    if (identity.status === "IDENTITY_UNRESOLVED") return null;
    keys = new Set(identity.keys);
  } catch { /* No identity holding is a direct-id lookup, never a name fallback. */ }
  const states=state ? [...new Set([...selectedRegistryStates(),state.toUpperCase()])] : selectedRegistryStates();
  const holders = states.flatMap(state => {
    const people=currentStatePeopleProjection(`US-${state}` as StatePeopleJurisdiction)?.roster.officeholders;
    return people ? matchingPortraits(people,keys) : [];
  });
  try { holders.push(...matchingPortraits(getFederalOfficeholderSet().officeholders,keys)); } catch { /* No federal projection in this request. */ }
  const held = holders
    .sort((a,b) => (b.photo?.verification?.checkedAt ?? b.photo?.collectedAt ?? "").localeCompare(a.photo?.verification?.checkedAt ?? a.photo?.collectedAt ?? "") || a.id.localeCompare(b.id))[0];
  if (held?.photo) return {url:held.photo.url,source:[held.photo.license,held.photo.attribution].filter(Boolean).join(" — ") || "Official portrait",
    verification:held.photo.verification};
  let runtime: ReturnType<typeof getRegistryRuntimeReadModel>;
  try {runtime = getRegistryRuntimeReadModel();} catch {return null;}
  const photos = runtime.officialPhotos.photos.filter(row => keys.has(row.personId ?? row.officeholderId) || keys.has(row.officeholderId))
    .filter(row => row.verification ? portraitBindingMatches(row.personId ?? row.officeholderId,row) : Boolean(row.license))
    .sort((a,b)=>(b.collectedAt ?? "").localeCompare(a.collectedAt ?? "") || a.officeholderId.localeCompare(b.officeholderId));
  const photo = photos[0];
  if (photo) return {url:photo.url,source:[photo.license,photo.attribution].filter(Boolean).join(" — ") || "Official portrait published by the office",verification:photo.verification};
  const executive = runtime.statewideExecutives.find(row => keys.has(row.holder.personId ?? row.holder.id) && row.holder.photoUrl);
  return executive ? {url:executive.holder.photoUrl!,source:executive.sourceOrg ? `Portrait published by ${executive.sourceOrg}` : "Official portrait published by the office"} : null;
}

/** All reader surfaces use the same identity links and the same source order. */
export function photoForPerson(subjectId:string, state?:string):PersonPhoto|null {
  const official=officialPhotoForPerson(subjectId,state);
  if(official)return official;
  let keys=new Set([subjectId]);
  try {const identity=readerPersonKeys(subjectId);if(identity.status === "IDENTITY_UNRESOLVED")return null;keys=new Set(identity.keys);} catch { /* Direct identity still resolves its own photograph. */ }
  const candidates:{id:string;url:string;source:string;verification?:PortraitVerification}[]=[];
  for(const selected of state ? [state.toUpperCase()] : selectedRegistryStates()) {
    try {
      for(const [id,card] of Object.entries(currentCandidateProfilesProjection(selected).cards.cards)) if(card.photoUrl && (keys.has(id) || card.personId && keys.has(card.personId)))
        candidates.push({id,url:card.photoUrl,source:card.photoSource ?? "Campaign portrait",verification:card.photoVerification});
      for(const row of currentDerivedCandidatePortraits(selected)) if(row.portrait.photoUrl && [row.id,row.candidacyId,row.portrait.personId].some(id=>id && keys.has(id)))
        candidates.push({id:row.id,url:row.portrait.photoUrl,source:row.portrait.photoSource ?? "Campaign portrait",verification:row.portrait.photoVerification});
    } catch { /* Unavailable enrichment retains the photo already on the reader's record. */ }
  }
  return candidates.sort((a,b)=>(b.verification?.checkedAt ?? "").localeCompare(a.verification?.checkedAt ?? "") || a.id.localeCompare(b.id))[0] ?? null;
}
