import { parseStateBallotContractId, requireBallotState, stateBallotContractId } from "../ballot/state-scopes.ts";

export const campaignPublicationTask = (state: string) => stateBallotContractId("candidate-campaign-sites-derived", state);

export interface CampaignPublicationInputs {
  readonly state: string;
  readonly approvals: number;
  readonly attemptedApprovals: number;
}

export async function readCampaignPublicationInputs(state: string, query: (sql: string, params: unknown[]) => Promise<unknown>, testedSha: string | null = null): Promise<CampaignPublicationInputs> {
  const selected = requireBallotState(state);
  if (testedSha !== null && !/^[0-9a-f]{40}$/.test(testedSha)) throw new Error("CAMPAIGN_PUBLICATION_CODE_INVALID");
  const rows = await query(`SELECT
    (SELECT count(*) FROM cp_log_promotion_pipeline WHERE record->>'stage' = 'APPROVED_FOR_PROMOTION'
      AND upper(record#>>'{campaignSite,identity,stateCode}')=$2)::text AS approvals,
    (SELECT coalesce(max((record->'runtimeOutcome'->'campaignPublicationApprovalsByState'->>$2)::bigint), 0)
      FROM cp_log_owner_digests WHERE record->'runtimeOutcome'->>'kind' = 'ROUTINE_CIVIC_DATA_SUPERVISOR'
      AND ($1::text IS NULL OR record->'runtimeOutcome'->>'testedSha' = $1))::text AS attempted`, [testedSha, selected]);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("CAMPAIGN_PUBLICATION_INPUTS_INVALID");
  const approvals = Number(rows[0]?.approvals), attemptedApprovals = Number(rows[0]?.attempted);
  if (![approvals, attemptedApprovals].every(value => Number.isSafeInteger(value) && value >= 0) || attemptedApprovals > approvals) throw new Error("CAMPAIGN_PUBLICATION_INPUTS_INVALID");
  return { state: selected, approvals, attemptedApprovals };
}

export function campaignPublicationInputsDue(taskId: string, inputs: CampaignPublicationInputs | null): boolean {
  const target = parseStateBallotContractId(taskId);
  return target?.family === "candidate-campaign-sites-derived" && inputs !== null && target.state === inputs.state && inputs.approvals > inputs.attemptedApprovals;
}
