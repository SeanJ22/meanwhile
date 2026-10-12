import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "./data-plane.ts";

export interface FundingTargetPlan {
  readonly contestId: string | null;
  readonly federal: boolean;
  readonly state: StateCampaignFinanceJurisdiction | null;
  readonly azIdentity: boolean;
}

export const FEDERAL_CONTEST = /:(?:us-house(?:-[^:|]+)?|us-senate|president)(?=[:|]|$)/;

function contestIdFromBallotTarget(target: string): string | null {
  if (!target.startsWith("ballot-")) return null;
  if (target.includes("|")) return target.split("|", 1)[0]!;
  const last = target.lastIndexOf(":");
  return last > 0 ? target.slice(0, last) : null;
}

export function stateFromContest(contestId: string | null): StateCampaignFinanceJurisdiction | null {
  if (!contestId || FEDERAL_CONTEST.test(contestId)) return null;
  const code = /^ballot-([a-z]{2})-/.exec(contestId)?.[1]?.toUpperCase() as StateCampaignFinanceJurisdiction | undefined;
  return code && Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, code) ? code : null;
}

/** Exact source-namespaced targets select their authority without another store. */
export function directFundingTargetPlan(target: string): FundingTargetPlan {
  const contestId = contestIdFromBallotTarget(target);
  const nativeState = /^state-finance:([A-Z]{2}):/.exec(target)?.[1] as StateCampaignFinanceJurisdiction | undefined;
  const state = stateFromContest(contestId) ?? (nativeState && Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, nativeState) ? nativeState : null);
  return {
    contestId,
    federal: target.startsWith("congress:") || /^fec:[HS]\d[A-Z]{2}\d{5}$/.test(target) || (contestId !== null && FEDERAL_CONTEST.test(contestId)),
    state,
    azIdentity: state === "AZ" && target.includes("|"),
  };
}
