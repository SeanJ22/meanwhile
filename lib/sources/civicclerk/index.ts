/** @freshness-reads-here */
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetJson } from "../http.ts";
import { sittingStatus, saysCanceled } from "../sitting-status.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

const SOURCE_NAME = "civicclerk";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

export interface CivicClerkEvent {
  id: number;
  eventName: string | null;
  eventDate: string | null;
  startDateTime: string | null;
  eventCategoryName?: string | null;
  categoryName?: string | null;
  hasAgenda?: boolean;
  isDeleted?: boolean;
  isPublished?: boolean | string;
  categoryId?: number;
  eventDescription?: string | null;
  eventNotice?: string | null;
  publishedFiles?: { fileId: number; fileType?: number; name?: string; type?: string; streamUrl?: string | null }[];
  eventLocation?: {
    locationName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  } | null;
}

export interface CivicClerkRaw {
  wiring: BodySourceWiring;
  events: CivicClerkEvent[];
  collectedAt: string;
}

function locationTextOf(e: CivicClerkEvent): string {
  const L = e.eventLocation;
  if (!L) return "";
  return [L.locationName, L.address1, L.address2, L.city, L.state, L.zipCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
}

function bodyNameFor(e: CivicClerkEvent): string {
  return (
    e.eventCategoryName?.trim() ||
    e.categoryName?.trim() ||
    ""
  );
}

export function civicClerkPublished(event: CivicClerkEvent): boolean {
  return event.isPublished === undefined || event.isPublished === true || event.isPublished === "Published";
}

export function civicClerkMatches(event: CivicClerkEvent, config: Readonly<Record<string, string>>): boolean {
  const words = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return /^[1-9]\d*$/.test(config.categoryId ?? "") && Number(config.categoryId) === event.categoryId &&
    (!config.titleMatch || ` ${words(event.eventName ?? "")} `.includes(` ${words(config.titleMatch)} `));
}

function documentLinks(event: CivicClerkEvent, apiBase: string): { label: string; type: string; href: string }[] {
  return (event.publishedFiles ?? []).filter(file => Number.isSafeInteger(file.fileId) && file.fileId > 0).map(file => ({
    label: file.name || file.type || "Document", type: file.type ?? "",
    href: file.streamUrl && /^https?:\/\//.test(file.streamUrl) ? file.streamUrl
      : `${apiBase}/v1/Meetings/${file.fileType === 3 ? `GetAttachmentFile(fileId=${file.fileId})` : `GetMeetingFileStream(fileId=${file.fileId},plainText=false)`}`,
  }));
}

export interface CivicClerkPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export async function readCivicClerkPages<T extends { id: number } = CivicClerkEvent>(
  url: string, readPage: (url: string) => Promise<CivicClerkPage<T>>, signal?: AbortSignal,
): Promise<T[]> {
  const start = new URL(url), rows: T[] = [], ids = new Set<number>(), pages = new Set<string>();
  let next: string | null = start.href;
  let blockCount = 0, offset = Number(start.searchParams.get("$skip") ?? 0);
  while (next !== null) {
    signal?.throwIfAborted();
    const pageUrl: URL = new URL(next, start);
    if (pageUrl.origin !== start.origin || pageUrl.pathname !== start.pathname || pages.has(pageUrl.href)) throw new Error("CIVICCLERK_PAGING_INVALID");
    pages.add(pageUrl.href);
    const page = await readPage(pageUrl.href);
    if (!Array.isArray(page.value)) throw new Error("CIVICCLERK_EVENTS_NOT_A_LIST");
    for (const event of page.value) {
      if (!Number.isSafeInteger(event.id) || event.id <= 0 || ids.has(event.id)) throw new Error("CIVICCLERK_PAGING_NOT_ADVANCING");
      ids.add(event.id); rows.push(event); blockCount++;
    }
    if (page["@odata.nextLink"]) {
      if (page.value.length === 0) throw new Error("CIVICCLERK_PAGING_NOT_ADVANCING");
      next = new URL(page["@odata.nextLink"], start).href;
    } else if (blockCount === 200) {
      offset += blockCount; blockCount = 0;
      const page = new URL(start); page.searchParams.set("$skip", String(offset)); next = page.href;
    } else next = null;
  }
  return rows;
}

export function makeCivicClerkSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<CivicClerkRaw> {
  const normalizeWithDrops = (
    raw: CivicClerkRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    let considered = 0;
    let keptButPlaceless = 0;

    for (const { wiring, events, collectedAt } of raw) {
      considered += events.length;
      for (const e of events) {
        if (e.isDeleted || !civicClerkPublished(e)) {
          drops.notConfigured++;
          continue;
        }

        const clock = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(
          e.startDateTime ?? e.eventDate ?? "",
        );
        if (!clock) {
          drops.unplaceableInTime++;
          continue;
        }
        const startsAt = toZonedIso(
          Number(clock[1]),
          Number(clock[2]),
          Number(clock[3]),
          Number(clock[4]),
          Number(clock[5]),
          wiring.timeZone,
        );

        const bodyName = wiring.config.titleMatch ? wiring.config.bodyName : bodyNameFor(e);
        if (!civicClerkMatches(e, wiring.config)) {
          drops.notConfigured++;
          continue;
        }
        if (!bodyName) {
          drops.notConfigured++;
          continue;
        }

        const location = locationTextOf(e);

        const online = location && isPlacelessLocation(location)
          ? { label: location, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }
        const venue = online || !location
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, location, wiring.config.slug) ?? null;

        const venueGap = !online && !venue ? unplacedVenueGap(location, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        const meetingUrl = `${wiring.config.portalBase}/event/${e.id}`;

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${e.id}`,
          ocdId: wiring.ocdId,

          bodyId: wiring.bodyId,
          bodyName,
          title: (e.eventName ?? bodyName).trim(),
          startsAt,
          timeZone: wiring.timeZone,
          location: venue
            ? {
                name: venue.name,
                address: venue.address,
                lat: venue.lat,
                lng: venue.lng,
              }
            : null,
          ...(online ? { online } : {}),
          ...(venueGap ? { venueGap } : {}),

          agendaUrl: documentLinks(e, wiring.config.apiBase).find(link => link.type === "Agenda")?.href ?? (e.hasAgenda ? meetingUrl : null),
          publishedLinks: documentLinks(e, wiring.config.apiBase).map(({ label, href }) => ({ label, href })),
          jurisdiction: wiring.jurisdiction,
          status: sittingStatus(startsAt, saysCanceled([e.eventName, e.eventDescription, e.eventNotice].filter(Boolean).join(" ")), now),
          provenance: {
            sourceUrl: meetingUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops },
      { logicalInput: considered, countedButProduced: keptButPlaceless },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(meetingQuery?: MeetingQuery): Promise<CivicClerkRaw[]> {
      const now = Date.now();
      const from = new Date(now - WINDOW_BACK_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 19);
      const to = new Date(now + WINDOW_FORWARD_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 19);

      const collected: CivicClerkRaw[] = [];
      const tenants = new Map<string, BodySourceWiring[]>();
      for (const wiring of wiringRows) {
        const base = new URL(wiring.config.apiBase).origin;
        tenants.set(base, [...(tenants.get(base) ?? []), wiring]);
      }
      for (const [base, rows] of tenants) {
        const query = new URLSearchParams({
          $filter: `eventDate ge ${from}Z and eventDate le ${to}Z`,
          $orderby: "id asc", $top: "200",
        });
        // No complete event revision is exposed; an unchanged latest id cannot rule out cancellations or new documents.
        await politeGetJson(`${base}/v1/Events?${new URLSearchParams({ $top: "1", $orderby: "id desc" })}`, { fetchImpl, signal: meetingQuery?.signal });
        const readPages = <T extends { id: number }>(url: string) => readCivicClerkPages<T>(url,
          page => politeGetJson<CivicClerkPage<T>>(page, { fetchImpl, signal: meetingQuery?.signal }), meetingQuery?.signal);
        const categories = await readPages<{ id: number; categoryDesc: string }>(`${base}/v1/EventCategories`);
        for (const wiring of rows) {
          if (wiring.config.categoryId) continue;
          const name = wiring.config.bodyMatch ?? wiring.config.bodyName;
          const matches = categories.filter(category => category.categoryDesc?.trim().toLowerCase() === name?.trim().toLowerCase());
          if (matches.length !== 1) throw new Error(`CIVICCLERK_CATEGORY_UNRESOLVED:${wiring.bodyId}`);
          wiring.config = { ...wiring.config, categoryId: String(matches[0].id) };
        }
        query.set("$filter", `${query.get("$filter")} and categoryId in (${[...new Set(rows.map(row => row.config.categoryId))].join(",")})`);
        const events = await readPages<CivicClerkEvent>(`${base}/v1/Events?${query}`);
        const collectedAt = new Date().toISOString();
        for (const wiring of rows) collected.push({ wiring, events: events.filter(event => civicClerkMatches(event, wiring.config)), collectedAt });
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}
