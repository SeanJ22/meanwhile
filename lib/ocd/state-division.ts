import { isJurisdictionSegment } from "./fips.ts";

/** State, DC or territory division, using its published OCD jurisdiction class. */
export function stateOcdIdFrom(ocdId: string): string | null {
  const match = /^(ocd-division\/country:us\/(state|district|territory):([a-z]{2}))(\/|$)/.exec(ocdId);
  return match && isJurisdictionSegment(match[2], match[3]) ? match[1] : null;
}
