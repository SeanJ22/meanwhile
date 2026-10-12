/**
 * The newest verified result in one state: a pipeline item that reached APPROVED_FOR_PROMOTION, or a
 * Validator PASS / Auditor SURVIVED worker result. The SQL applies the `stateOfSubject` pattern and the
 * caller re-checks the subject. Null when there is none.
 */
import { stateOfSubject } from "../expansion/subjects.ts";
import { boundedQuery } from "./request-bounds.ts";
import type { Sql } from "./pg-store.ts";

export interface StateProgress {
  readonly at: string;
  readonly kind: "PROMOTION" | "WORKER_RESULT";
  readonly subject: string;
  /** PROMOTION: the record class. WORKER_RESULT: the worker role. */
  readonly detail: string | null;
}
export interface StateProgressPage {
  readonly available: boolean;
  readonly reason: string | null;
  readonly progress: StateProgress | null;
}
export interface StateProgressReader {
  readLatestStateProgress(input: { readonly state: string }): Promise<StateProgressPage>;
}

export function unavailableStateProgress(reason = "STATE_PROGRESS_UNAVAILABLE"): StateProgressReader {
  return { async readLatestStateProgress() { return { available: false, reason, progress: null }; } };
}

/** The `stateOfSubject` rule as one case-insensitive-by-lowering pattern. `state` is two letters, checked by the caller. */
export function stateSubjectPattern(state: string): string {
  return `^(?:ballot-${state}[-:]|${state}[:-]|ocd-division/country:us/(?:state|district|territory):${state}(?:/|$))`;
}

export const STATE_PROMOTION_SQL = `
SELECT r.record->>'at' AS at, s.record->>'subjectId' AS subject, s.record->>'recordClass' AS detail
FROM cp_log_promotion_pipeline r
JOIN cp_log_promotion_pipeline s ON s.log_key = r.log_key AND s.record->>'stage' = 'SCOUTED'
WHERE r.record->>'stage' = 'APPROVED_FOR_PROMOTION' AND lower(s.record->>'subjectId') ~ $1
ORDER BY r.record->>'at' DESC LIMIT 1`;

export const STATE_WORKER_RESULT_SQL = `
SELECT r.record->>'endedAt' AS at, w.value->>'subject' AS subject, r.record->'result'->>'role' AS detail
FROM cp_log_worker_results r
JOIN cp_work_items w ON w.id = r.log_key
WHERE ((r.record->'result'->>'role' = 'VALIDATOR' AND r.record->'result'->>'verdict' = 'PASS')
    OR (r.record->'result'->>'role' = 'ADVERSARIAL_AUDITOR' AND r.record->'result'->>'verdict' = 'SURVIVED'))
  AND lower(w.value->>'subject') ~ $1
ORDER BY r.record->>'endedAt' DESC LIMIT 1`;

const clock = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

function pick(kind: StateProgress["kind"], rows: unknown, state: string): StateProgress | null {
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("STATE_PROGRESS_READ_INVALID");
  const row = rows[0] as { at?: unknown; subject?: unknown; detail?: unknown } | undefined;
  if (row === undefined) return null;
  if (!clock(row.at) || typeof row.subject !== "string" || stateOfSubject(row.subject)?.toLowerCase() !== state) throw new Error("STATE_PROGRESS_ROW_INVALID");
  return { at: row.at, kind, subject: row.subject, detail: typeof row.detail === "string" ? row.detail : null };
}

export function pgStateProgressReader(sql: Sql): StateProgressReader {
  return { async readLatestStateProgress(input) {
    if (!/^[a-z]{2}$/.test(input.state)) throw new Error("INVALID_STATE_PROGRESS_STATE");
    const pattern = stateSubjectPattern(input.state);
    const [promotion, result] = await Promise.all([
      boundedQuery(sql, { operation: "cp_log_promotion_pipeline.latestInState", callClass: "PAGE" }, STATE_PROMOTION_SQL, [pattern]),
      boundedQuery(sql, { operation: "cp_log_worker_results.latestInState", callClass: "PAGE" }, STATE_WORKER_RESULT_SQL, [pattern]),
    ]);
    const found = [pick("PROMOTION", promotion, input.state), pick("WORKER_RESULT", result, input.state)]
      .filter((p): p is StateProgress => p !== null).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { available: true, reason: null, progress: found[0] ?? null };
  } };
}
