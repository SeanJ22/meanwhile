import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { reduceSourceReliability, type SourceReliability, type SourceReliabilityRow } from "../scheduler/scout-reliability.ts";

/** The dispatcher's own reducer, so Admin and the runner never disagree about a source's backoff. */
export const ADMIN_V6_RELIABILITY_CONTRACT = "admin-v6/reliability@1" as const;
export const RELIABILITY_LIMIT = 30;

export const RELIABILITY_SQL = `SELECT r.record->'result'->'source'->>'url' AS url, r.record->'result'->>'verdict' AS verdict,
  a.value->>'endedAt' AS ended_at,
  COALESCE((SELECT array_agg(left(b->>'description', 240)) FROM jsonb_array_elements(COALESCE(r.record->'result'->'blockers', '[]'::jsonb)) b), ARRAY[]::text[]) AS blocker_text,
  COALESCE((SELECT array_agg(b->>'code') FROM jsonb_array_elements(COALESCE(r.record->'result'->'blockers', '[]'::jsonb)) b WHERE b->>'code' IS NOT NULL), ARRAY[]::text[]) AS blocker_codes
  FROM cp_log_worker_results r JOIN cp_attempts a ON a.id = r.record->>'attemptId'
  WHERE r.record->'result'->>'role' = 'ACQUIRER' AND COALESCE((r.record->'result'->>'requestCount')::int, 0) > 0
    AND a.value->>'outcome' = 'COMPLETED' AND a.value->>'endedAt' IS NOT NULL AND r.record->'result'->'source'->>'url' ~ '^https?://'`;

/** Structurally `SourceReliabilityRow` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6SourceReliability extends SourceReliability { readonly state: "failing" | "recovering" | "healthy" }

export function reliabilityView(rows: readonly SourceReliabilityRow[]): readonly AdminV6SourceReliability[] {
  return reduceSourceReliability(rows)
    .map((s): AdminV6SourceReliability => ({ ...s, state: s.consecutiveFailures > 0 ? "failing" : s.failures > 0 ? "recovering" : "healthy" }))
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures || b.failures - a.failures || a.source.localeCompare(b.source))
    .slice(0, RELIABILITY_LIMIT);
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

export async function readReliability(sql: Sql): Promise<readonly AdminV6SourceReliability[]> {
  const raw = await boundedQuery(sql, { operation: "cp_log_worker_results.source_reliability", callClass: "PAGE" }, RELIABILITY_SQL, []) as readonly Record<string, unknown>[];
  return reliabilityView(raw.map((r): SourceReliabilityRow => ({ url: String(r.url), verdict: String(r.verdict ?? ""), endedAt: String(r.ended_at),
    blockerText: strings(r.blocker_text), blockerCodes: strings(r.blocker_codes) })));
}
