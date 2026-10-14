/** @freshness-reads-here */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { decodeEntities, readValidatedResponse, sourceRequestHeaders } from "../http.ts";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions } from "../known-release.ts";
import { recordAcquiredResponse } from "../acquisition-trace.ts";
import { accountedNormalize } from "../normalize-account.ts";
import type { Meeting, MeetingQuery, NormalizeDropCounts, PartialScopeFailure, ReportingMeetingSource } from "../types.ts";

export interface GranicusRow {
  id: string;
  title: string;
  date: string;
  hour: number | null;
  minute: number | null;
  agendaUrl: string | null;
  videoUrl?: string;
  links: Array<{ label: string; href: string }>;
  quote: string;
  collectedAt?: string;
}
export interface GranicusRaw {
  wiring: BodySourceWiring;
  html: string;
  feeds?: ReadonlyArray<{ url: string; text: string; collectedAt: string }>;
  collectedAt: string;
  archives?: ReadonlyArray<{ url: string; text: string; collectedAt: string }>;
  partialScopes?: PartialScopeFailure[];
  sourceCheck?: ReturnType<typeof knownReleaseSourceCheck>;
}
type CacheOptions = Pick<KnownReleaseOptions, "store" | "locks" | "now">;
const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
export const granicusBodyLabel = (title: string) => title
  .replace(/\s*[-–:~(]*\s*\bcancell?ed\b[\s)]*/gi, " ")
  .replace(/\s*[-–]?\s+(?:(?:regular|special|legislative|public|budget|work|study|emergency|adjourned|rescheduled|organizational|annual)\s+)*(?:meeting|session|hearing|workshop)\b.*$/i, "")
  .replace(/\s+/g, " ").trim();
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const attr = (html: string, key: string) => new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, "i").exec(html)?.[1];
const pathnameOf = (href: string) => { const url = new URL(href); return url.pathname; };

function link(href: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(href), base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (/\.granicus\.com$/i.test(url.hostname)) url.protocol = "https:";
    return url.toString();
  } catch { return null; }
}
export function granicusPublisherUrl(route: string): string {
  const url = new URL(route);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !/^[a-z0-9-]+\.granicus\.com$/i.test(url.hostname) || !/^\/ViewPublisher(?:RSS)?\.php$/i.test(url.pathname) || !/^\d+$/.test(url.searchParams.get("view_id") ?? "")) throw new Error("GRANICUS_PUBLISHER_INVALID");
  return `https://${url.host}/ViewPublisher.php?view_id=${url.searchParams.get("view_id")}`;
}
function identity(url: string): string | null {
  const query = new URL(url).searchParams;
  return query.has("clip_id") ? `clip:${query.get("clip_id")}` : query.has("event_id") ? `event:${query.get("event_id")}` : null;
}
function dateOf(text: string): string | null {
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(text);
  const month = numeric ? Number(numeric[1]) : named ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].slice(0, 3).toLowerCase()) + 1 : 0;
  const day = Number(numeric?.[2] ?? named?.[2]);
  const yearText = numeric?.[3] ?? named?.[3];
  if (!yearText || !month) return null;
  const year = Number(yearText) + (yearText.length === 2 ? 2000 : 0);
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : null;
}
function clockOf(text: string) {
  const clock = /\b(\d{1,2}):(\d{2})\s*([AP])M\b/i.exec(text);
  return clock && Number(clock[1]) >= 1 && Number(clock[1]) <= 12 && Number(clock[2]) < 60
    ? { hour: Number(clock[1]) % 12 + (clock[3].toUpperCase() === "P" ? 12 : 0), minute: Number(clock[2]) } : null;
}
function linksIn(html: string, base: string): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  for (const tag of html.matchAll(/<(a|option)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const direct = attr(tag[2], tag[1].toLowerCase() === "option" ? "value" : "href");
    const popup = /window\.open\(\s*["']([^"']+)/i.exec(tag[2])?.[1];
    const href = link(popup ?? direct ?? "", base);
    const label = plain(tag[3]);
    if (href && label && (direct || popup) && !links.some(row => row.href === href && row.label === label)) links.push({ label, href });
  }
  return links;
}
export function granicusFeedUrls(html: string, route: string): string[] {
  const url = new URL(granicusPublisherUrl(route));
  return [...new Set(linksIn(clean(html), route).map(row => row.href).filter(href => {
    const feed = new URL(href);
    return feed.origin === url.origin && /\/ViewPublisherRSS\.php$/i.test(feed.pathname) && feed.searchParams.get("view_id") === url.searchParams.get("view_id") && [null, "agendas", "minutes"].includes(feed.searchParams.get("mode"));
  }))];
}
export function granicusArchiveSearchUrl(html: string, route: string): string | null {
  const publisher = new URL(granicusPublisherUrl(route));
  for (const form of clean(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = link(attr(form[1], "action") ?? "", route);
    if (!action || (attr(form[1], "method") ?? "GET").toUpperCase() !== "GET") continue;
    const url = new URL(action);
    if (url.origin !== publisher.origin || !/^\/ViewSearchResults\.php$/i.test(url.pathname)) continue;
    let search = false;
    for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
      const name = attr(input[1], "name");
      if (!name) continue;
      if (/^(keywords|allwords)$/i.test(name) && !/\brequired\b/i.test(input[1])) { url.searchParams.set(name, ""); search = true; }
      else if (attr(input[1], "type")?.toLowerCase() === "hidden") url.searchParams.set(name, decodeEntities(attr(input[1], "value") ?? ""));
    }
    if (search && url.searchParams.get("view_id") === publisher.searchParams.get("view_id")) return url.toString();
  }
  return null;
}
export function parseGranicusPublisher(html: string, route: string): GranicusRow[] {
  const source = clean(html);
  if (/\/ViewSearchResults\.php$/i.test(pathnameOf(route)) && /No video clips matched the Keyword Search/i.test(source)) return [];
  if (!/<table\b/i.test(source) || !/granicus|ViewPublisher|AgendaViewer|MediaPlayer/i.test(source)) throw new Error("GRANICUS_PUBLISHER_SHAPE_CHANGED");
  const result: GranicusRow[] = [];
  let heading = "";
  for (const block of source.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>|<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (block[1] !== undefined) { heading = plain(block[1]); continue; }
    const row = block[2];
    const cells = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    const named = cells.find(cell => /^(?:Event)?Name(?:\s|$)/i.test(attr(cell[1], "headers") ?? ""));
    const dated = cells.find(cell => /^(?:Event)?Date(?:\s|$)/i.test(attr(cell[1], "headers") ?? ""));
    if (!dated) continue;
    const visibleDate = plain(dated[2].replace(/<span\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ""));
    const date = dateOf(visibleDate);
    const links = linksIn(row, route);
    const permalink = links.find(row => identity(row.href));
    const id = permalink ? identity(permalink.href) : null;
    const title = named ? plain(named[2]) : (attr(dated[1], "headers") ?? "").replace(/^Date\s+/i, "").replace(/-/g, " ").replace(/\s+/g, " ").trim() || heading;
    if (!date || !title) throw new Error("GRANICUS_MEETING_SHAPE_CHANGED");
    const clock = clockOf(`${visibleDate} ${plain(cells.find(cell => /^Time\b/i.test(attr(cell[1], "headers") ?? ""))?.[2] ?? "")}`);
    const agendaUrl = links.find(row => /\bagenda\b/i.test(row.label) || /\/AgendaViewer\.php/i.test(pathnameOf(row.href)) && !/minutes|docket|caption/i.test(row.label))?.href ?? null;
    const videoUrl = links.find(row => /\/MediaPlayer\.php/i.test(pathnameOf(row.href)))?.href;
    result.push({ id: id ?? `schedule:${title}:${date}:${clock?.hour ?? "day"}:${clock?.minute ?? ""}`, title, date, hour: clock?.hour ?? null, minute: clock?.minute ?? null, agendaUrl, ...(videoUrl ? { videoUrl } : {}), links, quote: plain(row) });
  }
  return result;
}
export function parseGranicusFeed(xml: string, route: string): GranicusRow[] {
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error("GRANICUS_RSS_SHAPE_CHANGED");
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(item => {
    const value = (key: string) => new RegExp(`<${key}\\b[^>]*>([\\s\\S]*?)<\\/${key}>`, "i").exec(item[1])?.[1] ?? "";
    const title = plain(value("title"));
    const date = dateOf(title);
    const href = link(value("link").trim(), route);
    const id = href ? identity(href) : null;
    if (!date || !href || !id) throw new Error("GRANICUS_RSS_MEETING_SHAPE_CHANGED");
    const minutes = new URL(route).searchParams.get("mode") === "minutes";
    const agendaUrl = !minutes && /\/AgendaViewer\.php/i.test(pathnameOf(href)) ? href : null;
    const videoUrl = /\/MediaPlayer\.php/i.test(pathnameOf(href)) ? href : undefined;
    const links = [{ label: agendaUrl ? "Agenda" : videoUrl ? "Video" : "Minutes", href }];
    return { id, title: title.replace(/\s+-\s+[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}.*$/, ""), date, hour: null, minute: null, agendaUrl, ...(videoUrl ? { videoUrl } : {}), links, quote: plain(item[1]) };
  });
}
export function granicusRows(raw: GranicusRaw): GranicusRow[] {
  const rows = new Map(parseGranicusPublisher(raw.html, raw.wiring.config.publisherUrl).map(row => [row.id, { ...row, collectedAt: raw.collectedAt }]));
  const supplements = [
    ...(raw.archives ?? []).flatMap(archive => parseGranicusPublisher(archive.text, archive.url).map(row => ({ ...row, collectedAt: archive.collectedAt }))),
    ...(raw.feeds ?? []).flatMap(feed => parseGranicusFeed(feed.text, feed.url).map(row => ({ ...row, collectedAt: feed.collectedAt }))),
  ];
  for (const row of supplements) {
    const held = rows.get(row.id);
    if (!held) { rows.set(row.id, row); continue; }
    rows.set(row.id, { ...held, hour: held.hour ?? row.hour, minute: held.minute ?? row.minute,
      collectedAt: [held.collectedAt, row.collectedAt].sort().at(-1)!,
      agendaUrl: held.agendaUrl ?? row.agendaUrl, videoUrl: held.videoUrl ?? row.videoUrl,
      links: [...held.links, ...row.links.filter(link => !held.links.some(other => other.href === link.href))] });
  }
  return [...rows.values()];
}
export function makeGranicusSource(rows: BodySourceWiring[], fetchImpl?: typeof fetch, cache: CacheOptions = {}): ReportingMeetingSource<GranicusRaw> {
  const normalizeWithDrops = (raw: GranicusRaw[], now = new Date()) => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let logicalInput = 0;
    for (const input of raw) for (const row of granicusRows(input)) {
      logicalInput++;
      const { wiring, collectedAt } = input;
      const labels = wiring.config.bodyMatch?.split("|").map(label => granicusBodyLabel(label).toLowerCase()) ?? [];
      if (!labels.includes(granicusBodyLabel(row.title).toLowerCase())) { drops.notConfigured++; continue; }
      const [year, month, day] = row.date.split("-").map(Number);
      const startsAt = toZonedIso(year, month, day, row.hour ?? 0, row.minute ?? 0, wiring.timeZone);
      const venue = resolveVenue("granicus", wiring.ocdId, "", wiring.config.slug);
      const venueGap = venue ? null : unplacedVenueGap("", wiring.publishingOrg);
      if (venueGap) drops.unknownVenue++;
      meetings.push({ id: `granicus:${new URL(wiring.config.publisherUrl).hostname}:${row.id}`, ocdId: wiring.ocdId, bodyId: wiring.bodyId,
        bodyName: wiring.config.bodyName, title: row.title, startsAt, ...(row.hour === null ? { startPrecision: "DAY" as const } : {}), timeZone: wiring.timeZone,
        location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null, ...(venueGap ? { venueGap } : {}),
        agendaUrl: row.agendaUrl, ...(row.videoUrl ? { videoUrl: row.videoUrl } : {}), publishedLinks: row.links,
        jurisdiction: wiring.jurisdiction, status: /\bcancell?ed\b/i.test(row.title) ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
        provenance: { sourceUrl: row.agendaUrl ?? row.videoUrl ?? wiring.config.publisherUrl, sourceOrg: wiring.publishingOrg, collectedAt: row.collectedAt ?? collectedAt, verifiedAt: null, evidenceExcerpt: row.quote },
      });
    }
    return accountedNormalize("granicus", raw, { meetings, drops, ...(raw.some(row => row.partialScopes?.length) ? { partialScopes: raw.flatMap(row => row.partialScopes ?? []) } : {}) }, { logicalInput: logicalInput, countedButProduced: drops.unknownVenue });
  };
  return {
    name: "granicus", publishedLookbackDays: null,
    async fetch(query?: MeetingQuery) {
      const result: GranicusRaw[] = [];
      const tenants = new Map<string, Omit<GranicusRaw, "wiring">>();
      const read = async (url: string, format: "html" | "rss") => {
        const release = await acquireKnownRelease({ ...cache, sourceId: "granicus", releaseId: url, url, parserVersion: "granicus/1", signal: query?.signal ?? AbortSignal.timeout(120_000),
          maxBytes: 16 * 1024 * 1024, checkAfterMs: 60_000, fetchImpl, headers: sourceRequestHeaders(format === "rss" ? "application/rss+xml" : "text/html"),
          validate: bytes => { const text = new TextDecoder().decode(bytes); readValidatedResponse(url, 2, { status: 200, contentType: format, text });
            if (format === "rss") parseGranicusFeed(text, url); else parseGranicusPublisher(text, url); },
        });
        recordAcquiredResponse({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus, bytes: release.bytes });
        return { text: new TextDecoder().decode(release.bytes), collectedAt: release.retrievedAt, sourceCheck: knownReleaseSourceCheck(release) };
      };
      for (const wiring of rows) {
        const url = granicusPublisherUrl(wiring.config.publisherUrl);
        let tenant = tenants.get(url);
        if (!tenant) {
          // Conditional list checks run before document work; RSS publication
          // dates never supply a meeting clock.
          const publisher = await read(url, "html");
          const feeds = [];
          const archives = [];
          const partialScopes: PartialScopeFailure[] = [];
          for (const feedUrl of granicusFeedUrls(publisher.text, url)) {
            try { const feed = await read(feedUrl, "rss"); feeds.push({ url: feedUrl, text: feed.text, collectedAt: feed.collectedAt }); }
            catch (error) { query?.signal?.throwIfAborted(); partialScopes.push({ scope: "ARCHIVE", ocdIds: rows.filter(row => granicusPublisherUrl(row.config.publisherUrl) === url).flatMap(row => row.ocdId ? [row.ocdId] : []), cause: String(error) }); }
          }
          const archiveUrl = granicusArchiveSearchUrl(publisher.text, url);
          if (archiveUrl) {
            try { const archive = await read(archiveUrl, "html"); archives.push({ url: archiveUrl, text: archive.text, collectedAt: archive.collectedAt }); }
            catch (error) { query?.signal?.throwIfAborted(); partialScopes.push({ scope: "ARCHIVE", ocdIds: rows.filter(row => granicusPublisherUrl(row.config.publisherUrl) === url).flatMap(row => row.ocdId ? [row.ocdId] : []), cause: String(error) }); }
          }
          tenant = { html: publisher.text, feeds, archives, collectedAt: publisher.collectedAt, sourceCheck: publisher.sourceCheck, ...(partialScopes.length ? { partialScopes } : {}) };
          tenants.set(url, tenant);
        }
        result.push({ wiring, ...tenant });
      }
      return result;
    },
    normalize: (raw, now) => normalizeWithDrops(raw, now).meetings,
    normalizeWithDrops,
    async upsert(meetings) { return { inserted: 0, updated: meetings.length }; },
  };
}
