import { FIPS_TO_STATE } from "../ocd/fips.ts";

export function stateForFips(fips: string): string {
  const state = FIPS_TO_STATE[fips]?.postal.toLowerCase();
  if (!state) throw new Error(`Unknown state FIPS: ${fips}`);
  return state;
}
