import { RADIUS_LADDER_KM } from "../meetings/constants.ts";
import { TIERS } from "../ocd/tiers.ts";

import type { DistrictType, FilterState, UiState } from "./types.ts";

/**
 * The store's default values, in their own module so both the reducer and
 * the reset registry (`reset.ts`) can read them without importing each
 * other. Moved out of reducer.ts with the M24 fix.
 */

/** Every district type the overlay registry knows about. */
export const ALL_DISTRICT_TYPES: readonly DistrictType[] = [
  "congressional",
  "state-senate",
  "state-house",
  "county",
  "school",
  "municipal",
] as const;

/**
 * District types drawn when the overlay is first switched on: one per tier.
 *
 * Turning on all six at once put three Local boundaries — county, municipal and
 * school — over the same ground at the same time, and around a city they
 * overlap into noise. Starting with the widest of each tier gives a legible
 * frame, and every other type is one checkbox away.
 */
export const DEFAULT_DISTRICT_TYPES: readonly DistrictType[] = [
  "congressional",
  "state-house",
  "county",
] as const;

export const INITIAL_FILTERS: FilterState = {
  bodyTypes: [],
  statuses: [],
  districtTypes: [...DEFAULT_DISTRICT_TYPES],
  daysAhead: 60,
  daysBack: 0,
  hideUncovered: true,
};

export const INITIAL_STATE: UiState = {
  // All three on by default: the reader has not told us what they care about
  // yet, and hiding two thirds of their government on a guess is worse than
  // showing all of it.
  tiers: [...TIERS],
  jurisdiction: null,
  body: null,
  filters: { ...INITIAL_FILTERS },
  search: { query: "", open: false, highlighted: -1 },
  selectedVenueKey: null,
  selectedDistrictOcdId: null,
  selectedDistrictType: null,
  districtPick: null,
  radiusKm: RADIUS_LADDER_KM[0],
  radiusOverridden: false,
  nearMeEnabled: false,
  nearMe: null,
  showDistricts: false,
  listOverlayOpen: false,
  door: null,
  filtersPanelOpen: true,
  listSort: "date",
  listGroupBy: "jurisdiction",
  collapsedGroups: [],
  coverage: null,
  droppedCount: 0,
};
