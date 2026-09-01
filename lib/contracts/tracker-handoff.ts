/**
 * **THE TRACKER HANDOFF CONTRACT — ONE TYPED SCHEMA, BOTH SIDES.**
 * (RULING 228, Session C, 2026-08-31.)
 *
 * > Any interface between independently built lanes — producer and consumer of
 * > a file, queue, or handoff — is defined by ONE SHARED TYPED SCHEMA imported
 * > and validated by BOTH sides, never by prose.
 *
 * ## Why this file exists rather than a paragraph in two places
 *
 * It already failed as a paragraph. Two lanes built the two halves in parallel,
 * from one specification, on one day:
 *
 * ```
 *   CONSUMER expected   data/tracker/obligation-handoff.json
 *                       { rows:        [ { trackerId, subjectId, routes  } ] }
 *   PRODUCER shipped    docs/tracker-obligation-handoff.json
 *                       { obligations: [ { rowId,     subject,   routeId } ] }
 * ```
 *
 * Different path, different envelope key, different names for the same three
 * fields — and both lanes were right by their own reading. The consumer then
 * reported ABSENT, *"the converting lane has not shipped one"*, over a file
 * sitting in the repository carrying seven named rows.
 *
 * So the shape lives HERE, once. The producer builds it. The consumer reads it.
 * `tests/tracker-handoff-contract.test.ts` runs the real producer's output into
 * the real consumer, which is the only evidence RULING 228 accepts — a fixture
 * is a THIRD reading of the paragraph and agrees with whoever wrote it.
 *
 * ## The five states, kept apart on purpose
 *
 * A seam has more than two conditions, and collapsing them is how a broken lane
 * reads as a quiet one:
 *
 * ```
 *   ABSENT                 no artifact exists. The producing lane has shipped
 *                          nothing. NEVER printable when a file is present.
 *   PRESENT_EMPTY          the artifact exists and carries zero rows. A
 *                          zero-row extraction is a FAILED extraction, so this
 *                          is a defect in the producer, not "nothing is owed".
 *   PRESENT_UNSCHEDULABLE  rows exist and NONE currently qualifies. This is the
 *                          honest state of work in progress, and it is not a
 *                          failure of either side.
 *   PARTIALLY_REGISTERED   some rows qualify and some do not.
 *   REGISTERED             every qualifying row registered.
 * ```
 *
 * `UNREADABLE` survives beside them for a file that exists and does not parse —
 * a failed READ, which is a different fact from any count.
 */

/**
 * A route this obligation can actually open.
 *
 * Structurally the scheduler's own `RouteDescriptor`. It is restated here
 * rather than imported so the CONTRACT does not depend on the consumer's
 * internals — a producer must be able to satisfy this file without importing
 * the control plane.
 */
/**
 * The route shape, which is THE SCHEDULER'S OWN and not a copy of it.
 *
 * The first draft of this file restated `RouteDescriptor` structurally —
 * `executorClass: string`, a two-field `open`. That is the divergence RULING
 * 228 forbids, written a second time in the file whose whole job is to prevent
 * it: two types that must stay in agreement will not, and the compiler would
 * have had nothing to say about it. So the contract IMPORTS the real type.
 *
 * The cost is that a producer depends on the control plane's type. That is the
 * correct cost: a route this scheduler cannot dispatch is not a route, and the
 * seam is exactly where that must fail.
 */
import type { RouteDescriptor } from "../control-plane/scheduler/registry.ts";

export type HandoffRoute = RouteDescriptor;

/** Which kinds of worker a route may declare. The scheduler narrows to these. */
export const HANDOFF_EXECUTOR_CLASSES = ["DETERMINISTIC", "BOUNDED_MODEL_WORKER"] as const;

/** One converted tracker row. */
export interface HandoffRow {
  /** The tracker row this came from. `NH27`, `AZ21`. */
  readonly trackerId: string;
  readonly recordClass: string;
  /** What is owed, as an id the scheduler can key on. */
  readonly subjectId: string;
  /** Human sentence naming the subject. Never used as an id. */
  readonly subjectLabel?: string;
  readonly readerImpactAt?: string | null;
  readonly observedChangeRateHours?: number | null;
  readonly declaredCycleHours?: number | null;
  readonly lastWorkedAt?: string | null;
  /**
   * The routes this row can be scheduled on. **May be empty**, and an empty
   * list is the normal state of a row that is converted in principle and not
   * yet executable. A row with no routes is DEFERRED, never dropped and never
   * upgraded.
   */
  readonly routes: readonly HandoffRoute[];
  /**
   * What this row lacks before it can carry a next-due, in the converting
   * lane's own words.
   *
   * Load-bearing. When a row is deferred the consumer QUOTES this rather than
   * substituting a generic "no routes" — the lane that converted the row knows
   * why it is not ready, and discarding that makes the next session rediscover
   * it.
   */
  readonly needsBeforeItCanCarryANextDue?: readonly string[];
}

export interface TrackerHandoffArtifact {
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly whatThisIs?: string;
  readonly notClosedByThisHandoff?: string;
  readonly rows: readonly HandoffRow[];
}

/** The one canonical path. A lane writes here; the scheduler reads here. */
export const HANDOFF_PATH = ["data", "tracker", "obligation-handoff.json"] as const;

export const INTAKE_STATES = [
  "ABSENT",
  "UNREADABLE",
  "PRESENT_EMPTY",
  "PRESENT_UNSCHEDULABLE",
  "PARTIALLY_REGISTERED",
  "REGISTERED",
] as const;
export type IntakeState = (typeof INTAKE_STATES)[number];

/** One row that could not be scheduled, and why — in the producer's words. */
export interface DeferredRow {
  readonly trackerId: string;
  readonly why: string;
}

/**
 * Validate an unknown value against this contract.
 *
 * Returns the problems rather than throwing, because the consumer's whole job
 * at this seam is to report precisely what came back. An empty array means the
 * artifact satisfies the contract.
 */
export function validateHandoff(value: unknown): readonly string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) {
    return ["the artifact is not an object"];
  }
  const a = value as Partial<TrackerHandoffArtifact>;
  if (!Array.isArray(a.rows)) {
    problems.push(
      "no `rows` array. The contract's one required key is missing, which is a FAILED read " +
        "against the contract and not a zero.",
    );
    return problems;
  }
  a.rows.forEach((row, i) => {
    const at = `rows[${i}]`;
    if (!row || typeof row !== "object") {
      problems.push(`${at} is not an object`);
      return;
    }
    if (typeof row.trackerId !== "string" || row.trackerId.length === 0) {
      problems.push(`${at} has no trackerId, so nothing names which tracker row this is`);
    }
    if (typeof row.subjectId !== "string" || row.subjectId.length === 0) {
      problems.push(`${at} has no subjectId, so nothing names what is owed`);
    }
    if (typeof row.recordClass !== "string" || row.recordClass.length === 0) {
      problems.push(`${at} has no recordClass`);
    }
    if (!Array.isArray(row.routes)) {
      problems.push(
        `${at} has no routes array. An EMPTY array is valid and means "converted, not yet ` +
          `executable"; a missing one means the producer did not answer the question.`,
      );
      return;
    }
    (row.routes as readonly RouteDescriptor[]).forEach((route: RouteDescriptor, j: number) => {
      if (!(HANDOFF_EXECUTOR_CLASSES as readonly string[]).includes(route?.executorClass)) {
        problems.push(
          `${at}.routes[${j}] has executorClass ${JSON.stringify(route?.executorClass)}, which is ` +
            `not one of ${HANDOFF_EXECUTOR_CLASSES.join(" | ")}. A route the scheduler cannot ` +
            `dispatch must fail HERE, at the seam, rather than deeper in.`,
        );
      }
    });
  });
  return problems;
}

/** A row is schedulable when it carries at least one route it can open. */
export function isSchedulable(row: HandoffRow): boolean {
  return Array.isArray(row.routes) && row.routes.length > 0;
}

/**
 * The state a read of this artifact is in, derived from the counts.
 *
 * Derived rather than asserted, so no caller can name a state its own numbers
 * contradict — which is how `INGESTED` came to be printed over zero usable rows.
 */
export function intakeStateFor(input: {
  readonly present: boolean;
  readonly readable: boolean;
  readonly inputRows: number;
  readonly registered: number;
}): IntakeState {
  if (!input.present) return "ABSENT";
  if (!input.readable) return "UNREADABLE";
  if (input.inputRows === 0) return "PRESENT_EMPTY";
  if (input.registered === 0) return "PRESENT_UNSCHEDULABLE";
  if (input.registered < input.inputRows) return "PARTIALLY_REGISTERED";
  return "REGISTERED";
}

/** The one line the digest prints. Counts first, because counts are checkable. */
export function intakeSummaryLine(input: {
  readonly state: IntakeState;
  readonly inputRows: number;
  readonly registered: number;
  readonly deferred: number;
}): string {
  return (
    `${input.state}: ${input.inputRows} input row(s) · ${input.registered} registered · ` +
    `${input.deferred} deferred`
  );
}
