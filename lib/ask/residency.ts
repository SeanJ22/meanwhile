/**
 * **WHERE A READER SAYS THEY LIVE, AND HOW WELL WE KNOW IT.**
 * (ASK03, 2026-08-27. The author's product rule of the same date.)
 *
 * ## Two questions, deliberately not one enum
 *
 * A single "location confidence" field would have to answer two unrelated
 * questions at once and would answer both badly:
 *
 * 1. **What is this location TO the reader?** Home, somewhere they are moving
 *    to, or somewhere they are just looking at.
 * 2. **How strongly is it EVIDENCED?** A typed ZIP, a resolved address, a
 *    verified account.
 *
 * They are orthogonal. A reader can name a prospective home with a fully
 * validated address, or their true home with nothing but a typed ZIP.
 * Collapsing them forces a buyer-facing sentence to imply one from the other,
 * which is exactly the false inference this model exists to prevent.
 *
 * ## The author's rule, and its limit
 *
 * > The initial ZIP a reader voluntarily enters is treated as their
 * > self-declared home ZIP unless the reader later gives the product reason to
 * > classify that location differently.
 *
 * That is real signal and it is not thrown away. It is also **not** an
 * address-verified residence, and the two must never be spoken as one:
 *
 * ```
 *   "readers who identified 85641 as their home ZIP"        TRUE
 *   "address-validated residents of Vail Unified District"  NOT SUPPORTED
 * ```
 *
 * The second sentence needs `ADDRESS_RESOLVED` or better AND a division the
 * geometry actually placed the address inside. `zipCohortOnly` below is the
 * mechanical answer to which sentence a row can carry.
 *
 * ## ZIP seams are why this matters
 *
 * A ZIP can cross municipal, school, legislative, fire, special-district and
 * county lines. 85641 does. So a self-declared home ZIP establishes a useful
 * ZIP COHORT and frequently does NOT establish an exact governing unit, and
 * that uncertainty is preserved rather than rounded away.
 */

/** What this location IS to the reader. */
export type ResidencyRelation =
  /** They told us this is where they live. */
  | "CURRENT_HOME"
  /** They used the moving-here entry. A distinct and separately valuable cohort. */
  | "PROSPECTIVE_HOME"
  /** They are looking at somewhere that is not theirs. */
  | "BROWSING"
  | "UNKNOWN";

/**
 * How strongly the location is evidenced. Ordered weakest to strongest, and
 * each value names WHAT IT ACTUALLY PROVES rather than how it was obtained.
 */
export type LocationConfidence =
  | "UNVERIFIED"
  /** A ZIP the reader typed. Proves a ZIP cohort. Does NOT prove a district. */
  | "SELF_DECLARED_ZIP"
  /** An address resolved to a point, so exact divisions ARE known. */
  | "ADDRESS_RESOLVED"
  /** The address was checked against an authoritative address record. */
  | "ADDRESS_VALIDATED"
  | "UNKNOWN";

/**
 * **HOW THE LOCATION GOT THERE — a fact about what the reader DID.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * The two enums above are CONCLUSIONS, and a conclusion arriving in a request
 * body is a conclusion the client asserted. A surface that sent
 * `ADDRESS_VALIDATED` would be believed, and every aggregate built on that
 * column would then be describing a validation that never happened.
 *
 * So the wire carries the ORIGIN — the observable act — and the conclusions are
 * derived here, on the server, by `stampResidency`. The client says *"they
 * typed this ZIP"*; it does not get to say what that proves.
 */
export type LocationOrigin =
  /** They typed a ZIP into the location entry. The author's rule case. */
  | "TYPED_ZIP"
  /** They tapped one of the four demonstration ZIPs on the welcome card. */
  | "DEMO_ZIP"
  /** The browser's own geolocation resolved to a nearby ZIP. */
  | "DEVICE_LOCATION"
  /** They came through an entry that says they are considering moving here. */
  | "PROSPECTIVE_ENTRY"
  /** An address was resolved to a point, so exact divisions are known. */
  | "ADDRESS_RESOLVED"
  | "UNKNOWN";

export const LOCATION_ORIGINS: LocationOrigin[] = [
  "TYPED_ZIP",
  "DEMO_ZIP",
  "DEVICE_LOCATION",
  "PROSPECTIVE_ENTRY",
  "ADDRESS_RESOLVED",
  "UNKNOWN",
];

/** Read an origin off a request body, refusing anything not on the list. */
export function readLocationOrigin(raw: unknown): LocationOrigin {
  return LOCATION_ORIGINS.includes(raw as LocationOrigin)
    ? (raw as LocationOrigin)
    : "UNKNOWN";
}

/**
 * **THE ONLY PLACE A ROW'S TWO LOCATION AXES ARE DECIDED.**
 *
 * Each mapping is defended by what the act actually proves, and two of them are
 * deliberately weaker than they could be:
 *
 * - **`DEMO_ZIP` is BROWSING, not home.** The welcome card offers four ZIPs so
 *   nobody has to know one to see the product work. A reader who taps *Vail,
 *   AZ* has told us they wanted to look at Vail. They have not told us they
 *   live there, and a resident cohort built from chip taps would be a
 *   constituency claim made out of a demo affordance. `countsAsResident` is
 *   false for it, which is the conservative direction.
 * - **`DEVICE_LOCATION` proves PRESENCE, never RESIDENCE.** A geolocation fix
 *   says where a device is right now. It does not say whose home that is, and
 *   it is not a ZIP the reader declared. So the relation is `UNKNOWN` and the
 *   confidence is `UNVERIFIED` — we hold a place and no claim about it.
 *
 * `TYPED_ZIP` is the author's rule, applied exactly as he stated it: a
 * voluntarily entered ZIP is a self-declared home ZIP unless the reader later
 * gives us reason to classify it otherwise.
 */
export function stampResidency(origin: LocationOrigin): {
  relation: ResidencyRelation;
  confidence: LocationConfidence;
} {
  switch (origin) {
    case "TYPED_ZIP":
      return { relation: "CURRENT_HOME", confidence: "SELF_DECLARED_ZIP" };
    case "PROSPECTIVE_ENTRY":
      return { relation: "PROSPECTIVE_HOME", confidence: "SELF_DECLARED_ZIP" };
    case "DEMO_ZIP":
      return { relation: "BROWSING", confidence: "SELF_DECLARED_ZIP" };
    case "ADDRESS_RESOLVED":
      return { relation: "CURRENT_HOME", confidence: "ADDRESS_RESOLVED" };
    case "DEVICE_LOCATION":
      return { relation: "UNKNOWN", confidence: "UNVERIFIED" };
    default:
      return { relation: "UNKNOWN", confidence: "UNKNOWN" };
  }
}

export const RESIDENCY_RELATIONS: ResidencyRelation[] = [
  "CURRENT_HOME",
  "PROSPECTIVE_HOME",
  "BROWSING",
  "UNKNOWN",
];

export const LOCATION_CONFIDENCES: LocationConfidence[] = [
  "UNVERIFIED",
  "SELF_DECLARED_ZIP",
  "ADDRESS_RESOLVED",
  "ADDRESS_VALIDATED",
  "UNKNOWN",
];

/**
 * **May a row be counted as a member of an exact governing district?**
 *
 * True means ZIP-cohort only: the row may be aggregated as "readers who
 * identified <zip> as their home ZIP" and may NOT be aggregated as residents of
 * any district that ZIP merely overlaps.
 *
 * This is the single mechanical gate between a true buyer sentence and a false
 * one, so it is a function rather than a convention — a convention would be
 * re-derived by every export path and one of them would get it wrong.
 */
export function zipCohortOnly(confidence: LocationConfidence): boolean {
  return confidence !== "ADDRESS_RESOLVED" && confidence !== "ADDRESS_VALIDATED";
}

/**
 * **Does this row count toward "current residents of X"?**
 *
 * A prospective mover is not a resident, and a browsing reader is not one
 * either. Both are worth counting — separately. Silently folding a
 * moving-here reader into a resident cohort would misstate a constituency to a
 * campaign, which is the buyer-facing version of a wrong fact.
 */
export function countsAsResident(relation: ResidencyRelation): boolean {
  return relation === "CURRENT_HOME";
}

/**
 * What a buyer-facing aggregate may truthfully SAY about a set of rows sharing
 * one relation and one confidence.
 *
 * Returned as a sentence fragment rather than a boolean because the honest
 * label is the product: an export that knows it may not say "residents" still
 * has to say something, and leaving that to each caller is how the careful
 * distinction above gets flattened at the last step.
 */
export function cohortLabel(
  relation: ResidencyRelation,
  confidence: LocationConfidence,
  place: string,
): string {
  if (relation === "PROSPECTIVE_HOME") {
    return `readers researching a move to ${place}`;
  }
  if (relation === "BROWSING") {
    return `readers looking at ${place} from elsewhere`;
  }
  if (relation === "CURRENT_HOME") {
    return zipCohortOnly(confidence)
      ? `readers who identified ${place} as their home ZIP`
      : `readers whose address resolved to ${place}`;
  }
  return `readers who viewed ${place}`;
}
