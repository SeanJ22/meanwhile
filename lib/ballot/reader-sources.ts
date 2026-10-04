import { readGenericBallotProjection, type GenericBallotProjection } from "./generic-projection.ts";
import { ballotSourcesForDivisions, ballotSourceForTargetId, type RegisteredBallotSource } from "./registry.ts";
import { contestsForDivisions } from "../sources/ballot-nj-morris/index.ts";
import type { BallotSet } from "./types.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

/** Data, rather than a state allowlist, determines which authority answers. */
export function genericSourcesForDivisions(value: GenericBallotProjection, divisions: readonly string[]): RegisteredBallotSource[] {
  const today = new Date().toISOString().slice(0, 10);
  const ballots = Object.values(value.ballots).filter(ballot => {
    const hit = contestsForDivisions(ballot, divisions);
    return hit.contests.length > 0 || hit.absences.length > 0;
  }).sort((a, b) => {
    // The nearest dated upcoming election first; retain unknown dates as
    // unknown, and concluded elections after upcoming ones.
    const order = (ballot: BallotSet) => !ballot.election.date ? `1:${ballot.election.id}`
      : ballot.election.date >= today ? `0:${ballot.election.date}` : `2:${99999999 - Number(ballot.election.date.replaceAll("-", ""))}`;
    return order(a).localeCompare(order(b)) || a.election.id.localeCompare(b.election.id);
  });
  return ballots.map(ballot => ({ state: ballot.election.state.toLowerCase(), source: {
    name: `ballot-contests:${ballot.election.id}`,
    fetch: async () => [ballot],
    normalize: () => ballot,
    upsert: async () => { throw new Error("Ballots publish through the civic-data promotion path."); },
  } }));
}

/** The legacy reader remains during migration until the new path is checked live. */
export async function readerBallotSourcesForDivisions(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<readonly RegisteredBallotSource[]> {
  if (!divisions.length) return [];
  const legacy = ballotSourcesForDivisions(divisions);
  try {
    const read = await readGenericBallotProjection(options);
    if (read.kind === "PROMOTED") return [...genericSourcesForDivisions(read.value, divisions), ...legacy];
    if (read.kind !== "STORE_UNREACHABLE" || read.code === "STORE_NOT_CONFIGURED") return legacy;
    throw new Error(read.code);
  } catch (error) {
    // Expose the failed general authority through each entry point's existing
    // holding-gap handling; the legacy authority keeps its own failure domain.
    return [{ state: "general ballot", source: { name: "ballot-contests",
      fetch: async () => { throw error; }, normalize: () => { throw error; },
      upsert: async () => { throw error; },
    } }, ...legacy];
  }
}

/** Intake resolves exact published IDs, including IDs a worker minted after deployment. */
export async function readerBallotSourceForTargetId(targetId: string, options: PromotedCivicDataReadOptions = {}): Promise<RegisteredBallotSource | null> {
  const legacy = ballotSourceForTargetId(targetId);
  if (legacy) return legacy;
  const read = await readGenericBallotProjection(options);
  if (read.kind !== "PROMOTED") return null;
  for (const ballot of Object.values(read.value.ballots)) {
    if (ballot.candidacies.some(row => row.id === targetId) || ballot.contests.some(row => row.id === targetId)
      || ballot.measureRecords?.some(row => row.parts.some(part => part.id === targetId))) {
      return genericSourcesForDivisions({ kind: "ballot-contests", ballots: { [ballot.election.id]: ballot } }, ballot.contests.map(row => row.ocdId))[0] ?? null;
    }
  }
  return null;
}
