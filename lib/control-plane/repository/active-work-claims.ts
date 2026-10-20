import type { Attempt, ExecutionLease } from "../attempt.ts";
import { WINDOW_LEASE_ID } from "../promotion/window.ts";
import type { RouteTask } from "../route-task.ts";
import { boundedQuery } from "./request-bounds.ts";
import type { Sql } from "./pg-store.ts";
import { pgRunningJobReader, unavailableRunningJobs, type RunningJobReader } from "./running-jobs.ts";
import { pgStateProgressReader, unavailableStateProgress, type StateProgressReader } from "./state-progress.ts";

export const ACTIVE_CLAIM_PAGE_MAX = 50;
export type ActiveClaimCursor = { readonly expiresAt: string; readonly leaseKey: string };
export type ActiveClaimState = "RUNNING_ATTEMPT" | "CLAIMED_NO_ATTEMPT" | "ENDED_ATTEMPT" | "UNVERIFIED";
export interface ActiveWorkClaim {
  readonly leaseKey: string;
  readonly leaseId: string | null;
  readonly routeTaskId: string | null;
  readonly workItemId: string | null;
  readonly attemptId: string | null;
  readonly workerRole: string | null;
  readonly expiresAt: string | null;
  readonly state: ActiveClaimState;
  readonly reason: string | null;
}
export interface ActiveWorkClaimPage {
  readonly available: boolean;
  readonly reason: string | null;
  readonly asOf: string;
  /** Exact count of non-internal, unreleased/unexpired lease rows at this SQL statement's snapshot. */
  readonly totalActiveClaims: number | null;
  readonly rows: readonly ActiveWorkClaim[];
  readonly hasMore: boolean | null;
  readonly nextCursor: ActiveClaimCursor | null;
  /** Only Attempt-backed running rows on a complete first page; never all civic-source jobs. */
  readonly runningAttemptCount: number | null;
}
export interface ActiveWorkClaimReader extends RunningJobReader, StateProgressReader {
  readPage(input: { readonly nowIso: string; readonly limit?: number; readonly cursor?: ActiveClaimCursor | null }): Promise<ActiveWorkClaimPage>;
}

/** Not a fake empty list: file/memory providers have no indexed, complete active universe. */
export function unavailableActiveWorkClaims(reason = "ACTIVE_CLAIM_INDEX_UNAVAILABLE"): ActiveWorkClaimReader {
  return { ...unavailableRunningJobs(reason), ...unavailableStateProgress(reason), async readPage(input) {
    return { available: false, reason, asOf: input.nowIso, totalActiveClaims: null,
      rows: [], hasMore: null, nextCursor: null, runningAttemptCount: null };
  } };
}

export const ACTIVE_CLAIM_INDEX_CHECK_SQL = `
SELECT i.relname AS name, x.indisvalid AS valid, pg_get_indexdef(i.oid) AS indexdef
FROM pg_class i JOIN pg_index x ON x.indexrelid = i.oid
JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = current_schema() AND
 ((t.relname = 'cp_attempts' AND i.relname = 'cp_attempts_lease_id') OR
  (t.relname = 'cp_leases' AND i.relname = 'cp_leases_expiry')) LIMIT 2`;

/** Fixed SQL variants. Both use the existing cp_leases_expiry expression index. */
export function activeClaimPageSql(hasCursor: boolean): string {
  const after = hasCursor ? `AND ((l.value->>'expiresAt'), l.id) > ($2::text, $3::text)` : "";
  const limit = hasCursor ? "$4" : "$2";
  return `WITH active_count AS (
    SELECT count(*)::bigint AS total FROM cp_leases l
    WHERE (l.value->>'expiresAt') > $1 AND (l.value->>'released') = 'false'
      AND l.id <> '${WINDOW_LEASE_ID}'
  ), page AS (
    SELECT l.id, l.value, l.value->>'expiresAt' AS expires_at FROM cp_leases l
    WHERE (l.value->>'expiresAt') > $1 AND (l.value->>'released') = 'false'
      AND l.id <> '${WINDOW_LEASE_ID}' ${after}
    ORDER BY (l.value->>'expiresAt'), l.id LIMIT ${limit}
  ), mapped AS (
    SELECT p.id, p.value AS lease, p.expires_at, t.value AS task, a.attempts
    FROM page p LEFT JOIN cp_route_tasks_history t ON t.id = p.id
    LEFT JOIN LATERAL (
      SELECT coalesce(jsonb_agg(x.value), '[]'::jsonb) AS attempts
      FROM (SELECT value FROM cp_attempts
            WHERE value->>'leaseId' = p.value->>'id'
            ORDER BY id LIMIT 2) x
    ) a ON true
  )
  SELECT c.total,
    coalesce(jsonb_agg(jsonb_build_object('leaseKey', m.id, 'lease', m.lease,
      'expiresAt', m.expires_at, 'task', m.task, 'attempts', m.attempts)
      ORDER BY m.expires_at, m.id) FILTER (WHERE m.id IS NOT NULL), '[]'::jsonb) AS items
  FROM active_count c LEFT JOIN mapped m ON true GROUP BY c.total`;
}

function canonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function object(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function array(value: unknown): readonly unknown[] | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return Array.isArray(value) ? value : null;
}
function count(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }

/** Mapping never upgrades a lease alone to an Attempt or a completed civic result. */
export function mapActiveClaim(raw: unknown, nowIso: string): ActiveWorkClaim {
  const row = object(raw);
  const leaseKey = text(row?.leaseKey) ?? "";
  const lease = object(row?.lease) as (ExecutionLease & Record<string, unknown>) | null;
  const task = object(row?.task) as (RouteTask & Record<string, unknown>) | null;
  const attempts = array(row?.attempts);
  const leaseId = text(lease?.id);
  const routeTaskId = text(lease?.routeTaskId);
  const expiresAt = text(lease?.expiresAt);
  const base = { leaseKey, leaseId, routeTaskId, workItemId: text(task?.workItemId),
    attemptId: null, workerRole: null, expiresAt };
  const bad = (reason: string): ActiveWorkClaim => ({ ...base, state: "UNVERIFIED", reason });
  if (!leaseKey || leaseKey === WINDOW_LEASE_ID || !leaseId || routeTaskId !== leaseKey ||
    !expiresAt || !canonicalInstant(expiresAt) || Date.parse(expiresAt) <= Date.parse(nowIso) || lease?.released !== false ||
    !task || task.id !== leaseKey || task.state !== "CLAIMED" || !text(task.workItemId) || attempts === null)
    return bad("ACTIVE_CLAIM_LINK_UNVERIFIED");
  if (attempts.length === 0) return { ...base, state: "CLAIMED_NO_ATTEMPT", reason: null };
  if (attempts.length !== 1) return bad("MULTIPLE_ATTEMPTS_FOR_LEASE");
  const attempt = object(attempts[0]) as (Attempt & Record<string, unknown>) | null;
  if (!attempt || attempt.leaseId !== leaseId || attempt.routeTaskId !== leaseKey ||
    attempt.workItemId !== task.workItemId || !text(attempt.id) || !text(attempt.worker?.role))
    return bad("ATTEMPT_LEASE_LINK_UNVERIFIED");
  const linked = { ...base, attemptId: attempt.id, workerRole: attempt.worker.role };
  if (attempt.endedAt !== null || attempt.outcome !== null)
    return { ...linked, state: "ENDED_ATTEMPT", reason: "Lease remains but this Attempt has ended; it is not running." };
  return { ...linked, state: "RUNNING_ATTEMPT", reason: null };
}

/** Fails unavailable before an unindexed Attempt join; no `.list()` fallback. */
export function pgActiveWorkClaimReader(sql: Sql): ActiveWorkClaimReader {
  return { ...pgRunningJobReader(sql), ...pgStateProgressReader(sql), async readPage(input) {
    if (!canonicalInstant(input.nowIso)) throw new Error("INVALID_ACTIVE_CLAIM_TIME");
    const limit = input.limit ?? ACTIVE_CLAIM_PAGE_MAX;
    if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVE_CLAIM_PAGE_MAX ||
      (input.cursor && (!canonicalInstant(input.cursor.expiresAt) || !text(input.cursor.leaseKey))))
      throw new Error("INVALID_ACTIVE_CLAIM_PAGE");
    const index = await boundedQuery(sql, { operation: "cp_leases.activeClaimIndexes", callClass: "POINT" },
      ACTIVE_CLAIM_INDEX_CHECK_SQL) as readonly Record<string, unknown>[];
    const attemptIndex = Array.isArray(index) ? index.find(row => row.name === "cp_attempts_lease_id") : null;
    const leaseIndex = Array.isArray(index) ? index.find(row => row.name === "cp_leases_expiry") : null;
    if (!attemptIndex || attemptIndex.valid !== true || !String(attemptIndex.indexdef).includes("leaseId") ||
      !leaseIndex || leaseIndex.valid !== true || !String(leaseIndex.indexdef).includes("expiresAt"))
      return unavailableActiveWorkClaims("ACTIVE_CLAIM_INDEX_NOT_READY").readPage(input);
    const cursor = input.cursor ?? null;
    const params = cursor ? [input.nowIso, cursor.expiresAt, cursor.leaseKey, limit + 1]
      : [input.nowIso, limit + 1];
    const result = await boundedQuery(sql, { operation: "cp_leases.activeWorkClaims", callClass: "PAGE" },
      activeClaimPageSql(cursor !== null), params) as readonly Record<string, unknown>[];
    if (!Array.isArray(result) || result.length !== 1) throw new Error("ACTIVE_CLAIM_READ_INVALID");
    const total = count(result[0].total);
    const items = array(result[0].items);
    if (total === null || items === null || items.length > limit + 1)
      throw new Error("ACTIVE_CLAIM_READ_INVALID");
    const hasMore = items.length > limit;
    const visible = items.slice(0, limit);
    const rows = visible.map(row => mapActiveClaim(row, input.nowIso));
    const last = object(visible.at(-1));
    const nextCursor = hasMore && last && text(last.expiresAt) && text(last.leaseKey)
      ? { expiresAt: String(last.expiresAt), leaseKey: String(last.leaseKey) } : null;
    if (hasMore && !nextCursor) throw new Error("ACTIVE_CLAIM_CURSOR_INVALID");
    return { available: true, reason: null, asOf: input.nowIso, totalActiveClaims: total,
      rows, hasMore, nextCursor,
      runningAttemptCount: cursor === null && !hasMore && rows.length === total &&
        rows.every(row => row.state !== "UNVERIFIED")
        ? rows.filter(row => row.state === "RUNNING_ATTEMPT").length : null };
  } };
}
