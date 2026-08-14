import type { Tier } from "@/lib/ocd/tiers";

import type { CoverageTier } from "@/lib/meetings/query";
import type { MeetingStatus, OcdId } from "@/lib/sources/types";

/**
 * The shared UI state.
 *
 * EdiaStratMap keeps one object `S` in state.js, and that single fact is why
 * cross-cutting features there are cheap: the legend, the count badge, the list
 * overlay and the map all read the same filters, so adding a filter means
 * adding a field rather than threading a prop through six components. That
 * property is worth more than the pattern it came in, so it survives the port —
 * as a typed reducer rather than a mutable global.
 *
 * What belongs here: anything two surfaces both need. What does not: anything
 * one component owns alone (a hover state, an input's uncommitted text), and
 * anything the server owns (the meetings themselves).
 */

/** Which district overlays can be drawn. Local ones stay defined but empty
 *  until Phase 4 sources them — an empty layer is honest, a missing one is a
 *  gap you cannot see. */
export type DistrictType =
  | "congressional"
  | "state-senate"
  | "state-house"
  | "county"
  | "school"
  | "municipal";

/** Coarse body classification, used only for filtering chips. Display names
 *  are never the join key; this is derived from a body's OCD-ID and type. */
export type BodyType =
  | "council"
  | "commission"
  | "school-board"
  | "county-board"
  | "committee";

/** How the list overlay is ordered and grouped. */
export type ListSort = "date" | "distance" | "body" | "jurisdiction";
export type ListGroupBy = "none" | "jurisdiction" | "body-type" | "district" | "date";

export interface SearchState {
  /** The committed query the map and list filter on. */
  query: string;
  /** Whether the autocomplete dropdown is showing. */
  open: boolean;
  /** Keyboard cursor within the autocomplete, -1 when nothing is highlighted. */
  highlighted: number;
}

export interface FilterState {
  bodyTypes: BodyType[];
  statuses: MeetingStatus[];
  districtTypes: DistrictType[];
  /**
   * Date window, in days relative to now. The cascade reaches 60 days forward
   * and 30 back, so those are the stops.
   */
  daysAhead: number;
  daysBack: number;
  /**
   * Hide jurisdictions with no real ingestion behind them yet.
   *
   * Default on, and deliberately visible: Edia's `focusStatesOn` does the same
   * thing. A reader who cannot see that a filter is hiding places will read the
   * gaps as "no government here".
   */
  hideUncovered: boolean;
}

/** One district a click landed in. Shaped here rather than imported from
 *  lib/map so the store does not depend on the map. */
export interface DistrictChoice {
  type: DistrictType;
  tier: Tier;
  typeLabel: string;
  ocdId: OcdId;
  label: string;
}

/**
 * A click that landed in more than one district.
 *
 * A point is in a *set* of districts, so this is the normal case and not an
 * error path: Tucson resolves to six at once, and Rockaway lands in two school
 * districts from the same layer. The reader picks which one they meant.
 */
export interface DistrictPick {
  choices: DistrictChoice[];
  at: { x: number; y: number };
}

export interface UiState {
  /** Multi-select. Empty means nothing is shown, which is a real state a
   *  reader can reach by turning all three off — and it says so rather than
   *  silently falling back to everything. */
  tiers: Tier[];

  /** Cascading scope. Body is scoped to jurisdiction; changing jurisdiction
   *  clears it. Both are OCD-IDs, never display names. */
  jurisdiction: OcdId | null;
  body: OcdId | null;

  filters: FilterState;
  search: SearchState;

  /** Venue key from lib/meetings/venues.ts. */
  selectedVenueKey: string | null;
  /** The district the reader picked by clicking the map. Never inferred from
   *  the stored zip — see CLAUDE.md on zip being orientation, not identity. */
  selectedDistrictOcdId: OcdId | null;
  selectedDistrictType: DistrictType | null;
  /** Open disambiguation prompt, when a click hit more than one district. */
  districtPick: DistrictPick | null;

  /** Meeting radius, in km. The cascade rungs are the snap points. */
  radiusKm: number;
  radiusOverridden: boolean;

  /** Browser geolocation. Approximate, and never district truth. */
  nearMeEnabled: boolean;
  nearMe: { lat: number; lng: number } | null;

  showDistricts: boolean;
  listOverlayOpen: boolean;
  /** 8a (2026-08-17): which sidebar-count door is open, if any. The doors
   *  are large surfaces and follow the one-large-popup rule. */
  door: "bodies" | "districts" | "officials" | null;
  filtersPanelOpen: boolean;

  listSort: ListSort;
  listGroupBy: ListGroupBy;
  /** Group keys the reader has collapsed. */
  collapsedGroups: string[];

  /** Reported by the last search, shown persistently. docs/state.md §2: a
   *  silently widened search is a wrong answer. */
  coverage: CoverageTier | null;
  /** Meetings the adapter dropped for unresolvable coordinates. Visible, not
   *  silent — this is Edia's `.stat-missing`. */
  droppedCount: number;
}

export type UiAction =
  | { type: "tier/toggle"; tier: Tier }
  | { type: "tier/set"; tiers: Tier[] }
  | { type: "scope/jurisdiction"; ocdId: OcdId | null }
  | { type: "scope/body"; ocdId: OcdId | null }
  | { type: "filter/toggleBodyType"; value: BodyType }
  | { type: "filter/toggleStatus"; value: MeetingStatus }
  | { type: "filter/toggleDistrictType"; value: DistrictType }
  | { type: "filter/dateWindow"; daysAhead?: number; daysBack?: number }
  | { type: "filter/hideUncovered"; value: boolean }
  | { type: "filter/clear"; group: keyof FilterState }
  /** Set the district-type selection outright — Select all / Clear (M25). */
  | { type: "filter/districtTypesSet"; value: DistrictType[] }
  | { type: "filter/reset" }
  | { type: "filter/togglePanel" }
  | { type: "search/input"; query: string }
  | { type: "search/open"; open: boolean }
  | { type: "search/highlight"; index: number }
  | { type: "search/clear" }
  | { type: "select/venue"; key: string | null }
  | {
      type: "select/district";
      ocdId: OcdId | null;
      districtType: DistrictType | null;
    }
  | { type: "district/pick"; pick: DistrictPick | null }
  | { type: "radius/set"; km: number }
  | { type: "radius/clear" }
  | { type: "nearMe/toggle"; enabled: boolean }
  | { type: "nearMe/position"; lat: number; lng: number }
  | { type: "districts/show"; value: boolean }
  | { type: "list/toggle" }
  | { type: "list/open"; open: boolean }
  | { type: "door/open"; door: "bodies" | "districts" | "officials" }
  | { type: "door/close" }
  | { type: "list/sort"; sort: ListSort }
  | { type: "list/groupBy"; groupBy: ListGroupBy }
  | { type: "list/toggleGroup"; key: string }
  | { type: "coverage/report"; tier: CoverageTier; dropped: number }
  | { type: "reset" };
