/**
 * CONTROL FACTS — the truth contract's answer key (Session A, WS-CONTRACT).
 *
 * A ControlFact is a fact the OWNER verified against a primary source, planted
 * so the audit can measure the system against known truth. Two classes, and
 * both are load-bearing: `known_present` catches the system denying a fact it
 * holds (false absence), and `known_absence` catches the worse failure — the
 * system asserting a fact where absence is verified (false presence), which in
 * this product is a false claim about a government.
 *
 * ## LABEL ISOLATION IS LOAD-BEARING
 *
 * A control only measures anything if the worker being measured cannot tell it
 * is a control. The worker-visible runtime item shape is therefore the SAME
 * shape every ordinary WorkItem has, and `assembleWorkerItem` is the one
 * boundary through which worker context is assembled. It copies an explicit
 * allowlist of worker-visible keys and mechanically refuses any path by which
 * control identity could survive into the output: a control-only key nested
 * inside a worker-visible value THROWS, and a control-only key added to the
 * allowlist itself THROWS on every call. The graders' metadata is readable
 * only by the scorer in this module.
 */

import type { WorkItem } from "../control-plane/work-item.ts";

/* ------------------------------------------------------------- the fact */

/**
 * The expected truth is a canonical proposition, value or predicate — NEVER an
 * exact natural-language answer string. Scoring a surface against one blessed
 * sentence measures phrasing, not truth; `accepted_forms` exists separately
 * for deterministic formatting where the owner wants it.
 */
export type ExpectedTruth =
  | { readonly kind: "value"; readonly subject: string; readonly value: string | number | boolean }
  | {
      readonly kind: "predicate";
      readonly predicate: string;
      readonly args: Readonly<Record<string, string | number | boolean>>;
    }
  | { readonly kind: "proposition"; readonly proposition: string };

export const FACT_CLASSES = ["known_present", "known_absence"] as const;
export type FactClass = (typeof FACT_CLASSES)[number];

export interface ControlFact {
  /** The fact, stated for a human auditor. */
  readonly statement: string;
  readonly expected_truth: ExpectedTruth;
  /** Deterministic formattings the owner also accepts. Optional. */
  readonly accepted_forms?: readonly string[];
  readonly fact_class: FactClass;
  /** The primary source the owner verified against. */
  readonly verification_source: string;
  readonly verified_by: string;
  readonly verified_date: string;
  /**
   * Required for `known_absence`: WHOSE records establish the absence, over
   * WHAT period, verified THROUGH what — an absence without an authority and
   * a period is an assertion, and absence is never asserted.
   */
  readonly authority?: string;
  readonly period?: string;
  readonly verified_through?: string;
}

/** Validation problems, named. Empty means the fact is well-formed. */
export function validateControlFact(fact: ControlFact): string[] {
  const problems: string[] = [];
  if (!fact.statement || fact.statement.trim().length === 0) {
    problems.push("statement is empty");
  }
  if (!(FACT_CLASSES as readonly string[]).includes(fact.fact_class)) {
    problems.push(`fact_class ${JSON.stringify(fact.fact_class)} is not a known class`);
  }
  if (!fact.verification_source) problems.push("verification_source is missing");
  if (!fact.verified_by) problems.push("verified_by is missing");
  if (!fact.verified_date) problems.push("verified_date is missing");
  if (fact.fact_class === "known_absence") {
    if (!fact.authority) problems.push("known_absence requires authority");
    if (!fact.period) problems.push("known_absence requires period");
    if (!fact.verified_through) problems.push("known_absence requires verified_through");
  }
  return problems;
}

export function assertValidControlFact(fact: ControlFact): void {
  const problems = validateControlFact(fact);
  if (problems.length > 0) {
    throw new Error(
      `control fact ${JSON.stringify(fact.statement ?? "<no statement>")} is invalid: ` +
        problems.join("; "),
    );
  }
}

/* --------------------------------------------------- the isolation boundary */

/**
 * The worker-visible runtime item shape — the SAME shape ordinary non-control
 * work items have. It IS `WorkItem`; a distinct worker type would itself be a
 * label.
 */
export type WorkerVisibleItem = WorkItem;

/**
 * THE ALLOWLIST. Exactly `WorkItem`'s own keys, and nothing else, ever.
 * `tests/control-isolation.test.ts` asserts this list never intersects
 * `CONTROL_ONLY_KEYS`, and `assembleWorkerItem` refuses at runtime if it does.
 */
export const WORKER_VISIBLE_KEYS = [
  "id",
  "project",
  "subject",
  "obligation",
  "why",
  "priority",
  "state",
  "contract",
  "dependencies",
  "routeTaskIds",
  "escalations",
  "createdAt",
  "transitions",
] as const;

/**
 * Every key that carries control identity, in both naming conventions, so a
 * renamed field cannot slip past the scan.
 */
export const CONTROL_ONLY_KEYS = [
  "control",
  "controlFact",
  "control_fact",
  "isControl",
  "is_control",
  "fact_class",
  "factClass",
  "expected_truth",
  "expectedTruth",
  "accepted_forms",
  "acceptedForms",
  "verification_source",
  "verificationSource",
  "verified_by",
  "verifiedBy",
  "verified_date",
  "verifiedDate",
  "verified_through",
  "verifiedThrough",
] as const;

/**
 * A control item as the HARNESS holds it: an ordinary item plus the control
 * metadata. Only this module's scorer and the control harness may read
 * `control`; the boundary below is what everything worker-facing goes through.
 */
export interface ControlCarryingItem {
  readonly item: WorkItem;
  readonly control: {
    readonly fact: ControlFact;
    /** Ties an observation back to its fact. Never worker-visible. */
    readonly controlId: string;
  };
}

function scanForControlMarkers(value: unknown, path: string, problems: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, i) => scanForControlMarkers(entry, `${path}[${i}]`, problems));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if ((CONTROL_ONLY_KEYS as readonly string[]).includes(key)) {
      problems.push(`${path}.${key}`);
    }
    scanForControlMarkers(entry, `${path}.${key}`, problems);
  }
}

/**
 * THE CONTEXT-ASSEMBLY BOUNDARY. Everything a worker sees comes through here.
 *
 * - Copies ONLY the allowlisted worker-visible keys.
 * - THROWS if the allowlist itself has been widened onto a control-only key —
 *   the failure seeded by `tests/control-isolation.test.ts`.
 * - THROWS if any control marker would survive into the output (a control-only
 *   key nested inside a worker-visible value), rather than shipping a labelled
 *   control to the worker it is supposed to measure.
 *
 * A top-level control-only key on the INPUT is stripped, not thrown: the
 * harness legitimately holds control-carrying shapes, and the boundary's job
 * is that nothing control-shaped comes out the other side.
 */
export function assembleWorkerItem(item: Record<string, unknown>): WorkerVisibleItem {
  for (const key of WORKER_VISIBLE_KEYS) {
    if ((CONTROL_ONLY_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `the worker-visible allowlist contains control-only key "${key}". Label isolation ` +
          "is load-bearing: a worker that can read control identity is a worker being " +
          "graded on an open-book exam. Refusing to assemble any worker context.",
      );
    }
  }
  const out: Record<string, unknown> = {};
  for (const key of WORKER_VISIBLE_KEYS) {
    if (key in item) out[key] = structuredClone(item[key]);
  }
  const survivors: string[] = [];
  scanForControlMarkers(out, "item", survivors);
  if (survivors.length > 0) {
    throw new Error(
      `control marker(s) would survive into worker-visible context: ${survivors.join(", ")}. ` +
        "The boundary refuses rather than strips a nested marker — a value shaped to smuggle " +
        "control identity past the allowlist is a defect to fix, not to launder.",
    );
  }
  return out as unknown as WorkerVisibleItem;
}

/* ---------------------------------------------------------------- scoring */

/**
 * What the audited surface did with one control fact's subject, observed by
 * the harness. Joined to facts by `statement` — the fact's own identity.
 */
export interface ControlObservation {
  readonly statement: string;
  readonly observed:
    /** The surface stated the fact (matching expected_truth / an accepted form). */
    | "FACT_STATED"
    /** The surface rendered its named gap — "we haven't recorded this yet". */
    | "GAP_NAMED"
    /** The surface asserted the fact is absent — "there is no such thing". */
    | "ABSENCE_ASSERTED";
}

/** The scores, with every denominator explicit. Null rate = empty denominator. */
export interface ControlScore {
  /** Denominator for recall and false-absence rate. */
  readonly knownPresentCount: number;
  /** Denominator for false-presence rate. */
  readonly knownAbsenceCount: number;
  readonly recalled: number;
  readonly falseAbsences: number;
  readonly falsePresences: number;
  /** Facts loaded but never observed. Reported, never silently fine. */
  readonly unobserved: number;
  readonly recall: number | null;
  readonly falseAbsenceRate: number | null;
  readonly falsePresenceRate: number | null;
}

/**
 * Score observations against the answer key.
 *
 * - known_present + FACT_STATED      → recalled
 * - known_present + ABSENCE_ASSERTED → FALSE ABSENCE (denying a verified fact)
 * - known_present + GAP_NAMED        → not recalled, and honestly so
 * - known_absence + FACT_STATED      → FALSE PRESENCE (asserting where absence is verified)
 * - known_absence + otherwise        → correct
 *
 * An observation naming a statement the key does not hold throws: a scorer
 * that ignores unknown observations is a scorer that can be fed green.
 */
export function scoreControls(
  facts: readonly ControlFact[],
  observations: readonly ControlObservation[],
): ControlScore {
  const byStatement = new Map(facts.map((f) => [f.statement, f]));
  if (byStatement.size !== facts.length) {
    throw new Error("two control facts share one statement — identity here is the statement");
  }
  const seen = new Set<string>();
  let recalled = 0;
  let falseAbsences = 0;
  let falsePresences = 0;
  for (const observation of observations) {
    const fact = byStatement.get(observation.statement);
    if (!fact) {
      throw new Error(
        `observation about ${JSON.stringify(observation.statement)} matches no loaded control fact`,
      );
    }
    if (seen.has(observation.statement)) {
      throw new Error(`duplicate observation for ${JSON.stringify(observation.statement)}`);
    }
    seen.add(observation.statement);
    if (fact.fact_class === "known_present") {
      if (observation.observed === "FACT_STATED") recalled += 1;
      if (observation.observed === "ABSENCE_ASSERTED") falseAbsences += 1;
    } else {
      if (observation.observed === "FACT_STATED") falsePresences += 1;
    }
  }
  const knownPresentCount = facts.filter((f) => f.fact_class === "known_present").length;
  const knownAbsenceCount = facts.length - knownPresentCount;
  return {
    knownPresentCount,
    knownAbsenceCount,
    recalled,
    falseAbsences,
    falsePresences,
    unobserved: facts.length - seen.size,
    recall: knownPresentCount === 0 ? null : recalled / knownPresentCount,
    falseAbsenceRate: knownPresentCount === 0 ? null : falseAbsences / knownPresentCount,
    falsePresenceRate: knownAbsenceCount === 0 ? null : falsePresences / knownAbsenceCount,
  };
}
