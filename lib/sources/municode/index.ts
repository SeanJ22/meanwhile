import { createHash } from "node:crypto";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../../meetings/constants.ts";
import { unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities, politeGetText } from "../http.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, NormalizeDropCounts, ReportingMeetingSource } from "../types.ts";

export interface MunicodeMeeting {
  id: string;
  title: string;
  scopeName: string;
  date: string;
  hour: number | null;
  minute: number | null;
  links: { label: string; href: string; kind: string }[];
  sourceUrl: string;
  excerpt: string;
}
export interface MunicodeRaw { wiring: BodySourceWiring; meetings: MunicodeMeeting[]; outOfWindow: number; notConfigured: number; collectedAt: string }

export const MUNICODE_MAX_PAGES = 10;

const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attribute = (html: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(html)?.[1] ?? "");

export function municodePortalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !(/^[a-z0-9-]+\.municodemeetings\.com$/i.test(url.hostname) || url.hostname === "meetings.municode.com" && /^\/PublishPage(?:\/index)?\/?$/i.test(url.pathname) && url.searchParams.has("cid") && url.searchParams.has("ppid"))) throw new Error("MUNICODE_PORTAL_INVALID");
  return url.toString();
}

export function municodePortalKey(value: string): string {
  const url = new URL(municodePortalUrl(value));
  url.searchParams.delete("p");
  url.searchParams.delete("page");
  url.searchParams.sort();
  if (url.hostname === "meetings.municode.com") url.pathname = "/PublishPage/index";
  url.hash = "";
  return url.toString();
}

export function parseMunicodeMeetings(html: string, portalUrl: string): MunicodeMeeting[] {
  const table = /<table\b[^>]*class=["'][^"']*\b(?:mcm|views-table)\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (table === undefined) {
    if (/class=["'][^"']*\bview-empty\b/i.test(html)) return [];
    throw new Error("MUNICODE_MEETING_TABLE_MISSING");
  }
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<div\b[^>]*class=["']page-title["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? /<b\b[^>]*>((?:City|Town|County) Council Meetings)<\/b>/i.exec(html)?.[1] ?? "";
  const label = plain(heading).replace(/^Meetings\s*[-–:]\s*/i, "").replace(/\s+Meetings$/i, "").replace(/\s*\([^)]*\)\s*$/, "");
  const bodyNoun = /\b(?:council|board|commission|committee|authority|corporation|district)\b/i;
  const scopeName = bodyNoun.test(label) ? label : "";
  const headers = [...table.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)].map(m => ({ kind: plain(m[2]).toLowerCase(), className: attribute(m[1], "class") }));
  const rows: MunicodeMeeting[] = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (!cells.length) continue;
    const cell = (kind: string) => cells.find((m, i) => new RegExp(`(?:^|\\s)${kind}(?:\\s|$)`).test(attribute(m[1], "class")) || headers[i]?.kind === kind)?.[2] ?? "";
    const title = plain(cell("meeting"));
    const dateText = plain(cell("date"));
    const date = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(dateText);
    if (!title || !date) throw new Error("MUNICODE_MEETING_SHAPE_CHANGED");
    const day = `${date[3]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`;
    if (!Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error("MUNICODE_MEETING_DATE_INVALID");
    const clock = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(plain(cell("time")) || dateText);
    if (clock && (Number(clock[1]) < 1 || Number(clock[1]) > 12 || Number(clock[2] ?? 0) > 59)) throw new Error("MUNICODE_MEETING_TIME_INVALID");
    const links = cells.flatMap((m, i) => [...m[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(a => {
      const href = attribute(a[1], "href");
      if (!href || /^(?:javascript|mailto):/i.test(href)) return [];
      const kind = headers[i]?.kind ?? "";
      const label = plain(a[2]) || attribute(a[2], "alt") || attribute(a[1], "title") || kind;
      const url = new URL(href, portalUrl);
      return /^https?:$/.test(url.protocol) ? [{ label, href: url.toString(), kind }] : [];
    }));
    const identity = links.map(l => new URL(l.href).searchParams.get("me") ?? /MEET-(?:Agenda|Packet|Minutes)-([a-f0-9]{32})/i.exec(decodeURIComponent(l.href))?.[1]).find(Boolean);
    const identityUrl = municodePortalKey(portalUrl);
    const detail = links.find(l => /view|details|meeting/.test(l.kind) && /View Details/i.test(l.label));
    const namedTitle = title.replace(/^(?:(?:regular|special|called|joint|combined)\s+)*/i, "");
    const ownScope = scopeName && namedTitle.toLowerCase().startsWith(scopeName.toLowerCase()) && !bodyNoun.test(namedTitle.slice(scopeName.length));
    rows.push({ id: identity ?? createHash("sha256").update(`${identityUrl}|${day}|${title}`).digest("hex").slice(0, 24), title, scopeName: ownScope || !bodyNoun.test(title) ? scopeName : "", date: day,
      hour: clock ? Number(clock[1]) % 12 + (clock[3].toLowerCase() === "p" ? 12 : 0) : null, minute: clock ? Number(clock[2] ?? 0) : null,
      links, sourceUrl: detail?.href ?? portalUrl, excerpt: plain(match[1]),
    });
  }
  if (rows.length === 0 && !/class=["'][^"']*\bview-empty\b/i.test(html)) throw new Error("MUNICODE_MEETING_ROWS_MISSING");
  return rows;
}

export function municodeNextPage(html: string, currentUrl: string): string | null {
  const url = new URL(currentUrl);
  const select = /<select\b[^>]*id=["']agendapal\.page\.dropbox["'][^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1];
  if (select !== undefined) {
    const pages = [...select.matchAll(/<option\b[^>]*value=["'](\d+)["']/gi)].map(m => Number(m[1]));
    const current = Number(url.searchParams.get("p") ?? 1);
    if (current > 0 && pages.includes(current + 1)) { url.searchParams.set("p", String(current + 1)); return url.toString(); }
  }
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bnext\b/i.test(`${attribute(m[1], "rel")} ${attribute(m[1], "title")} ${plain(m[2])}`)) continue;
    const href = attribute(m[1], "href");
    if (!href || href.startsWith("javascript:")) continue;
    const next = new URL(href, currentUrl);
    if (next.origin === url.origin && next.pathname === url.pathname && next.toString() !== url.toString()) return next.toString();
  }
  return null;
}

function selected(title: string, terms: string): boolean {
  return terms.split("|").some(term => {
    const words = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return words && new RegExp(`(?:^|[^a-z0-9])${words}(?:$|[^a-z0-9])`, "i").test(title);
  });
}

export function makeMunicodeSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<MunicodeRaw> {
  const normalizeWithDrops = (raw: MunicodeRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0, countedButProduced = 0, duplicates = 0, outOfWindow = 0;
    const seen = new Set<string>();
    for (const { wiring, meetings: rows, outOfWindow: outside, notConfigured, collectedAt } of raw) {
      logicalInput += outside + notConfigured;
      outOfWindow += outside;
      drops.notConfigured += notConfigured;
      if (!wiring.config.nameTerms?.trim()) throw new Error(`MUNICODE_BODY_FILTER_MISSING:${wiring.bodyId}`);
      for (const row of rows) {
        logicalInput++;
        if (!selected(`${row.title} ${row.scopeName}`, wiring.config.nameTerms)) { drops.notConfigured++; continue; }
        const id = `municode:${wiring.config.slug}:${row.id}`;
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        const [year, month, day] = row.date.split("-").map(Number);
        const startsAt = toZonedIso(year, month, day, row.hour ?? 0, row.minute ?? 0, wiring.timeZone);
        const agenda = row.links.find(l => /agenda/i.test(l.kind) && !/packet/i.test(l.kind));
        const video = row.links.find(l => /video|audio|multimedia/i.test(l.kind));
        drops.unknownVenue++; countedButProduced++;
        meetings.push({ id, ocdId: wiring.ocdId, bodyId: wiring.bodyId, bodyName: wiring.config.bodyName ?? wiring.publishingOrg,
          title: row.title, startsAt, ...(row.hour === null ? { startPrecision: "DAY" as const } : {}), timeZone: wiring.timeZone,
          location: null, venueGap: unplacedVenueGap("", wiring.publishingOrg), agendaUrl: agenda?.href ?? null,
          publishedLinks: row.links.map(({ label, href }) => ({ label, href })), ...(video ? { videoUrl: video.href } : {}),
          jurisdiction: wiring.jurisdiction, status: /\bcancell?ed\b/i.test(row.title) ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: { sourceUrl: row.sourceUrl, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null, evidenceExcerpt: row.excerpt },
        });
      }
    }
    return accountedNormalize("municode", raw.filter(row => row.meetings.length + row.outOfWindow + row.notConfigured > 0), { meetings, drops }, { logicalInput: logicalInput, countedButProduced, duplicates, outOfWindow });
  };
  return {
    name: "municode",
    async fetch(query) {
      let portal: string | null = null;
      for (const wiring of rows) {
        const key = municodePortalKey(wiring.config.portalUrl);
        if (portal !== null && key !== municodePortalKey(portal)) throw new Error("MUNICODE_PORTAL_SCOPE_MIXED");
        portal ??= municodePortalUrl(wiring.config.portalUrl);
      }
      if (portal === null) return [];
      const now = Date.now();
      const firstDay = (query?.startsAfter ?? new Date(now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString()).slice(0, 10);
      const lastDay = (query?.startsBefore ?? new Date(now + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString()).slice(0, 10);
      const meetings: MunicodeMeeting[] = [];
      let outOfWindow = 0;
      let url: string | null = portal;
      const seen = new Set<string>();
      while (url !== null) {
        if (seen.has(url)) throw new Error("MUNICODE_PAGING_LOOP");
        if (seen.size >= MUNICODE_MAX_PAGES) throw new Error(`MUNICODE_PAGE_LIMIT:${MUNICODE_MAX_PAGES}`);
        seen.add(url);
        const response = await politeGetText(url, { fetchImpl, signal: query?.signal, accept: "text/html" });
        const parsed = parseMunicodeMeetings(response.text, url);
        const held = parsed.filter(row => row.date >= firstDay && row.date <= lastDay);
        outOfWindow += parsed.length - held.length;
        meetings.push(...held);
        if (held.length === 0) break;
        const next = municodeNextPage(response.text, url);
        if (next !== null && municodePortalKey(next) !== municodePortalKey(portal)) throw new Error("MUNICODE_PAGING_PORTAL_CHANGED");
        url = next;
      }
      const collectedAt = new Date().toISOString();
      const result = rows.map(wiring => {
        const own = meetings.filter(row => selected(`${row.title} ${row.scopeName}`, wiring.config.nameTerms ?? ""));
        return { wiring, meetings: own, outOfWindow, notConfigured: meetings.length - own.length, collectedAt };
      });
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings, normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
