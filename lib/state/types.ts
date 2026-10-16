import type { Tier } from "@/lib/ocd/tiers";

import type { CoverageTier } from "@/lib/meetings/query";
import type { MeetingStatus, OcdId } from "@/lib/sources/types";

import type { BodyScopeKey } from "./body-scope.ts";

/** Which district overlays can be drawn. An empty layer is honest; a missing
 *  one is a gap you cannot see. */
export type DistrictType =
  | "congressional"
  | "state-senate"
  | "state-house"
  | "county"

  | "school-unified"
  | "school-elementary"
  | "school-secondary"
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
   * Date window, in days relative to now. The defaults and controls use the
   * shared serving horizons.
   */
  daysAhead: number;
  daysBack: number;
  /**
   * Hide jurisdictions with no real ingestion behind them yet. Default on and
   * visible, so the reader does not read the gaps as "no government here".
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
 * A click that landed in more than one district — the normal case, since a
 * point is in a set of districts. The reader picks which one they meant.
 */
export interface DistrictPick {
  choices: DistrictChoice[];
  at: { x: number; y: number };
}

export interface UiState {

  tiers: Tier[];

  jurisdiction: OcdId | null;
  body: BodyScopeKey | null;

  filters: FilterState;
  search: SearchState;

  /** Venue key from lib/meetings/venues.ts. */
  selectedVenueKey: string | null;
  /** The district the reader picked by clicking the map. Never inferred from
   *  the stored zip: zip is orientation, not identity. */
  selectedDistrictOcdId: OcdId | null;
  selectedDistrictType: DistrictType | null;
  /** Open disambiguation prompt, when a click hit more than one district. */
  districtPick: DistrictPick | null;

  /** Reader-selected distance limit, in km. */
  radiusKm: number;
  radiusOverridden: boolean;

  /** Browser geolocation. Approximate, and never district truth. */
  nearMeEnabled: boolean;
  nearMe: { lat: number; lng: number } | null;

  showDistricts: boolean;
  listOverlayOpen: boolean;
  /** Which sidebar-count door is open, if any. The doors are large surfaces
   *  and follow the one-large-popup rule. */
  door: "bodies" | "districts" | "officials" | null;
  filtersPanelOpen: boolean;

  listFocusBodyId: string | null;
  listFocusBodyName: string | null;

  listFocusDivision: { ocdId: OcdId; name: string } | null;

  listSort: ListSort;
  listGroupBy: ListGroupBy;
  /** Group keys the reader has collapsed. */
  /**
   * Which meeting groups the reader has OPENED; groups start collapsed, and
   * this list is the one source of truth about a group's state.
   */
  expandedGroups: string[];

  /** Meeting availability reported by the last search. */
  coverage: CoverageTier | null;
  /** Meetings the adapter dropped for unresolvable coordinates. Visible, not
   *  silent. */
  droppedCount: number;
}

export type UiAction =
  | { type: "tier/toggle"; tier: Tier }
  | { type: "tier/set"; tiers: Tier[] }
  | { type: "scope/jurisdiction"; ocdId: OcdId | null }
  | { type: "scope/body"; key: BodyScopeKey | null }
  | { type: "filter/toggleBodyType"; value: BodyType }
  | { type: "filter/toggleStatus"; value: MeetingStatus }
  | { type: "filter/toggleDistrictType"; value: DistrictType }
  | { type: "filter/dateWindow"; daysAhead?: number; daysBack?: number }
  | { type: "filter/hideUncovered"; value: boolean }
  | { type: "filter/clear"; group: keyof FilterState }
  /** Set the district-type selection outright — Select all / Clear. */
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
  | {
      type: "list/open";
      open: boolean;
      /** The body the reader's question was ABOUT, when the open came from an answer. Absent: an unfocused open. */
      focusBodyId?: string | null;
      /** That body's plain-language name, for the chip the reader can see. */
      focusBodyName?: string | null;
      /**
       * The division whose upcoming sittings a count opened the list for — the
       * district card's door. See `listFocusDivision`.
       */
      focusDivision?: { ocdId: OcdId; name: string } | null;
    }
  | { type: "door/open"; door: "bodies" | "districts" | "officials" }
  | { type: "door/close" }
  | { type: "list/sort"; sort: ListSort }
  | { type: "list/groupBy"; groupBy: ListGroupBy }
  | { type: "list/toggleGroup"; key: string }
  | { type: "coverage/report"; tier: CoverageTier; dropped: number }
  | { type: "reset" };
