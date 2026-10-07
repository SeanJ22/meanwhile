/**
 * Campaign-finance domain model.
 *
 * The invariant: an IndependentExpenditure must never be representable as, or
 * aggregable into, money received by a candidate. `Contribution` alone carries
 * `intoCommitteeId`/`amountReceived`; independent expenditures live on a
 * separate report type with no `contributions` field; and `totalReceivedBy`
 * throws on any row whose `recordKind` is not a contribution.
 *
 * Every date is caller-supplied. Nothing here reads the clock.
 */

import type { Disposition, PermissionState, TransportState } from "../../workstate/types.ts";
import type { AdapterRouteDeclaration } from "../preflight.ts";

/* ── Filing authority ─────────────────────────────────────────────────────── */

/**
 * Mixes jurisdictional tiers (`COUNTY`, `MUNICIPAL`) with custodian kinds
 * (`CLERK`, `ETHICS_COMMISSION`, `VENDOR_PORTAL`) on purpose: a municipal tier
 * can be held by a clerk.
 */
export const FILING_AUTHORITY_LEVELS = [
  "FEDERAL",
  "STATE",
  "COUNTY",
  "MUNICIPAL",
  "SCHOOL_DISTRICT",
  "SPECIAL_DISTRICT",
  "ETHICS_COMMISSION",
  "CLERK",
  "VENDOR_PORTAL",
] as const;
export type FilingAuthorityLevel = (typeof FILING_AUTHORITY_LEVELS)[number];

/** The level of the office or measure. Separate from `FilingAuthorityLevel`: the two need not agree. */
export const OFFICE_LEVELS = [
  "FEDERAL",
  "STATEWIDE",
  "LEGISLATIVE",
  "COUNTY",
  "SCHOOL_DISTRICT",
  "COMMUNITY_COLLEGE_DISTRICT",
  "SPECIAL_TAXING_DISTRICT",
  "CITY_OR_TOWN",
] as const;
export type OfficeLevel = (typeof OFFICE_LEVELS)[number];

/** What kinds of record a custodian actually holds. */
export const FILING_RECORD_CLASSES = [
  "CANDIDATE_COMMITTEE_REPORT",
  "PAC_REPORT",
  "PARTY_COMMITTEE_REPORT",
  "BALLOT_MEASURE_COMMITTEE_REPORT",
  "INDEPENDENT_EXPENDITURE_REPORT",
  "STATEMENT_OF_ORGANIZATION",
] as const;
export type FilingRecordClass = (typeof FILING_RECORD_CLASSES)[number];

/**
 * The legally responsible custodian for one jurisdiction and one record class.
 * `statutoryBasis` stays null until the statute has been read from source.
 */
export interface FilingAuthority {
  /** Stable id, e.g. "<st>:county:<name>:elections-officer". */
  readonly id: string;
  /** The custodian's own name, as its own government writes it. */
  readonly name: string;
  readonly level: FilingAuthorityLevel;
  /** The jurisdiction whose elections it is the filing officer FOR. */
  readonly jurisdiction: string;
  readonly recordClasses: readonly FilingRecordClass[];
  /**
   * The statute or rule that routes filings here, verbatim-citable. Null when
   * this repository has not read one from the source.
   */
  readonly statutoryBasis: string | null;
  /** The exact quoted operative sentence, when we have read it. Never a paraphrase. */
  readonly statutoryQuote: string | null;
  /** What this repository still owes on the statute question, if anything. */
  readonly statutoryOpenQuestion: string | null;
  /** How we learned this custodian exists — a repo path or a walked URL. */
  readonly discoveredVia: readonly string[];
  /** Where its filings are published, when known. */
  readonly filingsUrl: string | null;
  /** True when filings reach the public through a commercial platform. */
  readonly vendorPlatform: string | null;
}

/** One jurisdiction's complete filing routing table. */
export interface FilingRegime {
  /** Two-letter postal code, upper case, or "US" for the federal regime. */
  readonly jurisdiction: string;
  /** The statute that defines the filing officer, when read from source. */
  readonly statutoryBasis: string | null;
  readonly statutorySourceUrl: string | null;
  readonly statutoryReadOn: string | null;
  /** `true` when filing is split across custodians rather than centralised. */
  readonly federated: boolean;
  /**
   * How many distinct filing jurisdictions the regime has, from the government's
   * OWN table. Null when the denominator is not known — never estimated.
   */
  readonly filingJurisdictionCount: number | null;
  readonly filingJurisdictionBreakdown: string | null;
  readonly denominatorSource: string | null;
  /** Office level -> the routing rule that governs it. */
  readonly routing: readonly FilingRoutingRule[];
}

export interface FilingRoutingRule {
  readonly officeLevel: OfficeLevel;
  readonly authorityLevel: FilingAuthorityLevel;
  /** The custodian role, in the statute's own words. */
  readonly custodianRole: string;
  /** The operative sentence, quoted. A paraphrase of a routing rule is a different routing rule. */
  readonly quote: string;
}

/**
 * `RESOLVED`: the custodian is known by rule, with provenance. `OPEN`: the rule
 * is known and the office holding it is not. `NO_REGIME_ON_RECORD`: we do not
 * know which authority governs the contest (a claim about us, not a
 * government). Anything but `RESOLVED` keeps coverage open.
 */
export const AUTHORITY_RESOLUTION_STATUSES = ["RESOLVED", "OPEN", "NO_REGIME_ON_RECORD"] as const;
export type AuthorityResolutionStatus = (typeof AUTHORITY_RESOLUTION_STATUSES)[number];

/* ── Committees ───────────────────────────────────────────────────────────── */

export const COMMITTEE_TYPES = [
  "CANDIDATE_AUTHORIZED",
  "PAC",
  "PARTY",
  "BALLOT_MEASURE",
  "INDEPENDENT_EXPENDITURE",
  "OTHER",
] as const;
export type CommitteeType = (typeof COMMITTEE_TYPES)[number];

/** A registration id, always paired with the authority that issued it. */
export interface CommitteeRegistration {
  /** The id as the authority writes it, e.g. an FEC committee id. */
  readonly registrationId: string;
  /** `FilingAuthority.id` of the issuer. An id with no issuer is not an identity. */
  readonly issuedBy: string;
  readonly registeredOn: string | null;
  readonly terminatedOn: string | null;
}

/** A committee's canonical identity. Aliases are recorded, never used to assert a match. */
export interface PoliticalCommittee {
  readonly id: string;
  /** The committee's registered name, exactly as filed. Never edited. */
  readonly registeredName: string;
  readonly type: CommitteeType;
  readonly aliases: readonly string[];
  readonly registrations: readonly CommitteeRegistration[];
  /** The candidacy this committee is authorised by; null for every other committee type. */
  readonly authorizedByCandidacyId: string | null;
  readonly sourceCitations: readonly string[];
}

/* ── Filings ──────────────────────────────────────────────────────────────── */

export interface FilingPeriod {
  /** The authority's own label for the period, e.g. "2026 Q2". Never invented. */
  readonly label: string;
  readonly coversFrom: string | null;
  readonly coversThrough: string | null;
  /** When the report was due, when the authority publishes a calendar. */
  readonly dueOn: string | null;
}

export const FILING_KINDS = [
  "PERIODIC_REPORT",
  "PRE_ELECTION_REPORT",
  "POST_ELECTION_REPORT",
  "STATEMENT_OF_ORGANIZATION",
  "TERMINATION",
  "OTHER",
] as const;
export type FilingKind = (typeof FILING_KINDS)[number];

/**
 * One report, statement or amendment filed by a committee. Filings are an
 * append-only set: an amendment supersedes a claim without deleting it.
 */
export interface CampaignFinanceFiling {
  readonly id: string;
  readonly committeeId: string;
  readonly kind: FilingKind;
  readonly filingPeriod: FilingPeriod;
  /** When the committee filed it, per the authority. Null when not published. */
  readonly filedAt: string | null;
  /** `FilingAuthority.id`. The EXACT custodian, never a level. */
  readonly filingAuthorityId: string;
  /** Content-addressed artifact id for the acquired document. Null when not acquired. */
  readonly sourceArtifactId: string | null;
  /** Where the document was acquired from, or would be. */
  readonly sourceUrl: string | null;
  /** 1 for an original; each amendment increments. */
  readonly version: number;
  /** The filing id this one amends. Null on an original. */
  readonly amends: string | null;
  /** Filing ids that amend THIS one. Append-only. */
  readonly amendedBy: readonly string[];
  readonly contributions: readonly Contribution[];
  readonly expenditures: readonly Expenditure[];
}

/* ── The money ────────────────────────────────────────────────────────────── */

/** Money into a committee. `intoCommitteeId`/`amountReceived` appear on no other type here. */
export interface Contribution {
  readonly recordKind: "CONTRIBUTION";
  /** The committee that RECEIVED it. */
  readonly intoCommitteeId: string;
  /** As filed, in dollars. Never characterized, never bucketed here. */
  readonly amountReceived: number;
  /** The contributor's name exactly as filed, or null when unitemized. */
  readonly contributorNameAsFiled: string | null;
  readonly receivedOn: string | null;
  /** The filing this row came off. A row with no filing is not evidence. */
  readonly filingId: string;
  readonly sourceCitation: string;
}

/** Money OUT of a committee, by that committee, on its own behalf. */
export interface Expenditure {
  readonly recordKind: "EXPENDITURE";
  readonly byCommitteeId: string;
  readonly amountSpent: number;
  readonly payeeNameAsFiled: string | null;
  readonly spentOn: string | null;
  readonly purposeAsFiled: string | null;
  readonly filingId: string;
  readonly sourceCitation: string;
}

export const SUPPORT_OPPOSE = ["SUPPORTS", "OPPOSES"] as const;
export type SupportOppose = (typeof SUPPORT_OPPOSE)[number];

/** A stance of one spend toward one candidacy or measure, read off the filing's own designation, never inferred. */
export interface SupportOpposeRelation {
  readonly stance: SupportOppose;
  /** The CANDIDACY (or measure) the spending is about. Never a committee id. */
  readonly aboutCandidacyId: string;
  /** The filing field the stance was READ from, e.g. "FEC Form 5, support/oppose indicator". */
  readonly evidenceField: string;
  readonly sourceCitation: string;
}

/**
 * Money spent about a race by an entity that is not the candidate's committee.
 * It has no recipient committee field. `notCoordinated` is literal `true`: a
 * coordinated expenditure is a different record.
 */
export interface IndependentExpenditure {
  readonly recordKind: "INDEPENDENT_EXPENDITURE";
  /** The outside committee that SPENT the money. It received nothing here. */
  readonly bySpenderCommitteeId: string;
  readonly amountSpentIndependently: number;
  readonly relation: SupportOpposeRelation;
  readonly notCoordinated: true;
  readonly spentOn: string | null;
  readonly purposeAsFiled: string | null;
  readonly reportId: string;
  readonly sourceCitation: string;
}

/** A separate record from a committee's periodic report, with no `contributions` field. */
export interface IndependentExpenditureReport {
  readonly id: string;
  readonly filerCommitteeId: string;
  readonly filingAuthorityId: string;
  readonly filingPeriod: FilingPeriod;
  readonly filedAt: string | null;
  readonly sourceArtifactId: string | null;
  readonly sourceUrl: string | null;
  readonly independentExpenditures: readonly IndependentExpenditure[];
}

/* ── What a record CAME OFF, which is not always a filing ─────────────────── */

/**
 * Not a filing: an authority-side sum across a filer's filings (e.g. FEC
 * committee totals). A reader sentence may never say "as filed in" a report for
 * it. `isCompleteFilingSet` is literal `false`; `aggregatedAcrossFilings` is
 * null when the authority does not say how many reports were summed.
 */
export interface AuthorityAggregate {
  readonly recordKind: "AUTHORITY_AGGREGATE";
  /** Prefixed so it can never be mistaken for a filing id at a glance. */
  readonly id: string;
  readonly committeeId: string;
  readonly filingAuthorityId: string;
  /** The authority's own period label and bounds. Never invented. */
  readonly period: FilingPeriod;
  /** The authority endpoint or page the aggregate was read from. */
  readonly sourceUrl: string | null;
  /** In this repository, the artifact the aggregate is committed in. */
  readonly sourceCitation: string;
  /** Total the committee reported RECEIVING, per the authority. Null when unpublished. */
  readonly reportedReceipts: number | null;
  /** Total the committee reported SPENDING, per the authority. Null when unpublished. */
  readonly reportedDisbursements: number | null;
  /** The itemized-receipts subtotal, when the authority publishes one. */
  readonly reportedItemizedReceipts: number | null;
  /** How many filings were summed, when the authority says. Null is honest. */
  readonly aggregatedAcrossFilings: number | null;
  /** Never true. An aggregate is not a complete filing set and cannot claim to be. */
  readonly isCompleteFilingSet: false;
}

/** What a rendered figure came off. `answers.ts` derives this rather than accepting it. */
export const EVIDENCE_BASES = ["FILING", "AUTHORITY_AGGREGATE"] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

/* ── A measure has SIDES, and the sides are the symmetry unit ─────────────── */

/** A measure's neutrality unit is the side, as a candidate contest's is the candidate. */
export const MEASURE_SIDES = ["SUPPORT", "OPPOSE"] as const;
export type MeasureSide = (typeof MEASURE_SIDES)[number];

/**
 * Coverage of one side of one ballot question. A null `committeeUniverseSource`
 * means no register was read; an empty list with a source means none registered.
 */
export interface MeasureSideCoverage {
  readonly side: MeasureSide;
  readonly committeeIds: readonly string[];
  /**
   * Where the committee universe for this side came from. **Null means the
   * register was never read** — never "there are none".
   */
  readonly committeeUniverseSource: string | null;
  readonly filingAuthorityResolved: boolean;
  readonly filingAuthorityIds: readonly string[];
  readonly filingsAcquired: readonly string[];
  readonly acquisitionDepth: AcquisitionDepth;
  readonly latestThroughDate: string | null;
  readonly openRouteIds: readonly string[];
  /** Required for any asymmetry against the other side, and it must cite a source. */
  readonly asymmetryExplanation: AsymmetryExplanation | null;
}

/* ── The invariant, at the type level ─────────────────────────────────────── */

/** Resolves to `never` if `intoCommitteeId` or `amountReceived` is ever added to `IndependentExpenditure`. */
export type NotAReceiptShape<T> = T extends { intoCommitteeId: unknown }
  ? never
  : T extends { amountReceived: unknown }
    ? never
    : T;

/** Resolves to `IndependentExpenditure`, or to `never` if the invariant breaks. */
export type IndependentExpenditureIsNotAReceipt = NotAReceiptShape<IndependentExpenditure>;

/** A broken invariant fails the build here. */
export const INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT: (
  ie: IndependentExpenditureIsNotAReceipt,
) => number = (ie) => ie.amountSpentIndependently;

export class MoneyFlattened extends Error {
  /** Declared explicitly: strip-types mode does not parse parameter properties. */
  readonly offendingKind: string;

  constructor(message: string, offendingKind: string) {
    super(message);
    this.name = "MoneyFlattened";
    this.offendingKind = offendingKind;
  }
}

/**
 * Total money a committee received across its own filings. The `recordKind`
 * check catches a cast and throws rather than skipping.
 */
export function totalReceivedBy(
  committee: Pick<PoliticalCommittee, "id">,
  filings: readonly CampaignFinanceFiling[],
): { total: number; rows: number; filingsCounted: number } {
  let total = 0;
  let rows = 0;
  let filingsCounted = 0;

  for (const filing of filings) {
    if (filing.committeeId !== committee.id) continue;
    filingsCounted += 1;
    for (const row of filing.contributions) {
      if (row.recordKind !== "CONTRIBUTION") {
        throw new MoneyFlattened(
          `A ${String((row as { recordKind?: unknown }).recordKind)} row reached the receipts total for ` +
            `committee ${committee.id}. Money spent ABOUT a race by a group that gave the campaign ` +
            "nothing is not money the campaign received, and summing the two misstates who is behind " +
            "a candidate.",
          String((row as { recordKind?: unknown }).recordKind),
        );
      }
      if (row.intoCommitteeId !== committee.id) continue;
      total += row.amountReceived;
      rows += 1;
    }
  }

  return { total, rows, filingsCounted };
}

/**
 * Total independent spending ABOUT one candidacy. A separate function returning
 * a separate number, reported beside receipts and never added to them.
 */
export function independentSpendingAbout(
  candidacyId: string,
  reports: readonly IndependentExpenditureReport[],
): { supporting: number; opposing: number; rows: number } {
  let supporting = 0;
  let opposing = 0;
  let rows = 0;
  for (const report of reports) {
    for (const ie of report.independentExpenditures) {
      if (ie.relation.aboutCandidacyId !== candidacyId) continue;
      rows += 1;
      if (ie.relation.stance === "SUPPORTS") supporting += ie.amountSpentIndependently;
      else opposing += ie.amountSpentIndependently;
    }
  }
  return { supporting, opposing, rows };
}

/* ── Amendment lineage ────────────────────────────────────────────────────── */

export class AmendmentRefused extends Error {
  readonly filingId: string;

  constructor(message: string, filingId: string) {
    super(message);
    this.name = "AmendmentRefused";
    this.filingId = filingId;
  }
}

/** Record an amendment. Returns the whole set with both versions present; the original gains an `amendedBy` entry. */
export function supersede(
  filings: readonly CampaignFinanceFiling[],
  amendment: CampaignFinanceFiling,
): readonly CampaignFinanceFiling[] {
  if (amendment.amends === null) {
    throw new AmendmentRefused(
      `Filing ${amendment.id} was offered as an amendment but names no filing it amends. ` +
        "An amendment with no antecedent is an original, and filing it as an amendment would " +
        "orphan the claim it was meant to correct.",
      amendment.id,
    );
  }
  const original = filings.find((f) => f.id === amendment.amends);
  if (!original) {
    throw new AmendmentRefused(
      `Filing ${amendment.id} amends ${amendment.amends}, which is not in this set. ` +
        "Superseding a claim we do not hold would delete the history rather than extend it.",
      amendment.id,
    );
  }
  if (amendment.version <= original.version) {
    throw new AmendmentRefused(
      `Filing ${amendment.id} is version ${amendment.version} and amends version ` +
        `${original.version}. An amendment moves forward or it is not an amendment.`,
      amendment.id,
    );
  }
  return [
    ...filings.map((f) =>
      f.id === original.id ? { ...f, amendedBy: [...f.amendedBy, amendment.id] } : f,
    ),
    amendment,
  ];
}

/** The full chain for one filing, oldest first. */
export function lineageOf(
  filings: readonly CampaignFinanceFiling[],
  filingId: string,
): readonly CampaignFinanceFiling[] {
  const byId = new Map(filings.map((f) => [f.id, f]));
  const start = byId.get(filingId);
  if (!start) return [];

  // The climb has its own cycle guard: sharing one with the descent would truncate
  // the chain to the root when starting from the newest version.
  let root = start;
  const climbed = new Set<string>([root.id]);
  while (root.amends !== null) {
    const parent = byId.get(root.amends);
    if (!parent || climbed.has(parent.id)) break;
    climbed.add(parent.id);
    root = parent;
  }

  const chain: CampaignFinanceFiling[] = [root];
  const walked = new Set<string>([root.id]);
  let cursor = root;
  while (cursor.amendedBy.length > 0) {
    const next = cursor.amendedBy
      .map((id) => byId.get(id))
      .filter((f): f is CampaignFinanceFiling => f !== undefined)
      .sort((a, b) => a.version - b.version)
      .at(-1);
    if (!next || walked.has(next.id)) break;
    walked.add(next.id);
    chain.push(next);
    cursor = next;
  }
  return chain;
}

/** The version that currently states the claim. History is still in the set. */
export function currentVersionOf(
  filings: readonly CampaignFinanceFiling[],
  filingId: string,
): CampaignFinanceFiling | null {
  const chain = lineageOf(filings, filingId);
  return chain.length === 0 ? null : chain[chain.length - 1];
}

/* ── Routes and coverage ──────────────────────────────────────────────────── */

/**
 * One route walked, or to be walked, for money. `permission` and `transport`
 * are orthogonal to each other and to the disposition: failing to fetch
 * robots.txt is never "robots disallows this host".
 */
export interface PlannedRoute {
  readonly declaration: AdapterRouteDeclaration;
  readonly disposition: Disposition;
  /** What the route is and what happened. */
  readonly note: string;
  /** Repo path or URL this route and its recorded result came from. */
  readonly citation: string;
  readonly permission: PermissionState;
  /** Null when the route has never been attempted. */
  readonly transport: TransportState | null;
  /** The ladder rung this was attempted at, when it was attempted. */
  readonly rung: number | null;
  readonly lastAttemptedOn: string | null;
}

/** How deep acquisition actually went for one candidate. Ordered, low to high. */
export const ACQUISITION_DEPTHS = [
  /** Nothing walked. */
  "NONE",
  /** We know WHO the filing authority is. */
  "AUTHORITY_RESOLVED",
  /** We know which committee(s) belong to this candidacy. */
  "COMMITTEE_IDENTIFIED",
  /** We hold the committee's own summary totals. */
  "SUMMARY_TOTALS",
  /** We hold itemized transactions. */
  "ITEMIZED_TRANSACTIONS",
] as const;
export type AcquisitionDepth = (typeof ACQUISITION_DEPTHS)[number];

export function depthRank(depth: AcquisitionDepth): number {
  return ACQUISITION_DEPTHS.indexOf(depth);
}

/** Why one candidate is covered differently from another. Required for any asymmetry, with a source. */
export interface AsymmetryExplanation {
  /** The filed, sourced reason. */
  readonly reason: string;
  /** Repo path, filing url, or authority page that SUPPORTS the reason. */
  readonly sourceCitation: string;
  readonly recordedOn: string;
}

export interface CandidateFinanceCoverage {
  readonly candidacyId: string;
  readonly displayName: string;
  /** Committees identified for this candidacy. Empty is a real, reportable state. */
  readonly committeeIds: readonly string[];
  /** True only when the custodian is RESOLVED, never when it is assumed. */
  readonly filingAuthorityResolved: boolean;
  readonly filingAuthorityIds: readonly string[];
  readonly filingsAcquired: readonly string[];
  /**
   * Periods the authority's own calendar says are due. Null means we do not know
   * the denominator — which is itself a gap, never a zero.
   */
  readonly filingPeriodsExpected: readonly string[] | null;
  readonly filingPeriodsMissing: readonly string[];
  /** The latest date any acquired filing covers THROUGH. Null when nothing acquired. */
  readonly latestThroughDate: string | null;
  readonly acquisitionDepth: AcquisitionDepth;
  readonly openRouteIds: readonly string[];
  /** Unresolved identity questions — same name, two committees, and so on. */
  readonly identityGaps: readonly string[];
  /** Filings known to be amended where the amendment is not held. */
  readonly amendmentGaps: readonly string[];
  readonly asymmetryExplanation: AsymmetryExplanation | null;
}

export const COVERAGE_STATUSES = [
  /** Work remains and is named. */
  "OPEN",
  /** Some candidates answered, others not. NEVER renderable at candidate level. */
  "PARTIAL",
  /** Every owed candidate answered, under the method version, as of a date. */
  "COMPLETE_AS_OF",
] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** The per-contest obligation. The candidate universe is the denominator and comes from the ballot. */
export interface CampaignFinanceCoverage {
  readonly contestId: string;
  readonly contestTitle: string;
  readonly electionId: string;
  readonly electionDate: string;
  /** OCD-ID of the division voting on it. */
  readonly jurisdictionOcdId: string;
  readonly officeLevel: OfficeLevel;
  /** Required, never defaulted; `coverage.ts` refuses completeness on anything but `RESOLVED`. */
  readonly filingRegimeState: AuthorityResolutionStatus;
  /** The routing rule selected, when one was. Null under `NO_REGIME_ON_RECORD`. */
  readonly filingRegimeId: string | null;
  /** Every candidacy on the ballot for this contest. The denominator. */
  readonly candidateUniverse: readonly string[];
  /** Where the denominator came from. A count with no source is not a denominator. */
  readonly candidateUniverseSource: string;
  readonly committeeUniverse: readonly string[];
  /** Authorities we expect to hold records for this contest. */
  readonly expectedFilingAuthorityIds: readonly string[];
  readonly expectedFilingPeriods: readonly FilingPeriod[];
  readonly filingsAcquired: readonly string[];
  /** Named, not counted. "3 missing" is not a gap; three labels are. */
  readonly filingsMissing: readonly string[];
  readonly latestThroughDate: string | null;
  readonly perCandidate: readonly CandidateFinanceCoverage[];
  /**
   * Required by `sideSymmetryCheck` on a measure contest; undefined means the
   * side question was never asked and fails the check.
   */
  readonly measureSides?: readonly MeasureSideCoverage[];
  readonly routes: readonly PlannedRoute[];
  readonly identityGaps: readonly string[];
  readonly amendmentGaps: readonly string[];
  readonly status: CoverageStatus;
  /** Set only with `COMPLETE_AS_OF`. The date the completeness is asserted as of. */
  readonly completeAsOf: string | null;
}
