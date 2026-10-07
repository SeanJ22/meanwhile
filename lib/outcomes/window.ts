/**
 * The rolling routine window official-outcome readers share: today in the body's own zone, back a
 * fixed number of days, with `--from`/`--to` as explicit operator overrides.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Legistar's `EventDate` is the body's local calendar date, so "today" is too. */
export function calendarDayIn(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function exactCalendarDay(code: string, flag: string, day: string): string {
  const at = Date.parse(`${day}T00:00:00.000Z`);
  if (!CALENDAR_DAY.test(day) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== day) {
    throw new Error(`${code}: ${flag} must be an exact YYYY-MM-DD calendar day, got ${JSON.stringify(day)}.`);
  }
  return day;
}

export interface OutcomeWindow {
  readonly from: string;
  readonly to: string;
}

/** `code` names the reader in the refusal. */
export function rollingOutcomeWindow(
  args: { readonly from: string | null; readonly to: string | null },
  timeZone: string,
  at: Date,
  days: number,
  code: string,
): OutcomeWindow {
  const to = exactCalendarDay(code, "--to", args.to ?? calendarDayIn(timeZone, at));
  const from = exactCalendarDay(code, "--from", args.from ?? new Date(Date.parse(`${to}T00:00:00.000Z`) - days * DAY_MS).toISOString().slice(0, 10));
  if (from > to) throw new Error(`${code}: --from ${from} is after --to ${to}.`);
  return { from, to };
}
