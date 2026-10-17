import type { CodeIdentity } from "./code-identity.ts";
import type { CacheCallerHealth, MeteringCounts, MonthlySpendView, SpendByPlaceView } from "./cost-panel.ts";
import type { ScoutCapacity } from "./research-metrics.ts";
import type { MapTilerUsageAttempt, MapTilerUsageSnapshot } from "./maptiler/types.ts";
import {
  intakeRuntimeObservationCycleId,
  parseIntakeRuntimeObservation,
  type IntakeRuntimeObservation,
  type IntakeRuntimeOutcome,
} from "../ops/intake-runtime.ts";
import {
  READER_PROJECTION_READBACK_PREFIX,
  parseReaderProjectionReadback,
  type ReaderProjectionReadbackReceipt,
} from "../civic-data/reader-readback.ts";
import type { RoutineRunnerReceipt } from "../civic-data/runner-receipt.ts";
import { ROUTINE_RECORD_CLASSES, type RoutineRecordClass } from "../civic-data/types.ts";

export interface Measured {
  readonly value: number;
  /** What the value is out of. Never omitted, never inferred, never guessed. */
  readonly denominator: number;
  /** What this number licenses the reader to conclude. Prose, required. */
  readonly contract: string;
  readonly denominatorSource: string;
}

/** Build a {@link Measured}, refusing the shapes that would mislead. */
export function measured(
  value: number,
  denominator: number,
  contract: string,
  denominatorSource: string,
): Measured {
  if (!Number.isFinite(value) || !Number.isFinite(denominator)) {
    throw new Error(
      `measured() requires finite numbers and got value=${value} denominator=${denominator}. ` +
        "NaN rendered through a template literal reads as the word NaN on the owner's page, " +
        "which looks like a bug in the page rather than a hole in the data.",
    );
  }
  if (denominator < 0 || value < 0) {
    throw new Error("measured() refuses negative counts — a count below zero is a bug, not a fact.");
  }
  if (value > denominator) {
    throw new Error(
      `measured() refuses value ${value} over denominator ${denominator}. A numerator larger ` +
        "than its denominator means the two were computed over different populations, and the " +
        "resulting percentage would be a confident sentence about nothing.",
    );
  }
  if (contract.trim() === "" || denominatorSource.trim() === "") {
    throw new Error(
      "measured() requires both an interpretation contract and a denominator source. A number " +
        "on the owner's page with neither is exactly the 'green standing in for verified' that " +
        "the constitution's order-of-trade forbids.",
    );
  }
  return { value, denominator, contract, denominatorSource };
}

export type GapOwner = "OURS" | "THEIRS" | "UNKNOWABLE_NOW";

/** A value we do not have, rendered as the specific reason we do not have it. */
export interface Gap {
  readonly whose: GapOwner;
  /** Plain language, for the owner. No enum value, no NO_SOURCE_FOUND. */
  readonly says: string;
}

/** A value, or the named gap where it would have been. Never a bare null. */
export type Held<T> = { readonly held: true; readonly value: T } | { readonly held: false; readonly gap: Gap };

export function held<T>(value: T): Held<T> {
  return { held: true, value };
}

export function gap<T>(whose: GapOwner, says: string): Held<T> {
  if (says.trim() === "") {
    throw new Error(
      "gap() requires the sentence the owner will actually read. An unnamed gap renders as " +
        "blank space, and blank space on a health page reads as 'fine'.",
    );
  }
  return { held: false, gap: { whose, says } };
}

export interface CountClaim {
  /** What the page said, in prose, e.g. "7 decisions await you". */
  readonly label: string;
  readonly stated: number;
  readonly rendered: number;
}

export interface StatedEqualsRenderedVerdict {
  readonly ok: boolean;
  readonly mismatches: readonly CountClaim[];
  readonly detail: string;
}

export function checkStatedEqualsRendered(
  claims: readonly CountClaim[],
): StatedEqualsRenderedVerdict {
  const mismatches = claims.filter((c) => c.stated !== c.rendered);
  return {
    ok: mismatches.length === 0,
    mismatches,
    detail:
      mismatches.length === 0
        ? `${claims.length} count claim(s) checked; every stated number equals its rendered row count`
        : mismatches
            .map((m) => `${m.label}: stated ${m.stated}, rendered ${m.rendered}`)
            .join("; "),
  };
}

export interface RenderedNumber {
  readonly label: string;
  readonly value: number;
  readonly denominator: number | null;
  readonly contract: string | null;
}

export interface RenderAuditVerdict {
  readonly ok: boolean;
  readonly offenders: readonly string[];
  readonly detail: string;
  readonly checked: number;
}

export function auditRenderedNumbers(numbers: readonly RenderedNumber[]): RenderAuditVerdict {
  const offenders = numbers
    .filter(
      (n) =>
        n.denominator === null ||
        n.denominator === undefined ||
        n.contract === null ||
        (typeof n.contract === "string" && n.contract.trim() === ""),
    )
    .map((n) =>
      n.denominator === null || n.denominator === undefined
        ? `${n.label} (no denominator)`
        : `${n.label} (no interpretation contract)`,
    );
  return {
    ok: offenders.length === 0,
    offenders,
    checked: numbers.length,
    detail:
      offenders.length === 0
        ? `${numbers.length} rendered number(s) checked; each carries a denominator and an interpretation contract`
        : `refusing to render: ${offenders.join("; ")}`,
  };
}

/** Field names refused anywhere inside an owner-surface record: reader identity columns and free text. */
export const FORBIDDEN_RECORD_FIELDS: readonly string[] = [
  "email",
  "ip",
  "ipAddress",
  "userId",
  "sessionId",
  "session",
  "zipTyped",
  "address",
  "questionText",
  "answerText",
  "reaction",
  "reactionId",
  "demandSignal",
  "demandSignalId",
  "searchLogId",
  "token",
  "tokenDigest",
  "digestToken",
  "userAgent",
  "candidateOpinion",
  "freeText",
  "comment",
];

/** Recursive: a reader-level field is refused at any depth. */
export function assertAggregateOnly(record: unknown, context: string): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_RECORD_FIELDS.includes(key)) {
        throw new Error(
          `${context} refused: the owner-surface record carries the field '${key}' at ${path}.${key}. ` +
            "Aggregate-only is a boundary, not a storage rule — anything EXPOSED, " +
            "RENDERED or LICENSED is aggregate-only without exception, and the owner reading his " +
            "own control centre is a rendering like any other.",
        );
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(record, context);
}

export const OWNER_SURFACE_FORMAT_VERSION = 1;

export interface RunnerHeartbeat {
  readonly formatVersion: number;
  /** Written by the runner at the end of every cycle. */
  readonly beatAt: string;
  readonly lastCycleStartedAt: string | null;
  readonly lastCycleFinishedAt: string | null;
  /** When the runner itself believes the next cycle is due. */
  readonly nextCycleDueAt: string | null;
  readonly nextCycleReason?: string | null;
  readonly lastCycleOk: boolean | null;
  /** The SHA the runner was executing at. */
  readonly testedSha: string | null;
  readonly host: string;
  /** Set while the runner idles on PAUSE_RUNNER; null on a working beat. */
  readonly pause?: {
    readonly intentId: string;
    readonly since: string;
    readonly note: string | null;
  } | null;
  /** Raw main, the executable head and the SHA this runner executed, with the consistency verdict between them. */
  readonly codeIdentity?: CodeIdentity | null;
  readonly intakeRuntime?: IntakeRuntimeObservation | null;
  readonly discoverySearch?: DiscoverySearchApplied | null;
  readonly settings?: import("./settings.ts").RunnerSettingsApplied | null;
  /** Host memory at this beat (`hostMemoryReading` in worker-slots.ts). */
  readonly memory?: import("./workers/worker-slots.ts").HostMemoryReading | null;
  /** Neon bytes the runner's processes received, by calling code: the last full UTC hour and the hour so far. */
  readonly neonBytes?: {
    readonly lastFullHour: import("../db/transfer-by-caller.ts").NeonBytesSummary | null;
    readonly currentHour: import("../db/transfer-by-caller.ts").NeonBytesSummary | null;
  } | null;
}

export interface DiscoverySearchApplied {
  /** The receipt of the owner's decision it applied, or null when none was ever made (the default: off). */
  readonly receiptId: string | null;
  readonly enabled: boolean;
  /** The caps it enforced: the env caps, or the code's defaults. */
  readonly perCycle: number;
  readonly perDay: number;
  readonly appliedAt: string;
  /** Why it is on or off, in the runner's words (including "could not be read", which is off). */
  readonly detail: string;
}

/** Derived from the beat and the clock, never stored. */
export type RunnerLiveness = "ALIVE" | "LATE" | "SILENT" | "NEVER_BEAT";

/** Past this, a runner that should beat every cycle has missed several. */
export const HEARTBEAT_LATE_MINUTES = 90;
export const HEARTBEAT_SILENT_MINUTES = 360;

export function livenessOf(
  heartbeat: RunnerHeartbeat | null,
  nowIso: string,
): { state: RunnerLiveness; sinceMinutes: number | null; detail: string } {
  if (!heartbeat) {
    return {
      state: "NEVER_BEAT",
      sinceMinutes: null,
      detail:
        "No heartbeat record exists. That is a fact about our control plane, not about the " +
        "runner — it may be running and unable to write, and those are different problems.",
    };
  }
  const beat = Date.parse(heartbeat.beatAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(beat) || !Number.isFinite(now)) {
    return {
      state: "NEVER_BEAT",
      sinceMinutes: null,
      detail: "The heartbeat timestamp could not be read, so liveness cannot be derived.",
    };
  }
  const minutes = Math.max(0, Math.round((now - beat) / 60000));
  if (minutes >= HEARTBEAT_SILENT_MINUTES) {
    return { state: "SILENT", sinceMinutes: minutes, detail: `Last beat ${minutes} minutes ago.` };
  }
  if (minutes >= HEARTBEAT_LATE_MINUTES) {
    return { state: "LATE", sinceMinutes: minutes, detail: `Last beat ${minutes} minutes ago.` };
  }
  return { state: "ALIVE", sinceMinutes: minutes, detail: `Last beat ${minutes} minutes ago.` };
}

export interface OwnerDigestRecord {
  readonly formatVersion: number;
  readonly digestId: string;
  readonly writtenAt: string;
  readonly headline: string;
  /** The digest body, line by line, exactly as the runner emitted it. */
  readonly lines: readonly string[];
  readonly cycleOk: boolean | null;
  readonly testedSha: string | null;
  readonly huntSourceProgress?: HuntSourceProgress;
  readonly publicationFlow?: import("../civic-data/publication-flow.ts").PublicationFlowReceipt;
  readonly ballotPublication?: import("../civic-data/ballot-publication.ts").BallotPublicationResult & { readonly heldContestCount: number };
  readonly runtimeOutcome?:
    | FreshnessCycleOutcome
    | RoutineCivicDataSupervisorOutcome
    | IntakeRuntimeObservationOutcome
    | MapTilerUsageCollectionOutcome;
}

/** Separate key in the existing log so task activity never replaces the runner's latest cycle digest. */
export const HUNT_SOURCE_PROGRESS_LOG_KEY = "hunt-source-progress";

export interface HuntSourceProgress {
  readonly instructionIds: readonly string[];
  readonly taskId: string;
  readonly sourceId: string;
  readonly scope: string;
  readonly stage: "QUEUED" | "COLLECTING_AND_VERIFYING" | "PUBLISHED" | "REUSED" | "HELD" | "FAILED";
  readonly at: string;
  readonly detail: string;
  readonly candidateId: string | null;
  readonly readerPaths: readonly string[];
}

export interface MapTilerUsageCollectionOutcome {
  readonly kind: "MAPTILER_USAGE_COLLECTION";
  readonly state: "SUCCEEDED" | "FAILED";
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string;
  readonly durable: boolean;
  /** Exact provider-attempt provenance; a failed classifier remains visible. */
  readonly attempt: MapTilerUsageAttempt;
  readonly candidate: {
    readonly canonicalSha256: string;
    readonly connection: MapTilerUsageSnapshot["connection"];
    readonly since: string | null;
    readonly until: string | null;
    readonly rows: number;
  };
  readonly disposition: "PROMOTED_CURRENT" | "RETAINED_LKG" | "UNKNOWN_NO_LKG";
  readonly visibleMeasurement: {
    readonly collectedAt: string;
    readonly publisher: string;
  } | null;
  readonly authorityBoundary: {
    readonly canonicalOutcomeHistory: "OWNER_DIGESTS_APPEND_ONLY";
    readonly currentProjection: "OWNER_SNAPSHOT_MAPTILER";
    readonly trackedRuntimeReads: 0;
    readonly trackedRuntimeWrites: 0;
    readonly gitWrites: 0;
    readonly softwareReleaseEvents: 0;
  };
}

/** Liveness may be projected from the latest observation, but a later healthy beat never erases an earlier ATTENTION/UNREADABLE row. */
export interface IntakeRuntimeObservationOutcome {
  readonly kind: "INTAKE_RUNTIME_OBSERVATION";
  readonly state: IntakeRuntimeOutcome;
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string;
  readonly durable: boolean;
  readonly observation: IntakeRuntimeObservation;
  readonly authorityBoundary: {
    readonly canonicalOutcomeHistory: "OWNER_DIGESTS_APPEND_ONLY";
    readonly heartbeatRole: "LATEST_PROJECTION_ONLY";
    readonly gitWrites: 0;
    readonly softwareReleaseEvents: 0;
  };
}

/** A supervisor failure with no source-authored receipt: an operations fact, never a candidate disposition. */
export interface RoutineCivicDataTaskReceiptReference {
  readonly taskId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly classification: "VERIFIED_SOURCE_SUCCESS" | "VERIFIED_SOURCE_FAILURE";
  readonly receipt: RoutineRunnerReceipt;
  readonly instructionIds?: readonly string[];
}

export type RoutineCivicDataReaderReadbackDisposition =
  | "NOT_APPLICABLE"
  | "NO_PROMOTION"
  | "CURRENT"
  | "BACKOFF"
  | "FAILED_BACKOFF"
  | "RECORDED"
  | "REPAIR_FAILED";

export interface RoutineCivicDataReaderReadbackReference {
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly projectionId: string | null;
  readonly disposition: RoutineCivicDataReaderReadbackDisposition;
  /** Present for CURRENT, FAILED_BACKOFF and RECORDED; absent by contract otherwise. */
  readonly receipt: ReaderProjectionReadbackReceipt | null;
}

export interface RoutineCivicDataSupervisorOutcome {
  readonly ballotPublications?: import("../civic-data/ballot-publication.ts").BallotPublicationSummaries;
  readonly ballotNavigationPublications?: import("../civic-data/ballot-publication.ts").BallotPublicationSummaries;
  readonly lane?: "routine-civic-data" | "publish-now";
  readonly readerEdge?: import("../civic-data/reader-edge-outcome.ts").ReaderEdgePublicationOutcome;
  /** Committed input snapshot attempted through an exact campaign publication receipt; not a publication count. */
  readonly campaignPublicationApprovalsByState?: Readonly<Record<string, number>>;
  readonly kind: "ROUTINE_CIVIC_DATA_SUPERVISOR";
  /** Source holds are contained data-plane outcomes; only supervisor faults make this FAILED. */
  readonly state: "SUCCEEDED" | "FAILED";
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string;
  readonly durable: boolean;
  readonly attemptedTasks: number;
  readonly verifiedSourceSuccesses: number;
  readonly verifiedSourceFailures: number;
  readonly taskReceiptEvidence: "EXACT" | "UNAVAILABLE_OUTER_SUPERVISOR";
  readonly taskReceipts: readonly RoutineCivicDataTaskReceiptReference[];
  readonly readerReadbackEvidence: "EXACT" | "UNAVAILABLE_OUTER_SUPERVISOR";
  readonly readerReadbackDenominator: number;
  readonly readerReadbacksRecordedPass: number;
  readonly readerReadbacksRecordedFail: number;
  readonly readerReadbacksCurrentFail: number;
  readonly readerReadbackNoops: number;
  readonly readerReadbackRepairFailures: number;
  readonly readerReadbacks: readonly RoutineCivicDataReaderReadbackReference[];
  readonly failures: readonly {
    readonly taskId: string;
    readonly code: string;
    readonly detail: string;
  }[];
  /** Started source children that died without a receipt; each task's work waits its own retry clock. */
  readonly crashedTasks?: readonly { readonly taskId: string; readonly detail: string }[];
  readonly attributionBoundary: {
    readonly sourceReceiptAuthority: "SOURCE_ACQUISITION_CHILD_ONLY";
    readonly supervisorCandidateWrites: 0;
    readonly supervisorPointerWrites: 0;
    readonly supervisorLkgChanges: 0;
  };
}

export interface OwnerDigestAttention {
  readonly level: "GREEN" | "AMBER" | "RED" | "UNKNOWN";
  readonly headline: string;
  readonly happened: string;
  readonly needsYou: boolean;
  readonly action: string | null;
}

export function intakeRuntimeObservationOutcomeIssue(
  outcome: IntakeRuntimeObservationOutcome,
): string | null {
  const observation = parseIntakeRuntimeObservation(outcome.observation);
  if (observation === null) return "The intake observation payload is malformed or internally contradictory.";
  let expectedCycleId: string;
  try {
    expectedCycleId = intakeRuntimeObservationCycleId(outcome.host, observation.observedAt);
  } catch {
    return "The intake observation host or timestamp is not a canonical durable identity.";
  }
  if (outcome.cycleId !== expectedCycleId) return "The intake observation does not match its append-only cycle identity.";
  if (outcome.state !== observation.outcome) return "The intake outcome state contradicts its exact observation.";
  const startedMs = Date.parse(outcome.startedAt);
  const observedMs = Date.parse(observation.observedAt);
  const finishedMs = Date.parse(outcome.finishedAt);
  if (
    !Number.isFinite(startedMs) || new Date(startedMs).toISOString() !== outcome.startedAt ||
    !Number.isFinite(finishedMs) || new Date(finishedMs).toISOString() !== outcome.finishedAt ||
    observedMs < startedMs || observedMs > finishedMs
  ) return "The intake observation clock falls outside its canonical runner cycle.";
  if (outcome.host.trim() === "" || outcome.provider.trim() === "" || outcome.durable !== true) {
    return "The intake observation is missing its durable host/provider authority.";
  }
  if (outcome.testedSha !== null && !/^[0-9a-f]{40}$/.test(outcome.testedSha)) {
    return "The intake observation carries a malformed runner code identity.";
  }
  if (
    outcome.authorityBoundary?.canonicalOutcomeHistory !== "OWNER_DIGESTS_APPEND_ONLY" ||
    outcome.authorityBoundary?.heartbeatRole !== "LATEST_PROJECTION_ONLY" ||
    outcome.authorityBoundary?.gitWrites !== 0 ||
    outcome.authorityBoundary?.softwareReleaseEvents !== 0
  ) return "The intake observation does not preserve the permanent runtime-authority boundary.";
  return null;
}

function parsedReaderReadbackReceipt(value: unknown): ReaderProjectionReadbackReceipt | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return parseReaderProjectionReadback(READER_PROJECTION_READBACK_PREFIX + JSON.stringify(value));
  } catch {
    return null;
  }
}

/** Aggregate counts cannot prove Reader delivery on their own; an issue is an UNKNOWN Admin state. */
export function routineReaderReadbackEvidenceIssue(
  outcome: RoutineCivicDataSupervisorOutcome,
): string | null {
  if (outcome.readerReadbackEvidence !== "EXACT") {
    return "Exact per-contract Reader readback references are unavailable.";
  }
  if (
    !Number.isInteger(outcome.readerReadbackDenominator) ||
    outcome.readerReadbackDenominator <= 0 ||
    !Array.isArray(outcome.readerReadbacks) ||
    outcome.readerReadbacks.length !== outcome.readerReadbackDenominator
  ) return "Exact Reader readback references do not reconcile to a non-empty contract denominator.";

  const allowedDispositions: readonly RoutineCivicDataReaderReadbackDisposition[] = [
    "NOT_APPLICABLE",
    "NO_PROMOTION",
    "CURRENT",
    "BACKOFF",
    "FAILED_BACKOFF",
    "RECORDED",
    "REPAIR_FAILED",
  ];
  const contractIds: string[] = [];
  for (const reference of outcome.readerReadbacks) {
    if (
      reference === null || typeof reference !== "object" ||
      typeof reference.contractId !== "string" || reference.contractId.trim() === "" ||
      typeof reference.sourceId !== "string" || reference.sourceId.trim() === "" ||
      !(ROUTINE_RECORD_CLASSES as readonly string[]).includes(reference.recordClass) ||
      typeof reference.scope !== "string" || reference.scope.trim() === "" ||
      !allowedDispositions.includes(reference.disposition)
    ) return "A Reader readback reference has a malformed contract identity or disposition.";
    contractIds.push(reference.contractId);
    if (reference.disposition === "NOT_APPLICABLE") {
      if (reference.projectionId !== null || reference.receipt !== null) {
        return "A non-applicable Reader contract fabricated projection/readback evidence.";
      }
      continue;
    }
    if (typeof reference.projectionId !== "string" || reference.projectionId.trim() === "") {
      return "A Reader-bearing contract is missing its exact projection identity.";
    }
    const receiptRequired = reference.disposition === "CURRENT" ||
      reference.disposition === "FAILED_BACKOFF" ||
      reference.disposition === "RECORDED";
    if (!receiptRequired) {
      if (reference.receipt !== null) return "A Reader disposition carries a receipt it cannot justify.";
      continue;
    }
    const receipt = parsedReaderReadbackReceipt(reference.receipt);
    if (receipt === null) return "A Reader disposition is missing a valid exact readback receipt.";
    if (
      receipt.contractId !== reference.contractId ||
      receipt.sourceId !== reference.sourceId ||
      receipt.recordClass !== reference.recordClass ||
      receipt.scope !== reference.scope ||
      receipt.projectionId !== reference.projectionId
    ) return "A Reader readback receipt contradicts its contract reference.";
    if (Date.parse(receipt.observedAt) > Date.parse(outcome.finishedAt)) {
      return "A Reader readback receipt is dated after the supervisor outcome that cites it.";
    }
    if (receipt.status === "PASS" && receipt.verifierCodeSha === null) {
      return "A Reader PASS lacks the exact verifier code identity required to certify it.";
    }
    if (reference.disposition === "CURRENT" && receipt.status !== "PASS") {
      return "A CURRENT Reader disposition does not carry an exact PASS receipt.";
    }
    if (reference.disposition === "FAILED_BACKOFF" && receipt.status !== "FAIL") {
      return "A failed Reader backoff does not carry its exact FAIL receipt.";
    }
  }
  if (new Set(contractIds).size !== contractIds.length) return "Reader contract receipt identities are duplicated.";

  const recordedPass = outcome.readerReadbacks.filter((row) =>
    row.disposition === "RECORDED" && row.receipt?.status === "PASS").length;
  const recordedFail = outcome.readerReadbacks.filter((row) =>
    row.disposition === "RECORDED" && row.receipt?.status === "FAIL").length;
  const currentFail = outcome.readerReadbacks.filter((row) => row.disposition === "FAILED_BACKOFF").length;
  const repairFailures = outcome.readerReadbacks.filter((row) => row.disposition === "REPAIR_FAILED").length;
  const noops = outcome.readerReadbacks.length - recordedPass - recordedFail - currentFail - repairFailures;
  const counts = [
    outcome.readerReadbacksRecordedPass,
    outcome.readerReadbacksRecordedFail,
    outcome.readerReadbacksCurrentFail,
    outcome.readerReadbackNoops,
    outcome.readerReadbackRepairFailures,
  ];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
    return "Reader readback aggregate counts are malformed.";
  }
  if (
    outcome.readerReadbacksRecordedPass !== recordedPass ||
    outcome.readerReadbacksRecordedFail !== recordedFail ||
    outcome.readerReadbacksCurrentFail !== currentFail ||
    outcome.readerReadbackNoops !== noops ||
    outcome.readerReadbackRepairFailures !== repairFailures
  ) return "Reader readback aggregate counts contradict the exact contract references.";

  const repairFailureContracts = new Set(
    outcome.readerReadbacks
      .filter((row) => row.disposition === "REPAIR_FAILED")
      .map((row) => `reader-readback:${row.contractId}`),
  );
  const repairFailureRows = outcome.failures.filter((failure) => failure.code === "READER_READBACK_REPAIR_FAILED");
  if (
    repairFailureRows.length !== repairFailureContracts.size ||
    repairFailureRows.some((failure) => !repairFailureContracts.has(failure.taskId))
  ) return "Reader repair failures do not reconcile to their exact supervisor incidents.";
  return null;
}

/** Never green from an absent or contradictory structured outcome. */
export function ownerDigestAttention(digest: OwnerDigestRecord): OwnerDigestAttention {
  const outcome = digest.runtimeOutcome;
  if (outcome === undefined) {
    return {
      level: "UNKNOWN",
      headline: "Latest runner report cannot be classified",
      happened: "The durable report has no structured runtime outcome, so Admin cannot call it healthy.",
      needsYou: true,
      action: "inspect the unclassified runner report",
    };
  }
  if (digest.cycleOk === null) {
    return {
      level: "UNKNOWN",
      headline: "Latest runner report has no success verdict",
      happened: "The structured outcome exists, but the durable report did not state whether its cycle succeeded.",
      needsYou: true,
      action: "inspect the runner verdict",
    };
  }
  if (outcome.kind === "INTAKE_RUNTIME_OBSERVATION") {
    const issue = intakeRuntimeObservationOutcomeIssue(outcome);
    const verdictAgrees = digest.cycleOk === (outcome.state === "HEALTHY");
    if (issue !== null || !verdictAgrees) {
      return {
        level: "UNKNOWN",
        headline: "Intake runtime evidence is inconsistent",
        happened: issue ?? "The intake observation and durable success verdict do not agree.",
        needsYou: true,
        action: "inspect the malformed intake-runtime receipt",
      };
    }
    if (outcome.state !== "HEALTHY") {
      return {
        level: "RED",
        headline: "Production intake needs attention",
        happened: outcome.observation.detail,
        needsYou: true,
        action: outcome.state === "UNREADABLE"
          ? "restore the production intake observation path"
          : "inspect the exact intake flags and write-alarm counts",
      };
    }
    return {
      level: "GREEN",
      headline: "Production intake observation is healthy",
      happened: outcome.observation.detail,
      needsYou: false,
      action: null,
    };
  }
  if (outcome.kind === "ROUTINE_CIVIC_DATA_SUPERVISOR") {
    const supervisorFailed = outcome.state === "FAILED" || outcome.failures.length > 0 || digest.cycleOk === false;
    if (supervisorFailed) {
      const readerFailure = outcome.failures.find(failure => failure.code === "READER_EDGE_PUBLISH_FAILED");
      if (readerFailure) return {
        level: "RED", headline: "Reader pages could not be updated",
        happened: "Readers are still seeing the earlier copy.", needsYou: false,
        action: "Restore reader publication and retry the update.",
      };
      return {
        level: "RED",
        headline: "Routine civic-data supervision needs attention",
        happened:
          `${outcome.failures.length} supervisor or infrastructure failure(s) were recorded. ` +
          "Exact source receipts remain authoritative; no source was blamed from this supervisor failure.",
        needsYou: true,
        action: "inspect and restore the failed routine-data supervisor path",
      };
    }
    const taskIds = outcome.taskReceipts.map(({ taskId }) => taskId);
    const candidateIds = outcome.taskReceipts.map(({ receipt }) => receipt.candidateId);
    const exactSuccesses = outcome.taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_SUCCESS");
    const exactFailures = outcome.taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_FAILURE");
    const crashed = outcome.crashedTasks ?? [];
    const exactEvidenceIssue = outcome.taskReceiptEvidence !== "EXACT"
      ? "Exact task/candidate receipt references are unavailable."
      : outcome.taskReceipts.length + crashed.length !== outcome.attemptedTasks
        ? `${outcome.taskReceipts.length} exact task receipts and ${crashed.length} crashed task(s) do not reconcile to ${outcome.attemptedTasks} attempted tasks.`
        : exactSuccesses.length !== outcome.verifiedSourceSuccesses || exactFailures.length !== outcome.verifiedSourceFailures
          ? "Exact task receipt classifications do not reconcile to the recorded success/failure counts."
          : new Set(taskIds).size !== taskIds.length || new Set(candidateIds).size !== candidateIds.length
            ? "Exact task or candidate receipt identities are duplicated."
            : outcome.taskReceipts.some(({ taskId, receipt }) => taskId !== receipt.source)
              ? "An exact task receipt does not name the task that produced it."
              : exactSuccesses.some(({ receipt }) =>
                  !receipt.acquisitionSucceeded ||
                  receipt.state !== "PROMOTED" ||
                  receipt.decision !== "GOOD" ||
                  receipt.promotedVersion !== receipt.candidateId)
                ? "A task classified as a verified source success lacks a matching promoted GOOD receipt."
                : exactFailures.some(({ receipt }) =>
                    receipt.state === "PROMOTED" ||
                    receipt.decision === "GOOD" ||
                    receipt.promotedVersion !== null)
                  ? "A task classified as a verified source failure carries contradictory promotion evidence."
                  : null;
    if (exactEvidenceIssue !== null || digest.cycleOk !== true) {
      return {
        level: "UNKNOWN",
        headline: "Routine cycle lacks consistent exact task evidence",
        happened: exactEvidenceIssue ?? "The routine outcome and durable cycle verdict do not agree.",
        needsYou: true,
        action: "inspect the incomplete routine-cycle evidence",
      };
    }
    const readerEvidenceIssue = routineReaderReadbackEvidenceIssue(outcome);
    if (readerEvidenceIssue !== null) {
      return {
        level: "UNKNOWN",
        headline: "Routine cycle lacks consistent exact Reader evidence",
        happened: readerEvidenceIssue,
        needsYou: true,
        action: "inspect the incomplete Reader-delivery evidence",
      };
    }
    const readerFailures = outcome.readerReadbacks.filter((reference) =>
      (reference.disposition === "RECORDED" && reference.receipt?.status === "FAIL") ||
      reference.disposition === "FAILED_BACKOFF");
    if (readerFailures.length > 0) {
      return {
        level: "RED",
        headline: "Canonical Reader delivery needs attention",
        happened:
          `${readerFailures.length} exact Reader readback failure(s) were recorded. ` +
          "Source dispositions, promoted pointers, and LKG remain unchanged.",
        needsYou: true,
        action: "inspect and restore the failed typed Reader projection",
      };
    }
    const unprovenReader = outcome.readerReadbacks.filter((reference) =>
      reference.disposition === "NO_PROMOTION" || reference.disposition === "BACKOFF");
    if (unprovenReader.length > 0) {
      return {
        level: "UNKNOWN",
        headline: "Canonical Reader delivery is not yet proven",
        happened:
          `${unprovenReader.length} Reader-bearing contract(s) have no exact current delivery PASS. ` +
          "No source failure or healthy Reader state was inferred.",
        needsYou: true,
        action: "inspect the unproven Reader contracts",
      };
    }
    const contained = outcome.taskReceipts.filter(({ classification }) => classification === "VERIFIED_SOURCE_FAILURE");
    if (contained.length > 0 || crashed.length > 0) {
      return {
        level: "AMBER",
        headline: "Routine source failure was contained",
        happened:
          `${contained.length} exact source receipt(s) held their own LKG` +
          `${crashed.length > 0 ? ` and ${crashed.length} source process(es) crashed` : ""} while ` +
          `${outcome.verifiedSourceSuccesses} unaffected task(s) completed successfully. Retry remains data-plane work.`,
        needsYou: false,
        action: null,
      };
    }
    return {
      level: "GREEN",
      headline: "Routine civic-data cycle completed",
      happened: `${outcome.taskReceipts.length} exact task receipt(s) were recorded with no source hold or supervisor failure.`,
      needsYou: false,
      action: null,
    };
  }
  if (outcome.kind === "MAPTILER_USAGE_COLLECTION") {
    const promoted = outcome.disposition === "PROMOTED_CURRENT";
    const retained = outcome.disposition === "RETAINED_LKG";
    const boundary = outcome.authorityBoundary;
    const issue =
      !outcome.cycleId.startsWith("maptiler-usage:") ||
      !/^[0-9a-f]{64}$/.test(outcome.candidate.canonicalSha256) ||
      outcome.candidate.rows < 0 || !Number.isInteger(outcome.candidate.rows) ||
      digest.cycleOk !== (outcome.state === "SUCCEEDED") ||
      promoted !== (outcome.state === "SUCCEEDED") ||
      (promoted && (outcome.attempt.connection !== "CONNECTED" || outcome.visibleMeasurement === null)) ||
      (retained && (outcome.attempt.connection === "CONNECTED" || outcome.visibleMeasurement === null)) ||
      (outcome.disposition === "UNKNOWN_NO_LKG" && outcome.visibleMeasurement !== null) ||
      boundary?.canonicalOutcomeHistory !== "OWNER_DIGESTS_APPEND_ONLY" ||
      boundary?.currentProjection !== "OWNER_SNAPSHOT_MAPTILER" ||
      boundary?.trackedRuntimeReads !== 0 || boundary?.trackedRuntimeWrites !== 0 ||
      boundary?.gitWrites !== 0 || boundary?.softwareReleaseEvents !== 0;
    if (issue) {
      return {
        level: "UNKNOWN",
        headline: "Map-provider outcome evidence is inconsistent",
        happened: "The append-only attempt receipt contradicts its current/LKG disposition.",
        needsYou: true,
        action: "inspect the malformed map-provider receipt",
      };
    }
    if (promoted) {
      return {
        level: "GREEN",
        headline: "Map-provider usage was measured",
        happened: "Both provider classifiers produced one complete reading and the current projection advanced.",
        needsYou: false,
        action: null,
      };
    }
    if (retained) {
      return {
        level: "AMBER",
        headline: "Map-provider refresh failed; LKG is serving",
        happened: outcome.attempt.detail ?? "The newest automatic provider attempt failed and the prior measurement remains live.",
        needsYou: false,
        action: null,
      };
    }
    return {
      level: "RED",
      headline: "Map-provider usage is unknown",
      happened: outcome.attempt.detail ?? "The automatic provider attempt failed and no prior measurement is available.",
      needsYou: true,
      action: "restore the map-provider observation path",
    };
  }
  if (outcome.kind === "FRESHNESS_CYCLE") {
    if (outcome.state !== "SUCCEEDED" || digest.cycleOk !== true) {
      return {
        level: "RED",
        headline: "Standing freshness cycle needs attention",
        happened: outcome.failure?.detail ?? "The latest standing freshness cycle failed.",
        needsYou: true,
        action: "inspect the failed standing freshness cycle",
      };
    }
    return {
      level: "GREEN",
      headline: "Standing freshness cycle completed",
      happened: "The latest structured standing freshness cycle succeeded.",
      needsYou: false,
      action: null,
    };
  }
  /* An older report kind this code no longer writes: history, not a signal. */
  return {
    level: "UNKNOWN",
    headline: "Earlier runner report",
    happened: "An older report of a kind the runner no longer writes.",
    needsYou: false,
    action: null,
  };
}

export interface FreshnessCycleOutcome {
  readonly kind: "FRESHNESS_CYCLE";
  readonly state: "SUCCEEDED" | "FAILED";
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly provider: string | null;
  readonly durable: boolean | null;
  readonly executor: string | null;
  readonly registry: {
    readonly providers: readonly {
      readonly providerId?: string;
      readonly records?: number;
      readonly units?: number;
      readonly readFailure?: string | null;
      readonly emptyReason?: string | null;
    }[];
    readonly registeredUnits: number;
    readonly workedUnits: number;
    readonly only: string | null;
  } | null;
  readonly obligations: number | null;
  readonly occurrencesOpened: number | null;
  readonly debtInherited: number | null;
  readonly debtPersisted: number | null;
  readonly debtCleared: number | readonly string[] | null;
  readonly scheduled: number | null;
  readonly unscheduled: readonly { readonly id?: string; readonly reason?: string }[];
  readonly dueCount: number | null;
  readonly dispatched: number | null;
  readonly worked: readonly string[];
  readonly dispositions: readonly {
    readonly obligationId: string;
    readonly disposition: string | null;
    readonly artifacts: number;
  }[];
  readonly dispatchDetails: readonly {
    readonly obligationId: string;
    readonly attemptId: string | null;
    readonly outcome: string | null;
    readonly disposition: string | null;
    readonly detail: string;
  }[];
  readonly research: {
    readonly lanes: {
      readonly deterministic?: { readonly due?: number; readonly dispatched?: number };
      readonly model?: { readonly due?: number; readonly dispatched?: number; readonly deferred?: number };
    } | null;
  } | null;
  readonly deferred: number | null;
  readonly debts: number | null;
  readonly incidents: readonly {
    readonly cause: string;
    readonly target: string;
    readonly obligationsAffected: number;
    readonly nextRetryAt?: string;
  }[];
  readonly risk: Readonly<Record<string, unknown>> | null;
  readonly health: Readonly<Record<string, unknown>> | null;
  readonly promotedToReaderTruth: boolean | null;
  readonly failure: { readonly code: string; readonly detail: string } | null;
}

/** RECORDING_NOT_WIRED is distinct from NOT_YET_OBSERVED: an unwired path cannot testify to an absence. Probe traffic is never `prod-ask`. */
export type CacheObservationState = "OBSERVED" | "NOT_YET_OBSERVED" | "RECORDING_NOT_WIRED";

/** The owner's wording, kept verbatim. Do not paraphrase this string. */
export const ORGANIC_PROD_ASK_NOT_YET = "organic prod-ask cache read: not yet observed";

export interface CacheObservationRecord {
  readonly formatVersion: number;
  readonly state: CacheObservationState;
  /** Set only when state is OBSERVED. */
  readonly firstObservedAt: string | null;
  /** Token counts only — never the request, the question, or the answer. */
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  /** Separates NOT_YET_OBSERVED from RECORDING_NOT_WIRED. */
  readonly recorderLastSeenAt: string | null;
}

export function renderCacheObservation(record: CacheObservationRecord | null): {
  state: CacheObservationState;
  says: string;
} {
  if (!record || record.state === "RECORDING_NOT_WIRED") {
    return {
      state: "RECORDING_NOT_WIRED",
      says:
        "organic prod-ask cache read: we cannot tell — production is not yet recording cache " +
        "observations to the control plane, so this is a gap in our instrumentation and not a " +
        "statement about whether a reader request has happened.",
    };
  }
  if (record.state === "NOT_YET_OBSERVED") {
    return { state: "NOT_YET_OBSERVED", says: ORGANIC_PROD_ASK_NOT_YET };
  }
  const read = record.cacheReadInputTokens ?? 0;
  const created = record.cacheCreationInputTokens ?? 0;
  return {
    state: "OBSERVED",
    says:
      `organic prod-ask cache read: first observed ${record.firstObservedAt ?? "at an unrecorded time"} ` +
      `(${read} cache-read input tokens, ${created} cache-creation input tokens)`,
  };
}

/** An owner decision is stored as data and stands as soon as it is recorded. */
export type OwnerDecisionState =
  | "RECORDED"
  | "PENDING_CANONICALIZATION"
  | "CANONICALIZED"
  | "REJECTED_BY_GATES";

export interface OwnerDecisionIntent {
  readonly formatVersion: number;
  readonly intentId: string;
  readonly subjectId: string;
  readonly chosenOption: string;
  readonly consequenceShown: string;
  readonly decidedAt: string;
  readonly state: OwnerDecisionState;
  readonly canonicalRef: string | null;
  readonly refusedReason: string | null;
  /** The owner's admin session id; never a reader identity. */
  readonly adminSessionRef: string;
  /** Not `answerText`/`freeText`/`comment`: `assertAggregateOnly` refuses those names. Absent reads as null. */
  readonly ownerAnswer?: string | null;
  readonly openedWork?: readonly { readonly id: string; readonly title: string }[];
  readonly subjectTitle?: string | null;
}

/** The longest answer the dashboard accepts in the owner's own words. */
export const OWNER_ANSWER_MAX_CHARS = 2000;

/** A literal rather than an empty string, so a record never looks like a decision with nothing chosen. */
export const ANSWERED_IN_OWN_WORDS = "Answered in my own words";

export interface OwnerContractReading {
  readonly contract: "READER" | "TRUTH" | "FRESHNESS";
  readonly state: string;
  readonly reason: string;
  readonly denominator: Held<Measured>;
  /** SESSION_MEASURED or INDEPENDENTLY_REPRODUCED — the proof class shown. */
  readonly proofClass: string;
  readonly runSha: string | null;
  readonly runAt: string | null;
}

export interface OwnerZipRow {
  readonly zip: string;
  readonly green: number;
  readonly red: number;
  readonly notEvaluable: number;
  readonly failureClasses: readonly string[];
}

export type OwnerDecisionCardKind = "DECISION" | "ACKNOWLEDGE" | "BLOCKED_WHILE";

export interface OwnerDecisionCard {
  readonly rowId: string;
  readonly title: string;
  readonly whatIsNeeded: string;
  readonly whyNoMachineCanDecide: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
  /** Null when unmeasured, never a zero. */
  readonly blockedDescendants: number | null;
  readonly openedOn: string | null;
  readonly ageDays: number | null;
  readonly priority: string;
  /** The predicate, or an explicit NOT_MACHINE_VERIFIABLE marking. */
  readonly verifiability: "PREDICATE" | "NOT_MACHINE_VERIFIABLE";
  /** Absent reads as DECISION. */
  readonly kind?: OwnerDecisionCardKind;
  /** BLOCKED_WHILE only: the predicate's blocker sentence. */
  readonly blocker?: string | null;
  /** BLOCKED_WHILE only: what the last tracker generation found when it rechecked. */
  readonly checkedThisRun?: string | null;
  readonly lastVerified?: string | null;
}

/** The kind of a card, tolerating a snapshot written before the field existed. */
export function decisionCardKind(card: OwnerDecisionCard): OwnerDecisionCardKind {
  if (card.kind) return card.kind;
  return card.verifiability === "PREDICATE" ? "BLOCKED_WHILE" : "DECISION";
}

export interface OwnerCostRow {
  readonly key: string;
  readonly usd: Held<Measured>;
  readonly metering?: MeteringCounts;
  readonly attemptsMeasured?: number;
  readonly attemptsUnmeasured?: number;
  /** MEASURED, FREE_BY_DESIGN (ran without a paid model) or UNMEASURED (a model ran and reported no dollars). */
  readonly kind?: "MEASURED" | "FREE_BY_DESIGN" | "UNMEASURED";
  /** What a deterministic role does carry: requests, bytes and time. */
  readonly nonDollar?: {
    readonly requests: number;
    readonly bytes: number;
    readonly durationMs: number;
    readonly entries: number;
  };
  readonly meaning?: string;
}

/** One aggregate rather than several, so the panels agree about one instant. */
export interface OwnerSnapshot {
  /** Daily completeness, freshness and delivery counts for each place with a saved scope, newest last. Counts only; it never gates publishing. */
  readonly placeHistory?: Readonly<Record<string, readonly import("../coverage/place-history.ts").PlaceHistoryPoint[]>>;
  readonly formatVersion: number;
  readonly publishedAt: string;
  readonly publishedFromSha: string | null;
  readonly publisher: string;

  readonly pilotGreen: boolean | null;
  readonly contracts: readonly OwnerContractReading[];

  readonly decisionCards: readonly OwnerDecisionCard[];

  readonly obligationsByState: readonly { readonly state: string; readonly count: Measured }[];
  readonly obligationsByProvider: readonly { readonly provider: string; readonly count: Measured }[];
  readonly freshnessDebtRows: Held<Measured>;
  readonly incidents: readonly {
    readonly cause: string;
    readonly target: string;
    readonly obligationsAffected: number;
    readonly oldestHours: number | null;
  }[];

  readonly costByRole: readonly OwnerCostRow[];
  readonly costByModel: readonly OwnerCostRow[];
  readonly cacheHitRateByCaller: readonly { readonly callerKey: string; readonly hitRate: Held<Measured>; readonly health?: CacheCallerHealth }[];
  readonly deterministicShare: Held<Measured>;
  readonly costPerVerifiedRecord: Held<Measured>;
  /** Null on a snapshot published before the publisher passed its clock. */
  readonly costCapacity?: ScoutCapacity | null;
  readonly monthlySpend?: MonthlySpendView | null;
  readonly costSummary?: {
    readonly measuredUsd: number | null;
    readonly attemptsMeasured: number;
    readonly attemptsUnmeasured: number;
    readonly entries: number;
  };

  /** HELD only when the run record attributes results to ZIPs. */
  readonly zipRows: Held<readonly OwnerZipRow[]>;

  readonly intakeFolder: Held<string>;
  readonly intakeItemsFound: Held<Measured>;
  readonly intakeItemsProcessed: Held<Measured>;
  readonly intakeUnidentifiable: Held<Measured>;

  /** Candidate slug to name as filed. Render by this map; never re-derive a name from a slug. */
  readonly candidateNames?: Readonly<Record<string, string>>;

  readonly spendByDay?: readonly { readonly day: string; readonly usd: number; readonly attempts: number }[];

  /** Spend by place over the whole ledger. Absent renders as the missing wire, never an empty list. */
  readonly spendByPlace?: SpendByPlaceView;

  readonly servedReaderReadback?: import("./served-reader.ts").ServedReaderReadback | null;

  /** Every unit of work counted by state, lane and cost, with a bounded ordered list of rows. Absent renders as the missing wire. */
  readonly assignments?: import("./assignment-view.ts").AssignmentPublication | null;

  /** The map provider's own usage. Absent or NOT_CONNECTED never renders as zero usage. */
  readonly maptiler?: MapTilerUsageSnapshot | null;
  /** Cached GET-only billing reports, written by the existing standing publisher. */
  readonly providerBilling?: import("./provider-billing.ts").ProviderBillingSnapshot | null;
  readonly billingAttribution?: import("./provider-billing-attribution.ts").BillingAttribution | null;
}

export function countClaimsFor(snapshot: OwnerSnapshot): readonly CountClaim[] {
  return [
    {
      label: "pilot health contracts",
      stated: snapshot.contracts.length,
      rendered: snapshot.contracts.length,
    },
    {
      label: "decision cards",
      stated: snapshot.decisionCards.length,
      rendered: snapshot.decisionCards.length,
    },
    { label: "incidents", stated: snapshot.incidents.length, rendered: snapshot.incidents.length },
    {
      label: "ZIP rows",
      stated: snapshot.zipRows.held ? snapshot.zipRows.value.length : 0,
      rendered: snapshot.zipRows.held ? snapshot.zipRows.value.length : 0,
    },
  ];
}

/** A display band for a contract or the rollup. Never a stored health verdict. */
export type HealthLevel = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

/** One contract, projected for the compact card. Raw SHAs/proof class stay off it. */
export interface ContractCard {
  readonly contract: string;
  readonly level: HealthLevel;
  /** A two-word plain headline: Met / Failing / Not yet proven / Awaiting data. */
  readonly headline: string;
  /** The contract's denominator (num/denom) or its named gap. */
  readonly denominator: Held<Measured>;
  /** Proof age in plain words, from the run's timestamp. */
  readonly proofAge: string;
  /** The contract's own reason sentence (already plain language). */
  readonly reason: string;
  /** The genuine next action, or null when the contract is met. */
  readonly nextAction: string | null;
}

export interface PilotHealthView {
  readonly overall: HealthLevel;
  readonly reason: string;
  readonly cards: readonly ContractCard[];
}

/** Map a contract's four-state reading to a display band. RED is a measured
 *  failure; AMBER is "not proven yet" (NOT_READY) or "awaiting data". */
export function contractHealthLevel(state: string): HealthLevel {
  switch (state) {
    case "GREEN":
      return "GREEN";
    case "RED":
      return "RED";
    case "NOT_READY":
    case "AWAITING_OWNER_DATA":
      return "AMBER";
    default:
      return "UNKNOWN";
  }
}

function contractHeadline(state: string): string {
  switch (state) {
    case "GREEN":
      return "Met";
    case "RED":
      return "Failing";
    case "NOT_READY":
      return "Not yet proven";
    case "AWAITING_OWNER_DATA":
      return "Awaiting owner data";
    default:
      return "Unknown";
  }
}

function contractNextAction(state: string, contract: string): string | null {
  switch (state) {
    case "GREEN":
      return null;
    case "RED":
      return `Investigate: the ${contract} bar is measurably not met (see reason).`;
    case "NOT_READY":
      return `Reproduce the ${contract} instrument to move it out of NOT_READY (see reason).`;
    case "AWAITING_OWNER_DATA":
      return "Load the owner corpus / answer key this contract measures against.";
    default:
      return null;
  }
}

function proofAgeText(runAt: string | null, nowIso: string): string {
  if (!runAt) return "no run recorded";
  const then = Date.parse(runAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "proof date unreadable";
  const hours = Math.max(0, Math.floor((now - then) / 3_600_000));
  if (hours < 1) return "proof under an hour old";
  if (hours < 48) return `proof ${hours}h old`;
  return `proof ${Math.floor(hours / 24)}d old`;
}

export function pilotHealthView(snapshot: OwnerSnapshot | null, nowIso: string): PilotHealthView {
  if (!snapshot) {
    return {
      overall: "UNKNOWN",
      reason: "No pilot-health snapshot has been published yet — nothing has been measured.",
      cards: [],
    };
  }
  const cards: ContractCard[] = snapshot.contracts.map((c) => ({
    contract: c.contract,
    level: contractHealthLevel(c.state),
    headline: contractHeadline(c.state),
    denominator: c.denominator,
    proofAge: proofAgeText(c.runAt, nowIso),
    reason: c.reason,
    nextAction: contractNextAction(c.state, c.contract),
  }));
  const anyRed = cards.some((c) => c.level === "RED");
  const anyAmber = cards.some((c) => c.level === "AMBER" || c.level === "UNKNOWN");
  const overall: HealthLevel =
    snapshot.pilotGreen === true
      ? "GREEN"
      : snapshot.pilotGreen === null
        ? "UNKNOWN"
        : anyRed
          ? "RED"
          : anyAmber
            ? "AMBER"
            : "RED";
  const blockers = cards
    .filter((c) => c.level !== "GREEN")
    .map((c) => `${c.contract} ${c.headline.toLowerCase()}`);
  const reason =
    overall === "GREEN"
      ? "All three contracts are met, each on its own denominator."
      : overall === "UNKNOWN"
        ? "No pilot-health verdict is recorded — the runner has not published one."
        : `Not green — ${blockers.join("; ")}.`;
  return { overall, reason, cards };
}
