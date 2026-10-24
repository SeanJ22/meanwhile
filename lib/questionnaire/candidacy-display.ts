import { ballotCandidateDisplayName } from "../ballot/name-case.ts";
import { ballotCandidateAliases, ballotCandidatePeople, withCandidateTickets } from "../ballot/tickets.ts";
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
  for (const raw of Object.values(read.value.ballots)) {
    const ballot = withCandidateTickets(raw);
    const candidate = [...ballot.candidacies, ...ballot.filingCandidacies ?? []].flatMap(ballotCandidatePeople)
      .find(row => ballotCandidateAliases(row).includes(candidacyId));
    if (!candidate) continue;
    const parent = ballot.candidacies.find(row => row.ticket?.runningMate.id === candidate.id);
    const contest = ballot.contests.find(row => row.id === (parent?.contestId ?? candidate.contestId));
    if (!contest) return null;
    const name = ballotCandidateDisplayName(candidate);
    const officeTitle = "office" in candidate && typeof candidate.office === "string" ? candidate.office : contest.title;
    return name && officeTitle ? { name, officeTitle } : null;
  }
  return null;
}
