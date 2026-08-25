import { RADIUS_LADDER_KM } from "../meetings/constants.ts";
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

// Re-exported from their new home so existing importers keep working; the
// defaults moved to defaults.ts so the reset registry can read them without
// a circular import.
export { ALL_DISTRICT_TYPES, DEFAULT_DISTRICT_TYPES, INITIAL_FILTERS, INITIAL_STATE };

/**
 * The reducer.
 *
 * Pure and exported on its own so it can be tested without mounting React.
 */

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
      // "Cleared" means the default view (M24) — never everything-on, which
      // is now the explicit Select all action instead.
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

    case "filter/toggleStatus": {
      // M58: asking for concluded meetings opens the backward window they
      // live in. Without this the chip is a dead control at every zip — see
      // status-intent.ts for the measurement.
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
      // Select all / Clear on the district-type group (M25). Canonical order
      // is kept so the checkbox list never reshuffles.
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
      // Every registered control, not merely `filters` — the old form was
      // written when filters were the only controls and quietly skipped
      // tiers, scope, search, radius and near-me as each grew around it
      // (tracker M24). The registry is the fix's structural half.
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

    /*
     * **BC-16 (2026-08-25) — ONE SMALL CARD AT A TIME, MOST RECENT CLICK
     * WINS.**
     *
     * The author's `09-20-11` has the Rockaway Township VENUE card and the
     * Morris County DISTRICT card open at once, overlapping, each scrolling
     * inside itself. Two answers to two different questions, one on top of the
     * other, and the reader has to close one to read the other.
     *
     * The exclusion lives HERE rather than in the handlers for the same reason
     * WGH-8's does: a rule enforced by every path that calls it is a rule the
     * path nobody thought of does not follow. Opening either card is a
     * transition in this reducer, so closing the other is part of the same
     * transition and there is no ordering to get wrong.
     *
     * Selecting NOTHING (`key: null`, `ocdId: null`) is a close, not an open,
     * and must not clear the other card — otherwise dismissing one would
     * silently dismiss both.
     */
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

    // Turning the limiter off has to actually turn it off. It previously
    // dispatched `filter/reset`, which cleared every unrelated filter and left
    // `radiusOverridden` true — so the radius kept filtering while the control
    // read "off", with no way back short of a reload.
    case "radius/clear":
      return {
        ...state,
        radiusKm: RADIUS_LADDER_KM[0],
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
      return { ...state, listOverlayOpen: !state.listOverlayOpen, door: null };

    case "list/open":
      return {
        ...state,
        listOverlayOpen: action.open,
        door: action.open ? null : state.door,
      };

    // 8a: the sidebar-count doors. One large surface at a time — opening a
    // door closes the list overlay (and map-entry closes any large popup).
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

// The old activeFilterCount/hasActiveFilter pair is gone (M24): it counted
// only `filters`, and it counted the *default* district-type selection as
// active — which is why a fresh page read "Filters 1" and Reset all
// appeared to do nothing. The badge now reads `activeControlCount` from
// lib/state/reset.ts, which covers every registered control and defines
// active as "differs from the default view".
