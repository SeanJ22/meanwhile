import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { portraitBindingMatches, type PortraitVerification } from "./binding.ts";

export interface PersonPhoto {
  url: string;
  source: string;
  verification?: PortraitVerification;
}

/** Exact committed identity relationships only; a name is display text. */
export function officialPhotoForPerson(subjectId: string): PersonPhoto | null {
  let keys = new Set([subjectId]);
  try {
    const identity = readerPersonKeys(subjectId);
    if (identity.status === "IDENTITY_UNRESOLVED") return null;
    keys = new Set(identity.keys);
  } catch { /* No identity holding is a direct-id lookup, never a name fallback. */ }
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
