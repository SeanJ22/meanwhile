import type { RoutineSourceContract } from "./contracts.ts";
import type { CandidateState } from "./types.ts";

export interface DeploymentBoundaryInput {
  readonly requested: string;
  readonly meetingManifest: string;
  readonly nowMs: number;
}

/**
 * One explicit deployment boundary owns the whole live-acceptance run.
 * Operator-supplied evidence and the exhaustive meeting manifest must agree
 * exactly; a merely parseable or future instant cannot establish post-deploy
 * execution.
 */
export function deploymentBoundaryIssue(input: DeploymentBoundaryInput): string | null {
  const requestedMs = Date.parse(input.requested);
  const manifestMs = Date.parse(input.meetingManifest);
  if (
    !Number.isFinite(requestedMs) ||
    new Date(requestedMs).toISOString() !== input.requested
  ) return "DEPLOYMENT_COMPLETED_AT_NOT_CANONICAL_ISO";
  if (
    !Number.isFinite(manifestMs) ||
    new Date(manifestMs).toISOString() !== input.meetingManifest
  ) return "MEETING_MANIFEST_DEPLOYMENT_COMPLETED_AT_NOT_CANONICAL_ISO";
  if (input.requested !== input.meetingManifest) {
    return "DEPLOYMENT_COMPLETED_AT_DISAGREES_WITH_MEETING_MANIFEST";
  }
  if (!Number.isFinite(input.nowMs) || requestedMs > input.nowMs) {
    return "DEPLOYMENT_COMPLETED_AT_IS_FUTURE";
  }
  return null;
}

export interface PostDeploymentGoodEvidenceInput {
  readonly contractId: string;
  readonly deploymentCompletedAt: string;
  /** Store-observed first append-only event, never a publisher-claimed source timestamp. */
  readonly attemptedAt: string;
  readonly promotedAt: string;
}

/** Every accepted GOOD version must have both its durable attempt and promotion on or after the deployment boundary. */
export function postDeploymentGoodEvidenceIssue(
  input: PostDeploymentGoodEvidenceInput,
): string | null {
  const boundaryMs = Date.parse(input.deploymentCompletedAt);
  const attemptedMs = Date.parse(input.attemptedAt);
  const promotedMs = Date.parse(input.promotedAt);
  if (!input.contractId.trim()) return "CONTRACT_ID_MISSING";
  if (
    !Number.isFinite(boundaryMs) ||
    new Date(boundaryMs).toISOString() !== input.deploymentCompletedAt
  ) return "DEPLOYMENT_COMPLETED_AT_INVALID";
  if (
    !Number.isFinite(attemptedMs) ||
    new Date(attemptedMs).toISOString() !== input.attemptedAt
  ) return `${input.contractId}:ATTEMPTED_AT_INVALID`;
  if (
    !Number.isFinite(promotedMs) ||
    new Date(promotedMs).toISOString() !== input.promotedAt
  ) return `${input.contractId}:PROMOTED_AT_INVALID`;
  if (attemptedMs < boundaryMs) return `${input.contractId}:ATTEMPT_PREDATES_DEPLOYMENT`;
  if (promotedMs < boundaryMs) return `${input.contractId}:PROMOTION_PREDATES_DEPLOYMENT`;
  if (promotedMs < attemptedMs) return `${input.contractId}:PROMOTION_PREDATES_ATTEMPT`;
  return null;
}

export type RoutineLiveAcceptanceDisposition =
  | {
      readonly kind: "POST_DEPLOY_NEW_GOOD";
      readonly acceptedStates: readonly ["PROMOTED"];
      readonly pointerRequirement: "NEW_GOOD_WITH_PRIOR_GOOD";
    }
  | {
      readonly kind: "AUTHENTICATED_FAIL_CLOSED_ATTEMPT";
      readonly acceptedStates: readonly ["SOURCE_BLOCKED", "HORIZON_UNRESOLVED"];
      readonly pointerRequirement: "UNCHANGED_LKG_OR_NOT_RECORDED";
    };

/** Canonical deterministic proof disposition for one registered routine contract. */
export function routineLiveAcceptanceDisposition(
  contract: Pick<RoutineSourceContract, "liveAcceptance">,
): RoutineLiveAcceptanceDisposition {
  if (contract.liveAcceptance?.kind === "AUTHENTICATED_FAIL_CLOSED_ATTEMPT") {
    return {
      kind: contract.liveAcceptance.kind,
      acceptedStates: contract.liveAcceptance.acceptedStates,
      pointerRequirement: "UNCHANGED_LKG_OR_NOT_RECORDED",
    };
  }
  return {
    kind: "POST_DEPLOY_NEW_GOOD",
    acceptedStates: ["PROMOTED"],
    pointerRequirement: "NEW_GOOD_WITH_PRIOR_GOOD",
  };
}

export function routineLiveAcceptanceStateIssue(
  contract: Pick<RoutineSourceContract, "id" | "liveAcceptance">,
  state: CandidateState,
): string | null {
  const disposition = routineLiveAcceptanceDisposition(contract);
  return (disposition.acceptedStates as readonly CandidateState[]).includes(state)
    ? null
    : `${contract.id}:LIVE_ACCEPTANCE_STATE_${state}_NOT_ALLOWED_FOR_${disposition.kind}`;
}

/** A held/unavailable attempt is live evidence only when its first durable event is post-deploy. */
export function postDeploymentAttemptEvidenceIssue(input: {
  readonly contractId: string;
  readonly deploymentCompletedAt: string;
  readonly attemptedAt: string;
}): string | null {
  const boundaryMs = Date.parse(input.deploymentCompletedAt);
  const attemptedMs = Date.parse(input.attemptedAt);
  if (!input.contractId.trim()) return "CONTRACT_ID_MISSING";
  if (!Number.isFinite(boundaryMs) || new Date(boundaryMs).toISOString() !== input.deploymentCompletedAt) {
    return "DEPLOYMENT_COMPLETED_AT_INVALID";
  }
  if (!Number.isFinite(attemptedMs) || new Date(attemptedMs).toISOString() !== input.attemptedAt) {
    return `${input.contractId}:ATTEMPTED_AT_INVALID`;
  }
  return attemptedMs < boundaryMs ? `${input.contractId}:ATTEMPT_PREDATES_DEPLOYMENT` : null;
}
