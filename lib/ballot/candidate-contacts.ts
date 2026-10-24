import { currentGenericBallotProjection } from "./generic-projection.ts";
import { ballotCandidateAliases, ballotCandidatePeople } from "./tickets.ts";
import { candidateKeysForState } from "./person-keys.ts";

export interface CandidateContact {
  candidacyId: string;
  email: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
}

const contactIndexes = new WeakMap<object, ReadonlyMap<string, CandidateContact>>();

export function candidateContactForCandidacy(state: string, candidacyId: string): CandidateContact | null {
  const projection = currentGenericBallotProjection(state);
  let index = contactIndexes.get(projection);
  if (!index) {
    const ballots = Object.values(projection.ballots);
    const current = new Set(ballots.flatMap(ballot => ballot.candidacies.flatMap(candidate =>
      [...ballotCandidateAliases(candidate), ...ballotCandidatePeople(candidate).flatMap(ballotCandidateAliases)])));
    const source = ballots.flatMap(ballot => ballot.contacts ?? []);
    const counts = new Map<string, number>();
    for (const row of source) counts.set(row.candidacyId, (counts.get(row.candidacyId) ?? 0) + 1);
    const contacts = new Map<string, CandidateContact>();
    for (const row of source) {
      if (!current.has(row.candidacyId) || counts.get(row.candidacyId) !== 1 ||
        !row.sourceUrl?.startsWith("https://") || !row.sourceOrg || !row.collectedAt) continue;
      contacts.set(row.candidacyId, { candidacyId: row.candidacyId, email: row.email?.trim() || null, sourceUrl: row.sourceUrl,
        sourceOrg: row.sourceOrg, collectedAt: row.collectedAt });
    }
    index = contacts; contactIndexes.set(projection, index);
  }
  return [candidacyId, ...candidateKeysForState(state, candidacyId)].flatMap(key => index.get(key) ?? []).at(0) ?? null;
}
