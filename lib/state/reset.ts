import { TIERS } from "../ocd/tiers.ts";
import { DEFAULT_RADIUS_KM } from "../meetings/constants.ts";

import { INITIAL_FILTERS } from "./defaults.ts";
import type { UiState } from "./types.ts";

export interface ResettableControl {
  /** Stable name, for the test's error messages. */
  name: string;
  /** The UiState fields this control owns. */
  owns: (keyof UiState)[];
  /** Whether the control currently constrains what the reader sees. */
  isActive(state: UiState): boolean;
  /** The fields' default values. */
  reset(state: UiState): Partial<UiState>;
}

/** Same members regardless of order. */
function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export const RESETTABLE_CONTROLS: ResettableControl[] = [
  {
    name: "tier toggle",
    owns: ["tiers"],
    isActive: (s) => !sameSet(s.tiers, TIERS),
    reset: () => ({ tiers: [...TIERS] }),
  },
  {
    name: "scope selectors",
    owns: ["jurisdiction", "body"],
    isActive: (s) => s.jurisdiction !== null || s.body !== null,
    reset: () => ({ jurisdiction: null, body: null }),
  },
  {
    name: "body-type chips",
    owns: [],
    isActive: (s) => s.filters.bodyTypes.length > 0,
    reset: (s) => ({ filters: { ...s.filters, bodyTypes: [] } }),
  },
  {
    name: "meeting status chips",
    owns: [],
    isActive: (s) => s.filters.statuses.length > 0,
    reset: (s) => ({ filters: { ...s.filters, statuses: [] } }),
  },
  {
    name: "date range",
    owns: [],
    isActive: (s) =>
      s.filters.daysAhead !== INITIAL_FILTERS.daysAhead ||
      s.filters.daysBack !== INITIAL_FILTERS.daysBack,
    reset: (s) => ({
      filters: {
        ...s.filters,
        daysAhead: INITIAL_FILTERS.daysAhead,
        daysBack: INITIAL_FILTERS.daysBack,
      },
    }),
  },
  {
    name: "district-type checkboxes",
    owns: [],
    // Active means *differs from the default view* — school and municipal
    // unchecked — never "differs from all six".
    isActive: (s) => !sameSet(s.filters.districtTypes, INITIAL_FILTERS.districtTypes),
    reset: (s) => ({
      filters: {
        ...s.filters,
        districtTypes: [...INITIAL_FILTERS.districtTypes],
      },
    }),
  },
  {
    name: "coverage-quality toggle",
    owns: [],
    isActive: (s) => s.filters.hideUncovered !== INITIAL_FILTERS.hideUncovered,
    reset: (s) => ({
      filters: { ...s.filters, hideUncovered: INITIAL_FILTERS.hideUncovered },
    }),
  },
  {
    name: "search",
    owns: ["search"],
    isActive: (s) => s.search.query.trim().length > 0,
    reset: () => ({ search: { query: "", open: false, highlighted: -1 } }),
  },
  {
    name: "radius limiter",
    owns: ["radiusKm", "radiusOverridden"],
    isActive: (s) => s.radiusOverridden,
    // The dedicated radius/clear semantics: turns the radius off and nothing else.
    reset: () => ({ radiusKm: DEFAULT_RADIUS_KM, radiusOverridden: false }),
  },
  {
    name: "near me",
    owns: ["nearMeEnabled", "nearMe"],
    isActive: (s) => s.nearMeEnabled,
    reset: () => ({ nearMeEnabled: false, nearMe: null }),
  },
  {
    // `filters` itself is owned collectively by the five controls above that
    // reset parts of it; this entry claims the key for the coverage test.
    name: "filters container",
    owns: ["filters"],
    isActive: () => false,
    reset: () => ({}),
  },
];

export const NON_CONTROL_FIELDS: Partial<Record<keyof UiState, string>> = {
  selectedVenueKey: "a selection, not a filter — reset must not close what the reader is looking at",
  selectedDistrictOcdId: "a selection the reader clicked; cleared by its own control",
  selectedDistrictType: "part of the district selection",
  districtPick: "an open disambiguation prompt, not a setting",
  showDistricts:
    "a persisted preference (wtp.show_districts, owned by use-district-layer); reset does not undo preferences",
  listOverlayOpen: "view state, not a constraint on what is shown",
  door: "view state — an open sidebar-count door, constrains nothing (8a)",
  filtersPanelOpen: "view state",
  /*
   * The focus one answer opened the list with. It belongs to a single opening
   * and the reducer clears it when the overlay closes.
   */
  listFocusBodyId: "an answer-scoped focus, cleared by the reducer when the list closes",
  listFocusBodyName: "an answer-scoped focus, cleared by the reducer when the list closes",
  listFocusDivision: "a count-scoped focus (the district card's door), cleared by the reducer when the list closes",
  listSort: "list presentation, constrains nothing",
  listGroupBy: "list presentation",
  expandedGroups: "list presentation",
  coverage: "reported by the server, not reader-adjustable",
  droppedCount: "reported by the adapter, not reader-adjustable",
};

/** Reset every registered control. The reducer's `filter/reset` applies this. */
export function resetAllControls(state: UiState): UiState {
  let next = state;
  for (const control of RESETTABLE_CONTROLS) {
    next = { ...next, ...control.reset(next) };
  }
  return next;
}

/** How many controls actively constrain the view — the badge's number. */
export function activeControlCount(state: UiState): number {
  return RESETTABLE_CONTROLS.filter((c) => c.isActive(state)).length;
}
