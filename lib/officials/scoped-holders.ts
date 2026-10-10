import type { SeatHolder } from "./lookup.ts";
import { officeIdentity } from "./office-identity.ts";
import { sameNativePerson } from "./people-identity.ts";

const SINGLE_OFFICES = new Set([
  "governor", "lieutenant_governor", "secretary_of_state", "attorney_general", "state_treasurer",
  "superintendent_of_public_instruction", "state_mine_inspector", "state_auditor", "state_comptroller",
  "insurance_commissioner", "mayor",
]);

/** Combine sources for one exact division. An official office occupant wins; this never joins people by name. */
export function scopedHolders(primary: readonly SeatHolder[], additional: readonly SeatHolder[]): SeatHolder[] {
  const holders = [...primary];
  for (const holder of additional) {
    const office = officeIdentity(holder.officeTitle);
    if (holders.some(row => row.id === holder.id && row.officeTitle === holder.officeTitle ||
      office !== null && officeIdentity(row.officeTitle) === office && sameNativePerson(row, holder))) continue;
    if (office !== null && SINGLE_OFFICES.has(office) && primary.some(row => officeIdentity(row.officeTitle) === office)) continue;
    holders.push(holder);
  }
  return holders;
}

/** Only statewide executive offices, excluding Congress and state legislative seats on the same index. */
export function isStatewideExecutive(holder: SeatHolder): boolean {
  const office = officeIdentity(holder.officeTitle);
  return office !== null && (SINGLE_OFFICES.has(office) && office !== "mayor" || office === "corporation_commissioner");
}
