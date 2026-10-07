import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

/** Measurements, not a publication gate. Partial work is not coverage. */
export interface CoverageLearningObservation {
  readonly subjectId: string;
  readonly targetSet: string;
  readonly ordinal: 1 | 2;
  readonly startedAt: string;
  readonly coveredAt: string;
}
/** Machine-observed acquisition activity, never inferred from a door merely handed to a model. */
export interface HeadStartObservation {
  readonly attemptId: string; readonly targetId: string; readonly solved: boolean; readonly headStartOnly: boolean | null;
}
export type FactoryLearningDigest = ({ readonly coverage: CoverageLearningObservation } | { readonly coverage?: never }) & {
  readonly targets: readonly HeadStartObservation[];
};
export interface FactoryLearning {
  readonly secondCoverage: { readonly pairs: number; readonly firstMs: number; readonly secondMs: number; readonly ratio: number | null };
  readonly headStart: { readonly solved: number; readonly measured: number; readonly share: number | null };
  readonly detectiveReuse: number | null;
  readonly factsByWeek: readonly { readonly week: string; readonly facts: number; readonly observedHours: number; readonly perHour: number }[];
}

/** Comparable complete target sets only. Replay cannot multiply an observation. */
export function coverageLearning(observations: readonly CoverageLearningObservation[], targets: readonly HeadStartObservation[] = []): Pick<FactoryLearning, "secondCoverage" | "headStart"> {
  const groups = new Map<string, Map<number, CoverageLearningObservation>>();
  for (const row of observations) {
    const start = Date.parse(row.startedAt), end = Date.parse(row.coveredAt);
    if (!row.subjectId || !row.targetSet || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const key = JSON.stringify([row.subjectId, row.targetSet]);
    const group = groups.get(key) ?? new Map();
    const prior = group.get(row.ordinal);
    if (!prior || row.coveredAt < prior.coveredAt) group.set(row.ordinal, row);
    groups.set(key, group);
  }
  let pairs = 0, firstMs = 0, secondMs = 0, measured = 0, solved = 0;
  for (const group of groups.values()) {
    const a = group.get(1), b = group.get(2);
    if (!a || !b || Date.parse(b.startedAt) < Date.parse(a.coveredAt)) continue;
    pairs++; firstMs += Date.parse(a.coveredAt) - Date.parse(a.startedAt); secondMs += Date.parse(b.coveredAt) - Date.parse(b.startedAt);
  }
  const unique = new Map(targets.map(target => [JSON.stringify([target.attemptId, target.targetId]), target]));
  for (const target of unique.values()) if (typeof target.headStartOnly === "boolean") { measured++; if (target.solved && target.headStartOnly) solved++; }
  return { secondCoverage: { pairs, firstMs, secondMs, ratio: pairs && firstMs > 0 ? secondMs / firstMs : null },
    headStart: { solved, measured, share: measured ? solved / measured : null } };
}

export const COVERAGE_LEARNING_SQL = `WITH observations AS (
 SELECT DISTINCT ON (record->'factoryLearning'->'coverage'->>'subjectId', record->'factoryLearning'->'coverage'->>'targetSet', record->'factoryLearning'->'coverage'->>'ordinal')
 record->'factoryLearning'->'coverage' AS v FROM cp_log_owner_digests
 WHERE record->'factoryLearning'->'coverage'->>'ordinal' IN ('1','2')
 ORDER BY record->'factoryLearning'->'coverage'->>'subjectId', record->'factoryLearning'->'coverage'->>'targetSet', record->'factoryLearning'->'coverage'->>'ordinal', record->'factoryLearning'->'coverage'->>'coveredAt'
), valid AS (
 SELECT v, (v->>'startedAt')::timestamptz AS start, (v->>'coveredAt')::timestamptz AS finish FROM observations
 WHERE v->>'subjectId' IS NOT NULL AND v->>'targetSet' IS NOT NULL
), pairs AS (
 SELECT a.v, extract(epoch from a.finish-a.start)*1000 AS first_ms, extract(epoch from b.finish-b.start)*1000 AS second_ms
 FROM valid a JOIN valid b ON a.v->>'subjectId'=b.v->>'subjectId' AND a.v->>'targetSet'=b.v->>'targetSet'
 WHERE a.v->>'ordinal'='1' AND b.v->>'ordinal'='2' AND a.finish>=a.start AND b.finish>=b.start AND b.start>=a.finish
) SELECT (SELECT count(*)::int FROM pairs) AS pairs,
 (SELECT coalesce(sum(first_ms),0)::float8 FROM pairs) AS first_ms,
 (SELECT coalesce(sum(second_ms),0)::float8 FROM pairs) AS second_ms`;

export const DETECTIVE_REUSE_SQL = `SELECT count(*)::int AS reused FROM cp_log_scout_results r
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.record->'usedFieldManualEntryIds')='array' THEN r.record->'usedFieldManualEntryIds' ELSE '[]'::jsonb END) used(id)
 JOIN cp_field_manual m ON m.id='live' CROSS JOIN LATERAL jsonb_array_elements(m.value->'entries') e
 WHERE e->>'id'=used.id AND e->>'foundBy'='DETECTIVE' AND r.recorded_at >= $1::timestamptz AND r.recorded_at < $2::timestamptz
 AND (r.record->'refusal' IS NULL OR r.record->'refusal'='null'::jsonb OR r.record->'refusal'='[]'::jsonb)`;

export const HEAD_START_LEARNING_SQL = `WITH targets AS (
 SELECT DISTINCT ON (t->>'attemptId', t->>'targetId') t FROM cp_log_owner_digests r
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(record->'factoryLearning'->'targets')='array' THEN record->'factoryLearning'->'targets' ELSE '[]'::jsonb END) t
 WHERE t->>'attemptId' IS NOT NULL AND t->>'targetId' IS NOT NULL
 ORDER BY t->>'attemptId', t->>'targetId', r.recorded_at DESC
) SELECT count(*) FILTER (WHERE jsonb_typeof(t->'headStartOnly')='boolean' AND jsonb_typeof(t->'solved')='boolean')::int AS measured,
 count(*) FILTER (WHERE t->'headStartOnly'='true'::jsonb AND t->'solved'='true'::jsonb)::int AS solved FROM targets`;

export const FACTS_LEARNING_SQL = `SELECT date_trunc('week', recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS week,
 sum((record->'publicationFlow'->>'changedRecords')::int)::int AS facts
 FROM cp_log_owner_digests WHERE log_key='publication-flow' AND record->'publicationFlow'->>'stage'='LIVE'
 AND recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz GROUP BY 1 ORDER BY 1`;

export function weeklyFactRates(rows: readonly { week: string; facts: number }[], from: string, through: string): FactoryLearning["factsByWeek"] {
  const start = Date.parse(from), end = Date.parse(through);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Error("LEARNING_WINDOW_INVALID");
  return rows.flatMap(row => {
    const week = Date.parse(row.week), hours = (Math.min(end, week + 7*86_400_000) - Math.max(start, week)) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isSafeInteger(row.facts) || row.facts < 0) return [];
    return [{ week: new Date(week).toISOString(), facts: row.facts, observedHours: hours, perHour: row.facts / hours }];
  });
}

export async function readFactoryLearning(input: { control: Sql; from: string; through: string; recordingSince: string }): Promise<FactoryLearning> {
  const from = new Date(Math.max(Date.parse(input.from), Date.parse(input.recordingSince))).toISOString();
  weeklyFactRates([], from, input.through);
  const [coverage, reuse, facts, targets] = await Promise.all([
    boundedQuery(input.control, { operation: "learning.coverage", callClass: "PAGE" }, COVERAGE_LEARNING_SQL, []),
    boundedQuery(input.control, { operation: "learning.detective_reuse", callClass: "PAGE" }, DETECTIVE_REUSE_SQL, [from, input.through]),
    boundedQuery(input.control, { operation: "learning.facts", callClass: "PAGE" }, FACTS_LEARNING_SQL, [from, input.through]),
    boundedQuery(input.control, { operation: "learning.head_start", callClass: "PAGE" }, HEAD_START_LEARNING_SQL, []),
  ]) as [{ pairs: number; first_ms: number; second_ms: number }[], { reused: number }[], { week: string; facts: number }[], { measured: number; solved: number }[]];
  const c = coverage[0], t = targets[0]; if (!c || !t) throw Error("LEARNING_COUNTS_UNREADABLE");
  return { secondCoverage: { pairs: c.pairs, firstMs: c.first_ms, secondMs: c.second_ms, ratio: c.pairs && c.first_ms > 0 ? c.second_ms/c.first_ms : null },
    headStart: { measured: t.measured, solved: t.solved, share: t.measured ? t.solved/t.measured : null },
    detectiveReuse: reuse[0]?.reused ?? null, factsByWeek: weeklyFactRates(facts, from, input.through) };
}
