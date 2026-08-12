import { RADIUS_LADDER_KM } from "@/lib/meetings/query";
import { TIERS } from "@/lib/ocd/tiers";

import type {
  DistrictType,
  FilterState,
  UiAction,
  UiState,
} from "./types";

/**
 * The reducer.
 *
 * Pure and exported on its own so it can be tested without mounting React.
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

export const INITIAL_FILTERS: FilterState = {
  bodyTypes: [],
  statuses: [],
  districtTypes: [...ALL_DISTRICT_TYPES],
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
  filtersPanelOpen: true,
  listSort: "date",
  listGroupBy: "jurisdiction",
  collapsedGroups: [],
  coverage: null,
  droppedCount: 0,
};

/** Add or remove a value, preserving the caller's canonical ordering. */
function toggle<T>(list: T[], value: T, order?: readonly T[]): T[] {
  const next = list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];

  return order ? order.filter((v) => next.includes(v)) : next;
}

/** Clearing a group means "no constraint", which is not always an empty list:
 *  district types and the date window are constraints whose neutral value is
 *  their full range. */
function clearedGroup(group: keyof FilterState, filters: FilterState): FilterState {
  switch (group) {
    case "bodyTypes":
      return { ...filters, bodyTypes: [] };
    case "statuses":
      return { ...filters, statuses: [] };
    case "districtTypes":
      return { ...filters, districtTypes: [...ALL_DISTRICT_TYPES] };
    case "daysAhead":
    case "daysBack":
      return {
        ...filters,
        daysAhead: INITIAL_FILTERS.daysAhead,
        daysBack: INITIAL_FILTERS.daysBack,
      };
    case "hideUncovered":
      return { ...filters, hideUncovered: false };
    default:
      return filters;
  }
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "tier/toggle":
      return { ...state, tiers: toggle(state.tiers, action.tier, TIERS) };

    case "tier/set":
      return { ...state, tiers: TIERS.filter((t) => action.tiers.includes(t)) };

    case "scope/jurisdiction":
      // Picking a jurisdiction repopulates the body dropdown, so the old body
      // — which belonged to a different jurisdiction — cannot survive.
      return { ...state, jurisdiction: action.ocdId, body: null };

    case "scope/body":
      return { ...state, body: action.ocdId };

    case "filter/toggleBodyType":
      return {
        ...state,
        filters: {
          ...state.filters,
          bodyTypes: toggle(state.filters.bodyTypes, action.value),
        },
      };

    case "filter/toggleStatus":
      return {
        ...state,
        filters: {
          ...state.filters,
          statuses: toggle(state.filters.statuses, action.value),
        },
      };

    case "filter/toggleDistrictType":
      return {
        ...state,
        filters: {
          ...state.filters,
          districtTypes: toggle(
            state.filters.districtTypes,
            action.value,
            ALL_DISTRICT_TYPES,
          ),
        },
      };

    case "filter/dateWindow":
      return {
        ...state,
        filters: {
          ...state.filters,
          daysAhead: action.daysAhead ?? state.filters.daysAhead,
          daysBack: action.daysBack ?? state.filters.daysBack,
        },
      };

    case "filter/hideUncovered":
      return {
        ...state,
        filters: { ...state.filters, hideUncovered: action.value },
      };

    case "filter/clear":
      return { ...state, filters: clearedGroup(action.group, state.filters) };

    case "filter/reset":
      return { ...state, filters: { ...INITIAL_FILTERS } };

    case "filter/togglePanel":
      return { ...state, filtersPanelOpen: !state.filtersPanelOpen };

    case "search/input":
      return {
        ...state,
        search: {
          query: action.query,
          open: action.query.trim().length > 0,
          highlighted: -1,
        },
      };

    case "search/open":
      return { ...state, search: { ...state.search, open: action.open } };

    case "search/highlight":
      return { ...state, search: { ...state.search, highlighted: action.index } };

    case "search/clear":
      return { ...state, search: { query: "", open: false, highlighted: -1 } };

    case "select/venue":
      return { ...state, selectedVenueKey: action.key };

    case "select/district":
      return {
        ...state,
        selectedDistrictOcdId: action.ocdId,
        selectedDistrictType: action.districtType,
        // Choosing closes the prompt that offered the choice.
        districtPick: null,
      };

    case "district/pick":
      return { ...state, districtPick: action.pick };

    case "radius/set":
      return { ...state, radiusKm: action.km, radiusOverridden: true };

    case "nearMe/toggle":
      return {
        ...state,
        nearMeEnabled: action.enabled,
        nearMe: action.enabled ? state.nearMe : null,
      };

    case "nearMe/position":
      return { ...state, nearMe: { lat: action.lat, lng: action.lng } };

    case "districts/show":
      return { ...state, showDistricts: action.value };

    case "list/toggle":
      return { ...state, listOverlayOpen: !state.listOverlayOpen };

    case "list/open":
      return { ...state, listOverlayOpen: action.open };

    case "list/sort":
      return { ...state, listSort: action.sort };

    case "list/groupBy":
      // Group keys are namespaced by grouping, so switching groupings would
      // leave stale collapse state that could not be reopened.
      return { ...state, listGroupBy: action.groupBy, collapsedGroups: [] };

    case "list/toggleGroup":
      return {
        ...state,
        collapsedGroups: toggle(state.collapsedGroups, action.key),
      };

    case "coverage/report":
      return { ...state, coverage: action.tier, droppedCount: action.dropped };

    case "reset":
      // Deliberately keeps nothing: the reset control exists to get a reader
      // back to a known state when they have filtered themselves into a corner.
      return { ...INITIAL_STATE, filters: { ...INITIAL_FILTERS } };

    default:
      return state;
  }
}

/** Whether any filter is narrowing the result, for the count badge on the
 *  filters header. Mirrors Edia's `hasActiveFilter`. */
export function hasActiveFilter(filters: FilterState): boolean {
  return activeFilterCount(filters) > 0;
}

/** How many filter groups are actively constraining. Edia's
 *  `updateFiltersActiveCount`. */
export function activeFilterCount(filters: FilterState): number {
  let count = 0;
  if (filters.bodyTypes.length > 0) count++;
  if (filters.statuses.length > 0) count++;
  if (filters.districtTypes.length !== ALL_DISTRICT_TYPES.length) count++;
  if (
    filters.daysAhead !== INITIAL_FILTERS.daysAhead ||
    filters.daysBack !== INITIAL_FILTERS.daysBack
  ) {
    count++;
  }
  // hideUncovered is on by default, so it counts as active only when the
  // reader has turned it off — the unusual state is the one worth flagging.
  if (!filters.hideUncovered) count++;
  return count;
}
