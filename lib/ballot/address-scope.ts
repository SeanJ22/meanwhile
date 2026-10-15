import { CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { contestsForDivisions } from "../sources/ballot-nj-morris/index.ts";
import { MissingBallotProjectionError, type AddressBallotStatus } from "./holding.ts";
import { readerBallotSourcesForDivisions } from "./reader-sources.ts";
import type { GeographySelection } from "../census-geography/selection.ts";

export interface AddressContestScope {
  readonly contestIds: string[];
  readonly ballotStatus: AddressBallotStatus;
}

/** Ballot availability never changes independently resolved government divisions. */
export async function addressContestScopeFor(
  divisions: readonly string[],
  readSources: typeof readerBallotSourcesForDivisions = readerBallotSourcesForDivisions,
  selection?: GeographySelection,
): Promise<AddressContestScope> {
  let unavailable: Exclude<AddressBallotStatus, "HELD"> | null = null;
  for (const { source } of divisions.length ? await readSources(divisions) : []) {
    try {
      const candidate = source.normalize(await source.fetch());
      if (selection && (selection.purpose !== "election" || candidate.election.date !== selection.electionDate)) continue;
      const hit = contestsForDivisions(candidate, [...divisions]);
      if (hit.contests.length || hit.absences.length) {
        // A missing applicable authority cannot exclude any displayed contest.
        return unavailable ? { contestIds: [], ballotStatus: unavailable }
          : { contestIds: hit.contests.map(contest => contest.id), ballotStatus: "HELD" };
      }
    } catch (error) {
      if (error instanceof CivicDataStoreUnavailableError && ["BALLOT_CANDIDACY", "BALLOT_FILING"].includes(error.result.metadata.recordClass)) {
        unavailable = "HOLDING_UNAVAILABLE";
      } else if (error instanceof MissingBallotProjectionError) {
        unavailable ??= "NOT_RECORDED";
      } else {
        throw error;
      }
    }
  }
  return { contestIds: [], ballotStatus: unavailable ?? "NOT_RECORDED" };
}
