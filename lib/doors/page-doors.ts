import { createHash } from "node:crypto";
import { FRESHNESS_WINDOW_HOURS } from "../control-plane/promotion/section3.ts";
import { retireSourceDoors } from "./source-capture.ts";
import { classifySourceContent, SOURCE_FAMILIES } from "./source-content.ts";
import { MAX_CHECK_MINUTES, MIN_CHECK_MINUTES, upsertDerivedDoor, isDoorRecord, type DoorDraft, type DoorRepository } from "./registry.ts";
import { pageAddress } from "./page-address.ts";
export { pageAddress } from "./page-address.ts";

export const PAGE_DOOR_KIND = "page";
const DEFAULT_WINDOW_HOURS = 7 * 24;

export type PageFinder = "SCOUT" | "DETECTIVE";

/** One saved page that a published fact came from. */
export interface PublishedPage {
  readonly url: string;
  /** When the page was last read. */
  readonly retrievedAt: string;
  readonly recordClass: string;
  /** The body the page serves, when the publication names one. */
  readonly bodyId?: string | null;
  readonly ocdId?: string | null;
  readonly workItemId?: string | null;
  readonly foundBy: PageFinder | null;
  readonly content?: { readonly text: string; readonly contentType: string; readonly names: readonly string[]; readonly belongsToPlace?: boolean };
}

/** The registry's name for a record class, as door records hold them. */
export const holdsOf = (recordClass: string): string => recordClass.toLowerCase().replace(/_/g, "-");

/** How often a page is due: its fact class's freshness window, in minutes, within the registry's bounds. */
export function checkEveryFor(recordClass: string): number {
  const hours = FRESHNESS_WINDOW_HOURS[recordClass] ?? DEFAULT_WINDOW_HOURS;
  return Math.min(MAX_CHECK_MINUTES, Math.max(MIN_CHECK_MINUTES, Math.round(hours * 60)));
}

export function pageDoorId(address: { readonly url: string; readonly host: string }): string {
  return `page:${address.host}:${createHash("sha256").update(address.url).digest("hex").slice(0, 12)}`;
}

/** The id of the door a published page becomes, or null when the page cannot be one. Same answer as the door record's own id. */
export function doorIdOfPage(recordClass: string, url: string): string | null {
  const address = pageAddress(url);
  return address === null || address.url.length > 1900 || recordClass.trim() === "" ? null : pageDoorId(address);
}

export function divisionOfPage(id: string | null | undefined): string | null {
  return id?.startsWith("ocd-division/") ? id.split("#")[0] : null;
}

const FOUND_BY_NOTE: Record<PageFinder, string> = { SCOUT: "Found by a Scout.", DETECTIVE: "Found by a detective." };

/** The record a published page becomes, or null when it cannot be one. `foundBy` is kept from an earlier record when this pass does not know it. */
export function pageDoorDraft(page: PublishedPage, earlierFoundBy: PageFinder | null = null): DoorDraft | null {
  const address = pageAddress(page.url);
  if (address === null || address.url.length > 1900 || page.recordClass.trim() === "") return null;
  const foundBy = earlierFoundBy ?? page.foundBy;
  return {
    doorId: pageDoorId(address),
    kind: PAGE_DOOR_KIND,
    ocdId: divisionOfPage(page.ocdId ?? page.bodyId),
    bodyIds: page.bodyId ? [page.bodyId] : [],
    hosts: [address.host],
    config: { url: address.url, recordClass: page.recordClass, ...(page.workItemId ? { workItemId: page.workItemId } : {}), ...(foundBy ? { foundBy } : {}) },
    holds: [holdsOf(page.recordClass)],
    checkEveryMinutes: checkEveryFor(page.recordClass),
    notes: foundBy ? FOUND_BY_NOTE[foundBy] : "",
    meeting: null,
    status: "OPEN",
  };
}

export interface PageDoorsResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
}

export async function recordPublishedPages(repo: DoorRepository, pages: readonly PublishedPage[], now: string): Promise<PageDoorsResult> {
  return recordPages(repo, pages, now, true);
}

export function namesOfDivision(id: string | null | undefined): string[] {
  return id?.split("/").slice(3).map(part => part.split(":").slice(1).join(":").split("#")[0]!.replace(/[_-]/g, " ")) ?? [];
}

async function recordPages(repo: DoorRepository, pages: readonly PublishedPage[], now: string, worked: boolean): Promise<PageDoorsResult> {
  let created = 0, updated = 0, unchanged = 0, skipped = 0;
  const seen = new Set<string>();
  for (const page of pages) {
    const url = pageAddress(page.url)?.url;
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    try {
      if (!page.content) { skipped++; continue; }
      const disposition = classifySourceContent({ url: page.url, ...page.content, owed: SOURCE_FAMILIES });
      if (disposition.kind !== "DOOR") {
        await retireSourceDoors(repo, { url: page.url, ocdId: page.ocdId ?? page.bodyId ?? "", workItemId: page.workItemId ?? undefined,
          disposition, capture: { bytes: new TextEncoder().encode(page.content.text), contentType: page.content.contentType } }, now);
        skipped++; continue;
      }
      const probe = pageDoorDraft(page);
      if (probe === null) { skipped += 1; continue; }
      const matches = (await repo.listWhere(["config", "url"], url!)).filter(row => pageAddress(String(row.value.config.url))?.url === url);
      const existing = matches.find(row => row.value.status !== "SUSPENDED") ?? matches[0] ?? null;
      const earlier = existing !== null && isDoorRecord(existing.value) ? (existing.value.config.foundBy as PageFinder | undefined) ?? null : null;
      const proposed = earlier === null ? probe : pageDoorDraft(page, earlier)!;
      const prior = existing !== null && isDoorRecord(existing.value) ? existing.value : null;
      const shared = pages.filter(other => pageAddress(other.url)?.url === url);
      const draft = { ...proposed, kind: prior?.kind ?? proposed.kind, doorId: existing?.id ?? proposed.doorId,
        holds: [...new Set([...(prior?.holds ?? []), ...shared.map(other => holdsOf(other.recordClass))])], ocdId: prior?.ocdId ?? proposed.ocdId ?? null,
        bodyIds: [...new Set([...(prior?.bodyIds ?? []), ...shared.flatMap(other => other.bodyId ? [other.bodyId] : [])])],
        config: { ...prior?.config, ...proposed.config } };
      const verdict = await upsertDerivedDoor(repo, draft, page.retrievedAt, now);
      if (verdict === "created") created += 1;
      else if (verdict === "updated") updated += 1;
      else unchanged += 1;
      for (const duplicate of matches.filter(row => row.id !== draft.doorId && row.value.origin === "DERIVED" && row.value.status !== "SUSPENDED")) {
        await repo.compareAndSet(duplicate.id, duplicate.revision, { ...duplicate.value, status: "SUSPENDED", readNow: false,
          notes: `Publishing source is read through ${draft.doorId}`, updatedAt: now }, now);
      }
      if (worked) await stampSuccess(repo, draft.doorId, page.retrievedAt, now);
    } catch {
      skipped += 1;
    }
  }
  return { created, updated, unchanged, skipped };
}

/** The page was read and a fact from it went live: that is the door's last good read. */
async function stampSuccess(repo: DoorRepository, doorId: string, readAt: string, at: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await repo.read(doorId);
    if (row === null || !isDoorRecord(row.value)) return;
    const door = row.value;
    if (door.lastSuccessAt !== null && Date.parse(door.lastSuccessAt) >= Date.parse(readAt)) return;
    try {
      await repo.compareAndSet(doorId, row.revision, { ...door, lastSuccessAt: readAt, updatedAt: door.updatedAt }, at);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

/** Scout or detective, from the attempt that read the page. Anything else, or no attempt, is a Scout: the finder default. */
export function finderOfRole(role: string | null | undefined): PageFinder {
  return role === "DETECTIVE" ? "DETECTIVE" : "SCOUT";
}
