import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../../meetings/constants.ts";
import { isPlacelessLocation, resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities, politeGetText } from "../http.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, MeetingQuery, NormalizeDropCounts, ReportingMeetingSource } from "../types.ts";

export interface EscribeMeeting {
  ID: string;
  MeetingName: string;
  MeetingType: string;
  StartDate: string;
  EndDate?: string;
  Location?: string;
  Description?: string;
  Url?: string;
  ShareUrl?: string;
  HasAgenda?: boolean;
  TimeOverride?: string;
  HasVideo?: boolean;
  HasLiveVideo?: boolean;
  LiveVideoStandAloneLink?: string;
  MeetingDocumentLink: { Title: string; Type: string; Url: string }[];
}

export interface EscribeRaw { wiring: BodySourceWiring; text: string; collectedAt: string }

const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export function escribeCalendarUrl(portalUrl: string): string {
  const url = new URL(portalUrl);
  if (url.protocol !== "https:" || !/^pub-[a-z0-9-]+\.escribemeetings\.com$/i.test(url.hostname) || url.username || url.password) throw new Error("ESCRIBE_PORTAL_INVALID");
  return `${url.origin}/MeetingsCalendarView.aspx/GetCalendarMeetings`;
}

export function escribeCalendarRequest(query: Pick<MeetingQuery, "startsAfter" | "startsBefore"> = {}, now = new Date()) {
  return {
    calendarStartDate: (query.startsAfter ?? new Date(now.getTime() - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString()).slice(0, 10),
    calendarEndDate: (query.startsBefore ?? new Date(now.getTime() + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString()).slice(0, 10),
  };
}

export function parseEscribeMeetings(text: string): EscribeMeeting[] {
  const value: unknown = JSON.parse(text);
  const rows = value && typeof value === "object" && "d" in value ? value.d : null;
  if (!Array.isArray(rows)) throw new Error("ESCRIBE_CALENDAR_NOT_A_LIST");
  for (const row of rows) {
    if (!row || typeof row.ID !== "string" || !/^[a-f0-9-]{36}$/i.test(row.ID) || typeof row.MeetingName !== "string" || typeof row.MeetingType !== "string" || typeof row.StartDate !== "string" || !Array.isArray(row.MeetingDocumentLink) || row.MeetingDocumentLink.some((d: Record<string, unknown>) => !d || typeof d.Url !== "string" || typeof d.Title !== "string" || typeof d.Type !== "string")) throw new Error("ESCRIBE_MEETING_SHAPE_CHANGED");
  }
  return rows;
}

function localDate(value: string, zone: string): string | null {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (h > 23 || mi > 59 || s > 59 || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return toZonedIso(y, mo, d, h, mi, zone).replace(/:00(?=[+-]\d{2}:\d{2}$)/, `:${m[6]}`);
}

export function makeEscribeSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<EscribeRaw> {
  const normalizeWithDrops = (raw: EscribeRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0, countedButProduced = 0, duplicates = 0;
    const seen = new Set<string>();
    for (const { wiring, text, collectedAt } of raw) {
      const base = new URL(escribeCalendarUrl(wiring.config.portalUrl)).origin;
      const types = wiring.config.meetingTypes?.split("|").map(s => s.trim());
      if (!types?.length || types.some(s => !s)) throw new Error(`ESCRIBE_BODY_FILTER_MISSING:${wiring.bodyId}`);
      for (const row of parseEscribeMeetings(text)) {
        logicalInput++;
        if (!types.includes(row.MeetingType)) { drops.notConfigured++; continue; }
        const startsAt = localDate(row.StartDate, wiring.timeZone);
        if (!startsAt) { drops.unplaceableInTime++; continue; }
        const id = `escribe:${wiring.config.slug}:${row.ID}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        const location = plain(row.Description || row.Location || "");
        const online = location && isPlacelessLocation(location) ? { label: location, joinUrl: null } : null;
        const venue = !online && location ? resolveVenue("escribe", wiring.ocdId, location, wiring.config.slug) : null;
        const venueGap = !online && !venue ? unplacedVenueGap(location, wiring.publishingOrg) : null;
        if (online) { drops.placeless++; countedButProduced++; }
        if (venueGap) { drops.unknownVenue++; countedButProduced++; }
        const links = row.MeetingDocumentLink.filter(d => d.Url).map(d => ({ label: plain(d.Title), href: new URL(decodeEntities(d.Url), base).toString() }));
        const agenda = ["Merged", "Agenda", "MergedCover", "AgendaCover"].map(type => row.MeetingDocumentLink.find(d => d.Type === type && d.Url)).find(Boolean);
        const sourceUrl = row.Url || (row.ShareUrl ? new URL(row.ShareUrl, base).searchParams.get("u") : null) || escribeCalendarUrl(wiring.config.portalUrl);
        const video = row.HasVideo || row.HasLiveVideo ? /href=['"]([^'"]+)['"]/i.exec(row.LiveVideoStandAloneLink ?? "")?.[1] : undefined;
        const endsAt = row.EndDate ? localDate(row.EndDate, wiring.timeZone) : null;
        meetings.push({
          id, ocdId: wiring.ocdId, bodyId: wiring.bodyId, bodyName: wiring.config.bodyName ?? row.MeetingType,
          title: plain(row.MeetingName), startsAt, ...(row.TimeOverride ? { startPrecision: "DAY" as const } : {}),
          ...(endsAt && !row.TimeOverride ? { endsAt } : {}), timeZone: wiring.timeZone,
          location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(online ? { online } : {}), ...(venueGap ? { venueGap } : {}),
          agendaUrl: agenda ? new URL(decodeEntities(agenda.Url), base).toString() : null,
          ...(row.HasAgenda === false ? { agendaSlotObservedEmpty: true } : {}),
          publishedLinks: links, ...(video ? { videoUrl: new URL(decodeEntities(video), base).toString() } : {}),
          jurisdiction: wiring.jurisdiction,
          status: /\bcancell?(?:ed|ation)\b/i.test([row.MeetingName, row.TimeOverride, ...links.map(d => d.label)].join(" ")) ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: { sourceUrl: new URL(decodeEntities(sourceUrl), base).toString(), sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null },
        });
      }
    }
    return accountedNormalize("escribe", raw, { meetings, drops }, { logicalInput: logicalInput, countedButProduced, duplicates });
  };
  return {
    name: "escribe",
    async fetch(query) {
      const tenants = new Map<string, { text: string; collectedAt: string }>();
      const result: EscribeRaw[] = [];
      for (const wiring of rows) {
        const url = escribeCalendarUrl(wiring.config.portalUrl);
        let held = tenants.get(url);
        if (!held) {
          // The calendar is the change check: it includes every published
          // document link, so no per-meeting or per-place requests are needed.
          const response = await politeGetText(url, { signal: query?.signal, accept: "application/json",
            fetchImpl: ((input, init) => (fetchImpl ?? fetch)(input, { ...init, method: "POST", headers: { ...init?.headers, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(escribeCalendarRequest(query)) })) as typeof fetch });
          parseEscribeMeetings(response.text);
          held = { text: response.text, collectedAt: new Date().toISOString() };
          tenants.set(url, held);
        }
        result.push({ wiring, ...held });
      }
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings, normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
