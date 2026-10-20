import { neon } from "@neondatabase/serverless";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { installConnectAttemptWindow } from "../ops/connect-attempt-window.ts";
import type { JurisdictionRegistry } from "../hunt/jurisdiction-universe.ts";
import { parseValidationReceipt } from "./receipt.ts";

/** Decode only this state's registry, including recursively partitioned payloads.
 * Neither the country's payload nor candidate evidence crosses the transport. */
export const OPERATIONAL_REFERENCE_STATE_SQL = `SELECT p.key, p.scope, p.source_id, p.current_version_id, p.last_known_good_version_id,
  p.validation_receipt - 'excludedFacts' || jsonb_build_object('excludedFacts', '[]'::jsonb) AS receipt,
  c.state, c.acquisition_succeeded, c.promoted_version_id, c.last_known_good_version_id AS candidate_lkg,
  c.record_class AS candidate_class, c.scope AS candidate_scope, c.source_id AS candidate_source,
  reader_payload_node(p.payload)->'formatVersion' AS format_version,
  reader_payload_node(p.payload)->>'sourceVersion' AS source_version,
  reader_payload_value(reader_payload_node(reader_payload_node(p.payload)->'registries')->$1::text) AS registry
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.record_class='OPERATIONAL_REFERENCE' AND p.scope=ANY($2::text[])`;

export async function readOperationalReferenceState(state: string, query?: ReadOnlyQuery): Promise<{
  readonly registry: JurisdictionRegistry | null;
  readonly versionId: string | null;
}> {
  const key = state.toLowerCase();
  if (!/^[a-z]{2}$/.test(key)) throw new Error(`OPERATIONAL_REFERENCE_STATE_INVALID:${state}`);
  if (!query) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("OPERATIONAL_REFERENCE_STORE_UNCONFIGURED");
    installConnectAttemptWindow();
    installDatabaseTransferCounter();
    const sql = neon(url);
    query = statements => sql.transaction(statements.map(statement => sql.query(statement.text, [...statement.params])), { readOnly: true });
  }
  const scopes = [...(key === "az" ? ["US-AZ:covered-jurisdiction-routing:v1"] : []), "US:covered-jurisdiction-routing:v1"];
  const started = performance.now();
  const [rows] = await query([{ text: OPERATIONAL_REFERENCE_STATE_SQL, params: [key, scopes] }]).catch(error => {
    let reason = error;
    for (let i = 0; i < 4; i++) {
      const nested = reason?.sourceError ?? reason?.cause;
      if (!nested) break;
      reason = nested;
    }
    const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    const timer = detail.includes("NEON_REQUEST_DEADLINE") ? "standing-neon-request-deadline"
      : detail.includes("READER_DATABASE_TIMEOUT") ? "reader-database-query-1800ms"
      : detail.includes("TimeoutError") ? "transport-timeout-unidentified" : "none";
    const failure = new Error(`OPERATIONAL_REFERENCE_STATE_READ_FAILED: database=reader state=${key} reads=${scopes.map(scope => `OPERATIONAL_REFERENCE:${scope}`).join(",")} timer=${timer} elapsedMs=${Math.round(performance.now() - started)} cause=${detail}`, { cause: error });
    failure.name = reason instanceof Error ? reason.name : "Error";
    throw failure;
  });
  for (const scope of scopes) {
    const row = rows.find(row => row.scope === scope);
    if (!row) continue;
    const receipt = parseValidationReceipt(row.receipt);
    const versionId = row.current_version_id;
    if (typeof versionId !== "string" || row.key !== `OPERATIONAL_REFERENCE:${scope}` ||
      row.last_known_good_version_id !== versionId || row.state !== "PROMOTED" || row.acquisition_succeeded !== true ||
      row.promoted_version_id !== versionId || row.candidate_lkg !== versionId || row.candidate_class !== "OPERATIONAL_REFERENCE" ||
      row.candidate_scope !== scope || row.candidate_source !== row.source_id || !receipt || receipt.decision !== "GOOD" ||
      receipt.candidateId !== versionId || receipt.recordClass !== "OPERATIONAL_REFERENCE" || receipt.scope !== scope || receipt.sourceId !== row.source_id ||
      row.format_version !== 1 || row.source_version !== "census-2022+reviewed-routing-v1") {
      throw new Error(`OPERATIONAL_REFERENCE_STATE_PROOF_INVALID:${key}:${scope}`);
    }
    if (row.registry !== null) return { registry: row.registry as JurisdictionRegistry, versionId };
  }
  return { registry: null, versionId: null };
}
