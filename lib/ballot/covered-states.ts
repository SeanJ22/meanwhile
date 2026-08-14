/**
 * Which states have a built ballot surface.
 *
 * A tiny client-safe module, deliberately separate from the ballot sources —
 * the map's ballot bubble (2b/2e) needs the answer without pulling a
 * filesystem-reading source into the client bundle. A test asserts this list
 * matches the registered sources so the two cannot drift.
 *
 * Lowercase postal codes, matching the `state:xx` segment of an OCD-ID.
 */
export const BALLOT_COVERED_STATES: readonly string[] = ["nj", "az", "nh"];

export function ballotCoveredForState(state: string | null): boolean {
  return state !== null && BALLOT_COVERED_STATES.includes(state.toLowerCase());
}

/** The `state:xx` segment of any OCD-ID in the list, else null. */
export function stateFromOcdIds(ocdIds: (string | null)[]): string | null {
  for (const id of ocdIds) {
    const match = id?.match(/\/state:([a-z]{2})(\/|$)/);
    if (match) return match[1];
  }
  return null;
}
