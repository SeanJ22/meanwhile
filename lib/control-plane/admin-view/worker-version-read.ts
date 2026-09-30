/** Bounded version evidence for the Workers update card.
 *
 * A saved cycle proves which SHA executed for that cycle. It does not prove the
 * currently loaded process, so a mismatch is never silently called a pending
 * update and a matching old cycle is never called current adoption.
 */
import { canonicalInstant } from "../../civic-data/routine-due-request.ts";
import { DIGEST_LOG_KEY } from "../admin-data.ts";
import type { RunnerHeartbeat } from "../owner-surface.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { Sql } from "../repository/pg-store.ts";

const SHA = /^[0-9a-f]{40}$/;
const INDEX_NAME = "cp_log_owner_digests_cycle_kind_position";

export interface SavedCycleVersion {
  readonly digestId: string;
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly writtenAt: string;
  readonly testedSha: string | null;
  readonly state: "SUCCEEDED" | "FAILED";
}
export interface LatestCycleVersionRead {
  readonly available: boolean;
  readonly reason: string | null;
  readonly cycle: SavedCycleVersion | null;
}
export interface LatestCycleVersionReader {
  read(): Promise<LatestCycleVersionRead>;
}

export const LATEST_CYCLE_INDEX_CHECK_SQL = `
SELECT x.indisvalid AS valid, pg_get_indexdef(i.oid) AS indexdef
FROM pg_class i JOIN pg_index x ON x.indexrelid = i.oid
JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = current_schema() AND t.relname = 'cp_log_owner_digests'
  AND i.relname = '${INDEX_NAME}' LIMIT 1`;

export const LATEST_CYCLE_VERSION_SQL = `
SELECT record #>> '{digestId}' AS digest_id,
  record #>> '{writtenAt}' AS written_at,
  record #>> '{runtimeOutcome,cycleId}' AS cycle_id,
  record #>> '{runtimeOutcome,startedAt}' AS started_at,
  record #>> '{runtimeOutcome,finishedAt}' AS finished_at,
  record #>> '{runtimeOutcome,testedSha}' AS tested_sha,
  record #>> '{runtimeOutcome,state}' AS state
FROM cp_log_owner_digests
WHERE log_key = $1 AND record #>> '{runtimeOutcome,kind}' = 'FRESHNESS_CYCLE'
ORDER BY position DESC LIMIT 1`;

function validSha(value: unknown): value is string { return typeof value === "string" && SHA.test(value); }
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

/** No unindexed reverse scan or heartbeat fallback. Missing evidence is unknown. */
export function pgLatestCycleVersionReader(sql: Sql): LatestCycleVersionReader {
  return { async read() {
    const indexes = await boundedQuery(sql, { operation: "cp_log_owner_digests.cycleVersionIndex", callClass: "POINT" },
      LATEST_CYCLE_INDEX_CHECK_SQL) as readonly Record<string, unknown>[];
    const index = Array.isArray(indexes) && indexes.length === 1 ? indexes[0] : null;
    if (!index || index.valid !== true || !String(index.indexdef).includes("runtimeOutcome,kind") ||
      !String(index.indexdef).includes("position"))
      return { available: false, reason: "CYCLE_VERSION_INDEX_NOT_READY", cycle: null };
    const rows = await boundedQuery(sql, { operation: "cp_log_owner_digests.latestCycleVersion", callClass: "POINT" },
      LATEST_CYCLE_VERSION_SQL, [DIGEST_LOG_KEY]) as readonly Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length > 1) throw new Error("CYCLE_VERSION_READ_INVALID");
    if (rows.length === 0) return { available: true, reason: "NO_SAVED_CYCLE", cycle: null };
    const row = rows[0];
    if (!nonempty(row.digest_id) || !nonempty(row.cycle_id) || !canonicalInstant(row.started_at) ||
      !canonicalInstant(row.finished_at) || !canonicalInstant(row.written_at) ||
      Date.parse(row.finished_at) < Date.parse(row.started_at) || Date.parse(row.written_at) < Date.parse(row.finished_at) ||
      (row.tested_sha !== null && !validSha(row.tested_sha)) ||
      (row.state !== "SUCCEEDED" && row.state !== "FAILED"))
      return { available: false, reason: "LATEST_CYCLE_IDENTITY_INVALID", cycle: null };
    return { available: true, reason: null, cycle: {
      digestId: row.digest_id, cycleId: row.cycle_id, startedAt: row.started_at,
      finishedAt: row.finished_at, writtenAt: row.written_at, testedSha: row.tested_sha, state: row.state,
    } };
  } };
}

export interface WorkerVersionReading {
  readonly servedSha: string | null;
  readonly lastExecutedSha: string | null;
  readonly lastCycleAt: string | null;
  readonly lastCycleDigestId: string | null;
  readonly versionRelation: "MATCH_LAST_CYCLE" | "DIFFERS_FROM_LAST_CYCLE" | "UNKNOWN";
  /** Current process adoption is not derivable from a stale retained heartbeat. */
  readonly updatePending: boolean | null;
  readonly adoptionObservedAt: string | null;
  readonly nextAdoptionPath: string | null;
  readonly missingParts: readonly string[];
}

/** The caller must supply the SHA from the server actually serving this view. */
export function workerVersionReading(input: {
  readonly servedSha: string | null;
  readonly latest: LatestCycleVersionRead;
  readonly heartbeat: RunnerHeartbeat | null;
}): WorkerVersionReading {
  const servedSha = validSha(input.servedSha) ? input.servedSha : null;
  const cycle = input.latest.available ? input.latest.cycle : null;
  const lastExecutedSha = cycle && validSha(cycle.testedSha) ? cycle.testedSha : null;
  const relation = servedSha && lastExecutedSha
    ? servedSha === lastExecutedSha ? "MATCH_LAST_CYCLE" : "DIFFERS_FROM_LAST_CYCLE" : "UNKNOWN";
  const missingParts: string[] = [];
  if (!servedSha) missingParts.push("SERVED_BUILD_SHA_UNKNOWN");
  if (!input.latest.available) missingParts.push(input.latest.reason ?? "LATEST_CYCLE_UNREADABLE");
  else if (!cycle) missingParts.push("NO_SAVED_CYCLE");
  else if (!lastExecutedSha) missingParts.push("CYCLE_TESTED_SHA_UNKNOWN");
  // Version comes from the saved execution and normal heartbeat, without an adoption receipt.
  // Neither clock records the instant the process switched code.
  return {
    servedSha, lastExecutedSha, lastCycleAt: cycle?.finishedAt ?? null,
    lastCycleDigestId: cycle?.digestId ?? null, versionRelation: relation,
    updatePending: null, adoptionObservedAt: null,
    nextAdoptionPath: servedSha && relation === "DIFFERS_FROM_LAST_CYCLE"
      ? "The permanent runner supports release-handoff at a normal quiescent boundary, followed by supervisor relaunch. Whether this process has that mode enabled or a handoff scheduled is not saved here."
      : null,
    missingParts,
  };
}
