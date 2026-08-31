import { TIERS } from "../ocd/tiers.ts";
import { RADIUS_LADDER_KM } from "../meetings/constants.ts";

import { INITIAL_FILTERS } from "./defaults.ts";
import type { UiState } from "./types.ts";

/**
 * The registry of resettable controls — the structural fix behind "Reset all
 * does not work" (defect 2026-08-14, tracker M24).
 *
 * The old handler reset `state.filters` and nothing else, because it was
 * written when filters were the only controls. Five control groups grew
 * around it — tiers, scope, radius, near-me, search — and each one it
 * missed made "Reset all" a little more of a lie. Worse, the active-count
 * treated the *default* district-type selection as an active filter, so a
 * fresh page read "Filters 1" and Reset all visibly did nothing.
 *
 * So: every reader-adjustable control registers here with its reset and its
 * is-active test, `resetAll`/`activeControlCount` are derived from the
 * registry, and `tests/reset-registry.test.ts` fails the build when a
 * `UiState` field is added without either registering or being declared a
 * non-control. Adding a filter without deciding its reset is no longer
 * possible silently.
 */

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
    // unchecked, per the recorded rendering decision — never "differs from
    // all six". The old definition counted the default as active, which is
    // why a fresh page read "Filters 1" and Reset all appeared dead.
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
    // The dedicated radius/clear semantics, not filter/reset's old mistake
    // of clearing everything else and leaving the radius on (§4.2).
    reset: () => ({ radiusKm: RADIUS_LADDER_KM[0], radiusOverridden: false }),
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

/**
 * UiState fields that are deliberately NOT controls, each with the reason.
 * The test requires every field to appear exactly once — here or in a
 * control's `owns` — so a new field forces this decision instead of
 * silently escaping Reset all.
 */
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
   * ASK-22: the focus one ANSWER opened the list with. Not a reader-set
   * constraint — it belongs to a single opening and the reducer clears it when
   * the overlay closes, so a reset control would be a second owner of a
   * lifetime that is already decided.
   */
  listFocusBodyId: "an answer-scoped focus, cleared by the reducer when the list closes",
  listFocusBodyName: "an answer-scoped focus, cleared by the reducer when the list closes",
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
