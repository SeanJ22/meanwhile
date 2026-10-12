/**
 * SCOUTED -> CONFIRMED -> VERIFIED -> AUDITED -> APPROVED_FOR_PROMOTION, or REFUSED at any stage.
 * The actor of a transition is never the actor of the stage before it, and a refusal is appended as a record.
 */

import type { WorkerRole } from "../attempt.ts";
import type { AuditEvidenceBase } from "../audit.ts";
import type { ExecutorKind } from "../scheduler/dispatch.ts";

export const PROMOTION_PIPELINE_FORMAT_VERSION = 1;

export const PIPELINE_STAGES = [
  "SCOUTED",
  "CONFIRMED",
  "VERIFIED",
  "AUDITED",
  "APPROVED_FOR_PROMOTION",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PRECEDING_STAGE: Readonly<Record<PipelineStage, PipelineStage | null>> = {
  SCOUTED: null,
  CONFIRMED: "SCOUTED",
  VERIFIED: "CONFIRMED",
  AUDITED: "VERIFIED",
  APPROVED_FOR_PROMOTION: "AUDITED",
};

export const PIPELINE_REFUSALS = [
  "STAGE_OUT_OF_ORDER",
  "STAGE_ALREADY_REACHED",
  "SELF_CERTIFICATION",
  "CONFIRMATION_WITHOUT_ARTIFACT",
  "CONFIRMATION_ARTIFACT_UNKNOWN",
  "CONFIRMATION_SAME_ATTEMPT",
  "CONFIRMATION_BY_SCOUT_ROLE",
  "CONFIRMATION_ATTEMPT_UNKNOWN",
  "CONFIRMATION_URL_MISMATCH",
  "CONFIRMATION_SECOND_ROUTE_UNNAMED",
  /** The confirming acquisition states a different fact about the same meeting; the item holds. */
  "CONFIRMATION_FACT_CONFLICT",
  "VERIFICATION_CHECK_MISSING",
  "VERIFICATION_CHECK_FAILED",
  /** A verification check could not run; it is NOT_IMPLEMENTED, never a pass. */
  "VERIFICATION_CHECK_NOT_IMPLEMENTED",
  "AUDIT_NOT_INDEPENDENT",
  "AUDIT_STARTING_POINT_NOT_INDEPENDENT",
  /** The batch carried no injected controls; scores are NOT MEASURED. */
  "AUDIT_CONTROLS_NOT_MEASURED",
  "AUDIT_DID_NOT_SURVIVE",
  "APPROVAL_CHAIN_INCOMPLETE",
  /** A deterministic approval burden beyond the chain (freshness, currency, measured controls, checks) failed. */
  "APPROVAL_BURDEN_FAILED",
  "WORKER_RESULT_NOT_VERIFIED",
  "WORKER_AUDIT_BLOCKS_PROMOTION",
] as const;
export type PipelineRefusalCode = (typeof PIPELINE_REFUSALS)[number];

export interface PipelineRefusalReason {
  readonly code: PipelineRefusalCode;
  readonly detail: string;
}

/** Two actors are the same when their instance matches; SELF_CERTIFICATION is decided on that. */
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

export type ScoutedSource =
  | {
      readonly kind: "SCOUT_RESULT";
      readonly attemptId: string;
      readonly obligationId: string;
      readonly outcome: "ROUTE_CANDIDATE" | "EVIDENCE_FOUND";
      readonly routeId: string | null;
    }
  | {
      readonly kind: "METHOD_CANDIDATE";
      readonly candidateId: string;
      readonly attemptId: string;
      readonly lifecycle: "PROPOSED" | "VALIDATED";
      readonly routeId: string;
    }
  | {
      /** One civic fact from a completed extraction chain. The item is the fact, not the artifact. */
      readonly kind: "FLEET_EXTRACTION";
      readonly workItemId: string;
      /** The Attempt that acquired the artifact — the actor the SCOUTED record names, and what activity views join on. */
      readonly attemptId: string;
      readonly parserResultId: string;
      readonly artifactId: string;
      readonly extractedRecordId: string;
      /** `<meetingId>@<startsAt>` for a meeting time; `<meetingId>#agenda@<urlHash>` for an agenda. */
      readonly factKey: string;
      readonly sourceRecordClass: string;
      /** `<sourceId>:<publisherSlug>` — the feed the fact came from, for freshness grouping. */
      readonly sourceKey: string;
      readonly applicableAt: string;
    }
  | {
      /** A pointer a discovery route returned: a lead, never a record, confirmed only by reading the pointed origin. */
      readonly kind: "DISCOVERY_POINTER";
      readonly routeId: string;
      readonly attemptId: string;
      readonly artifactId: string;
      /** The pointed URL, exactly as the index returned it. */
      readonly pointerUrl: string;
      /** 1-based position in the index's answer. */
      readonly rank: number;
    };

export interface ScoutedRecord extends RecordBase {
  readonly stage: "SCOUTED";
  readonly source: ScoutedSource;
  readonly recordClass: string;
  readonly subjectId: string;
  /** The representation the Scout showed. Null when the finding names no URL. */
  readonly canonicalUrl: string | null;
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
  /** Whether the confirming acquisition states the same fact; absent on records written before the field existed. */
  readonly factAgreement?: { readonly sameFact: boolean; readonly detail: string };
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

export interface ControlFact {
  readonly statement: string;
  readonly expected_truth:
    | { readonly kind: "value"; readonly subject: string; readonly value: string | number | boolean }
    | { readonly kind: "predicate"; readonly predicate: string; readonly args: Readonly<Record<string, string | number | boolean>> }
    | { readonly kind: "proposition"; readonly proposition: string };
  readonly accepted_forms?: readonly string[];
  readonly fact_class: "known_present" | "known_absence";
  readonly verification_source: string;
  readonly verified_by: string;
  readonly verified_date: string;
  readonly authority?: string;
  readonly period?: string;
  readonly verified_through?: string;
}

export interface ControlObservation {
  readonly statement: string;
  readonly observed: "FACT_STATED" | "GAP_NAMED" | "ABSENCE_ASSERTED";
}

/** Every rate's denominator is explicit; a null rate means an empty denominator. */
export interface ControlScore {
  readonly knownPresentCount: number;
  readonly knownAbsenceCount: number;
  readonly recalled: number;
  readonly absencesRecalled: number;
  readonly falseAbsences: number;
  readonly falsePresences: number;
  readonly unobserved: number;
  readonly recall: number | null;
  readonly falseAbsenceRate: number | null;
  readonly falsePresenceRate: number | null;
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

/** Burdens measured when an approval is offered and kept on the record; a FAIL refuses as APPROVAL_BURDEN_FAILED. */
export const APPROVAL_BURDENS = [
  "CHAIN_CHECKS_PASS",
  "CONTROLS_MEASURED_CLEAN",
  "FACT_CURRENT",
  "FRESHNESS_NOT_STALE",
  /** The record class is one the fact chain implements. */
  "RECORD_CLASS_CANDIDATE",
] as const;
export type ApprovalBurdenName = (typeof APPROVAL_BURDENS)[number];

export interface ApprovalBurden {
  readonly name: ApprovalBurdenName;
  readonly result: "PASS" | "FAIL";
  readonly detail: string;
}

export interface ApprovedRecord extends RecordBase {
  readonly stage: "APPROVED_FOR_PROMOTION";
  readonly chain: {
    readonly scouted: string;
    readonly confirmed: string;
    readonly verified: string;
    readonly audited?: string;
  };
  readonly recordClass: string;
  /** Absent on approvals written before the burdens existed. */
  readonly burdens?: readonly ApprovalBurden[];
  /** The one field of the class this approval is for (`campaignSite`). */
  readonly field?: string;
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

export interface StageRecordMap {
  SCOUTED?: ScoutedRecord;
  CONFIRMED?: ConfirmedRecord;
  VERIFIED?: VerifiedRecord;
  AUDITED?: AuditedRecord;
  APPROVED_FOR_PROMOTION?: ApprovedRecord;
}

/** A refusal refuses an offered transition, never the item: the furthest accepted stage stands. */
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

export const WINDOW_FORMAT_VERSION = 1;

export const WINDOW_TRIGGERS = ["RUNNER_CLOCK", "CATCH_UP", "WAKEUP", "MANUAL"] as const;
export type WindowTrigger = (typeof WINDOW_TRIGGERS)[number];

export const WINDOW_STAGES = [
  "PIPELINE_EVALUATION",
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
  readonly stage: WindowStageName | "LOCK";
  readonly code: string;
  readonly detail: string;
  readonly openedAt: string;
  readonly missedScope: readonly string[];
}

export interface WindowLockFacts {
  readonly leaseId: string;
  readonly holder: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly releasedAt: string | null;
}

export interface ActivationGateReading {
  /** True only while at least one record class is open. */
  readonly promotionEnabled: boolean;
  readonly mode: "SHADOW";
  readonly openRecordClasses: readonly string[];
  /** Within an open class, the only fields that may be approved. */
  readonly openFields?: Readonly<Record<string, readonly string[]>>;
  readonly contracts: Readonly<Record<"READER" | "TRUTH" | "FRESHNESS", string>>;
  readonly independentlyReproduced: boolean;
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
  readonly pipeline: {
    readonly items: number;
    readonly byStage: Readonly<Record<PipelineStage, number>>;
    readonly refused: number;
    readonly verdicts: readonly ItemVerdict[];
    readonly byRecordClass: readonly RecordClassTally[];
  };
  readonly researchProgression?: import("../research-progression.ts").ResearchWindowProgression;
  /** Always 0 in SHADOW. */
  readonly promoted: number;
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
