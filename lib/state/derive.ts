// Relative, extension-bearing imports rather than the `@/` alias: this module
// is pure and belongs under `node --test`, which cannot resolve the alias. The
// rest of lib/ is already written this way.
import { haversineKm } from "../geo/distance.ts";
import { matchesTiers, tierForOcdId } from "../ocd/tiers.ts";
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
export function bodyTypeOf(meeting: Meeting): BodyType | null {
  const name = meeting.bodyName.toLowerCase();
  const tier = tierForOcdId(meeting.ocdId);

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
    if (!matchesTiers(meeting.ocdId, ui.tiers)) return false;

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
 * `officials` is zero until Phase 5 lands real officeholder records. It is
 * shown as an honest zero rather than hidden: a card that appears only once it
 * has a number to show reads as "this was just added", where a zero reads as
 * "we have not got this yet", which is the truth.
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
