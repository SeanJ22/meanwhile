// @freshness-reads-here
import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { isPlacelessLocation, resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { cachedZoneFormatter, toZonedIso } from "../../time/zoned.ts";
import { accountedNormalize } from "../normalize-account.ts";
import { parseDtStart, parseIcs, publisherPostedAt } from "../ical/index.ts";
import { acquireKnownRelease, type KnownReleaseOptions } from "../known-release.ts";
import { recordAcquiredResponse } from "../acquisition-trace.ts";
import type { SourcePrefetchRequest } from "../fetch-source.ts";
import { readValidatedResponse, REQUEST_SPACING_MS } from "../http.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import type { Meeting, MeetingQuery, MeetingStatus, NormalizeDropCounts, PartialScopeFailure, ReportingMeetingSource } from "../types.ts";
import { agendaCenterPages, agendaCenterRssUrl, parseAgendaCenter, parseAgendaCenterUpdates, type ArchivedSitting } from "./agenda-center.ts";

export { parseAgendaCenter, parseAgendaCenterCategories } from "./agenda-center.ts";

const SOURCE_NAME = "civicplus";
const clockFormatter = cachedZoneFormatter("en-US", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dayFormatter = cachedZoneFormatter("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
type CacheOptions = Pick<KnownReleaseOptions, "store" | "locks" | "now">;
type CivicPlusRequest = Pick<SourcePrefetchRequest, "url" | "headers" | "redirect">;

function civicPlusRequest(url: string, accept: string): CivicPlusRequest {
  return { url, headers: [["accept", accept]], redirect: "follow" };
}

export function civicPlusCalendarRequests(wiring: BodySourceWiring): readonly CivicPlusRequest[] {
  return [
    ...(wiring.config.agendaCenterUrl ? [civicPlusRequest(wiring.config.rssUrl || agendaCenterRssUrl(wiring.config.agendaCenterUrl), "application/rss+xml")] : []),
    ...(wiring.config.icalUrl ? [civicPlusRequest(wiring.config.icalUrl, "text/calendar")] : []),
    ...(wiring.config.agendaCenterUrl ? [civicPlusRequest(wiring.config.agendaCenterUrl, "text/html")] : []),
  ];
}

export interface CivicPlusRaw {
  wiring: BodySourceWiring;
  ical: string;
  rss?: { url: string; text: string; collectedAt: string };
  agendaPages?: { url: string; text: string; collectedAt: string }[];
  partialScopes?: PartialScopeFailure[];
  collectedAt: string;
}

function isCancelledSummary(summary: string): boolean {
  return /\bcancell?ed\b/i.test(summary);
}

function locationWithoutNotice(location: string): string {
  const close = location.lastIndexOf("</p>");
  return close >= 0 ? location.slice(close + 4) : location;
}

function clockAt(raw: string, zone: string): { iso: string; dayOnly: boolean } | null {
  const stamp = /:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/.exec(raw);
  if (!stamp) return null;
  const [, y, m, d, h = "00", minute = "00", second = "00"] = stamp;
  const civil = `${y}-${m}-${d}T${h}:${minute}:${second}.000Z`;
  if (!Number.isFinite(Date.parse(civil)) || new Date(civil).toISOString() !== civil) return null;
  const parsed = parseDtStart(raw, zone);
  if (!parsed) return null;
  const parts = Object.fromEntries(clockFormatter(zone).formatToParts(new Date(parsed.iso)).map(part => [part.type, part.value]));
  return { iso: toZonedIso(+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute, zone), dayOnly: parsed.dayOnly };
}

function linksFor(sitting: ArchivedSitting, url: string): NonNullable<Meeting["publishedLinks"]> {
  return sitting.links.flatMap(link => {
    const target = new URL(link.href, url);
    return ["https:", "http:"].includes(target.protocol) ? [{ label: link.label, href: target.href }] : [];
  });
}

function statusOf(startsAt: string, dayOnly: boolean, now: Date, timeZone: string): MeetingStatus {
  if (!dayOnly) return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
  const today = dayFormatter(timeZone).format(now);
  return startsAt.slice(0, 10) < today ? "CONCLUDED" : "SCHEDULED";
}

export function makeCivicPlusSource(
  wiringRows: BodySourceWiring[], fetchImpl?: typeof fetch, cache: CacheOptions = {},
): ReportingMeetingSource<CivicPlusRaw> {
  const normalizeWithDrops = (raw: CivicPlusRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0, duplicates = 0, countedButProduced = 0;
    const seen = new Set<string>();
    for (const { wiring, ical, agendaPages = [], rss, collectedAt } of raw) {
      const bodyName = wiring.config.bodyName || wiring.config.summaryMatch || wiring.publishingOrg;
      const feedDates = new Map<string, Meeting[]>();
      const placed = (published: string) => {
        const online = isPlacelessLocation(published) ? { label: published, joinUrl: null } : null;
        const venue = online ? null : resolveVenue(SOURCE_NAME, wiring.ocdId, published);
        const venueGap = !online && !venue ? unplacedVenueGap(published, wiring.publishingOrg) : null;
        if (online || venueGap) { drops[online ? "placeless" : "unknownVenue"]++; countedButProduced++; }
        return { location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(online ? { online } : {}), ...(venueGap ? { venueGap } : {}) };
      };
      const common = { ocdId: wiring.ocdId, bodyId: wiring.bodyId, bodyName, timeZone: wiring.timeZone, jurisdiction: wiring.jurisdiction };
      for (const event of parseIcs(ical)) {
        logicalInput++;
        if (!event.uid || !event.summary || (wiring.config.summaryMatch && !event.summary.includes(wiring.config.summaryMatch))) {
          drops.notConfigured++; continue;
        }
        const start = event.dtstart && clockAt(event.dtstart, wiring.timeZone);
        if (!start) { drops.unplaceableInTime++; continue; }
        const id = `${SOURCE_NAME}:${wiring.config.slug}:${event.uid}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        const meeting: Meeting = {
          ...common, id, title: event.summary, startsAt: start.iso, ...(start.dayOnly ? { startPrecision: "DAY" } : {}),
          ...placed(locationWithoutNotice(event.location ?? "")), agendaUrl: null,
          ...(publisherPostedAt(event) ? { postedAt: publisherPostedAt(event)! } : {}),
          status: isCancelledSummary(event.summary) || /^CANCELLED$/i.test(event.status ?? "") ? "CANCELED" : statusOf(start.iso, start.dayOnly, now, wiring.timeZone),
          provenance: { sourceUrl: wiring.config.icalUrl, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null },
        };
        meetings.push(meeting);
        const day = start.iso.slice(0, 10);
        feedDates.set(day, [...(feedDates.get(day) ?? []), meeting]);
      }
      const categoryIds = wiring.config.agendaCenterCategoryId?.split(",").map(id => id.trim()) ?? [];
      const archiveRows = agendaPages.flatMap(page => categoryIds.flatMap(categoryId => parseAgendaCenter(page.text, categoryId).map(sitting => ({ sitting, page }))));
      const updates = new Map(parseAgendaCenterUpdates(rss?.text ?? "").map(update => [update.id, update]));
      const dateCounts = new Map<string, Set<string>>();
      for (const { sitting } of archiveRows) {
        const ids = dateCounts.get(sitting.date) ?? new Set(); ids.add(sitting.id); dateCounts.set(sitting.date, ids);
      }
      for (const { sitting, page } of archiveRows) {
        logicalInput++;
        const id = `${SOURCE_NAME}:${wiring.config.slug}:archive:${sitting.categoryId}:${sitting.id}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        const links = linksFor(sitting, page.url);
        const agendaUrl = sitting.agendaHref ? new URL(sitting.agendaHref, page.url).href : null;
        const update = updates.get(sitting.id);
        const posting = update && rss ? {
          postedAt: update.postedAt,
          fieldSources: { postedAt: { sourceUrl: rss.url, sourceOrg: wiring.publishingOrg, collectedAt: rss.collectedAt, verifiedAt: null } },
        } : {};
        const feed = feedDates.get(sitting.date) ?? [];
        // A day alone cannot match two distinct sittings. Keep their own document identities.
        if (feed.length === 1 && dateCounts.get(sitting.date)?.size === 1) {
          duplicates++; feed[0].agendaUrl ??= agendaUrl; feed[0].publishedLinks = links;
          const provenance = { sourceUrl: page.url, sourceOrg: wiring.publishingOrg, collectedAt: page.collectedAt, verifiedAt: null };
          feed[0].fieldSources = { ...feed[0].fieldSources, ...(agendaUrl ? { agendaUrl: provenance } : {}), publishedLinks: provenance };
          if (posting.postedAt) { feed[0].postedAt = posting.postedAt; feed[0].fieldSources = { ...feed[0].fieldSources, ...posting.fieldSources }; }
          if (isCancelledSummary(sitting.title)) feed[0].status = "CANCELED";
          continue;
        }
        const [y, m, d] = sitting.date.split("-").map(Number);
        const startsAt = toZonedIso(y, m, d, sitting.hour ?? 0, sitting.minute ?? 0, wiring.timeZone);
        meetings.push({
          ...common, id, title: sitting.title || bodyName, startsAt,
          ...(sitting.hour === null ? { startPrecision: "DAY" as const } : {}), ...placed(sitting.location),
          agendaUrl, publishedLinks: links, ...posting, ...(sitting.agendaSlotObservedEmpty ? { agendaSlotObservedEmpty: true } : {}),
          status: isCancelledSummary(sitting.title) ? "CANCELED" : statusOf(startsAt, sitting.hour === null, now, wiring.timeZone),
          provenance: { sourceUrl: page.url, sourceOrg: wiring.publishingOrg, collectedAt: page.collectedAt, verifiedAt: null, evidenceExcerpt: sitting.evidence },
        });
      }
    }
    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops,
      ...(raw.some(row => row.partialScopes?.length) ? { partialScopes: raw.flatMap(row => row.partialScopes ?? []) } : {}),
    }, { logicalInput: logicalInput, duplicates, countedButProduced });
  };
  return {
    name: SOURCE_NAME, publishedLookbackDays: null,
    async fetch(query?: MeetingQuery): Promise<CivicPlusRaw[]> {
      const collected: CivicPlusRaw[] = [];
      const responses = new Map<string, { text: string; collectedAt: string }>();
      const read = async (url: string, accept: string) => {
        const request = civicPlusRequest(url, accept);
        const existing = responses.get(url);
        if (existing) return existing;
        if (responses.size) await sourceAcquisitionSleep(REQUEST_SPACING_MS, query?.signal);
        const release = await acquireKnownRelease({
          ...cache, sourceId: SOURCE_NAME, releaseId: createHash("sha256").update(url).digest("hex"), url,
          parserVersion: "civicplus/2", signal: query?.signal ?? AbortSignal.timeout(120_000), maxBytes: 8 * 1024 * 1024,
          checkAfterMs: 0, fetchImpl, headers: [...request.headers],
          validate: (bytes, response) => { readValidatedResponse(url, 2, {
            status: response.httpStatus, contentType: response.contentType, text: new TextDecoder().decode(bytes),
          }, accept === "text/calendar" ? { label: "iCalendar feed", marker: "BEGIN:VCALENDAR" }
            : accept === "application/rss+xml" ? { label: "AgendaCenter RSS", marker: "<rss" } : { label: "AgendaCenter", marker: "cat" }); },
        });
        recordAcquiredResponse({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus, bytes: release.bytes });
        const response = { text: new TextDecoder().decode(release.bytes), collectedAt: release.checkedAt };
        responses.set(url, response); return response;
      };
      for (const wiring of wiringRows) {
        const roots = civicPlusCalendarRequests(wiring);
        if (!roots.length) throw new Error(`CIVICPLUS_SOURCE_WIRING_INVALID:${wiring.bodyId}`);
        const rootFor = (accept: string) => roots.find(request => request.headers.some(([name, value]) => name === "accept" && value === accept));
        const partialScopes: PartialScopeFailure[] = [];
        const agendaPages: NonNullable<CivicPlusRaw["agendaPages"]> = [];
        let rss: CivicPlusRaw["rss"];
        let ical = "", collectedAt = "", failure: unknown;
        if (wiring.config.agendaCenterUrl) {
          try {
            const url = rootFor("application/rss+xml")!.url;
            rss = { url, ...await read(url, "application/rss+xml") };
          }
          catch (error) { query?.signal?.throwIfAborted(); partialScopes.push({ scope: "ARCHIVE", ocdIds: [wiring.ocdId], cause: String(error) }); }
        }
        if (wiring.config.icalUrl) {
          try { const reply = await read(rootFor("text/calendar")!.url, "text/calendar"); ical = reply.text; collectedAt = reply.collectedAt; }
          catch (error) { query?.signal?.throwIfAborted(); failure = error; partialScopes.push({ scope: "UPCOMING", ocdIds: [wiring.ocdId], cause: String(error) }); }
        }
        if (wiring.config.agendaCenterUrl) {
          const pending = [rootFor("text/html")!.url], visited = new Set<string>();
          while (pending.length) {
            const url = pending.shift()!;
            if (visited.has(url)) continue;
            visited.add(url);
            try {
              const reply = await read(url, "text/html");
              agendaPages.push({ url, ...reply }); collectedAt ||= reply.collectedAt;
              pending.push(...agendaCenterPages(reply.text, url, wiring.config.agendaCenterCategoryId).filter(next => !visited.has(next)));
            } catch (error) {
              query?.signal?.throwIfAborted(); failure = error;
              partialScopes.push({ scope: "ARCHIVE", ocdIds: [wiring.ocdId], cause: String(error) });
            }
          }
        }
        if (!ical && !agendaPages.length && failure) throw failure;
        collected.push({ wiring, ical, agendaPages, rss, collectedAt, ...(partialScopes.length ? { partialScopes } : {}) });
      }
      return collected;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings,
    normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
