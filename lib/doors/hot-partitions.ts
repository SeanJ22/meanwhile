/**
 * Which meeting partitions are hot right now: a sitting in the next seven days or held in the last seven, by the
 * publisher's stated end where one exists. A partition with no published sittings yet, or whose sittings cannot be
 * read, counts as hot.
 *
 * One statement per pass decides it inside the database, over the published meeting pointers' sittings, and returns
 * only an 8-byte fingerprint (the first 8 bytes of md5) of each cold partition's scope: no candidate, promotion,
 * stored part or clock is downloaded to decide. A meeting payload, its sitting list, the list's groups and a single
 * sitting may each be held in a stored part (`civic_data_payload_parts`) rather than inline; the statement follows
 * those references inside the database and keeps only each sitting's `startsAt` and `endsAt`. A partition whose
 * payload names a part that is missing, or whose sitting time is itself held as a part, cannot be read and counts as
 * hot. A partition whose fingerprint is not returned is hot, so a new or never-read partition stays hot. A sitting
 * time the database cannot read exactly as `Date.parse` does comes back as its start and end strings and is decided
 * here by the same rule.
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

/**
 * $1 now, $2 window, $3 the day bound for a sitting without a stated end (all in ms), $4 EXACT_INSTANT.
 *
 * `walk` reads each meeting pointer's payload down to its sittings, one stage at a time: the payload (`root`), its
 * `meetings` list, a held list's `groups`, one `group`, a sitting held as its own part (`row`), and the two sitting
 * times (`sitting`). A node that is a part reference is replaced by the part's value and read on in the same step; a
 * missing part leaves a `missing` row. Only part references, a held list's group references and the two times of each
 * sitting pass between steps: no payload, list or sitting is carried whole. A held payload is opened once, for its
 * `meetings` alone.
 */
const HOT_PARTITIONS_SQL = `WITH RECURSIVE walk(scope, stage, node, missing) AS (
  SELECT scope, 'root', payload, false FROM civic_data_promotions WHERE record_class = 'MEETING'
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
), sitting AS (
  SELECT scope, starts, ends, starts ~ $4 AND pg_input_is_valid(starts, 'timestamptz') AS start_ok,
    ends IS NULL OR ends ~ $4 AND pg_input_is_valid(ends, 'timestamptz') AS end_ok
  FROM meeting
), undecided AS (
  SELECT scope, jsonb_agg(jsonb_build_array(starts, ends)) AS sittings FROM sitting
  WHERE scope IN (SELECT scope FROM sitting WHERE NOT (start_ok AND end_ok)) GROUP BY scope
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
    WHERE p.record_class = 'MEETING' AND p.scope NOT IN (SELECT scope FROM hot) AND p.scope NOT IN (SELECT scope FROM undecided)
      AND p.scope NOT IN (SELECT scope FROM unreadable)) AS cold,
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
