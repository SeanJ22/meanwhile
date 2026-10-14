import {
  CONCLUDED_LOOKBACK_DAYS,
  DEFAULT_RADIUS_KM,
  UPCOMING_HORIZON_DAYS,
} from "../meetings/constants.ts";
import { TIERS } from "../ocd/tiers.ts";

import type { DistrictType, FilterState, UiState } from "./types.ts";

/** Every district type the overlay registry knows about. */
export const ALL_DISTRICT_TYPES: readonly DistrictType[] = [
  "congressional",
  "state-senate",
  "state-house",
  "county",
  // Order matters only for the checkbox list; unified reads first because it
  // covers everything.
  "school-unified",
  "school-elementary",
  "school-secondary",
  "municipal",
] as const;

export const DEFAULT_DISTRICT_TYPES: readonly DistrictType[] = [
  ...ALL_DISTRICT_TYPES,
] as const;

export const INITIAL_FILTERS: FilterState = {
  bodyTypes: [],
  statuses: [],
  districtTypes: [...DEFAULT_DISTRICT_TYPES],
  daysAhead: UPCOMING_HORIZON_DAYS,
  /** Matches the served window's lookback, so concluded meetings are not filtered out by default. */
  daysBack: CONCLUDED_LOOKBACK_DAYS,
  hideUncovered: true,
};

export const INITIAL_STATE: UiState = {
  // All three on by default: the reader has not told us what they care about yet.
  tiers: [...TIERS],
  jurisdiction: null,
  body: null,
  filters: { ...INITIAL_FILTERS },
  search: { query: "", open: false, highlighted: -1 },
  selectedVenueKey: null,
  selectedDistrictOcdId: null,
  selectedDistrictType: null,
  districtPick: null,
  radiusKm: DEFAULT_RADIUS_KM,
  radiusOverridden: false,
  nearMeEnabled: false,
  nearMe: null,
  showDistricts: false,
  listOverlayOpen: false,
  door: null,
  /* Collapsed: filters narrow what is already on screen, and a reader who has
     not asked to narrow anything should not see every knob. */
  filtersPanelOpen: false,
  /* An unfocused list is the default; a focus arrives only from an answer. */
  listFocusBodyId: null,
  listFocusBodyName: null,
  /* A count-scoped focus arrives only from the district card's door. */
  listFocusDivision: null,
  listSort: "date",
  listGroupBy: "jurisdiction",
  // Every group starts CLOSED. Empty means none is open.
  expandedGroups: [],
  coverage: null,
  droppedCount: 0,
};
