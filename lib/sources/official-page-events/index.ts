import { isOfficialSource, type OfficialLinkingPage } from "../../civic-data/source-authority.ts";
/**
 * @freshness-reads-here
 *
 * The clock stamps in this file are minted by the code path that performs the
 * read: `collectedAt` is taken at the moment of the fetch, in `fetch()` below,
 * and never reconstructed afterwards.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import { resolveVenue } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { localWallClock } from "../event-identity.ts";
import { decodeEntities, politeGetText } from "../http.ts";
import { parseDtStart, parseIcs } from "../ical/index.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  MeetingVenueGap,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * OFFICIAL-PAGE EVENTS — dated public events a body publishes on its OWN
 * official page, outside any agenda vendor (2026-09-23).
 *
 * The class this closes: Tucson Unified's reconfiguration effort publishes its
 * Joint Committee meetings and its community engagement sessions on
 * `www.tusd1.org/Reconfiguration`, a district CMS page. None of them is on the
 * Governing Board's Diligent portal, so a reader who asked "what is TUSD
 * meeting about next?" was shown nothing while the district was holding
 * sessions that week. Those are public meetings about closing schools. The
 * route is the body's own publication, so it is not a vendor and it is not a
 * schedule page — it is a page that mentions events in several shapes at once.
 *
 * ## What is read, in order
 *
 * 1. schema.org `Event` JSON-LD (`<script type="application/ld+json">`);
 * 2. schema.org `Event` microdata (`itemtype=…/Event`);
 * 3. linked `.ics` files (retrieved by `fetch()`, only on an authorized host);
 * 4. structured EVENT CARDS — an element whose class or id names an event,
 *    grown to the smallest wrapper that still holds one event, carrying a
 *    date, a time range and a venue line (Tucson Unified's `EventBox*` cards
 *    and their detail modals are the first instance);
 * 5. DATED HEADINGS — a heading that names a meeting and dates it, e.g.
 *    `Joint Committee Meeting Sept. 11, 2026`, whose own block may state the
 *    time (`from 9AM to 4PM`);
 * 6. `Next meeting <Month D, YYYY>` statements, titled from the heading of the
 *    block that carries them.
 *
 * ## What is never done
 *
 * - **No time is invented.** A date with no stated time ships
 *   `startPrecision: "DAY"`; a range whose start has no am/pm is not guessed.
 * - **No venue is invented.** A venue the page does not state is the
 *   publisher's named gap; a stated venue this pipeline cannot place on the
 *   map is carried verbatim as OUR named gap (`MeetingVenueGap`).
 * - **No event type is inflated.** A Joint Committee meeting stays a Joint
 *   Committee meeting; nothing here writes "Governing Board meeting".
 * - **No cancellation is inferred.** Only the page's own word cancels.
 * - **No year is assumed.** `September 21st` with no year is HELD, named.
 *
 * ## Verification — every event must pass all of it or be HELD by name
 *
 * - the page host is the body's registered official domain (the registry
 *   body's `homepageUrl` — its `ownWebAddress` — pinned on the wiring row as
 *   `officialHost` and checked against the registry by test) or a host the
 *   wiring row explicitly authorizes;
 * - the date parses unambiguously and falls inside the serving window;
 * - the title, or the heading it was read under, names the body or its
 *   committee (`nameTerms` on the wiring row).
 *
 * Verified dates and source links publish independently of agenda
 * extraction: an event with no agenda and no venue is still a public meeting
 * a reader can attend or ask about, and it ships with its gaps named.
 */

export const SOURCE_NAME = "official-page-events";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/* ------------------------------------------------------------------ html -- */

/** A minimal element tree: enough structure to scope a card, never a renderer. */
export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlElement | string>;
  parent: HtmlElement | null;
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/** Tags whose boundaries are line boundaries in the text a reader sees. */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "button", "dd", "div",
  "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

function decode(text: string): string {
  return decodeEntities(text)
    .replace(/&times;/g, "×")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/ /g, " ");
}

function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of source.matchAll(
    /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g,
  )) {
    const key = a[1].toLowerCase();
    if (!(key in out)) out[key] = decode(a[2] ?? a[3] ?? a[4] ?? "");
  }
  return out;
}

/**
 * Tokenize into a tree. Scripts, styles and comments are not content and are
 * skipped whole (JSON-LD is read separately, from the raw HTML). A stray close
 * tag pops to its nearest matching ancestor or is ignored, which is how a
 * browser tolerates the same markup.
 */
export function parseHtmlTree(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  const re =
    /<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<![^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/gi;
  for (const m of html.matchAll(re)) {
    if (m[5] !== undefined) {
      cur.children.push(m[5]);
      continue;
    }
    if (m[6] !== undefined) {
      cur.children.push("<");
      continue;
    }
    if (m[3] === undefined) continue;
    const tag = m[3].toLowerCase();
    if (m[2] === "/") {
      let n: HtmlElement | null = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const el: HtmlElement = { tag, attrs: parseAttrs(m[4] ?? ""), children: [], parent: cur };
    cur.children.push(el);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[4] ?? "")) cur = el;
  }
  return root;
}

/** The element's text as a reader sees it, one entry per rendered line. */
export function textLines(el: HtmlElement): string[] {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    const t = line.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
    line = "";
  };
  const walk = (n: HtmlElement | string) => {
    if (typeof n === "string") {
      line += decode(n);
      return;
    }
    const block = BLOCK_TAGS.has(n.tag);
    if (block) flush();
    for (const c of n.children) walk(c);
    if (block) flush();
  };
  walk(el);
  flush();
  return out;
}

function descendants(el: HtmlElement, pred: (e: HtmlElement) => boolean): HtmlElement[] {
  const out: HtmlElement[] = [];
  const walk = (n: HtmlElement) => {
    for (const c of n.children) {
      if (typeof c === "string") continue;
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

function contains(outer: HtmlElement, inner: HtmlElement): boolean {
  for (let n: HtmlElement | null = inner; n; n = n.parent) if (n === outer) return true;
  return false;
}

/* ----------------------------------------------------------- date / time -- */

const MONTH =
  "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const WEEKDAY = "(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\\s+)?";
const MONTH_DATE_YEAR = `${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`;
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthOf(word: string): number {
  return MONTH_KEYS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
}

/** A calendar date that exists: 2/30 does not, and is never rolled into March. */
function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface FoundDate {
  iso: string;
  printed: string;
  index: number;
}

/**
 * Every full date in `text`: `September 23, 2026`, `Sept. 11, 2026`,
 * `9/23/2026`. Numeric dates are read month-first, the only order an American
 * public body writes; a numeric date that is not a real calendar date under
 * that reading is not a date at all.
 */
export function fullDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_DATE_YEAR}\\b`, "gi"))) {
    const iso = isoDate(Number(m[3]), monthOf(m[1]), Number(m[2]));
    if (iso) out.push({ iso, printed: m[0], index: m.index ?? 0 });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const iso = isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
    if (iso) out.push({ iso, printed: m[0], index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Month-and-day with no year: stated, but not placeable in time. */
function yearlessDates(text: string): Array<{ month: number; day: number; printed: string }> {
  const out: Array<{ month: number; day: number; printed: string }> = [];
  const re = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s+\\d{4})(?!\\/)`, "gi");
  for (const m of text.matchAll(re)) {
    const day = Number(m[2]);
    if (day < 1 || day > 31) continue;
    out.push({ month: monthOf(m[1]), day, printed: m[0] });
  }
  return out;
}

export interface WallTime {
  hour: number;
  minute: number;
}

const CLOCK = "(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?\\s*m\\.?";

function wall(h: string, m: string | undefined, ap: string): WallTime | null {
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (ap.toLowerCase() === "p") hour += 12;
  return { hour, minute };
}

export interface StatedTime {
  start: WallTime | null;
  end: WallTime | null;
  printed: string | null;
}

/**
 * The time a text states: a range (`4:00pm - 6:30pm`, `9AM to 4PM`) or a
 * single start. A range whose start carries no am/pm (`4 - 6:30pm`) is NOT
 * read — the start would be a guess — and neither is its end mistaken for a
 * start.
 */
export function statedTime(text: string): StatedTime {
  const range = new RegExp(`\\b${CLOCK}\\s*(?:-|–|—|to|until)\\s*${CLOCK}`, "i").exec(text);
  if (range) {
    const start = wall(range[1], range[2], range[3]);
    const end = wall(range[4], range[5], range[6]);
    if (start) return { start, end, printed: range[0] };
  }
  if (/\b\d{1,2}(?::\d{2})?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\b/i.test(text)) {
    return { start: null, end: null, printed: null };
  }
  const single = new RegExp(`\\b${CLOCK}(?![a-z])`, "i").exec(text);
  if (single) {
    const start = wall(single[1], single[2], single[3]);
    if (start) return { start, end: null, printed: single[0] };
  }
  return { start: null, end: null, printed: null };
}

/* ---------------------------------------------------------------- events -- */

export type OfficialEventShape =
  | "json-ld"
  | "embedded-json"
  | "microdata"
  | "ics"
  | "event-card"
  | "dated-heading"
  | "next-meeting";

export interface ExtractedLink {
  label: string;
  href: string;
}

/** One event exactly as the page stated it. Nothing here is verified yet. */
export interface ExtractedEvent {
  shape: OfficialEventShape;
  /** The event's own name, as published. */
  title: string;
  /** The heading this was read under, where the title alone is not the name. */
  context: string | null;
  /** `YYYY-MM-DD` in the body's zone, or null when no year/date is stated. */
  date: string | null;
  /** The date as printed, for the evidence line. */
  printedDate: string;
  start: WallTime | null;
  end: WallTime | null;
  /** The venue as the page wrote it; null means the page states none. */
  venue: string | null;
  /** The page's own word for a cancellation. */
  canceled: boolean;
  links: ExtractedLink[];
  /** Verbatim page text this event was read from. */
  evidence: string;
  /** Why the date could not be read, when it could not. */
  dateProblem: "YEAR_NOT_STATED" | "DATE_UNPARSEABLE" | null;
}

const EVENT_WORD =
  /\b(meeting|session|hearing|forum|workshop|committee|town hall|open house|engagement|listening|retreat|study session|work session)\b/i;

const CANCELED = /\bcancell?ed\b/i;

/** The event type the page's own words support. Never promoted upward. */
export function eventTypeOf(title: string, context: string | null = null): string {
  const text = `${title} ${context ?? ""}`;
  if (/\bjoint committee\b/i.test(text)) return "Joint Committee meeting";
  if (/\bcommunity\b[^.]{0,40}\b(engagement|working|listening|input|conversation|forum|meeting|session)s?\b/i.test(text)) {
    return "Community engagement session";
  }
  if (/\btown hall\b/i.test(text)) return "Town hall";
  if (/\bpublic hearing\b/i.test(text)) return "Public hearing";
  if (/\b(study|work) session\b/i.test(text)) return "Work session";
  if (/\bcommittee\b/i.test(text)) return "Committee meeting";
  if (/\b(board|council|commission)\b[^.]{0,30}\bmeeting\b/i.test(title)) return "Board meeting";
  if (/\bmeeting\b/i.test(text)) return "Meeting";
  return "Public event";
}

const PLACE_WORD =
  /\b(school|high|middle|elementary|academy|magnet|campus|center|centre|hall|library|room|gym|gymnasium|auditorium|cafeteria|building|offices?|chambers?|park|church|theat(?:er|re)|stadium|annex|complex|plaza|street|st\.|avenue|ave\.?|road|rd\.|boulevard|blvd\.?|drive|dr\.|lane|suite|floor)\b/i;

const CHROME_LINE = /^(details|close|×|x|read more|more info|learn more|view details|add to (my )?calendar|share)$/i;

function excerpt(lines: string[]): string {
  const text = lines.join(" | ");
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

function linksIn(el: HtmlElement, pageUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  for (const a of descendants(el, (e) => e.tag === "a" && Boolean(e.attrs.href))) {
    const href = a.attrs.href.trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const label = textLines(a).join(" ").trim();
    if (!label) continue;
    if (!out.some((l) => l.href === abs)) out.push({ label, href: abs });
  }
  return out;
}

/* JSON-LD ---------------------------------------------------------------- */

function isEventType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && /(^|\/|:)\w*Event$/.test(t));
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim() : "";
    const address = v.address;
    const addr =
      typeof address === "string"
        ? address
        : address && typeof address === "object"
          ? ["streetAddress", "addressLocality", "addressRegion", "postalCode"]
              .map((k) => (address as Record<string, unknown>)[k])
              .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
              .join(", ")
          : "";
    const joined = [name, addr].filter(Boolean).join(", ");
    return joined || null;
  }
  return null;
}

/**
 * A schema.org date: `2026-10-01`, `2026-10-01T18:00`, or with an offset.
 * An offset-bearing instant is read back into the body's own wall clock, so
 * a page that publishes UTC still renders the local hour it meant.
 */
export function schemaDate(
  raw: string,
  timeZone: string,
): { date: string; time: WallTime | null } | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  const date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!date) return null;
  if (m[4] === undefined) return { date, time: null };
  if (m[6] !== undefined) {
    const offset = m[6] === "Z" ? "Z" : m[6].includes(":") ? m[6] : `${m[6].slice(0, 3)}:${m[6].slice(3)}`;
    const local = localWallClock(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${offset}`, timeZone);
    if (!local) return null;
    const [h, mi] = local.time.split(":").map(Number);
    return { date: local.date, time: { hour: h, minute: mi } };
  }
  return { date, time: { hour: Number(m[4]), minute: Number(m[5]) } };
}

export function extractJsonLd(html: string, timeZone: string, pageUrl: string): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  for (const s of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s[1].trim());
    } catch {
      continue;
    }
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) stack.push(...(obj["@graph"] as unknown[]));
      if (!isEventType(obj["@type"])) continue;
      const title = typeof obj.name === "string" ? decode(obj.name).trim() : "";
      const startRaw = typeof obj.startDate === "string" ? obj.startDate : "";
      const start = startRaw ? schemaDate(startRaw, timeZone) : null;
      const endRaw = typeof obj.endDate === "string" ? obj.endDate : "";
      const end = endRaw ? schemaDate(endRaw, timeZone) : null;
      const status = typeof obj.eventStatus === "string" ? obj.eventStatus : "";
      const url = typeof obj.url === "string" ? obj.url : null;
      out.push({
        shape: "json-ld",
        title,
        context: null,
        date: start?.date ?? null,
        printedDate: startRaw,
        start: start?.time ?? null,
        end: end && start && end.date === start.date ? end.time : null,
        venue: textOf(obj.location),
        canceled: /EventCancelled$/i.test(status),
        links: url ? [{ label: title || "Event page", href: new URL(url, pageUrl).toString() }] : [],
        evidence: excerpt([title, startRaw, endRaw, textOf(obj.location) ?? ""].filter(Boolean)),
        dateProblem: start ? null : "DATE_UNPARSEABLE",
      });
    }
  }
  return out;
}

/* embedded event state --------------------------------------------------- */

/**
 * The string literal handed to `JSON.parse("…")` in an inline script, decoded
 * once. Scanned by hand rather than by one regex: on a district CMS page the
 * literal is over a megabyte, and a backtracking pattern that long is a
 * liability for no gain.
 */
function jsonParseLiterals(html: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf('JSON.parse("', from);
    if (at < 0) return out;
    let i = at + 'JSON.parse("'.length;
    while (i < html.length && html[i] !== '"') i += html[i] === "\\" ? 2 : 1;
    try {
      out.push(JSON.parse(html.slice(at + "JSON.parse(".length, i + 1)) as string);
    } catch {
      // Not a JSON string literal after all; nothing to read.
    }
    from = i + 1;
  }
}

const TITLE_KEYS = ["title", "name", "summary"];
const START_KEYS = ["start_at", "startDate", "start_date", "starts_at", "startsAt", "start_time", "startTime"];
const END_KEYS = ["end_at", "endDate", "end_date", "ends_at", "endsAt", "end_time", "endTime"];

/**
 * Events a page carries as DATA in its own inline state rather than as
 * markup: a district CMS (Apptegy/Thrillshare, Santa Fe Public Schools' board
 * page is the first instance) renders its event list client-side from a
 * `JSON.parse("…")` literal or an `application/json` script. The fields are
 * the publisher's — `title`, an offset-bearing `start_at`, `end_at`, `venue`,
 * `all_day` — so nothing about the event is inferred; a record is read only
 * when it states a title AND a start this module can parse.
 */
export function extractEmbeddedJson(html: string, timeZone: string, pageUrl: string): ExtractedEvent[] {
  const documents: unknown[] = [];
  for (const literal of jsonParseLiterals(html)) {
    try {
      documents.push(JSON.parse(literal));
    } catch {
      // A literal that is not JSON carries no events.
    }
  }
  for (const s of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      documents.push(JSON.parse(s[1]));
    } catch {
      // Not JSON; not read.
    }
  }

  const out: ExtractedEvent[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [...documents];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    for (const v of Object.values(obj)) if (v && typeof v === "object") stack.push(v);

    const titleKey = TITLE_KEYS.find((k) => typeof obj[k] === "string" && (obj[k] as string).trim());
    const startKey = START_KEYS.find((k) => typeof obj[k] === "string");
    if (!titleKey || !startKey || isEventType(obj["@type"])) continue;
    const startRaw = (obj[startKey] as string).trim();
    const start = schemaDate(startRaw, timeZone);
    if (!start) continue;
    const endKey = END_KEYS.find((k) => typeof obj[k] === "string");
    const endRaw = endKey ? (obj[endKey] as string).trim() : "";
    const end = endRaw ? schemaDate(endRaw, timeZone) : null;
    const title = decode(obj[titleKey] as string).replace(/\s+/g, " ").trim();
    const key = `${title}|${startRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const allDay = obj.all_day === true || obj.allDay === true;
    const venueParts = [textOf(obj.venue) ?? textOf(obj.location), textOf(obj.address)]
      .map((v) => (v ?? "").trim())
      .filter(Boolean);
    const venue = venueParts.length > 0 ? venueParts.join(", ") : null;
    const status = typeof obj.status === "string" ? obj.status : typeof obj.eventStatus === "string" ? obj.eventStatus : "";
    const url = typeof obj.url === "string" && /^https?:\/\//i.test(obj.url) ? obj.url : null;
    out.push({
      shape: "embedded-json",
      title,
      context: null,
      date: start.date,
      printedDate: startRaw,
      start: allDay ? null : start.time,
      end: allDay || !end || end.date !== start.date ? null : end.time,
      venue,
      canceled: /cancel/i.test(status) || CANCELED.test(title),
      links: url ? [{ label: title, href: new URL(url, pageUrl).toString() }] : [],
      evidence: excerpt([
        `${titleKey}: ${title}`,
        `${startKey}: ${startRaw}`,
        ...(endKey ? [`${endKey}: ${endRaw}`] : []),
        `venue: ${venue ?? "(not stated)"}`,
        ...(allDay ? ["all_day: true"] : []),
      ]),
      dateProblem: null,
    });
  }
  return out;
}

/* microdata -------------------------------------------------------------- */

function itempropValue(el: HtmlElement): string {
  return (
    el.attrs.content ??
    el.attrs.datetime ??
    (el.tag === "a" || el.tag === "link" ? el.attrs.href : undefined) ??
    textLines(el).join(" ")
  ).trim();
}

export function extractMicrodata(root: HtmlElement, timeZone: string, pageUrl: string): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  const scopes = descendants(root, (e) => /schema\.org\/\w*Event$/i.test(e.attrs.itemtype ?? ""));
  for (const scope of scopes) {
    const props = descendants(scope, (e) => Boolean(e.attrs.itemprop)).filter((p) => {
      // A property belongs to the NEAREST enclosing scope, not to an outer one.
      for (let n = p.parent; n && n !== scope; n = n.parent) if (n.attrs.itemscope !== undefined && n.attrs.itemtype) {
        if (p.attrs.itemprop === "name" && n.attrs.itemprop === "location") return false;
        if (n !== scope && n.attrs.itemprop !== "location") return false;
      }
      return true;
    });
    const prop = (name: string) => props.find((p) => p.attrs.itemprop.split(/\s+/).includes(name));
    const nameEl = props.find((p) => p.attrs.itemprop === "name" && p.parent && !descendants(scope, (e) => e.attrs.itemprop === "location").some((loc) => contains(loc, p)));
    const title = nameEl ? itempropValue(nameEl) : "";
    const startRaw = prop("startDate") ? itempropValue(prop("startDate")!) : "";
    const endRaw = prop("endDate") ? itempropValue(prop("endDate")!) : "";
    const start = startRaw ? schemaDate(startRaw, timeZone) : null;
    const end = endRaw ? schemaDate(endRaw, timeZone) : null;
    const loc = prop("location");
    const venue = loc ? textLines(loc).join(", ").trim() || null : null;
    const status = prop("eventStatus") ? itempropValue(prop("eventStatus")!) : "";
    out.push({
      shape: "microdata",
      title,
      context: null,
      date: start?.date ?? null,
      printedDate: startRaw,
      start: start?.time ?? null,
      end: end && start && end.date === start.date ? end.time : null,
      venue,
      canceled: /EventCancelled$/i.test(status) || CANCELED.test(title),
      links: linksIn(scope, pageUrl),
      evidence: excerpt(textLines(scope)),
      dateProblem: start ? null : "DATE_UNPARSEABLE",
    });
  }
  return out;
}

/* .ics ------------------------------------------------------------------- */

/** Every `.ics` / `webcal:` link the page carries, absolute. */
export function icsLinks(root: HtmlElement, pageUrl: string): string[] {
  const out: string[] = [];
  for (const a of descendants(root, (e) => e.tag === "a" && Boolean(e.attrs.href))) {
    const href = a.attrs.href.trim();
    if (!/\.ics(\?|#|$)/i.test(href) && !/^webcal:/i.test(href)) continue;
    try {
      const abs = new URL(href.replace(/^webcal:/i, "https:"), pageUrl).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      // An unparseable href is not a link.
    }
  }
  return out;
}

export function extractIcs(ics: string, icsUrl: string, timeZone: string): ExtractedEvent[] {
  const out: ExtractedEvent[] = [];
  const unfolded = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]);
  const events = parseIcs(ics);
  events.forEach((ev, i) => {
    const toWall = (raw: string | null) => {
      if (!raw) return null;
      const parsed = parseDtStart(raw, timeZone);
      if (!parsed) return null;
      if (parsed.dayOnly) {
        const v = raw.split(":").pop() ?? "";
        const date = isoDate(Number(v.slice(0, 4)), Number(v.slice(4, 6)), Number(v.slice(6, 8)));
        return date ? { date, time: null } : null;
      }
      const local = localWallClock(parsed.iso, timeZone);
      if (!local) return null;
      const [h, m] = local.time.split(":").map(Number);
      return { date: local.date, time: { hour: h, minute: m } as WallTime };
    };
    const start = toWall(ev.dtstart);
    const dtend = /^DTEND([^:\r\n]*):(.*)$/im.exec(blocks[i] ?? "");
    const end = toWall(dtend ? `${dtend[1]}:${dtend[2].trim()}` : null);
    const title = ev.summary ?? "";
    out.push({
      shape: "ics",
      title,
      context: null,
      date: start?.date ?? null,
      printedDate: ev.dtstart ?? "",
      start: start?.time ?? null,
      end: end && start && end.date === start.date ? end.time : null,
      venue: ev.location,
      canceled: /^CANCELLED$/i.test(ev.status ?? "") || CANCELED.test(title),
      links: [{ label: "Calendar file", href: icsUrl }],
      evidence: excerpt([title, ev.dtstart ?? "", ev.location ?? ""].filter(Boolean)),
      dateProblem: start ? null : "DATE_UNPARSEABLE",
    });
  });
  return out;
}

/* event cards ------------------------------------------------------------ */

const EVENTISH = (e: HtmlElement) =>
  !e.attrs.itemtype && (/event/i.test(e.attrs.class ?? "") || /event/i.test(e.attrs.id ?? ""));

function distinctDates(lines: string[]): Set<string> {
  return new Set(fullDates(lines.join("\n")).map((d) => d.iso));
}

/**
 * The smallest wrapper holding ONE event: climb from an event-named element
 * while the parent still carries a single distinct date AND nothing but
 * event-named content. The first condition stops at a list of cards; the
 * second stops at the page section a lone card sits in, so a one-event page
 * never swallows its own navigation as the card.
 */
function cardRoot(el: HtmlElement): HtmlElement {
  let card = el;
  for (;;) {
    const parent = card.parent;
    if (!parent || parent.tag === "#root" || parent.tag === "body" || parent.tag === "main") return card;
    if (distinctDates(textLines(parent)).size > 1) return card;
    const outside = parent.children.filter((c) =>
      typeof c === "string" ? c.trim().length > 0 : !EVENTISH(c) && textLines(c).length > 0 && descendants(c, EVENTISH).length === 0,
    );
    if (outside.length > 0) return card;
    card = parent;
  }
}

export function extractCards(root: HtmlElement, pageUrl: string): ExtractedEvent[] {
  const cards: HtmlElement[] = [];
  for (const el of descendants(root, EVENTISH)) {
    const card = cardRoot(el);
    if (cards.some((c) => contains(c, card))) continue;
    for (let i = cards.length - 1; i >= 0; i--) if (contains(card, cards[i])) cards.splice(i, 1);
    cards.push(card);
  }

  const out: ExtractedEvent[] = [];
  for (const card of cards) {
    const lines = textLines(card);
    const dates = fullDates(lines.join("\n"));
    const distinct = new Set(dates.map((d) => d.iso));
    if (distinct.size !== 1) continue;

    const titled =
      descendants(card, (e) => /title|name|heading|summary|subject/i.test(`${e.attrs.class ?? ""} ${e.attrs.id ?? ""}`))[0] ??
      descendants(card, (e) => /^h[1-6]$/.test(e.tag))[0];
    const title = titled ? textLines(titled).join(" ") : lines[0];
    const links = linksIn(card, pageUrl);
    const linkLabels = new Set(links.map((l) => l.label.toLowerCase()));

    const time = statedTime(lines.join("\n"));
    const venues = lines.filter(
      (l) =>
        l !== title &&
        !CHROME_LINE.test(l) &&
        !linkLabels.has(l.toLowerCase()) &&
        fullDates(l).length === 0 &&
        statedTime(l).printed === null &&
        PLACE_WORD.test(l) &&
        l.length <= 160,
    );
    // The most specific statement of the place: "Cholla High School South
    // Gym" over the modal's "Cholla High School", never a merge of the two.
    const venue = venues.sort((a, b) => b.length - a.length)[0] ?? null;

    out.push({
      shape: "event-card",
      title,
      context: null,
      date: [...distinct][0],
      printedDate: dates[0].printed,
      start: time.start,
      end: time.end,
      venue,
      canceled: lines.some((l) => CANCELED.test(l)),
      links,
      evidence: excerpt([...new Set(lines.filter((l) => !CHROME_LINE.test(l)))]),
      dateProblem: null,
    });
  }
  return out;
}

/* dated headings and "next meeting" statements --------------------------- */

const HEADINGISH = (e: HtmlElement) =>
  /^h[1-6]$/.test(e.tag) || /(^|\s|-|_)(section)?(title|heading|header)/i.test(e.attrs.class ?? "");

function headingSubject(text: string): { subject: string; date: FoundDate } | null {
  const m = new RegExp(`^(.{3,120}?)[\\s,:–—-]+${WEEKDAY}(${MONTH_DATE_YEAR}|\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s*$`, "i").exec(text);
  if (!m) return null;
  const subject = m[1].trim();
  if (!EVENT_WORD.test(subject)) return null;
  const date = fullDates(m[2])[0];
  return date ? { subject, date } : null;
}

const NEXT_MEETING = new RegExp(
  `\\bnext\\s+(?:regular\\s+|special\\s+|joint\\s+committee\\s+|committee\\s+|board\\s+|community\\s+)?(?:meeting|session)\\b(?:\\s+(?:is|will\\s+be))?\\s*(?:on|:|-|–)?\\s*${WEEKDAY}(${MONTH_DATE_YEAR})`,
  "i",
);

export interface HeadingExtraction {
  events: ExtractedEvent[];
  /** Month-and-day mentions under an event heading, with no year stated. */
  yearless: Array<{ month: number; day: number; printed: string; context: string; evidence: string }>;
}

export function extractHeadingsAndStatements(root: HtmlElement, pageUrl: string): HeadingExtraction {
  const events: ExtractedEvent[] = [];
  const yearless: HeadingExtraction["yearless"] = [];
  const seenStatements = new Set<string>();

  for (const heading of descendants(root, HEADINGISH)) {
    const headingText = textLines(heading).join(" ");
    const parsed = headingSubject(headingText);
    if (!parsed || !heading.parent) continue;
    const block = heading.parent;
    const body = textLines(block).filter((l) => l !== headingText);
    const bodyText = body.join("\n");

    // The block's own time applies to the heading's sitting only when the
    // block states exactly one time and names no other full date.
    const otherDates = fullDates(bodyText).filter((d) => d.iso !== parsed.date.iso);
    const time = otherDates.length === 0 ? statedTime(bodyText) : { start: null, end: null, printed: null };
    events.push({
      shape: "dated-heading",
      title: parsed.subject,
      context: null,
      date: parsed.date.iso,
      printedDate: parsed.date.printed,
      start: time.start,
      end: time.end,
      venue: null,
      canceled: CANCELED.test(headingText),
      links: [],
      evidence: excerpt([headingText, ...(time.printed ? body.filter((l) => l.includes(time.printed!)) : [])]),
      dateProblem: null,
    });

    for (const line of body) {
      const next = NEXT_MEETING.exec(line);
      if (next) {
        const date = fullDates(next[1])[0];
        const after = line.slice((next.index ?? 0) + next[0].length);
        const t = statedTime(after.slice(0, 60));
        seenStatements.add(line);
        events.push({
          shape: "next-meeting",
          title: parsed.subject,
          context: headingText,
          date: date?.iso ?? null,
          printedDate: next[1],
          start: t.start,
          end: t.end,
          venue: null,
          canceled: CANCELED.test(line),
          links: [],
          evidence: excerpt([headingText, line]),
          dateProblem: date ? null : "DATE_UNPARSEABLE",
        });
      }
      for (const y of yearlessDates(line)) {
        yearless.push({ ...y, context: parsed.subject, evidence: excerpt([headingText, line]) });
      }
    }
  }

  // A statement under no dated heading still dates a sitting; its title is
  // only what the page wrote, so it must name the body itself to pass.
  for (const line of textLines(root)) {
    if (seenStatements.has(line)) continue;
    const next = NEXT_MEETING.exec(line);
    if (!next) continue;
    const date = fullDates(next[1])[0];
    events.push({
      shape: "next-meeting",
      title: line.slice(0, (next.index ?? 0)).trim() || "Next meeting",
      context: null,
      date: date?.iso ?? null,
      printedDate: next[1],
      start: statedTime(line.slice((next.index ?? 0) + next[0].length, (next.index ?? 0) + next[0].length + 60)).start,
      end: null,
      venue: null,
      canceled: CANCELED.test(line),
      links: [],
      evidence: excerpt([line]),
      dateProblem: date ? null : "DATE_UNPARSEABLE",
    });
  }
  void pageUrl;
  return { events, yearless };
}

/* ------------------------------------------------------------- extract -- */

export interface PageExtraction {
  events: ExtractedEvent[];
  yearless: HeadingExtraction["yearless"];
  icsLinks: string[];
  /** Page-level RSVP / livestream / registration links the body published. */
  pageLinks: ExtractedLink[];
}

const PAGE_LINK = /\b(rsvp|register|registration|sign[- ]?up|livestream|live stream|watch|zoom|webex|teams)\b/i;

/** Every dated event the page states, in every shape it states them. */
export function extractOfficialPageEvents(
  html: string,
  options: { pageUrl: string; timeZone: string; ics?: Array<{ url: string; text: string }> },
): PageExtraction {
  const root = parseHtmlTree(html);
  const headings = extractHeadingsAndStatements(root, options.pageUrl);
  const events = [
    ...extractJsonLd(html, options.timeZone, options.pageUrl),
    ...extractEmbeddedJson(html, options.timeZone, options.pageUrl),
    ...extractMicrodata(root, options.timeZone, options.pageUrl),
    ...(options.ics ?? []).flatMap((f) => extractIcs(f.text, f.url, options.timeZone)),
    ...extractCards(root, options.pageUrl),
    ...headings.events,
  ];
  return {
    events,
    yearless: headings.yearless,
    icsLinks: icsLinks(root, options.pageUrl),
    pageLinks: linksIn(root, options.pageUrl).filter((l) => PAGE_LINK.test(l.label)),
  };
}

/* ---------------------------------------------------------------- verify -- */

export type HoldReason =
  | "HOST_NOT_OFFICIAL"
  | "DATE_UNPARSEABLE"
  | "YEAR_NOT_STATED"
  | "DATE_OUT_OF_WINDOW"
  | "TITLE_DOES_NOT_NAME_BODY"
  | "TIME_RANGE_INVERTED";

export interface VerificationIdentity {
  /** The page the events were read from. */
  pageUrl: string;
  /** Saved official page linking this publisher when its domain is not .gov. */
  linkingPage?: OfficialLinkingPage | null;
  /** Names of the body and its committees, as the page would write them. */
  nameTerms: readonly string[];
  timeZone: string;
  now: Date;
}

export interface VerifiedEvent {
  event: ExtractedEvent;
  eventType: string;
  startsAt: string;
  endsAt: string | null;
  precision: "MINUTE" | "DAY";
}

export interface HeldEvent {
  shape: OfficialEventShape | "prose-date";
  title: string;
  printedDate: string;
  reasons: HoldReason[];
  evidence: string;
}



function namesBody(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => {
    const t = term.trim();
    if (!t) return false;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(text);
  });
}

function minutes(t: WallTime): number {
  return t.hour * 60 + t.minute;
}

/** Two readings of one sitting (a card and its modal, a heading and a statement) fold into one. */
function mergeKey(e: ExtractedEvent, type: string): string {
  return `${e.date}|${type}|${e.start ? minutes(e.start) : "day"}`;
}

/**
 * Hold what fails, publish what passes. Nothing is repaired: a failing event
 * is reported with every reason that applies, so the reader's absence of it
 * is explainable and the next session knows what to look at.
 */
export function verifyExtractedEvents(
  extraction: PageExtraction,
  identity: VerificationIdentity,
): { published: VerifiedEvent[]; held: HeldEvent[] } {
  const hostOk = isOfficialSource(identity.pageUrl, identity.linkingPage);
  const windowStart = identity.now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
  const windowEnd = identity.now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;

  const held: HeldEvent[] = [];
  const byKey = new Map<string, VerifiedEvent>();

  for (const raw of extraction.events) {
    // An end stated equal to the start is a publisher's placeholder, not a
    // zero-minute sitting and not an inversion: it states no end.
    const event =
      raw.start && raw.end && minutes(raw.end) === minutes(raw.start) ? { ...raw, end: null } : raw;
    const reasons: HoldReason[] = [];
    if (!hostOk) reasons.push("HOST_NOT_OFFICIAL");
    if (event.dateProblem) reasons.push(event.dateProblem);
    if (!namesBody(`${event.title} ${event.context ?? ""}`, identity.nameTerms)) reasons.push("TITLE_DOES_NOT_NAME_BODY");
    if (event.start && event.end && minutes(event.end) <= minutes(event.start)) reasons.push("TIME_RANGE_INVERTED");

    let startsAt: string | null = null;
    let endsAt: string | null = null;
    if (event.date) {
      const [y, mo, d] = event.date.split("-").map(Number);
      startsAt = toZonedIso(y, mo, d, event.start?.hour ?? 0, event.start?.minute ?? 0, identity.timeZone);
      endsAt = event.start && event.end ? toZonedIso(y, mo, d, event.end.hour, event.end.minute, identity.timeZone) : null;
      const t = Date.parse(startsAt);
      if (t < windowStart || t > windowEnd) reasons.push("DATE_OUT_OF_WINDOW");
    }

    if (reasons.length > 0 || !startsAt) {
      held.push({ shape: event.shape, title: event.title, printedDate: event.printedDate, reasons, evidence: event.evidence });
      continue;
    }

    const eventType = eventTypeOf(event.title, event.context);
    const verified: VerifiedEvent = {
      event,
      eventType,
      startsAt,
      endsAt,
      precision: event.start ? "MINUTE" : "DAY",
    };
    // A date-only reading and a timed reading of the same sitting are one
    // sitting: the timed one wins, the date-only one is folded in.
    const dayKey = `${event.date}|${eventType}|day`;
    const key = mergeKey(event, eventType);
    const existing = byKey.get(key) ?? (event.start ? byKey.get(dayKey) : [...byKey.values()].find((v) => v.event.date === event.date && v.eventType === eventType));
    if (!existing) {
      byKey.set(key, verified);
      continue;
    }
    const richer = existing.event.start || !event.start ? existing : verified;
    const other = richer === existing ? verified : existing;
    const merged: VerifiedEvent = {
      ...richer,
      event: {
        ...richer.event,
        venue: richer.event.venue ?? other.event.venue,
        canceled: richer.event.canceled || other.event.canceled,
        links: [...richer.event.links, ...other.event.links.filter((l) => !richer.event.links.some((r) => r.href === l.href))],
        evidence: excerpt([richer.event.evidence, other.event.evidence]),
      },
    };
    for (const [k, v] of byKey) if (v === existing) byKey.delete(k);
    byKey.set(mergeKey(merged.event, eventType), merged);
  }

  // Year-less dates are held unless a dated reading of the same month and day
  // is already published from this page — then the prose is corroboration,
  // not a second event.
  const published = [...byKey.values()];
  for (const y of extraction.yearless) {
    const corroborated = published.some((p) => {
      const [, mo, d] = (p.event.date ?? "").split("-").map(Number);
      return mo === y.month && d === y.day;
    });
    if (corroborated) continue;
    held.push({
      shape: "prose-date",
      title: y.context,
      printedDate: y.printed,
      reasons: hostOk ? ["YEAR_NOT_STATED"] : ["HOST_NOT_OFFICIAL", "YEAR_NOT_STATED"],
      evidence: y.evidence,
    });
  }

  return {
    published: published.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    held,
  };
}

/* ------------------------------------------------- route verification -- */

/** The body a page is being verified FOR. Nothing here is read from the page. */
export interface OfficialPageBody {
  /** Registry body id. */
  id: string;
  /** The body's name as the registry holds it; it must appear in an event's title. */
  name: string;
  /** The registered official domain: the body's `ownWebAddress` (URL or host). */
  officialDomain: string;
  /** IANA zone the body meets in. Required: a wall clock with no zone is a guess. */
  timeZone: string;
  /** Other names the page uses for the body or its committees ("TUSD", "Joint Committee"). */
  nameTerms?: readonly string[];
  /** Hosts beyond the official domain the route is explicitly authorized to read. */
  linkingPage?: OfficialLinkingPage | null;
}

/** One verified event, in the shape a route decision and a recipe need. */
export interface OfficialPageEvent {
  title: string;
  eventType: string;
  startsAt: string;
  endsAt: string | null;
  precision: "MINUTE" | "DAY";
  /** Venue as published; null is the publisher's named gap, never a guess. */
  venue: string | null;
  status: MeetingStatus;
  shape: OfficialEventShape;
  sourceUrl: string;
  evidence: string;
  links: ExtractedLink[];
}

export type OfficialPageVerdict = "YIELDED" | "EMPTY" | "NOT_CONFIRMED";

export interface OfficialPageVerification {
  verdict: OfficialPageVerdict;
  /** Present unless YIELDED: why the page is not (yet) a usable route. */
  reason?: string;
  /** Verified events, imminent first. */
  sampleEvents: OfficialPageEvent[];
  /** Every event the page states that did not verify, with its named reasons. */
  held: HeldEvent[];
}


/**
 * **PURE route verification** for the discovery executor (extractor id
 * `official-page-events`): given a body, a page URL and the page's HTML, is
 * this page a usable route for that body's dated public events?
 *
 * No network and no clock: `now` is the only time read. The rules are exactly
 * the adapter's — this function and `normalizeWithDrops` share
 * `extractOfficialPageEvents` and `verifyExtractedEvents` — so a page this
 * says YIELDED is a page the standing runner will publish from, and the same
 * page for a different body (an Arizona page offered for a New Mexico body)
 * says NOT_CONFIRMED with the reasons named.
 *
 * - `YIELDED` — at least one event verified.
 * - `EMPTY` — the page states no dated event in any shape this reads.
 * - `NOT_CONFIRMED` — events were found and every one was held; `reason`
 *   lists the hold reasons.
 */
export function verifyOfficialPageEvents(input: {
  body: OfficialPageBody;
  url: string;
  html: string;
  now: Date | string;
}): OfficialPageVerification {
  const now = typeof input.now === "string" ? new Date(input.now) : input.now;
  if (!Number.isFinite(now.getTime())) {
    return { verdict: "NOT_CONFIRMED", reason: "NOW_UNPARSEABLE", sampleEvents: [], held: [] };
  }
  const extraction = extractOfficialPageEvents(input.html, { pageUrl: input.url, timeZone: input.body.timeZone });
  const { published, held } = verifyExtractedEvents(extraction, {
    pageUrl: input.url,
    linkingPage: input.body.linkingPage,
    nameTerms: [input.body.name, ...(input.body.nameTerms ?? [])],
    timeZone: input.body.timeZone,
    now,
  });
  const events: OfficialPageEvent[] = published.map((v) => ({
    title: v.event.title,
    eventType: v.eventType,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    precision: v.precision,
    venue: v.event.venue,
    status: statusOf(v, now),
    shape: v.event.shape,
    sourceUrl: input.url,
    evidence: v.event.evidence,
    links: v.event.links,
  }));
  // Imminent first: upcoming soonest-first, then the concluded, latest first.
  const upcoming = events.filter((e) => e.status !== "CONCLUDED").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = events.filter((e) => e.status === "CONCLUDED").sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const sampleEvents = [...upcoming, ...past];

  if (sampleEvents.length > 0) return { verdict: "YIELDED", sampleEvents, held };
  if (extraction.events.length === 0 && extraction.yearless.length === 0) {
    return { verdict: "EMPTY", reason: "NO_DATED_EVENTS_ON_PAGE", sampleEvents, held };
  }
  const reasons = [...new Set(held.flatMap((h) => h.reasons))].sort();
  return { verdict: "NOT_CONFIRMED", reason: reasons.join(",") || "NO_EVENT_VERIFIED", sampleEvents, held };
}

/* ---------------------------------------------------------------- adapter -- */

export interface OfficialPageRaw {
  linkingPage?: OfficialLinkingPage | null;
  wiring: BodySourceWiring;
  /** The page's HTML; empty when `error` is set. */
  html: string;
  /** Linked `.ics` files retrieved on an authorized host. */
  ics: Array<{ url: string; text: string }>;
  /** Linked `.ics` files NOT retrieved, with why — never silently skipped. */
  icsRefused: Array<{ url: string; reason: string }>;
  collectedAt: string;
  error?: string;
}

type SavedOfficialPage = { readonly canonicalUrl: string; readonly text: string };
/** Captures are immutable; retain this append-only array between lookups. */
export type LazyOfficialPage = { readonly canonicalUrl: string; readonly readText: () => Promise<string> };
type IndexedOfficialPage = {
  readonly canonicalUrl: string;
  readonly links: ReadonlySet<string>;
  readonly text?: string;
  readonly readText?: () => Promise<string>;
};
type LinkingNode = {
  readonly page: IndexedOfficialPage;
  source: IndexedOfficialPage;
  readonly position: number;
  readonly host: string | null;
  readonly links: ReadonlySet<string>;
  pass: number;
  parent?: LinkingNode;
};

/** The source-authority host rules, including relative links and www aliases. */
function linkingHost(url: string, base?: string): string | null {
  const absolute = /^(https?):\/\/([^/?#\s]+)/i.exec(url.trim());
  if (absolute) {
    const host = absolute[2].replace(/^[^@]*@/, "").replace(/:\d*$/, "").toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) ? host.replace(/^www\./, "") : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url.trim())) return null;
  if (url.trim().startsWith("//")) return linkingHost(`https:${url.trim()}`);
  return base === undefined ? null : linkingHost(base);
}

function linkingBefore(a: LinkingNode, b: LinkingNode): boolean {
  return a.pass < b.pass || (a.pass === b.pass && a.position < b.position);
}

function savedLinkHosts(page: SavedOfficialPage): ReadonlySet<string> {
  const links = new Set<string>();
  for (const match of page.text.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const host = linkingHost((match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, "&"), page.canonicalUrl);
    if (host !== null) links.add(host);
  }
  return links;
}

/** Saved links are parsed once; the queue follows the old pass/page insertion order. */
class OfficialLinkingIndex {
  private readonly nodes: LinkingNode[] = [];
  private readonly urls = new Set<string>();
  private readonly parents = new Map<string, LinkingNode>();
  private readonly waiting = new Map<string, LinkingNode[]>();
  private readonly chosen = new Map<string, LinkingNode>();
  private readonly queue: { node: LinkingNode; pass: number }[] = [];
  private hasRepeatedUrls = false;

  private enqueue(node: LinkingNode): void {
    if (node.host === null || node.pass === -1) return;
    const parent = this.parents.get(node.host);
    if (!parent) return;
    const pass = parent.pass === -1 ? 0 : parent.pass + Number(node.position <= parent.position);
    if (pass > node.pass) return;
    node.parent = parent;
    if (pass === node.pass) return;
    node.pass = pass;
    const entry = { node, pass };
    let i = this.queue.length;
    this.queue.push(entry);
    while (i > 0) {
      const p = (i - 1) >> 1;
      const previous = this.queue[p];
      if (previous.pass < pass || (previous.pass === pass && previous.node.position <= node.position)) break;
      this.queue[i] = previous;
      i = p;
    }
    this.queue[i] = entry;
  }

  private endorse(node: LinkingNode): void {
    for (const host of node.links) {
      const previous = this.parents.get(host);
      if (previous && previous !== node && !linkingBefore(node, previous)) continue;
      this.parents.set(host, node);
      for (const child of this.waiting.get(host) ?? []) this.enqueue(child);
    }
  }

  private drain(): void {
    while (this.queue.length) {
      const first = this.queue[0];
      const last = this.queue.pop()!;
      if (this.queue.length) {
        let i = 0;
        while (2 * i + 1 < this.queue.length) {
          let child = 2 * i + 1;
          const right = child + 1;
          const earlier = (a: typeof last, b: typeof last) => a.pass < b.pass || (a.pass === b.pass && a.node.position < b.node.position);
          if (right < this.queue.length && earlier(this.queue[right], this.queue[child])) child = right;
          if (!earlier(this.queue[child], last)) break;
          this.queue[i] = this.queue[child];
          i = child;
        }
        this.queue[i] = last;
      }
      const { node, pass } = first;
      if (pass !== node.pass) continue;
      const previous = this.chosen.get(node.page.canonicalUrl);
      if (previous && previous !== node) continue;
      this.chosen.set(node.page.canonicalUrl, node);
      this.endorse(node);
    }
  }

  extend(pages: readonly IndexedOfficialPage[]): void {
    const appended: LinkingNode[] = [];
    for (let i = this.nodes.length; i < pages.length; i++) {
      const page = pages[i];
      this.hasRepeatedUrls ||= this.urls.has(page.canonicalUrl);
      this.urls.add(page.canonicalUrl);
      const node: LinkingNode = { page, source: page, position: i, host: linkingHost(page.canonicalUrl), links: page.links,
        pass: Infinity };
      this.nodes.push(node);
      appended.push(node);
    }
    if (!appended.length) return;
    const duplicate = this.hasRepeatedUrls;
    // A repeated URL can replace a root's saved HTML. Replay cached edges in
    // that case, preserving Map's first position / last root value semantics.
    if (duplicate) {
      this.parents.clear(); this.waiting.clear(); this.chosen.clear(); this.queue.length = 0;
      for (const node of this.nodes) { node.pass = Infinity; node.parent = undefined; node.source = node.page; (node as { links: ReadonlySet<string> }).links = node.page.links; }
    }
    const added = duplicate ? this.nodes : appended;
    for (const node of added) {
      if (node.host !== null) {
        const waiting = this.waiting.get(node.host) ?? [];
        waiting.push(node); this.waiting.set(node.host, waiting);
      }
    }
    const roots = new Map<string, LinkingNode>();
    for (const node of added) if (node.host !== null && /(^|\.)gov$/.test(node.host)) {
      const previous = roots.get(node.page.canonicalUrl);
      // The old root Map overwrites the HTML but keeps the original position.
      if (previous) { previous.source = node.page; (previous as { links: ReadonlySet<string> }).links = node.links; }
      else roots.set(node.page.canonicalUrl, node);
    }
    for (const root of roots.values()) { root.pass = -1; this.chosen.set(root.page.canonicalUrl, root); }
    for (const root of roots.values()) this.endorse(root);
    for (const node of added) this.enqueue(node);
    this.drain();
  }

  sourcesFor(url: string): IndexedOfficialPage[] {
    const host = linkingHost(url);
    const sources: IndexedOfficialPage[] = [];
    let node = host === null || /(^|\.)gov$/.test(host) ? undefined : this.parents.get(host);
    while (node) { sources.push(node.source); node = node.parent; }
    return sources;
  }
}

type LinkingState = { index: OfficialLinkingIndex; pages: IndexedOfficialPage[] };
const officialLinkingIndexes = new WeakMap<readonly SavedOfficialPage[], LinkingState>();
const lazyOfficialLinkingIndexes = new WeakMap<readonly LazyOfficialPage[], LinkingState & {
  pending: Promise<void>;
  ingested: Map<number, IndexedOfficialPage>;
}>();

function chainFromSources(sources: readonly IndexedOfficialPage[], texts: readonly string[]): OfficialLinkingPage | null {
  let chain: OfficialLinkingPage | null = null;
  for (let i = sources.length - 1; i >= 0; i--) {
    chain = { url: sources[i].canonicalUrl, html: texts[i], ...(chain ? { linkingPage: chain } : {}) };
  }
  return chain;
}

/** One index per append-only saved page set, shared by every caller. */
export function officialLinkingPageFrom(url: string, pages: readonly SavedOfficialPage[]): OfficialLinkingPage | null {
  if (isOfficialSource(url)) return null;
  let state = officialLinkingIndexes.get(pages);
  if (!state) { state = { index: new OfficialLinkingIndex(), pages: [] }; officialLinkingIndexes.set(pages, state); }
  for (let i = state.pages.length; i < pages.length; i++) state.pages.push({ ...pages[i], links: savedLinkHosts(pages[i]) });
  state.index.extend(state.pages);
  const sources = state.index.sourcesFor(url);
  return chainFromSources(sources, sources.map(page => page.text!));
}

/**
 * Read each capture once to index its links, without retaining decoded HTML.
 * Reload only the selected chain's original capture text for verification.
 * Ingestion uses an ordered 16-wide pool; concurrent callers share it.
 * Failed reads propagate after the pool drains and may be retried.
 */
export async function officialLinkingPageFromAsync(url: string, pages: readonly LazyOfficialPage[]): Promise<OfficialLinkingPage | null> {
  if (isOfficialSource(url)) return null;
  let state = lazyOfficialLinkingIndexes.get(pages);
  if (!state) {
    state = { index: new OfficialLinkingIndex(), pages: [], pending: Promise.resolve(), ingested: new Map() };
    lazyOfficialLinkingIndexes.set(pages, state);
  }
  const saved = state;
  const pending = saved.pending.catch(() => {}).then(async () => {
    while (saved.pages.length < pages.length) {
      const start = saved.pages.length;
      const end = Math.min(start + 16, pages.length);
      const results = await Promise.allSettled(Array.from({ length: end - start }, async (_, offset) => {
        const i = start + offset;
        if (saved.ingested.has(i)) return;
        const page = pages[i];
        const text = await page.readText();
        saved.ingested.set(i, { canonicalUrl: page.canonicalUrl, readText: page.readText, links: savedLinkHosts({ canonicalUrl: page.canonicalUrl, text }) });
      }));
      // Keep successful decodes even when a neighboring read failed, without
      // changing the source order or retaining the decoded bodies.
      while (saved.ingested.has(saved.pages.length)) {
        const i = saved.pages.length;
        saved.pages.push(saved.ingested.get(i)!);
        saved.ingested.delete(i);
      }
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    saved.index.extend(saved.pages);
  });
  saved.pending = pending;
  await pending;
  const sources = saved.index.sourcesFor(url);
  const texts: string[] = [];
  for (const page of sources) texts.push(await page.readText!());
  return chainFromSources(sources, texts);
}


function nameTermsFor(wiring: BodySourceWiring): string[] {
  return (wiring.config.nameTerms ?? "").split("|").map((t) => t.trim()).filter(Boolean);
}

function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function statusOf(v: VerifiedEvent, now: Date): MeetingStatus {
  if (v.event.canceled) return "CANCELED";
  // A sitting is over when it ENDS. A date-only sitting is over when its day
  // is; a start-only sitting, at its start — the rule every adapter uses.
  const over = v.endsAt
    ? Date.parse(v.endsAt)
    : v.precision === "DAY"
      ? Date.parse(v.startsAt) + 86_400_000
      : Date.parse(v.startsAt);
  return over <= now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/** The Meeting a verified event becomes. Pure, so tests and the door see one shape. */
export function meetingFromVerified(
  v: VerifiedEvent,
  wiring: BodySourceWiring,
  collectedAt: string,
  now: Date,
): Meeting {
  const bodyName = wiring.config.bodyName ?? wiring.publishingOrg;
  const placed = v.event.venue ? resolveVenue(SOURCE_NAME, wiring.ocdId, v.event.venue) : undefined;
  const venueGap: MeetingVenueGap | undefined = placed
    ? undefined
    : v.event.venue
      ? { kind: "STATED_NOT_PLACED", publishedText: v.event.venue, publisher: wiring.publishingOrg }
      : { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: wiring.publishingOrg };
  const time = v.event.start
    ? `T${String(v.event.start.hour).padStart(2, "0")}${String(v.event.start.minute).padStart(2, "0")}`
    : "";
  return {
    id: `${SOURCE_NAME}:${wiring.config.slug}:${v.event.date}${time}:${slugOf(v.eventType)}`,
    ocdId: wiring.ocdId,
    bodyId: wiring.bodyId,
    bodyName,
    title: v.event.title,
    eventType: v.eventType,
    startsAt: v.startsAt,
    startPrecision: v.precision,
    ...(v.endsAt ? { endsAt: v.endsAt } : {}),
    timeZone: wiring.timeZone,
    location: placed
      ? { name: placed.name, address: placed.address, lat: placed.lat, lng: placed.lng }
      : null,
    ...(venueGap ? { venueGap } : {}),
    ...(v.event.links.length > 0 ? { publishedLinks: v.event.links } : {}),
    agendaUrl: null,
    jurisdiction: wiring.jurisdiction,
    status: statusOf(v, now),
    provenance: {
      sourceUrl: wiring.config.pageUrl,
      sourceOrg: wiring.publishingOrg,
      collectedAt,
      verifiedAt: null,
      evidenceExcerpt: v.event.evidence,
    },
  };
}

export interface OfficialPageNormalizeReport {
  held: Array<HeldEvent & { bodyId: string }>;
}

export function makeOfficialPageEventsSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
  linkingPageFor?: (url: string) => OfficialLinkingPage | null | undefined,
): ReportingMeetingSource<OfficialPageRaw> & {
  normalizeWithHolds(raw: OfficialPageRaw[], now?: Date): OfficialPageNormalizeReport;
} {
  const verifyRow = (row: OfficialPageRaw, now: Date) => {
    const extraction = extractOfficialPageEvents(row.html, {
      pageUrl: row.wiring.config.pageUrl,
      timeZone: row.wiring.timeZone,
      ics: row.ics,
    });
    const verified = verifyExtractedEvents(extraction, {
      pageUrl: row.wiring.config.pageUrl,
      linkingPage: row.linkingPage ?? linkingPageFor?.(row.wiring.config.pageUrl),
      nameTerms: nameTermsFor(row.wiring),
      timeZone: row.wiring.timeZone,
      now,
    });
    return { ...verified, readings: extraction.events.length };
  };

  const normalizeWithDrops = (
    raw: OfficialPageRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts; unreachableOcdIds: string[] }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    const unreachable = new Set<string>();
    let considered = 0;
    let outOfWindow = 0;
    let duplicates = 0;
    let unretrieved = 0;

    for (const row of raw) {
      if (row.error) {
        considered += 1;
        unretrieved += 1;
        drops.notConfigured += 1;
        if (row.wiring.ocdId) unreachable.add(row.wiring.ocdId);
        continue;
      }
      const { published, held, readings } = verifyRow(row, now);
      // A-002: every reading the page yielded is a record this pass
      // considered; readings of one sitting folded together (a card and its
      // detail modal, a heading and its "next meeting" line) are duplicates.
      const heldReadings = held.filter((h) => h.shape !== "prose-date").length;
      considered += readings;
      duplicates += Math.max(0, readings - published.length - heldReadings);
      for (const h of held) {
        if (h.shape === "prose-date") {
          // A stated date with no year is a sitting we cannot place in time:
          // counted as such, never silently skipped.
          considered += 1;
          drops.unplaceableInTime += 1;
          continue;
        }
        if (h.reasons.includes("DATE_OUT_OF_WINDOW") && h.reasons.length === 1) outOfWindow += 1;
        else if (h.reasons.some((r) => r === "DATE_UNPARSEABLE" || r === "YEAR_NOT_STATED" || r === "TIME_RANGE_INVERTED")) drops.unplaceableInTime += 1;
        else drops.notConfigured += 1;
      }
      const seen = new Set<string>();
      for (const v of published) {
        const meeting = meetingFromVerified(v, row.wiring, row.collectedAt, now);
        if (seen.has(meeting.id)) {
          duplicates += 1;
          continue;
        }
        seen.add(meeting.id);
        meetings.push(meeting);
      }
    }

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops, unreachableOcdIds: [...unreachable] },
      { logicalInput: considered, duplicates, outOfWindow, unretrieved },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<OfficialPageRaw[]> {
      const collected: OfficialPageRaw[] = [];
      for (const wiring of wiringRows) {
        const pageUrl = wiring.config.pageUrl;
        const linkingPage = linkingPageFor?.(pageUrl);
        try {
          const { text } = await politeGetText(pageUrl, {
            fetchImpl,
            accept: "text/html",
            signal: query?.signal,
          });
          const collectedAt = new Date().toISOString();
          const ics: OfficialPageRaw["ics"] = [];
          const icsRefused: OfficialPageRaw["icsRefused"] = [];
          for (const url of icsLinks(parseHtmlTree(text), pageUrl)) {
            if (!isOfficialSource(url, {url:pageUrl,html:text,linkingPage})) {
              icsRefused.push({ url, reason: "ICS_HOST_NOT_AUTHORIZED" });
              continue;
            }
            try {
              const file = await politeGetText(url, { fetchImpl, accept: "text/calendar", signal: query?.signal });
              ics.push({ url, text: file.text });
            } catch (error) {
              icsRefused.push({ url, reason: String((error as Error)?.message ?? error) });
            }
          }
          collected.push({ wiring, html: text, ics, icsRefused, collectedAt, linkingPage });
        } catch (error) {
          collected.push({
            wiring,
            html: "",
            ics: [],
            icsRefused: [],
            collectedAt: new Date().toISOString(),
            error: String((error as Error)?.message ?? error),
          });
        }
      }
      if (collected.length > 0 && collected.every((row) => row.error)) {
        throw new Error(collected[0].error);
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    /** Every held event, by body, with every reason — for the report and the proof. */
    normalizeWithHolds(raw: OfficialPageRaw[], now: Date = new Date()): OfficialPageNormalizeReport {
      const held: OfficialPageNormalizeReport["held"] = [];
      for (const row of raw) {
        if (row.error) continue;
        for (const h of verifyRow(row, now).held) held.push({ ...h, bodyId: row.wiring.bodyId });
      }
      return { held };
    },

    async upsert(meetings: Meeting[]) {
      // Persistence is the promotion door's, not the adapter's: the standing
      // runner promotes this source's partition. Same honest no-op as every
      // other adapter.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
