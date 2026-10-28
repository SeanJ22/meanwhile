/**
 * Which meeting partitions are hot right now: a sitting in the next seven days or held in the last seven, by the
 * publisher's stated end where one exists. A partition with no published sittings yet, or whose sittings cannot be
 * read, counts as hot.
 *
 * One statement per pass decides it inside the database, over the published meeting pointers' sittings, and returns
 * only an 8-byte fingerprint (the first 8 bytes of md5) of each cold partition's scope: no candidate, promotion or
 * clock is downloaded to decide. A partition whose fingerprint is not returned is hot, so a new or never-read
 * partition stays hot. A sitting time the database cannot read exactly as `Date.parse` does comes back as its start
 * and end strings and is decided here by the same rule.
 */
import { createHash } from "node:crypto";

import type { SittingWindowSchedule } from "../civic-data/contracts.ts";
import { routineTaskFromContract, type RoutineSourceTask } from "../civic-data/runner.ts";
import { SITTING_CONCLUSION_BOUND_MS, sittingWindowHotByConclusion, statedSittingEndsByScope } from "../civic-data/sitting-window-admission.ts";
import { MEETING_PARTITION_CONTRACTS, sittingWindowSourceIds } from "../civic-data/meeting-partitions.ts";
import type { Query } from "../facts/publish.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

/** An ISO instant with an explicit offset and at most millisecond precision, which the database and `Date.parse` read alike. */
const EXACT_INSTANT = "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,3})?)?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$";

/** $1 now, $2 window, $3 the day bound for a sitting without a stated end (all in ms), $4 EXACT_INSTANT. */
const HOT_PARTITIONS_SQL = `WITH meeting AS (
  SELECT p.scope, m->>'startsAt' AS starts, CASE WHEN jsonb_typeof(m->'endsAt') = 'string' THEN m->>'endsAt' END AS ends
  FROM civic_data_promotions p
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.payload->'meetings') = 'array' THEN p.payload->'meetings' ELSE '[]'::jsonb END) m
  WHERE p.record_class = 'MEETING' AND jsonb_typeof(m->'startsAt') = 'string'
), sitting AS (
  SELECT scope, starts, ends, starts ~ $4 AND pg_input_is_valid(starts, 'timestamptz') AS start_ok,
    ends IS NULL OR ends ~ $4 AND pg_input_is_valid(ends, 'timestamptz') AS end_ok
  FROM meeting
), undecided AS (
  SELECT scope, jsonb_agg(jsonb_build_array(starts, ends)) AS sittings FROM sitting GROUP BY scope HAVING NOT bool_and(start_ok AND end_ok)
), sitting_at AS (
  SELECT scope, CASE WHEN start_ok THEN extract(epoch FROM starts::timestamptz) * 1000 END AS at,
    max(CASE WHEN ends IS NOT NULL AND end_ok THEN extract(epoch FROM ends::timestamptz) * 1000 END) AS stated
  FROM sitting WHERE scope NOT IN (SELECT scope FROM undecided) GROUP BY scope, starts, start_ok
), hot AS (
  SELECT DISTINCT scope FROM sitting_at
  WHERE abs(at - $1::numeric) <= $2::numeric
    OR abs(CASE WHEN stated >= at THEN stated ELSE at + $3::numeric END - $1::numeric) <= $2::numeric
)
SELECT
  (SELECT encode(coalesce(string_agg(substr(decode(md5(p.scope), 'hex'), 1, 8), ''::bytea), ''::bytea), 'base64')
    FROM civic_data_promotions p
    WHERE p.record_class = 'MEETING' AND p.scope NOT IN (SELECT scope FROM hot) AND p.scope NOT IN (SELECT scope FROM undecided)) AS cold,
  (SELECT coalesce(jsonb_object_agg(scope, sittings), '{}'::jsonb) FROM undecided) AS undecided`;

const FINGERPRINT_BYTES = 8;

/** The fingerprint the statement returns for a cold scope. */
export function partitionScopeFingerprint(scope: string): string {
  return createHash("md5").update(scope, "utf8").digest().subarray(0, FINGERPRINT_BYTES).toString("hex");
}

/** Whether a scope is cold for this window, from one read. */
async function coldScopes(query: Query, nowMs: number, schedule: SittingWindowSchedule): Promise<(scope: string) => boolean> {
  const [row] = await query(HOT_PARTITIONS_SQL, [String(nowMs), String(schedule.windowMs), String(SITTING_CONCLUSION_BOUND_MS), EXACT_INSTANT]);
  const bytes = typeof row?.cold === "string" ? Buffer.from(row.cold, "base64") : null;
  const undecided = row?.undecided;
  if (bytes === null || bytes.length % FINGERPRINT_BYTES !== 0 || !undecided || typeof undecided !== "object" || Array.isArray(undecided)) {
    throw new Error("HOT_PARTITIONS_RESPONSE_INVALID");
  }
  const cold = new Set<string>();
  for (let at = 0; at < bytes.length; at += FINGERPRINT_BYTES) cold.add(bytes.subarray(at, at + FINGERPRINT_BYTES).toString("hex"));
  const decided = new Map(Object.entries(undecided).map(([scope, sittings]) => {
    const pairs = (Array.isArray(sittings) ? sittings : []).filter((pair): pair is [string, string | null] => Array.isArray(pair) && typeof pair[0] === "string");
    const ends = statedSittingEndsByScope([{ scope, pairs: pairs.filter(([, end]) => typeof end === "string") }]).get(scope);
    return [scope, sittingWindowHotByConclusion(schedule, [pairs.map(([start]) => start)], nowMs, ends) === false] as const;
  }));
  return (scope) => decided.get(scope) ?? cold.has(partitionScopeFingerprint(scope));
}

export async function hotMeetingPartitions(query: Query, nowMs: number,
  tasks: readonly RoutineSourceTask[] = MEETING_PARTITION_CONTRACTS.map(routineTaskFromContract)): Promise<ReadonlySet<string>> {
  const scopeOf = new Map(tasks.map((task) => [task.id, task.scope]));
  const coldByWindow = new Map<number, ((scope: string) => boolean) | null>();
  const hot = new Set<string>();
  for (const task of tasks) {
    const schedule = task.contract.schedule;
    if (schedule?.kind !== "SITTING_WINDOW") continue;
    if (!coldByWindow.has(schedule.windowMs)) {
      coldByWindow.set(schedule.windowMs, await coldScopes(query, nowMs, schedule).catch((error: unknown) => {
        console.warn(`RCD_HOT_PARTITIONS CANNOT_TELL — ${sanitizedErrorDiagnostic(error)}; every meeting partition counts as hot this pass`);
        return null;
      }));
    }
    const isCold = coldByWindow.get(schedule.windowMs)!;
    const sources = sittingWindowSourceIds(task.id);
    if (isCold === null || sources.length === 0 || !sources.every((id) => scopeOf.has(id) && isCold(scopeOf.get(id)!))) hot.add(task.id);
  }
  return hot;
}
