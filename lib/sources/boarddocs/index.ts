/** @freshness-reads-here */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { resolveVenue, soleVenueForBody, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../../meetings/constants.ts";
import { decodeEntities, politeGetText, REQUEST_SPACING_MS } from "../http.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, MeetingQuery, NormalizeDropCounts, PartialScopeFailure, ReportingMeetingSource } from "../types.ts";

export interface BoardDocsCommittee { id: string; name: string }
export interface BoardDocsMeeting { id: string; title: string; date: string; hour: number | null; minute: number | null }
export interface BoardDocsRaw {
  wiring: BodySourceWiring;
  text: string;
  details?: Readonly<Record<string, string>>;
  partialScopes?: PartialScopeFailure[];
  collectedAt: string;
}

const plain = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Committee identity and label are published on the tenant's public selector. */
export function parseBoardDocsCommittees(html: string): BoardDocsCommittee[] {
  const result = new Map<string, BoardDocsCommittee>();
  for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bcommitteeid\s*=\s*["']([a-z0-9]+)["'][^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const name = plain(m[4]);
    if (name) result.set(m[3], { id: m[3], name });
  }
  return [...result.values()];
}

function clockIn(text: string): { hour: number; minute: number } | null {
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(text);
  if (!clock || Number(clock[1]) < 1 || Number(clock[1]) > 12 || Number(clock[2] ?? 0) > 59) return null;
  return { hour: Number(clock[1]) % 12 + (clock[3].toLowerCase() === "p" ? 12 : 0), minute: Number(clock[2] ?? 0) };
}

/** All dated public rows are retained; the list's empty delimiter objects are not meetings. */
export function parseBoardDocsMeetings(text: string): BoardDocsMeeting[] {
  const json: unknown = JSON.parse(text);
  if (!Array.isArray(json)) throw new Error("BOARDDOCS_MEETINGS_NOT_A_LIST");
  const result: BoardDocsMeeting[] = [];
  for (const value of json) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length === 0) continue;
    if (typeof row.unique !== "string" || !/^[a-z0-9]+$/i.test(row.unique) || typeof row.name !== "string" || typeof row.numberdate !== "string" || !/^\d{8}$/.test(row.numberdate)) {
      throw new Error("BOARDDOCS_MEETING_SHAPE_CHANGED");
    }
    const date = `${row.numberdate.slice(0, 4)}-${row.numberdate.slice(4, 6)}-${row.numberdate.slice(6, 8)}`;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) throw new Error("BOARDDOCS_MEETING_DATE_INVALID");
    const clock = clockIn(row.name);
    result.push({ id: row.unique, title: plain(row.name), date, hour: clock?.hour ?? null, minute: clock?.minute ?? null });
  }
  return result;
}

export function boardDocsBase(portalUrl: string): string {
  const url = new URL(portalUrl);
  const path = /^(\/[^/]+\/[^/]+\/Board\.nsf)(?:\/|$)/i.exec(url.pathname)?.[1];
  if (!path || !/(^|\.)boarddocs\.com$/i.test(url.hostname) || url.protocol !== "https:") throw new Error("BOARDDOCS_PORTAL_INVALID");
  return `${url.origin}${path}`;
}

export function boardDocsListUrl(portalUrl: string, committeeId: string): string {
  return `${boardDocsBase(portalUrl)}/BD-GetMeetingsList?open&current_committee_id=${encodeURIComponent(committeeId)}`;
}

export function makeBoardDocsSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<BoardDocsRaw> {
  const normalizeWithDrops = (raw: BoardDocsRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0;
    let countedButProduced = 0;
    let duplicates = 0;
    const seen = new Set<string>();
    for (const { wiring, text, details = {}, collectedAt } of raw) {
      const base = boardDocsBase(wiring.config.portalUrl);
      for (const row of parseBoardDocsMeetings(text)) {
        logicalInput++;
        const id = `boarddocs:${wiring.config.slug ?? base}:${wiring.config.committeeId}:${row.id}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        const detail = details[row.id] ?? "";
        const description = /<div\b[^>]*class=["'][^"']*\bmeeting-description\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(detail)?.[1] ?? "";
        const clock = row.hour === null ? clockIn(plain(description)) : { hour: row.hour, minute: row.minute! };
        const [year, month, day] = row.date.split("-").map(Number);
        const startsAt = toZonedIso(year, month, day, clock?.hour ?? 0, clock?.minute ?? 0, wiring.timeZone);
        const publisherLocation = plain(description.split(/MINUTES STATEMENT/i)[0] ?? "");
        const venue = (publisherLocation ? resolveVenue("boarddocs", wiring.ocdId, publisherLocation) : null) ?? soleVenueForBody("boarddocs", wiring.ocdId);
        const venueGap = venue ? null : unplacedVenueGap(publisherLocation, wiring.publishingOrg);
        if (venueGap) { drops.unknownVenue++; countedButProduced++; }
        const publishedLink = /\bdata-clipboard-text=["']([^"']+)["']/i.exec(detail)?.[1];
        const hasAgenda = /\bid=["']btn-view-agenda["']/i.test(detail);
        meetings.push({
          id, ocdId: wiring.ocdId, bodyId: wiring.bodyId,
          bodyName: wiring.config.bodyName ?? wiring.publishingOrg, title: row.title,
          startsAt, ...(clock ? {} : { startPrecision: "DAY" as const }), timeZone: wiring.timeZone,
          location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(venueGap ? { venueGap } : {}),
          // The permalink and agenda button are both publisher evidence. A
          // list alone never manufactures a claim that an agenda is posted.
          agendaUrl: hasAgenda && publishedLink ? decodeEntities(publishedLink) : null,
          jurisdiction: wiring.jurisdiction,
          status: /\bcancell?ed\b/i.test(row.title) ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: { sourceUrl: publishedLink ? decodeEntities(publishedLink) : wiring.config.portalUrl, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null },
        });
      }
    }
    return accountedNormalize("boarddocs", raw, { meetings, drops,
      ...(raw.some(row => row.partialScopes?.length) ? { partialScopes: raw.flatMap(row => row.partialScopes ?? []) } : {}),
    }, { logicalInput: logicalInput, duplicates, countedButProduced });
  };
  return {
    name: "boarddocs", publishedLookbackDays: null,
    async fetch(query?: MeetingQuery) {
      const result: BoardDocsRaw[] = [];
      for (const wiring of rows) {
        const committeeId = wiring.config.committeeId;
        if (!committeeId || !/^[a-z0-9]+$/i.test(committeeId)) throw new Error(`BOARDDOCS_COMMITTEE_MISSING:${wiring.bodyId}`);
        const base = boardDocsBase(wiring.config.portalUrl);
        const list = await politeGetText(boardDocsListUrl(wiring.config.portalUrl, committeeId), { fetchImpl, form: { current_committee_id: committeeId }, accept: "application/json", signal: query?.signal });
        const details: Record<string, string> = {};
        const partialScopes: PartialScopeFailure[] = [];
        const now = Date.now();
        for (const meeting of parseBoardDocsMeetings(list.text)) {
          const day = Date.parse(`${meeting.date}T00:00:00Z`);
          if (day < now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000 || day > now + MEETING_HELD_HORIZON_DAYS * 86_400_000) continue;
          await sourceAcquisitionSleep(REQUEST_SPACING_MS, query?.signal);
          try {
            details[meeting.id] = (await politeGetText(`${base}/BD-GetMeeting?open&id=${encodeURIComponent(meeting.id)}`, {
              fetchImpl, form: { current_committee_id: committeeId, id: meeting.id }, accept: "text/html", signal: query?.signal,
            })).text;
          } catch (error) {
            query?.signal?.throwIfAborted();
            partialScopes.push({ scope: day < now ? "ARCHIVE" : "UPCOMING", ocdIds: [wiring.ocdId], cause: String(error) });
          }
        }
        result.push({ wiring, text: list.text, details, ...(partialScopes.length ? { partialScopes } : {}), collectedAt: new Date().toISOString() });
      }
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings,
    normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
