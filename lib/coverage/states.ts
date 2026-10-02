import { FIPS_TO_STATE } from "../ocd/fips.ts";

/** National geography identifies jurisdictions; it makes no coverage claim. */
export const US_JURISDICTIONS = Object.entries(FIPS_TO_STATE).map(([fips, entry]) => ({
  fips, usps: entry.postal, slug: entry.postal.toLowerCase(), prefix: entry.prefix,
}));
export type StateIdentity = typeof US_JURISDICTIONS[number];

export function jurisdictionFromOcdId(id: string | null): StateIdentity | null {
  const match = id && /^ocd-division\/country:us\/(state|district|territory):([a-z]{2})(?:\/|$)/.exec(id);
  return match ? US_JURISDICTIONS.find(state => state.prefix === match[1] && state.slug === match[2]) ?? null : null;
}
