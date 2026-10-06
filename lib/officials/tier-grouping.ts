import type { CoverageSummary } from "../registry/coverage.ts";
import { projectedBodyRoster } from "../registry/body-roster-client.ts";

import type { SeatHolder } from "./lookup.ts";

/**
 * The three-tier grouping every officials surface renders (session item
 * 2c, wall clock 2026-08-14 second session — from production
 * screenshots): flat mixed lists of officials get messy as
 * coverage grows, so every surface that lists officials groups under
 * three headers, ALWAYS closest-first:
 *
 *   LOCAL   — county, municipal, mayor, school districts, special
 *             districts, commissions and boards
 *   STATE   — state legislators, then the governor and statewide
 *             executives (order of scope: district before statewide)
 *   FEDERAL — the US House member, then US senators (same scope rule)
 *
 * Closest-first is the product's thesis: the government nobody watches
 * is the nearest one, and the list must not open with the names people
 * already know. "Federal" is the label, not "National" — it matches
 * every ballot and source the app cites.
 *
 * This module is the ONE derivation: the who-governs card, the
 * officials door, and the stat count all read it, so the stated N and
 * the rendered rows cannot disagree. Membership is decided by
 * STRUCTURE — which store the holder came from, the seat's division
 * type — never by string-matching a label.
 */

export const TIER_GROUP_LABELS = {
  local: "Local",
  state: "State",
  federal: "Federal",
} as const;

export type TierGroup = keyof typeof TIER_GROUP_LABELS;

export interface OfficialRow {
  holder: SeatHolder;
  /** What the row says the person holds — seat label or office title. */
  seatLabel: string | null;
  /** The map tier the open-official log event uses. */
  tier: "local" | "state" | "national";
  /** The division the seat serves, where the holder has one. */
  ocdId: string | null;
}

export interface TieredOfficials {
  local: OfficialRow[];
  state: OfficialRow[];
  federal: OfficialRow[];
}

/** Scope rank within LOCAL: narrower first. */
const LOCAL_SCOPE_RANK: Record<string, number> = {
  place: 0,
  school_district: 1,
  county: 2,
};

/**
 * Group every named officeholder the coverage summary can source into
 * the three tiers. Deduped by holder id across the whole result — a
 * person appears once, in the closest tier that claims them.
 */
export function groupOfficials(coverage: CoverageSummary): TieredOfficials {
  const seen = new Set<string>();
  const local: OfficialRow[] = [];
  const state: OfficialRow[] = [];
  const federal: OfficialRow[] = [];

  const push = (
    rows: OfficialRow[],
    holder: SeatHolder,
    seatLabel: string | null,
    tier: OfficialRow["tier"],
    ocdId: string | null,
  ) => {
    if (seen.has(holder.id)) return;
    seen.add(holder.id);
    rows.push({ holder, seatLabel, tier, ocdId });
  };

  // LOCAL — curated roster members of the bodies covering the point,
  // bodies ordered narrower-first (municipal, school district, county),
  // then curated boards in the summary's own order.
  const bodiesByScope = [...coverage.bodies].sort(
    (a, b) =>
      // NH94: a body with no division sorts with the unranked, which is where
      // an unknown division type already sorted. The `?? 3` was always the
      // honest branch; what changed is that null now reaches it instead of
      // being turned into "place" upstream.
      ((a.divisionType ? LOCAL_SCOPE_RANK[a.divisionType] : undefined) ?? 3) -
      ((b.divisionType ? LOCAL_SCOPE_RANK[b.divisionType] : undefined) ?? 3),
  );
  for (const body of bodiesByScope) {
    for (const holder of projectedBodyRoster(body).members) {
      push(local, holder, holder.officeTitle, "local", body.ocdId);
    }
  }

  // STATE — legislative seats first (district scope), then the governor
  // and any other statewide executive (statewide scope). sldl before
  // sldu: the larger chamber's district is the narrower one.
  const stateSeats = coverage.seats.filter(
    (s) => s.divisionType === "sldl" || s.divisionType === "sldu",
  );
  stateSeats.sort((a, b) =>
    a.divisionType === b.divisionType ? 0 : a.divisionType === "sldl" ? -1 : 1,
  );
  for (const seat of stateSeats) {
    for (const holder of seat.representatives) {
      push(state, holder, seat.label, "state", seat.ocdId);
    }
  }
  for (const holder of coverage.statewideExecutives) {
    push(state, holder, holder.officeTitle, "state", null);
  }

  // FEDERAL — the House seat (district scope) before senators
  // (statewide scope).
  for (const seat of coverage.seats.filter((s) => s.divisionType === "cd")) {
    for (const holder of seat.representatives) {
      push(federal, holder, seat.label, "national", seat.ocdId);
    }
  }
  for (const holder of coverage.senators) {
    push(federal, holder, "U.S. Senator", "national", null);
  }

  return { local, state, federal };
}

/** Every row, closest-first — the flat list where one is needed. */
export function allOfficialRows(coverage: CoverageSummary): OfficialRow[] {
  const groups = groupOfficials(coverage);
  return [...groups.local, ...groups.state, ...groups.federal];
}
