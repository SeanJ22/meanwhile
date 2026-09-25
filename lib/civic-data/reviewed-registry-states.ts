/**
 * The states the reviewed jurisdiction registry (the promoted operational reference,
 * `operational-references.ts`) carries. Every other state's governments are read from its registration
 * (`lib/registration/jurisdictions.ts`). A module of its own so Admin's Send preview can name the source of a
 * state's governments without loading the reference's reader. PURE.
 */
export const JURISDICTION_REFERENCE_STATES = ["az", "nh", "nj"] as const;

export type JurisdictionReferenceState = (typeof JURISDICTION_REFERENCE_STATES)[number];

/** Whether a state (any case) has a reviewed registry, which wins wherever it exists. */
export function hasReviewedRegistry(state: string): boolean {
  return (JURISDICTION_REFERENCE_STATES as readonly string[]).includes(state.toLowerCase());
}
