// Relative, extension-bearing imports rather than the `@/` alias: this module
// is pure and belongs under `node --test`, which cannot resolve the alias. The
// rest of lib/ is already written this way.
import { haversineKm } from "../geo/distance.ts";
import { tierForOcdId, type Tier } from "../ocd/tiers.ts";
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

    if (center) {
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
        `${meeting.title} ${meeting.bodyName} ${meeting.jurisdiction} ${meeting.location.name}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export interface ShellStats {
  meetings: number;
  bodies: number;
  districts: number;
  officials: number;
}

/**
 * The four stat cards.
 *
 * `officials` counts the people we can **name at this point** with a source
 * behind them — the federal delegation today, and state legislators once D03
 * lands. It defaults to zero so a caller with no coverage summary still gets an
 * honest number rather than a wrong one.
 *
 * A zero here reads as "we have not got this yet", which is the truth when it
 * is true. It stopped being true the moment the roster shipped, and a card
 * reading 0 beside three rendered names was its own small lie.
 */
export function computeStats(
  meetings: Meeting[],
  districtCount: number,
  officialCount = 0,
): ShellStats {
  const bodies = new Set(meetings.map((m) => `${m.ocdId}|${m.bodyName}`));
  return {
    meetings: meetings.length,
    bodies: bodies.size,
    districts: districtCount,
    officials: officialCount,
  };
}

/** District types currently switched on, for the overlay registry. */
export function activeDistrictTypes(ui: UiState) {
  return ALL_DISTRICT_TYPES.filter((t) => ui.filters.districtTypes.includes(t));
}

export interface StatsView {
  meetings: number | "—";
  bodies: number | "—";
  districts: number | "—";
  officials: number | "—";
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
 */
export function deriveStatsView(
  stats: ShellStats,
  showDistricts: boolean,
  searchFailed: boolean,
): StatsView {
  if (searchFailed) {
    return {
      meetings: "—",
      bodies: "—",
      officials: "—",
      districts: showDistricts ? stats.districts : "—",
      failedNote: "Couldn't check — the meetings service didn't answer.",
    };
  }
  return {
    meetings: stats.meetings,
    bodies: stats.bodies,
    officials: stats.officials,
    districts: showDistricts ? stats.districts : "—",
    failedNote: null,
  };
}
