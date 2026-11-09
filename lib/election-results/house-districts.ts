import type { BallotSet } from "../ballot/types.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import type { HouseDistrictResult } from "./summary.ts";
import type { ElectionResultStatus } from "./types.ts";

const partyOf = (label: string | null | undefined): "D" | "R" | "I" | null =>
  !label?.trim() ? null : /^d/i.test(label.trim()) ? "D" : /^r/i.test(label.trim()) ? "R" : "I";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Per-district results for the national House map, keyed by the district's division id. A contest appears only when the Slide
 * published its outcome with every vote-getter matched; the party is the winner's once called, otherwise the leader's.
 */
export function houseDistrictResults(ballots: readonly BallotSet[], facts: Readonly<Record<string, unknown>>): Record<string, HouseDistrictResult> {
  const out: Record<string, HouseDistrictResult> = {};
  for (const ballot of ballots) {
    if (ballot.election.date !== "2026-11-03") continue;
    for (const contest of ballot.contests) {
      if (contest.type !== "CANDIDACY" || officeIdentity(contest.title, contest.ocdId) !== "us_representative") continue;
      const fact = facts[contest.id];
      if (!record(fact) || fact.allCandidatesMatched !== true || typeof fact.status !== "string") continue;
      const candidates = ballot.candidacies.filter(candidate => candidate.contestId === contest.id).flatMap(candidate => {
        const result = facts[candidate.id];
        return record(result) ? [{ party: partyOf(candidate.partyLabel), won: result.won === true, votes: typeof result.votes === "number" ? result.votes : -1 }] : [];
      });
      const decided = fact.status === "called" || fact.status === "certified" || fact.status === "unopposed";
      const lead = decided ? candidates.find(candidate => candidate.won) : candidates.reduce<typeof candidates[number] | undefined>(
        (best, candidate) => candidate.votes > (best?.votes ?? -1) ? candidate : best, undefined);
      out[contest.ocdId] = { status: fact.status as ElectionResultStatus, party: lead?.party ?? null, flipped: typeof fact.flipped === "boolean" ? fact.flipped : null };
    }
  }
  return out;
}
