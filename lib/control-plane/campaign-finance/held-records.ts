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
import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../../civic-data/read-model.ts";
import {
  PIMA_LOCAL_FINANCE_CONTRACT,
  type AzPimaFinanceReadModel,
} from "../../funding/data-plane.ts";
import { readPromotedEdgeFirst } from "../../registry/runtime-edge.ts";
import type {
  AuthorityAggregate,
  Contribution,
  Expenditure,
  IndependentExpenditureReport,
  PoliticalCommittee,
} from "./model.ts";
import type { HeldFilingUniverse } from "./answers.ts";

/* ── The Arizona local acquisition ────────────────────────────────────────── */

export const AZ_PIMA_CITATION = `${PIMA_LOCAL_FINANCE_CONTRACT.sourceId} filing index`;

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

let azPimaCache: AzPimaHeld | null = null;
let azTxCache: AzPimaTransactions | null = null;
let azPimaReadState: CivicDataReadResult<AzPimaFinanceReadModel> = civicDataReadNotInitialized(
  "LOCAL_CAMPAIGN_FINANCE",
  PIMA_LOCAL_FINANCE_CONTRACT.scope,
  "The Pima campaign-finance canonical pointer has not been read for this process.",
);

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
  azPimaReadState = result;
  if (result.kind === "PROMOTED") {
    if (result.metadata.sourceId !== PIMA_LOCAL_FINANCE_CONTRACT.sourceId) {
      throw new Error(`Pima campaign-finance pointer names ${result.metadata.sourceId}, not ${PIMA_LOCAL_FINANCE_CONTRACT.sourceId}.`);
    }
    validatePimaProjection(result.value, result.metadata.versionId ?? "unknown");
    azPimaCache = result.value.held;
    azTxCache = result.value.transactions;
    return result.metadata.versionId;
  }
  azPimaCache = null;
  azTxCache = null;
  throw new Error(result.detail);
}

/** Edge first: the reader edge's proven copy through this Reader, else the database. */
export const settleAzPimaFinanceRead = (): Promise<string | null> =>
  readPromotedEdgeFirst("LOCAL_CAMPAIGN_FINANCE", PIMA_LOCAL_FINANCE_CONTRACT.scope, refreshAzPimaFinanceFromPromoted, "The Pima campaign finance");

export function azPimaFinanceReadState(): CivicDataReadResult<AzPimaFinanceReadModel> {
  return azPimaReadState;
}

export function azPimaHeld(): AzPimaHeld {
  if (!azPimaCache) {
    throw new Error(`Pima campaign-finance filing index is ${azPimaReadState.kind}; call refreshAzPimaFinanceFromPromoted first.`);
  }
  return azPimaCache;
}

/**
 * Arizona PAC/Party reporting periods from the Secretary of State's table
 * (`ftp://ftp.azsos.gov/cfsdata2/ReportingPeriods.txt`): the expected-period
 * denominator. `asOf` selects periods whose filing window has closed; an open
 * period is not owed yet.
 */
export function azExpectedPeriods(asOf: string): {
  readonly all: readonly string[];
  readonly due: readonly string[];
  readonly notYetDue: readonly string[];
  readonly sourceCitation: string;
} {
  const rows = azPimaHeld().expectedFilingPeriodsAz2026PacParty;
  const all = rows.map((r) => r.ReportName);
  const due: string[] = [];
  const notYetDue: string[] = [];
  for (const row of rows) {
    // "YYYY-MM-DD HH:MM:SS": the date half compares lexicographically against an ISO date.
    const closes = String(row.FilingPeriodEndDate).slice(0, 10);
    if (closes <= asOf) due.push(row.ReportName);
    else notYetDue.push(row.ReportName);
  }
  return {
    all,
    due,
    notYetDue,
    sourceCitation: `${AZ_PIMA_CITATION} — expectedFilingPeriodsAz2026PacParty, from ftp://ftp.azsos.gov/cfsdata2/ReportingPeriods.txt`,
  };
}

/** Committees the county filing officer's portal lists. */
export function azPimaCommittees(): readonly PoliticalCommittee[] {
  const held = azPimaHeld();
  return held.committeeRegisterCountyPortal.map((row) => ({
    id: `easyvote:pima:${row.portalFilerId}`,
    registeredName: row.registeredName,
    type:
      row.filerType === "Candidate"
        ? "CANDIDATE_AUTHORIZED"
        : row.filerType.startsWith("PAC")
          ? "PAC"
          : row.filerType === "Party"
            ? "PARTY"
            : "OTHER",
    aliases: [],
    registrations: [
      {
        registrationId: row.portalFilerId,
        issuedBy: held.filingAuthorityIdentification.authorityId,
        registeredOn: null,
        terminatedOn: null,
      },
    ],
    /** Null even for candidate committees: matching a committee to a candidacy by name is not agreement. */
    authorizedByCandidacyId: null,
    sourceCitations: [row.source, AZ_PIMA_CITATION],
  }));
}

/** The local filing universe. Index entries are not contents, so no record class is held. */
export function azPimaUniverse(asOf: string): HeldFilingUniverse {
  const held = azPimaHeld();
  const periods = azExpectedPeriods(asOf);
  return {
    authorityIds: [held.filingAuthorityIdentification.authorityId],
    authorityNames: [held.filingAuthorityIdentification.officeNameAsPublished],
    publisherRoute:
      "https://pimacountyaz.easyvotecampaignfinance.com (EasyVote), served by https://ecf-api.easyvoteapp.com",
    recordClassesHeld: [],
    recordClassesNotHeld: [
      "CANDIDATE_COMMITTEE_REPORT",
      "PAC_REPORT",
      "BALLOT_MEASURE_COMMITTEE_REPORT",
      "INDEPENDENT_EXPENDITURE_REPORT",
      "STATEMENT_OF_ORGANIZATION",
    ],
    periodsExpected: periods.due,
    periodsHeld: [],
    periodsNotHeld: periods.due,
    coversThrough: null,
    evidenceBasis: null,
    itemizationLimit: null,
    isCompleteFilingSet: false,
    sourceCitations: [
      AZ_PIMA_CITATION,
      "https://ecf-api.easyvoteapp.com/filer/documentsearch/19626734-D3E9-449C-BB5D-EDB9C0034907",
      "ftp://ftp.azsos.gov/cfsdata2/ReportingPeriods.txt",
    ],
  };
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

/* ── The Arizona transaction acquisition ──────────────────────────────────── */

export const AZ_PIMA_TX_CITATION = `${PIMA_LOCAL_FINANCE_CONTRACT.sourceId} transactions`;
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

export function azPimaTransactions(): AzPimaTransactions {
  if (!azTxCache) {
    throw new Error(`Pima campaign-finance transactions are ${azPimaReadState.kind}; call refreshAzPimaFinanceFromPromoted first.`);
  }
  return azTxCache;
}

/** Test-only reset of the cached projection. */
export function clearAzPimaFinanceProjectionForTest(): void {
  if (!mayUseTestFixture()) throw new Error("Pima campaign-finance reset is test-only.");
  azPimaCache = null;
  azTxCache = null;
  azPimaReadState = civicDataReadNotInitialized(
    "LOCAL_CAMPAIGN_FINANCE",
    PIMA_LOCAL_FINANCE_CONTRACT.scope,
    "The Pima campaign-finance canonical pointer has not been read for this process.",
  );
}

/**
 * The only `ItemizedListType` that is a contribution. Loans, interest, refunds
 * and other receipts are kept by {@link azPimaOtherReceiptsFor}.
 */
const AZ_CONTRIBUTION_TYPE = "Contribution";

/**
 * Distribution types that are this committee's own spending. `Contributions
 * Made` is excluded (it is a contribution into another committee, and would
 * double-count); the rest are kept by {@link azPimaOtherDisbursementsFor}.
 */
const AZ_EXPENDITURE_TYPES: readonly string[] = [
  "Disbursments", // the vendor's own spelling, preserved rather than corrected
  "Expenditures",
  "Miscellaneous Disbursements",
];

/** Committee names exactly as filed, never normalised. */
export function azPimaTransactionCommitteeNames(): readonly string[] {
  const tx = azPimaTransactions();
  const names = new Set<string>();
  for (const row of tx.contributions) if (row.RecipientCommitteeName) names.add(row.RecipientCommitteeName);
  for (const row of tx.distributions) if (row.CandidateCommitteeName) names.add(row.CandidateCommitteeName);
  return [...names].sort();
}

/**
 * Matched on the committee name exactly as filed, case-sensitively. Variant
 * spellings of one committee are not merged: a name match is not agreement.
 */
export function azPimaContributionsFor(committeeNameAsFiled: string): readonly Contribution[] {
  return azPimaTransactions()
    .contributions.filter(
      (row) => row.RecipientCommitteeName === committeeNameAsFiled && row.ItemizedListType === AZ_CONTRIBUTION_TYPE,
    )
    .map((row) => ({
      recordKind: "CONTRIBUTION" as const,
      intoCommitteeId: `easyvote:pima:name:${committeeNameAsFiled}`,
      amountReceived: Number(row.ContributionAmount ?? 0),
      /* `|| null` so an all-empty row stays null rather than "". */
      contributorNameAsFiled:
        row.ContributorFullName ??
        row.ContributorOrganizationName ??
        ([row.ContributorFirstName, row.ContributorMiddleName, row.ContributorLastName]
          .filter(Boolean)
          .join(" ") || null),
      // As filed; impossible years are not repaired.
      receivedOn: row.ContributionDate,
      filingId: row.DocumentFilingId,
      sourceCitation: `${AZ_PIMA_TX_CITATION} — advancedsearch/contributions, filing ${row.DocumentFilingId}`,
    }));
}

export function azPimaExpendituresFor(committeeNameAsFiled: string): readonly Expenditure[] {
  return azPimaTransactions()
    .distributions.filter(
      (row) =>
        row.CandidateCommitteeName === committeeNameAsFiled && AZ_EXPENDITURE_TYPES.includes(row.ItemizedListType),
    )
    .map((row) => ({
      recordKind: "EXPENDITURE" as const,
      byCommitteeId: `easyvote:pima:name:${committeeNameAsFiled}`,
      amountSpent: Number(row.DistributionAmount ?? 0),
      /* `|| null`: an empty join must read as no payee, not a payee named "". */
      payeeNameAsFiled:
        row.PayeeOrganizationName ??
        ([row.PayeeFirstName, row.PayeeLastName].filter(Boolean).join(" ") || null),
      spentOn: row.DistributionDate,
      /** This endpoint returns no purpose field; none is inferred. */
      purposeAsFiled: null,
      filingId: row.DocumentFilingId,
      sourceCitation: `${AZ_PIMA_TX_CITATION} — advancedsearch/distributions, filing ${row.DocumentFilingId}`,
    }));
}

/** Money in that is NOT a contribution, kept so the set is lossless. */
export function azPimaOtherReceiptsFor(
  committeeNameAsFiled: string,
): readonly { readonly itemizedListTypeAsFiled: string; readonly amount: number; readonly on: string | null }[] {
  return azPimaTransactions()
    .contributions.filter(
      (row) => row.RecipientCommitteeName === committeeNameAsFiled && row.ItemizedListType !== AZ_CONTRIBUTION_TYPE,
    )
    .map((row) => ({
      itemizedListTypeAsFiled: row.ItemizedListType,
      amount: Number(row.ContributionAmount ?? 0),
      on: row.ContributionDate,
    }));
}

/** Money out that is NOT this committee's own spending, kept so the set is lossless. */
export function azPimaOtherDisbursementsFor(
  committeeNameAsFiled: string,
): readonly { readonly itemizedListTypeAsFiled: string; readonly amount: number; readonly on: string | null }[] {
  return azPimaTransactions()
    .distributions.filter(
      (row) =>
        row.CandidateCommitteeName === committeeNameAsFiled && !AZ_EXPENDITURE_TYPES.includes(row.ItemizedListType),
    )
    .map((row) => ({
      itemizedListTypeAsFiled: row.ItemizedListType,
      amount: Number(row.DistributionAmount ?? 0),
      on: row.DistributionDate,
    }));
}

/**
 * One local committee's filing universe from the transaction route. Every row
 * carries its `DocumentFilingId`, so the basis is `FILING`, off redacted public
 * copies, as `itemizationLimit` says.
 */
export function azPimaTransactionUniverse(committeeNameAsFiled: string): HeldFilingUniverse {
  const held = azPimaHeld();
  const contributions = azPimaContributionsFor(committeeNameAsFiled);
  const expenditures = azPimaExpendituresFor(committeeNameAsFiled);
  const anything = contributions.length > 0 || expenditures.length > 0;
  const filingIds = new Set<string>();
  for (const c of contributions) filingIds.add(c.filingId);
  for (const e of expenditures) filingIds.add(e.filingId);

  return {
    authorityIds: [held.filingAuthorityIdentification.authorityId],
    authorityNames: [held.filingAuthorityIdentification.officeNameAsPublished],
    publisherRoute:
      "https://ecf-api.easyvoteapp.com/advancedsearch/{contributions,distributions}/{customerId} — " +
      "the Pima County tenant's own public transaction search",
    recordClassesHeld: anything ? ["CANDIDATE_COMMITTEE_REPORT"] : [],
    /** Every row this route returns is DocumentType "CCFR"; independent-expenditure reports are a different type. */
    recordClassesNotHeld: [
      "INDEPENDENT_EXPENDITURE_REPORT",
      "BALLOT_MEASURE_COMMITTEE_REPORT",
      "PARTY_COMMITTEE_REPORT",
      "STATEMENT_OF_ORGANIZATION",
    ],
    /** Null: the transaction search is not cut by reporting period. */
    periodsExpected: null,
    periodsHeld: [],
    periodsNotHeld: [],
    coversThrough: null,
    evidenceBasis: anything ? "FILING" : null,
    itemizationLimit: anything
      ? "the itemized rows the county's public transaction search exposes, off REDACTED public " +
        "copies of the filings — every filing id carried here ends '_Redacted'. Rows are matched on " +
        "the committee name exactly as filed and are not deduplicated across spellings."
      : null,
    isCompleteFilingSet: false,
    sourceCitations: [
      AZ_PIMA_TX_CITATION,
      `https://ecf-api.easyvoteapp.com/advancedsearch/contributions/19626734-D3E9-449C-BB5D-EDB9C0034907`,
      ...[...filingIds].slice(0, 3),
    ],
  };
}

/** What is still missing locally once transactions are held. */
export function azPimaResidualGap(subjectId: string): {
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
      "itemized contributions and disbursements are now held off the county's public transaction " +
      "search, but three things are not: the UNREDACTED filing bodies (every filing id held ends " +
      "'_Redacted', and documents/getdocumentfiling still answers HTTP 401), any " +
      "INDEPENDENT-EXPENDITURE report (every row returned carries DocumentType 'CCFR'), and any " +
      "committee-to-measure linkage (neither the county portal nor the state register publishes it).",
    nextMove:
      "For independent expenditures, walk the Arizona Secretary of State's seethemoney.az.gov " +
      "reporting surface, which is recorded REACHABLE with no robots.txt and no terms. For the " +
      "unredacted bodies, a public-records request to the Pima County filing officer. For the " +
      "linkage, the committees' own Statements of Organization.",
    readerSentence:
      "We can show you the contributions and spending these committees reported. We cannot yet show " +
      "you outside spending for or against a measure, or say which committees are for or against one " +
      "— those are gaps in our records rather than a sign that none exists.",
  };
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
      "FEC Schedule E is not read. docs/sources.md records OpenFEC as WIRED for committee TOTALS " +
      "only; tracker D51 holds the independent-expenditure surface behind PB10/D23, the " +
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
