import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { BallotSet } from "../ballot/types.ts";
import { namesAgree, type MatchBasis, type StateMoneyRecord } from "./state-money.ts";
import type { FinanceDoorRead, FinanceFiling } from "./finance-door-reader.ts";

export interface BoundFinanceFiling {
  readonly filing: FinanceFiling;
  readonly record: StateMoneyRecord;
}

/**
 * The filing officer supplies the candidate, office and cycle. The promoted
 * ballot supplies the exact served jurisdiction and candidate key. Keep an
 * unmatched filing as work; a committee name alone never identifies a person.
 * Each reported period remains separate, with no sum or newest-report guess.
 */
export function bindFinanceDoorFilings(input: {
  readonly read: FinanceDoorRead;
  readonly ballots: readonly BallotSet[];
  readonly agency: string;
}): { readonly bound: readonly BoundFinanceFiling[]; readonly unbound: readonly FinanceFiling[] } {
  const bound: BoundFinanceFiling[] = [], unbound: FinanceFiling[] = [];
  for (const filing of input.read.filings) {
    const jurisdiction = jurisdictionFromOcdId(filing.ocdId);
    if (!input.read.paginationComplete || !input.agency.trim() || !jurisdiction || !filing.candidateName || !filing.office) {
      unbound.push(filing); continue;
    }
    const matches = input.ballots.flatMap(ballot => {
      // An unknown election date stays unknown. Its ID/name is not a year.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ballot.election.date) || !Number.isFinite(Date.parse(ballot.election.date)) ||
          new Date(ballot.election.date).toISOString().slice(0, 10) !== ballot.election.date ||
          ballot.election.state !== jurisdiction.usps || Number(ballot.election.date.slice(0, 4)) !== filing.electionYear) return [];
      return ballot.candidacies.flatMap(candidate => {
        const contest = ballot.contests.find(row => row.id === candidate.contestId && row.type === "CANDIDACY" && row.ocdId === filing.ocdId);
        if (!contest) return [];
        const office = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
        if (office(filing.office!) !== office(contest.title) ||
            !namesAgree(filing.candidateName!, [candidate.givenName, candidate.familyName].filter(Boolean).join(" "))) return [];
        const match: MatchBasis = { registeredName: filing.registeredName,
          officeAsFiled: filing.office, officeOnBallot: contest.title,
          electionYearAsFiled: filing.electionYear, electionYearOnBallot: Number(ballot.election.date.slice(0, 4)),
          allThreeAgree: true, note: "Filed candidate name, exact office title, jurisdiction and election year agree with one promoted ballot candidacy." };
        return [{ candidate, match }];
      });
    });
    const distinct = new Map(matches.map(match => [match.candidate.id, match]));
    if (distinct.size !== 1) { unbound.push(filing); continue; }
    const { candidate, match } = [...distinct.values()][0];
    bound.push({ filing, record: {
      dataClass: "STATE_COMMITTEE", jurisdiction: jurisdiction.usps, agency: input.agency,
      filingsUrl: filing.sourceUrl, committeeId: filing.committeeId, registeredName: filing.registeredName,
      candidateNameAsFiled: filing.candidateName, officeSought: filing.office, electionYear: filing.electionYear,
      filingState: "FILED", targetKeys: [candidate.id], match,
      totals: { receipts: filing.receipts, expenditures: filing.expenditures, cashOnHand: filing.cashOnHand,
        reportCount: null, coveringPeriod: filing.period },
      checkedAt: filing.retrievedAt.slice(0, 10),
      provenance: { sourceUrl: filing.sourceUrl, sourceOrg: input.agency, collectedAt: filing.retrievedAt, verifiedAt: null },
    } });
  }
  return { bound, unbound };
}
