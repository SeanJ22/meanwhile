/**
 * The states the reviewed jurisdiction registry (the promoted operational reference,
 * `operational-references.ts`) carries. Every other state's governments are read from its registration
 * (`lib/registration/jurisdictions.ts`). A module of its own so Admin's Send preview can name the source of a
 * state's governments without loading the reference's reader. PURE.
 *
 * The three states below are the seed rows. A state's reference is a data record: the promoted bundle may carry
 * more states than these, and every state the installed bundle carries is reviewed from then on
 * (`installReviewedRegistryStates`), with no release.
 */
export const JURISDICTION_REFERENCE_STATES = ["az", "nh", "nj"] as const;

export type JurisdictionReferenceState = (typeof JURISDICTION_REFERENCE_STATES)[number];

let installedStates: readonly string[] = [];

/** Install the states the promoted bundle carries beyond the seeds, replacing what an earlier call installed. */
export function installReviewedRegistryStates(states: Iterable<string>): void {
  installedStates = [...new Set([...states].map((state) => state.toLowerCase()))].filter((state) => /^[a-z]{2}$/.test(state)).sort();
}

/** The seed states, then every other state the installed bundle carries. */
export function reviewedRegistryStates(): readonly string[] {
  return [...new Set([...JURISDICTION_REFERENCE_STATES, ...installedStates])];
}

/** Whether a state (any case) has a reviewed registry, which wins wherever it exists. */
export function hasReviewedRegistry(state: string): boolean {
  return reviewedRegistryStates().includes(state.toLowerCase());
}
