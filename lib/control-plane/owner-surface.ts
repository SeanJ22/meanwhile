/**
 * **THE OWNER CONTROL CENTRE'S DOMAIN, AND ITS REFUSALS.**
 * (Session C final, ITEM H, 2026-09-01.)
 *
 * The admin host (`ADMIN_ORIGIN`) replaces the Drive-mirror digest file as the place
 * the owner reads pilot health and acts on decisions. This module is the part
 * of that surface which has nothing to do with HTML: the record shapes, and the
 * checks that make three constitutional rules STRUCTURAL rather than habitual.
 *
 * ## Why this exists at all, rather than the page just reading things
 *
 * The admin page runs on Netlify, in standalone mode, inside a function bundle.
 * Six of the seven panels the owner wants — pilot health, the digest, the
 * Needs-Sean queue, the reader-suite grid, the intake status, and the caller-key
 * half of cost — are produced today by scripts that write JSON to the repo
 * working tree or markdown to a Google Drive folder. **None of that exists in a
 * deploy.** `next.config.ts` has a long, hard-won list of files that must be
 * named per route or they are silently absent from the bundle, and the failure
 * mode it documents over and over is the one that matters here: an untraced
 * read returns nothing, the catch returns null, and the surface renders its own
 * gap wording — which is INDISTINGUISHABLE FROM HONEST MISSING DATA.
 *
 * An admin page that did that would tell the owner his pilot was fine because
 * it could not find the file that says otherwise. So the data plane is
 * Postgres, the runner PUBLISHES to it, and the page only ever reads records
 * that a writer actually wrote.
 *
 * ## The three rules this file makes impossible to break
 *
 * ```
 *   1  EVERY NUMBER CARRIES ITS DENOMINATOR AND ITS INTERPRETATION CONTRACT
 *      -> you cannot construct a bare number here; `Measured` has no shape
 *         that omits them
 *   2  A NULL RENDERS AS ITS NAMED GAP, AND THE NAME SAYS WHOSE GAP IT IS
 *      -> `Gap` requires `whose`, so "we have not recorded this" and "they do
 *         not publish it" cannot come out as the same sentence
 *   3  STATED N EQUALS RENDERED ROWS
 *      -> `checkStatedEqualsRendered` is run by the page against itself
 * ```
 *
 * ## AGGREGATE-ONLY, and the owner is not an exception
 *
 * CLAUDE.md: there is NO user-to-user surface, reactions are write-only from
 * the reader's perspective, and anything EXPOSED, RENDERED or LICENSED is
 * aggregate-only WITHOUT EXCEPTION. The owner reading his own admin page is a
 * rendering. So no record in this module carries a reaction row, a demand
 * signal row, a search-log row, a question, an answer, an IP, a session, or any
 * field that could key back to one reader — and {@link assertAggregateOnly}
 * refuses one that tries, by field name, at write time.
 */

/* ------------------------------------------------------------------ *
 * 1. NUMBERS THAT CANNOT BE STATED WITHOUT THEIR DENOMINATOR
 * ------------------------------------------------------------------ */

/**
 * A number the owner is allowed to read, with the two things that make it
 * mean something.
 *
 * `value` alone is a statistic looking for a story. The pilot-health contracts
 * in `lib/health/contracts.ts` already refuse a zero denominator that was never
 * established (a zero out of zero is RED there, not a vacuous green), and this
 * is the same discipline carried onto the page: a panel may not print `12`
 * without saying twelve OF WHAT and what twelve MEANS.
 *
 * `contract` is the interpretation — the sentence that says what a reader of
 * this number is entitled to conclude. It is not a label and not a unit.
 */
import type { CodeIdentity } from "./code-identity.ts";
import type { CacheCallerHealth, MeteringCounts, MonthlySpendView, SpendByPlaceView } from "./cost-panel.ts";
import type { ScoutCapacity } from "./research-metrics.ts";
import type { FleetReceiptSnapshot } from "./fleet-receipt-snapshot.ts";
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
  /**
   * How the denominator itself was established. A denominator nobody can
   * account for makes the numerator unaccountable too, which is the failure
   * `assertDenominatorIsIndependent` exists to catch in the reader suite.
   */
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

/* ------------------------------------------------------------------ *
 * 2. A NULL IS A NAMED GAP, AND THE NAME SAYS WHOSE
 * ------------------------------------------------------------------ */

/**
 * Whose gap this is.
 *
 * CLAUDE.md is explicit and this is the whole of it: *"'We haven't recorded
 * this yet' is a fact about us; 'not in this chamber for this vote' is a fact
 * about them. They may never render as the same sentence."*
 *
 * `UNKNOWABLE_NOW` is the third state the constitution insists on separately —
 * `CANNOT_TELL` fails safe. A recording path that is not wired yet has NOT
 * observed an absence; it has observed nothing, and saying "not yet" there
 * would be asserting an absence we have no evidence for.
 */
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

/* ------------------------------------------------------------------ *
 * 3. STATED N EQUALS RENDERED ROWS
 * ------------------------------------------------------------------ */

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

/**
 * The page's own check on itself, run at render time.
 *
 * A headline that says seven over a list of five is not a rounding error; it is
 * the page telling the owner that two things exist which he cannot see, and it
 * is precisely the failure mode "show everything we find" exists to prevent.
 * Running this at render — rather than trusting the code that built both — is
 * the point: the two numbers come from different places, so only comparing the
 * ACTUAL rendered row count can catch a divergence.
 */
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

/* ------------------------------------------------------------------ *
 * 3b. THE PAGE AUDITS ITS OWN NUMBERS BEFORE IT SHOWS THEM
 * ------------------------------------------------------------------ */

/**
 * One number the page is about to put on screen, declared with its context.
 *
 * The page builds this list as it renders. It is not documentation — it is the
 * input to {@link auditRenderedNumbers}, which the page runs against ITSELF and
 * whose failure replaces the numbers with a refusal.
 */
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

/**
 * **A NUMBER WITHOUT A DENOMINATOR DOES NOT GET RENDERED.**
 *
 * This is a seeded failure, and it is seeded because the failure it prevents is
 * one nobody notices. "14 obligations overdue" is not information: fourteen of
 * eighteen is an emergency, fourteen of nine thousand is a Tuesday, and the
 * owner reading a bare fourteen will supply a denominator from his own
 * imagination — which is the one place it certainly is not measured.
 *
 * The check runs at render time against the numbers ACTUALLY being emitted,
 * rather than trusting the types that produced them, because the types only
 * cover the values that came through `Measured`. A number computed inline in
 * the page — the exact way this rule gets broken — is caught here and nowhere
 * else.
 */
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

/* ------------------------------------------------------------------ *
 * 4. AGGREGATE-ONLY, ENFORCED BY FIELD NAME AT WRITE TIME
 * ------------------------------------------------------------------ */

/**
 * Field names that may never appear anywhere inside an owner-surface record.
 *
 * This is a blunt instrument on purpose. A subtle check would be one somebody
 * could reason their way around at 3 a.m.; a refused field name is not. The
 * list covers the identity columns of the collection stores (`lib/db/
 * schema.ts`) and the free-text a reader can type.
 *
 * **The collection stores never join**, and this is the boundary reaching the
 * one surface a human reads: nothing here may carry a value from the reaction
 * store, the search log, the demand-signal store or the ask store that could
 * be lined up against anything else.
 */
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

/**
 * Refuse an owner-surface record that carries a reader-level field.
 *
 * Recursive, because the field that sinks this is never at the top level — it
 * is three objects down in something that looked like a summary.
 */
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
            "Aggregate-only is a boundary, not a storage rule (RULING 226) — anything EXPOSED, " +
            "RENDERED or LICENSED is aggregate-only without exception, and the owner reading his " +
            "own control centre is a rendering like any other.",
        );
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(record, context);
}

/* ------------------------------------------------------------------ *
 * 5. THE RECORDS THEMSELVES
 * ------------------------------------------------------------------ */

/** Every owner-surface record carries the version it was written under. */
export const OWNER_SURFACE_FORMAT_VERSION = 1;

/**
 * The runner's durable heartbeat.
 *
 * The admin site may not read the always-on machine's filesystem, its Drive
 * mirror, its process table or its scratch output — so "is the runner alive?"
 * has to be a fact the runner itself WROTE somewhere the deploy can read. A
 * heartbeat that the reader infers from the absence of bad news is not a
 * heartbeat.
 */
export interface RunnerHeartbeat {
  readonly formatVersion: number;
  /** Written by the runner at the end of every cycle. */
  readonly beatAt: string;
  readonly lastCycleStartedAt: string | null;
  readonly lastCycleFinishedAt: string | null;
  /** When the runner itself believes the next cycle is due. */
  readonly nextCycleDueAt: string | null;
  /** Why the next cycle is scheduled sooner than the ordinary interval, when applicable. */
  readonly nextCycleReason?: string | null;
  readonly lastCycleOk: boolean | null;
  /** The SHA the runner was executing at. */
  readonly testedSha: string | null;
  readonly host: string;
  /**
   * Set by the runner while it is idling on the owner's PAUSE_RUNNER intent
   * (ADM-5): the beat says "alive, and deliberately doing nothing". Absent on
   * every beat written before the field existed, and null on a working beat.
   */
  readonly pause?: {
    readonly intentId: string;
    readonly since: string;
    readonly note: string | null;
  } | null;
  /**
   * PRDY-1 (2026-09-06): the three code identities — raw main, the executable
   * head under the canonical shipping classification (RULING 278), and the SHA
   * this runner executed — with the consistency verdict between them. `testedSha`
   * alone cannot say whether the runner is current, because an observer-only
   * commit legitimately moves main without changing executable code (ACT-1).
   * Absent on every beat written before the field existed; null when the runner
   * could not read git.
   */
  readonly codeIdentity?: CodeIdentity | null;
  /**
   * Aggregate production-intake observation taken by this same standing
   * runner. Optional only for records written before the permanent cutover.
   * Its underlying history remains in the application store; this is the
   * current durable owner-facing receipt and never came through Git.
   */
  readonly intakeRuntime?: IntakeRuntimeObservation | null;
  /**
   * What the runner applied for PAID discovery search on its last cycle (NS28):
   * the owner's switch as it read it at cycle start (`AdminConfig.discoverySearch`)
   * and the caps it enforced. The console matches `receiptId` to the owner's
   * latest decision, as it matches a pause, to say whether the runner has applied
   * it. Absent on every beat written before the field existed.
   */
  readonly discoverySearch?: DiscoverySearchApplied | null;
}

/** The runner's acknowledgement of the paid discovery search switch, written into its heartbeat each cycle. */
export interface DiscoverySearchApplied {
  /** The receipt of the owner's decision it applied, or null when none was ever made (the default: off). */
  readonly receiptId: string | null;
  readonly enabled: boolean;
  /** The caps it enforced: the env caps, or the code's defaults. */
  readonly perCycle: number;
  readonly perDay: number;
  /** When it read and applied the switch: that cycle's start. */
  readonly appliedAt: string;
  /** Why it is on or off, in the runner's words (including "could not be read", which is off). */
  readonly detail: string;
}

/**
 * ALIVE is DERIVED from the beat and the clock, never stored.
 *
 * A stored `alive: true` is a claim that stops being true without anything
 * rewriting it — which is exactly how a dead runner reports itself healthy.
 */
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

/**
 * One digest, as the runner wrote it — the SAME record, not a re-rendering.
 *
 * The acceptance clause is that the digest shown EQUALS the runner's latest
 * durable record. So the runner stores the digest body it produced, and the
 * page prints that body. A page that recomputed the digest from parts could
 * agree with the runner on a good day and disagree on the day it matters.
 */
export interface OwnerDigestRecord {
  readonly formatVersion: number;
  readonly digestId: string;
  readonly writtenAt: string;
  readonly headline: string;
  /** The digest body, line by line, exactly as the runner emitted it. */
  readonly lines: readonly string[];
  readonly cycleOk: boolean | null;
  readonly testedSha: string | null;
  /** Source progress for an exact Admin Send, in this existing append-only activity log. */
  readonly huntSourceProgress?: HuntSourceProgress;
  /**
   * Structured runtime outcome carried beside the exact human digest. Optional
   * only for historical rows written before PDC. Distinct kinds keep a civic
   * data supervisor fault from replacing the latest standing freshness cycle.
   * The canonical copy lives in the same append-only owner log Admin already
   * consumes; a worktree JSON file is never an authority or an input.
   */
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

/** One append-only receipt from the standing MapTiler observer. */
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

/**
 * One append-only observation from the retired intake-tripwire role. The
 * heartbeat may project this latest observation for liveness, but it is never
 * the history or outcome authority: a later healthy beat cannot erase an
 * earlier ATTENTION/UNREADABLE record from this log.
 */
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

/**
 * A child-process/protocol failure for which the supervisor has no valid,
 * source-authored durable receipt. This is an operations fact, not a source
 * observation: it therefore records the attribution boundary explicitly and
 * can never be interpreted as a candidate disposition.
 */
export interface RoutineCivicDataTaskReceiptReference {
  readonly taskId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly classification: "VERIFIED_SOURCE_SUCCESS" | "VERIFIED_SOURCE_FAILURE";
  /** Exact child receipt already checked against the durable candidate and pointer. */
  readonly receipt: RoutineRunnerReceipt;
  /** Exact Send receipts which requested this shared source refresh. */
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

/** Exact per-contract result from the Reader-only repair/verification pass. */
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
  /** Committed input snapshot attempted through an exact campaign publication receipt; not a publication count. */
  readonly campaignPublicationApprovalsAttempted?: number;
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

/** Validate an intake log row before Admin treats it as a health observation. */
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

/**
 * Reconcile the Reader repair pass from exact per-contract evidence. Returning
 * an issue is an UNKNOWN/actionable Admin state; aggregate counts cannot prove
 * Reader delivery on their own.
 */
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

/**
 * The latest owner digest must never become green from an absent or
 * contradictory structured outcome. Routine source holds are distinguished
 * from supervisor/infrastructure failures because their owner actions differ.
 */
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
    const exactEvidenceIssue = outcome.taskReceiptEvidence !== "EXACT"
      ? "Exact task/candidate receipt references are unavailable."
      : outcome.taskReceipts.length !== outcome.attemptedTasks
        ? `${outcome.taskReceipts.length} exact task receipts do not reconcile to ${outcome.attemptedTasks} attempted tasks.`
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
    if (contained.length > 0) {
      return {
        level: "AMBER",
        headline: "Routine source failure was contained",
        happened:
          `${contained.length} exact source receipt(s) held their own LKG while ` +
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
  /* An older report of a kind this code no longer writes (the retired method-authority adoption receipt): history, not a signal. */
  return {
    level: "UNKNOWN",
    headline: "Earlier runner report",
    happened: "An older report of a kind the runner no longer writes.",
    needsYou: false,
    action: null,
  };
}

/** Canonical operational outcome for one standing-runner cycle. */
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

/**
 * The H1 WAIVER'S STANDING CHECK (owner, 2026-09-01) — three states, never two.
 *
 * The waiver accepted a synthetic production-path probe as the caching proof
 * and attached a standing, NON-BLOCKING check: report the first ORGANIC reader
 * request recording `callerKey = prod-ask` with cache-read tokens, and until
 * then show *"organic prod-ask cache read: not yet observed"*.
 *
 * `scripts/ask-cache-probe.mts` stamps probe traffic `synthetic-run`, never
 * `prod-ask`, which is exactly what makes the check meaningful: only an organic
 * reader can produce the row.
 *
 * **The third state is the load-bearing one.** "Not yet observed" is a claim
 * about our RECORD, and it is only honest if the recording path is actually
 * wired. If production is not writing to the control plane, we have not
 * observed an absence — we have observed nothing, and saying "not yet" would
 * assert an absence with no evidence. Absence is never asserted.
 */
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
  /**
   * When the recording path last confirmed it was able to write at all. This is
   * what separates NOT_YET_OBSERVED from RECORDING_NOT_WIRED: a path that has
   * never checked in cannot testify to an absence.
   */
  readonly recorderLastSeenAt: string | null;
}

/**
 * Render the standing check, keeping the three states apart.
 *
 * Returns the owner's exact string for the not-yet case, and something
 * materially DIFFERENT for the not-wired case, because collapsing them is the
 * one thing the owner asked not to happen.
 */
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

/* ------------------------------------------------------------------ *
 * 6. OWNER DECISIONS — INTENT, NEVER A DIRECT EDIT
 * ------------------------------------------------------------------ */

/**
 * What a decision button actually does.
 *
 * **It does not edit repository authority from a browser.** The canonical
 * stores — `docs/governance/ledger.jsonl`, the tracker CSVs — are changed
 * through the governance path under normal gates, by a process that can run
 * `pnpm governance:check` and regenerate every view atomically. A web request
 * cannot do that, and a web request that tried would be writing law with no
 * validator, no compile and no regeneration: precisely the "generated artifact
 * hand-edited" failure RULING 92 and RULING 102 exist to prevent.
 *
 * So the button appends an INTENT. The intent is durable, authenticated,
 * timestamped and auditable. A later local/governance run materialises it into
 * the canonical ruling or tracker supersession under the normal gates. Until
 * that has happened and merged, the card says `PENDING_CANONICALIZATION` —
 * which is the truth, and is what stops the owner believing a decision has
 * landed when it has not.
 */
export type OwnerDecisionState =
  | "RECORDED"
  | "PENDING_CANONICALIZATION"
  | "CANONICALIZED"
  | "REJECTED_BY_GATES";

export interface OwnerDecisionIntent {
  readonly formatVersion: number;
  readonly intentId: string;
  /** The Needs-Sean row or decision card this answers. */
  readonly subjectId: string;
  /** Which option the owner picked, from the card's own option list. */
  readonly chosenOption: string;
  /** The consequence text the card showed for that option, captured as read. */
  readonly consequenceShown: string;
  readonly decidedAt: string;
  readonly state: OwnerDecisionState;
  /**
   * The canonical record this became — a ruling id or tracker resolution.
   * Null until a governance run materialises it, and the page says so.
   */
  readonly canonicalRef: string | null;
  /** Set when gates refused the materialisation, so the refusal is visible. */
  readonly refusedReason: string | null;
  /**
   * WHO decided. This is the OWNER's own session, and it is the one identity
   * in this module — an admin session id, never a reader identity, and it does
   * not join to any collection store because it exists in neither.
   */
  readonly adminSessionRef: string;
  /**
   * The owner's answer in his own words (ADM-4, 9.4.26), when he typed one
   * instead of — or as well as — picking an option. Absent on records written
   * before the field existed; a reader treats absent as null. The name is
   * deliberate: `answerText`/`freeText`/`comment` are refused by
   * `assertAggregateOnly` because on a READER record they mean something else.
   */
  readonly ownerAnswer?: string | null;
  /**
   * What the tracker did with it (ADM-16, the 9.4.26 evening feedback): the
   * follow-up row(s) the applier opened for this decision, recorded on the
   * `#resolved` twin by `scripts/canonicalize-owner-decisions.mts` from the
   * working store, so the receipt on the card can name them. Absent on a
   * record written before the field existed; empty when the choice implied
   * no work.
   */
  readonly openedWork?: readonly { readonly id: string; readonly title: string }[];
  /**
   * The tracker row's title at the moment it closed, carried on the twin so
   * the decided list can still name the row after its card has left the
   * published snapshot. Absent before the field existed.
   */
  readonly subjectTitle?: string | null;
}

/** The longest answer the dashboard accepts in the owner's own words. */
export const OWNER_ANSWER_MAX_CHARS = 2000;

/**
 * The `chosenOption` recorded when the owner typed an answer and picked no
 * option. A literal rather than an empty string, so a record can never look
 * like a decision with nothing chosen, and so the tracker applier can tell
 * the two shapes apart by reading one field.
 */
export const ANSWERED_IN_OWN_WORDS = "Answered in my own words";

/* ------------------------------------------------------------------ *
 * 7. THE SNAPSHOT THE PAGE RENDERS
 * ------------------------------------------------------------------ */

/** One contract reading, flattened for the surface, with its denominator. */
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

/** One ZIP's row in the reader-suite grid. */
export interface OwnerZipRow {
  readonly zip: string;
  readonly green: number;
  readonly red: number;
  readonly notEvaluable: number;
  /** The named failure classes seen, plain language for the owner. */
  readonly failureClasses: readonly string[];
}

/**
 * What kind of card this is (ADM-4, 9.4.26). The three are rendered
 * differently because they ask the owner for different things:
 *
 *   DECISION       a fork — pick an option or answer in your own words
 *   ACKNOWLEDGE    the work is done or the question answered; it closes on a read
 *   BLOCKED_WHILE  a machine-verifiable wall, rechecked every tracker generation;
 *                  it is not a decision and carries no buttons
 */
export type OwnerDecisionCardKind = "DECISION" | "ACKNOWLEDGE" | "BLOCKED_WHILE";

/** One decision card in the Needs-Sean queue. */
export interface OwnerDecisionCard {
  readonly rowId: string;
  readonly title: string;
  readonly whatIsNeeded: string;
  readonly whyNoMachineCanDecide: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
  /**
   * How many rows wait behind this one. NULL when nothing measured it — no
   * tracker row carries the count today — and the page says so rather than
   * printing a zero that would assert "nothing is blocked behind this".
   */
  readonly blockedDescendants: number | null;
  readonly openedOn: string | null;
  readonly ageDays: number | null;
  readonly priority: string;
  /** RULING 271: the predicate, or an explicit NOT_MACHINE_VERIFIABLE marking. */
  readonly verifiability: "PREDICATE" | "NOT_MACHINE_VERIFIABLE";
  /** Absent on a snapshot published before 9.4.26; a reader treats absent as DECISION. */
  readonly kind?: OwnerDecisionCardKind;
  /** BLOCKED_WHILE only: the predicate's blocker sentence. */
  readonly blocker?: string | null;
  /** BLOCKED_WHILE only: what the last tracker generation found when it rechecked. */
  readonly checkedThisRun?: string | null;
  /** The tracker row's own "Last verified" stamp, when it carries one. */
  readonly lastVerified?: string | null;
}

/** The kind of a card, tolerating a snapshot written before the field existed. */
export function decisionCardKind(card: OwnerDecisionCard): OwnerDecisionCardKind {
  if (card.kind) return card.kind;
  return card.verifiability === "PREDICATE" ? "BLOCKED_WHILE" : "DECISION";
}

/**
 * One cost row as published (ADM-6; the kind, the non-dollar measures and the
 * meaning added for ADM-17). The optional fields are absent on a snapshot
 * published before they existed, and the page treats absent as unknown.
 */
export interface OwnerCostRow {
  readonly key: string;
  readonly usd: Held<Measured>;
  /**
   * Requests, tokens and the cache split behind the dollars (§9A.23). Already
   * serialised by the publisher — the cost panel builds it and this snapshot
   * spreads the row straight through — so this is a type declaration catching
   * up with the data, not a new write path.
   */
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
  /** One plain sentence about the row. */
  readonly meaning?: string;
}

/**
 * The whole control centre, as one durable aggregate the runner publishes.
 *
 * One record rather than seven, because the panels must agree with each other:
 * a page assembling seven independently-timed reads can show a pilot-health
 * headline from 09:00 beside a runner status from 14:00 and present the pair as
 * one moment. The snapshot is written at one instant and read at one instant,
 * and it carries that instant.
 */
export interface OwnerSnapshot {
  /** Daily completeness, freshness and delivery counts for each place with a saved scope, newest last. Counts only; it never gates publishing. */
  readonly placeHistory?: Readonly<Record<string, readonly import("../coverage/place-history.ts").PlaceHistoryPoint[]>>;
  readonly formatVersion: number;
  readonly publishedAt: string;
  readonly publishedFromSha: string | null;
  readonly publisher: string;

  /** Panel 1 — PILOT HEALTH. */
  readonly pilotGreen: boolean | null;
  readonly contracts: readonly OwnerContractReading[];

  /** Panel 3 — the Needs-Sean queue, oldest first. */
  readonly decisionCards: readonly OwnerDecisionCard[];

  /** Panel 4 — runner obligations and debt, each with a denominator. */
  readonly obligationsByState: readonly { readonly state: string; readonly count: Measured }[];
  readonly obligationsByProvider: readonly { readonly provider: string; readonly count: Measured }[];
  readonly freshnessDebtRows: Held<Measured>;
  readonly incidents: readonly {
    readonly cause: string;
    readonly target: string;
    readonly obligationsAffected: number;
    readonly oldestHours: number | null;
  }[];

  /**
   * Panel 5 — cost. Rows carry their measured/unmeasured attempt counts (ADM-6,
   * 9.4.26); the counts are absent on a snapshot published before then.
   */
  readonly costByRole: readonly OwnerCostRow[];
  readonly costByModel: readonly OwnerCostRow[];
  readonly cacheHitRateByCaller: readonly { readonly callerKey: string; readonly hitRate: Held<Measured>; readonly health?: CacheCallerHealth }[];
  readonly deterministicShare: Held<Measured>;
  readonly costPerVerifiedRecord: Held<Measured>;
  /**
   * What the daily research ceiling buys at the measured mean (§9A.4), and the
   * UTC calendar month's spend (§9A.23). Both need an instant the cost panel
   * may not read for itself, so both are NULL on a snapshot published before
   * the publisher passed its clock — and the console says so rather than
   * drawing an undated window.
   */
  readonly costCapacity?: ScoutCapacity | null;
  readonly monthlySpend?: MonthlySpendView | null;
  /** The whole-ledger totals behind the rows. Absent before 9.4.26. */
  readonly costSummary?: {
    readonly measuredUsd: number | null;
    readonly attemptsMeasured: number;
    readonly attemptsUnmeasured: number;
    readonly entries: number;
  };

  /**
   * Panel 6 — the reader-suite grid by ZIP.
   *
   * HELD only when the run record actually attributes results to ZIPs.
   * Measured 2026-09-01: it does not — `InstanceResult` carries a hashed
   * `instanceId` (`rq:22ccea04…`) and the ZIP lives on the INSTANCE, which the
   * run record does not store. Lumping every result into one "unattributed"
   * row would have produced a grid that looks like a measurement and is not.
   */
  readonly zipRows: Held<readonly OwnerZipRow[]>;

  /** Panel 7 — owner intake. */
  readonly intakeFolder: Held<string>;
  readonly intakeItemsFound: Held<Measured>;
  readonly intakeItemsProcessed: Held<Measured>;
  readonly intakeUnidentifiable: Held<Measured>;

  /**
   * Candidate slug → the name as filed, from the committed candidate cards
   * (ADM-12, the 9.4.26 evening feedback). The page renders a candidacy key
   * by this map and NEVER re-derives a person's name from a slug. Absent on a
   * snapshot published before the field existed; a slug not in the map
   * renders as the office and the slug, honestly.
   */
  readonly candidateNames?: Readonly<Record<string, string>>;

  /**
   * Measured spend by Eastern calendar day over the trailing fortnight
   * (ADM-17): the cost ledger's measured usd, summed per day, with the
   * attempt count beside it. Absent before the field existed.
   */
  readonly spendByDay?: readonly { readonly day: string; readonly usd: number; readonly attempts: number }[];

  /**
   * Spend rolled up by place — state, then the jurisdictions under it — over
   * the whole ledger (MW-013, "what did we spend at Pima County?"). Absent on a
   * snapshot published before the field existed, which the section renders as
   * the specific missing wire rather than an empty place list that looks
   * measured.
   */
  readonly spendByPlace?: SpendByPlaceView;

  /**
   * The delivery trail (MW-053, MW-054): fleet-wide acquisition → validation →
   * publication → public availability, the refusals between the stages, the
   * blockers that hold a stage at zero, the trail's cost, and the promotion
   * history. Absent on a snapshot published before the field existed, which the
   * section renders as the specific missing wire rather than a zeroed trail that
   * looks measured. An inline type import: `delivery-trail.ts` imports the
   * honesty helpers from this file, so a value import here would be circular.
   */
  readonly deliveryTrail?: import("./delivery-trail.ts").DeliveryTrailView | null;
  readonly servedReaderReadback?: import("./served-reader.ts").ServedReaderReadback | null;

  /**
   * The assignment view (owner ask, 2026-09-22): every unit of work — standing
   * obligations, created work items, test and proof rows — counted by state,
   * lane and cost over the whole control plane, with a BOUNDED, ordered list of
   * compact rows (each carrying all seven parts) and the rule it was cut by.
   * The full chain of any assignment is read live by id on the drilldown.
   * Absent on a snapshot published before the field existed, which the page
   * renders as the specific missing wire; NOT_BUILT names why a publish could
   * not build it. Never a zeroed view. An inline type import, as above.
   */
  readonly assignments?: import("./assignment-view.ts").AssignmentPublication | null;

  /**
   * **Panel 8 — the map provider's bill** (MAPQ-5 and MAPQ-6, 2026-09-07).
   *
   * The first MapTiler billing period closed at 101,863 requests against a
   * 100,000-request free allowance while public readership was tiny, and
   * nothing in this system could say which requests were readers and which were
   * ours. This is the provider's own analytics, read with a server-side service
   * credential by the standing snapshot publisher so the console shows one
   * instant rather than seven.
   *
   * It rides on this snapshot rather than in an aggregate of its own on
   * purpose: the console already reads exactly one record for exactly this
   * reason, and a second aggregate would need a DDL change and a
   * `BOOTSTRAP_VERSION` bump for an observation already published by the
   * standing runtime.
   *
   * **Absent means the publisher never had a reading**, which is a fact about
   * our configuration. `null` and a `NOT_CONNECTED` record both render as NOT
   * CONNECTED — never as zero usage, which would read as headroom.
   */
  readonly maptiler?: MapTilerUsageSnapshot | null;
  /** Cached GET-only billing reports, written by the existing standing publisher. */
  readonly providerBilling?: import("./provider-billing.ts").ProviderBillingSnapshot | null;
  readonly billingAttribution?: import("./provider-billing-attribution.ts").BillingAttribution | null;

  /** Bounded runner reading of historical receipts; absent until the authorized publisher supplies it. */
  readonly fleetReceipts?: FleetReceiptSnapshot | null;
}

/**
 * The count claims a rendered snapshot must satisfy.
 *
 * Built from the snapshot's OWN arrays so that the check compares the number a
 * headline would state against the number of rows that actually exist to
 * render. The page then compares these against what it really emitted.
 */
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

/* ------------------------------------------------------------------ *
 * 8. THE PILOT-HEALTH READING, FLATTENED FOR AN OWNER TO ACT ON.
 *
 * The page's job is to answer, at a glance: is it healthy, which contract is
 * failing, is it FAILING or merely STALE/not-yet-proven, why, and what needs
 * attention. This is a PURE PROJECTION of the snapshot the runner already
 * published — it changes how the truth is presented, never the truth. AMBER is
 * not a new health state: it is the honest name for "not green and not a
 * failure" (a NOT_READY instrument or AWAITING_OWNER_DATA), so the owner can
 * tell a broken contract from an unproven one without reading a SHA.
 * ------------------------------------------------------------------ */

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

/** The whole compact pilot-health view: an overall band, one reason, three cards. */
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

/**
 * Project the snapshot into the compact owner view. Pure: same snapshot + clock,
 * same view. `overall` follows `pilotGreen` (green only when all three are), and
 * distinguishes a measured failure (any RED) from merely-not-proven (AMBER).
 */
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
