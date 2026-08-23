// Relative, extension-bearing imports rather than the `@/` alias: this module
// is pure and belongs under `node --test`, which cannot resolve the alias. The
// rest of lib/ is already written this way.
import { haversineKm } from "../geo/distance.ts";
import type { DrawnDistrict } from "../map/districts.ts";
import { tierForOcdId, type Tier } from "../ocd/tiers.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { allOfficialRows } from "../officials/tier-grouping.ts";
import type { CoverageSummary, Seat } from "../registry/coverage.ts";
import type { Meeting } from "../sources/types.ts";

import { ALL_DISTRICT_TYPES } from "./reducer.ts";
import type { BodyType, UiState } from "./types.ts";

/**
 * Turning the shared state into the list everything renders.
 *
 * One function, so the map, the stats, the legend, the count badge and the list
 * overlay cannot disagree about what is currently showing. Pure, so it is
 * testable without React.
 */

/**
 * Classify a body for the body-type chips.
 *
 * Derived from the OCD-ID for the tier and from the body's own name for the
 * kind. Names are display-only as a join key — this is not a join, it is a
 * coarse bucket for a filter chip, and it degrades to null rather than
 * guessing. A meeting that classifies as null is never hidden by a chip filter
 * it could not be matched against.
 */
/**
 * The tier a meeting files under.
 *
 * A meeting with a division files where its division does — `tierForOcdId`,
 * which deliberately refuses to guess an unknown segment. A meeting with a
 * **null** division is different: null is not an unknown segment, it is the
 * stated fact that no Census division exists for this body (D28 — Pima
 * Community College, special districts, regional councils), and every such
 * body in this product is a local government. So null files as `local` by
 * construction, not by inference — the alternative hides every wired
 * division-less meeting behind the tier filter forever.
 */
export function tierForMeeting(meeting: Meeting): Tier | null {
  if (meeting.ocdId === null) return "local";
  return tierForOcdId(meeting.ocdId);
}

/**
 * The government level a meeting belongs to, for the colored map dots (2g).
 *
 * Four levels, not three: the author's spec separates school government from
 * the rest of Local, because a school-board meeting and a congressional town
 * hall at the same address must be distinguishable without clicking. School
 * is decided structurally where possible — a `school_district` segment in the
 * OCD-ID — and by the same name bucket the chips use otherwise (a
 * division-less school body has no segment to read). This colors dots; it is
 * NOT the filter axis, which stays `tierForMeeting`.
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

/**
 * Apply every active filter.
 *
 * Order is cheapest-first, but the result is the same either way — these are
 * all conjunctive.
 */
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

    // Scope. Both are OCD-IDs; `body` additionally matches on the body name
    // within a jurisdiction, because bodies have no identifiers of their own
    // until Phase 5 gives them a table.
    if (ui.jurisdiction && meeting.ocdId !== ui.jurisdiction) return false;
    if (ui.body && `${meeting.ocdId}|${meeting.bodyName}` !== ui.body) return false;

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
     * cannot speak to it (D18). It is kept: the server already decided it is
     * in view — either its division contains the centre or its body's
     * in-person sittings are in radius — and re-deciding that here with a
     * measurement that does not exist would drop it after all.
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
   * **How many of `bodies` are GOVERNING bodies.** (Item 6, 2026-08-23.)
   *
   * The 07866 tile read `12 Bodies` while the panel two inches to its right
   * read *"4 of the 8 bodies that govern the area around 07866"*. Both were
   * right and neither said which unit it was counting: the tile counts every
   * body covering the point and the panel counts the governing ones, and the
   * remaining 4 are the boards and committees the panel names in its own next
   * sentence. Two numbers standing beside each other with no stated
   * relationship is how "1,079" happened.
   *
   * Null when no coverage answered, for the same reason `bodies` becomes
   * "—" there: a counter whose surface cannot say who governs may not state
   * a number, and 0 is a number.
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
 * The four stat cards, each computed from the SAME set the surface behind
 * it renders (M57, 2026-08-15 — the denominator disease, third sighting).
 *
 * The author caught the sidebar reading "6 OFFICIALS" beside an officials
 * door listing twenty-four people. Two counters had drifted onto their own
 * private universes while their doors grew:
 *
 *   OFFICIALS — counted `seats[].representatives` + `senators`, the
 *     pre-roster derivation. It never learned about the curated local
 *     rosters (M05) or the statewide executives (B11), so a mayor, six
 *     council members, a governing board and five supervisors were
 *     rendered by the door and counted by nobody. Now it is
 *     `allOfficialRows()` — literally the door's own derivation.
 *   BODIES — counted DISTINCT BODIES WITH MEETINGS in the filtered set
 *     (13 at 85701) while the bodies door lists every body covering the
 *     point (60). Now it is `coverage.bodies.length`, the door's list.
 *
 * The rule that stops the fourth sighting: a counter takes the rendered
 * collection itself, never a re-derivation that happens to agree today.
 * Guarded at all four zips against real committed registry data in
 * tests/representation.test.ts.
 *
 * `districts` stays the drawn set — the districts door already renders
 * exactly it (3g) — but is now `null` rather than 0 when the overlay is
 * off, because "nothing is drawn because you turned it off" is a
 * different fact from "none are drawn here".
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
 * The popup trigger rule (3h, 2026-08-19), pure so the test can hold it:
 * the who-governs card re-expands ONLY for a typed-zip view of a new area —
 * initial launch and a zip change from the sidebar are both typed-zip
 * views. A settled viewport (free scrolling) NEVER re-expands it, even
 * when the pan crosses into a different ZCTA — the settle still refreshes
 * the data under the bubble, silently. Explicit reader gestures (a click
 * into a new district, a bubble tap) expand it elsewhere — a gesture is
 * the reader asking; a pan is not.
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
 * uses, so the two modes of the districts door read alike.
 *
 * Identifiers never render (CLAUDE.md's plain-language rule): a type this map
 * has no word for falls back to "District" rather than leaking
 * `school_district` onto a card.
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
 * reader's resolved address (2026-08-15).
 *
 * Same stated-N contract as the in-view mode below: the length of this list
 * is the number the card states, and the guard test holds both modes.
 * Holders come from the shared resolver, so a county row names its board and
 * a congressional row names its member.
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
 * The districts door's rows (3g, 2026-08-19): EXACTLY one row per drawn
 * district — the same list whose length the stat card states, so the
 * stated N and the rendered rows cannot diverge (the guard test in
 * tests/representation.test.ts holds `rows.length === drawn.length` and
 * the card derivation against the same input). Holders join by ocdId from
 * the coverage seats; a drawn district without a seat row renders with an
 * empty holder list, never disappears.
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
 *
 * **Stated N equals rendered rows** applies to both halves: `bodies` is the
 * length of the list the Bodies door renders, and `governingBodies` is the
 * count the Who Governs Here panel speaks about. Neither is re-derived here.
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
   * What the districts card is counting, in the reader's words.
   *
   * The number never travels without it. "179 DISTRICTS" read as a claim that
   * the reader is governed by 179 governments — the door said "in view" and
   * the tile said nothing, so the tile was the one the author believed. Two
   * modes, and the label is what distinguishes them:
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
 * actually answered.
 *
 * The standing rule (ninth sighting, docs/state.md §8): **a failed operation
 * may not render as an empty success.** "Couldn't check" and "none" are
 * different facts — a sidebar reading 0 meetings / 0 bodies / 0 officials
 * beside a failed request is three false claims about a government. So on
 * failure every count that depends on the server's answer renders "—" with
 * the note, never 0. Districts stay numeric: the overlay draws from
 * committed files on the client and is genuinely intact when the meetings
 * service is not — the author's failure screenshot showed exactly that
 * split, and it was the one honest number on the card.
 *
 * The districts card no longer renders "—" for an overlay the reader turned
 * off (M57). A dash is this product's word for "we could not check", and
 * spending it on "you switched this off" made the one intact number on the
 * card read as the broken one — the author reported it as blank. Off says
 * off, and its door offers the switch.
 *
 * **The districts number now says what it is counting** (2026-08-15). It read
 * a bare "179 DISTRICTS" beside a door headed "Districts in view" — so the
 * tile made a claim about the reader's government that the door quietly
 * withdrew, and the tile is the one on screen. Two modes:
 *
 *   *In view* — the drawn set, which is a fact about where the camera is
 *   pointed and is labelled as one.
 *
 *   *You're in* — once the reader has given a street address and it has
 *   resolved, the count of divisions whose boundary CONTAINS that point. That
 *   is the governing set, it is the number they actually came for, and it
 *   leads with the in-view count kept underneath rather than thrown away. A
 *   zip centroid never qualifies: a ZCTA crosses city, county and school
 *   lines, so a centroid can sit in a different town than the reader.
 */
export function deriveStatsView(
  stats: ShellStats,
  showDistricts: boolean,
  searchFailed: boolean,
): StatsView {
  /*
   * F01 9.2 (2026-08-19, the author): *"districts in view right now is listed
   * as off... obviously that's not the case, there ARE districts in view on
   * this screen."* Reproduced at 85701.
   *
   * The tile said "Off" because it answered from the master SWITCH, and the
   * switch is a mirror: `use-district-layer` owns the persisted preference,
   * the map reads it directly, and `ui.showDistricts` is a copy kept in step
   * by an effect. A mirror can lag or diverge from the thing it mirrors, and
   * when it does, this tile — whose label is a claim about THE VIEW — reports
   * the state of a checkbox instead.
   *
   * So the drawn set wins when there is one. `stats.districts` is counted off
   * the live map AFTER rendering settles (`drawnDistrictsOn`, called on `idle`
   * and `sourcedata`), which makes it the only value here that is evidence
   * rather than intent. If the map drew districts, "Districts in view" says
   * how many, whatever any switch believes.
   *
   * "Off" survives for the case it was written for and is still honest there:
   * nothing drawn AND the switch off is a state the reader created and can
   * undo, and a dash — this product's word for "we could not check" — would
   * make the one number that was never broken read as the broken one (M57).
   */
  const nothingDrawn = stats.districts === null || stats.districts === 0;
  const drawn: StatsView["districts"] =
    nothingDrawn && !showDistricts ? "Off" : (stats.districts ?? 0);

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
    // may not state a number, and 0 is a number (the failed-operation rule).
    bodies: stats.coverageAnswered ? stats.bodies : "—",
    bodiesSecondary: bodiesSecondary(stats),
    officials: stats.coverageAnswered ? stats.officials : "—",
    districts,
    districtsLabel,
    districtsSecondary,
    failedNote: null,
  };
}
