/**
 * STATE, COUNTY AND LOCAL CAMPAIGN MONEY — the half the FEC cannot answer.
 *
 * Session 2026-08-24, Sean's ruling of that day. **RULING 126** governs what may
 * be done with everything in here: it renders for readers and never enters
 * anything sold.
 *
 * ## The gap this closes, stated as a fact about a card
 *
 * Every Campaign money drop-down in this product is FEC-fed, and the FEC is
 * federal-only. **A Morris County commissioner candidate files with the New
 * Jersey Election Law Enforcement Commission, not the FEC** — so the drop-down
 * on their card structurally could not fill. Not "had no data yet": could not.
 * The same is true of every state, county, municipal and school-board candidate
 * on every ballot this product renders, which at 07866 alone is most of 272
 * candidacies.
 *
 * ## THIS EXTENDS THE FUNDING CORPUS RATHER THAN DUPLICATING IT
 *
 * `lib/funding/types.ts` already models money beside a candidate, already
 * carries a provenance tag per record, and is already structurally unreachable
 * from the aggregation and export path. Building a second corpus beside it
 * would be the duplicated implementation RULING 103 was adopted over, and would
 * give the firewall two places to be enforced instead of one. So the data class
 * union grows and the render path is shared.
 *
 * ## THE THREE-WAY STATE IS THE DESIGN, NOT A CONVENIENCE
 *
 * **An absence of filings is not zero dollars.** Small-race candidates file
 * short forms, or sit under a reporting threshold entirely — New Hampshire's
 * thresholds exempt most town-level candidates, so a sourced "no reports" will
 * be the DOMINANT outcome there and that is a correct result rather than a thin
 * one. Rendering that as `$0` would be a false claim about a named person's
 * campaign, and rendering it as blank would be indistinguishable from our not
 * having looked. So:
 *
 * - `FILED` — reports are on file and the totals below are what they say.
 * - `NO_REPORTS_ON_FILE` — the agency was asked, on `checkedAt`, and answered
 *   that this candidate has nothing filed. A SOURCED, DATED statement.
 * - `LEAD` — something plausible was found and it does not meet the matching
 *   bar. **It does not render.**
 *
 * ## MATCHING IS THE DANGEROUS PART, AND THE BAR IS DELIBERATELY HIGH
 *
 * A candidate joined to the wrong committee renders someone else's money on
 * their card, under their name and their photograph. That is a worse failure
 * than an empty drop-down by a wide margin, and it is the exact class RULING
 * 111 names: a join on names always drops and mismatches rows, and a dropped
 * row comes back looking identical to a genuine absence.
 *
 * So a match requires **all three** of the committee's registered name, the
 * office sought, and the election year to agree with our certified-ballot row.
 * Anything less is a `LEAD` and does not render. `matchedOn` records which
 * criteria were checked and how, per record, so a wrong match is reviewable
 * rather than merely regrettable.
 */

import { COVERED_STATES } from "../coverage/states.ts";
import type { Provenance } from "../sources/types.ts";

/**
 * Which agency, and therefore which body of law and which terms.
 *
 * DERIVED from `lib/coverage/states.ts` rather than hand-kept. A second list of
 * covered states is a list that silently disagrees with the first the moment a
 * state is added — which is the separator-broken-allowlist class, and
 * `tests/coverage-states.test.ts` refuses it by name.
 */
export type MoneyJurisdiction = (typeof COVERED_STATES)[number]["usps"];

/**
 * Whether this candidate's money is filed, absent, or merely suspected.
 * The three-way split every report of this data states.
 */
export type FilingState = "FILED" | "NO_REPORTS_ON_FILE" | "LEAD";

/** Which of the three matching criteria were satisfied, and by what. */
export interface MatchBasis {
  /** The committee's registered name, exactly as the agency holds it. */
  registeredName: string;
  /** The office as the agency records it, and our certified-ballot office. */
  officeAsFiled: string | null;
  officeOnBallot: string | null;
  /** Both must be the same cycle. */
  electionYearAsFiled: number | null;
  electionYearOnBallot: number;
  /** True only when all three agreed. Anything else is a LEAD. */
  allThreeAgree: boolean;
  /** Why, in one sentence, for a record a person can review. */
  note: string;
}

/**
 * Top-line figures only.
 *
 * Every field is nullable and that is not laziness: the three agencies publish
 * different summary lines, and a state that does not publish cash-on-hand must
 * render as not publishing it rather than as zero. A render default that turned
 * a null into a number would be the render-default rule's exact failure, in
 * money.
 */
export interface StateMoneyTotals {
  receipts: number | null;
  expenditures: number | null;
  cashOnHand: number | null;
  /** How many reports the agency holds for this committee. */
  reportCount: number | null;
  /** The period the figures cover, as the agency states it. */
  coveringPeriod: string | null;
}

export interface StateMoneyRecord {
  dataClass: "STATE_COMMITTEE";
  jurisdiction: MoneyJurisdiction;
  /** The agency's own name, rendered to readers verbatim. */
  agency: string;
  /** The candidate's own filings page at the agency — the reader's way in. */
  filingsUrl: string | null;
  /** The agency's identifier for the committee. Never a name string join key. */
  committeeId: string | null;
  /** The committee's registered name, as filed. Never characterized. */
  registeredName: string;
  /** The person, as the agency has them. */
  candidateNameAsFiled: string;
  officeSought: string | null;
  electionYear: number;
  filingState: FilingState;
  totals: StateMoneyTotals;
  /** Which app-side candidates this answers for. Empty on a LEAD. */
  targetKeys: string[];
  match: MatchBasis;
  /**
   * The date the agency was asked. Present on EVERY record including
   * `NO_REPORTS_ON_FILE`, because a sourced absence with no date is not a
   * sourced absence (RULING 53, RULING 107 — this is a read stamp, minted by
   * the code path that performed the read).
   */
  checkedAt: string;
  provenance: Provenance;
}

export interface StateMoneySnapshot {
  formatVersion: 1;
  /** A read stamp: the day the agencies were actually called. */
  collectedAt: string;
  cycle: number;
  /**
   * The three-way split, stated with its denominator. Never a bare count —
   * RULING 105, and the two-numbers rule it extends.
   */
  split: {
    candidaciesInScope: number;
    filed: number;
    noReportsOnFile: number;
    lead: number;
    /** In scope, asked, and not yet resolved to any of the three. */
    unresolved: number;
    /**
     * Committee records behind `filed`. Higher than `filed` is CORRECT — a
     * candidate may file a primary committee and a general one. Stated as its
     * own number so the coverage figure can never read over 100%.
     */
    filedRecords: number;
  };
  /** Per-jurisdiction, so one state's silence cannot hide inside a total. */
  byJurisdiction: Record<string, { inScope: number; filed: number; noReports: number; lead: number }>;
  records: StateMoneyRecord[];
}

/**
 * THE MATCHING BAR, in one function so no caller can lower it locally.
 *
 * RULING 111: state which side holds the fact and whether the join can drop
 * rows. Here the agency holds the money and our certified ballot holds the
 * office and the cycle; the join is on a NAME, which always can. So the bar is
 * a conjunction and the failure mode is `LEAD`, never a silent drop.
 */
export function judgeMatch(input: {
  registeredName: string;
  candidateNameAsFiled: string;
  ballotName: string;
  officeAsFiled: string | null;
  officeOnBallot: string | null;
  electionYearAsFiled: number | null;
  electionYearOnBallot: number;
}): MatchBasis {
  const nameAgrees = namesAgree(input.candidateNameAsFiled, input.ballotName);
  const officeAgrees =
    input.officeAsFiled !== null &&
    input.officeOnBallot !== null &&
    officesAgree(input.officeAsFiled, input.officeOnBallot);
  const yearAgrees =
    input.electionYearAsFiled !== null && input.electionYearAsFiled === input.electionYearOnBallot;

  const failures: string[] = [];
  if (!nameAgrees) failures.push("the filed name does not agree with the certified-ballot name");
  if (!officeAgrees) {
    failures.push(
      input.officeAsFiled === null
        ? "the agency states no office for this committee"
        : `office '${input.officeAsFiled}' does not agree with ballot office '${input.officeOnBallot ?? "(none recorded)"}'`,
    );
  }
  if (!yearAgrees) {
    failures.push(
      input.electionYearAsFiled === null
        ? "the agency states no election year"
        : `filed year ${input.electionYearAsFiled} is not the ballot year ${input.electionYearOnBallot}`,
    );
  }

  const allThreeAgree = nameAgrees && officeAgrees && yearAgrees;
  return {
    registeredName: input.registeredName,
    officeAsFiled: input.officeAsFiled,
    officeOnBallot: input.officeOnBallot,
    electionYearAsFiled: input.electionYearAsFiled,
    electionYearOnBallot: input.electionYearOnBallot,
    allThreeAgree,
    note: allThreeAgree
      ? "name, office and election year all agree with the certified-ballot row"
      : `LEAD — ${failures.join("; ")}`,
  };
}

/**
 * Name agreement, deliberately conservative.
 *
 * Agencies file `SURNAME, FORENAME MIDDLE SUFFIX` in caps; ballots carry
 * `Forename Surname`. Comparing the token SETS after stripping punctuation,
 * suffixes and single-letter initials answers that without inventing a
 * fuzzy-distance threshold nobody could defend on a candidate's card.
 *
 * A suffix is stripped rather than compared because the same person appears
 * with and without it across sources — and because getting it wrong is what
 * rendered `Thomas J. Haynes III` as "TI" (RULING 103).
 */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,'’]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !SUFFIXES.has(t));
}

export function namesAgree(a: string, b: string): boolean {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  // Every token of the SHORTER name must appear in the longer one. That admits
  // a missing middle name and refuses a different surname.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!large.has(t)) return false;
  // And a single shared token is not agreement — "Smith" is not a person.
  return small.size >= 2;
}

/**
 * OFFICE AGREEMENT IS A COMPARISON OF CLASSES, NOT OF WORDS.
 *
 * The first version of this compared token overlap and rejected every single
 * match — 175 LEADs and 0 FILED across the whole Morris County ballot. The
 * reason is not a threshold that needed loosening; it is that **the two sides
 * speak different vocabularies.**
 *
 * NJ ELEC files an office CATEGORY: `MUNICIPAL OFFICE`, `SCHOOL BOARD`,
 * `COUNTY COMMISSIONER`. The certified ballot carries the office TITLE:
 * `Member of the Township Committee`, `Member of the Board of Education`,
 * `Member of the Board of County Commissioners`. `MUNICIPAL OFFICE` and
 * `Member of the Township Committee` share no word at all and describe the
 * same seat. No amount of token matching bridges that, and a fuzzy-distance
 * threshold that appeared to would be worse — it would start matching a school
 * board to a township committee, which is a wrong person's money on a card.
 *
 * So each side is mapped to a CLASS and the classes are compared. A side that
 * maps to no class is `null`, and `null` never agrees with anything — an
 * unrecognised office is a LEAD, which is the safe direction.
 *
 * **Order is load-bearing.** `Member of the Board of County Commissioners`
 * contains the word `commissioner`, so COUNTY must be tested before MUNICIPAL
 * or every county commissioner would classify as a municipal seat.
 */
export type OfficeClass = "COUNTY" | "SCHOOL" | "MUNICIPAL" | "STATE" | "FEDERAL";

const OFFICE_CLASS_RULES: readonly { cls: OfficeClass; pattern: RegExp }[] = [
  { cls: "FEDERAL", pattern: /\b(united states senate|house of representatives|congress(ional)?|president)\b/ },
  { cls: "STATE", pattern: /\b(general assembly|state senate|governor|assembly)\b/ },
  {
    cls: "COUNTY",
    pattern: /\b(county commissioner|board of county commissioners|freeholder|county clerk|sheriff|surrogate|county office)\b/,
  },
  { cls: "SCHOOL", pattern: /\b(school board|board of education|school district|board of school estimate)\b/ },
  {
    cls: "MUNICIPAL",
    pattern:
      /\b(municipal office|municipal|council|committee(man|woman)?|councilmember|mayor|alderman|trustee|township committee|borough council|town council)\b/,
  },
];

export function officeClassOf(office: string): OfficeClass | null {
  const s = office.toLowerCase().replace(/\s+/g, " ").trim();
  for (const { cls, pattern } of OFFICE_CLASS_RULES) if (pattern.test(s)) return cls;
  return null;
}

export function officesAgree(a: string, b: string): boolean {
  const ca = officeClassOf(a);
  const cb = officeClassOf(b);
  // An office neither side can classify is never agreement. A LEAD is the
  // correct outcome for an office we do not understand.
  if (ca === null || cb === null) return false;
  return ca === cb;
}

/**
 * The split, recomputed from the records themselves.
 *
 * **THE SPLIT COUNTS CANDIDACIES; THE RECORD COUNT IS A SEPARATE NUMBER.**
 *
 * The first version counted RECORDS and reported `FILED 296 of 235` — more
 * answers than there were questions. The cause is real and it is not a bug in
 * the data: **one candidate legitimately has several committees.** A New Jersey
 * candidate may file a primary committee and a general committee, and a joint
 * candidates committee alongside a personal one, and ELEC lists each.
 *
 * So the two are different questions and both get answered. *How many of the
 * 235 candidacies now have money on their card* is the coverage figure. *How
 * many committee records back them* is a different fact, and running the two
 * together produces a percentage over 100 — which is how a reader learns the
 * number is not to be trusted.
 *
 * **Stated N equals rendered rows**: both are computed from the same array the
 * surface renders, in the same pass.
 */
export function computeSplit(
  records: readonly StateMoneyRecord[],
  candidaciesInScope: number,
): StateMoneySnapshot["split"] {
  const filedCandidacies = new Set<string>();
  const absentCandidacies = new Set<string>();
  for (const r of records) {
    if (r.filingState === "FILED") for (const k of r.targetKeys) filedCandidacies.add(k);
    else if (r.filingState === "NO_REPORTS_ON_FILE") for (const k of r.targetKeys) absentCandidacies.add(k);
  }
  // A candidacy that has BOTH a filing and an absence record resolves as filed:
  // the absence was written for a location pass that another committee answered.
  for (const k of filedCandidacies) absentCandidacies.delete(k);

  const filed = filedCandidacies.size;
  const noReportsOnFile = absentCandidacies.size;
  return {
    candidaciesInScope,
    filed,
    noReportsOnFile,
    lead: records.filter((r) => r.filingState === "LEAD").length,
    unresolved: Math.max(0, candidaciesInScope - filed - noReportsOnFile),
    filedRecords: records.filter((r) => r.filingState === "FILED").length,
  };
}

/**
 * Only a FILED or a sourced-absent record may reach a reader. A LEAD never
 * renders — asked here rather than at each surface, so no surface can decide
 * otherwise (the RULING 118 shape: ask once).
 */
export function isRenderable(record: StateMoneyRecord): boolean {
  return record.filingState === "FILED" || record.filingState === "NO_REPORTS_ON_FILE";
}
