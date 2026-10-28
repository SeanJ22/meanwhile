/**
 * Every meeting body is read twice daily, and hourly while it has a sitting starting in the next seven days or one
 * concluded in the previous seven. The day bound for a sitting without a stated end is a scheduling bound only; it is
 * never stored or shown, and a stated end always replaces it.
 */
import { sql, type SQL } from "drizzle-orm";

import { sittingWindowHot, sittingWindowRereadMs, type SittingWindowSchedule } from "./contracts.ts";

/** An hourly read, or a retry, is eligible this long before its deadline. */
export const SITTING_WINDOW_ADMISSION_LEAD_MS = 25 * 60_000;
/** A twice-daily read is eligible this long before its deadline. */
export const SITTING_WINDOW_BASE_ADMISSION_LEAD_MS = 2 * 60 * 60_000;
/** A sitting without an end time counts as concluded no later than this after it starts. */
export const SITTING_CONCLUSION_BOUND_MS = 24 * 60 * 60_000;

export type StatedSittingEnds = ReadonlyMap<string, number>;

export function sittingConclusionMs(start: string, statedEnds?: StatedSittingEnds): number {
  const at = Date.parse(start);
  const stated = statedEnds?.get(start);
  return stated !== undefined && Number.isFinite(stated) && stated >= at ? stated : at + SITTING_CONCLUSION_BOUND_MS;
}

/** `undefined` means the sitting list could not be read, which reads as hot. */
export function sittingWindowHotByConclusion(
  schedule: SittingWindowSchedule,
  sittingLists: readonly (readonly string[] | undefined)[],
  nowMs: number,
  statedEnds?: StatedSittingEnds,
): boolean | undefined {
  const byStart = sittingWindowHot(schedule, sittingLists, nowMs);
  if (byStart === true) return true;
  const concluded = sittingLists.map((starts) => starts?.map((start) => {
    const at = sittingConclusionMs(start, statedEnds);
    return Number.isFinite(at) ? new Date(at).toISOString() : start;
  }));
  return sittingWindowHot(schedule, concluded, nowMs) === true ? true : byStart;
}

export function meetingPayloadStatedEnds(payload: unknown): Map<string, number> {
  const meetings = payload && typeof payload === "object" ? (payload as { meetings?: unknown }).meetings : undefined;
  const ends = new Map<string, number>();
  if (!Array.isArray(meetings)) return ends;
  for (const meeting of meetings) {
    const { startsAt, endsAt } = (meeting && typeof meeting === "object" ? meeting : {}) as { startsAt?: unknown; endsAt?: unknown };
    if (typeof startsAt !== "string" || typeof endsAt !== "string") continue;
    const end = Date.parse(endsAt);
    if (Number.isFinite(end)) ends.set(startsAt, Math.max(end, ends.get(startsAt) ?? Number.NEGATIVE_INFINITY));
  }
  return ends;
}

/**
 * The meeting pointers' sitting times, read inside the database as three CTEs (`walk`, `unreadable`, `meeting`) for a
 * `WITH RECURSIVE` statement. `pointers` narrows which MEETING pointers are read (SQL appended to their WHERE).
 *
 * A meeting payload, its sitting list, the list's groups and a single sitting may each be held in a stored part
 * (`civic_data_payload_parts`) rather than inline. `walk` reads each pointer's payload down to its sittings, one stage at a
 * time: the payload (`root`), its `meetings` list, a held list's `groups`, one `group`, a sitting held as its own part
 * (`row`), and the two sitting times (`sitting`). A node that is a part reference is replaced by the part's value and read
 * on in the same step; a missing part leaves a `missing` row. Only part references, a held list's group references and
 * the two times of each sitting pass between steps: no payload, list or sitting is carried whole. A held payload is
 * opened once, for its `meetings` alone. `unreadable` holds the scopes that name a missing part or hold a sitting time as
 * a part; `meeting` holds every other scope's sittings as `starts` and, where stated, `ends` strings.
 */
export function meetingSittingsSql(pointers = ""): string {
  return `walk(scope, stage, node, missing) AS (
  SELECT scope, 'root', payload, false FROM civic_data_promotions WHERE record_class = 'MEETING'${pointers}
  UNION ALL
  SELECT w.scope, n.stage, n.node, n.missing
  FROM walk w
  CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(w.node->'$civicPayloadPart') = 'string' THEN w.node->>'$civicPayloadPart' END AS hash) ref
  LEFT JOIN LATERAL (
    SELECT CASE WHEN w.stage = 'root' THEN 'list' WHEN kind = 'array' AND w.stage IN ('list', 'group') THEN 'groups' ELSE w.stage END AS stage,
      CASE WHEN w.stage = 'root' THEN coalesce(jsonb_path_query_first(payload, 'strict $ ? (@.kind == "object").value.meetings', '{}', true), payload->'meetings')
        WHEN kind = 'array' AND w.stage IN ('list', 'group') THEN payload->'groups'
        WHEN kind = 'object' THEN payload->'value' ELSE payload END AS node
    FROM (SELECT payload, CASE WHEN w.stage <> 'root' THEN payload->>'kind' END AS kind FROM civic_data_payload_parts WHERE hash = ref.hash OFFSET 0) found
    OFFSET 0
  ) part ON true
  CROSS JOIN LATERAL (SELECT
    CASE WHEN ref.hash IS NOT NULL THEN part.stage WHEN w.stage = 'root' AND jsonb_typeof(w.node) = 'object' THEN 'list' ELSE w.stage END AS stage,
    CASE WHEN ref.hash IS NOT NULL THEN part.node WHEN w.stage = 'root' AND jsonb_typeof(w.node) = 'object' THEN w.node->'meetings' ELSE w.node END AS node
    OFFSET 0) v
  CROSS JOIN LATERAL (
    SELECT w.stage, NULL::jsonb, true WHERE ref.hash IS NOT NULL AND part.stage IS NULL
    UNION ALL
    SELECT v.stage, v.node, false WHERE jsonb_typeof(v.node->'$civicPayloadPart') = 'string'
    UNION ALL
    SELECT CASE WHEN v.stage = 'groups' THEN 'group' WHEN jsonb_typeof(e->'$civicPayloadPart') = 'string' THEN 'row' ELSE 'sitting' END,
      CASE WHEN v.stage = 'groups' OR jsonb_typeof(e->'$civicPayloadPart') = 'string' THEN e
        ELSE jsonb_build_object('startsAt', e->'startsAt', 'endsAt', e->'endsAt') END, false
    FROM jsonb_array_elements(CASE WHEN v.stage IN ('list', 'groups', 'group') AND jsonb_typeof(v.node) = 'array' THEN v.node ELSE '[]'::jsonb END) e
    WHERE v.stage = 'groups' OR jsonb_typeof(e) = 'object'
    UNION ALL
    SELECT 'sitting', jsonb_build_object('startsAt', v.node->'startsAt', 'endsAt', v.node->'endsAt'), false
    WHERE v.stage = 'row' AND jsonb_typeof(v.node) = 'object' AND jsonb_typeof(v.node->'$civicPayloadPart') IS DISTINCT FROM 'string'
  ) n(stage, node, missing)
  WHERE w.stage <> 'sitting' AND NOT w.missing
), unreadable AS (
  SELECT DISTINCT scope FROM walk
  WHERE missing OR stage = 'sitting' AND (jsonb_typeof(node->'startsAt'->'$civicPayloadPart') = 'string' OR jsonb_typeof(node->'endsAt'->'$civicPayloadPart') = 'string')
), meeting AS (
  SELECT scope, node->>'startsAt' AS starts, CASE WHEN jsonb_typeof(node->'endsAt') = 'string' THEN node->>'endsAt' END AS ends
  FROM walk WHERE stage = 'sitting' AND jsonb_typeof(node->'startsAt') = 'string' AND scope NOT IN (SELECT scope FROM unreadable)
)`;
}

/** Every meeting pointer's stated sitting ends, as [start, end] string pairs, read from inline sittings and stored parts alike in one statement. */
export async function statedSittingEndsRead(db: { execute(query: SQL): PromiseLike<unknown> }): Promise<{ readonly scope: string; readonly pairs: unknown }[]> {
  const result = await db.execute(sql.raw(`WITH RECURSIVE ${meetingSittingsSql()}
SELECT scope, jsonb_agg(jsonb_build_array(starts, ends)) AS pairs FROM meeting WHERE ends IS NOT NULL GROUP BY scope`));
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<string, unknown>[];
  return rows.map((row) => ({ scope: String(row.scope), pairs: row.pairs }));
}

export function statedSittingEndsByScope(rows: readonly { readonly scope: string; readonly pairs: unknown }[]): Map<string, Map<string, number>> {
  const byScope = new Map<string, Map<string, number>>();
  for (const { scope, pairs } of rows) {
    if (!Array.isArray(pairs)) continue;
    const ends = new Map<string, number>();
    for (const pair of pairs) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "string") continue;
      const end = Date.parse(pair[1]);
      if (Number.isFinite(end)) ends.set(pair[0], Math.max(end, ends.get(pair[0]) ?? Number.NEGATIVE_INFINITY));
    }
    if (ends.size > 0) byScope.set(scope, ends);
  }
  return byScope;
}

export function sittingWindowRetryMs(
  schedule: SittingWindowSchedule,
  retryMs: number,
  published: boolean,
): number {
  return published ? retryMs : Math.max(retryMs, schedule.baseEveryMs);
}

export interface SittingWindowReads {
  readonly attemptedMs: number;
  /** NaN when no success is proven. */
  readonly succeededMs: number;
  /** A retained source may have completed processing after its actual provider check. */
  readonly completedMs?:number;
  readonly published: boolean;
}

export interface SittingWindowObligation {
  readonly deadlineMs: number;
  readonly eligibleAtMs: number;
}

export function sittingWindowObligation(
  schedule: SittingWindowSchedule,
  retryMs: number,
  reads: SittingWindowReads,
  hot: boolean | undefined,
): SittingWindowObligation {
  const rereadMs = sittingWindowRereadMs(schedule, hot);
  const [fromMs, periodMs] = !Number.isFinite(reads.succeededMs)
    ? [reads.attemptedMs, reads.published ? Math.min(sittingWindowRetryMs(schedule, retryMs, true), rereadMs) : sittingWindowRetryMs(schedule, retryMs, false)]
    : reads.attemptedMs > (Number.isFinite(reads.completedMs)?reads.completedMs!:reads.succeededMs)
      ? [reads.attemptedMs, Math.min(retryMs, rereadMs)]
      : [reads.succeededMs, rereadMs];
  const leadMs = periodMs >= schedule.baseEveryMs ? SITTING_WINDOW_BASE_ADMISSION_LEAD_MS : SITTING_WINDOW_ADMISSION_LEAD_MS;
  return { deadlineMs: fromMs + periodMs, eligibleAtMs: fromMs + periodMs - leadMs };
}
