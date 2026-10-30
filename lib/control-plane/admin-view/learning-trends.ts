/** A week with no record of a measure is a gap (null), never 0. */

export interface WeekLearningRow {
  /** The Monday (UTC) the week starts on, YYYY-MM-DD. */
  readonly week: string;
  readonly walks: number;
  readonly pairRecorded: number;
  readonly handed: number;
  readonly usedRecorded: number;
  readonly usedWalks: number;
  readonly reusedDoors: number;
  readonly finderAttributed?: number;
  readonly scoutReusedDoors?: number;
  readonly detectiveReusedDoors?: number;
  readonly rebuiltRecorded: number;
  readonly rebuiltRoutes: number;
  readonly resumed: number;
  readonly resumedFound: number;
  readonly fresh: number;
  readonly freshFound: number;
  readonly found: number;
  readonly usd: number;
  readonly unpriced: number;
  readonly ladderRecorded?: number;
  readonly escalated?: number;
}

export interface SeriesPoint {
  readonly week: string;
  /** The measure; null is a gap — nothing recorded it that week. */
  readonly value: number | null;
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
  readonly measuredWeeks: number;
  readonly says: string;
}

export interface LearningTrends {
  readonly weeks: readonly string[];
  readonly series: Readonly<Record<SeriesKey, LearningSeries>>;
  readonly escalations: { readonly recorded: number; readonly ladderWalks: number; readonly weeks: number; readonly says: string };
}

const WEEK_MS = 7 * 86_400_000;

export function mondayOf(iso: string): string {
  const t = Date.parse(iso);
  const d = new Date(t);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

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

/** Decode each Scout's summary fields once, then derive all three exact aggregate views from them. */
export const SCOUT_LEARNING_SQL = `WITH scouts AS MATERIALIZED (
  SELECT r."startedAt" AS started_at,r."inheritedFieldManual" AS inherited,
    r."resumedFromRungs" AS resumed,r.outcome,r.usd,r."escalatedFrom" AS escalated,
    jsonb_typeof(s.record)='object' AND s.record ? 'inheritedFieldManual' AS pair_recorded,
    jsonb_typeof(s.record)='object' AND s.record ? 'resumedFromRungs' AS resume_recorded,
    jsonb_typeof(s.record)='object' AND s.record ? 'modelClass' AS ladder_recorded,
    r."usedFieldManualEntryIds" AS used_ids,
    jsonb_typeof(r."usedFieldManualEntryIds")='array' AS used_recorded,
    CASE WHEN jsonb_typeof(r."usedFieldManualEntryIds")='array' THEN jsonb_array_length(r."usedFieldManualEntryIds") ELSE 0 END AS used_n,
    CASE WHEN jsonb_typeof(r."inheritedFieldManualEntryIds")='array' THEN jsonb_array_length(r."inheritedFieldManualEntryIds") ELSE 0 END AS given_n,
    jsonb_typeof(r."rebuiltExistingRoutes")='array' AS rebuilt_recorded,
    CASE WHEN jsonb_typeof(r."rebuiltExistingRoutes")='array' THEN jsonb_array_length(r."rebuiltExistingRoutes") ELSE 0 END AS rebuilt_n,
    CASE WHEN jsonb_typeof(r.refusal)='array' THEN jsonb_array_length(r.refusal) ELSE 0 END > 0 AS refused
  FROM cp_log_scout_results s CROSS JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(s.record)='object' THEN s.record ELSE '{}'::jsonb END) r(
    "startedAt" text,"inheritedFieldManual" text,"resumedFromRungs" text,outcome text,usd text,"escalatedFrom" text,
    "usedFieldManualEntryIds" jsonb,"inheritedFieldManualEntryIds" jsonb,"rebuiltExistingRoutes" jsonb,refusal jsonb)
), timed AS MATERIALIZED (
  SELECT to_char(date_trunc('week',started_at::timestamptz AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS wk,
    inherited,resumed,outcome,usd,escalated,pair_recorded,resume_recorded,ladder_recorded,used_ids,used_recorded,used_n,given_n,rebuilt_recorded,rebuilt_n,refused
  FROM scouts WHERE started_at IS NOT NULL
), bank_entries AS MATERIALIZED (
  SELECT id,value->>'foundBy' AS finder FROM cp_field_manual_entries WHERE value->>'foundBy' IN ('SCOUT','DETECTIVE')
), finder_reuse AS (
  SELECT t.wk,count(*)::int AS attributed,count(*) FILTER(WHERE b.finder='SCOUT')::int AS scouts,
    count(*) FILTER(WHERE b.finder='DETECTIVE')::int AS detectives
  FROM timed t CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN t.used_recorded THEN t.used_ids ELSE '[]'::jsonb END) used(id)
    JOIN bank_entries b ON b.id=used.id GROUP BY t.wk
), weeks AS (
  SELECT t.wk,count(*)::int AS walks,count(*) FILTER(WHERE t.pair_recorded)::int AS pair_recorded,
    count(*) FILTER(WHERE coalesce(t.inherited::numeric,0)>0)::int AS handed,
    count(*) FILTER(WHERE t.used_recorded AND t.given_n>0)::int AS used_recorded,
    count(*) FILTER(WHERE t.used_n>0)::int AS used_walks,coalesce(sum(t.used_n),0)::int AS reused_doors,
    coalesce(max(f.attributed),0)::int AS finder_attributed,coalesce(max(f.scouts),0)::int AS scout_reused,
    coalesce(max(f.detectives),0)::int AS detective_reused,
    count(*) FILTER(WHERE t.rebuilt_recorded)::int AS rebuilt_recorded,coalesce(sum(t.rebuilt_n),0)::int AS rebuilt_routes,
    count(*) FILTER(WHERE NOT t.refused AND coalesce(t.resumed::numeric,0)>0)::int AS resumed,
    count(*) FILTER(WHERE NOT t.refused AND coalesce(t.resumed::numeric,0)>0 AND t.outcome IN ('ROUTE_CANDIDATE','EVIDENCE_FOUND'))::int AS resumed_found,
    count(*) FILTER(WHERE NOT t.refused AND t.resume_recorded AND coalesce(t.resumed::numeric,0)=0)::int AS fresh,
    count(*) FILTER(WHERE NOT t.refused AND t.resume_recorded AND coalesce(t.resumed::numeric,0)=0 AND t.outcome IN ('ROUTE_CANDIDATE','EVIDENCE_FOUND'))::int AS fresh_found,
    count(*) FILTER(WHERE NOT t.refused AND t.outcome IN ('ROUTE_CANDIDATE','EVIDENCE_FOUND'))::int AS found,
    coalesce(sum(t.usd::numeric),0)::float8 AS usd,count(*) FILTER(WHERE t.usd IS NULL)::int AS unpriced,
    count(*) FILTER(WHERE t.ladder_recorded)::int AS ladder_recorded,count(*) FILTER(WHERE coalesce(t.escalated,'')<>'')::int AS escalated
  FROM timed t LEFT JOIN finder_reuse f ON f.wk=t.wk GROUP BY t.wk
), doors AS (
  SELECT count(*)::int AS walks,coalesce(sum(given_n),0)::int AS given,coalesce(sum(used_n),0)::int AS used,min(started_at) AS since
  FROM scouts WHERE used_recorded
), named AS (
  SELECT e.id,count(*)::int AS n FROM scouts s
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN s.used_recorded THEN s.used_ids ELSE '[]'::jsonb END) e(id)
  GROUP BY e.id ORDER BY n DESC,e.id LIMIT 5
)
SELECT coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY wk) FROM weeks w),'[]'::jsonb) AS week_rows,
  (SELECT to_jsonb(d) FROM doors d) AS door_row,
  coalesce((SELECT jsonb_agg(to_jsonb(named_row) ORDER BY named_row.n DESC,named_row.id) FROM named named_row),'[]'::jsonb) AS named_rows,
  coalesce((SELECT sum((value #>> '{payload,count}')::bigint) FROM cp_field_manual_entries WHERE value->>'kind'='WRITE_HEALTH'),0) AS write_errors`;
