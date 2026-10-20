import { FIPS_TO_STATE } from "../../ocd/fips.ts";
export const ACS_STATES = Object.values(FIPS_TO_STATE).filter(row => row.prefix === "state" || ["DC","PR"].includes(row.postal)).map(row => row.postal);
export function acsState(state: string): { state: string; fips: string } {
  const selected = Object.entries(FIPS_TO_STATE).find(([, row]) => row.postal === state.toUpperCase() && ACS_STATES.includes(row.postal));
  if (!selected) throw new Error("ACS_EXACT_STATE_REQUIRED");
  return { state: selected[1].postal, fips: selected[0] };
}
export const acsContractId = (state: string) => `census-acs-population-${acsState(state).state.toLowerCase()}`;
export const acsPopulationScope = (state: string) => `US-${acsState(state).state}:acs-population`;
