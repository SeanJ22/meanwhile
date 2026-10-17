import { isTransferableMethod, normalizeEntry, reachOf, recordMethodResults, type FieldManualEntry, type FieldManualRepos } from "./field-manual.ts";

export const CLASS_WIDE_KINDS: ReadonlySet<string> = new Set([
  "PLAYBOOK", "SOURCE_REGISTER", "METHOD_VERSION", "PARSE_FIELDS", "PUBLIC_RECORD_KIND", "CLAIM_LESSON", "LESSON", "WRITE_HEALTH", "MEETINGS_RECIPE",
]);

export type CopiedReach = "PLACE" | "METHOD" | "PLATFORM" | "STATE" | "EVERYWHERE" | "NOWHERE";

export function copiedReach(entry: FieldManualEntry): CopiedReach {
  if (isTransferableMethod(entry)) return "METHOD";
  const reach = entry.reach ?? reachOf(entry);
  if (reach.places.length > 0) return "PLACE";
  if (reach.platforms.length > 0) return "PLATFORM";
  if (reach.states.length > 0) return "STATE";
  return reach.everywhere ? "EVERYWHERE" : "NOWHERE";
}

const named = (e: FieldManualEntry): boolean => (e.ocdIds?.length ?? 0) > 0 || (e.bodyIds?.length ?? 0) > 0;

export function retagForRows(entries: readonly FieldManualEntry[]): FieldManualEntry[] {
  const read=entries.map(normalizeEntry);
  const placesByUrl = new Map<string, { ocdIds: Set<string>; bodyIds: Set<string> }>();
  for (const e of read) {
    if (e.url === null || !named(e)) continue;
    const held = placesByUrl.get(e.url) ?? { ocdIds: new Set<string>(), bodyIds: new Set<string>() };
    for (const id of e.ocdIds ?? []) held.ocdIds.add(id);
    for (const id of e.bodyIds ?? []) held.bodyIds.add(id);
    placesByUrl.set(e.url, held);
  }
  const out = read.map((e) => {
    if (copiedReach(e) !== "NOWHERE") return e;
    const same = e.url === null ? undefined : placesByUrl.get(e.url);
    if (same !== undefined) {
      return normalizeEntry({ ...e, reach: undefined, ...(same.ocdIds.size ? { ocdIds: [...same.ocdIds] } : {}), ...(same.bodyIds.size ? { bodyIds: [...same.bodyIds] } : {}) });
    }
    if (CLASS_WIDE_KINDS.has(e.kind)) {
      return normalizeEntry({ ...e, reach: undefined, portable: true });
    }
    return e;
  });
  return out;
}

export async function copyFieldManualPage(repos:FieldManualRepos,raw:readonly FieldManualEntry[],now:string):Promise<number> {
  const entries=retagForRows(raw);
  const inserted=await repos.fieldManual.insertNew(entries,now);
  const results=await recordMethodResults(repos,entries,now,false);
  if(results.failed>0)throw new Error("Method evidence remains pending in this manual page");
  return inserted.size;
}
