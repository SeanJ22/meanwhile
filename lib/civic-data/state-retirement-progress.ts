import { REGISTRY_STATES, stateBallotContractId, stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "./manual-contracts.ts";
import { requiredRoutineContract } from "./contracts.ts";
import type { StateRetirementOrigin } from "./state-retirement-inputs.ts";
import type { StateRetirementEvidence } from "./types.ts";

export interface RetirementProofTarget {
  origin_version: string; origin_class: string; origin_scope: string; origin_hash: string;
  state: string; contract_id: string; record_class: string; scope: string; source_id: string;
}
export function retirementProofTarget(contractId: string, origin: Pick<StateRetirementEvidence["origin"], "versionId" | "recordClass" | "scope" | "readModelHash">): RetirementProofTarget {
  const contract = contractId.startsWith("candidate-campaign-sites-derived:") ? requiredRoutineContract(contractId)
    : requiredManualProductionContract(contractId as ManualProductionContractId);
  const state = contractId.split(":")[1];
  if (!REGISTRY_STATES.some(value => value === state)) throw Error(`STATE_RETIREMENT_TARGET_INVALID:${contractId}`);
  return { origin_version: origin.versionId, origin_class: origin.recordClass, origin_scope: origin.scope, origin_hash: origin.readModelHash,
    state, contract_id: contractId, record_class: contract.recordClass, scope: contract.scope, source_id: contract.sourceId };
}
export function retirementTargets(origins: readonly StateRetirementOrigin[]): RetirementProofTarget[] {
  return origins.flatMap(origin => {
    const legacy = origin.family === "ballot-contests" && origin.scope !== "US:state-election-ballots" ? /^US-([A-Z]{2}):/.exec(origin.scope)?.[1] : null;
    return (legacy ? [legacy] : REGISTRY_STATES).map(state => retirementProofTarget(origin.family === "registry-runtime"
      ? stateRegistryRuntimeContractId(state) : stateBallotContractId(origin.family, state), {
      versionId: origin.versionId, recordClass: origin.recordClass, scope: origin.scope, readModelHash: origin.hash }));
  });
}

/** A promoted proof survives later ordinary state publications. No payload or separate completion ledger is read. */
export const STATE_RETIREMENT_PROGRESS_SQL = `WITH expected AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS e(origin_version text,origin_class text,origin_scope text,origin_hash text,
    state text,contract_id text,record_class text,scope text,source_id text)
) SELECT e.origin_version,e.state, EXISTS (
  SELECT 1 FROM civic_data_promotions p JOIN civic_data_candidates current ON current.id=p.current_version_id
  WHERE p.key=e.record_class || ':' || e.scope AND p.source_id=e.source_id
    AND p.current_version_id=p.last_known_good_version_id AND p.validation_receipt->>'decision'='GOOD'
    AND current.state='PROMOTED' AND current.acquisition_succeeded AND current.promoted_version_id=current.id
    AND current.last_known_good_version_id=current.id AND current.source_id=e.source_id
    AND current.record_class=e.record_class AND current.scope=e.scope AND current.validation_receipt=p.validation_receipt
    AND p.payload=current.candidate->'readModel' AND current.normalized_hash ~ '^[a-f0-9]{64}$'
    AND p.validation_receipt->>'candidateId'=current.id AND p.validation_receipt->>'sourceId'=e.source_id
    AND p.validation_receipt->>'recordClass'=e.record_class AND p.validation_receipt->>'scope'=e.scope
) AND EXISTS (
  SELECT 1 FROM civic_data_candidates c
  CROSS JOIN LATERAL (SELECT reader_payload_node(c.candidate->'stateRetirement') AS proof) saved
  CROSS JOIN LATERAL (SELECT reader_payload_node(saved.proof->'origin') AS origin) original
  WHERE c.record_class=e.record_class AND c.scope=e.scope AND c.source_id=e.source_id
    AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND c.validation_receipt->>'decision'='GOOD' AND c.candidate ? 'stateRetirement'
    AND saved.proof->>'kind'='STATE_AUTHORITY_RETIREMENT' AND saved.proof->>'contractId'=e.contract_id
    AND saved.proof->>'state'=e.state AND saved.proof->>'readModelHash'=c.normalized_hash
    AND original.origin->>'versionId'=e.origin_version AND original.origin->>'recordClass'=e.origin_class
    AND original.origin->>'scope'=e.origin_scope AND original.origin->>'readModelHash'=e.origin_hash
) AS complete FROM expected e`;

export async function readRetirementProgress(query: (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>, targets: readonly RetirementProofTarget[]): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const complete = new Map<string, Set<string>>();
  if (!targets.length) return complete;
  const rows = await query(STATE_RETIREMENT_PROGRESS_SQL, [JSON.stringify(targets)]);
  if (rows.length !== targets.length) throw Error("STATE_RETIREMENT_PROGRESS_UNREAD");
  for (const row of rows) {
    if (typeof row.complete !== "boolean" || !targets.some(target => target.origin_version === row.origin_version && target.state === row.state)) throw Error("STATE_RETIREMENT_PROGRESS_INVALID");
    if (row.complete) { const states = complete.get(String(row.origin_version)) ?? new Set<string>(); states.add(String(row.state)); complete.set(String(row.origin_version), states); }
  }
  return complete;
}
