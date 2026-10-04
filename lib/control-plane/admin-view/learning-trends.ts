/**
 * **IS IT LEARNING — WEEK BY WEEK, FOR WHAT IS ACTUALLY MEASURED.** (MW-025,
 * MW-027, 2026-09-25.)
 *
 * One reading is not a trend. The Scout results already record, walk by walk,
 * the field-manual pair (doors handed, doors rebuilt), which handed doors a
 * walk used (from 2026-09-25), whether it resumed from an earlier walk's
 * rungs, what it found and what it cost. This turns those into weekly series:
 *
 * ```
 *   handed     walks handed field-manual doors, of walks that record the pair
 *   used       walks that used a handed door, of walks handed doors that record use
 *   rebuilt    routes proposed that the manual already held (a defect)
 *   reused     handed doors walked again (a door learned once, used again)
 *   resumed    resumed walks that found something, of resumed walks; fresh beside it
 *   per find   dollars per find, where both were recorded; a floor when a
 *              charge in the week reported no dollars
 * ```
 *
 * A week with no record of a measure is a GAP (null), never 0 — including the
 * weeks between the first record and now in which nothing ran. Escalations
 * are recorded on each Scout result from 2026-09-25 (MW-031); walks before
 * that carry no ladder, and the sentence names them instead of counting 0. PURE: rows in, series out; the
 * only clock is `nowIso`.
 */

/** One UTC week of Scout results, as the aggregate returns it. */
export interface WeekLearningRow {
  /** The Monday (UTC) the week starts on, YYYY-MM-DD. */
  readonly week: string;
  readonly walks: number;
  /** Walks that record the field-manual pair, and of them the ones handed at least one door. */
  readonly pairRecorded: number;
  readonly handed: number;
  /** Walks handed doors that record which they used, and of them the ones that used at least one. */
  readonly usedRecorded: number;
  readonly usedWalks: number;
  /** Handed doors used, summed. */
  readonly reusedDoors: number;
  readonly finderAttributed?: number;
  readonly scoutReusedDoors?: number;
  readonly detectiveReusedDoors?: number;
  /** Walks that record the rebuilt list, and the routes on it, summed. */
  readonly rebuiltRecorded: number;
  readonly rebuiltRoutes: number;
  /** Unrefused walks that record resumption: resumed (and found), fresh (and found). */
  readonly resumed: number;
  readonly resumedFound: number;
  readonly fresh: number;
  readonly freshFound: number;
  /** Unrefused walks that found a way in or the record. */
  readonly found: number;
  readonly usd: number;
  /** Walks whose dollars were not reported. */
  readonly unpriced: number;
  /** Walks that recorded their model ladder (MW-031, from 2026-09-25), and those that escalated. Absent on older reads. */
  readonly ladderRecorded?: number;
  readonly escalated?: number;
}

export interface SeriesPoint {
  readonly week: string;
  /** The measure; null is a gap — nothing recorded it that week. */
  readonly value: number | null;
  /** The denominator the value is over (walks, finds), or null for a plain count or a gap. */
  readonly of: number | null;
  /** True when the value is a floor (a charge that week reported no dollars). */
  readonly floor: boolean;
}

export type SeriesKey = "handed" | "used" | "rebuilt" | "reused" | "scoutReused" | "detectiveReused" | "resumedFound" | "freshFound" | "perFind";

export interface LearningSeries {
  readonly key: SeriesKey;
  readonly label: string;
  readonly unit: "share" | "count" | "usd";
  readonly points: readonly SeriesPoint[];
  /** Weeks that hold a value. */
  readonly measuredWeeks: number;
  /** Generated from the points: how many weeks measured it, and that the rest are gaps. */
  readonly says: string;
}

export interface LearningTrends {
  /** Every UTC week from the first on record through the current one, oldest first. */
  readonly weeks: readonly string[];
  readonly series: Readonly<Record<SeriesKey, LearningSeries>>;
  /** Model-routing escalations, counted from walks that recorded their ladder; walks from before it are named, never counted as 0. */
  readonly escalations: { readonly recorded: number; readonly ladderWalks: number; readonly weeks: number; readonly says: string };
}

const WEEK_MS = 7 * 86_400_000;

/** The Monday (UTC) of the week an instant falls in, YYYY-MM-DD. */
export function mondayOf(iso: string): string {
  const t = Date.parse(iso);
  const d = new Date(t);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

/** Every Monday from `first`'s week through `nowIso`'s week, inclusive. Empty when `first` is not a date. */
export function weekRange(first: string, nowIso: string): string[] {
  const start = Date.parse(`${mondayOf(`${first.slice(0, 10)}T00:00:00.000Z`)}T00:00:00.000Z`);
  const end = Date.parse(`${mondayOf(nowIso)}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += WEEK_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function share(n: number, d: number): { value: number | null; of: number | null } {
  return d > 0 ? { value: n / d, of: d } : { value: null, of: null };
}

const LABEL: Readonly<Record<SeriesKey, { readonly label: string; readonly unit: LearningSeries["unit"] }>> = {
  handed: { label: "Walks handed ways in from the field manual", unit: "share" },
  used: { label: "Walks that used a way in they were handed", unit: "share" },
  rebuilt: { label: "Ways in rebuilt that the manual already held", unit: "count" },
  reused: { label: "Handed ways in walked again", unit: "count" },
  scoutReused: { label: "Scout routes reused", unit: "count" },
  detectiveReused: { label: "Detective routes reused", unit: "count" },
  resumedFound: { label: "Resumed walks that found something", unit: "share" },
  freshFound: { label: "Fresh walks that found something", unit: "share" },
  perFind: { label: "Dollars per find", unit: "usd" },
};

function seriesSays(points: readonly SeriesPoint[], weeks: number): string {
  const measured = points.filter((p) => p.value !== null).length;
  if (measured === 0) return `Not recorded in any of the ${weeks} ${weeks === 1 ? "week" : "weeks"} on record.`;
  const gaps = weeks - measured;
  return `Measured in ${measured} of ${weeks} ${weeks === 1 ? "week" : "weeks"}${gaps > 0 ? `; the other ${gaps} hold no record of it — gaps, not zeros` : ""}.`;
}

export function buildLearningTrends(rows: readonly WeekLearningRow[], nowIso: string): LearningTrends {
  const byWeek = new Map(rows.map((r) => [r.week, r] as const));
  const first = [...byWeek.keys()].sort()[0];
  const weeks = first === undefined ? [] : weekRange(first, nowIso);
  const point = (week: string, f: (r: WeekLearningRow) => { value: number | null; of: number | null; floor?: boolean }): SeriesPoint => {
    const r = byWeek.get(week);
    if (r === undefined) return { week, value: null, of: null, floor: false };
    const v = f(r);
    return { week, value: v.value, of: v.of, floor: v.value !== null && (v.floor ?? false) };
  };
  const measure: Readonly<Record<SeriesKey, (r: WeekLearningRow) => { value: number | null; of: number | null; floor?: boolean }>> = {
    handed: (r) => share(r.handed, r.pairRecorded),
    used: (r) => share(r.usedWalks, r.usedRecorded),
    rebuilt: (r) => (r.rebuiltRecorded > 0 ? { value: r.rebuiltRoutes, of: null } : { value: null, of: null }),
    reused: (r) => (r.usedRecorded > 0 ? { value: r.reusedDoors, of: null } : { value: null, of: null }),
    scoutReused: (r) => ((r.finderAttributed ?? 0) > 0 ? { value: r.scoutReusedDoors ?? 0, of: r.finderAttributed! } : { value: null, of: null }),
    detectiveReused: (r) => ((r.finderAttributed ?? 0) > 0 ? { value: r.detectiveReusedDoors ?? 0, of: r.finderAttributed! } : { value: null, of: null }),
    resumedFound: (r) => share(r.resumedFound, r.resumed),
    freshFound: (r) => share(r.freshFound, r.fresh),
    perFind: (r) => (r.found > 0 && r.walks > r.unpriced ? { value: r.usd / r.found, of: r.found, floor: r.unpriced > 0 } : { value: null, of: null }),
  };
  const build = (key: SeriesKey): LearningSeries => {
    const points = weeks.map((w) => point(w, measure[key]));
    return { key, ...LABEL[key], points, measuredWeeks: points.filter((p) => p.value !== null).length, says: seriesSays(points, weeks.length) };
  };
  const series: Record<SeriesKey, LearningSeries> = {
    handed: build("handed"),
    used: build("used"),
    rebuilt: build("rebuilt"),
    reused: build("reused"),
    scoutReused: build("scoutReused"),
    detectiveReused: build("detectiveReused"),
    resumedFound: build("resumedFound"),
    freshFound: build("freshFound"),
    perFind: build("perFind"),
  };
  const walked = rows.filter((r) => r.walks > 0).length;
  const ladderWalks = rows.reduce((n, r) => n + (r.ladderRecorded ?? 0), 0);
  const recorded = rows.reduce((n, r) => n + (r.escalated ?? 0), 0);
  const before = rows.reduce((n, r) => n + r.walks, 0) - ladderWalks;
  return {
    weeks,
    series,
    escalations: {
      recorded,
      ladderWalks,
      weeks: walked,
      says:
        walked === 0
          ? "No paid walk is on record, so no model escalation is either."
          : ladderWalks === 0
            ? `None of the ${before.toLocaleString("en-US")} paid walks on record carries a model ladder: they ran before escalations were recorded (MW-031, 2026-09-25), all on the most capable model, so their count is not known — not zero.`
            : `${recorded.toLocaleString("en-US")} of ${ladderWalks.toLocaleString("en-US")} walks that recorded their model ladder escalated to a more capable model${before > 0 ? `; ${before.toLocaleString("en-US")} earlier walks ran before the ladder was recorded` : ""}.`,
    },
  };
}

/** A point as words for a table cell; null for a gap, so the cell draws the dashed "no data" pill. */
export function pointWords(unit: LearningSeries["unit"], p: SeriesPoint): string | null {
  if (p.value === null) return null;
  if (unit === "share") return `${Math.round(p.value * 100)}% of ${p.of?.toLocaleString("en-US") ?? "?"}`;
  if (unit === "usd") return `${p.floor ? "at least " : ""}$${p.value.toFixed(2)} over ${p.of?.toLocaleString("en-US") ?? "?"}`;
  return p.value.toLocaleString("en-US");
}
