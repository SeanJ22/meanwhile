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
 * The funding display payload for both surfaces (the ballot page and the
 * official modal), serializable, contributor rows already ripcord-filtered.
 */

export interface FundingDisplayData {
  fecCandidateId: string;
  /** Exact held committee/cycle for on-demand filing reads; no credential value. */
  detailSource?: { committeeId: string; committeeIds?: readonly string[]; cycle: number };
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
   * The same rows, grouped by kind, amount descending, with repeated filings
   * from one contributor folded. Built once so both surfaces render the same order.
   */
  contributorGroups: ContributorGroups;
  contributorsShown: boolean;
  /**
   * The contributing committees' own books, keyed by FEC committee id. Only
   * committees actually fetched appear; a missing id renders no expander.
   */
  secondHop: Record<string, SecondHopCommittee>;
  reportedThrough: string | null;
  /**
   * Where the money came from, and how concentrated it is. Null when there is
   * nothing to compute over, never zeros. Computed over the largest reported
   * contributions, not the whole book.
   */
  concentration: FundingConcentration | null;
  concentrationSentences: string[];
  /**
   * How the committee money divides across the FEC's own committee
   * categories. Empty when no committee money is among the rows shown.
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
    const reported = [totals.receipts === null ? null : `raised ${plainMoney(totals.receipts)}`,
      totals.disbursements === null ? null : `spent ${plainMoney(totals.disbursements)}`].filter(Boolean);
    if (reported.length) sentences.push(`This campaign has ${reported.join(" and ")} in the ${cycleLabelFor(candidate.cycle)} election cycle.`);
    if (totals.cashOnHand !== null) sentences.push(`It has ${plainMoney(totals.cashOnHand)} on hand.`);
    if (totals.individualItemized !== null && totals.individualUnitemized !== null) {
      sentences.push(`Individual contributions totaled ${plainMoney(totals.individualItemized + totals.individualUnitemized)}.`);
    }
    const smallDonor = smallDonorSentence(totals.individualItemized, totals.individualUnitemized);
    if (smallDonor) sentences.push(smallDonor);
    const contributors = contributorRowsForDisplay(candidate);
    const contributorGroups = groupContributions(contributors);
    // Computed over the rows the reader is shown; null, not zero, when nothing is shown.
    const concentration = concentrationOf(contributors, candidate.state ?? null);
    // Committee side only: the two lists were sampled separately, so a band
    // across them would be a share of a base we picked.
    const typeConcentration = typeConcentrationOf(contributors);
    const committeeIds = candidate.principalCommitteeIds ?? (candidate.principalCommitteeId ? [candidate.principalCommitteeId] : []);

    return {
      kind: "funding",
      data: {
        fecCandidateId: candidate.fecCandidateId,
        ...(committeeIds.length ? { detailSource: { committeeId: committeeIds[0], committeeIds, cycle: candidate.cycle } } : {}),
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
    const statement = absence.reason;
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

// Re-exported from the client-safe ./labels.ts so server callers keep one import surface.
export { plainContributorLabel } from "./labels.ts";

/** The honest line for offices the FEC does not cover. */
export const STATE_FUNDING_NOTE =
  "Money in state and local races is filed with state campaign-finance systems.";
