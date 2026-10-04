import "server-only";

/**
 * **THE WEEKLY LEARNING SERIES, AGGREGATED WHERE THE RESULTS ARE STORED.**
 * (MW-025, MW-027, 2026-09-25.)
 *
 * One read-only HTTP transaction (no socket to open) under a statement limit,
 * three aggregates over the Scout result log — never the log itself, since
 * database transfer is billed:
 *
 * ```
 *   weeks   per UTC week: walks, the field-manual pair, doors used, resumed
 *           and fresh walks with their finds, dollars and unpriced walks
 *   doors   over every walk that records which handed doors it used: doors
 *           given, doors used, since when
 *   named   the five doors used most, by entry id
 * ```
 *
 * The series themselves — gaps as gaps, never zeros — are built by the pure
 * `lib/control-plane/admin-view/learning-trends.ts`. A failure is returned as
 * unread, never as a week with nothing in it.
 */
import { neon } from "@neondatabase/serverless";

import type { WeekLearningRow } from "@/lib/control-plane/admin-view/learning-trends.ts";
import { CONTROL_PLANE_URL_VAR } from "@/lib/control-plane/repository/pg-store.ts";

import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead } from "./shared-read.ts";

export const LEARNING_TRENDS_STATEMENT_TIMEOUT_MS = 6_000;

/** Doors handed and used, over the walks that record use. */
export interface DoorUse {
  readonly walks: number;
  readonly given: number;
  readonly used: number;
  readonly since: string | null;
  /** The doors used most, by entry id, with how many walks used each. */
  readonly named: readonly { readonly id: string; readonly walks: number }[];
}

export interface LearningTrendFacts {
  readonly asOf: string;
  readonly weeks: readonly WeekLearningRow[];
  readonly doors: DoorUse;
  readonly bankWriteErrors: number;
}

// A CASE, not an AND: SQL does not promise to short-circuit, and jsonb_array_length of a non-array throws.
const REFUSED = `(case when jsonb_typeof(record->'refusal') = 'array' then jsonb_array_length(record->'refusal') else 0 end) > 0`;
const FOUND = `record->>'outcome' in ('ROUTE_CANDIDATE', 'EVIDENCE_FOUND')`;
const RESUMED = `coalesce((record->>'resumedFromRungs')::numeric, 0)`;
const arr = (key: string): string => `(case when jsonb_typeof(record->'${key}') = 'array' then jsonb_array_length(record->'${key}') else 0 end)`;
const isArr = (key: string): string => `jsonb_typeof(record->'${key}') = 'array'`;

const WEEKS = `
  with bank_entries as (
    select e->>'id' as id, e->>'foundBy' as finder
    from cp_field_manual m cross join lateral jsonb_array_elements(m.value->'entries') e
    where m.id = 'live' and e->>'foundBy' in ('SCOUT', 'DETECTIVE')
  ), finder_reuse as (
    select to_char(date_trunc('week', (r.record->>'startedAt')::timestamptz at time zone 'UTC'), 'YYYY-MM-DD') as wk,
      count(*)::int as attributed,
      count(*) filter (where b.finder = 'SCOUT')::int as scouts,
      count(*) filter (where b.finder = 'DETECTIVE')::int as detectives
    from cp_log_scout_results r cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(r.record->'usedFieldManualEntryIds') = 'array' then r.record->'usedFieldManualEntryIds' else '[]'::jsonb end) used(id)
    join bank_entries b on b.id = used.id
    where r.record->>'startedAt' is not null group by 1
  )
  select to_char(date_trunc('week', (record->>'startedAt')::timestamptz at time zone 'UTC'), 'YYYY-MM-DD') as wk,
    count(*)::int as walks,
    count(*) filter (where (record->'inheritedFieldManual') is not null)::int as pair_recorded,
    count(*) filter (where coalesce((record->>'inheritedFieldManual')::numeric, 0) > 0)::int as handed,
    count(*) filter (where ${isArr("usedFieldManualEntryIds")} and ${arr("inheritedFieldManualEntryIds")} > 0)::int as used_recorded,
    count(*) filter (where ${arr("usedFieldManualEntryIds")} > 0)::int as used_walks,
    coalesce(sum(${arr("usedFieldManualEntryIds")}), 0)::int as reused_doors,
    coalesce(max(finder_reuse.attributed), 0)::int as finder_attributed,
    coalesce(max(finder_reuse.scouts), 0)::int as scout_reused,
    coalesce(max(finder_reuse.detectives), 0)::int as detective_reused,
    count(*) filter (where ${isArr("rebuiltExistingRoutes")})::int as rebuilt_recorded,
    coalesce(sum(${arr("rebuiltExistingRoutes")}), 0)::int as rebuilt_routes,
    count(*) filter (where not (${REFUSED}) and ${RESUMED} > 0)::int as resumed,
    count(*) filter (where not (${REFUSED}) and ${RESUMED} > 0 and ${FOUND})::int as resumed_found,
    count(*) filter (where not (${REFUSED}) and (record->'resumedFromRungs') is not null and ${RESUMED} = 0)::int as fresh,
    count(*) filter (where not (${REFUSED}) and (record->'resumedFromRungs') is not null and ${RESUMED} = 0 and ${FOUND})::int as fresh_found,
    count(*) filter (where not (${REFUSED}) and ${FOUND})::int as found,
    coalesce(sum((record->>'usd')::numeric), 0)::float8 as usd,
    count(*) filter (where record->>'usd' is null)::int as unpriced,
    count(*) filter (where (record->'modelClass') is not null)::int as ladder_recorded,
    count(*) filter (where coalesce(record->>'escalatedFrom', '') <> '')::int as escalated
  from cp_log_scout_results left join finder_reuse on finder_reuse.wk = to_char(date_trunc('week', (record->>'startedAt')::timestamptz at time zone 'UTC'), 'YYYY-MM-DD')
  where record->>'startedAt' is not null
  group by 1 order by 1`;

const DOORS = `
  select count(*)::int as walks,
    coalesce(sum(${arr("inheritedFieldManualEntryIds")}), 0)::int as given,
    coalesce(sum(${arr("usedFieldManualEntryIds")}), 0)::int as used,
    min(record->>'startedAt') as since
  from cp_log_scout_results
  where ${isArr("usedFieldManualEntryIds")}`;

const NAMED = `
  select e.id, count(*)::int as n
  from cp_log_scout_results r
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(r.record->'usedFieldManualEntryIds') = 'array' then r.record->'usedFieldManualEntryIds' else '[]'::jsonb end) as e(id)
  group by e.id order by n desc, e.id limit 5`;

type Rows = Record<string, unknown>[];

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export async function readLearningTrends(connection: string, nowIso: string): Promise<LearningTrendFacts> {
  const sql = neon(connection);
  const results = await sql.transaction(
    [sql.query(`SET LOCAL statement_timeout = ${LEARNING_TRENDS_STATEMENT_TIMEOUT_MS}`), sql.query(WEEKS), sql.query(DOORS), sql.query(NAMED),
      sql.query("select coalesce((select (value #>> '{entries,0,payload,count}')::bigint from cp_field_manual where id = 'write-errors'), 0) as write_errors")],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  const [, weekRows, doorRows, namedRows, healthRows] = results as unknown as Rows[];
  const d = doorRows[0] ?? {};
  return {
    asOf: nowIso,
    bankWriteErrors: num(healthRows[0]?.write_errors),
    weeks: weekRows.map((w) => ({
      week: String(w.wk ?? ""),
      walks: num(w.walks),
      pairRecorded: num(w.pair_recorded),
      handed: num(w.handed),
      usedRecorded: num(w.used_recorded),
      usedWalks: num(w.used_walks),
      reusedDoors: num(w.reused_doors),
      finderAttributed: num(w.finder_attributed),
      scoutReusedDoors: num(w.scout_reused),
      detectiveReusedDoors: num(w.detective_reused),
      rebuiltRecorded: num(w.rebuilt_recorded),
      rebuiltRoutes: num(w.rebuilt_routes),
      resumed: num(w.resumed),
      resumedFound: num(w.resumed_found),
      fresh: num(w.fresh),
      freshFound: num(w.fresh_found),
      found: num(w.found),
      usd: num(w.usd),
      unpriced: num(w.unpriced),
      ladderRecorded: num(w.ladder_recorded),
      escalated: num(w.escalated),
    })),
    doors: {
      walks: num(d.walks),
      given: num(d.given),
      used: num(d.used),
      since: str(d.since),
      named: namedRows.map((r) => ({ id: String(r.id ?? ""), walks: num(r.n) })),
    },
  };
}

export type LearningTrendRead = { readonly kind: "HELD"; readonly facts: LearningTrendFacts } | { readonly kind: "UNREAD"; readonly detail: string };

/* A minute fresh, five minutes recent, like the other Scout aggregates: they move at most once a cycle. */
const trendsShared = sharedRead<LearningTrendRead>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("The weekly Scout series", ms) }),
});

export async function loadLearningTrends(nowIso: string): Promise<LearningTrendRead> {
  return trendsShared.read(async () => {
    const connection = process.env[CONTROL_PLANE_URL_VAR]?.trim() ?? "";
    if (connection === "") return { kind: "UNREAD", detail: "This Admin runtime has no connection to the control plane, so the weekly series were not read." };
    try {
      return { kind: "HELD", facts: await readLearningTrends(connection, nowIso) };
    } catch (error) {
      console.error("[admin learning] the weekly Scout series could not be read:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<connection>") : "unknown error");
      return { kind: "UNREAD", detail: "The weekly Scout series could not be read just now, so no week is drawn. Nothing here is a zero." };
    }
  });
}
