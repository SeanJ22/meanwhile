import { readBallotNavigationProjection } from "../../lib/civic-data/curated-reader-read-model.ts";
import { electionFieldState, type PublishedElectionField } from "../../lib/civic-data/election-fields.ts";
import type { PromotedCivicDataReadOptions } from "../../lib/civic-data/read-model.ts";

export async function readElectionFieldsForDivisions(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  const states = [...new Set(divisions.map(electionFieldState).filter((state): state is string => state !== null))];
  const reads = await Promise.all(states.map(state => readBallotNavigationProjection(state, options)));
  const fields = reads.flatMap(read => read.kind === "PROMOTED" ? read.value.records.filter(row =>
    row.kind === "ELECTION_FIELD" && divisions.includes((row as unknown as PublishedElectionField).value.divisionId)) as unknown as PublishedElectionField[] : []);
  return { reads, fields };
}
