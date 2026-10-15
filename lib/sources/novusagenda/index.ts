/** @freshness-reads-here */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { isPlacelessLocation, resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../../meetings/constants.ts";
import { decodeEntities, politeGetText, REQUEST_SPACING_MS, SourceHttpError } from "../http.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, MeetingQuery, NormalizeDropCounts, PartialScopeFailure, ReportingMeetingSource } from "../types.ts";

interface NovusMeeting {
  id: string;
  date: string;
  body: string;
  location: string;
  agendaUrl: string | null;
  links: Array<{ label: string; href: string }>;
  excerpt: string;
}
interface NovusRaw {
  wiring: BodySourceWiring;
  pages: Array<{ url: string; html: string }>;
  details?: Readonly<Record<string, string>>;
  collectedAt: string;
  partialScopes?: PartialScopeFailure[];
  refused?: true;
  refusedKind?: "WALL" | "JOB";
  refusedReason?: string;
  refusedRung?: number;
}

const plain = (html: string) => decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(tag)?.[2] ?? "");

export function novusPortalUrl(route: string): string {
  const url = new URL(route);
  if (!/^https?:$/.test(url.protocol) || !/(^|\.)novusagenda\.com$/i.test(url.hostname) || !/\/agendapublic(?:\/|$)/i.test(url.pathname)) throw new Error("NOVUS_PORTAL_INVALID");
  url.protocol = "https:";
  if (!/\/meetings(?:general|responsive)?\.aspx$/i.test(url.pathname)) url.pathname = `${url.pathname.split(/\/agendapublic/i)[0]}/AgendaPublic/MeetingsResponsive.aspx`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function novusDate(iso: string): string { const [year, month, day] = iso.slice(0, 10).split("-"); return `${month}/${day}/${year}`; }
export function novusCalendarUrl(wiring: BodySourceWiring, from: string, to: string): URL {
  const url = new URL(novusPortalUrl(wiring.config.portalUrl));
  url.search = new URLSearchParams({ Date: "cus", From: novusDate(from), To: novusDate(to) }).toString();
  return url;
}

export function parseNovusMeetings(html: string, url: string): NovusMeeting[] {
  if (!/(?:rptMeetings|radGridMeetings)/i.test(html)) throw new Error("NOVUS_MEETING_LIST_CHANGED");
  const result: NovusMeeting[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!/(?:rptMeetings|radGridMeetings|extendedMeeting)/i.test(match[0])) continue;
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
    const dateIndex = cells.findIndex(cell => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(plain(cell)));
    if (dateIndex < 0 || cells.length <= dateIndex + 2) continue;
    const [month, day, year] = plain(cells[dateIndex]).split("/").map(Number);
    const date = `${year < 100 ? year + 2000 : year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("NOVUS_DATE_INVALID");
    const mobile = /class=["']mobile-table-td-div["'][^>]*>([\s\S]*?)<\/div>/i.exec(cells[dateIndex + 1]);
    const body = plain(mobile?.[1] ?? cells[dateIndex + 1]);
    if (!body) throw new Error("NOVUS_BODY_MISSING");
    const links: NovusMeeting["links"] = [];
    for (const a of match[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(a[1], "href");
      const opened = /window\.open\(['"]([^'"]+)/i.exec(decodeEntities(attr(a[1], "onclick")))?.[1];
      const target = opened || (href && !/^(?:javascript:|#)/i.test(href) ? href : "");
      if (!target) continue;
      const absolute = new URL(target, url);
      if (absolute.protocol !== "https:") continue;
      const label = attr(/<img\b[^>]*>/i.exec(a[2])?.[0] ?? "", "alt") || plain(a[2]);
      if (label) links.push({ label, href: absolute.toString() });
    }
    const id = /(?:\bMeetingID=|extendedMeeting)(\d+)/i.exec(decodeEntities(match[1]))?.[1];
    if (!id) throw new Error("NOVUS_MEETING_ID_MISSING");
    const agendaUrl = links.find(link => /MeetingView\.aspx/i.test(link.href) && /doctype=Agenda/i.test(link.href))?.href ?? links.find(link => /DisplayAgendaPDF\.ashx/i.test(link.href))?.href ?? null;
    result.push({ id, date, body, location: plain(cells[dateIndex + 2]), agendaUrl, links, excerpt: `${plain(cells[dateIndex])} ${body} ${plain(cells[dateIndex + 2])}`.trim() });
  }
  return result;
}

function novusForm(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(input[0], "name");
    if (name && /^(?:hidden|text)$/i.test(attr(input[0], "type"))) fields[name] = attr(input[0], "value");
  }
  for (const select of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const options = [...select[2].matchAll(/<option\b([^>]*)>/gi)];
    const selected = options.find(option => /\bselected\b/i.test(option[1])) ?? options[0];
    if (selected) fields[attr(select[1], "name")] = attr(selected[1], "value");
  }
  return fields;
}

export function nextNovusPage(html: string, currentUrl: string): { url: string; form?: Record<string, string> } | null {
  const button = /<button\b[^>]*\bid=["'][^"']*btnNextMeeting["'][^>]*>/i.exec(html)?.[0];
  if (button && !/pointer-events\s*:\s*none|\bdisabled\b/i.test(button)) {
    const target = /__doPostBack\(['"]([^'"]+)/.exec(decodeEntities(attr(button, "onclick")))?.[1];
    if (!target) throw new Error("NOVUS_PAGING_CHANGED");
    return { url: currentUrl, form: { ...novusForm(html), __EVENTTARGET: target, __EVENTARGUMENT: "" } };
  }
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/Next Page/i.test(`${attr(anchor[1], "title")} ${anchor[2]}`)) continue;
    const target = /__doPostBack\(['"]([^'"]*\$radGridMeetings\$[^'"]+)/.exec(attr(anchor[1], "href"))?.[1];
    if (target) return { url: currentUrl, form: { ...novusForm(html), __EVENTTARGET: target, __EVENTARGUMENT: "" } };
  }
  return null;
}

function meetingClock(html: string, date: string): { hour: number; minute: number } | null {
  const text = plain(html).slice(0, 2500);
  const [year, month, day] = date.split("-").map(Number);
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1];
  const printedDate = new RegExp(`(?:${monthName}\\s+${day},?\\s+${year}|0?${month}/0?${day}/(?:${year}|${String(year).slice(2)}))`, "i").exec(text);
  if (!printedDate) return null;
  const clock = /^\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(text.slice(printedDate.index + printedDate[0].length));
  if (!clock || Number(clock[1]) < 1 || Number(clock[1]) > 12 || Number(clock[2] ?? 0) > 59) return null;
  return { hour: Number(clock[1]) % 12 + (clock[3].toLowerCase() === "p" ? 12 : 0), minute: Number(clock[2] ?? 0) };
}

const selects = (wiring: BodySourceWiring, row: NovusMeeting) => wiring.config.bodyMatch.split("|").some(name => name.trim().toLowerCase() === row.body.toLowerCase());

export function makeNovusAgendaSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<NovusRaw> {
  const normalizeWithDrops = (raw: NovusRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0, duplicates = 0, countedButProduced = 0, unretrieved = 0;
    const unreachableOcdIds: string[] = [];
    const seen = new Set<string>();
    for (const captured of raw) {
      const { wiring, pages, details = {}, collectedAt } = captured;
      if (captured.refused) { unretrieved++; if (wiring.ocdId) unreachableOcdIds.push(wiring.ocdId); continue; }
      for (const page of pages) for (const row of parseNovusMeetings(page.html, page.url)) {
        logicalInput++;
        if (!selects(wiring, row)) { drops.notConfigured++; continue; }
        const id = `novusagenda:${new URL(page.url).hostname}:${row.id}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        const clock = meetingClock(details[row.id] ?? "", row.date);
        const [year, month, day] = row.date.split("-").map(Number);
        const startsAt = toZonedIso(year, month, day, clock?.hour ?? 0, clock?.minute ?? 0, wiring.timeZone);
        const location = /^(?:CANCELLED|CANCELED|SPECIAL|AMENDED)$/i.test(row.location) ? "" : row.location;
        const online = isPlacelessLocation(location);
        const venue = location && !online ? resolveVenue("novusagenda", wiring.ocdId, location) : null;
        const venueGap = venue || online ? null : unplacedVenueGap(location, wiring.publishingOrg);
        if (venueGap) { drops.unknownVenue++; countedButProduced++; }
        if (online) { drops.placeless++; countedButProduced++; }
        meetings.push({ id, ocdId: wiring.ocdId, bodyId: wiring.bodyId, bodyName: wiring.config.bodyName ?? row.body, title: /^(?:SPECIAL|AMENDED)$/i.test(row.location) ? `${row.body} — ${row.location}` : row.body,
          startsAt, ...(clock ? {} : { startPrecision: "DAY" as const }), timeZone: wiring.timeZone,
          location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(venueGap ? { venueGap } : {}), ...(online ? { online: { label: location, joinUrl: null } } : {}), agendaUrl: row.agendaUrl, publishedLinks: row.links,
          jurisdiction: wiring.jurisdiction, status: /\bcancell?ed\b/i.test(row.excerpt) ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: { sourceUrl: row.agendaUrl ?? page.url, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null, evidenceExcerpt: row.excerpt },
        });
      }
    }
    return accountedNormalize("novusagenda", raw, { meetings, drops, unreachableOcdIds, ...(raw.some(row => row.partialScopes?.length) ? { partialScopes: raw.flatMap(row => row.partialScopes ?? []) } : {}) }, { logicalInput: logicalInput, duplicates, countedButProduced, unretrieved });
  };
  return {
    name: "novusagenda",
    async fetch(query: MeetingQuery) {
      const result: NovusRaw[] = [];
      const heldPages = new Map<string, NovusRaw["pages"]>();
      const refusals = new Map<string, unknown>();
      const now = Date.now();
      const from = query.startsAfter ?? new Date(now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString();
      const to = query.startsBefore ?? new Date(now + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString();
      for (const wiring of rows) {
        if (!wiring.config.bodyMatch?.trim()) throw new Error(`NOVUS_BODY_FILTER_MISSING:${wiring.bodyId}`);
        const url = novusCalendarUrl(wiring, from, to);
        try {
          if (refusals.has(url.toString())) throw refusals.get(url.toString());
          let pages = heldPages.get(url.toString());
          if (!pages) {
            pages = [];
            let next: ReturnType<typeof nextNovusPage> = { url: url.toString() };
            const identities = new Set<string>();
            while (next) {
              let got = await politeGetText(next.url, { fetchImpl, signal: query.signal, form: next.form, accept: "text/html" });
              if (!pages.length && /\/meetingsresponsive\.aspx$/i.test(url.pathname)) {
                const form = novusForm(got.text);
                for (const key of Object.keys(form)) {
                  if (key.endsWith("ddlDateRange")) form[key] = "cus";
                  if (key.endsWith("txtCalendarFrom")) form[key] = novusDate(from);
                  if (key.endsWith("txtCalendarTo")) form[key] = novusDate(to);
                }
                const search = /<input\b[^>]*\bname=["']([^"']*\$btnSearch)["'][^>]*>/i.exec(got.text)?.[1];
                if (!search) throw new Error("NOVUS_DATE_SEARCH_CHANGED");
                form[search] = "Search";
                form.__EVENTTARGET = "";
                form.__EVENTARGUMENT = "";
                await sourceAcquisitionSleep(REQUEST_SPACING_MS, query.signal);
                got = await politeGetText(next.url, { fetchImpl, signal: query.signal, form, accept: "text/html" });
              }
              const parsed = parseNovusMeetings(got.text, next.url);
              const signature = parsed.map(row => row.id).join(",");
              if (pages.length && identities.has(signature)) throw new Error("NOVUS_PAGING_REPEATED");
              identities.add(signature);
              pages.push({ url: next.url, html: got.text });
              next = nextNovusPage(got.text, next.url);
              if (next) await sourceAcquisitionSleep(REQUEST_SPACING_MS, query.signal);
            }
            heldPages.set(url.toString(), pages);
          }
          const details: Record<string, string> = {};
          const partialScopes: PartialScopeFailure[] = [];
          for (const page of pages) for (const row of parseNovusMeetings(page.html, page.url)) {
            if (!selects(wiring, row) || !row.agendaUrl || !/MeetingView\.aspx/i.test(row.agendaUrl)) continue;
            await sourceAcquisitionSleep(REQUEST_SPACING_MS, query.signal);
            try { details[row.id] = (await politeGetText(row.agendaUrl, { fetchImpl, signal: query.signal, accept: "text/html" })).text; }
            catch (error) {
              query.signal?.throwIfAborted();
              partialScopes.push({ scope: Date.parse(row.date) < now ? "ARCHIVE" : "UPCOMING", ocdIds: [wiring.ocdId], cause: String(error) });
            }
          }
          result.push({ wiring, pages, details, collectedAt: new Date().toISOString(), ...(partialScopes.length ? { partialScopes } : {}) });
        } catch (error) {
          query.signal?.throwIfAborted();
          refusals.set(url.toString(), error);
          result.push({ wiring, pages: [], collectedAt: new Date().toISOString(), refused: true,
            refusedKind: error instanceof SourceHttpError ? "WALL" : "JOB", refusedReason: String(error),
            ...(error instanceof SourceHttpError ? { refusedRung: error.rung } : {}) });
        }
      }
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings,
    normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
