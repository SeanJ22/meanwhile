export type ResidencyRelation =
  | "CURRENT_HOME"
  | "PROSPECTIVE_HOME"
  | "BROWSING"
  | "UNKNOWN";

export type LocationConfidence =
  | "UNVERIFIED"
  /** A ZIP the reader typed. Proves a ZIP cohort. Does NOT prove a district. */
  | "SELF_DECLARED_ZIP"
  | "ADDRESS_RESOLVED"
  | "ADDRESS_VALIDATED"
  | "UNKNOWN";

export type LocationOrigin =
  | "TYPED_ZIP"
  | "DEMO_ZIP"
  | "DEVICE_LOCATION"
  | "PROSPECTIVE_ENTRY"
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

export function readLocationOrigin(raw: unknown): LocationOrigin {
  return LOCATION_ORIGINS.includes(raw as LocationOrigin)
    ? (raw as LocationOrigin)
    : "UNKNOWN";
}

/**
 * A demo ZIP is browsing, never home; a device location proves presence, never residence.
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

/** True means the row may be counted only as a self-declared ZIP cohort, never as residents of a district the ZIP overlaps. */
export function zipCohortOnly(confidence: LocationConfidence): boolean {
  return confidence !== "ADDRESS_RESOLVED" && confidence !== "ADDRESS_VALIDATED";
}

export function countsAsResident(relation: ResidencyRelation): boolean {
  return relation === "CURRENT_HOME";
}

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
