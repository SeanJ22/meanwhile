import type { Query } from "../facts/publish.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { stateBallotContractId, stateBallotScope } from "./state-scopes.ts";
import type { DerivedInputRef } from "./derived-authority.ts";
import { externalDerivedSourceInputs } from "./derived-source-hash.ts";
import { DERIVED_CAMPAIGN_SITES_RECORD_CLASS, derivedCampaignSitesScope } from "./derived-campaign-sites.ts";
import type { RoutineDataStore } from "./store.ts";
import type { CandidateLinksShape } from "./derived-campaign-sites.ts";

/** Source identifiers, hashes and revisions only; page bodies and stored candidate profiles stay in the database. */
export const CAMPAIGN_SOURCE_INPUTS_SQL = `WITH approvals AS MATERIALIZED (
  SELECT record FROM cp_log_promotion_pipeline
  WHERE record->>'stage'='APPROVED_FOR_PROMOTION' AND upper(record#>>'{campaignSite,identity,stateCode}')=$1
), scouts AS MATERIALIZED (
  SELECT record FROM cp_log_promotion_pipeline
  WHERE record->>'stage'='SCOUTED' AND record->>'recordClass'='candidate-enrichment'
    AND cp_control_state(record) IN (lower($1),'system')
), relevant_artifacts AS MATERIALIZED (
  SELECT a.record FROM cp_log_artifacts a
  WHERE a.record->>'artifactId' IN (
    SELECT record#>>'{campaignSite,evidence,artifactId}' FROM approvals
    UNION SELECT record#>>'{campaignSite,evidence,cycleSource,artifactId}' FROM approvals)
  UNION SELECT a.record FROM cp_work_items_history w JOIN cp_log_artifacts a ON a.record->>'workItemId'=w.id
  WHERE w.value->>'subject' IN (SELECT 'candidate-publication:' || (record#>>'{campaignSite,candidacyId}') FROM approvals)
), artifacts AS MATERIALIZED (
  SELECT a.record,t.id AS attempt_id,t.revision AS attempt_revision,w.revision AS work_revision,
    coalesce(t.value->>'completedAt',to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),a.record->>'recordedAt') AS at
  FROM relevant_artifacts a JOIN cp_attempts t ON t.id=a.record->>'attemptId'
  JOIN cp_work_items_history w ON w.id=a.record->>'workItemId'
), inputs AS (
  SELECT jsonb_build_object('kind','PIPELINE_APPROVAL','itemId',record->>'itemId','recordId',record->>'recordId','approvedAt',record->>'at') AS input FROM approvals
  UNION ALL SELECT jsonb_build_object('kind','DISCOVERY_ATTEMPT','attemptId',record->>'scoutAttemptId','recordId',record->>'recordId','recordedAt',record->>'at') FROM scouts
  UNION ALL SELECT jsonb_build_object('kind','VAULTED_EVIDENCE','artifactId',record->>'artifactId','contentHash',record->>'contentHash',
    'tier',record->>'tier','retrievedAt',record->>'recordedAt') FROM artifacts WHERE record->>'tier' IN ('RAW','SANITIZED_DERIVED')
  UNION ALL SELECT jsonb_build_object('kind','DISCOVERY_ATTEMPT','attemptId',attempt_id,'recordId',record->>'artifactId',
    'revision',attempt_revision,'workItemRevision',work_revision,'recordedAt',at) FROM artifacts
) SELECT input FROM inputs ORDER BY input::text`;

export async function readCampaignSourceInputs(store: Pick<RoutineDataStore, "readSourceHead">, state: string, query: Query): Promise<DerivedInputRef[]> {
  const profiles = requiredManualProductionContract(stateBallotContractId("candidate-profiles", state));
  const pointers = [{ recordClass: profiles.recordClass, scope: profiles.scope },
    { recordClass: "BALLOT_CANDIDACY" as const, scope: stateBallotScope("ballot-contests", state) }];
  const heads = await Promise.all(pointers.map(pointer => store.readSourceHead(pointer.recordClass, pointer.scope)));
  const promoted: DerivedInputRef[] = heads.flatMap(head => head?.normalizedHash && head.candidateState === "PROMOTED" ? [{
    kind: "PROMOTED_VERSION" as const, recordClass: head.recordClass, scope: head.scope, versionId: head.versionId,
    readModelSha256: head.normalizedHash, promotedAt: head.promotedAt,
  }] : []);
  const rows = await query(CAMPAIGN_SOURCE_INPUTS_SQL, [state.toUpperCase()]);
  const control = rows.map(row => (typeof row.input === "string" ? JSON.parse(row.input) : row.input) as DerivedInputRef);
  return externalDerivedSourceInputs([...promoted, ...control], { recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS, scope: derivedCampaignSitesScope(state) });
}

/** Campaign derivation consumes the profile's links, never its saved text or the other profile fields. */
export async function readCampaignProfileLinks(store: Pick<RoutineDataStore, "readSourceHead" | "readCandidatePath">, state: string) {
  try {
  const profiles = requiredManualProductionContract(stateBallotContractId("candidate-profiles", state));
  const head = await store.readSourceHead(profiles.recordClass, profiles.scope);
  if (!head) return null;
  if (head.candidateState !== "PROMOTED" || !head.normalizedHash) return { unreadable: "The current candidate-profile source has no promoted content hash." };
  const links = await store.readCandidatePath<Readonly<Record<string, CandidateLinksShape>>>(head.versionId, ["readModel", "links"]);
  return { input: { kind: "PROMOTED_VERSION" as const, recordClass: head.recordClass, scope: head.scope,
    versionId: head.versionId, readModelSha256: head.normalizedHash, promotedAt: head.promotedAt }, links: links ?? {} };
  } catch (error) { return { unreadable: error instanceof Error ? error.message : String(error) }; }
}
