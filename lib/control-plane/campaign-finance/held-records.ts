/**
 * Held campaign-finance records, in the model's own types.
 *
 * FEC `totals` are the FEC's own sum across reports, not a filing, so they are
 * materialised as `AuthorityAggregate` with their `EvidenceBasis`.
 * `FundingCandidate.topContributions` are the TOP itemized receipts, not every
 * itemized receipt; universes built from them carry an `itemizationLimit`.
 *
 * Nothing here reads a clock.
 */

import { fundingForTarget } from "../../funding/snapshot.ts";
import type { FundingCandidate } from "../../funding/types.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import {
  PIMA_LOCAL_FINANCE_CONTRACT,
  type AzPimaFinanceReadModel,
} from "../../funding/data-plane.ts";
import type {
  AuthorityAggregate,
  Contribution,
  Expenditure,
  IndependentExpenditureReport,
  PoliticalCommittee,
} from "./model.ts";
import type { HeldFilingUniverse } from "./answers.ts";

export interface AzPimaFilingIndexRow {
  readonly portalFilerId: string;
  readonly committeeRegisteredName: string;
  readonly filingId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly dateSubmitted: string;
  /** The index is public; the bodies may not be. */
  readonly documentBodyHeld: boolean;
  readonly documentBodyWall: string;
}

export interface AzPimaCommitteeRow {
  readonly portalFilerId: string;
  readonly registeredName: string;
  readonly filerType: string;
  readonly status: string;
  readonly officeName: string | null;
  readonly filingCount: number;
  readonly source: string;
}

export interface AzPimaHeld {
  readonly formatVersion: number;
  readonly recordedOn: string;
  readonly filingAuthorityIdentification: {
    readonly authorityId: string;
    readonly officeNameAsPublished: string;
    readonly readFrom: string;
    readonly readOn: string;
    readonly whatThisEstablishesAndWhatItDoesNot: string;
  };
  readonly committeeRegisterCountyPortal: readonly AzPimaCommitteeRow[];
  readonly committeeRegisterStateFtp: readonly Record<string, string | null>[];
  readonly filingsIndexed: readonly AzPimaFilingIndexRow[];
  readonly expectedFilingPeriodsAz2026PacParty: readonly Record<string, string>[];
  readonly acquisitions: readonly Record<string, unknown>[];
  readonly notHeld: readonly string[];
}

function validatePimaProjection(value: AzPimaFinanceReadModel, version: string): void {
  if (
    value.formatVersion !== 1 ||
    value.held?.formatVersion !== 1 ||
    value.transactions?.formatVersion !== 1 ||
    !Array.isArray(value.held.committeeRegisterCountyPortal) ||
    !Array.isArray(value.held.filingsIndexed) ||
    !Array.isArray(value.transactions.contributions) ||
    !Array.isArray(value.transactions.distributions)
  ) {
    throw new Error(`Pima campaign-finance projection ${version} does not satisfy its Reader contract.`);
  }
}

/** Canonical local-finance preload. */
export async function refreshAzPimaFinanceFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const result = await readPromotedCivicData<AzPimaFinanceReadModel>(
    "LOCAL_CAMPAIGN_FINANCE",
    PIMA_LOCAL_FINANCE_CONTRACT.scope,
    options,
  );
  if (result.kind === "PROMOTED") {
    if (result.metadata.sourceId !== PIMA_LOCAL_FINANCE_CONTRACT.sourceId) {
      throw new Error(`Pima campaign-finance pointer names ${result.metadata.sourceId}, not ${PIMA_LOCAL_FINANCE_CONTRACT.sourceId}.`);
    }
    validatePimaProjection(result.value, result.metadata.versionId ?? "unknown");
    return result.metadata.versionId;
  }
  throw new Error(result.detail);
}

/** The filing index is public; the bodies answered HTTP 401. A wall, never a zero. */
export function azPimaMoneyGap(subjectId: string): {
  readonly attribution: "OURS";
  readonly subject: string;
  readonly what: string;
  readonly nextMove: string;
  readonly readerSentence: string;
} {
  return {
    attribution: "OURS",
    subject: subjectId,
    what:
      "the Pima County filing INDEX is held (138 filers, 680 filings) and every filing BODY is not: " +
      "https://ecf-api.easyvoteapp.com/documents/getdocumentfiling/{documentId} answered HTTP 401 " +
      "on 2026-08-29",
    nextMove:
      "Find the public route to the filing bodies — the portal renders them to an unauthenticated " +
      "visitor, so a route exists that this walk did not find. Failing that, a public-records " +
      "request to the Pima County filing officer.",
    readerSentence:
      "We know which committees have filed campaign-finance reports here and when they filed them, " +
      "but we have not been able to read the reports themselves yet. The money in them is not " +
      "something we can show you — that is a gap in our records, not a sign that none was raised.",
  };
}
export interface AzPimaContributionRow {
  readonly DocumentFilingId: string;
  readonly DocumentType: string;
  readonly ItemizedListType: string;
  readonly RecipientCommitteeName: string | null;
  readonly OfficeName: string | null;
  readonly ContributorFullName: string | null;
  /** Individual contributors are usually filed as name parts with `ContributorFullName` null. */
  readonly ContributorFirstName: string | null;
  readonly ContributorMiddleName: string | null;
  readonly ContributorLastName: string | null;
  readonly ContributorOrganizationName: string | null;
  readonly ContributionDate: string | null;
  readonly ContributionAmount: number | null;
}

export interface AzPimaDistributionRow {
  readonly DocumentFilingId: string;
  readonly DocumentType: string;
  readonly ItemizedListType: string;
  readonly CandidateCommitteeName: string | null;
  readonly OfficeName: string | null;
  readonly PayeeOrganizationName: string | null;
  readonly PayeeFirstName: string | null;
  readonly PayeeLastName: string | null;
  readonly DistributionDate: string | null;
  readonly DistributionAmount: number | null;
}

export interface AzPimaTransactions {
  readonly formatVersion: number;
  readonly recordedOn: string;
  readonly acquisition: Record<string, unknown>;
  readonly reconciliation: {
    readonly capSuspected: boolean;
    readonly verdict: string;
    readonly probes: readonly { readonly year: string; readonly serverRows: number; readonly localRows: number }[];
  };
  readonly limitsOfThisUniverse: readonly string[];
  readonly counts: Record<string, unknown>;
  readonly contributions: readonly AzPimaContributionRow[];
  readonly distributions: readonly AzPimaDistributionRow[];
}

/* ── The federal materialisation ──────────────────────────────────────────── */

export interface FederalHeldRecords {
  readonly candidacyId: string;
  readonly displayName: string;
  readonly committee: PoliticalCommittee | null;
  /** Not a filing: the FEC's own arithmetic across the reports it holds. */
  readonly aggregate: AuthorityAggregate | null;
  readonly contributions: readonly Contribution[];
  /** Always empty: the snapshot carries a disbursements total and no Schedule B rows. */
  readonly expenditures: readonly Expenditure[];
  /** Always empty: FEC Schedule E is not read pending a legal review. */
  readonly independentExpenditureReports: readonly IndependentExpenditureReport[];
}

export const FEC_SNAPSHOT_CITATION = "data/fec/fec-2026.json";

function committeeFor(funding: FundingCandidate): PoliticalCommittee | null {
  if (!funding.principalCommitteeId) return null;
  return {
    id: funding.principalCommitteeId,
    registeredName: `${funding.name} — principal campaign committee`,
    type: "CANDIDATE_AUTHORIZED",
    aliases: [],
    registrations: [
      {
        registrationId: funding.principalCommitteeId,
        issuedBy: "us:federal:fec",
        registeredOn: null,
        terminatedOn: null,
      },
    ],
    authorizedByCandidacyId: null,
    sourceCitations: [funding.provenance.sourceUrl ?? FEC_SNAPSHOT_CITATION, FEC_SNAPSHOT_CITATION],
  };
}

export function federalHeldRecordsFor(
  candidacyId: string,
  displayName: string,
  deps?: { fundingForTarget?: (targetKey: string) => FundingCandidate | null },
): FederalHeldRecords {
  const read = deps?.fundingForTarget ?? fundingForTarget;
  const funding = read(candidacyId);
  if (!funding) {
    return {
      candidacyId,
      displayName,
      committee: null,
      aggregate: null,
      contributions: [],
      expenditures: [],
      independentExpenditureReports: [],
    };
  }

  const committee = committeeFor(funding);
  const committeeId = funding.principalCommitteeId ?? `${funding.fecCandidateId}:no-committee`;
  const aggregateId = `fec-aggregate:${committeeId}:cycle-${funding.cycle}`;

  const aggregate: AuthorityAggregate = {
    recordKind: "AUTHORITY_AGGREGATE",
    id: aggregateId,
    committeeId,
    filingAuthorityId: "us:federal:fec",
    period: {
      // The FEC's own two-year period id and coverage-end field; no report label is claimed.
      label: String(funding.cycle),
      coversFrom: null,
      coversThrough: funding.totals.coverageEndDate,
      dueOn: null,
    },
    sourceUrl: funding.provenance.sourceUrl,
    sourceCitation: FEC_SNAPSHOT_CITATION,
    reportedReceipts: funding.totals.receipts,
    reportedDisbursements: funding.totals.disbursements,
    reportedItemizedReceipts: funding.totals.individualItemized,
    // The FEC does not publish how many reports went into the sum.
    aggregatedAcrossFilings: null,
    isCompleteFilingSet: false,
  };

  const contributions: Contribution[] = funding.topContributions.map((row, index) => ({
    recordKind: "CONTRIBUTION",
    intoCommitteeId: committeeId,
    amountReceived: row.amount,
    contributorNameAsFiled: row.contributorName,
    receivedOn: row.receiptDate,
    /** The aggregate id, prefixed `fec-aggregate:`: these rows are not off a single named report. */
    filingId: aggregateId,
    sourceCitation: `${FEC_SNAPSHOT_CITATION} — ${funding.fecCandidateId} topContributions[${index}]`,
  }));

  return {
    candidacyId,
    displayName,
    committee,
    aggregate,
    contributions,
    expenditures: [],
    independentExpenditureReports: [],
  };
}

/** The federal filing universe for one candidacy, with its limits stated. */
export function federalUniverse(records: FederalHeldRecords): HeldFilingUniverse {
  const agg = records.aggregate;
  return {
    authorityIds: ["us:federal:fec"],
    authorityNames: ["Federal Election Commission"],
    publisherRoute: "https://api.open.fec.gov/v1 — committed as data/fec/fec-2026.json",
    recordClassesHeld: agg === null ? [] : ["CANDIDATE_COMMITTEE_REPORT"],
    recordClassesNotHeld: [
      "INDEPENDENT_EXPENDITURE_REPORT",
      "PAC_REPORT",
      "PARTY_COMMITTEE_REPORT",
      "STATEMENT_OF_ORGANIZATION",
    ],
    /** Null: the FEC reporting calendar has not been read. */
    periodsExpected: null,
    periodsHeld: agg === null ? [] : [agg.period.label],
    periodsNotHeld: [],
    coversThrough: agg?.period.coversThrough ?? null,
    evidenceBasis: agg === null ? null : "AUTHORITY_AGGREGATE",
    itemizationLimit:
      records.contributions.length === 0
        ? null
        : `the ${records.contributions.length} largest itemized receipts as filed, not the complete itemized list`,
    isCompleteFilingSet: false,
    sourceCitations: [
      FEC_SNAPSHOT_CITATION,
      records.committee?.sourceCitations[0] ?? "https://www.fec.gov/data/",
    ],
  };
}

/**
 * The federal independent-expenditure gap is attributed to `THE_LAW`, not the
 * FEC: the FEC publishes Schedule E and the restriction is on our side.
 */
export function federalIndependentExpenditureGap(subjectId: string): {
  readonly attribution: "THE_LAW";
  readonly subject: string;
  readonly what: string;
  readonly nextMove: string;
  readonly readerSentence: string;
} {
  return {
    attribution: "THE_LAW",
    subject: subjectId,
    what:
      "FEC Schedule E is not read. The source registry records OpenFEC as WIRED for committee TOTALS " +
      "only; the independent-expenditure surface waits on D23, the " +
      "election-law counsel review of the 52 U.S.C. § 30111(a)(4) sale-or-use restriction.",
    nextMove:
      "Counsel closes D23. Nobody else may. Until then the route is BLOCKED_CURRENTLY, which is a " +
      "statement about our permission to read and never about whether the spending happened.",
    readerSentence:
      "We are not able to show outside spending in this race yet. The Federal Election Commission " +
      "publishes it; a legal question on our side about using that data is still open, so this is " +
      "our restriction rather than a finding that no outside money was spent.",
  };
}
