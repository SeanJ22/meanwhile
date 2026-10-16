import { DEFAULT_RADIUS_KM } from "../meetings/constants.ts";
import { TIERS } from "../ocd/tiers.ts";

import {
  ALL_DISTRICT_TYPES,
  DEFAULT_DISTRICT_TYPES,
  INITIAL_FILTERS,
  INITIAL_STATE,
} from "./defaults.ts";
import { resetAllControls } from "./reset.ts";
import { daysBackForStatuses } from "./status-intent.ts";
import type {
  FilterState,
  UiAction,
  UiState,
} from "./types.ts";

// Re-exported for existing importers; the defaults live in defaults.ts so the
// reset registry can read them without a circular import.
export { ALL_DISTRICT_TYPES, DEFAULT_DISTRICT_TYPES, INITIAL_FILTERS, INITIAL_STATE };

/** The reducer. Pure, so it is testable without mounting React. */

/** Add or remove a value, preserving the caller's canonical ordering. */
function toggle<T>(list: T[], value: T, order?: readonly T[]): T[] {
  const next = list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];

  return order ? order.filter((v) => next.includes(v)) : next;
}

function clearedGroup(group: keyof FilterState, filters: FilterState): FilterState {
  switch (group) {
    case "bodyTypes":
      return { ...filters, bodyTypes: [] };
    case "statuses":
      return { ...filters, statuses: [] };
    case "districtTypes":
      // "Cleared" means the default view, never everything-on (that is Select all).
      return { ...filters, districtTypes: [...DEFAULT_DISTRICT_TYPES] };
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
      // cannot survive.
      return { ...state, jurisdiction: action.ocdId, body: null };

    case "scope/body":
      return { ...state, body: action.key };

    case "filter/toggleBodyType":
      return {
        ...state,
        filters: {
          ...state.filters,
          bodyTypes: toggle(state.filters.bodyTypes, action.value),
        },
      };

    case "filter/toggleStatus": {
      // Asking for concluded meetings opens the backward window they live in
      // (see status-intent.ts).
      const statuses = toggle(state.filters.statuses, action.value);
      const daysBack = daysBackForStatuses(statuses, state.filters.daysBack);
      return {
        ...state,
        filters: {
          ...state.filters,
          statuses,
          daysBack: daysBack ?? state.filters.daysBack,
        },
      };
    }

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

    case "filter/districtTypesSet":
      // Select all / Clear on the district-type group. Canonical order is kept
      // so the checkbox list never reshuffles.
      return {
        ...state,
        filters: {
          ...state.filters,
          districtTypes: ALL_DISTRICT_TYPES.filter((t) =>
            action.value.includes(t),
          ),
        },
      };

    case "filter/reset":
      // Every registered control, not merely `filters` (see reset.ts).
      return resetAllControls(state);

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
      return {
        ...state,
        selectedVenueKey: action.key,
        ...(action.key === null
          ? {}
          : { selectedDistrictOcdId: null, selectedDistrictType: null }),
      };

    case "select/district":
      return {
        ...state,
        selectedDistrictOcdId: action.ocdId,
        selectedDistrictType: action.districtType,
        ...(action.ocdId === null ? {} : { selectedVenueKey: null }),
        // Choosing closes the prompt that offered the choice.
        districtPick: null,
      };

    case "district/pick":
      return { ...state, districtPick: action.pick };

    case "radius/set":
      return { ...state, radiusKm: action.km, radiusOverridden: true };

    // Turning the limiter off must actually turn it off, and touch no other filter.
    case "radius/clear":
      return {
        ...state,
        radiusKm: DEFAULT_RADIUS_KM,
        radiusOverridden: false,
      };

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
      return {
        ...state,
        listOverlayOpen: !state.listOverlayOpen,
        door: null,
        /* A toggle is never a focused open. */
        listFocusBodyId: null,
        listFocusBodyName: null,
        listFocusDivision: null,
      };

    case "list/open":
      return {
        ...state,
        listOverlayOpen: action.open,
        door: action.open ? null : state.door,
        /* The focus belongs to ONE opening. Closing clears it, so a later
           unfocused open cannot inherit a subject from an earlier answer. */
        listFocusBodyId: action.open ? (action.focusBodyId ?? null) : null,
        listFocusBodyName: action.open ? (action.focusBodyName ?? null) : null,
        /* The district card's count focus, with the same lifetime. */
        listFocusDivision: action.open ? (action.focusDivision ?? null) : null,
      };

    // The sidebar-count doors: one large surface at a time — opening a door
    // closes the list overlay (and map-entry closes any large popup).
    case "door/open":
      return { ...state, door: action.door, listOverlayOpen: false };

    case "door/close":
      return { ...state, door: null };

    case "list/sort":
      return { ...state, listSort: action.sort };

    case "list/groupBy":
      // Group keys are namespaced by grouping, so switching groupings would
      // leave stale collapse state that could not be reopened.
      return { ...state, listGroupBy: action.groupBy, expandedGroups: [] };

    case "list/toggleGroup":
      return {
        ...state,
        expandedGroups: toggle(state.expandedGroups, action.key),
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

// The active-filter badge reads `activeControlCount` from lib/state/reset.ts,
// which covers every registered control and defines active as "differs from
// the default view".
