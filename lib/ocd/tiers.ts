import { officeIdentity } from "@/lib/officials/office-identity";
import type { OcdId } from "@/lib/sources/types";

/**
 * Which tier of government an OCD division belongs to.
 *
 * The view toggle filters everything on this axis, which is why it works with
 * one join rather than per-surface logic: a meeting, a district, a body and an
 * officeholder all carry an OCD-ID, and the tier falls out of the identifier.
 *
 * The mapping is an explicit table, the same way lib/ocd/fips.ts holds FIPS
 * codes as a literal. **Never derive a tier by string-matching a label.**
 * "Pima County Board of Supervisors" and "Board of Supervisors" are the same
 * body; "Superior Court of Pima County" is not a county legislative body at
 * all. The identifier knows; the display name does not.
 */

export type Tier = "local" | "state" | "national";

export const TIERS: readonly Tier[] = ["local", "state", "national"] as const;

/**
 * OCD segment keys, by tier.
 *
 * A division's tier is decided by its *deepest* recognised segment, because an
 * identifier nests: `country:us/state:az/place:tucson` is local even though it
 * contains `country` and `state`. Ordered widest-first here only for reading.
 *
 * Segment vocabulary follows opencivicdata/ocd-division-ids.
 */
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

/**
 * Split an OCD-ID into its segments.
 *
 * `ocd-division/country:us/state:az/place:tucson` becomes
 * `[{country, us}, {state, az}, {place, tucson}]`. The leading
 * `ocd-division` marker carries no value and is dropped. Malformed input
 * yields an empty list rather than throwing — a bad identifier upstream should
 * render as "unknown", not take the page down.
 */
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

/**
 * The tier a division belongs to, or null when nothing in it is recognised.
 *
 * Null is a real answer and callers must handle it: an unrecognised segment
 * means a source has introduced a division type this table does not know about
 * yet, and guessing would put a body under the wrong tier silently.
 */
export function tierForOcdId(ocdId: OcdId): Tier | null {
  const segments = ocdSegments(ocdId);
  if (segments.length === 0) return null;

  // The deepest segment decides, and only it. Walking up to the nearest
  // recognised ancestor looks tempting and is wrong: an unknown division type
  // would inherit its parent's tier, so a source introducing
  // `.../state:az/water_district:avra` would be filed under State government
  // with nothing to show that it had been guessed at. Null forces the caller
  // to render it as unknown, which is the honest answer until the table learns
  // the segment.
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

/**
 * Display label for a tier.
 *
 * **"Federal", never "National"** (6f2, 2026-08-15 — the last straggler).
 * The rule shipped for the officials surfaces on 2026-08-14 (M48) as words
 * typed into those components, so every surface reading THIS map kept saying
 * "National" — the district battlecards most visibly, and the tier toggle
 * that names the whole mode. The label belongs here, once, or the rule is
 * only true wherever somebody remembered it. The internal key stays
 * `national`: it is an identifier, and identifiers never render (4a).
 */
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
]);

/** Office identity takes precedence over the geography of its electorate. */
export function tierForOffice(title: string | null | undefined, ocdId: OcdId): Tier | null {
  const office = officeIdentity(title);
  if (office === "us_senator" || office === "us_representative") return "national";
  if (office !== null && STATE_OFFICES.has(office)) return "state";
  if (office !== null) return "local";
  return tierForOcdId(ocdId);
}
