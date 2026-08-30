/**
 * Route portability — how far the evidence supports generalizing a route.
 *
 * ## Why this is a typed class and not prose
 *
 * `lib/hunt/branch-manifest.ts` already carries `expectedToTravel` on 63 of its
 * routes, and it is a `string`. The sentences in it are good — honest,
 * specific, often better than a label would be. What a sentence cannot do is be
 * QUERIED, and the two questions this system has to answer mechanically are:
 *
 *   - which of the routes we know apply to a jurisdiction we have never
 *     touched?
 *   - which prior conclusions does a newly learned route reopen?
 *
 * Neither can be answered by reading prose, which is why "a new route reopens
 * old absences" has been true in principle since RULING 61 and has never once
 * happened automatically.
 *
 * So the prose STAYS — it is the reasoning, and this repository requires a rule
 * to ship with its reasoning — and a typed class sits beside it.
 *
 * ## `UNKNOWN` is a valid answer and it is the DEFAULT
 *
 * RULING 178: do not generalize farther than the evidence supports. A route
 * proven in one New England town has been proven for that SHAPE, and New
 * England town government is one of the stranger shapes in the country. The
 * default is therefore the honest one, and a route claiming to be `NATIONWIDE`
 * has to have been walked somewhere that earns it.
 */

/** How far a route's evidence reaches. Ordered from widest to narrowest. */
export const PORTABILITY_CLASSES = [
  "NATIONWIDE",
  "STATE_FAMILY",
  "STATE_SPECIFIC",
  "GOVERNMENT_TYPE",
  "PUBLISHER_SPECIFIC",
  "PLATFORM_SPECIFIC",
  "DOCUMENT_TYPE",
  "JURISDICTION_SPECIFIC",
  "UNKNOWN",
] as const;
export type PortabilityClass = (typeof PORTABILITY_CLASSES)[number];

export const DEFAULT_PORTABILITY: PortabilityClass = "UNKNOWN";

export interface Applicability {
  portability: PortabilityClass;
  /** State codes this route is known to apply to. Empty means unconstrained. */
  states: string[];
  /** Government types (`township`, `borough`, `parish`, `school_district`, …). */
  governmentTypes: string[];
  /** Vendor platforms (`granicus`, `civicplus`, `boarddocs`, …). */
  platforms: string[];
  /** Publishers (hosts or agencies) this route is tied to. */
  publishers: string[];
  /** Free prose — the reasoning. Never deleted in favour of the class. */
  note: string;
}

export function unknownApplicability(note = ""): Applicability {
  return {
    portability: DEFAULT_PORTABILITY,
    states: [],
    governmentTypes: [],
    platforms: [],
    publishers: [],
    note,
  };
}

/** The jurisdiction a route is being considered for. */
export interface Jurisdiction {
  state: string;
  governmentType?: string;
  platform?: string;
  publisher?: string;
  /** States whose government resembles this one, if known. */
  family?: string[];
}

export interface ApplicabilityVerdict {
  applies: boolean;
  /** Why — stated, because "applies: false" with no reason is unauditable. */
  reason: string;
  /**
   * True when the verdict rests on UNKNOWN portability rather than on
   * evidence. An unknown route is OFFERED to a new jurisdiction — inheritance
   * is the starting advantage of a new state (RULING 178) — but the offer is
   * marked, so a report can never claim the route was known to fit.
   */
  speculative: boolean;
  /** The typed grade this verdict derives from. See `gradeApplicability`. */
  grade: ApplicabilityGrade;
  /** Dimensions the predicate actually CHECKED AND MATCHED. Empty means none. */
  matchedDimensions: readonly ApplicabilityDimension[];
  /**
   * Dimensions the route or the jurisdiction left UNSTATED, so the predicate
   * could not check them. This is the audit trail for "why did this flow
   * through?" and it is a field rather than a sentence so a report can print it.
   */
  unstatedDimensions: readonly ApplicabilityDimension[];
  /**
   * Dimensions BOTH sides stated and that DISAGREED. (2026-08-30.)
   *
   * A mismatch on an EVIDENCE dimension is the third state the old two-column
   * audit trail could not represent: it is neither a match nor an absence.
   * A route whose recorded government-type evidence is all `school_district`
   * being considered for a `county` has not matched anything and has not been
   * left unstated — it has been measured and found different, and the verdict
   * that carries that measurement is OFFERED_UNPROVEN, never PROVEN. See the
   * module note on `gradeApplicability` for which mismatches EXCLUDE instead.
   */
  mismatchedDimensions: readonly ApplicabilityDimension[];
}

/** The typed dimensions applicability can be narrowed on. */
export const APPLICABILITY_DIMENSIONS = [
  "state",
  "governmentType",
  "platform",
  "publisher",
] as const;
export type ApplicabilityDimension = (typeof APPLICABILITY_DIMENSIONS)[number];

/**
 * **THE THREE ANSWERS, AND THE MIDDLE ONE IS NOT A BOOLEAN.**
 *
 * `appliesTo` used to answer one question with `applies: boolean` and hang a
 * `speculative` flag off the side. Every consumer that read `.applies` got
 * "yes" for both a route PROVEN here and a route merely OFFERED here — and one
 * of those consumers is `evaluateCompletion`, whose whole job is to know the
 * difference. Its refusal says "Inherited route X **is applicable to this
 * subject**", which for an UNKNOWN-portability offer is a claim this module
 * explicitly refuses to make one struct over.
 *
 * So the answer is graded:
 *
 *   - `EXCLUDED` — a typed dimension the route STATES excludes this jurisdiction.
 *   - `PROVEN` — at least one dimension was checked AND MATCHED, or the route
 *     carries evidence-backed reach that covers this jurisdiction.
 *   - `OFFERED_UNPROVEN` — the route is still offered, because RULING 178's bias
 *     is toward offering, but NOTHING was proven about its fit here.
 *
 * **ZERO DIMENSIONS MATCHED IS NOT PROOF.** That sentence is the fix. The old
 * code returned `speculative: false` for `GOVERNMENT_TYPE`, `PLATFORM_SPECIFIC`,
 * `PUBLISHER_SPECIFIC` and `DOCUMENT_TYPE` with the reason "match not excluded"
 * — granting proven status to a route that named a narrowing dimension and then
 * left it EMPTY, or whose jurisdiction never stated that dimension. That is
 * exactly how a school-district technique becomes a proven county route: not by
 * matching anything, but by there being nothing to fail. An underspecified
 * constraint is an ABSENT constraint, and an absent constraint proves nothing.
 */
export const APPLICABILITY_GRADES = ["EXCLUDED", "PROVEN", "OFFERED_UNPROVEN"] as const;
export type ApplicabilityGrade = (typeof APPLICABILITY_GRADES)[number];

interface DimensionMismatch {
  dimension: ApplicabilityDimension;
  reason: string;
}

interface DimensionReading {
  matched: ApplicabilityDimension[];
  unstated: ApplicabilityDimension[];
  mismatched: DimensionMismatch[];
}

/**
 * Read the four typed dimensions once, and record for each one whether it
 * MATCHED, MISMATCHED, or was never stated by one side or the other.
 *
 * "Never stated" is tracked separately from "matched" on purpose. Collapsing
 * them is the whole defect: a route with `publishers: []` and a jurisdiction
 * with no publisher have not agreed about anything.
 *
 * **A MISMATCH IS A READING, NOT A VERDICT.** (2026-08-30.) This function used
 * to convert the first mismatch on publisher, platform or government type into
 * `excludedBy` — an exclusion — for EVERY portability class. That was correct
 * for a route whose CLASS claims that bound (`PLATFORM_SPECIFIC` means "this
 * technique is the platform's"), and wrong for every other class, where the
 * populated dimension is a RECORD OF WHERE THE ROUTE WAS PROVEN, exactly like
 * `states` below. A route proven on `apptegy` school-district sites is not
 * thereby proven to FAIL on a `legistar` county portal, and excluding it there
 * would withhold a route on evidence that was never a constraint — the
 * expensive direction (RULING 178), and the same collapse the `states` comment
 * below has always refused. Which mismatches are entitled to EXCLUDE is decided
 * in `gradeApplicability`, where the route's class actually claims the bound.
 * What a mismatch always does is stop the verdict reaching PROVEN.
 */
function readDimensions(a: Applicability, j: Jurisdiction): DimensionReading {
  const matched: ApplicabilityDimension[] = [];
  const unstated: ApplicabilityDimension[] = [];
  const mismatched: DimensionMismatch[] = [];

  const check = (
    dimension: ApplicabilityDimension,
    routeValues: readonly string[],
    jurisdictionValue: string | undefined,
    reason: string,
  ): void => {
    if (routeValues.length === 0 || !jurisdictionValue) {
      unstated.push(dimension);
      return;
    }
    if (routeValues.includes(jurisdictionValue)) matched.push(dimension);
    else mismatched.push({ dimension, reason });
  };

  check("publisher", a.publishers, j.publisher, `publisher-specific to ${a.publishers.join(", ")}`);
  check("platform", a.platforms, j.platform, `platform-specific to ${a.platforms.join(", ")}`);
  check(
    "governmentType",
    a.governmentTypes,
    j.governmentType,
    `government-type-specific to ${a.governmentTypes.join(", ")}`,
  );

  /*
   * STATE IS READ, AND IT MAY NOT EXCLUDE HERE.
   *
   * `a.states` is a record of where a route has been PROVEN, not a declaration
   * of where it is confined. A route walked once in New Hampshire that says
   * nothing about its reach is an UNKNOWN route with one data point, and
   * refusing to offer it in Arizona would withhold a route on evidence that was
   * never a constraint — the expensive direction (RULING 178). Which portability
   * classes are entitled to EXCLUDE on state is decided in the switch below,
   * where the route has actually claimed a state-bounded reach.
   */
  if (a.states.length === 0) unstated.push("state");
  else if (a.states.includes(j.state)) matched.push("state");
  else unstated.push("state");

  return { matched, unstated, mismatched };
}

/**
 * The dimension each narrowing class CLAIMS as its bound. A mismatch on the
 * claimed dimension is the route saying "I am the platform's technique and this
 * is not that platform" — an exclusion. A mismatch on any OTHER dimension is a
 * disagreement between the jurisdiction and the route's evidence record, and it
 * demotes rather than excludes.
 */
const CLASS_CLAIMED_DIMENSION: Partial<Record<PortabilityClass, ApplicabilityDimension>> = {
  GOVERNMENT_TYPE: "governmentType",
  PLATFORM_SPECIFIC: "platform",
  PUBLISHER_SPECIFIC: "publisher",
};

/**
 * Grade this route's applicability to this jurisdiction.
 *
 * `gradeApplicability` is the rule. `appliesTo` is a thin compatibility wrapper
 * over it, so there is exactly one implementation and no way for the boolean and
 * the grade to drift apart.
 */
export function gradeApplicability(a: Applicability, j: Jurisdiction): ApplicabilityVerdict {
  const dims = readDimensions(a, j);
  const base = {
    matchedDimensions: dims.matched,
    unstatedDimensions: dims.unstated,
    mismatchedDimensions: dims.mismatched.map((m) => m.dimension),
  };

  /*
   * A MISMATCH ON THE CLASS-CLAIMED DIMENSION EXCLUDES. A `GOVERNMENT_TYPE`
   * route that states `town` does not travel to a parish — the class IS the
   * constraint, and failing it is the one honest exclusion these three
   * dimensions can produce (the behaviour the old code applied to every class).
   */
  const claimedDimension = CLASS_CLAIMED_DIMENSION[a.portability];
  const claimedMismatch = dims.mismatched.find((m) => m.dimension === claimedDimension);
  if (claimedMismatch) {
    return {
      applies: false,
      reason: claimedMismatch.reason,
      speculative: false,
      grade: "EXCLUDED",
      ...base,
    };
  }

  /*
   * **AN EVIDENCE MISMATCH DEMOTES PROOF; IT NEVER WITHHOLDS THE ROUTE.**
   * (2026-08-30.)
   *
   * This is the government-type-aware half of the school-district-to-county
   * fix. The first half (2026-08-29) stopped an EMPTY dimension counting as
   * proof. This half stops a POPULATED one being ignored: a route whose
   * `states` says `az` reaches `proven("proven in az")` below for an Arizona
   * COUNTY even when every walk that earned that state was a school district —
   * outcome jurisdiction at state granularity cannot see the difference, but
   * the typed `governmentTypes` evidence can, and a proof that survives only by
   * not reading it is the leak. So every `proven(...)` passes through this
   * gate: a recorded evidence dimension that DISAGREES with the jurisdiction
   * caps the grade at OFFERED_UNPROVEN. The route is still offered — a
   * school-district technique is a legitimate EXPERIMENT for a county, and
   * withholding it would be the expensive direction — it just cannot be
   * REQUIRED, because "known to fit here" is exactly what the mismatch denies.
   */
  const demoted = (provedAs: string): string =>
    `${provedAs}, but recorded ${dims.mismatched
      .map((m) => m.reason)
      .join("; ")} and this jurisdiction is not — evidence disagrees on ` +
    `${dims.mismatched.map((m) => m.dimension).join("+")}, so the fit here is offered, not proven (RULING 178)`;

  const proven = (reason: string): ApplicabilityVerdict =>
    dims.mismatched.length > 0
      ? {
          applies: true,
          reason: demoted(reason),
          speculative: true,
          grade: "OFFERED_UNPROVEN",
          ...base,
        }
      : {
          applies: true,
          reason,
          speculative: false,
          grade: "PROVEN",
          ...base,
        };
  /**
   * OFFERED, never withheld. `applies` stays true so no route is ever dropped
   * from a hunt — RULING 178's bias is untouched. What changes is the GRADE,
   * which is what a consumer needing proof must read.
   */
  const offered = (reason: string): ApplicabilityVerdict => ({
    applies: true,
    reason,
    speculative: true,
    grade: "OFFERED_UNPROVEN",
    ...base,
  });

  switch (a.portability) {
    case "NATIONWIDE":
      // The only class whose evidence is, by its own claim, unnarrowed.
      // `overGeneralized` is the guard that stops it being claimed cheaply.
      return proven("nationwide");

    case "STATE_SPECIFIC":
    case "JURISDICTION_SPECIFIC":
      return a.states.includes(j.state)
        ? proven(`proven in ${j.state}`)
        : {
            applies: false,
            reason: `${a.portability.toLowerCase().replace("_", "-")} to ${a.states.join(", ") || "an unrecorded state"}`,
            speculative: false,
            grade: "EXCLUDED",
            ...base,
          };

    case "STATE_FAMILY": {
      /*
       * THE INTERSECTION, NOT THE UNION — and the old code had it backwards.
       *
       * It built `new Set([...a.states, ...j.family])` and asked whether
       * `j.state` was in it. A jurisdiction that lists ITSELF in its own family
       * therefore proved every state-family route applied to it: the subject
       * supplied the evidence for the claim about the subject. The honest
       * question is whether the route was PROVEN SOMEWHERE this jurisdiction
       * calls kin, so it is `a.states ∩ ({j.state} ∪ j.family)`.
       */
      const kin = new Set([j.state, ...(j.family ?? [])]);
      const shared = a.states.filter((s) => kin.has(s));
      if (shared.length > 0) return proven(`proven in ${shared.join(", ")}, kin to ${j.state}`);
      return {
        applies: false,
        reason:
          `state-family route proven in ${a.states.join(", ") || "no recorded state"}; ` +
          `none is kin to ${j.state}`,
        speculative: false,
        grade: "EXCLUDED",
        ...base,
      };
    }

    case "GOVERNMENT_TYPE":
    case "PLATFORM_SPECIFIC":
    case "PUBLISHER_SPECIFIC":
    case "DOCUMENT_TYPE": {
      /*
       * A CLASS THAT NAMES A NARROWING DIMENSION MUST HAVE MATCHED ONE.
       *
       * `DOCUMENT_TYPE` names no dimension in `Applicability` at all, so it can
       * never reach proof through this path — which is honest: nothing in the
       * type system records which document type it means.
       */
      const required: Partial<Record<PortabilityClass, ApplicabilityDimension>> = {
        GOVERNMENT_TYPE: "governmentType",
        PLATFORM_SPECIFIC: "platform",
        PUBLISHER_SPECIFIC: "publisher",
      };
      const dimension = required[a.portability];
      if (dimension && dims.matched.includes(dimension)) {
        return proven(`${a.portability.toLowerCase()} match on ${dimension}`);
      }
      return offered(
        `${a.portability.toLowerCase()} but ${
          dimension
            ? `its ${dimension} constraint is unstated on one side — not excluded is not matched`
            : "the class names no checkable dimension"
        } (RULING 178: offered, not proven)`,
      );
    }

    case "UNKNOWN":
    default:
      return offered("portability unknown — offered, not proven (RULING 178)");
  }
}

/**
 * Does this route apply here?
 *
 * The bias is deliberately toward OFFERING the route. A route wrongly offered
 * costs one walk that returns nothing, and RULING 88 says a newly conceived
 * route returning nothing is a reported success. A route wrongly WITHHELD costs
 * a fact nobody finds, and nothing in the system would ever surface that. Those
 * are not comparable, which is the same reasoning the deploy-path allowlist
 * uses in RULING 124.
 *
 * `applies` therefore answers "should this be hunted here?", which is a
 * different question from "is it known to fit here?". The second is
 * `grade === "PROVEN"`, and a consumer that needs proof must ask for it by name.
 */
export function appliesTo(a: Applicability, j: Jurisdiction): ApplicabilityVerdict {
  return gradeApplicability(a, j);
}

/**
 * A route is over-generalized when it claims reach its evidence does not
 * support. `NATIONWIDE` on a route walked in one state is the specific failure
 * RULING 60 was adopted over: the route that reaches a Newbury board will not
 * reach a borough in Alaska, an unincorporated county in Arizona, or a parish
 * in Louisiana.
 */
export function overGeneralized(
  a: Applicability,
  provenStates: readonly string[],
): string | null {
  if (a.portability === "NATIONWIDE" && provenStates.length < 3) {
    return `claims NATIONWIDE on evidence from ${provenStates.length} state(s): ${provenStates.join(", ") || "none"}`;
  }
  if (a.portability === "STATE_FAMILY" && provenStates.length < 2) {
    return `claims STATE_FAMILY on evidence from ${provenStates.length} state(s)`;
  }
  if (
    (a.portability === "STATE_SPECIFIC" || a.portability === "JURISDICTION_SPECIFIC") &&
    a.states.length === 0
  ) {
    return `claims ${a.portability} but names no state`;
  }
  return null;
}
