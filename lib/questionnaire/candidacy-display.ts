import { surnameDisplayCase } from "../ballot/name-case.ts";
import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
import { requireBallotState } from "../civic-data/state-scopes.ts";

export interface CandidacyDisplay {
  name: string;
  officeTitle: string;
}

export function invitationBallotState(contestId: string): string | null {
  const namespace = /^(?:ballot-)?([a-z]{2})[-:]/i.exec(contestId)?.[1];
  if (!namespace) return null;
  try { return requireBallotState(namespace); } catch { return null; }
}

export async function displayFor(state: string, candidacyId: string): Promise<CandidacyDisplay | null> {
  const read = await readGenericBallotProjection(state);
  if (read.kind !== "PROMOTED") return null;
  for (const ballot of Object.values(read.value.ballots)) {
    const candidate = [...ballot.candidacies, ...ballot.filingCandidacies ?? []].find(row => row.id === candidacyId);
    if (!candidate) continue;
    const contest = ballot.contests.find(row => row.id === candidate.contestId);
    if (!contest) return null;
    const name = `${candidate.givenName} ${surnameDisplayCase(candidate.familyName)}`.replace(/\s+/g, " ").trim();
    return name && contest.title ? { name, officeTitle: contest.title } : null;
  }
  return null;
}
