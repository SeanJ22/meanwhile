/**
 * @freshness-reads-here — `collectedAt` is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import { extractPdfText } from "../../meetings/agenda-documents.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities, politeGetBytes } from "../http.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import { sittingStatus } from "../sitting-status.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * A community college's own first-party publication of its Governing Board
 * sittings:
 *
 * - the board's documents page — the year's table of every sitting, each row
 *   carrying the college's own agenda, approved-items and video links;
 * - the events calendar filtered to the board — every UPCOMING sitting, whose
 *   per-event add-to-calendar link states start, end and room as data;
 * - one committee's schedule (date, start time, location) and document table.
 *
 * Every host is asked before every run (`../permission-gate.ts`).
 *
 * - **The agenda link is the college's own link, whatever host it names.** A
 *   first-party PDF is read by the ingest; a link into the college's agenda
 *   platform names a meeting page whose agenda text nothing follows yet.
 * - **Time and place come from a sitting-specific statement or not at all**:
 *   the event's calendar link, the committee schedule row, or the first-party
 *   agenda's header. A standing "meetings are held at …" is a habit, not a
 *   statement about that sitting. An unplaced sitting is still published, with
 *   no pin, counted `unknownVenue` and its gap named.
 * - **An unlinked "Agenda" cell is not an empty slot.** The page can lag the
 *   agenda platform, so the reader keeps our own gap.
 * - **"Approved Items" are not the agenda** and are never substituted for one.
 *
 * ## Configuration (wiring row `config`)
 *
 * - `slug` — the tenant segment of every meeting id (`pima-edu:<slug>:…`).
 * - `documentsUrl` — the board's current-year documents page.
 * - `eventsUrl` — the events-calendar listing filtered to the board.
 * - `committeeName` — the published name of the one wired committee.
 * - `committeeScheduleUrl`, `committeeDocumentsUrl` — its schedule and table.
 * - `venueSourceId`, `venueTenant` — the reviewed venue namespace these sittings
 *   resolve against.
 * - `venueRoom:<code>` — the reviewed venue spelling for a room code the
 *   college prints; `venueBuilding` — the reviewed spelling for the building
 *   when the college names no room.
 */

const SOURCE_NAME = "pima-edu";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;
const DAY_MS = 86_400_000;
/** Politeness bound on the agenda PDFs read for a sitting's time and place. */
const AGENDA_PDF_CAP = 6;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** `Sept.`, `Aug`, `June`, `October` → 1..12, or 0. */
export function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return 0;
  const exact = MONTHS.indexOf(w);
  if (exact >= 0) return exact + 1;
  const prefixed = MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)) && m.startsWith(w));
  return prefixed >= 0 ? prefixed + 1 : 0;
}

export interface CivilDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (date: CivilDate) => `${date.y}-${pad(date.m)}-${pad(date.d)}`;

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#160;/g, " ")
      .replace(/&#8212;/g, "—")
      .replace(/&#8211;/g, "–"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(href: string, base: string): string {
  return new URL(decodeEntities(href), base).toString();
}

/* ─────────────────────────────────────────────────────────── sitting kinds */

export type SittingKind =
  | "regular"
  | "executive-session"
  | "study-session"
  | "retreat"
  | "special"
  | "committee";

/** The kind a board-table label or an event title names. */
export function kindOf(label: string): Exclude<SittingKind, "committee"> {
  if (/executive session/i.test(label)) return "executive-session";
  if (/study session/i.test(label)) return "study-session";
  if (/retreat/i.test(label)) return "retreat";
  if (/regular meeting/i.test(label)) return "regular";
  return "special";
}

/* ───────────────────────────────────────────────────── the documents table */

export interface DocumentsRow {
  readonly date: CivilDate;
  /** The row's own bold label, verbatim: "Regular Meeting", "Special Meeting — Study Session". */
  readonly label: string;
  /** The parenthetical after the label, when the row states one: "Hybrid", "Virtual". */
  readonly mode: string | null;
  readonly kind: Exclude<SittingKind, "committee">;
  /** The row's agenda link, resolved; null when the cell is text only or absent. */
  readonly agendaHref: string | null;
  /** The cell names an agenda ("Agenda", "Agenda and Board Packet"). */
  readonly agendaNamed: boolean;
  readonly approvedItemsHref: string | null;
  readonly canceled: boolean;
}

/**
 * Parse the board's documents page: `<h3>YYYY</h3>` then a table of month
 * header rows and sitting rows (`<td>Sept. 25</td><td><strong>Regular
 * Meeting</strong> (Hybrid): <a …>Agenda and Board Packet</a>; …</td>`).
 * Month-note rows ("NO REGULAR BOARD MEETING") carry one cell and are counted
 * separately, never read as sittings.
 */
export function parseDocumentsPage(html: string, pageUrl: string): {
  readonly year: number | null;
  readonly rows: DocumentsRow[];
  readonly monthNotes: number;
  readonly unparsed: number;
} {
  const yearMatch = /<h3[^>]*>\s*(\d{4})\s*<\/h3>\s*<table[\s\S]*?<\/table>/i.exec(html);
  if (!yearMatch) return { year: null, rows: [], monthNotes: 0, unparsed: 0 };
  const year = Number(yearMatch[1]);
  const table = yearMatch[0];
  const rows: DocumentsRow[] = [];
  let monthNotes = 0;
  let unparsed = 0;
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length === 0) continue; // header / month-name rows are <th>
    if (cells.length === 1) {
      monthNotes += 1;
      continue;
    }
    const when = /^([A-Za-z]+)\.?\s+(\d{1,2})$/.exec(stripTags(cells[0]));
    const month = when ? monthIndex(when[1]) : 0;
    const label = /<strong>([\s\S]*?)<\/strong>/i.exec(cells[1]);
    if (!when || month === 0 || !label) {
      unparsed += 1;
      continue;
    }
    const labelText = stripTags(label[1]);
    const after = stripTags(cells[1].slice(cells[1].indexOf(label[0]) + label[0].length));
    const mode = /^\(([^)]+)\)/.exec(after)?.[1]?.trim() ?? null;
    const links = [...cells[1].matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((a) => ({
      href: absolute(a[1], pageUrl),
      text: stripTags(a[2]),
    }));
    const agendaLink = links.find((l) => /^agenda/i.test(l.text)) ?? null;
    const approved = links.find((l) => /approved items/i.test(l.text)) ?? null;
    rows.push({
      date: { y: year, m: month, d: Number(when[2]) },
      label: labelText,
      mode,
      kind: kindOf(labelText),
      agendaHref: agendaLink?.href ?? null,
      agendaNamed: /\bagenda\b/i.test(after),
      approvedItemsHref: approved?.href ?? null,
      canceled: /cancel/i.test(`${labelText} ${after}`),
    });
  }
  return { year, rows, monthNotes, unparsed };
}

/* ─────────────────────────────────────────────────────── the events calendar */

export interface EventTeaser {
  readonly href: string;
  readonly date: CivilDate;
  readonly title: string;
  /** "4:15 pm - 5:00 pm" as printed. */
  readonly timeText: string | null;
  /** The teaser's location tag as printed ("District Office"). */
  readonly locationText: string | null;
}

/** The listing's teasers: `<a href="/events/<slug>?date=YYYY-MM-DD" class="c-event-teaser …">`. */
export function parseEventListing(html: string, listingUrl: string): EventTeaser[] {
  const out: EventTeaser[] = [];
  for (const a of html.matchAll(/<a\s+href="([^"]+)"\s+class="c-event-teaser[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = absolute(a[1], listingUrl);
    const day = /[?&]date=(\d{4})-(\d{2})-(\d{2})/.exec(href);
    if (!day) continue;
    const title = /<h3[^>]*c-event-teaser__title[^>]*>([\s\S]*?)<\/h3>/i.exec(a[2]);
    const tags = [...a[2].matchAll(/<span class="c-tag[^"]*">([\s\S]*?)<\/span>/gi)].map((t) => t[1]);
    const timeTag = tags.find((t) => /fa-clock/.test(t));
    const placeTag = tags.find((t) => /fa-location/.test(t));
    const timeText = timeTag ? /\|\s*([^<]+)$/.exec(stripTags(timeTag).trim())?.[1]?.trim() ?? null : null;
    out.push({
      href,
      date: { y: Number(day[1]), m: Number(day[2]), d: Number(day[3]) },
      title: title ? stripTags(title[1]) : "",
      timeText,
      locationText: placeTag ? stripTags(placeTag) || null : null,
    });
  }
  return out;
}

export interface EventPageFacts {
  readonly start: { readonly date: CivilDate; readonly h: number; readonly mi: number };
  readonly end: { readonly date: CivilDate; readonly h: number; readonly mi: number } | null;
  /** The room as the page's own calendar link states it. */
  readonly location: string | null;
}

/**
 * Read the event page's own add-to-calendar link, which states the sitting as
 * DATA: `dates=20260925T161500/20260925T170000&ctz=-07:00&location=District+Office+C-228`.
 * The wall clock is the college's; `ctz` is recorded by the caller's time zone.
 */
export function parseEventPage(html: string): EventPageFacts | null {
  const link = /calendar\/render\?action=TEMPLATE([^"]+)"/i.exec(html);
  if (!link) return null;
  const query = decodeEntities(link[1]);
  const dates = /[?&]dates=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(?:\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2})?/.exec(query);
  if (!dates) return null;
  const location = /[?&]location=([^&]*)/.exec(query)?.[1];
  const decode = (v: string) => decodeURIComponent(v.replace(/\+/g, " ")).trim();
  return {
    start: {
      date: { y: Number(dates[1]), m: Number(dates[2]), d: Number(dates[3]) },
      h: Number(dates[4]),
      mi: Number(dates[5]),
    },
    end: dates[6]
      ? {
          date: { y: Number(dates[6]), m: Number(dates[7]), d: Number(dates[8]) },
          h: Number(dates[9]),
          mi: Number(dates[10]),
        }
      : null,
    location: location !== undefined ? decode(location) || null : null,
  };
}

/** "4:15 pm - 5:00 pm" → the start's 24-hour clock. */
export function parseClock(text: string | null): { h: number; mi: number } | null {
  if (!text) return null;
  const m = /(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return { h, mi: Number(m[2]) };
}

/* ─────────────────────────────────────────────────────── the committee pages */

export interface CommitteeScheduleRow {
  readonly date: CivilDate;
  readonly timeText: string;
  readonly location: string;
}

function longDate(text: string): CivilDate | null {
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim());
  const month = m ? monthIndex(m[1]) : 0;
  return m && month ? { y: Number(m[3]), m: month, d: Number(m[2]) } : null;
}

/** The committee's "Meeting Date | Start Time | Location" schedule table. */
export function parseCommitteeSchedule(html: string): CommitteeScheduleRow[] {
  const out: CommitteeScheduleRow[] = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    if (!/Start Time/i.test(table[0]) || !/Location/i.test(table[0])) continue;
    for (const tr of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]));
      if (cells.length < 3) continue;
      const date = longDate(cells[0]);
      if (!date) continue;
      out.push({ date, timeText: cells[1], location: cells[2] });
    }
  }
  return out;
}

export interface CommitteeDocumentsRow {
  readonly date: CivilDate;
  readonly agendaHref: string | null;
  readonly approvedItemsHref: string | null;
}

/** The committee's "Meeting Date | Agenda & Meeting Packet | Minutes | Approved Items" tables. */
export function parseCommitteeDocuments(html: string, pageUrl: string): CommitteeDocumentsRow[] {
  const out: CommitteeDocumentsRow[] = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    if (!/Agenda &amp; Meeting Packet|Agenda & Meeting Packet/i.test(table[0])) continue;
    for (const tr of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
      if (cells.length < 4) continue;
      const date = longDate(stripTags(cells[0]));
      if (!date) continue;
      const href = (cell: string) => {
        const a = /<a\b[^>]*href\s*=\s*"([^"]+)"/i.exec(cell);
        return a ? absolute(a[1], pageUrl) : null;
      };
      out.push({ date, agendaHref: href(cells[1]), approvedItemsHref: href(cells[3]) });
    }
  }
  return out;
}

/* ───────────────────────────────────────────── a first-party agenda's header */

export interface AgendaHeaderFacts {
  readonly h: number | null;
  readonly mi: number | null;
  /** The agenda's own location words: "VIRTUAL MEETING", or null. */
  readonly location: string | null;
}

/**
 * The header a first-party agenda opens with (`Governing Board Study Session
 * Agenda <date> at <time> <college>, <building> VIRTUAL MEETING*`). Read only
 * for the sitting's own date, so a later sentence naming another meeting's date
 * is never taken for this one.
 */
export function parseAgendaHeader(text: string, date: CivilDate): AgendaHeaderFacts | null {
  const monthName = MONTHS[date.m - 1];
  const header = new RegExp(
    `${monthName}\\s+${date.d},\\s*${date.y}\\s+at\\s+(\\d{1,2}):(\\d{2})\\s*([ap])\\.?\\s*m\\.?`,
    "i",
  ).exec(text);
  if (!header) return null;
  let h = Number(header[1]) % 12;
  if (header[3].toLowerCase() === "p") h += 12;
  const window = text.slice(header.index, header.index + 240);
  const location = /VIRTUAL MEETING/i.test(window) ? "VIRTUAL MEETING" : null;
  return { h, mi: Number(header[2]), location };
}

/* ─────────────────────────────────────────────────────────────── the source */

export interface PimaEduRaw {
  wiring: BodySourceWiring;
  collectedAt: string;
  documents: { url: string; html: string };
  events: { url: string; html: string };
  eventPages: { url: string; html: string }[];
  committeeSchedule: { url: string; html: string } | null;
  committeeDocuments: { url: string; html: string } | null;
  agendaPdfs: { url: string; text: string }[];
}

interface Sitting {
  key: string;
  date: CivilDate;
  kind: SittingKind;
  bodyName: string;
  title: string;
  canceled: boolean;
  agendaHref: string | null;
  sourceUrl: string;
  time: { h: number; mi: number } | null;
  /** A room/place string from a sitting-specific statement. */
  place: string | null;
}

/** The reviewed venue spelling this sitting's printed place maps to, or null. */
function reviewedVenueSpelling(place: string, config: Record<string, string>): string | null {
  const room = /\bC-(\d{3})\b/i.exec(place);
  if (room) return config[`venueRoom:C-${room[1]}`] ?? null;
  if (/^district office$/i.test(place.trim())) return config.venueBuilding ?? null;
  return null;
}

function dayWindow(now: Date): { lower: number; upper: number } {
  return {
    lower: now.getTime() - WINDOW_BACK_DAYS * DAY_MS,
    upper: now.getTime() + WINDOW_FORWARD_DAYS * DAY_MS,
  };
}

function inWindowDay(date: CivilDate, now: Date): boolean {
  const { lower, upper } = dayWindow(now);
  const noonUtc = Date.UTC(date.y, date.m - 1, date.d, 19); // local noon in a UTC-7 zone with no DST
  return noonUtc >= lower - DAY_MS && noonUtc <= upper + DAY_MS;
}

/**
 * Merge the four surfaces into one sitting per (date, kind, ordinal). The
 * documents table is the board's universe; the events calendar adds upcoming
 * sittings the table may not have yet and supplies time and room; the
 * committee schedule is the committee's universe.
 */
export function mergeSittings(raw: PimaEduRaw): {
  sittings: Sitting[];
  logicalRecords: number;
  parseFailures: number;
} {
  const cfg = raw.wiring.config;
  const docs = parseDocumentsPage(raw.documents.html, raw.documents.url);
  const teasers = parseEventListing(raw.events.html, raw.events.url);
  const pageFacts = new Map(raw.eventPages.map((p) => [p.url, parseEventPage(p.html)]));
  const byKey = new Map<string, Sitting>();
  const ordinal = new Map<string, number>();
  const keyFor = (date: CivilDate, kind: SittingKind) => {
    const base = `${isoDay(date)}-${kind}`;
    const n = (ordinal.get(base) ?? 0) + 1;
    ordinal.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  for (const row of docs.rows) {
    const key = keyFor(row.date, row.kind);
    byKey.set(key, {
      key,
      date: row.date,
      kind: row.kind,
      bodyName: "Governing Board",
      // The label alone: place comes from the most sitting-specific statement,
      // and a row's "(Hybrid)" can contradict the agenda's own place.
      title: row.label,
      canceled: row.canceled,
      agendaHref: row.agendaHref,
      sourceUrl: raw.documents.url,
      time: null,
      place: /^virtual$/i.test(row.mode ?? "") ? "Virtual" : null,
    });
  }

  // The calendar joins by (date, kind), first unmatched sitting of that pair.
  const claimed = new Set<string>();
  for (const teaser of teasers) {
    const kind = kindOf(teaser.title);
    const candidates = [...byKey.values()].filter(
      (s) => s.kind === kind && isoDay(s.date) === isoDay(teaser.date) && !claimed.has(s.key),
    );
    let sitting = candidates[0];
    if (!sitting) {
      const key = keyFor(teaser.date, kind);
      sitting = {
        key,
        date: teaser.date,
        kind,
        bodyName: "Governing Board",
        title: teaser.title.replace(/^BOARD\s+/, ""),
        canceled: /cancel/i.test(teaser.title),
        agendaHref: null,
        sourceUrl: teaser.href,
        time: null,
        place: null,
      };
      byKey.set(key, sitting);
    }
    claimed.add(sitting.key);
    const facts = pageFacts.get(teaser.href) ?? null;
    const sameDay = facts && isoDay(facts.start.date) === isoDay(teaser.date);
    sitting.time = sameDay ? { h: facts!.start.h, mi: facts!.start.mi } : parseClock(teaser.timeText);
    sitting.place = (sameDay ? facts!.location : null) ?? teaser.locationText ?? sitting.place;
    sitting.sourceUrl = teaser.href;
  }

  // The committee: its schedule is its universe; its documents table adds links.
  if (raw.committeeSchedule) {
    const committeeName = cfg.committeeName ?? "Committee";
    const documents = raw.committeeDocuments
      ? parseCommitteeDocuments(raw.committeeDocuments.html, raw.committeeDocuments.url)
      : [];
    for (const row of parseCommitteeSchedule(raw.committeeSchedule.html)) {
      const key = keyFor(row.date, "committee");
      const docRow = documents.find((d) => isoDay(d.date) === isoDay(row.date));
      byKey.set(key, {
        key,
        date: row.date,
        kind: "committee",
        bodyName: committeeName,
        title: `${committeeName} Meeting`,
        canceled: /cancel/i.test(row.timeText),
        agendaHref: docRow?.agendaHref ?? null,
        sourceUrl: raw.committeeDocuments?.url ?? raw.committeeSchedule.url,
        time: parseClock(row.timeText),
        place: row.location || null,
      });
    }
  }

  // A first-party agenda PDF states a sitting's time and place in its header.
  for (const sitting of byKey.values()) {
    if (sitting.time && sitting.place) continue;
    const pdf = sitting.agendaHref ? raw.agendaPdfs.find((p) => p.url === sitting.agendaHref) : undefined;
    if (!pdf) continue;
    const header = parseAgendaHeader(pdf.text, sitting.date);
    if (!header) continue;
    sitting.time = sitting.time ?? (header.h !== null ? { h: header.h, mi: header.mi ?? 0 } : null);
    sitting.place = sitting.place ?? header.location;
  }

  return {
    sittings: [...byKey.values()],
    logicalRecords: byKey.size,
    parseFailures: docs.unparsed,
  };
}

/** Which documents-table agenda PDFs a run must read to place a sitting in time and space. */
export function agendaPdfsToRead(
  documentsHtml: string,
  documentsUrl: string,
  teasers: readonly EventTeaser[],
  now: Date,
): string[] {
  const host = new URL(documentsUrl).host;
  const upcoming = new Set(teasers.map((t) => `${isoDay(t.date)}|${kindOf(t.title)}`));
  return parseDocumentsPage(documentsHtml, documentsUrl).rows
    .filter((row) => inWindowDay(row.date, now))
    .filter((row) => !upcoming.has(`${isoDay(row.date)}|${row.kind}`))
    .map((row) => row.agendaHref)
    .filter((href): href is string => {
      if (href === null) return false;
      // An acquired HTTPS link, parsed for its host and final segment only.
      const link = new URL(href);
      return link.host === host && /\.pdf$/i.test(link.pathname);
    })
    .slice(0, AGENDA_PDF_CAP);
}

export function makePimaEduSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<PimaEduRaw> {
  const normalizeWithDrops = (
    raw: PimaEduRaw[],
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
    let outOfWindow = 0;
    const { lower, upper } = dayWindow(now);

    for (const row of raw) {
      const { wiring, collectedAt } = row;
      const cfg = wiring.config;
      const merged = mergeSittings(row);
      considered += merged.logicalRecords + merged.parseFailures;
      drops.unplaceableInTime += merged.parseFailures;

      for (const s of merged.sittings) {
        if (!s.time) {
          // A sitting nothing sitting-specific places in time is not given a
          // habitual hour. Out of window it is simply out of window.
          const probe = Date.UTC(s.date.y, s.date.m - 1, s.date.d, 19);
          if (probe < lower - DAY_MS || probe > upper + DAY_MS) {
            outOfWindow += 1;
            continue;
          }
          drops.unplaceableInTime += 1;
          continue;
        }
        const startsAt = toZonedIso(s.date.y, s.date.m, s.date.d, s.time.h, s.time.mi, wiring.timeZone);
        const at = Date.parse(startsAt);
        if (at < lower || at > upper) {
          outOfWindow += 1;
          continue;
        }
        const online = s.place && isPlacelessLocation(s.place) ? { label: s.place, joinUrl: null } : null;
        const spelling = online || !s.place ? null : reviewedVenueSpelling(s.place, cfg);
        const venue = spelling
          ? resolveVenue(cfg.venueSourceId ?? SOURCE_NAME, wiring.ocdId, spelling, cfg.venueTenant ?? cfg.slug)
          : undefined;
        /*
         * No reviewed place never suppresses the sitting: it is published with
         * no pin and counted `unknownVenue`. A place the college printed for
         * THIS sitting renders as its words (`STATED_NOT_PLACED`); otherwise our
         * own place-not-recorded gap applies.
         */
        const venueGap = !online && !venue && s.place ? unplacedVenueGap(s.place, wiring.publishingOrg) : null;
        if (!online && !venue) {
          drops.unknownVenue += 1;
          keptButPlaceless += 1;
        }
        if (online) {
          drops.placeless += 1;
          keptButPlaceless += 1;
        }
        meetings.push({
          id: `${SOURCE_NAME}:${cfg.slug}:${s.key}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName: s.bodyName,
          title: s.title,
          startsAt,
          timeZone: wiring.timeZone,
          location: venue
            ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng }
            : null,
          ...(online ? { online } : {}),
          ...(venueGap ? { venueGap } : {}),
          agendaUrl: s.agendaHref,
          jurisdiction: wiring.jurisdiction,
          status: sittingStatus(startsAt, s.canceled, now),
          provenance: {
            sourceUrl: s.sourceUrl,
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
      { logicalInput: considered, countedButProduced: keptButPlaceless, outOfWindow },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<PimaEduRaw[]> {
      const collected: PimaEduRaw[] = [];
      const now = new Date();
      for (const wiring of wiringRows) {
        const cfg = wiring.config;
        const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
        const http = { fetchImpl, signal: query?.signal };
        const documentsHtml = await permittedText(gate, cfg.documentsUrl, http);
        const eventsHtml = await permittedText(gate, cfg.eventsUrl, http);
        const teasers = parseEventListing(eventsHtml, cfg.eventsUrl).filter((t) => inWindowDay(t.date, now));
        const eventPages: { url: string; html: string }[] = [];
        for (const teaser of teasers) {
          eventPages.push({ url: teaser.href, html: await permittedText(gate, teaser.href, http) });
        }
        const committeeSchedule = cfg.committeeScheduleUrl
          ? { url: cfg.committeeScheduleUrl, html: await permittedText(gate, cfg.committeeScheduleUrl, http) }
          : null;
        const committeeDocuments = cfg.committeeDocumentsUrl
          ? { url: cfg.committeeDocumentsUrl, html: await permittedText(gate, cfg.committeeDocumentsUrl, http) }
          : null;
        const agendaPdfs: { url: string; text: string }[] = [];
        for (const url of agendaPdfsToRead(documentsHtml, cfg.documentsUrl, teasers, now)) {
          await gate.assertPermitted(url);
          const { bytes } = await politeGetBytes(url, { fetchImpl, signal: query?.signal, accept: "application/pdf" });
          agendaPdfs.push({ url, text: await extractPdfText(bytes) });
        }
        collected.push({
          wiring,
          collectedAt: new Date().toISOString(),
          documents: { url: cfg.documentsUrl, html: documentsHtml },
          events: { url: cfg.eventsUrl, html: eventsHtml },
          eventPages,
          committeeSchedule,
          committeeDocuments,
          agendaPdfs,
        });
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
