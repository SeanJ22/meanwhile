
import { createHash } from "node:crypto";
import { parseDiligentMeetings } from "../../sources/diligent/index.ts";

import type { DerivedInputRef } from "../../civic-data/derived-authority.ts";
import { httpsHost } from "../../civic-data/derived-door.ts";
import type {
  AutoCrosswalkAccepted,
  AutoCrosswalkHold,
  AutoCrosswalkHoldReason,
  AutoCrosswalkReview,
} from "../../civic-data/derived-crosswalk.ts";
import {
  CROSSWALK_CITATION,
  crosswalkRowId,
  crosswalkRowIssue,
  crosswalkSlug,
  subBodyId,
  type CrosswalkKind,
  type MeetingBodyCrosswalkRow,
} from "../../civic-data/meeting-body-crosswalk.ts";
import { accessControlIn } from "../../hunt/access-control.ts";
import { civicPlusCategoryFeeds, type DiscoveryFind, type DiscoveryStep, type MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import { parseIcs } from "../../sources/ical/index.ts";
import { extractOfficialPageEvents } from "../../sources/official-page-events/index.ts";
import { attestationFor, sameRoute } from "./derived-wiring.ts";
import { countyTimeZones, governmentTimeZone } from "../../time/county-time-zones.ts";
import { parseOrganizationPage } from "../../sources/boardbook/index.ts";
import { parseCalendarRows } from "../../sources/iqm2/index.ts";
import { parseAgendaCenter, parseAgendaCenterCategories } from "../../sources/civicplus/index.ts";
import { parseMunicodeMeetings } from "../../sources/municode/index.ts";
import { parseEscribeMeetings } from "../../sources/escribe/index.ts";
import { parseBoardDocsMeetings, parseBoardDocsCommittees } from "../../sources/boarddocs/index.ts";
import type { CivicClerkEvent } from "../../sources/civicclerk/index.ts";

/** The most bodies one calendar carries: the family reads each member's calendar on its own each pass. */
export const AUTO_CROSSWALK_ROUTE_CAP = 10;

type VaultedEvidence = Extract<DerivedInputRef, { kind: "VAULTED_EVIDENCE" }>;

/** Bytes the vault holds, as text, with their citation. */
export interface HeldBytes {
  readonly text: string;
  /** Bare hex sha256 of the bytes: what a crosswalk row cites. */
  readonly sha256: string;
  readonly evidence: VaultedEvidence;
}

/** The government's body as its state's promoted registration pairs it. */
export interface RegisteredGovernment {
  /** `<ocdId>#governing`, or `<ocdId>#board` for a school district. */
  readonly bodyId: string;
  readonly ocdId: string;
  /** The government's name as its registration prints it. */
  readonly publishingOrg: string;
  readonly countyFips?: string | null;
  /** The promoted registration version this rests on. */
  readonly input: DerivedInputRef;
}

export interface AutoCrosswalkReviewInput {
  readonly walk: { readonly attempt: MeetingsDiscoveryAttempt; readonly recordId: string; readonly recordedAt: string };
  readonly registered: RegisteredGovernment | { readonly notRegistered: string };
  /** The vault's bytes for an artifact the walk recorded, or null when not held (or held only restricted). */
  readonly held: (artifactId: string) => HeldBytes | null;
  /** A hand-wired meeting door already serves the body. */
  readonly handWired: (bodyId: string) => boolean;
  /** `auto-crosswalk-reviewer@<12 hex>`: the reviewer's code version. */
  readonly reviewer: string;
  readonly now: string;
  /** Routes whose newest actual read is this original saved walk. */
  readonly routes?: readonly string[];
}

const KIND_OF_VENDOR: Readonly<Record<string, CrosswalkKind>> = {
  ical: "ICAL", "official-page-events": "OFFICIAL_PAGE_EVENTS", diligent: "DILIGENT", "legistar-api": "LEGISTAR",
  boardbook: "BOARDBOOK", "civicclerk-api": "CIVICCLERK", iqm2: "IQM2", "civicplus-agendacenter": "CIVICPLUS", boarddocs: "BOARDDOCS", "municode-meetings": "MUNICODE", escribe: "ESCRIBE",
};
export const AUTO_CROSSWALK_VENDORS: ReadonlySet<string> = new Set(Object.keys(KIND_OF_VENDOR));

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
const low = (s: string): string => flat(s).toLowerCase();
const bare = (host: string): string => host.toLowerCase().replace(/^www\./, "");
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/* ------------------------------------------------------------ government */

type GovernmentKind = "county" | "city" | "village" | "town" | "township" | "borough" | "school" | "special" | "municipal";

function governmentKind(jurisdictionId: string): GovernmentKind {
  const [, cls = "", slug = ""] = jurisdictionId.split(":");
  if (cls === "depschool") return "school";
  if (cls === "county" || cls === "school" || cls === "special") return cls;
  for (const k of ["village", "township", "town", "borough", "city"] as const) if (slug.startsWith(`${k}-of-`)) return k;
  return "municipal";
}

const GOVERNING_NAMES: Readonly<Record<Exclude<GovernmentKind, "municipal">, readonly string[]>> = {
  county: [
    "Board of County Commissioners", "Board of Commissioners", "County Commissioners", "County Commission", "Board of Supervisors",
    "Board of County Supervisors", "County Board of Supervisors", "County Council", "County Board", "Commissioners Court", "Fiscal Court",
    "Police Jury", "County Legislature", "Board of Chosen Freeholders",
  ],
  city: ["City Council", "City Commission", "Common Council", "Board of Aldermen", "City Commissioners"],
  village: ["Village Council", "Village Board", "Board of Trustees", "Village Board of Trustees", "Village Commission"],
  town: ["Town Council", "Town Board", "Select Board", "Selectboard", "Board of Selectmen", "Board of Selectpersons", "Town Commission", "Board of Aldermen"],
  township: [
    "Board of Trustees", "Township Trustees", "Board of Township Trustees", "Township Board", "Township Committee", "Board of Supervisors",
    "Township Council", "Township Commissioners", "Board of Commissioners",
  ],
  borough: ["Borough Council"],
  school: ["Board of Education", "School Board", "Governing Board", "Board of Trustees", "School Committee", "Board of Directors", "Board of School Directors"],
  special: ["Board of Directors", "Board of Trustees", "Board of Commissioners", "Board of Supervisors"],
};

function governingNames(kind: GovernmentKind): readonly string[] {
  return kind === "municipal"
    ? [...new Set([...GOVERNING_NAMES.city, ...GOVERNING_NAMES.village, ...GOVERNING_NAMES.town, ...GOVERNING_NAMES.township, ...GOVERNING_NAMES.borough])]
    : GOVERNING_NAMES[kind];
}

/** The class word a government of this kind prefixes its own bodies with ("County Commission" of a county). */
const OWN_CLASS_WORD: Readonly<Record<GovernmentKind, readonly string[]>> = {
  county: ["county"], city: ["city"], village: ["village"], town: ["town"], township: ["township"], borough: ["borough"],
  school: ["school", "district"], special: ["district"], municipal: ["city", "town", "village", "borough", "township"],
};

/** Words that make a printed name another government's body, not a sub-body of this one. */
const SEPARATE_GOVERNMENT_WORDS = ["county", "city", "town", "township", "village", "borough", "school", "district", "authority", "state", "regional", "federal", "tribal", "nation", "university", "college"];

/** The government's own name words, from its jurisdiction id: `oh:city:city-of-testville` gives `testville`. */
function ownNameWords(jurisdictionId: string): ReadonlySet<string> {
  const slug = jurisdictionId.split(":")[2] ?? "";
  return new Set(slug.split("-").filter((w) => w !== "" && !/^\d+$/.test(w) && !["city", "town", "village", "township", "borough", "county", "of", "the", "school", "district", "sch", "dist"].includes(w)));
}

/* -------------------------------------------------------- printed names */

const BODY_NOUNS: ReadonlySet<string> = new Set([
  "commission", "committee", "subcommittee", "board", "council", "authority", "trustees", "commissioners", "supervisors", "selectmen",
  "aldermen", "panel", "corporation", "agency", "legislature", "court", "selectboard", "jury", "freeholders", "selectpersons",
]);
const CONNECTORS: ReadonlySet<string> = new Set(["of", "and", "&", "for", "on", "the", "to"]);
/** Words a title puts before a body's name that are not part of it. */
const LEADING_NOISE: ReadonlySet<string> = new Set([
  "regular", "special", "joint", "emergency", "adjourned", "rescheduled", "cancelled", "canceled", "annual", "monthly", "organizational",
  "reorganization", "work", "study", "public", "virtual", "hybrid", "quarterly", "continued", "recessed", "postponed", "amended", "revised",
  "updated", "tentative", "draft", "the", "notice", "agenda", "meeting", "of", "and", "&", "for", "on", "to",
]);
/** Words that end a noun-first name ("Board of Zoning Appeals Meeting", "Board of Commissioners General Session"). */
const RIGHT_STOPS: ReadonlySet<string> = new Set([
  "meeting", "meetings", "session", "sessions", "hearing", "hearings", "workshop", "agenda", "minutes", "retreat", "orientation", "training",
  "tour", "canceled", "cancelled", "postponed", "rescheduled", "regular", "special", "work", "study", "general", "budget", "business",
  "executive", "closed", "annual", "monthly", "quarterly", "emergency", "organizational", "reorganization", "public", "virtual", "hybrid",
  "briefing", "joint", "workshops", "forum", "open", "house",
]);
/** The most words after "of" a noun-first name carries ("Board of County Commissioners", "Board of Parks and Recreation"). */
const MAX_OF_WORDS = 4;

interface Token { readonly text: string; readonly start: number; readonly end: number }

function tokenize(s: string): Token[] {
  return [...s.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*(?:[.-][A-Za-z0-9'’]+)*|&/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}

/** One body name a title prints, with its span. */
export interface PrintedName {
  /** The words as printed, the title's noise, own name and own class word left off the front. */
  readonly text: string;
  /** The words as printed, whole: what an exclusion names. */
  readonly whole: string;
  readonly start: number;
  readonly end: number;
}

export function printedNames(title: string, jurisdictionId: string): readonly PrintedName[] {
  const t = tokenize(title);
  const cap = (i: number): boolean => /^[A-Z]/.test(t[i]!.text);
  const lowAt = (i: number): string => t[i]!.text.toLowerCase();
  /* A separator between two tokens (a dash, a colon, a slash, a comma, parentheses) ends a name. */
  const joined = (i: number): boolean => i > 0 && /^\s*$/.test(title.slice(t[i - 1]!.end, t[i]!.start));
  const spans: { a: number; b: number }[] = [];
  for (let i = 0; i < t.length; i++) {
    const w = lowAt(i);
    const noun = BODY_NOUNS.has(w) || (w === "force" && i > 0 && lowAt(i - 1) === "task" && joined(i));
    if (!noun || !cap(i)) continue;
    let a = i;
    while (a > 0 && joined(a)) {
      const pw = lowAt(a - 1);
      if (cap(a - 1) && pw !== "and") {
        a -= 1;
        continue;
      }
      if (CONNECTORS.has(pw) && a - 2 >= 0 && joined(a - 1) && cap(a - 2)) {
        /* "Council and Planning Commission" is two bodies; "Parks and Recreation Commission" is one. */
        if ((pw === "and" || pw === "&") && BODY_NOUNS.has(lowAt(a - 2))) break;
        a -= 2;
        continue;
      }
      break;
    }
    let b = i;
    if (b + 1 < t.length && lowAt(b + 1) === "of" && joined(b + 1)) {
      let c = b + 2;
      if (c < t.length && lowAt(c) === "the" && joined(c)) c += 1;
      let last = -1;
      let words = 0;
      while (c < t.length && joined(c) && cap(c) && !RIGHT_STOPS.has(lowAt(c)) && words < MAX_OF_WORDS) {
        last = c;
        words += 1;
        /* A body noun ends the name: "Board of County Commissioners", "Board of Trustees". */
        if (BODY_NOUNS.has(lowAt(c))) break;
        c += 1;
        if (c + 1 < t.length && (lowAt(c) === "and" || lowAt(c) === "&") && joined(c) && joined(c + 1) && cap(c + 1) && !RIGHT_STOPS.has(lowAt(c + 1))) c += 1;
      }
      if (last >= 0) b = last;
    }
    spans.push({ a, b });
  }
  const kept = spans
    .sort((x, y) => (y.b - y.a) - (x.b - x.a) || x.a - y.a)
    .filter((s, index, all) => !all.slice(0, index).some((k) => k.a <= s.a && s.b <= k.b))
    .sort((x, y) => x.a - y.a);
  const own = ownNameWords(jurisdictionId);
  return kept.map(({ a, b }): PrintedName => {
    let from = a;
    while (from < b && (LEADING_NOISE.has(lowAt(from)) || own.has(lowAt(from)))) from += 1;
    /* The government's own class word stays printed ("County Commission" of a county); `canonical` sets it aside. */
    const words = flat(title.slice(t[from]!.start, t[b]!.end));
    return { text: words, whole: words, start: t[from]!.start, end: t[b]!.end };
  });
}

/** How two printed names are compared: case, and the government's own class word in front, aside. */
function canonical(name: string, jurisdictionId: string): string {
  const own = new Set([...OWN_CLASS_WORD[governmentKind(jurisdictionId)], ...ownNameWords(jurisdictionId)]);
  const words = tokenize(name).map((tk) => tk.text.toLowerCase().replace(/&/g, "and"));
  let i = 0;
  while (i < words.length - 1 && (own.has(words[i]!) || LEADING_NOISE.has(words[i]!))) i += 1;
  return words.slice(i).join(" ");
}

/** The body a calendar category names, by the reviewer's own rules, or why it names none this government registers. */
export type CategoryBody =
  | { readonly role: "GOVERNING"; readonly name: string }
  | { readonly unmatched: string };

export function categoryBodyOf(category: string, jurisdictionId: string): CategoryBody {
  const shown = flat(category);
  const names = printedNames(shown, jurisdictionId);
  if (names.length === 0) return { unmatched: `"${shown}" prints no body's name: an office, a department or a general calendar` };
  if (names.length > 1) return { unmatched: `"${shown}" prints ${names.length} bodies' names` };
  if (tokenize(names[0]!.text).length < 2) return { unmatched: `"${shown}" prints a bare "${names[0]!.text}", which names no body by itself` };
  const key = canonical(names[0]!.text, jurisdictionId);
  if (key !== canonical(shown, jurisdictionId)) return { unmatched: `"${shown}" says more than one body's name ("${names[0]!.text}")` };
  const kind = governmentKind(jurisdictionId);
  const listed = governingNames(kind).find((n) => canonical(n, jurisdictionId) === key);
  if (listed !== undefined) return { role: "GOVERNING", name: listed };
  const words = key.split(" ");
  if (Object.values(GOVERNING_NAMES).flat().some((n) => canonical(n, jurisdictionId) === key) ||
    SEPARATE_GOVERNMENT_WORDS.some((w) => words.includes(w) && !OWN_CLASS_WORD[kind].includes(w))) {
    return { unmatched: `"${shown}" reads as another government's body` };
  }
  return { unmatched: `"${shown}" names a sub-body; the registration pairs this government with its governing body only, and the reviewer takes sub-bodies from event titles` };
}

/* --------------------------------------------------------------- events */

interface CalendarEvent {
  readonly title: string;
  /** Text an OFFICIAL_PAGE_EVENTS body is named in besides the title (the heading it was read under). */
  readonly context: string;
  readonly categories: readonly string[];
  /** The event's identity on this calendar, for conflicts: uid, start and title. */
  readonly identity: string;
  /** ICAL: the DTSTART's TZID, when stated. */
  readonly tzid: string | null;
  readonly utc: boolean;
  readonly floating: boolean;
  readonly url: string | null;
  /** Vendor identifier where it files a body; a label alone does not select another category. */
  readonly scopeId?: string;
}

function icalEvents(text: string): { events: CalendarEvent[]; calendarZone: string | null } | null {
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return null;
  const calendarZone = /^X-WR-TIMEZONE:(.+)$/im.exec(text)?.[1]?.trim() ?? null;
  const events = parseIcs(text).map((e): CalendarEvent => {
    const raw = e.dtstart ?? "";
    const colon = raw.indexOf(":");
    const params = colon < 0 ? raw : raw.slice(0, colon);
    const value = colon < 0 ? "" : raw.slice(colon + 1);
    const timed = /T\d{4}/.test(value);
    const tzid = /TZID=([^;:]+)/i.exec(params)?.[1]?.replace(/^"|"$/g, "") ?? null;
    return {
      title: flat(e.summary ?? ""),
      context: "",
      categories: (e.categories ?? "").split(",").map((c) => flat(c)).filter((c) => c !== ""),
      identity: `${e.uid ?? ""}|${e.dtstart ?? ""}|${e.recurrenceId ?? ""}|${flat(e.summary ?? "")}`,
      tzid: timed ? tzid : null,
      utc: timed && /Z$/i.test(value.trim()),
      floating: timed && tzid === null && !/Z$/i.test(value.trim()),
      url: e.url,
    };
  });
  return { events, calendarZone };
}

function pageEvents(html: string, pageUrl: string, zone: string): CalendarEvent[] {
  return extractOfficialPageEvents(html, { pageUrl, timeZone: zone })
    .events.filter((e) => e.date !== null)
    .map((e) => ({
      title: flat(e.title),
      context: flat(e.context ?? ""),
      categories: [],
      identity: `${e.date}|${e.start ? `${e.start.hour}:${e.start.minute}` : "day"}|${flat(e.title)}`,
      tzid: null,
      utc: false,
      floating: false,
      url: null,
    }));
}

/** The visible text of a page: scripts, styles and tags out, the common entities read. */
export function pageText(html: string): string {
  return flat(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&"),
  );
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Where a name appears in text, word-bounded and case aside. */
function wordAt(text: string, name: string): number {
  const m = new RegExp(`(^|[^A-Za-z0-9])(${escape(flat(name)).replace(/ /g, "\\s+")})(?=[^A-Za-z0-9]|$)`, "i").exec(text);
  return m === null ? -1 : m.index + m[1]!.length;
}

/* ------------------------------------------------------------------ zones */

function zoneReadable(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function offsetAt(zone: string, iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset", year: "numeric" }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** Two zones keep the same clock through the year (US/Eastern and America/New_York do). */
function sameClock(a: string, b: string, now: string): boolean {
  const year = new Date(now).getUTCFullYear();
  return [`${year}-01-15T12:00:00Z`, `${year}-07-15T12:00:00Z`].every((at) => offsetAt(a, at) === offsetAt(b, at));
}

type Zone = { readonly zone: string } | { readonly held: AutoCrosswalkHoldReason; readonly detail: string };

function zoneFor(kind: CrosswalkKind, selected: readonly CalendarEvent[], calendarZone: string | null, stateCode: string, countyFips: string | null | undefined, now: string): Zone {
  const stateZone = governmentTimeZone(stateCode, countyFips);
  if (kind === "OFFICIAL_PAGE_EVENTS") {
    return stateZone === null
      ? { held: "TIME_ZONE_UNKNOWN", detail: `${countyFips ?? stateCode} has no single county clock and an events page states none` }
      : { zone: stateZone };
  }
  const utc = selected.filter((e) => e.utc);
  if (utc.length > 0) {
    return { held: "UTC_STAMPED_TIMES", detail: `${utc.length} selected event(s) are stamped in UTC ("${utc[0]!.title}"), which a small feed may use for local wall time` };
  }
  const tzids = [...new Set(selected.flatMap((e) => (e.tzid === null ? [] : [e.tzid])))];
  if (tzids.length > 1) return { held: "TIME_ZONE_CONFLICT", detail: `the selected events name ${tzids.length} zones: ${tzids.join(", ")}` };
  const zone = tzids[0] ?? calendarZone ?? stateZone;
  if (zone === null) return { held: "TIME_ZONE_UNKNOWN", detail: `the calendar states no zone and ${countyFips ?? stateCode} has no single county clock` };
  if (!zoneReadable(zone)) return { held: "TIME_ZONE_UNKNOWN", detail: `the calendar's zone "${zone}" is not one this runtime can read` };
  if (stateZone !== null && !sameClock(zone, stateZone, now)) {
    return { held: "TIME_ZONE_CONFLICT", detail: `the calendar keeps ${zone}, and ${countyFips ?? stateCode} keeps ${stateZone}` };
  }
  const countyZones = countyTimeZones(countyFips, stateCode);
  if (countyZones.length > 1 && !countyZones.some(candidate => sameClock(zone, candidate, now))) {
    return { held: "TIME_ZONE_CONFLICT", detail: `the calendar keeps ${zone}, outside ${countyFips}'s stated county clocks (${countyZones.join(", ")})` };
  }
  if (tzids.length === 1 && calendarZone !== null && zoneReadable(calendarZone) && !sameClock(zone, calendarZone, now)) {
    return { held: "TIME_ZONE_CONFLICT", detail: `the events keep ${zone}, and the calendar says ${calendarZone}` };
  }
  return { zone };
}

/* ------------------------------------------------------------- the review */

interface CategoryScope {
  /** The category as the site prints it. */
  readonly name: string;
  readonly catId: string;
  /** The index page's read, and its held bytes. */
  readonly page: DiscoveryStep;
  readonly bytes: HeldBytes;
}

interface Proposal {
  readonly role: MeetingBodyCrosswalkRow["bodyRole"];
  readonly bodyId: string;
  /** The spellings the government printed, first the one the key came from. */
  readonly spellings: readonly string[];
  /** The canonical key two spellings share. */
  readonly key: string;
  /** A category the name was printed in, when no title prints it. */
  readonly category: string | null;
  /** The whole feed is the body's: its site's own category names the body, and no title does. */
  readonly scope?: CategoryScope;
}

function selectWholeFeed(proposal: Proposal, events: readonly CalendarEvent[], jurisdictionId: string): Selected {
  const exclusions = new Set<string>();
  for (const e of events) {
    const names = [...printedNames(e.title, jurisdictionId), ...(e.context ? printedNames(e.context, jurisdictionId) : [])]
      .filter((n) => tokenize(n.text).length >= 2);
    const others = names.filter((n) => canonical(n.text, jurisdictionId) !== proposal.key);
    if (others.length === 0) continue;
    if (others.length < names.length) return { held: "AMBIGUOUS_TITLE", detail: `"${e.title}" names ${proposal.spellings[0]} and ${others[0]!.text}` };
    exclusions.add(others[0]!.whole);
  }
  const excluded = [...exclusions].sort();
  const selected = events.filter((e) => !excluded.some((x) => low(e.title).includes(low(x))));
  if (selected.length === 0) return { held: "SELECTS_NOTHING", detail: `every event on the "${proposal.scope?.name}" feed names another body (${excluded.join("; ")})` };
  return { filter: { feedScope: "category", ...(excluded.length > 0 ? { titleExclude: excluded.join(",") } : {}) }, selected };
}

interface Selection {
  readonly filter: Readonly<Record<string, string>>;
  readonly selected: readonly CalendarEvent[];
}

type Selected = Selection | { readonly held: AutoCrosswalkHoldReason; readonly detail: string };

const titleHas = (title: string, terms: readonly string[]): boolean => terms.some((t) => low(title).includes(low(t)));

function selectFor(kind: CrosswalkKind, proposal: Proposal, events: readonly CalendarEvent[], jurisdictionId: string, route: string): Selected {
  if (["BOARDBOOK", "CIVICCLERK", "IQM2", "CIVICPLUS", "BOARDDOCS", "ESCRIBE"].includes(kind)) {
    const namesIn = (event: CalendarEvent) => [...printedNames(event.title, jurisdictionId), ...printedNames(event.context, jurisdictionId)]
      .filter(name => tokenize(name.text).length >= 2);
    const matches = (event: CalendarEvent) => namesIn(event).some(name => canonical(name.text, jurisdictionId) === proposal.key) ||
      event.categories.some(name => canonical(name, jurisdictionId) === proposal.key);
    const selected = events.filter(matches);
    if (selected.length === 0) return { held: "SELECTS_NOTHING", detail: `no ${kind} event names the reviewed body` };
    const other = selected.find(event => namesIn(event).some(name => canonical(name.text, jurisdictionId) !== proposal.key));
    if (other) return { held: "AMBIGUOUS_TITLE", detail: `"${other.title}" also names another body` };
    if (kind === "BOARDBOOK") {
      if (selected.length !== events.length) return { held: "AMBIGUOUS_TITLE", detail: "the BoardBook organization feed also carries another body's events; a whole-organization reader cannot select this body alone" };
      return { filter: {}, selected };
    }
    if (kind === "CIVICCLERK" || kind === "IQM2") {
      const labels = [...new Set(selected.flatMap(event => event.categories))];
      if (labels.length !== 1 || !labels[0]) return { held: "AMBIGUOUS_TITLE", detail: `${kind} has no one exact published body label` };
      const actual = events.filter(event => event.categories.includes(labels[0]!));
      if (actual.some(event => !selected.includes(event))) return { held: "AMBIGUOUS_TITLE", detail: `the ${kind} body label also selects another body` };
      return { filter: kind === "IQM2" ? { boardMatch: labels[0]! } : { bodyMatch: labels[0]!, portalBase: `https://${new URL(route).hostname.replace(/\.api\.civicclerk\.com$/, ".portal.civicclerk.com")}` }, selected };
    }
    if (kind === "ESCRIBE") {
      const labels = [...new Set(selected.flatMap(event => event.categories))];
      if (!labels.length || labels.some(label => !label || label.includes("|")) || events.some(event => event.categories.some(label => labels.includes(label)) && !selected.includes(event))) return { held: "AMBIGUOUS_TITLE", detail: "the eScribe meeting types also select another body" };
      return { filter: { meetingTypes: labels.join("|") }, selected };
    }
    const ids = [...new Set(selected.map(event => event.scopeId).filter((id): id is string => typeof id === "string"))];
    if (ids.length !== 1 || events.some(event => event.scopeId === ids[0] && !selected.includes(event))) {
      return { held: "AMBIGUOUS_TITLE", detail: `${kind} has no unique category or committee for this body` };
    }
    return { filter: kind === "CIVICPLUS" ? { agendaCenterCategoryId: ids[0]! } : { committeeId: ids[0]! }, selected };
  }
  if (kind === "LEGISTAR") {
    const selected = events.filter(e => proposal.spellings.some(s => wordAt(e.title, s) >= 0));
    const ids = [...new Set(selected.flatMap(e => e.categories))];
    if (ids.length !== 1 || !/^\d+$/.test(ids[0])) return { held: "AMBIGUOUS_TITLE", detail: "No unique Legistar body id matches this body" };
    if (events.some(e => e.categories.includes(ids[0]) && !selected.includes(e))) return { held: "AMBIGUOUS_TITLE", detail: "The vendor body id also names another body" };
    return { filter: { eventBodyId: ids[0] }, selected };
  }
  if (kind === "DILIGENT") {
    const selected = events.filter(e => proposal.spellings.some(s => wordAt(`${e.title} ${e.context}`, s) >= 0));
    if (!selected.length) return { held: "SELECTS_NOTHING", detail: "no Diligent event names the reviewed body" };
    // Retain the publisher's complete type label, not a generic "board" match.
    const labels = [...new Set(selected.flatMap(e => e.categories))];
    if (!labels.length || labels.some(s => !s || s.includes(","))) return { held: "AMBIGUOUS_TITLE", detail: "the service's exact meeting type cannot form a reviewed filter" };
    const actual = events.filter(e => labels.some(s => e.title.toLowerCase().includes(s.toLowerCase())));
    if (actual.some(e => !selected.includes(e))) return { held: "AMBIGUOUS_TITLE", detail: "the same meeting type also selects another body" };
    return { filter: { titleMatch: labels.join(",") }, selected };
  }
  const namesIn = (e: CalendarEvent) => [...printedNames(e.title, jurisdictionId), ...(e.context ? printedNames(e.context, jurisdictionId) : [])];
  const other = (e: CalendarEvent, excluded: readonly string[]): string | null => {
    for (const name of namesIn(e)) {
      const key = canonical(name.text, jurisdictionId);
      if (key === proposal.key) continue;
      if (proposal.spellings.some((s) => low(name.whole).includes(low(s))) || excluded.some((x) => low(name.whole).includes(low(x)))) continue;
      return name.text;
    }
    return null;
  };
  if (proposal.category !== null) {
    const selected = events.filter((e) => e.categories.some((c) => low(c) === low(proposal.category!)));
    if (kind !== "ICAL") return { held: "SELECTS_NOTHING", detail: "an events page has no categories to select by" };
    for (const e of selected) {
      const names = namesIn(e).filter((n) => canonical(n.text, jurisdictionId) !== proposal.key);
      if (names.length > 0) return { held: "AMBIGUOUS_TITLE", detail: `"${e.title}", filed under "${proposal.category}", names ${names[0]!.text}` };
    }
    return selected.length === 0
      ? { held: "SELECTS_NOTHING", detail: `no event is filed under "${proposal.category}"` }
      : { filter: { categoryMatch: proposal.category }, selected };
  }
  const matches = (e: CalendarEvent): boolean => kind === "ICAL"
    ? titleHas(e.title, proposal.spellings)
    : proposal.spellings.some((s) => wordAt(`${e.title} ${e.context}`, s) >= 0);
  const first = events.filter(matches);
  /* A longer name that contains this one is excluded by its exact words; a second body in the title holds the row. */
  const exclusions = new Set<string>();
  for (const e of first) {
    const lt = low(e.title);
    for (const s of proposal.spellings) {
      let from = 0;
      for (let at = lt.indexOf(low(s), from); at >= 0; at = lt.indexOf(low(s), from)) {
        from = at + 1;
        const end = at + low(s).length;
        const inWord = (at > 0 && /[a-z0-9]/.test(lt[at - 1]!)) || (end < lt.length && /[a-z0-9]/.test(lt[end]!));
        if (inWord) {
          const wordStart = lt.slice(0, at).search(/[a-z0-9'’]*$/);
          const tail = /^[a-z0-9'’]*/.exec(lt.slice(end))?.[0] ?? "";
          exclusions.add(flat(e.title.slice(wordStart, end + tail.length)));
          continue;
        }
        const container = namesIn(e).find((n) => n.start <= at && end <= n.end);
        if (container !== undefined && canonical(container.text, jurisdictionId) !== proposal.key) exclusions.add(container.whole);
      }
    }
  }
  if (exclusions.size > 0 && kind !== "ICAL") {
    return { held: "AMBIGUOUS_TITLE", detail: `an events page's events name a longer body (${[...exclusions][0]}), and its filter cannot exclude one` };
  }
  const excluded = [...exclusions].sort();
  const selected = first.filter((e) => !excluded.some((x) => low(e.title).includes(low(x))));
  if (selected.length === 0) {
    return { held: "SELECTS_NOTHING", detail: excluded.length > 0 ? `every event naming it also names a longer body (${excluded.join("; ")})` : "no event names it" };
  }
  for (const e of selected) {
    const second = other(e, excluded);
    if (second !== null) return { held: "AMBIGUOUS_TITLE", detail: `"${e.title}" names ${proposal.spellings[0]} and ${second}` };
  }
  const filter: Record<string, string> = kind === "ICAL"
    ? { titleMatch: proposal.spellings.join(","), ...(excluded.length > 0 ? { titleExclude: excluded.join(",") } : {}) }
    : { nameTerms: proposal.spellings.join("|") };
  return { filter, selected };
}

/** The dead end each hold reason names: what was ruled out, what would settle it, who moves next. */
function deadEnd(reason: AutoCrosswalkHoldReason, name: string | null, route: string, detail: string): Pick<AutoCrosswalkHold, "ruledOut" | "wouldSettle" | "whoMovesNext"> {
  const body = name ?? "the government's body";
  switch (reason) {
    case "KIND_NOT_REVIEWABLE":
      return { ruledOut: `an automatic row for ${route}: no reviewed-filter calendar kind reads this route`, wouldSettle: "a wiring kind for this vendor, or a reviewing agent session wiring the body by hand", whoMovesNext: "engineering, or a reviewing agent session" };
    case "HOST_NOT_ATTESTED":
      return { ruledOut: "accepting a calendar whose chain from the government's recorded site cannot be recomputed", wouldSettle: "a walk that reaches the calendar from the government's own site, with every page on the way vaulted", whoMovesNext: "the free discovery walk, on its next visit" };
    case "HOST_NOT_OWN":
      return { ruledOut: "accepting a calendar off the government's attested own host", wouldSettle: "a reviewing agent session confirming the host is the government's, through the manual crosswalk", whoMovesNext: "a reviewing agent session" };
    case "ROBOTS_NOT_READ":
      return { ruledOut: "accepting a read made without the host's robots.txt read and recorded first", wouldSettle: "a walk that reads the host's robots.txt first and records it (any verdict), then reads the calendar and the naming page", whoMovesNext: "the free discovery walk, on its next visit" };
    case "PERMISSION_NOT_SHOWN":
      /* Produced only by older reviews, when a robots verdict other than ALLOWED held a row. */
      return { ruledOut: "nothing now: a robots.txt verdict no longer holds a row (owner decision 2026-09-25)", wouldSettle: "the next review of a walk of this calendar", whoMovesNext: "the free discovery walk, on its next visit" };
    case "EVIDENCE_NOT_VAULTED":
      return { ruledOut: "citing bytes the vault does not hold", wouldSettle: "a walk that vaults the calendar and the page naming the body", whoMovesNext: "the free discovery walk, on its next visit" };
    case "BODY_NOT_REGISTERED":
      return { ruledOut: "a row for a body registration does not pair with this government", wouldSettle: "the state's registration pairing the government with its body", whoMovesNext: "the registration routine (standing runner), or the registry owner" };
    case "ALREADY_WIRED":
      return { ruledOut: "a second writer beside the hand-wired route", wouldSettle: "nothing: the hand-wired route already serves this body", whoMovesNext: "nobody" };
    case "CALENDAR_UNREADABLE":
      return { ruledOut: "reading events from bytes that are not this kind of calendar", wouldSettle: "a walk that reads the calendar again and finds events in it", whoMovesNext: "the publisher, then the free discovery walk" };
    case "NO_EVENT_NAMES_BODY":
      return { ruledOut: `taking ${route} as the governing body's by its domain alone`, wouldSettle: "an event on the calendar titled with a governing-body name this kind of government uses", whoMovesNext: "the publisher, or a reviewing agent session" };
    case "GOVERNING_NAME_CONFLICT":
      return { ruledOut: "choosing between two governing-body names", wouldSettle: "a reviewing agent session naming the governing body through the manual crosswalk", whoMovesNext: "a reviewing agent session" };
    case "SEPARATE_GOVERNMENT_NAME":
      return { ruledOut: `filing ${body} as a sub-body of this government`, wouldSettle: "a reviewing agent session confirming whose body it is, through the manual crosswalk", whoMovesNext: "a reviewing agent session" };
    case "NAME_NOT_PRINTED_ON_OWN_PAGE":
      return { ruledOut: `taking ${body} as a body on the calendar's word alone`, wouldSettle: `a saved page of the government's own host printing "${body}" (${detail.includes("event page") ? detail.slice(detail.indexOf("event page")) : "a board page, or the event's own page"})`, whoMovesNext: "the free discovery walk, or a reviewing agent session" };
    case "AMBIGUOUS_TITLE":
      return { ruledOut: `publishing events that name ${body} and another body as ${body}'s`, wouldSettle: "a reviewing agent session setting an exact exclusion through the manual crosswalk, or the calendar no longer listing the event", whoMovesNext: "a reviewing agent session" };
    case "SELECTS_NOTHING":
      return { ruledOut: "a filter that selects no event", wouldSettle: "an event on the calendar naming the body", whoMovesNext: "the publisher" };
    case "TIME_ZONE_UNKNOWN":
    case "TIME_ZONE_CONFLICT":
    case "UTC_STAMPED_TIMES":
      return { ruledOut: "guessing the wall clock of the body's sittings", wouldSettle: "a reviewing agent session confirming the sittings' local times against the government's own page, through the manual crosswalk", whoMovesNext: "a reviewing agent session" };
    case "CONFLICTING_SELECTION":
      return { ruledOut: "two bodies claiming the same event", wouldSettle: "a reviewing agent session deciding whose event it is, through the manual crosswalk", whoMovesNext: "a reviewing agent session" };
    case "ROUTE_CAP":
      return { ruledOut: `reading ${route} more than ${AUTO_CROSSWALK_ROUTE_CAP} times a pass`, wouldSettle: "the family reading one shared calendar once a pass for all its bodies", whoMovesNext: "engineering" };
    case "ROW_CHECK_FAILED":
      return { ruledOut: "promoting a row that fails a C16 check", wouldSettle: "a fix to the reviewer, or a reviewing agent session's row", whoMovesNext: "engineering" };
  }
}

/** Review one walk: every accepted row and every hold for the calendars it found. */
export function reviewDiscoveryWalk(input: AutoCrosswalkReviewInput): AutoCrosswalkReview {
  const { attempt } = input.walk;
  const jurisdictionId = attempt.jurisdictionId;
  const attemptInput: DerivedInputRef = { kind: "DISCOVERY_ATTEMPT", attemptId: attempt.attemptId, recordId: input.walk.recordId, recordedAt: input.walk.recordedAt };
  const reviewInputs: DerivedInputRef[] = [attemptInput, ...("input" in input.registered ? [input.registered.input] : [])];
  const accepted: AutoCrosswalkAccepted[] = [];
  const held: AutoCrosswalkHold[] = [];
  const hold = (route: string, reason: AutoCrosswalkHoldReason, detail: string, name: string | null = null, bodyId: string | null = null): void => {
    const key = `auto-crosswalk:${jurisdictionId}|${route}|${reason}|${name === null ? "-" : crosswalkSlug(name)}`;
    if (held.some((h) => h.key === key)) return;
    held.push({ key, jurisdictionId, route, bodyName: name, bodyId, reason, detail, ...deadEnd(reason, name, route, detail) });
  };
  if (attempt.outcome !== "FOUND") return { jurisdictionId, inputs: reviewInputs, accepted, held };

  const homepage = attempt.site?.homepage ?? null;
  const homeHost = homepage === null ? null : httpsHost(homepage.url);
  const steps = attempt.steps;
  /* A read is one that answered 2xx: a 401, 403 or 429 is an access control and is never read past. */
  const readOk = (s: DiscoveryStep): boolean => s.status !== null && s.status >= 200 && s.status < 300;
  /* Robots.txt read first and recorded for the host, whatever it said: the verdict is evidence, never a hold. */
  const robotsRead = (host: string): boolean => steps.some((s) => s.purpose === "robots" && httpsHost(s.url) === host);

  const categoryScopeOf = (find: DiscoveryFind, route: string, routeHost: string): CategoryScope | null => {
    const via = find.via ?? null;
    if (via === null || via.artifactId === null) return null;
    const pageHost = httpsHost(via.page);
    if (pageHost === null || bare(pageHost) !== bare(routeHost) || !robotsRead(pageHost)) return null;
    const page = steps.find((s) => s.purpose === "endpoint" && readOk(s) && s.artifactId === via.artifactId && sameRoute(s.url, via.page));
    if (page === undefined) return null;
    const bytes = input.held(via.artifactId);
    if (bytes === null || accessControlIn({ status: page.status, text: bytes.text }) !== null) return null;
    const feed = civicPlusCategoryFeeds(bytes.text, via.page).find((f) => sameRoute(f.url, route));
    if (feed === undefined || !("role" in categoryBodyOf(feed.name, jurisdictionId))) return null;
    return { name: feed.name, catId: feed.catId, page, bytes };
  };

  const byRoute = new Map<string, DiscoveryFind>();
  for (const find of attempt.found) if (!byRoute.has(find.url)) byRoute.set(find.url, find);
  for (const find of byRoute.values()) {
    const route = find.url;
    if (input.routes && !input.routes.some(current => sameRoute(current, route))) continue;
    const kind = KIND_OF_VENDOR[find.vendor];
    if (kind === undefined) {
      hold(route, "KIND_NOT_REVIEWABLE", `a ${find.vendor} route confirmed by content; the reviewer has no selecting reader filter for this vendor`);
      continue;
    }
    const routeHost = httpsHost(route);
    if (routeHost === null) {
      hold(route, "ROW_CHECK_FAILED", "the calendar is not an https URL");
      continue;
    }
    const attested = attestationFor(attempt, find);
    if ("held" in attested) {
      hold(route, attested.held === "EVIDENCE_NOT_VAULTED" ? "EVIDENCE_NOT_VAULTED" : "HOST_NOT_ATTESTED", attested.detail);
      continue;
    }
    const linkedPublisher = ["DILIGENT", "LEGISTAR", "BOARDBOOK", "CIVICCLERK", "IQM2", "CIVICPLUS", "BOARDDOCS", "MUNICODE", "ESCRIBE"].includes(kind) && attested.attestation.kind === "LINKED_FROM_ATTESTED_PAGE";
    if (homeHost === null || (bare(homeHost) !== bare(routeHost) && !linkedPublisher)) {
      hold(route, "HOST_NOT_OWN", `the calendar is on ${routeHost}; the walk attested ${homeHost ?? "no homepage"} as the government's own`);
      continue;
    }
    const calendarStep = steps.find((s) => s.purpose === "endpoint" && sameRoute(s.url, route) && s.status !== null && s.status >= 200 && s.status < 300);
    if (calendarStep === undefined) {
      hold(route, "HOST_NOT_ATTESTED", "the walk did not read the calendar at its own address (it answered through a redirect); a row's route is the URL read");
      continue;
    }
    if (!robotsRead(routeHost)) {
      hold(route, "ROBOTS_NOT_READ", `the walk read ${route} with no robots.txt reading recorded for ${routeHost} first`);
      continue;
    }
    const calendar = find.artifactId === null ? null : input.held(find.artifactId);
    if (calendar === null) {
      hold(route, "EVIDENCE_NOT_VAULTED", `the calendar's bytes (${find.artifactId ?? "never vaulted"}) are not held in the vault`);
      continue;
    }
    if ("notRegistered" in input.registered) {
      hold(route, "BODY_NOT_REGISTERED", input.registered.notRegistered);
      continue;
    }
    const registered = input.registered;
    const stateZone = governmentTimeZone(attempt.stateCode, registered.countyFips);
    let events: CalendarEvent[];
    let calendarZone: string | null = null;
    if (kind === "ICAL") {
      const read = icalEvents(calendar.text);
      if (read === null || read.events.length === 0) {
        hold(route, "CALENDAR_UNREADABLE", read === null ? "the held bytes are not a VCALENDAR" : "the calendar holds no event");
        continue;
      }
      events = read.events;
      calendarZone = read.calendarZone;
    } else if (kind === "LEGISTAR") {
      let rows: { EventId: number; EventBodyId: number; EventBodyName: string; EventDate: string; EventInSiteURL?: string }[];
      try { rows = JSON.parse(calendar.text); } catch { rows = []; }
      if (!Array.isArray(rows) || !rows.length) { hold(route, "CALENDAR_UNREADABLE", "The Legistar response holds no events"); continue; }
      events = rows.filter(r => Number.isInteger(r.EventBodyId) && r.EventBodyName && r.EventDate)
        .map(r => ({ title: flat(r.EventBodyName), context: "", categories: [String(r.EventBodyId)],
          identity: `${r.EventId}|${r.EventDate}`, tzid: stateZone, utc: false, floating: true, url: r.EventInSiteURL ?? route }));
    } else if (kind === "DILIGENT") {
      const rows = parseDiligentMeetings(calendar.text);
      if (!rows?.length) { hold(route, "CALENDAR_UNREADABLE", "the held public Diligent response has no dated meetings"); continue; }
      events = rows.map(m => ({ title: flat(m.Name ?? ""), context: "", categories: [flat(m.MeetingTypeName ?? "")], identity: `${m.Id}|${m.MeetingDateTime}`, tzid: stateZone, utc: false, floating: true, url: `${new URL(route).origin}/Portal/MeetingInformation.aspx?Id=${m.Id}` }));
    } else if (kind === "BOARDBOOK") {
      events = parseOrganizationPage(calendar.text).rows.map(row => ({ title: flat(row.title), context: "", categories: [],
        identity: `${row.meetingId ?? ""}|${row.y}-${row.mo}-${row.d}|${row.h}:${row.mi}`, tzid: stateZone, utc: false, floating: true, url: route }));
    } else if (kind === "CIVICCLERK") {
      let rows: CivicClerkEvent[] = [];
      try { const body = JSON.parse(calendar.text); rows = Array.isArray(body.value) ? body.value : []; } catch { /* An unreadable response names no event. */ }
      events = rows.filter(row => Number.isInteger(row.id) && !row.isDeleted && row.isPublished !== false && (row.startDateTime || row.eventDate)).map(row => {
        const body = flat(row.eventCategoryName || row.categoryName || row.eventName || "");
        return { title: flat(row.eventName || body), context: body, categories: [body], identity: `${row.id}|${row.startDateTime ?? row.eventDate}`,
          tzid: stateZone, utc: false, floating: true, url: `https://${new URL(route).hostname.replace(/\.api\.civicclerk\.com$/, ".portal.civicclerk.com")}/event/${row.id}` };
      });
    } else if (kind === "IQM2") {
      events = parseCalendarRows(calendar.text).filter(row => row.board && row.when).map(row => ({ title: flat(row.board), context: "", categories: [flat(row.board)],
        identity: `${row.detailId}|${row.when}`, tzid: stateZone, utc: false, floating: true, url: `${new URL(route).origin}/Citizens/Detail_Meeting.aspx?ID=${row.detailId}` }));
    } else if (kind === "CIVICPLUS") {
      events = parseAgendaCenterCategories(calendar.text).flatMap(category => parseAgendaCenter(calendar.text, category.id).map(row => ({ title: flat(category.name), context: "", categories: [flat(category.name)],
        scopeId: category.id, identity: `${category.id}|${row.date}`, tzid: stateZone, utc: false, floating: false, url: row.agendaHref ? new URL(row.agendaHref, route).toString() : route })));
    } else if (kind === "MUNICODE") {
      let rows: ReturnType<typeof parseMunicodeMeetings> = [];
      try { rows = parseMunicodeMeetings(calendar.text, route); } catch { /* A changed table names no meetings. */ }
      events = rows.map(row => ({ title: row.scopeName || row.title, context: "", categories: [], identity: `${row.id}|${row.date}`, tzid: stateZone, utc: false, floating: row.hour !== null, url: row.sourceUrl }));
    } else if (kind === "ESCRIBE") {
      let rows: ReturnType<typeof parseEscribeMeetings> = [];
      try { rows = parseEscribeMeetings(calendar.text); } catch { /* A changed response names no meetings. */ }
      events = rows.map(row => ({ title: flat(row.MeetingType), context: "", categories: [row.MeetingType], identity: `${row.ID}|${row.StartDate}`, tzid: stateZone, utc: false, floating: true, url: row.Url || route }));
    } else if (kind === "BOARDDOCS") {
      const committeeId = new URL(route).searchParams.get("current_committee_id");
      const via = find.via?.artifactId ? input.held(find.via.artifactId) : null;
      const committee = via && committeeId ? parseBoardDocsCommittees(via.text).find(row => row.id === committeeId) : undefined;
      let rows: ReturnType<typeof parseBoardDocsMeetings> = [];
      try { rows = parseBoardDocsMeetings(calendar.text); } catch { /* Malformed public list is unreadable. */ }
      // The public committee selector assigns the complete list to this body. A workshop's programme name is not a second body's identity.
      events = committee ? rows.map(row => ({ title: flat(committee.name), context: "", categories: [flat(committee.name)],
        scopeId: committee.id, identity: `${committee.id}|${row.id}|${row.date}`, tzid: stateZone, utc: false, floating: row.hour !== null, url: route })) : [];
    } else {
      if (stateZone === null) {
        hold(route, "TIME_ZONE_UNKNOWN", `${attempt.stateCode} spans zones and an events page states none`);
        continue;
      }
      events = pageEvents(calendar.text, route, stateZone);
      if (events.length === 0) {
        hold(route, "CALENDAR_UNREADABLE", "the page states no dated event");
        continue;
      }
    }
    if (events.length === 0) {
      hold(route, "CALENDAR_UNREADABLE", `the held ${kind} response has no dated meetings filed under a published body`);
      continue;
    }

    /* Prefer a separate saved naming page when available; the official calendar can supply the same fact itself. */
    const pageOrder = [find.via?.page ?? null, homepage?.url ?? null];
    const pages = steps
      .filter((s) => (s.purpose === "homepage" || s.purpose === "endpoint") && readOk(s) && s.artifactId !== null && !sameRoute(s.url, route))
      .filter((s) => {
        const h = httpsHost(s.url);
        return h !== null && (bare(h) === bare(routeHost) || (linkedPublisher && h === homeHost)) && robotsRead(h);
      })
      .sort((a, b) => {
        const rank = (s: DiscoveryStep) => {
          const at = pageOrder.findIndex((p) => p !== null && sameRoute(p, s.url));
          return at < 0 ? pageOrder.length : at;
        };
        return rank(a) - rank(b);
      })
      .filter((s, i, all) => all.findIndex((x) => x.artifactId === s.artifactId) === i);
    const printedOn = (spellings: readonly string[], among: readonly DiscoveryStep[] = pages): { page: DiscoveryStep; bytes: HeldBytes; bodyName: string; quote: string } | null => {
      for (const page of among) {
        const bytes = input.held(page.artifactId!);
        if (bytes === null) continue;
        /* A bot challenge answered in place of the page is an access control, never the government's page. */
        if (accessControlIn({ status: page.status, text: bytes.text }) !== null) continue;
        const visible = pageText(bytes.text);
        for (const s of spellings) {
          const at = wordAt(visible, s);
          if (at < 0) continue;
          const printed = visible.slice(at, at + flat(s).length);
          const from = Math.max(0, visible.lastIndexOf(" ", Math.max(0, at - 80)));
          const to = visible.indexOf(" ", Math.min(visible.length, at + printed.length + 80));
          const quote = flat(visible.slice(from, to < 0 ? visible.length : to));
          return { page, bytes, bodyName: printed, quote };
        }
      }
      return null;
    };

    /* What the government prints: its governing body by its kind's names, and every other body its events name. */
    const kindOfGovernment = governmentKind(jurisdictionId);
    if ((kind === "DILIGENT" || kind === "BOARDBOOK") && kindOfGovernment === "school") {
      // "Regular Board Meeting" is meaningful only on an attested school
      // portal that independently prints one unambiguous governing-board name.
      const names = governingNames("school").filter(n => printedOn([n]) !== null);
      if (names.length === 1) events = events.map(e => (kind === "BOARDBOOK" ? printedNames(e.title, jurisdictionId).every(name => tokenize(name.text).length < 2) : /^(?:regular|special|emergency|organizational)?\s*board\s+meeting\b/i.test(e.title)) ? { ...e, context: names[0] } : e);
    }
    const governingKeys = new Map(governingNames(kindOfGovernment).map((n) => [canonical(n, jurisdictionId), n] as const));
    const everyGoverningKey = new Set(Object.values(GOVERNING_NAMES).flat().map((n) => canonical(n, jurisdictionId)));
    const named = new Map<string, { spellings: Set<string>; inTitle: boolean; category: string | null }>();
    for (const e of events) {
      for (const n of [...printedNames(e.title, jurisdictionId), ...(e.context ? printedNames(e.context, jurisdictionId) : [])]) {
        /* A bare noun ("Board Meeting") names no body by itself. */
        if (tokenize(n.text).length < 2) continue;
        const key = canonical(n.text, jurisdictionId);
        const entry = named.get(key) ?? { spellings: new Set<string>(), inTitle: false, category: null };
        entry.spellings.add(n.text);
        entry.inTitle = true;
        named.set(key, entry);
      }
      for (const c of e.categories) {
        /* A category is a body's name only when it is exactly one printed name, nothing else. */
        const names = printedNames(c, jurisdictionId);
        if (names.length !== 1 || tokenize(c).length < 2 || canonical(names[0]!.text, jurisdictionId) !== canonical(c, jurisdictionId)) continue;
        const key = canonical(names[0]!.text, jurisdictionId);
        const entry = named.get(key) ?? { spellings: new Set<string>(), inTitle: false, category: null };
        entry.category ??= c;
        named.set(key, entry);
      }
    }
    const proposals: Proposal[] = [];
    let scope: CategoryScope | null = null;
    const governing = [...named.keys()].filter((key) => governingKeys.has(key) && named.get(key)!.inTitle);
    const role: MeetingBodyCrosswalkRow["bodyRole"] = registered.bodyId.endsWith("#board") ? "BOARD" : "GOVERNING";
    if (governing.length > 1) {
      hold(route, "GOVERNING_NAME_CONFLICT", `events name the governing body ${governing.map((k) => `"${governingKeys.get(k)}"`).join(" and ")}`, null, registered.bodyId);
    } else if (governing.length === 1) {
      const listed = [...named.get(governing[0]!)!.spellings][0]!;
      /* The kind's own name is what every title that names the body carries; the printed spellings add nothing. */
      proposals.push({ role, bodyId: registered.bodyId, spellings: [listed], key: governing[0]!, category: null });
    } else if (kind === "ICAL" && (scope = categoryScopeOf(find, route, routeHost)) !== null) {
      /* No title names the body, and the site's own category for this feed is exactly its name: the whole feed is its. */
      proposals.push({ role, bodyId: registered.bodyId, spellings: [scope.name], key: canonical(scope.name, jurisdictionId), category: null, scope });
    } else {
      hold(route, "NO_EVENT_NAMES_BODY", `no event on ${route} names ${registered.bodyId} by ${governingNames(kindOfGovernment).slice(0, 4).map((n) => `"${n}"`).join(", ")} or another governing-body name of its kind`, null, registered.bodyId);
    }
    for (const [key, entry] of [...named.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (governingKeys.has(key)) continue;
      const spellings = [...entry.spellings].sort();
      const shown = spellings[0] ?? entry.category ?? key;
      if (tokenize(shown).length < 2 || BODY_NOUNS.has(key)) continue;
      const words = key.split(" ");
      if (everyGoverningKey.has(key) || SEPARATE_GOVERNMENT_WORDS.some((w) => words.includes(w) && !OWN_CLASS_WORD[kindOfGovernment].includes(w))) {
        hold(route, "SEPARATE_GOVERNMENT_NAME", `"${shown}" reads as another government's body, not a sub-body of ${registered.publishingOrg}`, shown);
        continue;
      }
      proposals.push({
        role: "SUB_BODY",
        bodyId: "",
        spellings: spellings.slice(0, 3),
        key,
        category: entry.inTitle ? null : entry.category,
      });
    }

    const routeAccepted: (AutoCrosswalkAccepted & { selectedIds: ReadonlySet<string>; count: number })[] = [];
    for (const proposal of proposals) {
      const shown = proposal.spellings[0] ?? proposal.category ?? proposal.key;
      const selection = proposal.scope !== undefined ? selectWholeFeed(proposal, events, jurisdictionId) : selectFor(kind, proposal, events, jurisdictionId, route);
      if ("held" in selection) {
        hold(route, selection.held, selection.detail, shown, proposal.role === "SUB_BODY" ? null : proposal.bodyId);
        continue;
      }
      /* A category feed's naming page is the index that files the feed under the body's name, and no other. */
      const names = proposal.category !== null ? [proposal.category, ...proposal.spellings] : proposal.spellings;
      const printed = proposal.scope !== undefined ? printedOn(proposal.spellings, [proposal.scope.page])
        : printedOn(names) ?? printedOn(names, [calendarStep]);
      if (printed === null) {
        const eventPage = selection.selected.map((e) => e.url).find((u) => u !== null && httpsHost(u) !== null && bare(httpsHost(u)!) === bare(routeHost));
        hold(route, "NAME_NOT_PRINTED_ON_OWN_PAGE", `no page of ${routeHost} the walk saved prints "${shown}"${eventPage ? `; the event page ${eventPage} may` : ""}`, shown);
        continue;
      }
      // The jurisdiction already owns the prefix. Keep the body's exact
      // printed suffix so "County Board of Adjustment" and "Board of
      // Adjustment" in that county do not create two identities.
      const nameAt = proposal.role === "SUB_BODY" ? wordAt(printed.bodyName, proposal.key) : -1;
      const bodyName = nameAt < 0 ? printed.bodyName : printed.bodyName.slice(nameAt);
      const bodyId = proposal.role === "SUB_BODY" ? subBodyId(registered.ocdId, bodyName) : proposal.bodyId;
      if (input.handWired(bodyId)) {
        hold(route, "ALREADY_WIRED", `a hand-wired route serves ${bodyId}`, printed.bodyName, bodyId);
        continue;
      }
      const zone = zoneFor(kind, selection.selected, calendarZone, attempt.stateCode, registered.countyFips, input.now);
      if ("held" in zone) {
        hold(route, zone.held, zone.detail, printed.bodyName, bodyId);
        continue;
      }
      const readAt = [calendar.evidence.retrievedAt, printed.bytes.evidence.retrievedAt].sort().at(-1)!;
      const row: MeetingBodyCrosswalkRow = {
        id: crosswalkRowId(bodyId, kind, route),
        jurisdictionId,
        ocdId: registered.ocdId,
        bodyId,
        bodyRole: proposal.role,
        bodyName,
        kind,
        route,
        officialHost: routeHost,
        filter: selection.filter,
        publishingOrg: registered.publishingOrg,
        timeZone: zone.zone,
        evidence: {
          bodyPage: { url: printed.page.url, sha256: printed.bytes.sha256, quote: printed.quote },
          calendar: { url: route, sha256: calendar.sha256, selected: selection.selected.length, total: events.length },
          readAt,
        },
        status: "ACTIVE",
        reviewedBy: input.reviewer,
        reviewedAt: Date.parse(input.now) >= Date.parse(readAt) ? input.now : readAt,
        authorization: CROSSWALK_CITATION,
      };
      const issue = crosswalkRowIssue(row);
      if (issue !== null) {
        hold(route, "ROW_CHECK_FAILED", issue, printed.bodyName, bodyId);
        continue;
      }
      routeAccepted.push({
        row,
        inputs: [attemptInput, registered.input, calendar.evidence, printed.bytes.evidence],
        selectedIds: new Set(selection.selected.map((e) => e.identity)),
        count: selection.selected.length,
      });
    }

    /* Two bodies claiming one event is conflicting evidence: neither is taken. */
    const conflicted = new Set<string>();
    for (let i = 0; i < routeAccepted.length; i++) {
      for (let j = i + 1; j < routeAccepted.length; j++) {
        const a = routeAccepted[i]!;
        const b = routeAccepted[j]!;
        const shared = [...a.selectedIds].find((id) => b.selectedIds.has(id));
        if (shared === undefined) continue;
        for (const [one, two] of [[a, b], [b, a]] as const) {
          conflicted.add(one.row.id);
          hold(route, "CONFLICTING_SELECTION", `${one.row.bodyName} and ${two.row.bodyName} both select "${shared.split("|").at(-1)}"`, one.row.bodyName, one.row.bodyId);
        }
      }
    }
    const standing = routeAccepted
      .filter((a) => !conflicted.has(a.row.id))
      .sort((a, b) => Number(a.row.bodyRole === "SUB_BODY") - Number(b.row.bodyRole === "SUB_BODY") || b.count - a.count || (a.row.id < b.row.id ? -1 : 1));
    for (const [index, a] of standing.entries()) {
      if (kind !== "MUNICODE" && kind !== "ESCRIBE" && index >= AUTO_CROSSWALK_ROUTE_CAP) {
        hold(route, "ROUTE_CAP", `${standing.length} bodies on one calendar; ${AUTO_CROSSWALK_ROUTE_CAP} are read from it each pass`, a.row.bodyName, a.row.bodyId);
        continue;
      }
      accepted.push({ row: a.row, inputs: a.inputs });
    }
  }
  return { jurisdictionId, inputs: reviewInputs, accepted, held };
}

/** The reviewer id for a code version: `auto-crosswalk-reviewer@` and the first 12 hex of its closure digest. */
export function autoCrosswalkReviewerId(closureDigest: string): string {
  return `auto-crosswalk-reviewer@${closureDigest.slice(0, 12)}`;
}

/** The sha256 (bare hex) a crosswalk cites for text bytes. */
export function textSha256(text: string): string {
  return sha(text);
}
