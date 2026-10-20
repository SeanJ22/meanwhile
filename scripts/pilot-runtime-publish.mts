import { neon } from "@neondatabase/serverless";
import { boundedQuery } from "../lib/control-plane/repository/request-bounds.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

// These are the inputs of readControlPlane/readAllAssignmentSources. The
// publisher's owner/readiness snapshots and MapTiler digests are outputs, and
// the runner's liveness beat is read directly by Admin, not by this join.
const AGGREGATES = ["work_items", "route_tasks", "attempts", "leases",
  "obligations", "occurrences", "debts", "admin_config", "ask_gap_observations", "doors"];
const LOGS = ["artifacts", "costs", "scout_results", "worker_results", "promotion_pipeline"];

export const CONSOLE_INPUT_SQL = `SELECT md5(jsonb_build_array(
  ${AGGREGATES.map(name => `(SELECT COALESCE(jsonb_agg(jsonb_build_array(id, revision) ORDER BY id), '[]'::jsonb) FROM cp_${name})`).join(",\n  ")},
  ${LOGS.map(name => `(SELECT jsonb_build_array(count(*), max(position)) FROM cp_log_${name})`).join(",\n  ")},
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

// Pointer versions cover readiness's operational references and the public
// readback inputs. Confirmation events can change source-through without a
// new pointed candidate; include the event population too, never its bodies.
export const CONSOLE_READER_INPUT_SQL = `SELECT md5(jsonb_build_array(
  (SELECT COALESCE(jsonb_agg(jsonb_build_array(key, current_version_id, promoted_at) ORDER BY key), '[]'::jsonb) FROM civic_data_promotions),
  (SELECT COALESCE(jsonb_agg(jsonb_build_array(scope, version) ORDER BY scope), '[]'::jsonb) FROM fact_watermark),
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

/** No durable marker or clock: only a fully successful publish is reusable. */
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
    // A partially written failed publish also invalidates the previous result.
    published = null;
    if (!await input.publish()) return "FAILED";
    // Capture BEFORE publishing: a concurrent commit still differs next time.
    published = before;
    return "PUBLISHED";
  };
}
