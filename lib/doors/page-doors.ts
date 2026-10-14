import { createHash } from "node:crypto";
import { FRESHNESS_WINDOW_HOURS } from "../control-plane/promotion/section3.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { recordSourceDisposition } from "./source-capture.ts";
import { classifySourceContent, SOURCE_FAMILIES } from "./source-content.ts";
import type { ScoutResult } from "../control-plane/scheduler/scout-result.ts";
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

/** The address a door is keyed on: no fragment, no tracking noise, no trailing slash. */
export function pageAddress(raw: string): { readonly url: string; readonly host: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const host = normalizeHost(parsed.hostname);
  if (host === null) return null;
  parsed.hash = "";
  const path = parsed.pathname.replace(/\/+$/, "");
  const keep = [...parsed.searchParams.entries()].filter(([key]) => !/^(utm_|fbclid$|gclid$)/i.test(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = keep.length === 0 ? "" : `?${new URLSearchParams(keep).toString()}`;
  return { url: `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ""}${path}${query}`, host };
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

/** The sources a recorded Scout or detective result found: each candidate's page, with what it was found for. */
export function foundPages(result: ScoutResult): PublishedPage[] {
  if (result.refusal !== null || !Array.isArray(result.candidates)) return [];
  const foundBy = finderOfRole(result.researchRole);
  return result.candidates.flatMap((candidate) => typeof candidate?.url === "string"
    ? [{ url: candidate.url, retrievedAt: result.recordedAt, recordClass: candidate.recordClass || result.recordClass, bodyId: null, ocdId: divisionOfPage(result.subjectId), workItemId: result.workItemId, foundBy }]
    : []);
}

export type SourceCaptureReader = (id: string) => Promise<{ canonicalUrl: string; text: string; contentType?: string }>;
export function namesOfDivision(id: string | null | undefined): string[] {
  return id?.split("/").slice(3).map(part => part.split(":").slice(1).join(":").split("#")[0]!.replace(/[_-]/g, " ")) ?? [];
}
export async function recordFoundSources(repos: Pick<ControlPlaneRepositories, "doors" | "fieldManual">, results: readonly ScoutResult[], now: string, readCapture: SourceCaptureReader): Promise<PageDoorsResult> {
  const pages: PublishedPage[] = [];
  const seen = new Set<string>();
  for (const result of results) for (const page of foundPages(result)) {
    const address = pageAddress(page.url);
    if (!address || seen.has(address.url)) continue;
    seen.add(address.url);
    const names = namesOfDivision(result.subjectId);
    let captured = false;
    const candidate = result.candidates.find(candidate => candidate.url === page.url)!;
    for (const id of candidate.evidenceArtifactIds) {
      try {
        const capture = await readCapture(id);
        if (pageAddress(capture.canonicalUrl)?.url !== pageAddress(page.url)?.url) continue;
        const content = { text: capture.text, contentType: capture.contentType ?? "", names };
        const disposition = classifySourceContent({ url: page.url, ...content, owed: SOURCE_FAMILIES });
        await recordSourceDisposition(repos, { url: address.url, ocdId: page.ocdId ?? result.subjectId,
          state: /\/state:([a-z]{2})/.exec(result.subjectId)?.[1] ?? "us", names, disposition }, id, now);
        pages.push({ ...page, content });
        captured = true;
        break;
      } catch { /* An unread capture cannot establish a publishing source. */ }
    }
    if (!captured) await recordSourceDisposition(repos, { url: address.url, ocdId: page.ocdId ?? result.subjectId,
      state: /\/state:([a-z]{2})/.exec(result.subjectId)?.[1] ?? "us", names,
      disposition: { kind: "SKIP", family: null, recordClass: null, belongs: false, quote: "", reason: "Target content is not held; a linking page is not evidence of what it holds" } }, null, now);
  }
  const counts = await recordPages(repos.doors, pages, now, false);
  return { ...counts, skipped: counts.skipped + results.flatMap(foundPages).length - pages.length };
}

async function recordPages(repo: DoorRepository, pages: readonly PublishedPage[], now: string, worked: boolean): Promise<PageDoorsResult> {
  let created = 0, updated = 0, unchanged = 0, skipped = 0;
  const seen = new Set<string>();
  for (const page of pages) {
    const url = pageAddress(page.url)?.url;
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    try {
      if (!page.content || classifySourceContent({ url: page.url, ...page.content, owed: SOURCE_FAMILIES }).kind !== "DOOR") { skipped++; continue; }
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
