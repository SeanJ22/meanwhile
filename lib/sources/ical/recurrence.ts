/**
 * A recurring series, expanded into the sittings its publisher stated. A feed publishes a board that
 * meets on, say, the third Tuesday as one event with an `RRULE` plus one override (`RECURRENCE-ID`) per
 * edited sitting; the unedited sittings exist only as that rule.
 *
 * Exactly these rule parts are expanded: `FREQ` (WEEKLY, MONTHLY), `INTERVAL`, `BYDAY` (with ordinals
 * under MONTHLY), `UNTIL` (UTC date-time, or a date for an all-day series), `COUNT` and `WKST`. Any other
 * part, value or combination is refused by name (`unsupported`), and no sitting is guessed. A rule whose
 * `DTSTART` is not itself a sitting of the rule is refused (RFC 5545 leaves that set undefined).
 *
 * Expansion runs on the series' own wall clock and calendar in its own zone, bounded from `DTSTART` to the
 * end of the serving window.
 */

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** The rule parts this module expands. */
export const SUPPORTED_RULE_PARTS = ["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"] as const;

/** Enumeration stops here whatever the rule says; a rule needing more is refused. */
const MAX_INSTANCES = 10_000;

export interface ByDay {
  /** `2` in `2TU`; null for a plain weekday. */
  readonly ordinal: number | null;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
}

export interface RecurrenceRule {
  readonly freq: "WEEKLY" | "MONTHLY";
  readonly interval: number;
  readonly byDay: readonly ByDay[];
  /** Inclusive bound: a UTC instant for a timed series, a date for an all-day one. */
  readonly until:
    | { readonly kind: "INSTANT"; readonly ms: number }
    | { readonly kind: "DATE"; readonly day: number }
    | null;
  readonly count: number | null;
  readonly wkst: number;
}

export type RuleReading =
  | { readonly ok: true; readonly rule: RecurrenceRule }
  | { readonly ok: false; readonly unsupported: string };

/**
 * Read an `RRULE` value, or name the first part of it this adapter does not
 * expand. `dayOnly` is the series' own `DTSTART` type, which decides what an
 * `UNTIL` may be.
 */
export function readRule(value: string, dayOnly: boolean): RuleReading {
  const parts = new Map<string, string>();
  for (const piece of value.split(";")) {
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq <= 0) return { ok: false, unsupported: `malformed rule part "${piece}"` };
    const key = piece.slice(0, eq).toUpperCase();
    if (parts.has(key)) return { ok: false, unsupported: `${key} stated twice` };
    parts.set(key, piece.slice(eq + 1));
  }
  for (const key of parts.keys()) {
    if (!(SUPPORTED_RULE_PARTS as readonly string[]).includes(key)) {
      return { ok: false, unsupported: key };
    }
  }
  const freq = parts.get("FREQ");
  if (freq !== "WEEKLY" && freq !== "MONTHLY") {
    return { ok: false, unsupported: `FREQ=${freq ?? "(absent)"}` };
  }
  const intervalText = parts.get("INTERVAL") ?? "1";
  if (!/^[1-9]\d{0,2}$/.test(intervalText)) return { ok: false, unsupported: `INTERVAL=${intervalText}` };
  const wkstText = parts.get("WKST") ?? "MO";
  const wkst = (WEEKDAYS as readonly string[]).indexOf(wkstText);
  if (wkst < 0) return { ok: false, unsupported: `WKST=${wkstText}` };

  const byDayText = parts.get("BYDAY");
  if (!byDayText) return { ok: false, unsupported: `FREQ=${freq} without BYDAY` };
  const byDay: ByDay[] = [];
  for (const item of byDayText.split(",")) {
    const m = /^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item);
    if (!m) return { ok: false, unsupported: `BYDAY=${item}` };
    const ordinal = m[1] === undefined ? null : Number(m[1]);
    if (ordinal !== null && freq === "WEEKLY") {
      return { ok: false, unsupported: `BYDAY=${item} under FREQ=WEEKLY` };
    }
    byDay.push({ ordinal, weekday: (WEEKDAYS as readonly string[]).indexOf(m[2]) });
  }

  const countText = parts.get("COUNT");
  if (countText !== undefined && !/^[1-9]\d{0,3}$/.test(countText)) {
    return { ok: false, unsupported: `COUNT=${countText}` };
  }
  const untilText = parts.get("UNTIL");
  if (untilText !== undefined && countText !== undefined) {
    return { ok: false, unsupported: "UNTIL together with COUNT" };
  }
  let until: RecurrenceRule["until"] = null;
  if (untilText !== undefined) {
    const date = /^(\d{4})(\d{2})(\d{2})$/.exec(untilText);
    const instant = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(untilText);
    if (dayOnly && date) {
      until = { kind: "DATE", day: dayNumber(+date[1], +date[2], +date[3]) };
    } else if (!dayOnly && instant) {
      until = {
        kind: "INSTANT",
        ms: Date.UTC(+instant[1], +instant[2] - 1, +instant[3], +instant[4], +instant[5], +instant[6]),
      };
    } else {
      return { ok: false, unsupported: `UNTIL=${untilText} on a ${dayOnly ? "date" : "date-time"} series` };
    }
  }
  return {
    ok: true,
    rule: {
      freq,
      interval: Number(intervalText),
      byDay,
      until,
      count: countText === undefined ? null : Number(countText),
      wkst,
    },
  };
}

/** Days since 1970-01-01 for a calendar date. */
export function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The calendar date of a day number. */
export function dateOfDay(day: number): { y: number; m: number; d: number } {
  const at = new Date(day * 86_400_000);
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

function weekdayOf(day: number): number {
  return new Date(day * 86_400_000).getUTCDay();
}

/** The days of one month that a `BYDAY` list names, ascending. */
function monthDays(y: number, m: number, byDay: readonly ByDay[]): number[] {
  const first = dayNumber(y, m, 1);
  const length = dayNumber(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - first;
  const days = new Set<number>();
  for (const { ordinal, weekday } of byDay) {
    const matching: number[] = [];
    for (let day = first; day < first + length; day++) if (weekdayOf(day) === weekday) matching.push(day);
    if (ordinal === null) for (const day of matching) days.add(day);
    else {
      const pick = ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal];
      if (pick !== undefined) days.add(pick);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** The days of the week (per `WKST`) beginning on `weekStart` that a `BYDAY` list names. */
function weekDays(weekStart: number, wkst: number, byDay: readonly ByDay[]): number[] {
  return [...new Set(byDay.map(({ weekday }) => weekStart + ((weekday - wkst + 7) % 7)))].sort((a, b) => a - b);
}

export type Expansion =
  | { readonly ok: true; readonly days: readonly number[] }
  | { readonly ok: false; readonly unsupported: string };

/**
 * The calendar days on which the rule places a sitting, from `DTSTART`'s own
 * day up to `throughDay`, bounded by `UNTIL` and `COUNT`.
 *
 * `untilReached(day)` answers for the rule's `UNTIL`, which for a timed series
 * is an instant and so needs the series' wall clock and zone to compare. The
 * caller owns both.
 */
export function expandRuleDays(input: {
  readonly rule: RecurrenceRule;
  readonly startDay: number;
  readonly throughDay: number;
  readonly pastUntil: (day: number) => boolean;
}): Expansion {
  const { rule, startDay, throughDay, pastUntil } = input;
  const days: number[] = [];
  let generated = 0;

  const periods = function* (): Generator<number[]> {
    if (rule.freq === "WEEKLY") {
      const weekStart = startDay - ((weekdayOf(startDay) - rule.wkst + 7) % 7);
      for (let period = 0; ; period += rule.interval) {
        const base = weekStart + period * 7;
        if (base > throughDay) return;
        yield weekDays(base, rule.wkst, rule.byDay);
      }
    }
    const start = dateOfDay(startDay);
    for (let period = 0; ; period += rule.interval) {
      const index = start.y * 12 + (start.m - 1) + period;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      if (dayNumber(y, m, 1) > throughDay) return;
      yield monthDays(y, m, rule.byDay);
    }
  };

  let first = true;
  for (const candidates of periods()) {
    if (first) {
      // RFC 5545: DTSTART is the first instance, and a DTSTART the rule does
      // not itself produce leaves the recurrence set undefined.
      if (!candidates.includes(startDay)) {
        return { ok: false, unsupported: "DTSTART that the rule does not produce" };
      }
      first = false;
    }
    for (const day of candidates) {
      if (day < startDay) continue;
      if (pastUntil(day)) return { ok: true, days };
      if (rule.count !== null && generated >= rule.count) return { ok: true, days };
      if (day > throughDay) return { ok: true, days };
      generated += 1;
      if (generated > MAX_INSTANCES) return { ok: false, unsupported: `more than ${MAX_INSTANCES} sittings` };
      days.push(day);
    }
  }
  return { ok: true, days };
}
