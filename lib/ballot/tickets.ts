import { ballotCandidateDisplayName } from "./name-case.ts";
import type { BallotSet, Candidacy } from "./types.ts";
import type { Provenance } from "../sources/types.ts";

/** A pairing stated by the election authority, never a join on party. */
export interface BallotCandidateTicket {
  id: string;
  leadCandidacyId: string;
  runningMate: Candidacy & { office?: string };
  provenance: Provenance;
}

export type BallotWithTickets = BallotSet & { candidateTickets?: readonly BallotCandidateTicket[] };

/** Keep the published records intact; present one choice for a joint ticket. */
export function withCandidateTickets(set: BallotSet): BallotSet {
  const tickets = (set as BallotWithTickets).candidateTickets;
  if (!tickets?.length) return set;
  const candidates = new Map(set.candidacies.map(row => [row.id, row]));
  const contests = new Map(set.contests.map(row => [row.id, row]));
  const leadCounts = new Map<string, number>(), mateCounts = new Map<string, number>();
  for (const ticket of tickets) {
    leadCounts.set(ticket.leadCandidacyId, (leadCounts.get(ticket.leadCandidacyId) ?? 0) + 1);
    mateCounts.set(ticket.runningMate.id, (mateCounts.get(ticket.runningMate.id) ?? 0) + 1);
  }
  const paired = new Map<string, BallotCandidateTicket>();
  for (const ticket of tickets) {
    const lead = candidates.get(ticket.leadCandidacyId), mate = ticket.runningMate;
    const leadContest = lead && contests.get(lead.contestId), mateContest = contests.get(mate.contestId);
    if (!lead || !leadContest || !mateContest || !mate.familyName?.trim() || mate.id === lead.id ||
        leadCounts.get(lead.id) !== 1 || mateCounts.get(mate.id) !== 1 ||
        !ticket.provenance.sourceUrl || !ticket.provenance.quote?.trim() ||
        leadContest.type !== "CANDIDACY" || mateContest.type !== "CANDIDACY" ||
        leadContest.electionId !== mateContest.electionId || leadContest.ocdId !== mateContest.ocdId) continue;
    paired.set(lead.id, ticket);
  }
  if (!paired.size) return set;

  // An old separate office is removed from this view only when all of its
  // candidates are explicitly represented on tickets in the same contest.
  const mates = new Map([...paired.values()].map(ticket => [ticket.runningMate.id, ticket]));
  const suppressed = new Set<string>();
  for (const contest of set.contests) {
    const rows = set.candidacies.filter(row => row.contestId === contest.id);
    if (!rows.length || rows.some(row => !mates.has(row.id) || paired.has(row.id))) continue;
    const leadContests = new Set(rows.map(row => candidates.get(mates.get(row.id)!.leadCandidacyId)!.contestId));
    if (leadContests.size === 1 && !leadContests.has(contest.id)) suppressed.add(contest.id);
  }
  const candidacies = set.candidacies.filter(row => !suppressed.has(row.contestId)).map(row => {
    const ticket = paired.get(row.id);
    if (!ticket) return row;
    const leadName = ballotCandidateDisplayName(row), mateName = ballotCandidateDisplayName(ticket.runningMate);
    const name = leadName.endsWith(` / ${mateName}`) ? leadName : `${leadName} / ${mateName}`;
    const mateParty = ticket.runningMate.partyLabel;
    const partyLabel = row.partyLabel && mateParty && row.partyLabel !== mateParty && !row.partyLabel.endsWith(` / ${mateParty}`)
      ? `${row.partyLabel} / ${mateParty}` : row.partyLabel;
    return { ...row, givenName: "", familyName: name, partyLabel, provenance: ticket.provenance };
  });
  const projected = new Map(candidacies.map(row => [row.id, row]));
  return {
    ...set,
    contests: set.contests.filter(row => !suppressed.has(row.id)).map(row => {
      const offices = [...paired.values()].filter(ticket => candidates.get(ticket.leadCandidacyId)!.contestId === row.id)
        .map(ticket => ticket.runningMate.office ?? contests.get(ticket.runningMate.contestId)?.title)
        .filter((office): office is string => Boolean(office && office !== row.title && !row.title.includes(office)));
      const unique = [...new Set(offices)];
      return unique.length === 1 ? { ...row, title: `${row.title} / ${unique[0]}` } : row;
    }),
    candidacies,
    ...(set.generalLineup ? { generalLineup: { ...set.generalLineup, contests: set.generalLineup.contests
      .filter(row => !suppressed.has(row.contestId)).map(row => ({ ...row, nominees: row.nominees.map(nominee => {
        const matches = [...paired.keys()].filter(id => {
          const candidate = candidates.get(id)!;
          return candidate.contestId === row.contestId && ballotCandidateDisplayName(candidate) === nominee.name;
        });
        if (matches.length !== 1) return nominee;
        const candidate = projected.get(matches[0])!;
        return { ...nominee, name: ballotCandidateDisplayName(candidate), partyLabel: candidate.partyLabel ?? nominee.partyLabel,
          provenance: paired.get(candidate.id)!.provenance };
      }) })) } } : {}),
  };
}
