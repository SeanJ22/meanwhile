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
 */
export function appliesTo(a: Applicability, j: Jurisdiction): ApplicabilityVerdict {
  const speculative = a.portability === "UNKNOWN";

  if (a.publishers.length && j.publisher && !a.publishers.includes(j.publisher)) {
    return { applies: false, reason: `publisher-specific to ${a.publishers.join(", ")}`, speculative: false };
  }
  if (a.platforms.length && j.platform && !a.platforms.includes(j.platform)) {
    return { applies: false, reason: `platform-specific to ${a.platforms.join(", ")}`, speculative: false };
  }
  if (
    a.governmentTypes.length &&
    j.governmentType &&
    !a.governmentTypes.includes(j.governmentType)
  ) {
    return {
      applies: false,
      reason: `government-type-specific to ${a.governmentTypes.join(", ")}`,
      speculative: false,
    };
  }

  switch (a.portability) {
    case "NATIONWIDE":
      return { applies: true, reason: "nationwide", speculative: false };
    case "STATE_SPECIFIC":
    case "JURISDICTION_SPECIFIC":
      return a.states.includes(j.state)
        ? { applies: true, reason: `proven in ${j.state}`, speculative: false }
        : {
            applies: false,
            reason: `${a.portability.toLowerCase().replace("_", "-")} to ${a.states.join(", ") || "an unrecorded state"}`,
            speculative: false,
          };
    case "STATE_FAMILY": {
      const family = new Set([...a.states, ...(j.family ?? [])]);
      return family.has(j.state)
        ? { applies: true, reason: `state family includes ${j.state}`, speculative: false }
        : {
            applies: false,
            reason: `state-family route; ${j.state} is not in ${[...family].join(", ") || "the recorded family"}`,
            speculative: false,
          };
    }
    case "GOVERNMENT_TYPE":
    case "PLATFORM_SPECIFIC":
    case "PUBLISHER_SPECIFIC":
    case "DOCUMENT_TYPE":
      // The narrowing dimension was checked above and did not exclude it —
      // either it matched, or the jurisdiction did not state that dimension.
      return { applies: true, reason: `${a.portability.toLowerCase()} match not excluded`, speculative: false };
    case "UNKNOWN":
    default:
      return {
        applies: true,
        reason: "portability unknown — offered, not proven (RULING 178)",
        speculative,
      };
  }
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
