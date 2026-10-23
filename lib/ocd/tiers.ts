import { officeIdentity } from "@/lib/officials/office-identity";
import type { OcdId } from "@/lib/sources/types";

/** Which tier of government an OCD division belongs to, from an explicit table; never derived from a label. */

export type Tier = "local" | "state" | "national";

export const TIERS: readonly Tier[] = ["local", "state", "national"] as const;

/** OCD segment keys by tier. The deepest recognised segment decides. */
export const TIER_SEGMENTS: Readonly<Record<Tier, readonly string[]>> = {
  national: [
    // The union itself, and seats in the US House.
    "country",
    "cd",
  ],
  state: [
    "state",
    // State-equivalents. DC is `district:dc`; the five inhabited territories
    // are `territory:xx`. Both elect state-equivalent government, and both
    // carry `cd:at-large` beneath them — which is national, by depth.
    "district",
    "territory",
    // State legislative chambers, upper and lower.
    "sldu",
    "sldl",
  ],
  local: [
    "county",
    "place",
    "school_district",
    "ward",
    // Seen in the canonical list for county/municipal subdivisions.
    "council_district",
    "township",
    "borough",
    "parish",
    "village",
    "town",
    "city",
    "precinct",
    // Minted for special districts drawn by their own official boundary layer, and for Census tribal areas.
    "special_district",
    "aiannh",
  ],
} as const;

/** Reverse index, built once. Segment key -> tier. */
const SEGMENT_TIER: ReadonlyMap<string, Tier> = new Map(
  (Object.entries(TIER_SEGMENTS) as [Tier, readonly string[]][]).flatMap(
    ([tier, segments]) => segments.map((segment) => [segment, tier] as const),
  ),
);

export interface OcdSegment {
  key: string;
  value: string;
}

/** Split an OCD-ID into its segments; malformed input yields an empty list. */
export function ocdSegments(ocdId: OcdId): OcdSegment[] {
  if (typeof ocdId !== "string" || ocdId.length === 0) return [];

  const segments: OcdSegment[] = [];

  for (const part of ocdId.split("/")) {
    if (part === "ocd-division" || part === "") continue;

    const colon = part.indexOf(":");
    if (colon <= 0) continue;

    segments.push({
      key: part.slice(0, colon),
      value: part.slice(colon + 1),
    });
  }

  return segments;
}

/** The tier a division belongs to, or null when its deepest segment is not recognised. */
export function tierForOcdId(ocdId: OcdId): Tier | null {
  const segments = ocdSegments(ocdId);
  if (segments.length === 0) return null;

  // Only the deepest segment decides: an unknown division type must not inherit its parent's tier.
  return SEGMENT_TIER.get(segments[segments.length - 1].key) ?? null;
}

/** The value of a given segment, e.g. `state` -> `"az"`. Null when absent. */
export function ocdSegmentValue(ocdId: OcdId, key: string): string | null {
  const found = ocdSegments(ocdId).find((s) => s.key === key);
  return found ? found.value : null;
}

/** Whether a division falls in any of the given tiers. */
export function matchesTiers(ocdId: OcdId, tiers: readonly Tier[]): boolean {
  if (tiers.length === 0) return false;
  const tier = tierForOcdId(ocdId);
  return tier !== null && tiers.includes(tier);
}

/** Display label for a tier: "Federal", never "National". The internal key stays `national`. */
export const TIER_LABEL: Readonly<Record<Tier, string>> = {
  local: "Local",
  state: "State",
  national: "Federal",
};

/**
 * The CSS custom property carrying a tier's accent.
 *
 * Colour lives in app/globals.css; this is only the pointer to it, so a tier
 * never has two sources of truth for what it looks like.
 */
export const TIER_ACCENT_VAR: Readonly<Record<Tier, string>> = {
  local: "--accent-local",
  state: "--accent-state",
  national: "--accent-national",
};

/** The accent used when every tier is active at once. */
export const ALL_TIERS_ACCENT_VAR = "--accent-all";

const STATE_OFFICES = new Set([
  "governor", "lieutenant_governor", "secretary_of_state", "attorney_general",
  "state_treasurer", "superintendent_of_public_instruction", "state_mine_inspector",
  "corporation_commissioner", "state_auditor", "state_comptroller",
  "insurance_commissioner", "state_senator", "state_lower_house", "executive_councilor",
  "state_supreme_court", "state_appeals_court",
]);

/** Office identity takes precedence over the geography of its electorate. */
export function tierForOffice(title: string | null | undefined, ocdId: OcdId): Tier | null {
  const office = officeIdentity(title);
  if (office === "us_senator" || office === "us_representative") return "national";
  if (office !== null && STATE_OFFICES.has(office)) return "state";
  if (office !== null) return "local";
  return tierForOcdId(ocdId);
}
