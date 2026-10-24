import type { BallotSet } from "./types.ts";
import { canonicalCongressionalDivision } from "../ocd/fips.ts";
import type { Provenance } from "../sources/types.ts";

/** The official source places the entire member division in this electorate. */
export interface BallotDistrictMembership {
  id: string;
  memberOcdId: string;
  districtOcdId: string;
  provenance: Provenance;
}

export type BallotWithDistrictMemberships = BallotSet & { districtMemberships?: readonly BallotDistrictMembership[] };

export function divisionsWithDistrictMemberships(set: BallotSet, divisions: readonly string[]): Set<string> {
  const present = new Set(divisions);
  const supplied = (set as BallotWithDistrictMemberships).districtMemberships;
  const memberships = Array.isArray(supplied) ? supplied : [];
  const districts = new Map<string, string[]>();
  const base = (id: string) => /^(ocd-division\/country:us\/(?:state|district|territory):[a-z]{2})(?:\/|$)/.exec(id)?.[1];
  for (const row of memberships) {
    if (!row || typeof row.memberOcdId !== "string" || typeof row.districtOcdId !== "string" ||
        typeof row.provenance?.sourceUrl !== "string" || !row.provenance.sourceUrl.trim() ||
        !base(row.memberOcdId) || base(row.memberOcdId) !== base(row.districtOcdId)) continue;
    const members = districts.get(row.memberOcdId) ?? [];
    members.push(row.districtOcdId);
    districts.set(row.memberOcdId, members);
  }
  const pending = [...present];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    const state = /^(ocd-division\/country:us\/(?:state|district|territory):[a-z]{2})\//.exec(id)?.[1];
    // A saved address may carry an older spelling of its House seat (nd/cd:0); ballots hold the canonical seat (nd/cd:at-large).
    const seat = id.includes("/cd:") ? canonicalCongressionalDivision(id) : null;
    for (const next of [...(districts.get(id) ?? []), ...(state ? [state] : []), ...(seat ? [seat] : [])]) {
      if (present.has(next)) continue;
      present.add(next);
      pending.push(next);
    }
  }
  return present;
}
