import { REGISTRY_STATES, type BallotState } from "../civic-data/state-scopes.ts";

export interface FundingTargetPlan {
  readonly contestId: string | null;
  readonly federal: boolean;
  readonly state: BallotState | null;
  readonly ballotIdentity: boolean;
}

export const FEDERAL_CONTEST = /:(?:us-house(?:-[^:|]+)?|us-senate|president)(?=[:|]|$)/;

function contestIdFromBallotTarget(target: string): string | null {
  if (!target.startsWith("ballot-")) return null;
  if (target.includes("|")) return target.split("|", 1)[0]!;
  const last = target.lastIndexOf(":");
  return last > 0 ? target.slice(0, last) : null;
}

export function stateFromContest(contestId: string | null): BallotState | null {
  if (!contestId || FEDERAL_CONTEST.test(contestId)) return null;
  const code = /^ballot-([a-z]{2})-/.exec(contestId)?.[1]?.toUpperCase() as BallotState | undefined;
  return code && REGISTRY_STATES.includes(code) ? code : null;
}

/** Exact source-namespaced targets select their authority without another store. */
export function directFundingTargetPlan(target: string): FundingTargetPlan {
  const contestId = contestIdFromBallotTarget(target);
  const nativeState = /^state-finance:([A-Z]{2}):/.exec(target)?.[1] as BallotState | undefined;
  const state = stateFromContest(contestId) ?? (nativeState && REGISTRY_STATES.includes(nativeState) ? nativeState : null);
  return {
    contestId,
    federal: target.startsWith("congress:") || /^(?:fec:)?(?:[HS]\d[A-Z]{2}\d{5}|P\d{8})$/.test(target) || (contestId !== null && FEDERAL_CONTEST.test(contestId)),
    state,
    ballotIdentity: target.includes("|"),
  };
}
