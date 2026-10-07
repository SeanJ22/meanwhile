/** Route portability: how far the evidence supports generalizing a route. `UNKNOWN` is the honest default. */

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
  /** True when the verdict rests on `UNKNOWN` portability: the route is offered, and the offer is marked. */
  speculative: boolean;
  /** The typed grade this verdict derives from. See `gradeApplicability`. */
  grade: ApplicabilityGrade;
  /** Dimensions the predicate actually CHECKED AND MATCHED. Empty means none. */
  matchedDimensions: readonly ApplicabilityDimension[];
  /** Dimensions one side left unstated, so the predicate could not check them. */
  unstatedDimensions: readonly ApplicabilityDimension[];
  /** Dimensions both sides stated that disagreed: measured and found different, so never `PROVEN`. */
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
 * `EXCLUDED`: a dimension the route states excludes this jurisdiction. `PROVEN`: a dimension was checked and matched,
 * or evidence-backed reach covers it. `OFFERED_UNPROVEN`: offered, with nothing proven about its fit. Zero dimensions
 * matched is not proof.
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
 * Read the four typed dimensions once: matched, mismatched, or never stated by one side. A mismatch only stops the
 * verdict reaching `PROVEN`; whether it excludes is decided in `gradeApplicability`.
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

  // `a.states` records where a route was proven, not where it is confined, so state never excludes here.
  if (a.states.length === 0) unstated.push("state");
  else if (a.states.includes(j.state)) matched.push("state");
  else unstated.push("state");

  return { matched, unstated, mismatched };
}

/** The dimension each narrowing class claims as its bound: a mismatch there excludes; elsewhere it demotes. */
const CLASS_CLAIMED_DIMENSION: Partial<Record<PortabilityClass, ApplicabilityDimension>> = {
  GOVERNMENT_TYPE: "governmentType",
  PLATFORM_SPECIFIC: "platform",
  PUBLISHER_SPECIFIC: "publisher",
};

/** Grade this route's applicability to this jurisdiction; `appliesTo` is a thin wrapper over it. */
export function gradeApplicability(a: Applicability, j: Jurisdiction): ApplicabilityVerdict {
  const dims = readDimensions(a, j);
  const base = {
    matchedDimensions: dims.matched,
    unstatedDimensions: dims.unstated,
    mismatchedDimensions: dims.mismatched.map((m) => m.dimension),
  };

  // A mismatch on the class-claimed dimension excludes.
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

  // An evidence dimension that disagrees with the jurisdiction caps the grade at `OFFERED_UNPROVEN`; the route is
  // still offered.
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
  /** Offered, never withheld: `applies` stays true and only the grade changes. */
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
      // The intersection: proven somewhere this jurisdiction calls kin, never evidence the jurisdiction supplies itself.
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
      // A class naming a narrowing dimension must have matched one; `DOCUMENT_TYPE` names none, so it never reaches proof here.
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
 * Whether this route should be hunted here. The bias is toward offering: a wrongly offered route costs one empty walk,
 * a wrongly withheld one costs a fact nobody finds. Proof is `grade === "PROVEN"`.
 */
export function appliesTo(a: Applicability, j: Jurisdiction): ApplicabilityVerdict {
  return gradeApplicability(a, j);
}

/** A route is over-generalized when it claims reach its evidence does not support. */
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
