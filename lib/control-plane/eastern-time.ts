/**
 * The one formatter for a timestamp shown to the owner: Eastern time, spelled
 * out. The raw ISO string stays on `<When>`'s `dateTime` and hover title.
 *
 * Pure: no clock is read. "ET" covers both EST and EDT; the hour shown is already local.
 */

export const EASTERN_ZONE = "America/New_York";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_ZONE,
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const DATE_TIME_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_ZONE,
  month: "long",
  day: "numeric",
});
const DATE_ONLY_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});
const TIME_ONLY = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** What a missing or unreadable stamp reads as. Never a blank, never a dash. */
export const NO_STAMP = "no time recorded";
export const BAD_STAMP = "an unreadable time";

function parse(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Strip the "at" Intl inserts between date and time on some engines, and the comma before the year. */
function tidy(parts: string): string {
  return parts.replace(/\s+at\s+/, ", ").replace(/,\s*(\d{4}),/, ", $1,");
}

/**
 * "September 5, 10:20 PM ET". With `year: true`, "September 5, 2026, 10:20 PM ET"
 * — used where the year is not obvious from context (a decision decided months
 * ago, an opened-on date).
 */
export function formatEastern(iso: string | null | undefined, options: { readonly year?: boolean } = {}): string {
  if (iso === null || iso === undefined || iso.trim() === "") return NO_STAMP;
  const date = parse(iso);
  if (date === null) return BAD_STAMP;
  const fmt = options.year ? DATE_TIME_YEAR : DATE_TIME;
  return `${tidy(fmt.format(date))} ET`;
}

/** "September 5" (or "September 5, 2026" with `year: true`). */
export function formatEasternDate(iso: string | null | undefined, options: { readonly year?: boolean } = {}): string {
  if (iso === null || iso === undefined || iso.trim() === "") return NO_STAMP;
  const date = parse(iso);
  if (date === null) return BAD_STAMP;
  return (options.year ? DATE_ONLY_YEAR : DATE_ONLY).format(date);
}

/** "10:20 PM ET". */
export function formatEasternTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.trim() === "") return NO_STAMP;
  const date = parse(iso);
  if (date === null) return BAD_STAMP;
  return `${TIME_ONLY.format(date)} ET`;
}

/**
 * A span within one sentence: "September 4, 4:04 AM – 4:15 AM ET" when both
 * ends fall on the same Eastern day, else both ends in full.
 */
export function formatEasternSpan(startIso: string | null | undefined, endIso: string | null | undefined): string {
  const start = parse(startIso);
  const end = parse(endIso);
  if (start === null && end === null) return NO_STAMP;
  if (start === null) return `until ${formatEastern(endIso)}`;
  if (end === null) return `from ${formatEastern(startIso)}`;
  const sameDay = DATE_ONLY.format(start) === DATE_ONLY.format(end);
  return sameDay
    ? `${DATE_ONLY.format(start)}, ${TIME_ONLY.format(start)} – ${TIME_ONLY.format(end)} ET`
    : `${formatEastern(startIso)} – ${formatEastern(endIso)}`;
}

const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;

/**
 * An instrument's own sentence, with every ISO stamp inside it read as
 * Eastern time. The pages quote instrument reasons verbatim (a runner
 * condition, a supervision proof, a published gap), and those sentences carry
 * stamps the instrument wrote for the machine; the sentence stays the
 * instrument's, the stamp becomes the owner's.
 */
export function easternize(text: string): string {
  return text.replace(ISO_IN_TEXT, (iso) => formatEastern(iso, { year: true }));
}

/**
 * A plain-language calendar date for an ISO DATE (YYYY-MM-DD) as the tracker
 * stamps them. A bare date has no time zone and no instant; it is rendered as
 * the calendar day it names, never shifted through UTC.
 */
export function formatCalendarDate(ymd: string | null | undefined): string {
  if (ymd === null || ymd === undefined || ymd.trim() === "") return NO_STAMP;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return formatEasternDate(ymd, { year: true });
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (!Number.isFinite(date.getTime())) return BAD_STAMP;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(date);
}

/** A date/time typed on Admin's calendar is Eastern, even on a computer in another zone.
 * A spring clock gap is refused; during the repeated fall hour the earlier instant is used. */
export function easternLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) return null;
  const base = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(base)) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {timeZone:EASTERN_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  for (const offset of [4,5]) {
    const date = new Date(base + offset * 3_600_000);
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p=>[p.type,p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === local) return date.toISOString();
  }
  return null;
}
