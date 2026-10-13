

import { calendarFeedUrl } from "../sources/legistar-insite/calendar.ts";
import { verifyOfficialPageEvents } from "../sources/official-page-events/index.ts";
import type { OfficialLinkingPage } from "../civic-data/source-authority.ts";
import { detectTenancy } from "./platform-tenancy.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { parseDiligentMeetings } from "../sources/diligent/index.ts";
import { parseMunicodeMeetings, municodePortalUrl } from "../sources/municode/index.ts";
import { boardDocsBase, parseBoardDocsMeetings } from "../sources/boarddocs/index.ts";
import { parseOrganizationPage } from "../sources/boardbook/index.ts";
import { meetingSourceCadenceHours } from "../control-plane/scheduler/obligation.ts";
import { governmentTimeZone } from "../time/county-time-zones.ts";

export type CandidateBasis = "LINKED" | "SERVED_BY" | "EMBEDDED" | "RECIPE" | "SEARCH" | "HINT";

/** The endpoint families this module can confirm by content. */
export const VERIFIABLE_VENDORS = [
  "ical",
  "legistar-insite",
  "legistar-api",
  "civicplus-agendacenter",
  "civicclerk-api",
  "iqm2",
  "boardbook",
  "boarddocs",
  "municode-meetings",
  "diligent",
  /* A body's own page that dates its public events, verified for that body (`verifyOfficialPage`). */
  "official-page-events",
] as const;
export type VerifiableVendor = (typeof VERIFIABLE_VENDORS)[number];

/** Vendors recognised by host or markup that no content check covers yet: always a LEAD. */
export const LEAD_ONLY_VENDORS: readonly { readonly vendor: string; readonly host: RegExp }[] = [
  { vendor: "novusagenda", host: /(^|\.)novusagenda\.com$/i },
  { vendor: "escribe", host: /(^|\.)escribemeetings\.com$/i },
  { vendor: "primegov", host: /(^|\.)primegov\.com$/i },
  { vendor: "granicus", host: /(^|\.)granicus\.com$/i },
  { vendor: "diligent", host: /(^|\.)(diligentoneplatform\.com|highbond\.com|civicweb\.net)$/i },
  { vendor: "swagit", host: /(^|\.)swagit\.com$/i },
  /* Destiny Agenda (public.destinyhosted.com/agenda_publish.cfm?id=…). */
  { vendor: "destiny-agenda", host: /(^|\.)destinyhosted\.com$/i },
];

export interface EndpointCandidate {
  /** A VerifiableVendor, or a lead-only vendor / "own-site-meetings-page". */
  readonly vendor: string;
  readonly url: string;
  readonly basis: CandidateBasis;
  /** The literal evidence: the href, the fingerprint, or the embed text. */
  readonly evidence: string;
  /** True when `verifyEndpointBody` can confirm this vendor by content. */
  readonly verifiable: boolean;
}

export function siteOrigins(ownWebAddress: string | null): readonly string[] {
  if (ownWebAddress === null) return [];
  const raw = ownWebAddress.trim();
  if (raw === "") return [];
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return [];
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [...new Set([`https://${host}`, `https://${twin}`])];
}

const HREF = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi;

/** Every href/src on the page, resolved against it, http(s) and webcal only, first 2,000. */
export function pageLinks(html: string, pageUrl: string): readonly string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(HREF)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/gi, "&").trim();
    if (raw === "" || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    try {
      const resolved = new URL(raw.replace(/^webcal:\/\//i, "https://"), pageUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      resolved.hash = "";
      out.add(resolved.toString());
    } catch {
      continue;
    }
    if (out.size >= 2000) break;
  }
  return [...out];
}

function isIcalLink(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  const query = url.search.toLowerCase();
  return path.endsWith(".ics") || /[?&](ical|outlook-ical)=1\b/.test(query) || /[?&]format=ical\b/.test(query) ||
    /icalendar\.aspx$/.test(path);
}

const OWN_SITE_MEETINGS = /agenda|minutes|meetings?\b|public-?notices?|boards?-?and-?commissions/i;

export function meetingEndpointCandidates(html: string, pageUrl: string, now?: string): readonly EndpointCandidate[] {
  const page = new URL(pageUrl);
  const origin = `${page.protocol}//${page.host}`;
  const found = new Map<string, EndpointCandidate>();
  const add = (c: EndpointCandidate): void => {
    if (!found.has(c.url)) found.set(c.url, c);
  };
  // A recorded public Diligent portal uses the same service already read by
  // the standing adapter. The caller supplies the clock; no tenant is guessed.
  if (now && /(^|\.)(highbond\.com|civicweb\.net|diligentoneplatform\.com)$/i.test(page.hostname) && /MeetingSchedule\.aspx/i.test(html)) {
    const day = (delta: number) => new Date(Date.parse(now) + delta * 86_400_000).toISOString().slice(0, 10);
    add({ vendor: "diligent", url: `${origin}/Services/MeetingsService.svc/meetings?from=${day(-MEETING_HELD_LOOKBACK_DAYS)}&to=${day(MEETING_HELD_HORIZON_DAYS)}`, basis: "SERVED_BY", evidence: "Diligent public portal links MeetingSchedule.aspx; existing MeetingsService adapter", verifiable: true });
  }

  for (const href of pageLinks(html, pageUrl)) {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    if (isIcalLink(url)) {
      add({ vendor: "ical", url: href, basis: "LINKED", evidence: href, verifiable: true });
      continue;
    }
    if (/^[a-z0-9-]+\.municodemeetings\.com$/i.test(host) || host === "meetings.municode.com" && /^\/PublishPage(?:\/index)?\/?$/i.test(url.pathname)) {
      try { add({ vendor: "municode-meetings", url: municodePortalUrl(href), basis: "LINKED", evidence: href, verifiable: true }); } catch { /* A document link is not a meeting listing. */ }
      continue;
    }
    const legistar = /^([a-z0-9-]+)\.legistar\.com$/.exec(host);
    if (legistar && legistar[1] !== "webapi" && legistar[1] !== "www") {
      add({ vendor: "legistar-insite", url: `https://${legistar[1]}.legistar.com/Calendar.aspx`, basis: "LINKED", evidence: href, verifiable: true });
      add({ vendor: "legistar-api", url: `https://webapi.legistar.com/v1/${legistar[1]}/events?$top=5`, basis: "LINKED", evidence: href, verifiable: true });
      continue;
    }
    const iqm2 = /^([a-z0-9-]+)\.iqm2\.com$/.exec(host);
    if (iqm2) {
      add({ vendor: "iqm2", url: `https://${iqm2[1]}.iqm2.com/Citizens/Calendar.aspx`, basis: "LINKED", evidence: href, verifiable: true });
      continue;
    }
    const boardbook = /^\/Public\/Organization\/(\d+)/i.exec(url.pathname);
    if (host === "meetings.boardbook.org" && boardbook) {
      add({ vendor: "boardbook", url: `https://meetings.boardbook.org/Public/Organization/${boardbook[1]}`, basis: "LINKED", evidence: href, verifiable: true });
      continue;
    }
    if (/(^|\.)boarddocs\.com$/i.test(host) && /\/Board\.nsf(?:\/|$)/i.test(url.pathname)) {
      try {
        add({ vendor: "boarddocs", url: `${boardDocsBase(href)}/Public`, basis: "LINKED", evidence: href, verifiable: true });
      } catch { /* An unrelated vendor page is not a tenant. */ }
      continue;
    }
    const clerk = /^([a-z0-9-]+)\.portal\.civicclerk\.com$/.exec(host);
    if (clerk) {
      add({ vendor: "civicclerk-api", url: `https://${clerk[1]}.api.civicclerk.com/v1/Events?$top=5`, basis: "LINKED", evidence: href, verifiable: true });
      continue;
    }
    if (`${url.protocol}//${url.host}` === origin && /^\/AgendaCenter(?:\/|$)/i.test(url.pathname)) {
      add({ vendor: "civicplus-agendacenter", url: href, basis: "LINKED", evidence: href, verifiable: true });
      continue;
    }
    const lead = LEAD_ONLY_VENDORS.find((v) => v.host.test(host));
    if (lead) {
      add({ vendor: lead.vendor, url: href, basis: "LINKED", evidence: href, verifiable: false });
      continue;
    }
    if (
      `${url.protocol}//${url.host}` === origin &&
      !/\.(png|jpe?g|gif|svg|ico|css|js|woff2?|ttf|webp)$/i.test(url.pathname) &&
      OWN_SITE_MEETINGS.test(`${url.pathname}${url.search}`)
    ) {
      add({ vendor: "own-site-meetings-page", url: href, basis: "LINKED", evidence: href, verifiable: false });
    }
  }

  /* SERVED_BY: CivicPlus hosts under the government's own name; its AgendaCenter route is CivicPlus-wide. */
  if (detectTenancy(html, pageUrl).some((hit) => hit.platform === "civicplus" && hit.strength === "SERVED_BY")) {
    add({ vendor: "civicplus-agendacenter", url: `${origin}/AgendaCenter`, basis: "SERVED_BY", evidence: "CivicPlus markup on the government's own domain", verifiable: true });
  }

  /* EMBEDDED: CivicClerk names its tenant in the host page's own script. */
  const embed = /clerkEmbedProps\s*=\s*\{[^}]*?["']tenant["']\s*:\s*["']([a-z0-9-]+)["']/i.exec(html);
  if (embed) {
    add({ vendor: "civicclerk-api", url: `https://${embed[1].toLowerCase()}.api.civicclerk.com/v1/Events?$top=5`, basis: "EMBEDDED", evidence: embed[0].slice(0, 200), verifiable: true });
  }

  const all = [...found.values()];
  const leadsOwnSite = all.filter((c) => c.vendor === "own-site-meetings-page").slice(0, 5);
  return [
    ...all.filter((c) => c.verifiable),
    ...all.filter((c) => !c.verifiable && c.vendor !== "own-site-meetings-page"),
    ...leadsOwnSite,
  ];
}

/* ------------------------------------------------ CivicPlus calendar feeds */

export const CIVICPLUS_CALENDAR_INDEX_PATH = "/iCalendar.aspx";

/** One category feed a CivicPlus iCalendar index lists: the feed and the name the site gives it. */
export interface CivicPlusCategoryFeed {
  readonly catId: string;
  /** The category as the site names it, entities decoded ("Engineering & Natural Resources"). */
  readonly name: string;
  readonly url: string;
}

const CIVICPLUS_FEED = /\/iCalendar\.aspx$/i;

export function civicPlusCategoryFeeds(html: string, pageUrl: string): readonly CivicPlusCategoryFeed[] {
  const host = new URL(pageUrl).hostname.toLowerCase();
  const out = new Map<string, CivicPlusCategoryFeed>();
  for (const link of anchorLinks(html, pageUrl)) {
    const url = new URL(link.url);
    if (url.hostname.toLowerCase() !== host || !CIVICPLUS_FEED.test(url.pathname)) continue;
    const params = new Map([...url.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
    const catId = params.get("catid") ?? "";
    if (!/^\d+$/.test(catId) || (params.get("feed") ?? "").toLowerCase() !== "calendar" || link.text === "") continue;
    if (!out.has(catId)) out.set(catId, { catId, name: link.text, url: url.toString() });
  }
  return [...out.values()];
}

export type EndpointVerdict = "YIELDED" | "EMPTY" | "NOT_CONFIRMED";

export interface EndpointVerification {
  readonly verdict: EndpointVerdict;
  /** Meetings, events or documents counted in the body; null when not countable. */
  readonly count: number | null;
  readonly detail: string;
}

/* --------------------------------------------------- official-page events */

export const OFFICIAL_PAGE_EVENTS_VERSION = "official-page-events@3d7cbd75f850";

/** Words that name a government's class, not the government itself. */

const CLASS_WORDS = /\b(city|town|village|township|borough|county|of|the|school|schools|public|district|districts|no\.?|number)\b/gi;
const SMALL_WORDS = new Set(["of", "the", "and", "for", "at", "in"]);

function titleCase(words: string): string {
  return words
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function identityNameTerms(name: string): readonly string[] {
  const plain = name.replace(/\s+/g, " ").trim().replace(/\s*(?:#|no\.?\s*)?\d+$/i, "").trim();
  if (plain === "") return [];
  const full = titleCase(plain);
  const core = titleCase(plain.replace(CLASS_WORDS, " ").replace(/\s+/g, " ").trim());
  const initials = plain
    .split(" ")
    .filter((w) => !SMALL_WORDS.has(w.toLowerCase()) && /^[a-z]/i.test(w))
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  const terms = [full];
  if (core.length >= 4 && core !== full) terms.push(core);
  if (initials.length >= 3) terms.push(initials);
  return terms;
}

/** An anchor on a page: where it points, and the words it shows the reader. */
export interface AnchorLink {
  readonly url: string;
  readonly text: string;
}

const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))[^>]*>([\s\S]*?)<\/a>/gi;

function anchorText(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Every http(s) anchor on the page with its visible text, resolved against the page, first 2,000. */
export function anchorLinks(html: string, pageUrl: string): readonly AnchorLink[] {
  const out: AnchorLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(ANCHOR)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/gi, "&").trim();
    if (raw === "" || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    resolved.hash = "";
    const link = { url: resolved.toString(), text: anchorText(m[4]) };
    const key = `${link.url}|${link.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
    if (out.length >= 2000) break;
  }
  return out;
}

/** The body an official page is verified for. */
export interface OfficialPageIdentity {
  readonly bodyId: string;
  /** The body's recorded name; the name forms its events may carry derive from it (`identityNameTerms`). */
  readonly name: string;

  readonly pageLabel: string | null;
  /** The host the walk attested as the body's own: the recorded site, or a host its own redirect named. */
  readonly officialHost: string;
  readonly linkingPage?: OfficialLinkingPage | null;
  readonly stateCode: string;
  /** Census state+county FIPS for the government's meeting location; split counties require a stated clock. */
  readonly countyFips?: string | null;
  readonly now: string;
}

function verifyOfficialPage(
  response: { readonly body: string; readonly finalUrl: string },
  identity: OfficialPageIdentity | undefined,
): EndpointVerification {
  if (identity === undefined) {
    return { verdict: "NOT_CONFIRMED", count: null, detail: "an official page is verified only for a named body, and none was given" };
  }
  const timeZone = governmentTimeZone(identity.stateCode, identity.countyFips);
  if (timeZone === null) {
    return {
      verdict: "NOT_CONFIRMED",
      count: null,
      detail: `TIME_ZONE_UNKNOWN: no single county clock for ${identity.countyFips ?? identity.stateCode}; a wall clock is never guessed`,
    };
  }
  const [name, ...nameForms] = identityNameTerms(identity.name);
  if (name === undefined) return { verdict: "NOT_CONFIRMED", count: null, detail: "the body has no recorded name to verify events against" };
  const label = identity.pageLabel?.trim() ?? "";
  const nameTerms = label.split(/\s+/).filter((w) => w !== "").length >= 2 ? [...nameForms, label] : [...nameForms];
  const result = verifyOfficialPageEvents({
    body: { id: identity.bodyId, name, officialDomain: identity.officialHost, linkingPage: identity.linkingPage, timeZone, nameTerms },
    url: response.finalUrl,
    html: response.body,
    now: identity.now,
  });
  if (result.verdict === "YIELDED") {
    const shown = result.sampleEvents.slice(0, 2).map((e) => `${e.title} (${e.startsAt.slice(0, 10)})`).join("; ");
    const held = result.held.length > 0 ? `; ${result.held.length} held by name` : "";
    return {
      verdict: "YIELDED",
      count: result.sampleEvents.length,
      detail: `${result.sampleEvents.length} dated event(s) verified for ${name} by ${OFFICIAL_PAGE_EVENTS_VERSION}: ${shown}${held}`,
    };
  }
  if (result.verdict === "EMPTY") {
    return { verdict: "EMPTY", count: 0, detail: `${OFFICIAL_PAGE_EVENTS_VERSION}: ${result.reason ?? "no dated event on the page"}` };
  }
  return { verdict: "NOT_CONFIRMED", count: null, detail: `${OFFICIAL_PAGE_EVENTS_VERSION}: no event verified for ${name} (${result.reason ?? "held"})` };
}

function jsonOf(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function verifyEndpointBody(
  candidate: Pick<EndpointCandidate, "vendor" | "url">,
  response: { readonly status: number | null; readonly body: string; readonly finalUrl: string },
  /** The body a page is verified for; required only by `official-page-events`. */
  identity?: OfficialPageIdentity,
): EndpointVerification {
  const { status, body } = response;
  if (status === null || status < 200 || status >= 300) {
    return { verdict: "NOT_CONFIRMED", count: null, detail: `HTTP ${status ?? "none"}: only a 2xx can carry a route` };
  }
  switch (candidate.vendor) {
    case "ical": {
      if (!/^\s*BEGIN:VCALENDAR/i.test(body)) return { verdict: "NOT_CONFIRMED", count: null, detail: "no VCALENDAR: the feed URL answered something that is not a calendar" };
      const events = (body.match(/^BEGIN:VEVENT/gim) ?? []).length;
      return events > 0
        ? { verdict: "YIELDED", count: events, detail: `a calendar with ${events} event(s)` }
        : { verdict: "EMPTY", count: 0, detail: "a calendar with no events in it" };
    }
    case "legistar-insite": {
      const origin = new URL(response.finalUrl).origin;
      const feed = calendarFeedUrl(body, origin);
      return feed !== null
        ? { verdict: "YIELDED", count: null, detail: `the Legistar calendar publishes its feed at ${feed}` }
        : { verdict: "NOT_CONFIRMED", count: null, detail: "no Legistar calendar feed on the page" };
    }
    case "legistar-api":
    case "civicclerk-api": {
      const json = jsonOf(body);
      const rows = candidate.vendor === "legistar-api" ? json : (json as { value?: unknown } | undefined)?.value;
      if (!Array.isArray(rows)) return { verdict: "NOT_CONFIRMED", count: null, detail: "not a JSON list of events" };
      if (rows.length === 0) return { verdict: "EMPTY", count: 0, detail: "the events list is empty" };
      const key = candidate.vendor === "legistar-api" ? "EventId" : "id";
      const shaped = rows.filter((r) => typeof r === "object" && r !== null && key in (r as Record<string, unknown>)).length;
      return shaped > 0
        ? { verdict: "YIELDED", count: shaped, detail: `${shaped} event(s) with ${key}` }
        : { verdict: "NOT_CONFIRMED", count: null, detail: `a JSON list whose rows carry no ${key}` };
    }
    case "civicplus-agendacenter": {
      const docs = (body.match(/\/AgendaCenter\/ViewFile\/(?:Agenda|Minutes)\//gi) ?? []).length;
      if (docs > 0) return { verdict: "YIELDED", count: docs, detail: `${docs} agenda/minutes document link(s)` };
      return /AgendaCenter/i.test(body)
        ? { verdict: "EMPTY", count: 0, detail: "an AgendaCenter page with no document links" }
        : { verdict: "NOT_CONFIRMED", count: null, detail: "not an AgendaCenter page" };
    }
    case "iqm2": {
      const rows = (body.match(/class="Row MeetingRow/g) ?? []).length;
      return rows > 0
        ? { verdict: "YIELDED", count: rows, detail: `${rows} IQM2 meeting row(s)` }
        : { verdict: "NOT_CONFIRMED", count: null, detail: "no IQM2 meeting rows" };
    }
    case "boardbook": {
      const rows = parseOrganizationPage(body).rows.length;
      return rows > 0
        ? { verdict: "YIELDED", count: rows, detail: `${rows} BoardBook meeting link(s)` }
        : { verdict: "NOT_CONFIRMED", count: null, detail: "no BoardBook meeting links" };
    }
    case "municode-meetings": {
      try {
        const rows = parseMunicodeMeetings(body, candidate.url);
        return { verdict: rows.length ? "YIELDED" : "EMPTY", count: rows.length, detail: `${rows.length} public Municode meeting record(s)` };
      } catch {
        return { verdict: "NOT_CONFIRMED", count: null, detail: "not a public Municode meeting listing" };
      }
    }
    case "boarddocs": {
      try {
        const rows = parseBoardDocsMeetings(body);
        return { verdict: rows.length ? "YIELDED" : "EMPTY", count: rows.length, detail: `${rows.length} public BoardDocs meeting record(s)` };
      } catch {
        return { verdict: "NOT_CONFIRMED", count: null, detail: "not a BoardDocs public committee meeting list" };
      }
    }
    case "diligent": {
      const rows = parseDiligentMeetings(body);
      return rows === null ? { verdict: "NOT_CONFIRMED", count: null, detail: "not a Diligent list with meeting identities and local dates" }
        : { verdict: rows.length ? "YIELDED" : "EMPTY", count: rows.length, detail: `${rows.length} public Diligent meeting record(s)` };
    }
    case "official-page-events":
      return verifyOfficialPage(response, identity);
    default:
      return { verdict: "NOT_CONFIRMED", count: null, detail: `no content check exists for ${candidate.vendor}: a lead, not a route` };
  }
}

/* ------------------------------------------------------------- the attempt */

/** What one walk of a government's site established. Never an absence. */
export type DiscoveryOutcome =
  /** A route answered with meetings, confirmed by content. */
  | "FOUND"
  /** A vendor or meetings page was evidenced, but no route was confirmed. */
  | "LEAD"
  /** The pages that could be read showed nothing this walk recognises. */
  | "NOTHING_DETECTED"
  /** Every origin is a wall: its rules, a recorded wall, or a 401, 403 or 429 to this client. */
  | "BLOCKED"
  /** The site could not be read: a transport failure, a server error, or permission rules that could not be read. */
  | "COULD_NOT_READ";

export type StepPermission = "ALLOWED" | "NO_ROBOTS" | "DISALLOWED" | "CANNOT_TELL" | "RECORDED_WALL";

export interface DiscoveryStep {
  readonly purpose: "robots" | "homepage" | "endpoint";
  readonly url: string;
  readonly permission: StepPermission;
  /** Null when no request was sent. */
  readonly status: number | null;
  readonly transportError: string | null;
  readonly bytes: number;
  readonly artifactId: string | null;
  /** The rung this request walked: 2, a plain identified fetch. Null when nothing was sent. */
  readonly rung: 2 | null;
  readonly note: string;

  readonly accessControl?: string;
}

export interface DiscoveryFind {
  readonly vendor: string;
  readonly url: string;
  readonly basis: CandidateBasis;
  readonly evidence: string;
  readonly count: number | null;
  readonly detail: string;
  readonly artifactId: string | null;

  readonly via?: { readonly page: string; readonly artifactId: string | null } | null;
}

/** How the walk reached the government's site: the start of every attestation chain a derived wiring row cites. */
export interface DiscoverySiteProvenance {
  /** Where the recorded address came from; null when the need did not say. */
  readonly address: import("./meetings-discovery.ts").DiscoveryAddressSource | null;
  /** The homepage the walk read as the government's own; null when none was read. */
  readonly homepage: {
    readonly url: string;
    readonly artifactId: string | null;
    /** The recorded address, or the current official site a committed route hint records. */
    readonly basis: "RECORDED_ADDRESS" | "ROUTE_HINT";
    readonly hintFingerprint: string | null;
    /** The origin the walk started from, and each redirect it followed to the homepage it read. */
    readonly startedAt: string;
    readonly redirects: readonly { readonly from: string; readonly to: string; readonly status: number }[];
  } | null;
}

export interface MeetingsDiscoveryAttempt {
  readonly formatVersion: 1;
  readonly attemptId: string;
  readonly jurisdictionId: string;
  readonly stateCode: string;
  readonly ownWebAddress: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: DiscoveryOutcome;
  readonly found: readonly DiscoveryFind[];
  readonly leads: readonly Omit<DiscoveryFind, "count" | "artifactId">[];
  readonly steps: readonly DiscoveryStep[];
  /** Platform and tenant observed on the saved homepage, on a slow refresh clock. */
  readonly platformCensus?: import("../control-plane/discovery/platform-census.ts").PlatformCensusObservation;
  /** Saved methods this walk applied, and those it passed over and why (`lib/hunt/meetings-recipes.ts`). */
  readonly recipes: {
    readonly applied: readonly {
      readonly recipeId: string;
      readonly url: string;
      readonly verdict: EndpointVerdict | "NOT_READ";
      readonly detail: string;
    }[];
    readonly skipped: readonly { readonly recipeId: string; readonly why: string }[];
    /** Methods a search success taught this walk, saved for the next government. */
    readonly learned: readonly import("./meetings-recipes.ts").MeetingsRecipe[];
  };
  /** The search rung: each query, every provider request with its price basis, and the results followed. */
  readonly search: readonly {
    readonly templateId: string;
    readonly recipeId: string | null;
    readonly query: string;
    readonly ownSiteOnly: boolean;
    readonly requests: readonly {
      readonly provider: "brave" | "exa";
      readonly host: string;
      readonly status: "DELIVERED" | "BUDGET_REFUSED" | "FAILED";
      readonly error: string | null;
      readonly hitCount: number;
      readonly usd: number | null;
      readonly priceSource: string;
      readonly priceReadOn: string;
    }[];
    readonly followed: readonly string[];
  }[];
  readonly requestCount: number;
  /** When the need is due to be walked again. A schedule, never a disposition. */
  readonly recheckAfter: string;
  /** One sentence in reader terms: what was walked and what it showed. */
  readonly note: string;
  /** How the walk reached the site. Absent on older walks. */
  readonly site?: DiscoverySiteProvenance;

  readonly routeHints?: {
    readonly fingerprint: string;
    /** The current official site the hint records, walked before the recorded address; null when it records none. */
    readonly officialSite: string | null;
    /** The recorded address that site replaces for the walk. */
    readonly replaces: string | null;
    /** The origin whose homepage the walk read, whichever it was; null when none was read. */
    readonly homepageRead: string | null;
    readonly routes: readonly string[];
  };
}

const REFUSED: ReadonlySet<StepPermission> = new Set(["RECORDED_WALL"]);

/** Answers that are the host walling this client by an access control, as distinct from a failure to reach it. */
const WALL_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

function isWall(step: DiscoveryStep): boolean {
  return step.permission === "RECORDED_WALL";
}

export function decideOutcome(input: {
  readonly found: readonly unknown[];
  readonly leads: readonly unknown[];
  readonly steps: readonly DiscoveryStep[];
}): DiscoveryOutcome {
  if (input.found.length > 0) return "FOUND";
  if (input.leads.length > 0) return "LEAD";
  /* A redirect is a hop, not an answer: judge the steps each chain ended on. */
  const homepage = input.steps.filter((s) => s.purpose === "homepage" && !(s.status !== null && s.status >= 300 && s.status < 400));
  if (homepage.some((s) => s.status !== null && s.status >= 200 && s.status < 300 && s.accessControl === undefined)) return "NOTHING_DETECTED";
  /* Each origin's homepage is a wall when a recorded wall refused it, or when it answered this client with 401, 403 or 429. */
  const walled = (s: DiscoveryStep): boolean =>
    s.accessControl !== undefined ||
    (s.status === null ? s.transportError === null && REFUSED.has(s.permission) && isWall(s) : WALL_STATUSES.has(s.status));
  if (homepage.length > 0 && homepage.every(walled)) return "BLOCKED";
  return "COULD_NOT_READ";
}

/** Discovery keeps checking for new calendars on the same standing source cadence. */
export function recheckAfter(finishedAt: string, meetingStartsAt: readonly string[] = []): string {
  const at = Date.parse(finishedAt);
  return new Date(at + meetingSourceCadenceHours(at, meetingStartsAt) * 3_600_000).toISOString();
}
