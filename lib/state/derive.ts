// Relative, extension-bearing imports rather than the `@/` alias: this module
// is pure and runs under `node --test`, which cannot resolve the alias.
import { haversineKm } from "../geo/distance.ts";
import {
  districtsSwitchedOffAndEmpty,
  type DrawnDistrict,
} from "../map/districts.ts";
import { tierForOcdId, type Tier } from "../ocd/tiers.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { allOfficialRows } from "../officials/tier-grouping.ts";
import type { CoverageSummary, Seat } from "../registry/coverage.ts";
import type { Meeting } from "../sources/types.ts";

import { bodyScopeKey } from "./body-scope.ts";
import { ALL_DISTRICT_TYPES } from "./reducer.ts";
import type { BodyType, UiState } from "./types.ts";

/**
 * Turning the shared state into the list everything renders: one pure
 * function, so the map, stats, legend, count badge and list cannot disagree.
 */

/**
 * Classify a body for the body-type chips: tier from the OCD-ID, kind from the
 * body's own name. A coarse filter bucket, not a join; it degrades to null
 * rather than guessing, and a null is never hidden by a chip filter.
 */
/**
 * The tier a meeting files under: its division's tier (`tierForOcdId`). A
 * null division is the stated fact that no Census division exists for the body
 * (a community college or special district), and every such body is a local
 * government, so it files as `local`.
 */
export function tierForMeeting(meeting: Meeting): Tier | null {
  if (meeting.ocdId === null) return "local";
  return tierForOcdId(meeting.ocdId);
}

/**
 * The government level a meeting belongs to, for the colored map dots. Four
 * levels: school is separated from the rest of Local, decided by a
 * `school_district` segment in the OCD-ID or else by the chips' name bucket.
 * This colors dots; it is NOT the filter axis, which stays `tierForMeeting`.
 */
export type GovernmentLevel = "school" | "local" | "state" | "federal";

export const LEVEL_ORDER: readonly GovernmentLevel[] = [
  "school",
  "local",
  "state",
  "federal",
] as const;

export const LEVEL_LABEL: Readonly<Record<GovernmentLevel, string>> = {
  school: "School",
  local: "Local",
  state: "State",
  federal: "Federal",
};

export function levelForMeeting(meeting: Meeting): GovernmentLevel | null {
  if (
    meeting.ocdId?.includes("/school_district:") ||
    bodyTypeOf(meeting) === "school-board"
  ) {
    return "school";
  }
  const tier = tierForMeeting(meeting);
  if (tier === "local") return "local";
  if (tier === "state") return "state";
  if (tier === "national") return "federal";
  return null;
}

export function bodyTypeOf(meeting: Meeting): BodyType | null {
  const name = meeting.bodyName.toLowerCase();
  const tier = tierForMeeting(meeting);

  if (/school|governing board/.test(name)) return "school-board";
  if (/board of supervisors|county board/.test(name)) return "county-board";
  if (/commission/.test(name)) return "commission";
  if (/committee|subcommittee/.test(name)) return "committee";
  if (/council|mayor|selectmen|aldermen|town meeting/.test(name)) return "council";

  // A county-tier board with an unrecognised name is still a county board.
  if (/board/.test(name) && tier === "local") return "county-board";

  return null;
}

export const BODY_TYPE_LABEL: Readonly<Record<BodyType, string>> = {
  council: "Council",
  commission: "Commission",
  "school-board": "School Board",
  "county-board": "County Board",
  committee: "Committee",
};

/** Days between now and a meeting, signed: negative is in the past. */
function daysFromNow(meeting: Meeting, now: number): number {
  return (Date.parse(meeting.startsAt) - now) / 86_400_000;
}

export interface FilterInput {
  meetings: Meeting[];
  ui: UiState;
  center: { lat: number; lng: number } | null;
  now?: number;
}

/** Apply every active filter. All are conjunctive; order is cheapest-first. */
export function applyFilters({
  meetings,
  ui,
  center,
  now = Date.now(),
}: FilterInput): Meeting[] {
  const query = ui.search.query.trim().toLowerCase();

  return meetings.filter((meeting) => {
    // Tier. An empty selection shows nothing, and the UI says so rather than
    // quietly falling back to everything.
    const tier = tierForMeeting(meeting);
    if (tier === null || !ui.tiers.includes(tier)) return false;

    // Scope. Jurisdiction is an OCD-ID; `body` is the division plus the body
    // name, made only by `bodyScopeKey`, the same constructor the Body
    // dropdown uses.
    if (ui.jurisdiction && meeting.ocdId !== ui.jurisdiction) return false;
    if (ui.body && bodyScopeKey(meeting) !== ui.body) return false;

    if (ui.filters.statuses.length > 0) {
      if (!ui.filters.statuses.includes(meeting.status)) return false;
    }

    if (ui.filters.bodyTypes.length > 0) {
      const type = bodyTypeOf(meeting);
      // Unclassifiable bodies are not hidden by a chip they could never match.
      if (type !== null && !ui.filters.bodyTypes.includes(type)) return false;
    }

    const days = daysFromNow(meeting, now);
    if (days > ui.filters.daysAhead) return false;
    if (days < -ui.filters.daysBack) return false;

    /*
     * An online meeting has no distance to the centre, so the radius filter
     * cannot speak to it; the server already decided it is in view.
     */
    if (center && meeting.location) {
      const km = haversineKm(
        center.lat,
        center.lng,
        meeting.location.lat,
        meeting.location.lng,
      );
      if (km > ui.radiusKm) return false;
    }

    if (query.length > 0) {
      const haystack =
        `${meeting.title} ${meeting.bodyName} ${meeting.jurisdiction} ${
          meeting.location?.name ?? meeting.online?.label ?? ""
        }`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export interface ShellStats {
  meetings: number;
  bodies: number;
  /**
   * How many of `bodies` are GOVERNING bodies (the rest are boards and
   * committees). Null when no coverage answered: a counter whose surface
   * cannot say who governs may not state a number, and 0 is a number.
   */
  governingBodies: number | null;
  /** Null when the overlay is off: nothing is drawn, so there is no count. */
  districts: number | null;
  /**
   * Districts whose boundary CONTAINS the reader's resolved address point —
   * the governing set. Null when no address has been resolved (a zip centroid
   * is not an address) or when no coverage answered.
   */
  governingDistricts: number | null;
  officials: number;
  /** False when no coverage answered — the two coverage counters can't claim. */
  coverageAnswered: boolean;
}

/**
 * The four stat cards, each computed from the SAME collection the surface
 * behind it renders, never a re-derivation that happens to agree today:
 * officials from `allOfficialRows()`, bodies from `coverage.bodies`.
 *
 * `districts` is the drawn set, and `null` rather than 0 when the overlay is
 * off: "turned off" is a different fact from "none drawn here".
 */
export function computeStats(input: {
  /** The filtered meetings — what the list overlay renders. */
  meetings: Meeting[];
  /** What the bodies door and the officials door render from. */
  coverage: CoverageSummary | null;
  /** What the districts door renders, or null when the overlay is off. */
  drawnDistricts: readonly DrawnDistrict[] | null;
  /**
   * True when the query point is a resolved street address rather than a zip
   * centroid. A ZCTA centroid can sit in another town, so "the districts you
   * are in" is only sayable once a real address has been resolved.
   */
  atAddress?: boolean;
}): ShellStats {
  const { meetings, coverage, drawnDistricts, atAddress = false } = input;
  return {
    meetings: meetings.length,
    bodies: coverage ? coverage.bodies.length : 0,
    governingBodies: coverage ? coverage.counts.governing.total : null,
    districts: drawnDistricts ? drawnDistricts.length : null,
    governingDistricts:
      atAddress && coverage ? coverage.divisions.length : null,
    officials: coverage ? allOfficialRows(coverage).length : 0,
    coverageAnswered: coverage !== null,
  };
}

/** District types currently switched on, for the overlay registry. */
export function activeDistrictTypes(ui: UiState) {
  return ALL_DISTRICT_TYPES.filter((t) => ui.filters.districtTypes.includes(t));
}

/**
 * The popup trigger rule: the who-governs card re-expands ONLY for a typed-zip
 * view of a new area (initial launch, a zip change). A settled viewport never
 * re-expands it, even across a ZCTA boundary; the data under it still
 * refreshes silently. Explicit reader gestures expand it elsewhere.
 */
export function noticeShouldExpand(
  viewKind: "zip" | "settled",
  areaZip: string,
  lastShownZip: string | null,
): boolean {
  return viewKind === "zip" && areaZip !== lastShownZip;
}

/** A districts-door row: one drawn district, holders attached where a seat
 *  matches by ocdId. */
export interface DistrictDoorRow {
  ocdId: string;
  label: string;
  typeLabel: string;
  tier: Tier;
  holders: SeatHolder[];
}

/**
 * The reader-facing name of a division type — the same words the map legend
 * uses. A type with no word falls back to "District"; identifiers never render.
 */
const DIVISION_TYPE_LABEL: Record<string, string> = {
  cd: "Congressional",
  sldu: "State Senate",
  sldl: "State House",
  county: "County",
  place: "City or town",
  school_district: "School district",
};

export function divisionTypeLabel(divisionType: string): string {
  return DIVISION_TYPE_LABEL[divisionType] ?? "District";
}

/**
 * The GOVERNING mode's rows — one per division whose boundary contains the
 * reader's resolved address. The list's length is the number the card states.
 * Holders come from the shared resolver.
 */
export function governingDoorRows(
  coverage: CoverageSummary,
  holdersFor: (ocdId: string) => SeatHolder[],
): DistrictDoorRow[] {
  return coverage.divisions.map((d) => ({
    ocdId: d.ocdId,
    label: d.label,
    typeLabel: divisionTypeLabel(d.divisionType),
    tier: d.tier,
    holders: holdersFor(d.ocdId),
  }));
}

/**
 * The districts door's rows: EXACTLY one per drawn district, so the stated N
 * and the rendered rows cannot diverge. Holders join by ocdId from the
 * coverage seats; a district without a seat row renders with no holders.
 */
export function districtDoorRows(
  drawn: readonly DrawnDistrict[],
  seats: readonly Seat[],
): DistrictDoorRow[] {
  const byOcdId = new Map(seats.map((s) => [s.ocdId, s]));
  return drawn.map((d) => ({
    ocdId: d.ocdId,
    label: d.label,
    typeLabel: d.typeLabel,
    tier: d.tier,
    holders: byOcdId.get(d.ocdId)?.representatives ?? [],
  }));
}

/**
 * The Bodies pair, in the reader's words, or null when there is no pair.
 * `bodies` is the Bodies door's list length and `governingBodies` the count the
 * Who Governs Here panel speaks about; neither is re-derived here.
 */
function bodiesSecondary(stats: ShellStats): string | null {
  if (!stats.coverageAnswered) return null;
  const governing = stats.governingBodies;
  if (governing === null) return null;
  const other = stats.bodies - governing;
  if (other <= 0) return null;
  return `${governing} govern here · ${other} board${other === 1 ? "" : "s"} and committee${
    other === 1 ? "" : "s"
  }`;
}

export interface StatsView {
  meetings: number | "—";
  bodies: number | "—";
  /**
   * The Bodies tile's second line — the pair, reconciled on the tile itself.
   *
   * Null when there is nothing to reconcile: no coverage answered, or every
   * body here governs, in which case a breakdown would be noise.
   */
  bodiesSecondary: string | null;
  districts: number | "—" | "Off";
  officials: number | "—";
  /**
   * What the districts card is counting, in the reader's words; the number
   * never travels without it:
   *
   *   "In view"        — the drawn set. A fact about the camera.
   *   "You're in"      — the governing set: divisions whose boundary contains
   *                      the reader's resolved address. A fact about them.
   */
  districtsLabel: string;
  /**
   * The secondary line under the districts number, when a second honest
   * number exists to show — the in-view count while the governing count
   * leads. Null when there is only one number to say.
   */
  districtsSecondary: string | null;
  /** Present exactly when the fetch failed: the couldn't-check statement. */
  failedNote: string | null;
}

/**
 * What the stat cards may claim, given whether the fetch that feeds them
 * answered. A failed operation may not render as an empty success: on failure
 * every count that depends on the server renders "—" with the note, never 0.
 * Districts stay numeric, because the overlay draws from files on the client.
 *
 * An overlay the reader turned off reads "Off", not "—" (a dash means "we
 * could not check").
 *
 * The districts number says what it counts: *In view* (the drawn set) or, once
 * a street address has resolved, *You're in* (divisions whose boundary
 * contains that point), with the in-view count kept underneath. A zip
 * centroid never qualifies.
 */
export function deriveStatsView(
  stats: ShellStats,
  showDistricts: boolean,
  searchFailed: boolean,
): StatsView {
  /*
   * The drawn set wins when there is one: `stats.districts` is counted off the
   * live map after rendering settles, so it is evidence, while the switch is a
   * mirror of the persisted preference that can lag. "Off" is only for nothing
   * drawn AND the switch off; the rule is `districtsSwitchedOffAndEmpty` in
   * lib/map/districts.ts, shared with the door this tile opens.
   */
  const drawn: StatsView["districts"] = districtsSwitchedOffAndEmpty(
    stats.districts,
    showDistricts,
  )
    ? "Off"
    : (stats.districts ?? 0);

  // The governing mode needs the address AND the overlay's own number is
  // still worth keeping underneath — including when the overlay is off, where
  // the secondary line is what says so.
  const governing = stats.governingDistricts;
  const districts: StatsView["districts"] = governing === null ? drawn : governing;
  const districtsLabel = governing === null ? "In view" : "You're in";
  const districtsSecondary =
    governing === null
      ? null
      : drawn === "Off"
        ? "District outlines are off"
        : `${drawn} in view`;

  if (searchFailed) {
    return {
      meetings: "—",
      bodies: "—",
      bodiesSecondary: null,
      officials: "—",
      // A failed search cannot have resolved an address point, so this falls
      // back to the drawn count — the overlay draws from committed files and
      // is genuinely intact when the meetings service is not.
      districts: drawn,
      districtsLabel: "In view",
      districtsSecondary: null,
      failedNote: "Couldn't check — the meetings service didn't answer.",
    };
  }
  return {
    meetings: stats.meetings,
    // A counter whose surface says "we couldn't resolve who governs here"
    // may not state a number, and 0 is a number.
    bodies: stats.coverageAnswered ? stats.bodies : "—",
    bodiesSecondary: bodiesSecondary(stats),
    officials: stats.coverageAnswered ? stats.officials : "—",
    districts,
    districtsLabel,
    districtsSecondary,
    failedNote: null,
  };
}
