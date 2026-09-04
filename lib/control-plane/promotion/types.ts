/**
 * THE VERIFICATION PIPELINE — the typed path a finding travels before the
 * nightly window may promote it. (RULING 242.)
 *
 *   SCOUTED -> CONFIRMED -> VERIFIED -> AUDITED -> APPROVED_FOR_PROMOTION
 *   or REFUSED at any stage, with its reasons.
 *
 * Invariants every record here carries:
 *
 *   NO LAYER CERTIFIES ITSELF   the actor of a transition is never the actor
 *                               of the stage before it (SELF_CERTIFICATION)
 *   PROSE NEVER CONFIRMS PROSE  CONFIRMED needs artifacts vaulted by a
 *                               different Attempt than the Scout's, and never
 *                               by a SCOUT-role Attempt
 *   A CHECK THAT DID NOT RUN    is NOT_IMPLEMENTED, which refuses VERIFIED;
 *                               there is no silent pass
 *   AN UNMEASURED SCORE         is null, which refuses AUDITED; never zero
 *   REFUSAL IS A RECORD         appended to the same log, with the offered
 *                               transition kept beside the reasons
 */

import type { WorkerRole } from "../attempt.ts";
import type { AuditEvidenceBase } from "../audit.ts";
import type { ExecutorKind } from "../scheduler/dispatch.ts";
import type { ControlScore } from "../../health/control-fact.ts";

export const PROMOTION_PIPELINE_FORMAT_VERSION = 1;

export const PIPELINE_STAGES = [
  "SCOUTED",
  "CONFIRMED",
  "VERIFIED",
  "AUDITED",
  "APPROVED_FOR_PROMOTION",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The stage each stage follows. SCOUTED follows nothing. */
export const PRECEDING_STAGE: Readonly<Record<PipelineStage, PipelineStage | null>> = {
  SCOUTED: null,
  CONFIRMED: "SCOUTED",
  VERIFIED: "CONFIRMED",
  AUDITED: "VERIFIED",
  APPROVED_FOR_PROMOTION: "AUDITED",
};

export const PIPELINE_REFUSALS = [
  /** The offered stage does not follow the item's current stage. */
  "STAGE_OUT_OF_ORDER",
  /** The item already holds a DIFFERENT accepted record at the offered stage. */
  "STAGE_ALREADY_REACHED",
  /** The actor equals the previous stage's actor. */
  "SELF_CERTIFICATION",
  /** A CONFIRMED record cites no artifact. */
  "CONFIRMATION_WITHOUT_ARTIFACT",
  /** A cited artifact is not in the artifact log. */
  "CONFIRMATION_ARTIFACT_UNKNOWN",
  /** A cited artifact was vaulted by the Scout's own Attempt. */
  "CONFIRMATION_SAME_ATTEMPT",
  /** A cited artifact was vaulted by a SCOUT-role Attempt. */
  "CONFIRMATION_BY_SCOUT_ROLE",
  /** A cited artifact's Attempt is not in the attempts aggregate, so its role cannot be read. */
  "CONFIRMATION_ATTEMPT_UNKNOWN",
  /** A second acquisition cites an artifact at a different canonical URL. */
  "CONFIRMATION_URL_MISMATCH",
  /** A second route names no fact it shares with the scouted one. */
  "CONFIRMATION_SECOND_ROUTE_UNNAMED",
  /** A required verification check is absent from the record. */
  "VERIFICATION_CHECK_MISSING",
  /** A verification check FAILED. */
  "VERIFICATION_CHECK_FAILED",
  /** A verification check could not run; it is NOT_IMPLEMENTED, never a pass. */
  "VERIFICATION_CHECK_NOT_IMPLEMENTED",
  /** The auditor is the Scout or the validator (same role and instance). */
  "AUDIT_NOT_INDEPENDENT",
  /** The audit started from nothing independent of our own summary. */
  "AUDIT_STARTING_POINT_NOT_INDEPENDENT",
  /** The batch carried no injected controls; scores are NOT MEASURED. */
  "AUDIT_CONTROLS_NOT_MEASURED",
  /** The auditor broke the claim. */
  "AUDIT_DID_NOT_SURVIVE",
  /** The approval names a chain record the log does not hold. */
  "APPROVAL_CHAIN_INCOMPLETE",
  "WORKER_RESULT_NOT_VERIFIED",
  "WORKER_AUDIT_BLOCKS_PROMOTION",
] as const;
export type PipelineRefusalCode = (typeof PIPELINE_REFUSALS)[number];

export interface PipelineRefusalReason {
  readonly code: PipelineRefusalCode;
  readonly detail: string;
}

/**
 * Who performed a transition. Two actors are THE SAME when role and instance
 * both match; that equality is what SELF_CERTIFICATION is decided on.
 */
export interface PipelineActor {
  readonly role: WorkerRole;
  readonly lane: ExecutorKind | "SESSION";
  /** Process, worker, or Attempt handle. Unique per invocation. */
  readonly instance: string;
}

export function sameActor(a: PipelineActor, b: PipelineActor): boolean {
  return a.instance === b.instance;
}

interface RecordBase {
  readonly formatVersion: typeof PROMOTION_PIPELINE_FORMAT_VERSION;
  readonly recordId: string;
  readonly itemId: string;
  readonly at: string;
  readonly actor: PipelineActor;
}

/** Where a SCOUTED item came from. Both are existing evidence, mapped — never invented. */
export type ScoutedSource =
  | {
      readonly kind: "SCOUT_RESULT";
      readonly attemptId: string;
      readonly obligationId: string;
      readonly outcome: "ROUTE_CANDIDATE" | "EVIDENCE_FOUND";
      /** The candidate's routeId, or null for a finding. */
      readonly routeId: string | null;
    }
  | {
      readonly kind: "METHOD_CANDIDATE";
      readonly candidateId: string;
      readonly attemptId: string;
      readonly lifecycle: "PROPOSED" | "VALIDATED";
      readonly routeId: string;
    };

export interface ScoutedRecord extends RecordBase {
  readonly stage: "SCOUTED";
  readonly source: ScoutedSource;
  readonly recordClass: string;
  readonly subjectId: string;
  /** The representation the Scout showed. Null when the finding names no URL. */
  readonly canonicalUrl: string | null;
  /** Artifacts the Scout's own Attempt vaulted for this finding. */
  readonly artifactIds: readonly string[];
  readonly scoutAttemptId: string;
  readonly summary: string;
}

export type ConfirmationBasis = "SECOND_ACQUISITION" | "SECOND_ROUTE";

export interface ConfirmedRecord extends RecordBase {
  readonly stage: "CONFIRMED";
  readonly basis: ConfirmationBasis;
  readonly confirmingArtifactIds: readonly string[];
  /** For SECOND_ROUTE: the fact both representations establish. Null for SECOND_ACQUISITION. */
  readonly sameFact: string | null;
}

export const VERIFICATION_CHECKS = [
  "CLAIM_RESOLVES_TO_SOURCE_SPAN",
  "CANONICAL_IDENTITY_UNIQUE",
  "ASSERTION_CLASS_BURDENS",
  "NEUTRALITY_AND_RENDERING_SYMMETRY",
  "FALSE_ZERO",
] as const;
export type VerificationCheckName = (typeof VERIFICATION_CHECKS)[number];

export type VerificationResult = "PASS" | "FAIL" | "NOT_IMPLEMENTED";

export interface VerificationCheck {
  readonly name: VerificationCheckName;
  readonly result: VerificationResult;
  readonly detail: string;
}

export interface VerifiedRecord extends RecordBase {
  readonly workerResultId?: string;
  readonly stage: "VERIFIED";
  readonly checks: readonly VerificationCheck[];
}

export interface AuditedRecord extends RecordBase {
  readonly workerResultId?: string;
  readonly stage: "AUDITED";
  readonly startedFrom: readonly AuditEvidenceBase[];
  readonly survived: boolean;
  /** Null is NOT MEASURED, and refuses. Never a zero standing in for a measurement. */
  readonly controls: ControlScore | null;
  readonly findings: readonly string[];
}

export interface ApprovedRecord extends RecordBase {
  readonly stage: "APPROVED_FOR_PROMOTION";
  readonly chain: {
    readonly scouted: string;
    readonly confirmed: string;
    readonly verified: string;
    readonly audited: string;
  };
  readonly recordClass: string;
}

export interface RefusedRecord extends RecordBase {
  readonly stage: "REFUSED";
  readonly atStage: PipelineStage;
  readonly reasons: readonly PipelineRefusalReason[];
  /** The transition that was offered, kept verbatim. */
  readonly offered: TransitionRecord;
}

export type TransitionRecord =
  | ScoutedRecord
  | ConfirmedRecord
  | VerifiedRecord
  | AuditedRecord
  | ApprovedRecord;

export type PromotionPipelineRecord = TransitionRecord | RefusedRecord;

/** The accepted record at each stage, by stage. */
export interface StageRecordMap {
  SCOUTED?: ScoutedRecord;
  CONFIRMED?: ConfirmedRecord;
  VERIFIED?: VerifiedRecord;
  AUDITED?: AuditedRecord;
  APPROVED_FOR_PROMOTION?: ApprovedRecord;
}

/**
 * The derived state of one item, replayed from its records in append order.
 *
 * A refusal refuses an OFFERED transition, never the item: the furthest
 * accepted stage stands, and a later offer that meets its burdens is decided
 * on its own. `refused` is the most recent refusal, kept for the reader.
 */
export interface PipelineItemState {
  readonly itemId: string;
  readonly recordClass: string | null;
  readonly subjectId: string | null;
  /** The furthest stage reached. Null when the item has no accepted record. */
  readonly stage: PipelineStage | null;
  readonly refused: RefusedRecord | null;
  readonly refusals: number;
  readonly records: readonly PromotionPipelineRecord[];
  readonly byStage: StageRecordMap;
}

/* --------------------------------------------------------------- window */

export const WINDOW_FORMAT_VERSION = 1;

export const WINDOW_TRIGGERS = ["RUNNER_CLOCK", "CATCH_UP", "WAKEUP", "MANUAL"] as const;
export type WindowTrigger = (typeof WINDOW_TRIGGERS)[number];

export const WINDOW_STAGES = [
  "LEGACY_REFRESH",
  "PIPELINE_EVALUATION",
  "POST_PROMOTION_VERIFICATION",
  "DIGEST",
] as const;
export type WindowStageName = (typeof WINDOW_STAGES)[number];

export type WindowStageOutcome = "COMPLETED" | "FAILED" | "SKIPPED";

export interface WindowStageRecord {
  readonly stage: WindowStageName;
  readonly outcome: WindowStageOutcome;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** The named reason on FAILED or SKIPPED. Null on COMPLETED. */
  readonly reason: string | null;
}

export const WINDOW_VERDICTS = ["PROMOTE_WOULD", "REFUSE_WOULD", "DEFER"] as const;
export type WindowVerdict = (typeof WINDOW_VERDICTS)[number];

export interface ItemVerdict {
  readonly itemId: string;
  readonly recordClass: string;
  readonly stage: PipelineStage | null;
  readonly verdict: WindowVerdict;
  readonly reason: string;
}

export interface RecordClassTally {
  readonly recordClass: string;
  readonly items: number;
  readonly promoteWould: number;
  readonly refuseWould: number;
  readonly deferred: number;
}

export interface WindowIncident {
  readonly formatVersion: typeof WINDOW_FORMAT_VERSION;
  readonly incidentId: string;
  readonly windowId: string;
  readonly stage: WindowStageName | "LOCK" | "PROMOTION";
  readonly code: string;
  readonly detail: string;
  readonly openedAt: string;
  /** What the next window must catch up, by name. */
  readonly missedScope: readonly string[];
}

export interface LegacySourceOutcome {
  readonly id: string;
  readonly due: boolean;
  readonly ran: boolean;
  readonly outcome: "INGESTED" | "UNCHANGED" | "ROUTE_UNREAD" | "NOT_DUE" | "UNKNOWN";
  readonly reason: string;
  readonly governs: readonly string[];
  readonly changedPaths: readonly string[];
  readonly recoveredFrom: readonly string[];
  readonly nextDueAt: string | null;
}

export interface LegacyRefreshReading {
  /** JSON is Lane A's contract; MARKDOWN_FALLBACK parses docs/refresh-run.md's table. */
  readonly source: "JSON" | "MARKDOWN_FALLBACK";
  readonly runDate: string | null;
  readonly exitCode: number | null;
  readonly sources: readonly LegacySourceOutcome[];
}

export interface WindowLockFacts {
  readonly leaseId: string;
  readonly holder: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly releasedAt: string | null;
}

export interface ActivationGateReading {
  readonly promotionEnabled: false;
  readonly mode: "SHADOW";
  readonly openRecordClasses: readonly string[];
  readonly contracts: Readonly<Record<"READER" | "TRUTH" | "FRESHNESS", string>>;
  readonly independentlyReproduced: boolean;
  /** Where the contract states were read from, by path. Null when nothing could be read. */
  readonly readFrom: string | null;
  readonly reason: string;
}

export interface WindowRunRecord {
  readonly formatVersion: typeof WINDOW_FORMAT_VERSION;
  readonly windowId: string;
  /** The America/New_York calendar date this window answers for. */
  readonly localDate: string;
  readonly zone: string;
  readonly scheduledFor: string;
  readonly trigger: WindowTrigger;
  readonly mode: "SHADOW";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly host: string;
  readonly testedSha: string | null;
  readonly provider: string;
  /** Local dates no window answered for since the last one, oldest first. */
  readonly caughtUp: readonly string[];
  readonly lock: WindowLockFacts;
  readonly activationGate: ActivationGateReading;
  readonly stages: readonly WindowStageRecord[];
  readonly legacyRefresh: LegacyRefreshReading | null;
  readonly pipeline: {
    readonly items: number;
    readonly byStage: Readonly<Record<PipelineStage, number>>;
    readonly refused: number;
    readonly verdicts: readonly ItemVerdict[];
    readonly byRecordClass: readonly RecordClassTally[];
  };
  /** Always 0 in SHADOW. */
  readonly promoted: number;
  readonly postPromotionVerification: {
    readonly instrument: string;
    readonly asIfPromoted: true;
    readonly exitCode: number | null;
    readonly verdict: string;
    readonly detail: string;
  } | null;
  readonly controls: ControlScore | null;
  readonly incidents: readonly WindowIncident[];
  readonly digestPath: string | null;
  readonly mirrored: boolean | null;
  readonly recordPath: string | null;
}

export const WINDOW_INTENT_ACTIONS = ["RUN_WINDOW_NOW"] as const;
export type WindowIntentAction = (typeof WINDOW_INTENT_ACTIONS)[number];

export type WindowIntent =
  | {
      readonly formatVersion: typeof WINDOW_FORMAT_VERSION;
      readonly kind: "INTENT";
      readonly intentId: string;
      readonly action: WindowIntentAction;
      readonly requestedAt: string;
      readonly actor: string;
    }
  | {
      readonly formatVersion: typeof WINDOW_FORMAT_VERSION;
      readonly kind: "HONORED";
      readonly intentId: string;
      readonly honors: string;
      readonly action: WindowIntentAction;
      readonly honoredAt: string;
      readonly honoredBy: string;
      readonly detail: string;
    };
