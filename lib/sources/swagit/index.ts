import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { soleVenueForBody, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { printedNames, tokenize } from "../../meetings/printed-body-names.ts";
import { decodeEntities, politeGetText, REQUEST_SPACING_MS, SourceHttpError } from "../http.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, MeetingQuery, NormalizeDropCounts, PartialScopeFailure, ReportingMeetingSource } from "../types.ts";

interface SwagitMeeting {
  id: string;
  title: string;
  category: string;
  date: string | null;
  hour: number | null;
  minute: number | null;
  url: string;
  agendaUrl: string | null;
  links: { label: string; href: string }[];
  excerpt: string;
}

interface SwagitRaw {
  wiring: BodySourceWiring;
  pages: { url: string; text: string }[];
  collectedAt: string;
  partialScopes?: PartialScopeFailure[];
  refused?: true;
  refusedKind?: "WALL" | "JOB";
  refusedReason?: string;
  refusedRung?: number;
}

const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function clock(text: string): { date: string; hour: number | null; minute: number | null } | null {
  const found = /\b([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP])M)?\b/i.exec(text);
  if (!found) return null;
  const month = MONTHS.indexOf(found[1].slice(0, 3).toLowerCase()) + 1;
  const day = Number(found[2]);
  const year = Number(found[3]);
  const stamp = new Date(Date.UTC(year, month - 1, day));
  if (!month || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return null;
  if (found[4] && (Number(found[4]) < 1 || Number(found[4]) > 12 || Number(found[5]) > 59)) return null;
  return { date: stamp.toISOString().slice(0, 10), hour: found[4] ? Number(found[4]) % 12 + (found[6].toUpperCase() === "P" ? 12 : 0) : null,
    minute: found[5] ? Number(found[5]) : null };
}

export function parseSwagitMeetings(html: string, pageUrl: string): SwagitMeeting[] {
  const text = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  if (!/\bid=["']video-table["']|Upcoming Events|nav-tabs-swagit/i.test(text)) throw new Error("SWAGIT_LIST_SHAPE_CHANGED");
  let category = "";
  const rows: SwagitMeeting[] = [];
  for (const block of text.matchAll(/<h([34])\b[^>]*>([\s\S]*?)<\/h\1>|<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (block[1]) { category = block[1] === "4" ? plain(block[2]) : ""; continue; }
    const row = block[3];
    const anchors = [...row.matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)]
      .map(anchor => ({ href: new URL(decodeEntities(anchor[2]), pageUrl).toString(), label: plain(anchor[3]) }))
      .filter(anchor => /^https?:\/\//i.test(anchor.href));
    const primary = anchors.find(anchor => {
      const target = new URL(anchor.href);
      return /^\/(?:videos|events|play)\/[^/]+\/?$/.test(target.pathname);
    });
    if (!primary) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => plain(cell[1]));
    const hasDate = (cell: string) => /\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/.test(cell);
    const printed = cells.slice(1).find(hasDate) ?? (cells[0] && hasDate(cells[0]) ? cells[0] : "");
    const when = clock(printed);
    const agenda = anchors.find(anchor => /^agenda(?:\s|$)/i.test(anchor.label));
    const links = anchors.filter(anchor => anchor !== primary && !/^(?:video|show)$/i.test(anchor.label) && anchor.label !== "")
      .filter((anchor, index, all) => all.findIndex(other => other.href === anchor.href) === index);
    const meetingUrl = new URL(primary.href);
    rows.push({ id: meetingUrl.pathname.replace(/^\//, "").replace(/\/$/, ""), title: primary.label,
      category, date: when?.date ?? null, hour: when?.hour ?? null, minute: when?.minute ?? null,
      url: primary.href, agendaUrl: agenda?.href ?? null, links, excerpt: plain(row) });
  }
  return rows;
}

export function swagitMatchesBody(row: Pick<SwagitMeeting, "title" | "category">, bodyMatch: string, bodyName = bodyMatch): boolean {
  const label = (value: string) => value.toLowerCase().replace(/&/g, "and").replace(/\s+meetings?\s*$/, "").replace(/\s+/g, " ").trim();
  const own = label(bodyMatch);
  const explicit = printedNames(row.title, "").filter(name => tokenize(name.text).length >= 2);
  if (explicit.length) {
    const target = label(printedNames(bodyName, "")[0]?.text ?? bodyName);
    const categoryName = label(printedNames(bodyMatch, "")[0]?.text ?? bodyMatch);
    const prefix = categoryName.endsWith(` ${target}`) ? categoryName.slice(0, -target.length) : "";
    return target !== "" && explicit.every(name => label(name.text) === target || (prefix !== "" && label(name.text) === `${prefix}${target}`));
  }
  const title = label(row.title).replace(/^(?:(?:regular|special|emergency|organizational|cancelled|canceled)\s+)+/, "");
  const suffix = title.slice(own.length).trimStart();
  return own !== "" && (label(row.category) === own || title === own || (title.startsWith(own) && /^(?:meetings?\b|regular\b|special\b|emergency\b|study session\b|work session\b|workshop\b|retreat\b|cancelled\b|canceled\b|[-–—:(\d])/.test(suffix)));
}

function nextPage(html: string, pageUrl: string): string | null {
  const currentPage = new URL(pageUrl);
  for (const anchor of html.matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\brel=["']next["']/i.test(anchor[1]) && !/^next\b/i.test(plain(anchor[3]))) continue;
    const url = new URL(decodeEntities(anchor[2]), pageUrl);
    if (url.origin === currentPage.origin && url.pathname === currentPage.pathname) return url.toString();
  }
  return null;
}

export function makeSwagitSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<SwagitRaw> {
  const normalizeWithDrops = (raw: SwagitRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    const unreachableOcdIds: string[] = [];
    let logicalInput = 0;
    let duplicates = 0;
    let countedButProduced = 0;
    let unretrieved = 0;
    for (const rawRow of raw) {
      const { wiring, collectedAt } = rawRow;
      if (rawRow.refused) { unretrieved++; if (wiring.ocdId) unreachableOcdIds.push(wiring.ocdId); continue; }
      const seen = new Set<string>();
      for (const page of rawRow.pages) for (const row of parseSwagitMeetings(page.text, page.url)) {
        logicalInput++;
        if (!swagitMatchesBody(row, wiring.config.bodyMatch, wiring.config.bodyName)) { drops.notConfigured++; continue; }
        if (seen.has(row.id)) { duplicates++; continue; }
        seen.add(row.id);
        if (!row.date) { drops.unplaceableInTime++; continue; }
        const [year, month, day] = row.date.split("-").map(Number);
        const startsAt = toZonedIso(year, month, day, row.hour ?? 0, row.minute ?? 0, wiring.timeZone);
        const at = Date.parse(startsAt);
        const venue = soleVenueForBody("swagit", wiring.ocdId);
        if (!venue) { drops.unknownVenue++; countedButProduced++; }
        meetings.push({ id: `swagit:${wiring.config.slug}:${row.id}`, ocdId: wiring.ocdId, bodyId: wiring.bodyId,
          bodyName: wiring.config.bodyName ?? wiring.publishingOrg, title: row.title, startsAt,
          startPrecision: row.hour === null ? "DAY" : "MINUTE", timeZone: wiring.timeZone,
          location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(!venue ? { venueGap: unplacedVenueGap(null, wiring.publishingOrg) } : {}), agendaUrl: row.agendaUrl,
          ...(row.id.startsWith("videos/") || row.id.startsWith("play/") ? { videoUrl: row.url } : {}),
          publishedLinks: [{ label: "Video", href: row.url }, ...row.links], jurisdiction: wiring.jurisdiction,
          status: /\bcancell?ed\b/i.test(row.title) ? "CANCELED" : at < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: { sourceUrl: page.url, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null, evidenceExcerpt: row.excerpt } });
      }
    }
    return accountedNormalize("swagit", raw, { meetings, drops, unreachableOcdIds,
      ...(raw.some(row => row.partialScopes?.length) ? { partialScopes: raw.flatMap(row => row.partialScopes ?? []) } : {}),
    }, { logicalInput: logicalInput, duplicates, countedButProduced, unretrieved });
  };
  return {
    name: "swagit", publishedLookbackDays: null,
    async fetch(query?: MeetingQuery) {
      const held = new Map<string, Promise<Omit<SwagitRaw, "wiring">>>();
      const read = async (wiring: BodySourceWiring): Promise<Omit<SwagitRaw, "wiring">> => {
        const pages: SwagitRaw["pages"] = [];
        const partialScopes: PartialScopeFailure[] = [];
        const visited = new Set<string>();
        let url: string | null = wiring.config.portalUrl;
        try {
          while (url !== null) {
            if (visited.has(url)) throw new Error(`SWAGIT_PAGING_CYCLE:${url}`);
            visited.add(url);
            const response = await politeGetText(url, { fetchImpl, signal: query?.signal, accept: "text/html" });
            parseSwagitMeetings(response.text, url);
            pages.push({ url, text: response.text });
            url = nextPage(response.text, url);
            if (url !== null) await sourceAcquisitionSleep(REQUEST_SPACING_MS, query?.signal);
          }
        } catch (error) {
          query?.signal?.throwIfAborted();
          if (!pages.length) return { pages, collectedAt: new Date().toISOString(), refused: true,
            refusedKind: error instanceof SourceHttpError ? "WALL" : "JOB", refusedReason: String(error),
            ...(error instanceof SourceHttpError ? { refusedRung: error.rung } : {}) };
          partialScopes.push({ scope: "ARCHIVE", ocdIds: [wiring.ocdId], cause: String(error) });
        }
        return { pages, collectedAt: new Date().toISOString(), ...(partialScopes.length ? { partialScopes } : {}) };
      };
      const result: SwagitRaw[] = [];
      for (const wiring of rows) {
        if (!wiring.config.bodyMatch?.trim() || !wiring.config.portalUrl) throw new Error(`SWAGIT_WIRING_MISSING:${wiring.bodyId}`);
        if (!held.has(wiring.config.portalUrl)) held.set(wiring.config.portalUrl, read(wiring));
        const captured = await held.get(wiring.config.portalUrl)!;
        result.push({ wiring, ...captured, ...(captured.partialScopes ? { partialScopes: captured.partialScopes.map(scope => ({ ...scope, ocdIds: [wiring.ocdId] })) } : {}) });
      }
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings,
    normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
