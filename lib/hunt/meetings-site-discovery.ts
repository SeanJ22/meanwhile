/**
 * **FIND A GOVERNMENT'S MEETING ROUTE FROM ITS OWN SITE, WITHOUT A MODEL.**
 * (2026-09-23.)
 *
 * The gap ledger records 1,975 governments whose own website is known and
 * whose meetings are DISCOVERY_OWED (`lib/hunt/meetings-discovery.ts`). This
 * module is the pure half of the unpaid executor that walks them: given a page
 * the government published, it names the meeting routes that page proves, and
 * given a route's response, it says whether the route actually yields meetings.
 *
 * ## Evidence, never a guess
 *
 * A candidate comes only from something the government's own page carries:
 *
 * - **LINKED**: an href to a vendor host or a calendar feed.
 * - **SERVED_BY**: the vendor's markup on the government's own domain.
 * - **EMBEDDED**: a vendor tenant named in the page's own script.
 *
 * The executor adds two more. **RECIPE** is a saved method's path on the
 * government's own origin, proposed only when this page shows the method's
 * precondition, or a link this page itself carries on its own host
 * (`lib/hunt/meetings-recipes.ts`). **SEARCH** is a search result
 * on the government's own domain or a known meeting-publisher host
 * (`lib/hunt/discovery-search.ts`), used only when nothing else was confirmed.
 *
 * No tenant slug is derived from a name. The measured traps (`docs/source-ladder.md`)
 * are why: every `*.novusagenda.com/agendapublic/` answers 200, and a guessed
 * Legistar tenant looks like a real one until a control query says otherwise.
 * Guessing is a later rung with `ControlledProbe`, not this one.
 *
 * ## Verified by content, never by status
 *
 * A 200 is not a route. An iCal feed must hold a VEVENT, a Legistar events call
 * a JSON array of events, an AgendaCenter page an agenda document link. A feed
 * URL that answers with an HTML shell is NOT_CONFIRMED. Measured traps: IQM2
 * `/Services/iCalendar.aspx` and CivicWeb `/Portal/ICal.aspx` both answer 200
 * HTML.
 *
 * A vendor we can recognise but not yet read is a LEAD: named, kept, and never
 * reported as a route. The vendor is not the record (RULING 248).
 *
 * PURE: no fetch, no clock, no store.
 */

import { calendarFeedUrl } from "../sources/legistar-insite/calendar.ts";
import { verifyOfficialPageEvents } from "../sources/official-page-events/index.ts";
import type { OfficialLinkingPage } from "../civic-data/source-authority.ts";
import { detectTenancy } from "./platform-tenancy.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { parseDiligentMeetings } from "../sources/diligent/index.ts";
import { meetingSourceCadenceHours } from "../control-plane/scheduler/obligation.ts";

/**
 * How a candidate was evidenced. The first three come from the government's
 * own page; RECIPE is a saved method's path on the government's own origin,
 * proposed only when the page shows the method's precondition
 * (`lib/hunt/meetings-recipes.ts`); SEARCH is a search result on the
 * government's own domain or a known meeting-publisher host
 * (`lib/hunt/discovery-search.ts`); HINT is a committed route hint
 * (`lib/hunt/meetings-route-hints.ts`). All six are confirmed by content alike,
 * and a hint no content check covers is a lead.
 */
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
  { vendor: "municode-meetings", host: /(^|\.)municodemeetings\.com$/i },
  { vendor: "boarddocs", host: /(^|\.)boarddocs\.com$/i },
  { vendor: "diligent", host: /(^|\.)(diligentoneplatform\.com|highbond\.com|civicweb\.net)$/i },
  { vendor: "swagit", host: /(^|\.)swagit\.com$/i },
  /* Destiny Agenda (public.destinyhosted.com/agenda_publish.cfm?id=…). Chandler, AZ publishes its council agendas there (2026-09-24). */
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

/**
 * The origins to try for a recorded website, https first: the address as
 * recorded, then its www/apex twin. Apex and www are different origins for
 * permission and transport (method route
 * `apex-and-www-are-different-origins-for-permission-and-transport`). Empty
 * when the address is not a usable public http(s) host.
 */
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

/**
 * The meeting routes this page proves, verifiable ones first, then leads. A
 * candidate is unique by URL. Own-site meeting pages are leads only: a page is
 * not a route until an adapter can read it.
 */
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
    const clerk = /^([a-z0-9-]+)\.portal\.civicclerk\.com$/.exec(host);
    if (clerk) {
      add({ vendor: "civicclerk-api", url: `https://${clerk[1]}.api.civicclerk.com/v1/Events?$top=5`, basis: "LINKED", evidence: href, verifiable: true });
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

/**
 * **A CIVICPLUS SITE LISTS ITS CALENDAR FEEDS, ONE PER CATEGORY.** (2026-09-25, the 85635 expansion.)
 *
 * An AgendaCenter page cannot be wired: the ICAL wiring reads a feed. But every CivicPlus (CivicEngage) site serves
 * `/iCalendar.aspx`, a page listing one iCal feed per calendar category
 * (`/common/modules/iCalendar/iCalendar.aspx?catID=<n>&feed=calendar`), each linked under the category's own name.
 * Cochise County, AZ lists 25, "Board of Supervisors" among them (catID 31, read 2026-09-26). The index is
 * CivicPlus-wide, like the AgendaCenter route, so it is read only on a site whose own markup shows CivicPlus.
 */
export const CIVICPLUS_CALENDAR_INDEX_PATH = "/iCalendar.aspx";

/** One category feed a CivicPlus iCalendar index lists: the feed and the name the site gives it. */
export interface CivicPlusCategoryFeed {
  readonly catId: string;
  /** The category as the site names it, entities decoded ("Engineering & Natural Resources"). */
  readonly name: string;
  readonly url: string;
}

const CIVICPLUS_FEED = /\/iCalendar\.aspx$/i;

/**
 * The category calendar feeds a CivicPlus iCalendar index lists, in page order, one per category id. Only a link on
 * the index's own host, to a `feed=calendar` feed with a `catID`, carrying a visible name, counts: the news and alert
 * feeds the same page lists are not calendars, and a feed with no name cannot be matched to a body.
 */
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

/**
 * The exact parser an official page is verified with: the
 * `lib/sources/official-page-events` adapter, named by the first 12 hex of the
 * digest of its value-import closure (`digestValueClosure`,
 * lib/ops/generator-digest.ts: every file its runtime reaches, name and code;
 * comments, formatting and erased types are ignored;
 * an import that carries only types cannot change behaviour and is left out). A
 * test recomputes it, so a change anywhere the parser's runtime reaches fails
 * until this is bumped, and anything keyed on it (a saved method, a wiring row)
 * re-keys cleanly.
 */
export const OFFICIAL_PAGE_EVENTS_VERSION = "official-page-events@9a5f6ab4eb33";

/**
 * The zone a state's bodies meet in, for the states that sit in one zone. A
 * state that spans zones is absent, so its wall clocks are never guessed and a
 * page for one of its bodies is not confirmed.
 *
 * **EVERY ONE-ZONE STATE, NOT ONLY THE PILOT FOUR** (2026-09-25). A walk of a
 * government in Ohio could never confirm an official events page, because the
 * table named only the states the pilot had worked. It now names every state
 * and territory that lies wholly in one zone. Left out, so their wall clocks
 * are still never guessed: the states a zone line crosses (AK, FL, ID, IN, KS,
 * KY, MI, ND, NE, OR, SD, TN, TX), and two whose towns keep a neighbour's time
 * by local practice (AL's Phenix City keeps Eastern; NV's West Wendover keeps
 * Mountain).
 */
export const STATE_TIME_ZONES: Readonly<Record<string, string>> = {
  AZ: "America/Phoenix",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  ...Object.fromEntries(["CT", "DC", "DE", "GA", "MA", "MD", "ME", "NC", "NY", "OH", "PA", "RI", "SC", "VA", "VT", "WV"].map((s) => [s, "America/New_York"])),
  ...Object.fromEntries(["AR", "IA", "IL", "LA", "MN", "MO", "MS", "OK", "WI"].map((s) => [s, "America/Chicago"])),
  ...Object.fromEntries(["CO", "MT", "UT", "WY"].map((s) => [s, "America/Denver"])),
  CA: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  HI: "Pacific/Honolulu",
  PR: "America/Puerto_Rico",
  VI: "America/St_Thomas",
  GU: "Pacific/Guam",
  MP: "Pacific/Saipan",
  AS: "Pacific/Pago_Pago",
};

/** Words that name a government's class, not the government itself. */
/*
 * "Unified" and "Union" stay: they tell TUCSON UNIFIED from the City of Tucson,
 * and a shorter core would let a neighbor's events verify.
 */
const CLASS_WORDS = /\b(city|town|village|township|borough|county|of|the|school|schools|public|district|districts|no\.?|number)\b/gi;
const SMALL_WORDS = new Set(["of", "the", "and", "for", "at", "in"]);

function titleCase(words: string): string {
  return words
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * The names a body's own events may carry, derived only from the body's
 * recorded name, never from the page:
 * - the name, title-cased, without a trailing district number ("Tucson Unified
 *   School District");
 * - the name without its class words ("Tucson Unified");
 * - its initials, when they make at least three letters ("TUSD").
 * The first is the body's name; the rest are the terms an event title may use
 * instead of it.
 */
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
  /**
   * The words the body's own homepage used to link this page ("Board of Education"), or null when the
   * page was not reached by such a link. With at least two words, the label is a name events may carry:
   * the government itself says whose page this is. A one-word label ("Council") is too general to name a body.
   */
  readonly pageLabel: string | null;
  /** The host the walk attested as the body's own: the recorded site, or a host its own redirect named. */
  readonly officialHost: string;
  readonly linkingPage?: OfficialLinkingPage | null;
  readonly stateCode: string;
  readonly now: string;
}

/**
 * Is this page a route for the body's dated public events? The rules are the
 * adapter's own `verifyOfficialPageEvents`, so a page this confirms is a page
 * the standing runner would publish from: an event verifies only on the body's
 * official host, named for the body in its title, and dated in the body's
 * state's zone. A page for a body in an untabled state is never confirmed.
 */
function verifyOfficialPage(
  response: { readonly body: string; readonly finalUrl: string },
  identity: OfficialPageIdentity | undefined,
): EndpointVerification {
  if (identity === undefined) {
    return { verdict: "NOT_CONFIRMED", count: null, detail: "an official page is verified only for a named body, and none was given" };
  }
  const timeZone = STATE_TIME_ZONES[identity.stateCode.toUpperCase()];
  if (timeZone === undefined) {
    return {
      verdict: "NOT_CONFIRMED",
      count: null,
      detail: `TIME_ZONE_UNKNOWN: ${identity.stateCode} is not a one-zone state this module tables, and a wall clock is never guessed`,
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

/**
 * Does this response actually yield meetings? Only a 2xx can, and only by
 * content: a route that answers an HTML shell, an error page or someone else's
 * data is NOT_CONFIRMED, never a find.
 */
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
      const rows = new Set(body.match(/\/Public\/Meeting\/\d+/gi) ?? []).size;
      return rows > 0
        ? { verdict: "YIELDED", count: rows, detail: `${rows} BoardBook meeting link(s)` }
        : { verdict: "NOT_CONFIRMED", count: null, detail: "no BoardBook meeting links" };
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

/** What one walk of a government's site established. Never an absence (RULING 250). */
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
  /** RULING 249's rung this request walked: 2, a plain identified fetch. Null when nothing was sent. */
  readonly rung: 2 | null;
  readonly note: string;
  /**
   * The access control that answered in place of the page (a bot challenge, at any status), when one did
   * (2026-09-25). Absent on a step that read the page, and on every step recorded before that date.
   */
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
  /**
   * The page whose link this route came from, with its vaulted artifact: what a derived wiring row's host
   * attestation chains through (NH330). Null for a route no read page linked (a hint, a saved method's path, a
   * search result itself). Absent on walks recorded before 2026-09-24.
   */
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
  /**
   * The committed route hints this walk tried first (`lib/hunt/meetings-route-hints.ts`). Absent when the
   * government has none. A need whose hints no longer match `fingerprint` is due again at once.
   */
  /** How the walk reached the site (NH330 attestation). Absent on walks recorded before 2026-09-24. */
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

/**
 * The step permission that refuses a request: a recorded access-control wall, and nothing else. A robots.txt
 * verdict (DISALLOWED, CANNOT_TELL) is recorded on the step and never refuses a public page (owner decision
 * 2026-09-25), so a walk no longer produces an unrequested step for one.
 */
const REFUSED: ReadonlySet<StepPermission> = new Set(["RECORDED_WALL"]);

/** Answers that are the host walling this client by an access control, as distinct from a failure to reach it. */
const WALL_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

/**
 * Whether an unrequested step is a wall: a recorded access-control wall. The
 * walk's own request bound also leaves a step unrequested, and says nothing
 * about the host: the walk could not read the site. A robots.txt verdict is
 * never a wall (owner decision 2026-09-25).
 */
function isWall(step: DiscoveryStep): boolean {
  return step.permission === "RECORDED_WALL";
}

/**
 * The outcome a walk earned. The executor records one homepage step per
 * origin, whether it was requested or refused, so the homepage steps say
 * whether the site was read, walled, or unreachable. BLOCKED means every
 * origin is walled by an access control: a recorded wall refused the request,
 * or it answered this client with 401, 403 or 429. A robots.txt verdict never
 * makes a wall (owner decision 2026-09-25). A transport failure, a server
 * error or the walk's own bound is COULD_NOT_READ, because a site nobody could
 * reach has refused nothing.
 */
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

/** Discovery keeps checking for new calendars on the same §4 source cadence. */
export function recheckAfter(finishedAt: string, meetingStartsAt: readonly string[] = []): string {
  const at = Date.parse(finishedAt);
  return new Date(at + meetingSourceCadenceHours(at, meetingStartsAt) * 3_600_000).toISOString();
}
