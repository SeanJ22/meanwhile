import {
  contributorRowsForDisplay,
  fundingAbsenceForTarget,
  fundingForTarget,
} from "./snapshot.ts";
import type { ContributionRow } from "./types.ts";

/**
 * The funding display payload — everything either surface (the ballot page,
 * the official modal via /api/funding) needs, serializable, contributor
 * rows already ripcord-filtered. Plain register throughout: the numbers
 * render in sentences a 15-year-old can read, the method for "small donors"
 * is stated in the words themselves, and nothing characterizes anyone.
 */

export interface FundingDisplayData {
  fecCandidateId: string;
  name: string;
  /** e.g. "2025–26" — always stated; totals never wear an unnamed cycle. */
  cycleLabel: string;
  /** The plain-language money sentences, prebuilt so both surfaces agree. */
  sentences: string[];
  /** Ripcord-filtered. Empty either means none fetched or display pulled —
   *  `contributorsShown` says which. */
  contributors: ContributionRow[];
  contributorsShown: boolean;
  reportedThrough: string | null;
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

/** "$4.2 million", "$657,000", "$325" — rounded the way people say money. */
export function plainMoney(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const millions = amount / 1_000_000;
    const rounded = millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10;
    return `$${rounded} million`;
  }
  if (abs >= 10_000) return `$${(Math.round(amount / 1000) * 1000).toLocaleString("en-US")}`;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function cycleLabelFor(cycle: number): string {
  return `${cycle - 1}–${String(cycle).slice(2)}`;
}

export function fundingAnswerForTarget(targetKey: string): FundingAnswer {
  const candidate = fundingForTarget(targetKey);
  if (candidate) {
    const { totals } = candidate;
    const sentences: string[] = [];
    sentences.push(
      `This campaign has raised ${plainMoney(totals.receipts)} in the ${cycleLabelFor(candidate.cycle)} election cycle and spent ${plainMoney(totals.disbursements)}. It has ${plainMoney(totals.cashOnHand)} on hand.`,
    );
    if (totals.smallDonorShare !== null && totals.receipts > 0) {
      sentences.push(
        `About ${Math.round(totals.smallDonorShare * 100)}% of the money came from small donors — people who gave under $200 in total.`,
      );
    }
    const contributors = contributorRowsForDisplay(candidate);
    return {
      kind: "funding",
      data: {
        fecCandidateId: candidate.fecCandidateId,
        name: candidate.name,
        cycleLabel: cycleLabelFor(candidate.cycle),
        sentences,
        contributors,
        contributorsShown: contributors.length > 0,
        reportedThrough: totals.coverageEndDate,
        sourceUrl: candidate.provenance.sourceUrl,
        sourceOrg: candidate.provenance.sourceOrg,
        collectedAt: candidate.provenance.collectedAt,
      },
    };
  }

  const absence = fundingAbsenceForTarget(targetKey);
  if (absence) {
    const statement = absence.reason.startsWith("registered with the FEC")
      ? `No campaign money reported for this election: this candidate is registered with the FEC but has not filed financial reports for the 2026 cycle.`
      : `No campaign money reported: we found no committee registered with the FEC for this candidacy. Candidates who raise or spend under $5,000 don't have to register.`;
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

/** The honest line for offices the FEC does not cover. */
export const STATE_FUNDING_NOTE =
  "Money in state and local races is filed with state campaign-finance systems, not the FEC. We haven't wired those yet — this is a gap in our data, not a statement that no money was raised.";
