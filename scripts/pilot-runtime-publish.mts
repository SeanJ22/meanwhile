import { ADMIN_SECTION_TABLES } from "../lib/control-plane/repository/admin-config.ts";
import { neon } from "@neondatabase/serverless";
import { boundedQuery } from "../lib/control-plane/repository/request-bounds.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

const AGGREGATES = ["work_items", "route_tasks", "attempts", "leases",
  "obligations", "occurrences", "debts", "admin_config", "ask_gap_observations", "doors"];
const LOGS = ["artifacts", "costs", "scout_results", "worker_results", "promotion_pipeline", "research_intents", "window_intents", "admin_receipts"];

export const CONSOLE_INPUT_SQL = `SELECT md5(jsonb_build_array(
  ${AGGREGATES.map(name => `(SELECT COALESCE(jsonb_agg(jsonb_build_array(id, revision) ORDER BY id), '[]'::jsonb) FROM cp_${name})`).join(",\n  ")},
  ${LOGS.map(name => `(SELECT jsonb_build_array(count(*), max(position)) FROM cp_log_${name})`).join(",\n  ")},
  ${ADMIN_SECTION_TABLES.map(table=>`(SELECT jsonb_build_array(count(*),max(ordinal),max(updated_at)) FROM ${table})`).join(",\n  ")},
  (SELECT coalesce(jsonb_agg(jsonb_build_array(state,revision,applied_revision) ORDER BY state),'[]'::jsonb) FROM cp_planning_controls),
  (SELECT jsonb_build_array(count(*),max(changed_at)) FROM cp_hunt_orders),
  (SELECT COALESCE(value->'spendHolds', '{}'::jsonb) FROM cp_budget WHERE id = 'shared-budget-ledger'),
  (SELECT jsonb_build_array(count(*), max(changed_at)) FROM cp_spend_holds),
  (SELECT value->'metrics'->'cacheByRole' FROM cp_research_state WHERE id = 'level-1'),
  (SELECT ((value->'metrics'->'share') - 'window') || jsonb_build_object('window',
      (value->'metrics'->'share'->'window') - ARRAY['since','cycles'])
   FROM cp_research_state WHERE id = 'level-1'),
  (SELECT (record->'runtimeOutcome') - ARRAY['cycleId','startedAt','finishedAt']
   FROM cp_log_owner_digests WHERE log_key = 'owner-digest'
     AND record->'runtimeOutcome'->>'kind' = 'FRESHNESS_CYCLE'
   ORDER BY position DESC LIMIT 1)
)::text) AS signature`;

export const CONSOLE_READER_INPUT_SQL = `SELECT md5(jsonb_build_array(
  (SELECT COALESCE(jsonb_agg(jsonb_build_array(key, current_version_id, promoted_at) ORDER BY key), '[]'::jsonb) FROM civic_data_promotions),
  (SELECT COALESCE(jsonb_agg(jsonb_build_array(key, sequence, fact_sha256) ORDER BY key), '[]'::jsonb) FROM civic_data_reader_projections),
  (SELECT count(*) FROM civic_data_candidate_events
   WHERE candidate_id IN (SELECT current_version_id FROM civic_data_promotions))
)::text) AS signature`;

export function consoleInputReader(controlUrl: string, readerUrl: string, codeSha: string | null,
  options: { controlSql?: Sql; readerSql?: Sql } = {}): () => Promise<string> {
  const controlSql = options.controlSql ?? neon(controlUrl);
  const readerSql = options.readerSql ?? neon(readerUrl);
  return async () => {
    const rows = await Promise.all([
      boundedQuery(controlSql, { operation: "console.inputs", callClass: "POINT" }, CONSOLE_INPUT_SQL, []),
      boundedQuery(readerSql, { operation: "console.readerInputs", callClass: "POINT" }, CONSOLE_READER_INPUT_SQL, []),
    ]);
    const signatures = rows.map(result => (result as { signature?: unknown }[])[0]?.signature);
    if (signatures.some(signature => typeof signature !== "string" || signature.length === 0)) {
      throw new Error("CONSOLE_INPUTS_UNREADABLE");
    }
    return JSON.stringify([codeSha, ...signatures]);
  };
}

export function consolePublisher(input: {
  readInputs: () => Promise<string>;
  publish: () => Promise<boolean>;
  inputReadFailed?: (error: unknown) => void;
}) {
  let published: string | null = null;
  return async (): Promise<"UNCHANGED" | "PUBLISHED" | "FAILED"> => {
    let before: string | null = null;
    try { before = await input.readInputs(); }
    catch (error) { input.inputReadFailed?.(error); }
    if (before !== null && before === published) return "UNCHANGED";

    published = null;
    if (!await input.publish()) return "FAILED";

    published = before;
    return "PUBLISHED";
  };
}
