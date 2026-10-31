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

/** "10:20 PM ET". */
export function formatEasternTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.trim() === "") return NO_STAMP;
  const date = parse(iso);
  if (date === null) return BAD_STAMP;
  return `${TIME_ONLY.format(date)} ET`;
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
