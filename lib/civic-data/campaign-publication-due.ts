/** A new complete approval brings the existing publication task forward.
 * This only changes admission: the normal derived door still rereads vaulted
 * bytes, validates every candidate and preserves the last good version. */
export const CAMPAIGN_PUBLICATION_TASK = "candidate-campaign-sites-derived";

export interface CampaignPublicationInputs {
  readonly approvals: number;
  readonly attemptedApprovals: number;
}

/** Count committed approvals, not caller timestamps: an older acquisition can
 * commit after a pass starts. An attempt acknowledges only its recorded code;
 * a repaired publisher must not inherit another code's failed attempt. */
export async function readCampaignPublicationInputs(query: (sql: string, params: unknown[]) => Promise<unknown>, testedSha: string | null = null): Promise<CampaignPublicationInputs> {
  if (testedSha !== null && !/^[0-9a-f]{40}$/.test(testedSha)) throw new Error("CAMPAIGN_PUBLICATION_CODE_INVALID");
  const rows = await query(`SELECT
    (SELECT count(*) FROM cp_log_promotion_pipeline WHERE record->>'stage' = 'APPROVED_FOR_PROMOTION' AND record->'campaignSite' IS NOT NULL)::text AS approvals,
    (SELECT coalesce(max((record->'runtimeOutcome'->>'campaignPublicationApprovalsAttempted')::bigint), 0)
      FROM cp_log_owner_digests WHERE record->'runtimeOutcome'->>'kind' = 'ROUTINE_CIVIC_DATA_SUPERVISOR'
      AND record->'runtimeOutcome'->>'campaignPublicationApprovalsAttempted' IS NOT NULL
      AND ($1::text IS NULL OR record->'runtimeOutcome'->>'testedSha' = $1))::text AS attempted`, [testedSha]);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("CAMPAIGN_PUBLICATION_INPUTS_INVALID");
  const approvals = Number(rows[0]?.approvals);
  const attemptedApprovals = Number(rows[0]?.attempted);
  if (![approvals, attemptedApprovals].every(value => Number.isSafeInteger(value) && value >= 0) || attemptedApprovals > approvals) throw new Error("CAMPAIGN_PUBLICATION_INPUTS_INVALID");
  return { approvals, attemptedApprovals };
}

export function campaignPublicationInputsDue(taskId: string, inputs: CampaignPublicationInputs | null): boolean {
  return taskId === CAMPAIGN_PUBLICATION_TASK && inputs !== null && inputs.approvals > inputs.attemptedApprovals;
}
