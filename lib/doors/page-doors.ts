/**
 * DB-54: pages that feed live facts become doors.
 *
 * Only meeting wiring and a fixed list of feeds are doors from the start. A
 * roster, contact, comment-rule or directory page that a Scout or detective
 * found is not, until a fact from it goes live. When a worker publishes a
 * fact from a saved page, that page gets a door record: its host, what it
 * holds, how often it is due (the fact class's freshness window), and who
 * found it. The registry then grows with every mission (design §6.3).
 *
 * Nothing here names a place. Not every publication writes a door: a page that
 * published nothing, or one that is not a plain web address, adds none.
 */

import { createHash } from "node:crypto";
import { FRESHNESS_WINDOW_HOURS } from "../control-plane/promotion/section3.ts";
import { MAX_CHECK_MINUTES, MIN_CHECK_MINUTES, normalizeHost, upsertDerivedDoor, isDoorRecord, type DoorDraft, type DoorRepository } from "./registry.ts";

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
  readonly foundBy: PageFinder | null;
}

/** The registry's name for a record class, as door records hold them. */
export const holdsOf = (recordClass: string): string => recordClass.toLowerCase().replace(/_/g, "-");

/** How often a page is due: its fact class's freshness window, in minutes, within the registry's bounds. */
export function checkEveryFor(recordClass: string): number {
  const hours = FRESHNESS_WINDOW_HOURS[recordClass] ?? DEFAULT_WINDOW_HOURS;
  return Math.min(MAX_CHECK_MINUTES, Math.max(MIN_CHECK_MINUTES, Math.round(hours * 60)));
}

/** The address a door is keyed on: no fragment, no tracking noise, no trailing slash. */
export function pageAddress(raw: string): { readonly url: string; readonly host: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = normalizeHost(parsed.hostname);
  if (host === null) return null;
  parsed.hash = "";
  const path = parsed.pathname.replace(/\/+$/, "");
  const keep = [...parsed.searchParams.entries()].filter(([key]) => !/^(utm_|fbclid$|gclid$)/i.test(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = keep.length === 0 ? "" : `?${keep.map(([k, v]) => `${k}=${v}`).join("&")}`;
  return { url: `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ""}${path}${query}`, host };
}

/** A page door's id: the record class it holds, its host, and a short hash of the address. Stable across passes. */
export function pageDoorId(recordClass: string, address: { readonly url: string; readonly host: string }): string {
  return `page:${holdsOf(recordClass)}:${address.host}:${createHash("sha256").update(address.url).digest("hex").slice(0, 12)}`;
}

const FOUND_BY_NOTE: Record<PageFinder, string> = { SCOUT: "Found by a Scout.", DETECTIVE: "Found by a detective." };

/** The record a published page becomes, or null when it cannot be one. `foundBy` is kept from an earlier record when this pass does not know it. */
export function pageDoorDraft(page: PublishedPage, earlierFoundBy: PageFinder | null = null): DoorDraft | null {
  const address = pageAddress(page.url);
  if (address === null || address.url.length > 1900 || page.recordClass.trim() === "") return null;
  const foundBy = earlierFoundBy ?? page.foundBy;
  return {
    doorId: pageDoorId(page.recordClass, address),
    kind: PAGE_DOOR_KIND,
    ocdId: null,
    bodyIds: page.bodyId ? [page.bodyId] : [],
    hosts: [address.host],
    config: { url: address.url, recordClass: page.recordClass, ...(foundBy ? { foundBy } : {}) },
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

/**
 * Upsert a page door for each published page and mark it as having just worked.
 * A hand edit newer than the page's reading stands. Never throws on a store
 * failure: a published fact stays published whether or not its door record
 * could be written, and the next publication writes it again.
 */
export async function recordPublishedPages(repo: DoorRepository, pages: readonly PublishedPage[], now: string): Promise<PageDoorsResult> {
  let created = 0, updated = 0, unchanged = 0, skipped = 0;
  for (const page of pages) {
    try {
      const probe = pageDoorDraft(page);
      if (probe === null) { skipped += 1; continue; }
      const existing = await repo.read(probe.doorId);
      const earlier = existing !== null && isDoorRecord(existing.value) ? (existing.value.config.foundBy as PageFinder | undefined) ?? null : null;
      const draft = earlier === null ? probe : pageDoorDraft(page, earlier)!;
      const verdict = await upsertDerivedDoor(repo, draft, page.retrievedAt, now);
      if (verdict === "created") created += 1;
      else if (verdict === "updated") updated += 1;
      else unchanged += 1;
      await stampSuccess(repo, draft.doorId, page.retrievedAt, now);
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
