import { detectTenancy } from "../hunt/platform-tenancy.ts";
import { fieldManualEntryId, fieldManualPlaceHints, newFieldManualEntry, type FieldManualEntry } from "./field-manual.ts";

export interface SavedDoorPage { readonly url: string; readonly html: string }

/** A procedure carries the route shape, while its host belongs to the place door. */
export function portableProcedure(procedure: string, doorUrl: string): string {
  let host = "";
  try { host = new URL(doorUrl).hostname; } catch { /* malformed URLs remain evidence, not hosts */ }
  let text = procedure.replace(/https?:\/\/[^\s<>"']+/gi, "{door}");
  if (host) text = text.split(host).join("{host}");
  return text.replace(/\s+/g, " ").trim();
}

/** Only observed platform shapes are shared; an unidentified site is not a platform. */
export function doorMethodEntries(door: FieldManualEntry, pages: readonly SavedDoorPage[] = [], fingerprints?: readonly FieldManualEntry[]): FieldManualEntry[] {
  if (!door.url || !["SCOUT_DISCOVERY", "ROUTE"].includes(door.kind)) return [];
  const payload = door.payload as { procedure?: unknown } | null;
  if (typeof payload?.procedure !== "string" || !payload.procedure.trim()) return [];
  const opened = pages.filter(page => page.url === door.url);
  // A saved, grounded URL can identify a vendor-hosted door; custom domains use saved markup.
  const hits = opened.length ? opened.flatMap(page => detectTenancy(page.html, page.url, fingerprints)) : detectTenancy(door.url, door.url, fingerprints);
  const platforms = [...new Set(hits.map(hit => hit.platform))];
  const procedure = portableProcedure(payload.procedure, door.url);
  const places = fieldManualPlaceHints(door.payload).ocdIds;
  return platforms.flatMap(platform => door.recordClasses.map(recordClass => {
    const key = `${platform}|${recordClass.toLowerCase()}|${procedure.toLowerCase()}`;
    return newFieldManualEntry("door-method", key, {
      role: "SHARED", kind: "METHOD", title: `${platform}: ${recordClass}`,
      summary: procedure, platforms: [platform], recordClasses: [recordClass], outcome: door.outcome,
      observedAt: door.observedAt, foundBy: door.foundBy,
      payload: { platform, recordClass, procedure, places, doorEntryIds: [door.id] },
    });
  }));
}

export function methodId(platform: string, recordClass: string, procedure: string): string {
  return fieldManualEntryId("door-method", `${platform}|${recordClass.toLowerCase()}|${procedure.toLowerCase()}`);
}
