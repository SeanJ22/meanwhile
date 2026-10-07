export const JURISDICTION_REFERENCE_STATES = ["az", "nh", "nj"] as const;

export type JurisdictionReferenceState = (typeof JURISDICTION_REFERENCE_STATES)[number];

let installedStates: readonly string[] = [];

export function installReviewedRegistryStates(states: Iterable<string>): void {
  installedStates = [...new Set([...states].map((state) => state.toLowerCase()))].filter((state) => /^[a-z]{2}$/.test(state)).sort();
}

export function reviewedRegistryStates(): readonly string[] {
  return [...new Set([...JURISDICTION_REFERENCE_STATES, ...installedStates])];
}

/** Whether a state (any case) has a reviewed registry, which wins wherever it exists. */
export function hasReviewedRegistry(state: string): boolean {
  return reviewedRegistryStates().includes(state.toLowerCase());
}
