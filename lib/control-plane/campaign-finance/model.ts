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

/* ── Committees ───────────────────────────────────────────────────────────── */

/* ── Filings ──────────────────────────────────────────────────────────────── */

/* ── The money ────────────────────────────────────────────────────────────── */

/* ── What a record CAME OFF, which is not always a filing ─────────────────── */

/* ── A measure has SIDES, and the sides are the symmetry unit ─────────────── */

/* ── The invariant, at the type level ─────────────────────────────────────── */

/* ── Amendment lineage ────────────────────────────────────────────────────── */

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
