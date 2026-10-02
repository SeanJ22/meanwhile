/**
 * CAMPAIGN FINANCE INTELLIGENCE — the domain model.
 *
 * ## What this file is, and what it deliberately is not
 *
 * **Campaign-finance filing data stays out of Postgres entirely.** Filings are
 * never sold; reactions to them are (Sean, 2026-10-01).
 * `tests/campaign-finance-firewall.test.ts` enumerates every `pgTable` in
 * `lib/db/schema.ts` and fails on any table or column matching the money words.
 * The reason is a join: the sold stores are database tables, and a join needs
 * two of them. So this model is **TYPES plus committed-JSON semantics only** —
 * no Drizzle table, no migration, no `lib/db` change, now or later. The
 * federal corpus already lives this way (`data/fec/fec-2026.json`, read by
 * `lib/funding/snapshot.ts`), and this file is the control plane's model of the
 * same shape, extended to the state and local tiers that are not yet ingested.
 *
 * ## The three things the existing funding code does not model
 *
 * 1. **WHO the filing authority is.** `lib/funding/*` models the FEC, and the
 *    FEC is one authority. Arizona's `A.R.S. § 16-928` federates filing across
 *    109 jurisdictions by statute (`states/az/sources.md`), and *the authority's
 *    level need not match the office's level*: a SCHOOL DISTRICT election files
 *    with the COUNTY officer in charge of elections. That is not discoverable by
 *    looking at portals, so it is modelled as a first-class resolution question
 *    in `authority.ts` rather than assumed.
 *
 * 2. **INDEPENDENT EXPENDITURES.** There is no independent-expenditure data
 *    anywhere in this repository today (tracker `D51`, blocked behind `PB10` /
 *    `D23`); `docs/sources.md` records OpenFEC as "WIRED for committee TOTALS
 *    only". The model is built now precisely because the shape is the thing that
 *    goes wrong: money spent ABOUT a race by a group that gave the campaign
 *    nothing reads completely differently from a contribution, and collapsing
 *    the two misstates who is behind a candidate. `lib/funding/committee-types.
 *    ts` already carries that sentence for readers. Here it is carried by the
 *    TYPES: see THE SEMANTIC INVARIANT below.
 *
 * 3. **COVERAGE as an obligation with a denominator.** A contest owes a
 *    per-candidate answer, and three-of-four is not an answer — it is a ranking
 *    with the fourth candidate missing. `coverage.ts` fails that closed.
 *
 * ## THE SEMANTIC INVARIANT
 *
 * **An IndependentExpenditure must never be representable as, or aggregable
 * into, money received by a candidate.**
 *
 * This is enforced three ways, because a comment is not an enforcement:
 *
 *   - **By SHAPE.** `Contribution` carries `intoCommitteeId` and
 *     `amountReceived`. `IndependentExpenditure` carries neither field name, and
 *     names no recipient committee at all — its object is a CANDIDACY, reached
 *     through a typed `SupportOpposeRelation`. There is no committee id on an
 *     independent expenditure to aggregate against.
 *   - **By CONTAINER.** A `CampaignFinanceFiling` (a committee's own report)
 *     holds `contributions` and `expenditures`. Independent expenditures live on
 *     a different record entirely, `IndependentExpenditureReport`, which has no
 *     `contributions` field. `totalReceivedBy` accepts only the former.
 *   - **By RUNTIME REFUSAL.** `totalReceivedBy` checks `recordKind` on every row
 *     and throws rather than summing, so a cast through `any` fails loudly
 *     instead of quietly inflating a candidate's receipts.
 *
 * ## Time
 *
 * Every date in this module is a CALLER-SUPPLIED parameter. Nothing here reads
 * the clock — an agent does not know today's date, and a library that thinks it
 * does misdates every conclusion built on it.
 */

import type { Disposition, PermissionState, TransportState } from "../../workstate/types.ts";
import type { AdapterRouteDeclaration } from "../preflight.ts";

/* ── Filing authority ─────────────────────────────────────────────────────── */

/**
 * The tiers and kinds a filing custodian can be.
 *
 * This list mixes jurisdictional TIERS (`COUNTY`, `MUNICIPAL`) with custodian
 * KINDS (`CLERK`, `ETHICS_COMMISSION`, `VENDOR_PORTAL`) on purpose, because the
 * world does. Arizona's statute routes city and town elections to *the city or
 * town clerk* — a MUNICIPAL tier held by a CLERK — while the Citizens Clean
 * Elections Commission regulates campaign-finance reports for participating
 * candidates alongside the Secretary of State
 * (`data/reference/fec_combined_federal_state_disclosure_directory.csv`).
 * Collapsing those into one axis would force a guess.
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

/**
 * The LEVEL OF THE OFFICE being sought or the measure being voted on.
 *
 * Deliberately a separate vocabulary from `FilingAuthorityLevel`. Arizona is the
 * state that taught this project the filing-officer question, and the lesson is
 * exactly that these two do not have to agree.
 */
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
 *
 * `statutoryBasis` is the citation that MAKES it the custodian. It is nullable
 * and the null is load-bearing: this repository has read Arizona's statute from
 * `azleg.gov` and quoted it (`states/az/sources.md`), and has NOT read whichever
 * federal provision names the FEC as the federal filing officer. A plausible
 * citation typed from memory would be a fabrication in the one field whose whole
 * job is being checkable, so it stays null and the open question is named.
 */
export interface FilingAuthority {
  /** Stable id, e.g. "az:county:pima:elections-officer". */
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

/**
 * A FILING REGIME — one jurisdiction's complete routing table.
 *
 * Arizona's regime is 109 filing jurisdictions (1 state, 15 counties, 93 cities
 * and towns) governed by a single statute; New Hampshire's is one filing officer
 * for the whole state. The regime is what makes those comparable.
 */
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
 * THE THREE ROUTING STATES, and the third one is why this vocabulary exists.
 *
 *   - `RESOLVED` — the custodian is known, by rule, with provenance.
 *   - `OPEN` — the RULE is known and the office holding it is not. Arizona's
 *     Yavapai County is here: A.R.S. § 16-928 names *the county officer in
 *     charge of elections*, and this repository has walked that officer for Pima
 *     only.
 *   - `NO_REGIME_ON_RECORD` — **we do not yet know which authority governs this
 *     contest at all.** A claim about THIS REPOSITORY, never about a government.
 *
 * It lives in the model rather than in `authority.ts` because
 * `CampaignFinanceCoverage` carries it and `authority.ts` already imports this
 * file: defining it there and importing it here would be a cycle, and defining
 * it in both places would be two vocabularies free to disagree (RULING 103).
 *
 * **An unresolved state is never a reason to close a contest.** It is a reason
 * to keep hunting, enforced in `coverage.ts` — a coverage record whose regime is
 * not `RESOLVED` cannot reach `COMPLETE_AS_OF` and cannot make a candidate-level
 * finance feature eligible — and in `authority.ts`'s
 * `unresolvedAuthorityKeepsCoverageOpen`, which has no input that yields closure.
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

/**
 * A political committee's canonical identity.
 *
 * `aliases` exists because the same committee appears under different strings in
 * a certified ballot, a state register and a vendor portal, and the project's
 * matching bar (`lib/funding/state-money.ts`) already refuses to treat a shared
 * surname as agreement. Aliases are RECORDED, never used to assert a match.
 */
export interface PoliticalCommittee {
  readonly id: string;
  /** The committee's registered name, exactly as filed. Never edited. */
  readonly registeredName: string;
  readonly type: CommitteeType;
  readonly aliases: readonly string[];
  readonly registrations: readonly CommitteeRegistration[];
  /**
   * The candidacy this committee is authorised BY, for CANDIDATE_AUTHORIZED
   * committees. Null for every other type — and null on an
   * INDEPENDENT_EXPENDITURE committee is structural, not incidental.
   */
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
 * ONE official report, statement or amendment filed BY a committee.
 *
 * The amendment lineage (`amends`, `amendedBy`, `version`) is why filings are
 * modelled as an append-only set rather than as a mutable current state. An
 * amendment SUPERSEDES a claim; it does not delete the claim that was made, and
 * a reader who saw the earlier number is owed the ability to find it again.
 * `supersede()` below enforces that both survive.
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

/**
 * Money INTO a committee.
 *
 * `recordKind` is the runtime half of the semantic invariant, and
 * `intoCommitteeId` / `amountReceived` are the shape half. Those two field
 * names appear on this type and on nothing else in this module.
 */
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

/**
 * A typed, evidenced stance of one spend toward one candidacy or measure.
 *
 * The `evidence` field is not decoration. Support/oppose is a claim about a
 * third party's intent, and this product never infers a stance — the value comes
 * off the filing's own designation, and the citation says which filing and which
 * field. Never derived from party, endorsements or ad content.
 */
export interface SupportOpposeRelation {
  readonly stance: SupportOppose;
  /** The CANDIDACY (or measure) the spending is about. Never a committee id. */
  readonly aboutCandidacyId: string;
  /** The filing field the stance was READ from, e.g. "FEC Form 5, support/oppose indicator". */
  readonly evidenceField: string;
  readonly sourceCitation: string;
}

/**
 * Money spent ABOUT a race by an entity that is not the candidate's committee.
 *
 * **This type deliberately has no `intoCommitteeId` and no `amountReceived`.**
 * There is no field on it naming a recipient committee, so there is nothing for
 * a receipts aggregation to key on. Its object is a CANDIDACY, through
 * `relation`, and a candidacy is not an account money can land in.
 *
 * `notCoordinated` is the literal `true` rather than a boolean: independence is
 * what makes this record the kind of record it is, and a value that could be
 * `false` would be a coordinated expenditure — a different thing, filed
 * differently, which must not borrow this type.
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

/**
 * An independent-expenditure report — a SEPARATE record from a committee's own
 * periodic report, with no `contributions` field for money to be flattened into.
 */
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
 * **NOT A FILING.** An authority-side AGGREGATION across a filer's filings.
 *
 * The FEC's committee-totals endpoint answers "what has this committee reported
 * cycle-to-date" by adding up reports the FEC holds. That number is real, it is
 * the authority's own, and it is **not a report anybody filed** — so it must not
 * wear `CampaignFinanceFiling`'s shape, because a reader told "as filed in the
 * 2026 Q2 report" about a figure that exists in no report has been handed a
 * fabricated citation.
 *
 * The distinction is load-bearing in two places a comment could not reach:
 *
 *   - `EvidenceBasis` travels on every answer, so the reader sentence says
 *     "reported to the Federal Election Commission cycle-to-date" for an
 *     aggregate and "as filed in <report>" only for a filing.
 *   - `AuthorityAggregate` carries `isCompleteFilingSet: false` as a LITERAL.
 *     There is no value of this type that claims to be the whole filing set,
 *     which is the structural half of "never imply complete financial coverage
 *     from one filing or one period".
 *
 * `aggregatedAcrossFilings` is nullable and the null is the honest value
 * whenever the authority publishes the sum without publishing how many reports
 * went into it. A count invented for a denominator is the coverage attack mode.
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

/**
 * What a rendered figure actually CAME OFF.
 *
 * A reader sentence built on `AUTHORITY_AGGREGATE` may never say "as filed in"
 * a named report, and a sentence built on `FILING` may never be attributed to
 * the authority's arithmetic. `answers.ts` derives this rather than accepting it.
 */
export const EVIDENCE_BASES = ["FILING", "AUTHORITY_AGGREGATE"] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

/* ── A measure has SIDES, and the sides are the symmetry unit ─────────────── */

/**
 * The two sides of a ballot question.
 *
 * A candidate contest's neutrality unit is the CANDIDATE; a measure's is the
 * SIDE, and nothing in this module knew that before. `symmetryCheck` sweeps
 * `perCandidate`, and a measure contest has none — so a measure whose SUPPORT
 * committees were hunted and whose OPPOSE committees were not came back
 * `SYMMETRIC`, on the grounds that there was no second candidate to be
 * asymmetric with. That is the seeded failure wearing the guard's own uniform,
 * one tier down from where the guard was looking.
 */
export const MEASURE_SIDES = ["SUPPORT", "OPPOSE"] as const;
export type MeasureSide = (typeof MEASURE_SIDES)[number];

/**
 * Coverage of ONE side of one ballot question.
 *
 * `committeeUniverseSource` being null is the state that matters most here and
 * it is NOT the same as an empty committee list. Null means *we have not read a
 * register, so we do not know which committees exist on this side* — a fact
 * about us. An empty list WITH a source means *the register was read and this
 * side has no registered committee* — a fact about the filers. Rendering those
 * two as the same sentence is the exact defect the named-gap rule forbids, so
 * they are two different fields and `answers.ts` reads both.
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

/**
 * COMPILE-TIME PROOF that `IndependentExpenditure` cannot wear a receipt's
 * shape. If anyone ever adds `intoCommitteeId` or `amountReceived` to it, this
 * alias resolves to `never` and `INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT`
 * below stops type-checking. The comment would have stayed true and silent; this
 * goes red in the commit that breaks it.
 */
export type NotAReceiptShape<T> = T extends { intoCommitteeId: unknown }
  ? never
  : T extends { amountReceived: unknown }
    ? never
    : T;

/** Resolves to `IndependentExpenditure`, or to `never` if the invariant breaks. */
export type IndependentExpenditureIsNotAReceipt = NotAReceiptShape<IndependentExpenditure>;

/**
 * The witness. A `never`-typed alias cannot satisfy this, so a broken invariant
 * is a build failure and not a review comment.
 */
export const INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT: (
  ie: IndependentExpenditureIsNotAReceipt,
) => number = (ie) => ie.amountSpentIndependently;

export class MoneyFlattened extends Error {
  /**
   * Explicit field declaration: this repository runs Node with
   * `--experimental-strip-types`, under which a TypeScript parameter property
   * (`constructor(readonly x: string)`) does not parse.
   */
  readonly offendingKind: string;

  constructor(message: string, offendingKind: string) {
    super(message);
    this.name = "MoneyFlattened";
    this.offendingKind = offendingKind;
  }
}

/**
 * Total money a committee RECEIVED, across its own filings.
 *
 * It cannot include an independent expenditure, and the reason is not that this
 * function filters them out — it is that they are not in the container. A
 * `CampaignFinanceFiling` holds `contributions`, and `IndependentExpenditure` is
 * not assignable to `Contribution`. The `recordKind` check exists only to catch
 * a cast, and it throws rather than skipping: a silently smaller number is the
 * failure mode this whole design exists to prevent, and a silently larger one is
 * worse.
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

/**
 * Record an amendment. Returns the WHOLE set with both versions present.
 *
 * The original is not removed and not rewritten — it gains an `amendedBy` entry,
 * which is additive. That is the same rule governance itself runs under: a
 * ruling is amendable only by a later one that names what it supersedes, and
 * rulings are never edited in place and never silently dropped.
 */
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

/**
 * The full chain for one filing, oldest first. Every version stays reachable —
 * this is the "walkable lineage" the amendment rule promises.
 */
export function lineageOf(
  filings: readonly CampaignFinanceFiling[],
  filingId: string,
): readonly CampaignFinanceFiling[] {
  const byId = new Map(filings.map((f) => [f.id, f]));
  const start = byId.get(filingId);
  if (!start) return [];

  // Climb to the original. The climb has its OWN cycle guard: reusing one guard
  // for both directions makes the descent refuse every node the climb visited,
  // which silently truncates the chain to the root whenever the caller started
  // from the newest version — the exact case a reader hunting a superseded
  // number is in.
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
 * One route the control plane intends to walk, or has walked, for money.
 *
 * `declaration` reuses `AdapterRouteDeclaration` from `lib/control-plane/
 * preflight.ts` rather than redeclaring a route shape, and `disposition` reuses
 * the governed eleven-value `Disposition` vocabulary from `lib/workstate/
 * types.ts`. `permission` and `transport` are ORTHOGONAL to each other and to
 * the disposition (RULING 182): "could not fetch robots.txt with this client" is
 * never "robots disallows this host".
 */
export interface PlannedRoute {
  readonly declaration: AdapterRouteDeclaration;
  readonly disposition: Disposition;
  /** What the route is, and what happened, in words a later session can act on. */
  readonly note: string;
  /** Repo path or URL this route and its recorded result came from. */
  readonly citation: string;
  readonly permission: PermissionState;
  /**
   * Null when the route has never been attempted. A never-attempted route has no
   * transport reading, and inventing `REACHABLE` for one would be a measurement
   * nobody took.
   */
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

/**
 * Why one candidate in a contest is covered differently from another.
 *
 * **Required for any asymmetry, and it must cite a source.** Unexplained
 * asymmetry between candidates in one contest is a neutrality failure: the
 * reader cannot tell "this candidate raised less" from "we looked less hard",
 * and the second is us putting a thumb on the scale.
 */
export interface AsymmetryExplanation {
  /** The filed, sourced reason. Never "we ran out of time" dressed as a fact. */
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

/**
 * The per-contest obligation.
 *
 * The candidate universe is the DENOMINATOR and it comes from the ballot, not
 * from what we managed to find. A denominator that measures our own output is
 * the coverage attack mode; `data/states/az/ballot/az-pima-2026.json` is the ballot.
 */
export interface CampaignFinanceCoverage {
  readonly contestId: string;
  readonly contestTitle: string;
  readonly electionId: string;
  readonly electionDate: string;
  /** OCD-ID of the division voting on it. */
  readonly jurisdictionOcdId: string;
  readonly officeLevel: OfficeLevel;
  /**
   * WHETHER WE KNOW WHICH AUTHORITY GOVERNS THIS CONTEST AT ALL.
   *
   * **Required, and deliberately not defaulted.** A field defaulting to
   * `RESOLVED` when a caller forgets it is exactly the silent default this
   * domain refuses: it would let a contest in a jurisdiction whose statute has
   * never been read look identically routed to one whose statute we have quoted.
   * The caller states what it knows, and `coverage.ts` refuses completeness on
   * anything but `RESOLVED`.
   */
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
   * THE SIDES OF A BALLOT QUESTION — the measure contest's symmetry unit.
   *
   * Optional in the TYPE and mandatory in the CHECK, deliberately. Making it
   * required would have rewritten every existing candidate-contest record with
   * an empty array, and an empty array is indistinguishable from "both sides
   * were checked and neither has a committee". Undefined on a measure contest
   * means the side question was never asked, and `sideSymmetryCheck` reports
   * that as a FAILURE rather than as a pass — see `MEASURE_SIDES`.
   */
  readonly measureSides?: readonly MeasureSideCoverage[];
  readonly routes: readonly PlannedRoute[];
  readonly identityGaps: readonly string[];
  readonly amendmentGaps: readonly string[];
  readonly status: CoverageStatus;
  /** Set only with `COMPLETE_AS_OF`. The date the completeness is asserted as of. */
  readonly completeAsOf: string | null;
}
