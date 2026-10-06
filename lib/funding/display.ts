import {
  concentrationOf,
  concentrationSentences,
  type FundingConcentration,
} from "./concentration.ts";
import {
  typeConcentrationOf,
  typeConcentrationSentences,
} from "./type-concentration.ts";
import { groupContributions, type ContributorGroups } from "./grouping.ts";
import {
  contributorRowsForDisplay,
  fundingAbsenceForTarget,
  fundingForTarget,
  secondHopForGroups,
} from "./snapshot.ts";
import type { CommitteeTotals, ContributionRow, SecondHopCommittee } from "./types.ts";
import { smallDonorShare, smallDonorSentence } from "./small-donors.ts";
import { plainMoney } from "./plain-money.ts";

/**
 * The funding display payload — everything either surface (the ballot page,
 * the official modal via /api/funding) needs, serializable, contributor
 * rows already ripcord-filtered. Plain register throughout: the numbers
 * render in sentences a 15-year-old can read, the method for "small donors"
 * is stated in the words themselves, and nothing characterizes anyone.
 */

export interface FundingDisplayData {
  fecCandidateId: string;
  /** Exact held committee/cycle for on-demand filing reads; no credential value. */
  detailSource?: { committeeId: string; cycle: number };
  name: string;
  /** e.g. "2025–26" — always stated; totals never wear an unnamed cycle. */
  cycleLabel: string;
  /** The plain-language money sentences, prebuilt so both surfaces agree. */
  sentences: string[];
  /** Five filed committee values for numeric display; cash is never inferred from receipts minus spending. */
  totals: Pick<CommitteeTotals, "receipts" | "disbursements" | "cashOnHand" | "smallDonorShare" | "individualItemized" | "individualUnitemized" | "coverageEndDate"> | null;
  /** Ripcord-filtered. Empty either means none fetched or display pulled —
   *  `contributorsShown` says which. */
  contributors: ContributionRow[];
  /**
   * The same rows, grouped by kind and sorted by amount descending, with
   * repeated filings from one contributor folded (item 2). Built here so
   * the ballot page and the official modal render the identical order —
   * one sort, computed once, not two implementations that can drift.
   */
  contributorGroups: ContributorGroups;
  contributorsShown: boolean;
  /**
   * The second hop (item 3): the contributing committees' own books, keyed
   * by FEC committee id, for the committee rows above. Only committees the
   * hop was actually fetched for appear — a missing id renders no expander
   * rather than an empty one.
   */
  secondHop: Record<string, SecondHopCommittee>;
  reportedThrough: string | null;
  /**
   * **Where the money came from, and how concentrated it is** (D06).
   *
   * Null when there is nothing to compute over — never a row of zeros,
   * which would read as "no money came from anywhere". The sentences carry
   * their own denominator, because these are computed over the LARGEST
   * reported contributions and not the campaign's whole book.
   */
  concentration: FundingConcentration | null;
  concentrationSentences: string[];
  /**
   * **Concentration on the FEC's own axis** — D06's third feature, shipped
   * g20. How the committee money divides across the categories the
   * contributing committees filed for themselves. Empty when there is no
   * committee money among the rows shown; never a zero row, which would
   * read as a claim about the campaign rather than about our sample.
   */
  typeConcentrationSentences: string[];
  sourceUrl: string | null;
  sourceOrg: string;
  collectedAt: string;
}

export interface FundingAbsenceData {
  /** The honest sentence for a search that came back empty. */
  statement: string;
  searchUrl: string | null;
  checkedAt: string;
}

export type FundingAnswer =
  | { kind: "funding"; data: FundingDisplayData }
  | { kind: "absence"; data: FundingAbsenceData }
  | { kind: "none" };

/** "$4.2 million", "$657,000", "$325" — one shared rounding rule (./plain-money.ts). */
export { plainMoney };

function cycleLabelFor(cycle: number): string {
  return `${cycle - 1}–${String(cycle).slice(2)}`;
}

export { smallDonorShare, smallDonorSentence } from "./small-donors.ts";

export function fundingAnswerForTarget(targetKey: string): FundingAnswer {
  const candidate = fundingForTarget(targetKey);
  if (candidate) {
    const { totals } = candidate;
    const sentences: string[] = [];
    sentences.push(
      `This campaign has raised ${plainMoney(totals.receipts)} in the ${cycleLabelFor(candidate.cycle)} election cycle and spent ${plainMoney(totals.disbursements)}. It has ${plainMoney(totals.cashOnHand)} on hand.`,
    );
    const smallDonor = smallDonorSentence(totals.individualItemized, totals.individualUnitemized);
    if (smallDonor) sentences.push(smallDonor);
    const contributors = contributorRowsForDisplay(candidate);
    const contributorGroups = groupContributions(contributors);
    // D06: computed over the rows the READER is shown, so the figure and
    // the table below it can never disagree — and it is null, not zero,
    // when the display is ripcorded off or nothing was fetched.
    const concentration = concentrationOf(contributors, candidate.state ?? null);
    // D06's third feature (g20): the same rows, on the FEC's own committee
    // categories. Committee side only — the two lists were sampled
    // separately, so a band crossing them would be a share of a base we
    // picked rather than of anything the campaign reported.
    const typeConcentration = typeConcentrationOf(contributors);

    return {
      kind: "funding",
      data: {
        fecCandidateId: candidate.fecCandidateId,
        ...(candidate.principalCommitteeId ? { detailSource: { committeeId: candidate.principalCommitteeId, cycle: candidate.cycle } } : {}),
        name: candidate.name,
        cycleLabel: cycleLabelFor(candidate.cycle),
        sentences,
        totals: {
          receipts: totals.receipts,
          disbursements: totals.disbursements,
          cashOnHand: totals.cashOnHand,
          smallDonorShare: smallDonorShare(totals.individualItemized, totals.individualUnitemized),
          individualItemized: totals.individualItemized,
          individualUnitemized: totals.individualUnitemized,
          coverageEndDate: totals.coverageEndDate,
        },
        contributors,
        contributorGroups,
        secondHop: secondHopForGroups(contributorGroups),
        contributorsShown: contributors.length > 0,
        reportedThrough: totals.coverageEndDate,
        concentration,
        concentrationSentences: concentration
          ? concentrationSentences(concentration, candidate.state ?? null)
          : [],
        typeConcentrationSentences: typeConcentration
          ? typeConcentrationSentences(typeConcentration)
          : [],
        sourceUrl: candidate.provenance.sourceUrl,
        sourceOrg: candidate.provenance.sourceOrg,
        collectedAt: candidate.provenance.collectedAt,
      },
    };
  }

  const absence = fundingAbsenceForTarget(targetKey);
  if (absence) {
    const statement = absence.reason.startsWith("registered with the FEC")
      ? `The FEC shows this candidate registered, with no financial reports filed for the 2026 cycle, so we have no campaign money to show.`
      : `We found no committee registered with the FEC for this candidacy, so we have no campaign money to show. Candidates who raise or spend under $5,000 don't have to register.`;
    return {
      kind: "absence",
      data: {
        statement,
        searchUrl: absence.searchUrl,
        checkedAt: absence.checkedAt,
      },
    };
  }

  return { kind: "none" };
}

// The 2a label mapper lives in ./labels.ts (client-safe — this module sits
// on the node:fs snapshot graph and the client funding section needs the
// labels); re-exported here so server callers keep one import surface.
export { plainContributorLabel } from "./labels.ts";

/** The honest line for offices the FEC does not cover. */
export const STATE_FUNDING_NOTE =
  "Money in state and local races is filed with state campaign-finance systems.";
