import { WINDOW_LEASE_ID } from "../promotion/window.ts";
import { boundedQuery } from "./request-bounds.ts";
import type { Sql } from "./pg-store.ts";

/** Most leases one read returns. A live fleet holds a few dozen at once; this is the hard stop. */
export const RUNNING_JOBS_LIMIT = 500;

export interface RunningJobRow {
  readonly leaseId: string;
  readonly routeTaskId: string;
  readonly holder: string | null;
  readonly expiresAt: string;
  readonly released: boolean;
  /** The newest still-open Attempt recorded against this lease, or null when none is open. */
  readonly attempt: {
    readonly id: string;
    readonly leaseId: string;
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly outcome: string | null;
    readonly role: string;
    readonly version: string | null;
    readonly workItemId: string;
  } | null;
  readonly obligation: {
    readonly id: string;
    readonly recordClass: string | null;
    readonly subjectId: string | null;
    readonly scopeDivisions: readonly string[];
    readonly assignments: readonly { readonly assignmentKey: string; readonly ref: string; readonly at: string }[];
  } | null;
}

export interface RunningJobPage {
  readonly available: boolean;
  readonly reason: string | null;
  readonly asOf: string;
  readonly limit: number;
  /** True when more live leases exist than `limit`: every count from these rows is a lower bound. */
  readonly truncated: boolean;
  readonly rows: readonly RunningJobRow[];
}

export interface RunningJobReader {
  readRunningJobs(input: { readonly nowIso: string; readonly limit?: number }): Promise<RunningJobPage>;
}

/** Not a fake empty list: file and memory providers have no indexed live-lease read. */
export function unavailableRunningJobs(reason = "RUNNING_JOBS_INDEX_UNAVAILABLE"): RunningJobReader {
  return { async readRunningJobs(input) {
    return { available: false, reason, asOf: input.nowIso, limit: input.limit ?? RUNNING_JOBS_LIMIT, truncated: false, rows: [] };
  } };
}

/** The one statement. `$1` now, `$2` limit + 1. Both indexes are the ones pg-schema.ts creates. */
export const RUNNING_JOBS_SQL = `
SELECT l.id AS lease_key, l.value->>'id' AS lease_id, l.value->>'routeTaskId' AS route_task_id,
  l.value->>'holder' AS holder, l.value->>'expiresAt' AS expires_at, l.value->>'released' AS released,
  a.value->>'id' AS attempt_id, a.value->>'leaseId' AS attempt_lease_id, a.value->>'startedAt' AS started_at,
  a.value->>'endedAt' AS ended_at, a.value->>'outcome' AS outcome, a.value->'worker'->>'role' AS role,
  a.value->'worker'->>'version' AS version, a.value->>'workItemId' AS work_item_id,
  o.id AS obligation_id, o.value->>'recordClass' AS record_class, o.value->>'subjectId' AS subject_id,
  CASE WHEN jsonb_typeof(o.value->'scopeDivisions') = 'array' THEN o.value->'scopeDivisions' ELSE '[]'::jsonb END AS scope_divisions,
  CASE WHEN jsonb_typeof(o.value->'assignments') = 'array' THEN
    (SELECT coalesce(jsonb_agg(jsonb_build_object('assignmentKey', x.elem->'assignmentKey', 'ref', x.elem->'ref', 'at', x.elem->'at')), '[]'::jsonb)
     FROM (SELECT e.elem FROM jsonb_array_elements(o.value->'assignments') AS e(elem) LIMIT 64) x)
  ELSE '[]'::jsonb END AS assignments
FROM (
  SELECT id, value FROM cp_leases
  WHERE (value->>'expiresAt') > $1 AND (value->>'released') = 'false' AND id <> '${WINDOW_LEASE_ID}'
  ORDER BY (value->>'expiresAt'), id LIMIT $2
) l
LEFT JOIN LATERAL (
  SELECT value FROM cp_attempts
  WHERE value->>'leaseId' = l.value->>'id' AND (value->>'endedAt') IS NULL AND (value->>'outcome') IS NULL
  ORDER BY (value->>'startedAt') DESC LIMIT 1
) a ON true
LEFT JOIN cp_work_items_history w ON w.id = a.value->>'workItemId'
LEFT JOIN cp_obligations o ON o.id = regexp_replace(w.value->>'obligation', '#[0-9]+$', '')
ORDER BY (l.value->>'expiresAt'), l.id`;

function canonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
function jsonArray(value: unknown): readonly unknown[] {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return []; } }
  return Array.isArray(value) ? value : [];
}

/** Maps one statement row. A row that cannot be a lease claim throws: the page is then unread, not shorter. */
export function mapRunningJobRow(raw: Readonly<Record<string, unknown>>): RunningJobRow {
  const leaseId = text(raw.lease_id), routeTaskId = text(raw.route_task_id), expiresAt = text(raw.expires_at);
  if (leaseId === null || routeTaskId === null || expiresAt === null || !canonicalInstant(expiresAt)
    || (raw.released !== "false" && raw.released !== "true")) throw new Error("RUNNING_JOBS_ROW_INVALID");
  const attemptId = text(raw.attempt_id);
  const attempt = attemptId === null ? null : (() => {
    const attemptLease = text(raw.attempt_lease_id), startedAt = text(raw.started_at), role = text(raw.role), workItemId = text(raw.work_item_id);
    if (attemptLease === null || startedAt === null || role === null || workItemId === null) throw new Error("RUNNING_JOBS_ATTEMPT_INVALID");
    return { id: attemptId, leaseId: attemptLease, startedAt, endedAt: text(raw.ended_at), outcome: text(raw.outcome), role, version: text(raw.version), workItemId };
  })();
  const obligationId = text(raw.obligation_id);
  const obligation = obligationId === null ? null : {
    id: obligationId, recordClass: text(raw.record_class), subjectId: text(raw.subject_id),
    scopeDivisions: jsonArray(raw.scope_divisions).filter((d): d is string => typeof d === "string"),
    assignments: jsonArray(raw.assignments).flatMap(m => {
      const row = m as { assignmentKey?: unknown; ref?: unknown; at?: unknown } | null;
      return row && text(row.assignmentKey) && text(row.ref) && text(row.at)
        ? [{ assignmentKey: row.assignmentKey as string, ref: row.ref as string, at: row.at as string }] : [];
    }),
  };
  return { leaseId, routeTaskId, holder: text(raw.holder), expiresAt, released: raw.released === "true", attempt, obligation };
}

/** The indexes the statement relies on must exist and be valid, or the read is unavailable rather than a table scan. */
const INDEX_CHECK_SQL = `
SELECT i.relname AS name, x.indisvalid AS valid, pg_get_indexdef(i.oid) AS indexdef
FROM pg_class i JOIN pg_index x ON x.indexrelid = i.oid
JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = current_schema() AND
 ((t.relname = 'cp_attempts' AND i.relname = 'cp_attempts_lease_id') OR
  (t.relname = 'cp_leases' AND i.relname = 'cp_leases_expiry')) LIMIT 2`;

export function pgRunningJobReader(sql: Sql): RunningJobReader {
  let indexesReady = false;
  return { async readRunningJobs(input) {
    if (!canonicalInstant(input.nowIso)) throw new Error("INVALID_RUNNING_JOBS_TIME");
    const limit = input.limit ?? RUNNING_JOBS_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > RUNNING_JOBS_LIMIT) throw new Error("INVALID_RUNNING_JOBS_LIMIT");
    if (!indexesReady) {
      const index = await boundedQuery(sql, { operation: "cp_leases.runningJobIndexes", callClass: "POINT" }, INDEX_CHECK_SQL) as readonly Record<string, unknown>[];
      const attemptIndex = Array.isArray(index) ? index.find(row => row.name === "cp_attempts_lease_id") : undefined;
      const leaseIndex = Array.isArray(index) ? index.find(row => row.name === "cp_leases_expiry") : undefined;
      if (!attemptIndex || attemptIndex.valid !== true || !String(attemptIndex.indexdef).includes("leaseId") ||
        !leaseIndex || leaseIndex.valid !== true || !String(leaseIndex.indexdef).includes("expiresAt"))
        return unavailableRunningJobs("RUNNING_JOBS_INDEX_NOT_READY").readRunningJobs(input);
      indexesReady = true;
    }
    const result = await boundedQuery(sql, { operation: "cp_leases.runningJobs", callClass: "PAGE" },
      RUNNING_JOBS_SQL, [input.nowIso, limit + 1]) as readonly Record<string, unknown>[];
    if (!Array.isArray(result) || result.length > limit + 1) throw new Error("RUNNING_JOBS_READ_INVALID");
    const truncated = result.length > limit;
    return { available: true, reason: null, asOf: input.nowIso, limit, truncated, rows: result.slice(0, limit).map(mapRunningJobRow) };
  } };
}
