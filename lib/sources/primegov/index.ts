/** @freshness-reads-here */
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import type { LockManager } from "../../control-plane/repository/types.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../../meetings/constants.ts";
import { isPlacelessLocation, resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { recordAcquiredResponse } from "../acquisition-trace.ts";
import { decodeEntities, REQUEST_SPACING_MS } from "../http.ts";
import { acquireKnownRelease, knownReleaseSourceCheck } from "../known-release.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, MeetingQuery, NormalizeDropCounts, PartialScopeFailure, ReportingMeetingSource } from "../types.ts";

export interface PrimeGovDocument {
  id: number;
  templateId?: number | null;
  templateName: string;
  compileOutputType: number;
  link?: string | null;
}

export function parsePrimeGovCommittees(text: string): { id: number; name: string }[] {
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || !Number.isSafeInteger(row.id) || typeof row.name !== "string" || !row.name.trim())) {
    throw new Error("PRIMEGOV_COMMITTEES_SHAPE_CHANGED");
  }
  return rows;
}

export interface PrimeGovMeeting {
  id: number;
  committeeId: number;
  title: string;
  dateTime: string;
  time?: string | null;
  location?: string | null;
  documentList?: PrimeGovDocument[];
  videoUrl?: string | null;
  zoomMeetingLink?: string | null;
  isCancelled?: boolean;
  isCanceled?: boolean;
}

export interface PrimeGovRaw {
  wiring: BodySourceWiring;
  text: string;
  sourceUrl: string;
  collectedAt: string;
  sourceCheck?: ReturnType<typeof knownReleaseSourceCheck>;
  from?: string;
  to?: string;
  partialScopes?: PartialScopeFailure[];
}

export function primeGovBase(portalUrl: string): string {
  const url = new URL(portalUrl);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.primegov\.com$/i.test(url.hostname) || url.username || url.password) {
    throw new Error("PRIMEGOV_PORTAL_INVALID");
  }
  return url.origin;
}

export function parsePrimeGovMeetings(text: string): PrimeGovMeeting[] {
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("PRIMEGOV_MEETINGS_NOT_A_LIST");
  for (const value of rows) {
    const row = value as Partial<PrimeGovMeeting> | null;
    if (!row || !Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.committeeId) || typeof row.title !== "string" ||
      typeof row.dateTime !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/.test(row.dateTime) ||
      !Number.isFinite(Date.parse(row.dateTime)) || (row.documentList !== undefined && !Array.isArray(row.documentList))) {
      throw new Error("PRIMEGOV_MEETING_SHAPE_CHANGED");
    }
    for (const doc of row.documentList ?? []) {
      if (!doc || !Number.isSafeInteger(doc.id) || typeof doc.templateName !== "string" || !Number.isSafeInteger(doc.compileOutputType) || doc.compileOutputType < 1 ||
        (doc.templateId != null && !Number.isSafeInteger(doc.templateId)) || (doc.link != null && typeof doc.link !== "string")) throw new Error("PRIMEGOV_DOCUMENT_SHAPE_CHANGED");
    }
  }
  return rows as PrimeGovMeeting[];
}

const plain = (value: string) => decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
function publicLink(value: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(value), base);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function primeGovDocumentUrl(doc: PrimeGovDocument, portalUrl: string): string | null {
  const base = primeGovBase(portalUrl);
  if (doc.link) return publicLink(doc.link, base);
  const identity = doc.templateId && doc.templateId > 0 ? `meetingTemplateId=${doc.templateId}` : `compiledMeetingDocumentFileId=${doc.id}`;
  // The public portal's getHref(document) uses HTML templates for agendas,
  // compiled-document templates for PDFs and Word files, and file ids for votes.
  return doc.compileOutputType === 3 ? `${base}/Portal/Meeting?${identity}` : `${base}/Public/CompiledDocument?${identity}&compileOutputType=${doc.compileOutputType}`;
}

export function makePrimeGovSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch, options: {
  store?: EvidenceStore;
  locks?: LockManager;
  now?: () => string;
} = {}): ReportingMeetingSource<PrimeGovRaw> {
  const normalizeWithDrops = (raw: PrimeGovRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0, countedButProduced = 0, duplicates = 0, outOfWindow = 0;
    const seen = new Set<string>();
    for (const { wiring, text, sourceUrl, collectedAt, from, to } of raw) {
      const base = primeGovBase(wiring.config.portalUrl);
      for (const row of parsePrimeGovMeetings(text)) {
        logicalInput++;
        if (String(row.committeeId) !== wiring.config.committeeId) { drops.notConfigured++; continue; }
        const clock = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(row.dateTime)!;
        const hasTime = clock[4] !== undefined && !(row.time != null && /^(?:\s*|tbd|to be determined)$/i.test(row.time));
        const startsAt = toZonedIso(Number(clock[1]), Number(clock[2]), Number(clock[3]), hasTime ? Number(clock[4]) : 0, hasTime ? Number(clock[5]) : 0, wiring.timeZone);
        if ((from && Date.parse(startsAt) < Date.parse(from)) || (to && Date.parse(startsAt) > Date.parse(to))) { outOfWindow++; continue; }
        const id = `primegov:${new URL(base).hostname}:${row.committeeId}:${row.id}`;
        const ownIdentity = `${wiring.bodyId}:${id}`;
        if (seen.has(ownIdentity)) { duplicates++; continue; }
        seen.add(ownIdentity);
        const location = plain(row.location ?? "");
        const online = isPlacelessLocation(location) ? { label: location, joinUrl: row.zoomMeetingLink ? publicLink(row.zoomMeetingLink, base) : null } : null;
        const venue = online || !location ? null : resolveVenue("primegov", wiring.ocdId, location, wiring.config.slug);
        const venueGap = !online && !venue ? unplacedVenueGap(location, wiring.publishingOrg) : null;
        if (online) { drops.placeless++; countedButProduced++; }
        if (venueGap) { drops.unknownVenue++; countedButProduced++; }
        const documents = (row.documentList ?? []).flatMap(doc => {
          const href = primeGovDocumentUrl(doc, base);
          return href ? [{ label: plain(doc.templateName), href }] : [];
        });
        const agenda = documents.find(doc => /agenda/i.test(doc.label) && /\/Portal\/Meeting\?/i.test(doc.href)) ?? documents.find(doc => /agenda/i.test(doc.label));
        const videoUrl = row.videoUrl ? publicLink(row.videoUrl, base) : null;
        meetings.push({
          id, ocdId: wiring.ocdId, bodyId: wiring.bodyId, bodyName: wiring.config.bodyName ?? wiring.publishingOrg,
          title: plain(row.title), startsAt, ...(hasTime ? {} : { startPrecision: "DAY" as const }), timeZone: wiring.timeZone,
          location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(online ? { online } : {}), ...(venueGap ? { venueGap } : {}),
          agendaUrl: agenda?.href ?? null, publishedLinks: [...documents, ...(videoUrl ? [{ label: "Video", href: videoUrl }] : [])],
          jurisdiction: wiring.jurisdiction,
          status: row.isCancelled || row.isCanceled || /\bcancell?ed\b/i.test(row.title) ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: { sourceUrl, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null },
        });
      }
    }
    return accountedNormalize("primegov", raw, { meetings, drops, ...(raw.some(row => row.partialScopes?.length) ? { partialScopes: raw.flatMap(row => row.partialScopes ?? []) } : {}) },
      { logicalInput: logicalInput, countedButProduced, duplicates, outOfWindow });
  };
  return {
    name: "primegov",
    async fetch(query?: MeetingQuery) {
      const at = options.now?.() ?? new Date().toISOString();
      const from = query?.startsAfter ?? new Date(Date.parse(at) - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString();
      const to = query?.startsBefore ?? new Date(Date.parse(at) + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString();
      const signal = query?.signal ?? AbortSignal.timeout(120_000);
      const result: PrimeGovRaw[] = [];
      const tenants = new Map<string, BodySourceWiring[]>();
      for (const wiring of rows) {
        if (!/^\d+$/.test(wiring.config.committeeId ?? "")) throw new Error(`PRIMEGOV_COMMITTEE_MISSING:${wiring.bodyId}`);
        const base = primeGovBase(wiring.config.portalUrl);
        tenants.set(base, [...(tenants.get(base) ?? []), wiring]);
      }
      for (const [base, tenantRows] of tenants) {
        const routes: { url: string; scope: "UPCOMING" | "ARCHIVE" }[] = [{ url: `${base}/api/v2/PublicPortal/ListUpcomingMeetings`, scope: "UPCOMING" }];
        for (let year = Number(from.slice(0, 4)); year <= Math.min(Number(to.slice(0, 4)), Number(at.slice(0, 4))); year++) {
          routes.push({ url: `${base}/api/v2/PublicPortal/ListArchivedMeetings?year=${year}`, scope: "ARCHIVE" });
        }
        const partialScopes: PartialScopeFailure[] = [];
        const collected: PrimeGovRaw[] = [];
        let reads = 0;
        for (const { url, scope } of routes) {
          if (reads++ && !fetchImpl) await sourceAcquisitionSleep(REQUEST_SPACING_MS, signal);
          try {
            const endpoint = new URL(url);
            const release = await acquireKnownRelease({ sourceId: "primegov", releaseId: endpoint.pathname + endpoint.search,
              url, parserVersion: "primegov/1", signal, maxBytes: 16 * 1024 * 1024, checkAfterMs: 60_000,
              fetchImpl, store: options.store, locks: options.locks, now: options.now, headers: { Accept: "application/json" },
              validate: bytes => { parsePrimeGovMeetings(new TextDecoder().decode(bytes)); } });
            const text = new TextDecoder().decode(release.bytes);
            recordAcquiredResponse({ requestedUrl: url, finalUrl: release.finalUrl, httpStatus: release.httpStatus, bytes: release.bytes, contentType: release.contentType });
            for (const wiring of tenantRows) collected.push({ wiring, text, sourceUrl: release.finalUrl, collectedAt: release.retrievedAt,
              sourceCheck: knownReleaseSourceCheck(release), from, to });
          } catch (error) {
            signal.throwIfAborted();
            partialScopes.push({ scope, ocdIds: [...new Set(tenantRows.map(row => row.ocdId))], cause: String(error) });
          }
        }
        if (!collected.length) throw new Error(`PRIMEGOV_SOURCE_UNAVAILABLE:${base}:${partialScopes.map(row => row.cause).join(";")}`);
        result.push(...collected.map((row, index) => ({ ...row, ...(partialScopes.length && index === 0 ? { partialScopes } : {}) })));
      }
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings,
    normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
