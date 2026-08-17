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
 * District types drawn when the overlay is on: ALL of them (the author's
 * order, session item 2, 2026-08-14 second session). The tester asked for
 * Kearsarge Regional School District by name and the map never showed it —
 * the school layer defaulted off, so a body the who-governs card counts
 * was unreachable on the map. What the card claims must be findable
 * without knowing which checkbox to tick.
 *
 * Rejected alternative (recorded): the previous one-type-per-tier default
 * (congressional / state-house / county), chosen 2026-08-12 because three
 * Local boundaries over the same ground read as noise. The 4.5.2
 * dash/weight separation is what makes all-on legible enough; legibility
 * tuning stays open, but hiding a claimed body loses to visual noise.
 */
export const DEFAULT_DISTRICT_TYPES: readonly DistrictType[] = [
  ...ALL_DISTRICT_TYPES,
] as const;

export const INITIAL_FILTERS: FilterState = {
  bodyTypes: [],
  statuses: [],
  districtTypes: [...DEFAULT_DISTRICT_TYPES],
  daysAhead: 60,
  /**
   * 6f2 (2026-08-15, the author): 0 → 90. The served window has reached 90
   * days back since M76, and the sidebar's own default was still `now`, so
   * every concluded meeting the pipeline works to retrieve was filtered out
   * before a reader could see one. The control said "now → 60d ahead" and
   * was telling the truth about itself while hiding three months of what the
   * app holds. The default now matches the window it filters.
   */
  daysBack: 90,
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
  /*
   * COLLAPSED (g4 item 14, the author).
   *
   * Filters is machinery for narrowing what is already on screen, and it
   * opened with six groups expanded above the fold on a rail whose first
   * job is the ballot and the ask. A reader who has not asked to narrow
   * anything was being shown every knob for doing it. Item 14 also moves
   * "Limit radius" and "Show districts" INSIDE it, which makes an
   * always-open panel longer still.
   */
  filtersPanelOpen: false,
  listSort: "date",
  listGroupBy: "jurisdiction",
  // Every group starts CLOSED (g4 item 11). Empty means none is open.
  expandedGroups: [],
  coverage: null,
  droppedCount: 0,
};
