/**
 * WHAT WE ACTUALLY HOLD — the committed records, in the model's own types.
 *
 * `authority.ts` says which government holds the records. `answers.ts` renders
 * what we hold. This file is the join between them, and it is the file where
 * every honesty question about the pilot data actually gets decided.
 *
 * ## Two obligations, two very different depths, and the difference is the point
 *
 * **FEDERAL — `ballot-az-pima:us-house-6`.** Read out of `data/fec/fec-2026.json`
 * rather than transcribed, so a snapshot refresh cannot leave a stale number
 * behind. Itemized contribution rows exist for two of the four certified
 * candidacies; a reported receipts and disbursements total exists for all four.
 *
 * **LOCAL — `ballot-az-pima:prop-423`.** Read out of
 * `data/campaign-finance/az-pima-2026-held.json`, acquired 2026-08-29 from the
 * Pima County filing officer's own portal. **It contains no money.** 138 filers
 * and 680 filing records were retrieved; the filing BODIES answered HTTP 401,
 * so not one contribution row, expenditure row or summary total for any Pima
 * County committee is held. That is a wall on a route, and the whole apparatus
 * below exists so it renders as a wall rather than as a quiet zero.
 *
 * ## THE FEC TOTALS ARE NOT A FILING
 *
 * `data/fec/fec-2026.json` carries `totals`, which the FEC produces by adding up
 * reports it holds. No committee filed a document that says $6,172,866.72. So it
 * is materialised as `AuthorityAggregate`, not as `CampaignFinanceFiling`, and
 * the `EvidenceBasis` travels with it — because telling a reader that a figure
 * appears "in the 2026 Q2 report" when it appears in no report is a fabricated
 * citation, and a fabricated citation is worse than a missing one.
 *
 * ## THE TEN ROWS ARE NOT THE DONORS
 *
 * `FundingCandidate.topContributions` is the committee's TOP itemized receipts,
 * not its itemized receipts. Every universe built here carries an
 * `itemizationLimit` saying so, and `answerWhoContributed` emits the gap between
 * the rows held and the total reported. A reader shown ten names beside a
 * six-million-dollar figure will otherwise read the ten as the donors.
 *
 * ## Time
 *
 * Nothing here reads a clock. Dates come from the artifacts or from the caller.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fundingForTarget } from "../../funding/snapshot.ts";
import type { FundingCandidate } from "../../funding/types.ts";
import type {
  AuthorityAggregate,
  Contribution,
  Expenditure,
  IndependentExpenditureReport,
  PoliticalCommittee,
} from "./model.ts";
import type { HeldFilingUniverse } from "./answers.ts";

/* ── The Arizona local acquisition ────────────────────────────────────────── */

export const AZ_PIMA_HELD_PATH = ["data", "campaign-finance", "az-pima-2026-held.json"] as const;

const AZ_PIMA_FILE = join(import.meta.dirname, "..", "..", "..", ...AZ_PIMA_HELD_PATH);
export const AZ_PIMA_CITATION = AZ_PIMA_HELD_PATH.join("/");

export interface AzPimaFilingIndexRow {
  readonly portalFilerId: string;
  readonly committeeRegisteredName: string;
  readonly filingId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly dateSubmitted: string;
  /** Always false in this acquisition. The index is public; the bodies are not. */
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

export function azPimaHeld(): AzPimaHeld {
  if (!azPimaCache) azPimaCache = JSON.parse(readFileSync(AZ_PIMA_FILE, "utf8")) as AzPimaHeld;
  return azPimaCache;
}

/**
 * The Arizona 2026 PAC/Party reporting periods, from the Secretary of State's
 * OWN table — `ftp://ftp.azsos.gov/cfsdata2/ReportingPeriods.txt`.
 *
 * **This is the expected-period DENOMINATOR**, and until this acquisition the
 * repository did not have one. `coverage.ts` emits `PERIOD_DENOMINATOR_UNKNOWN`
 * whenever `filingPeriodsExpected` is null, precisely because "filings acquired"
 * with no denominator is a count that measures our own output. For Arizona, it
 * is now a real list read from the state.
 *
 * `asOf` selects the periods whose FILING WINDOW HAS CLOSED. A period still open
 * for filing is not a missing report — the filer has not been asked for it yet,
 * and counting it as owed would manufacture a gap on a government's behalf.
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
    // The table's dates are "YYYY-MM-DD HH:MM:SS"; the date half compares
    // lexicographically against an ISO date, which is what asOf is.
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

/** Committees the Pima County filing officer's portal lists for the Vail district. */
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
    /**
     * NULL EVEN FOR THE CANDIDATE COMMITTEES, and deliberately.
     *
     * The portal gives a committee name and an office name. It does not give a
     * candidacy id in this repository's namespace, and matching "Ed Buster for
     * VUSD Board" to a candidacy would be a name match — which this project's
     * own bar refuses to treat as agreement. It stays null and the identity
     * question stays open.
     */
    authorizedByCandidacyId: null,
    sourceCitations: [row.source, AZ_PIMA_CITATION],
  }));
}

/**
 * The Arizona local filing universe.
 *
 * Note what is in `recordClassesHeld`: `STATEMENT_OF_ORGANIZATION` and
 * `PAC_REPORT` are held **as index entries** — we know they exist, when they
 * were filed and what the authority calls them. Nothing in `recordClassesHeld`
 * implies we hold their CONTENTS, which is why every money answer built on this
 * universe still emits an `OURS` gap.
 */
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

/**
 * **THE WALL, AS A GAP THAT NAMES ITSELF AS OURS.**
 *
 * This is the whole local obligation in one value. The filing index is public
 * and acquired; the filing bodies are behind HTTP 401. A reader must be told
 * that we could not read them — never that the committees raised nothing.
 */
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

/* ── The Arizona TRANSACTION acquisition — the route that broke the 401 ───── */

export const AZ_PIMA_TRANSACTIONS_PATH = [
  "data",
  "campaign-finance",
  "az-pima-2026-transactions.json",
] as const;

const AZ_PIMA_TX_FILE = join(import.meta.dirname, "..", "..", "..", ...AZ_PIMA_TRANSACTIONS_PATH);
export const AZ_PIMA_TX_CITATION = AZ_PIMA_TRANSACTIONS_PATH.join("/");

export interface AzPimaContributionRow {
  readonly DocumentFilingId: string;
  readonly DocumentType: string;
  readonly ItemizedListType: string;
  readonly RecipientCommitteeName: string | null;
  readonly OfficeName: string | null;
  readonly ContributorFullName: string | null;
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

let azTxCache: AzPimaTransactions | null = null;

export function azPimaTransactions(): AzPimaTransactions {
  if (!azTxCache) azTxCache = JSON.parse(readFileSync(AZ_PIMA_TX_FILE, "utf8")) as AzPimaTransactions;
  return azTxCache;
}

/**
 * **THE ONE ITEMIZED-LIST-TYPE THAT IS A CONTRIBUTION.**
 *
 * The contributions endpoint returns nine `ItemizedListType` values, and only
 * one of them is a contribution. `Loan`, `Interest`, `Rebate/Refund`,
 * `Donation/Support`, `Payment/Reimbursement`, `Outstanding Debt`,
 * `Surplus Money` and `Miscellaneous Receipt` are all money arriving at a
 * committee, and not one of them is somebody contributing to a campaign.
 *
 * Mapping them all to `Contribution` would answer "who has contributed to this
 * campaign?" with a bank's interest payment. They are carried separately by
 * {@link azPimaOtherReceiptsFor} so that nothing is dropped either.
 */
const AZ_CONTRIBUTION_TYPE = "Contribution";

/**
 * The distribution types that are this committee spending its own money.
 *
 * `Contributions Made` is deliberately NOT here: money this committee gave to
 * ANOTHER committee is a contribution into that one, and folding it into
 * "what this committee spent" double-counts it the moment both committees are
 * rendered. `Rebates and Refunds` and `Outstanding Accounts/Debts` are not
 * spending either. All of them are kept by {@link azPimaOtherDisbursementsFor}.
 */
const AZ_EXPENDITURE_TYPES: readonly string[] = [
  "Disbursments", // the vendor's own spelling, preserved rather than corrected
  "Expenditures",
  "Miscellaneous Disbursements",
];

/** Committee names exactly as filed. NEVER normalised — see the caveat below. */
export function azPimaTransactionCommitteeNames(): readonly string[] {
  const tx = azPimaTransactions();
  const names = new Set<string>();
  for (const row of tx.contributions) if (row.RecipientCommitteeName) names.add(row.RecipientCommitteeName);
  for (const row of tx.distributions) if (row.CandidateCommitteeName) names.add(row.CandidateCommitteeName);
  return [...names].sort();
}

/**
 * Rows are matched on the committee name EXACTLY AS FILED, case-sensitively.
 *
 * `Andrés for Supervisor` and `ANDRES FOR SUPERVISOR` are two distinct values in
 * this data and are almost certainly one committee. They are NOT merged here.
 * Merging them would be a name match, and this project's own bar refuses to
 * treat a name match as agreement — the same rule that keeps
 * `authorizedByCandidacyId` null on the committees above. A caller that wants
 * both passes both, and the reader is told the universe is cut by name.
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
      contributorNameAsFiled: row.ContributorFullName ?? row.ContributorOrganizationName ?? null,
      // As filed. Years 0006 and 2926 exist in this data and are NOT repaired.
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
      payeeNameAsFiled:
        row.PayeeOrganizationName ?? [row.PayeeFirstName, row.PayeeLastName].filter(Boolean).join(" ") ?? null,
      spentOn: row.DistributionDate,
      /**
       * NULL, and it is the honest value. This endpoint returns no purpose
       * field at all. Arizona filings carry one; this representation does not
       * expose it, and inventing a purpose from the payee's name would be
       * exactly the inference this product refuses.
       */
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
 * The filing universe for ONE Pima County committee, from the transaction route.
 *
 * `evidenceBasis` is `FILING` and not `AUTHORITY_AGGREGATE`: every row carries
 * the `DocumentFilingId` it came off, so unlike the FEC totals these figures
 * really are off filings. What they are off is the REDACTED public copy of
 * those filings, which is what `itemizationLimit` says.
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
    /**
     * INDEPENDENT_EXPENDITURE_REPORT stays here even though money is now held.
     * Every row this route returns carries `DocumentType: "CCFR"`; an Arizona
     * independent-expenditure report is a different document type and this
     * endpoint returned none. Holding contributions does not retire the class.
     */
    recordClassesNotHeld: [
      "INDEPENDENT_EXPENDITURE_REPORT",
      "BALLOT_MEASURE_COMMITTEE_REPORT",
      "PARTY_COMMITTEE_REPORT",
      "STATEMENT_OF_ORGANIZATION",
    ],
    /**
     * NULL, and the null is load-bearing. The transaction search is not cut by
     * reporting period — it returns rows across filings with no period label —
     * so this repository cannot say which of Arizona's periods these rows cover.
     * `azExpectedPeriods` has the state's real calendar; joining it to these
     * rows would be a guess.
     */
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

/**
 * What is STILL missing in Pima County now that the money is held.
 *
 * {@link azPimaMoneyGap} described a total wall and was correct when it was
 * written. It is superseded for committees the transaction route covers; this
 * is the residual, and it is still `OURS` because every item in it is a route
 * this session did not complete rather than a record Pima County withholds.
 */
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
  /** NOT a filing. The FEC's own arithmetic across the reports it holds. */
  readonly aggregate: AuthorityAggregate | null;
  readonly contributions: readonly Contribution[];
  /**
   * ALWAYS EMPTY in this snapshot, and the empty is a fact about us.
   *
   * `data/fec/fec-2026.json` carries a disbursements TOTAL and no itemized
   * disbursement rows — the snapshot script fetches committee totals and top
   * receipts, and Schedule B is not among them.
   */
  readonly expenditures: readonly Expenditure[];
  /**
   * ALWAYS EMPTY, and the empty is a fact about us and the law together.
   *
   * FEC Schedule E is not read at all: `docs/sources.md` records OpenFEC as
   * "WIRED for committee TOTALS only", and tracker `D51` sits behind `PB10`/`D23`
   * — the election-law counsel review of the 52 U.S.C. § 30111(a)(4)
   * sale-or-use restriction. A blocked route is not a blocked fact.
   */
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
      // The FEC's own two-year period identifier, and its own coverage-end
      // field. Neither is invented, and no report label is claimed.
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
    // The FEC publishes the sum without publishing how many reports went into
    // it. Null is the honest value; a count invented here would become a
    // denominator nobody measured.
    aggregatedAcrossFilings: null,
    isCompleteFilingSet: false,
  };

  const contributions: Contribution[] = funding.topContributions.map((row, index) => ({
    recordKind: "CONTRIBUTION",
    intoCommitteeId: committeeId,
    amountReceived: row.amount,
    contributorNameAsFiled: row.contributorName,
    receivedOn: row.receiptDate,
    /**
     * The AGGREGATE id, not a filing id — and it is prefixed `fec-aggregate:`
     * so it cannot be mistaken for one at a glance. These rows came off the
     * FEC's Schedule A endpoint keyed by committee and cycle, not off a single
     * named report, and claiming a report here would be a fabricated citation.
     */
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
    /**
     * NAMED, never counted. The independent-expenditure class is the one whose
     * absence changes what the other numbers MEAN.
     */
    recordClassesNotHeld: [
      "INDEPENDENT_EXPENDITURE_REPORT",
      "PAC_REPORT",
      "PARTY_COMMITTEE_REPORT",
      "STATEMENT_OF_ORGANIZATION",
    ],
    /**
     * NULL, and it is the honest value: the FEC's own reporting calendar has
     * not been read, so we do not know how many reports this cycle owes. The
     * Arizona side has a real denominator now; the federal side does not, and
     * pretending otherwise would be the coverage attack mode.
     */
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
 * The federal independent-expenditure gap, attributed to `THE_LAW` rather than
 * to the FEC.
 *
 * This distinction is the reason `GapAttribution` has four values instead of
 * two. The FEC publishes Schedule E. We do not read it, and the reason is a
 * legal restriction WE are subject to and a counsel review WE have not
 * completed. Rendering that as "the FEC does not publish this" would move our
 * blocker onto a government, which is a false claim about a government.
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
