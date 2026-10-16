import { BALLOT_STATES, parseStateBallotContractId, requireBallotState, stateBallotContractId } from "./state-scopes.ts";
import { CANDIDATE_PROFILE_LEAD } from "../facts/finding-slots.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { RoutineSourceTask } from "./runner.ts";

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

type Query = (sql: string, params: unknown[]) => Promise<unknown>;
const findingStates = `WITH waiting AS MATERIALIZED (
  SELECT id,value->>'subjectId' subject,value->>'lastRecordedAt' requested_at,value->'origins' origins
  FROM cp_box_findings WHERE value->>'state'='waiting' AND value#>>'{waitingFor,reason}'=$1),
  origins AS MATERIALIZED (SELECT w.id,o->>'workItemId' work_id FROM waiting w,LATERAL jsonb_array_elements(w.origins) a(o)),
  scopes AS (
    SELECT o.id,COALESCE(
      (regexp_match(upper(w.value#>>'{autonomousPlan,contract,jurisdiction,state}'),'^(?:US-)?([A-Z]{2})$'))[1],
      (regexp_match(upper(w.value#>>'{autonomousPlan,jurisdiction}'),'^(?:US-)?([A-Z]{2})$'))[1]) state
    FROM origins o JOIN cp_work_items w ON w.id=o.work_id
    UNION ALL
    SELECT o.id,upper((regexp_match(division,'^ocd-division/country:us/state:([a-z]{2})(?:/|$)'))[1]) state
    FROM origins o JOIN cp_occurrences c ON c.value->>'workItemId'=o.work_id
    JOIN cp_obligations b ON b.id=c.value->>'obligationId'
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.value->'scopeDivisions','[]')) a(division)),
  bound AS (SELECT DISTINCT w.id,w.subject,w.requested_at,s.state FROM waiting w LEFT JOIN scopes s ON s.id=w.id AND s.state=ANY($2::text[]))`;

export async function readCandidateProfilePublicationTasks(query: Query, now: string): Promise<{ readonly tasks: readonly RoutineSourceTask[]; readonly unscoped: number }> {
  const rows = await query(`${findingStates} SELECT state,count(DISTINCT id)::int findings,min(requested_at) requested_at
    FROM bound GROUP BY state ORDER BY state`, [CANDIDATE_PROFILE_LEAD, BALLOT_STATES]) as { state: string | null; findings: number; requested_at: string | null }[];
  let unscoped = 0;
  const tasks = rows.flatMap(row => {
    if (row.state === null) { unscoped += Number(row.findings); return []; }
    const contract = requiredManualProductionContract(stateBallotContractId("candidate-profiles", requireBallotState(row.state)));
    return [{ id: `candidate-findings:${contract.id}`, registeredContractId: contract.id,
      sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      acquisitionFailureDomain: `candidate-findings:${contract.scope}`, requestedUrl: "", authorityMode: "REGISTERED_SOURCE_ROUTES" as const,
      parserVersion: contract.parserNormalizerVersion, command: [...contract.command, "--candidate-findings"],
      cadenceMs: Number.POSITIVE_INFINITY, retryMs: 15 * 60_000,
      contract: { readerProjection: contract.readerProjection, cadence: { description: "Publish waiting verified candidate findings", defaultEveryMs: Number.POSITIVE_INFINITY } },
      ownerInvocation: { publicationPending: true as const, requestedAt: row.requested_at ?? now, instructions: ["section3-publication"] } }];
  });
  return { tasks, unscoped };
}

export async function readCandidateProfileFindingBatch(state: string, query: Query): Promise<readonly { readonly id: string; readonly subject: string }[]> {
  return await query(`${findingStates} SELECT DISTINCT id,subject FROM bound WHERE state=$3 ORDER BY id LIMIT 500`,
    [CANDIDATE_PROFILE_LEAD, BALLOT_STATES, requireBallotState(state)]) as { id: string; subject: string }[];
}
