/**
 * STATE, COUNTY AND LOCAL CAMPAIGN MONEY — the half the FEC cannot answer.
 *
 * Session 2026-08-24. The filing records in here render for readers and never
 * enter an export or a sold aggregate; reactions to their display count and are
 * sold like any other reaction (Sean, 2026-10-01).
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
 * ## THE SPLIT STATE IS THE DESIGN, NOT A CONVENIENCE
 *
 * **An absence of filings is not zero dollars.** Small-race candidates file
 * short forms, or sit under a reporting threshold entirely — New Hampshire's
 * thresholds exempt most town-level candidates, so a sourced "no reports" will
 * be a common outcome there and that is a correct result rather than a thin
 * one. Rendering that as `$0` would be a false claim about a named person's
 * campaign, and rendering it as blank would be indistinguishable from our not
 * having looked.
 *
 * It began as three states. **It is five, because two of the three were each
 * doing more than one job and the extra jobs were false sentences about named
 * people** — see `FilingState` below, which carries the amendment and the
 * audit that forced it.
 *
 * **It is SIX as of 2026-08-31 (Session C2)**, and the sixth is the reader's
 * half of RULING 224: `OURS_GAP` renders, and it renders no money. See
 * `FilingState` below.
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

import type { Provenance } from "../sources/types.ts";
import type { StateMoneyFunding } from "./state-money-funding.ts";

/** The jurisdiction is carried by each sourced money record. */
export type MoneyJurisdiction = string;

/**
 * Whether this candidate's money is filed, absent, or merely suspected.
 *
 * ## IT WAS THREE STATES AND TWO OF THEM WERE DOING FOUR JOBS
 *
 * Amended 2026-08-31 (Session C) after an audit found the New Hampshire
 * collector writing `NO_REPORTS_ON_FILE` — a SOURCED, DATED claim about a
 * government's records — for three things that are not that claim:
 *
 * - a committee the state NAMES, with an id, a registered name, an office and
 *   an election cycle, whose published totals happen to be zero;
 * - a surname query that returned HTTP 500;
 * - a row we could not match to a person because the ballot says `Jon` and the
 *   filing says `Jonathan`.
 *
 * All three are different sentences and one of them is not about the state at
 * all. So the union grows, and it grows in the direction of saying LESS:
 *
 * - `FILED` — reports are on file and the totals below are what they say.
 * - `REGISTERED_NO_ACTIVITY_REPORTED` — the agency holds this committee and
 *   publishes zero receipts and zero expenditures for it. A statement about a
 *   REGISTERED committee's reported activity, which is a different fact about
 *   a different thing from the registry holding nothing. **Renders**, with its
 *   own sentence.
 * - `NO_REPORTS_ON_FILE` — the agency was asked, on `checkedAt`, with a read
 *   proven complete against the agency's own published count, and holds
 *   nothing that could be this candidate. A SOURCED, DATED statement.
 * - `LEAD` — something plausible was found and it does not meet the matching
 *   bar. **It does not render.**
 * - `ROUTE_UNREAD` — the route did not answer. An OURS gap, never theirs.
 *   **It does not render**: RULING 139 forbids the product announcing its own
 *   failure to a reader, and a card with nothing to say says nothing.
 */
export type FilingState =
  | "FILED"
  | "REGISTERED_NO_ACTIVITY_REPORTED"
  | "NO_REPORTS_ON_FILE"
  | "LEAD"
  | "ROUTE_UNREAD"
  /*
   * **THE SIXTH, ADDED 2026-08-31 (Session C2) UNDER RULING 224.**
   *
   * A record for this person EXISTS at the agency, we have read it, and
   * something WE have not resolved stands between it and a figure — the seat
   * the agency states is not the seat on this ballot, or our name test cannot
   * bridge a diminutive it must not guess at.
   *
   * It is NOT `LEAD` and it is NOT `ROUTE_UNREAD`. `LEAD` is silent because the
   * money cannot be safely attributed, and silence was leaving a candidate we
   * had actively investigated rendering the card's generic line — word for word
   * what a candidate nobody had ever looked for renders. `ROUTE_UNREAD` is
   * silent because the route did not answer and there is nothing to say; here
   * the route ANSWERED and there is something to say.
   *
   * **It RENDERS and it carries no receipts, no expenditures, no committee
   * attribution and no dollar figure of any kind.** The prohibition `LEAD`
   * enforces is intact — what may never reach a reader is an unproven
   * committee's FIGURES — and what reaches the reader is a sentence about US
   * plus the agency's own next filing deadline. RULING 139 strikes a VERDICT on
   * ourselves; the constitution separately REQUIRES that a gap name whose it is,
   * and "we haven't matched this yet" is that attribution, not a verdict.
   */
  | "OURS_GAP";
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
  /** Optional source-reported organization amounts and private giving aggregates. */
  funding?: StateMoneyFunding;
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
  /**
   * Set when a refresh could NOT read the route and this record was carried
   * forward from the previous snapshot rather than replaced.
   *
   * `checkedAt` stays the date the facts were actually read, so the reader's
   * attribution line remains true; this field is the auditor's half. It is not
   * an announcement — RULING 139 strikes a verdict on ourselves from a reader
   * surface, and the read date is the whole of what a reader is owed.
   */
  retainedFrom?: { attemptedAt: string; reason: string } | null;
  /**
   * PRESENT ONLY ON `OURS_GAP`, AND IT IS WHAT MAKES THAT STATE HONEST.
   *
   * `whatIsMissing` is one plain sentence about US — what we could not settle —
   * never a characterization of the candidate or their money. `nextDue` is the
   * agency's OWN next filing deadline, read from the state's published filing
   * calendar; a date this product invented would make the promise worse than no
   * promise. `null` means the calendar states none after today, which is a fact
   * about the calendar and renders as one.
   */
  ourGap?: {
    whatIsMissing: string;
    nextDue: string | null;
    nextDueName: string | null;
  };
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
    /** Registered with the agency, and the agency publishes zero activity. */
    registeredNoActivityReported: number;
    noReportsOnFile: number;
    lead: number;
    /** Routes that did not answer. OURS, and never counted as an answer. */
    routeUnread: number;
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
  byJurisdiction: Record<
    string,
    {
      inScope: number;
      filed: number;
      noReports: number;
      lead: number;
      /**
       * The two states added 2026-08-31. Optional because the New Jersey and
       * Arizona snapshots predate them and a snapshot is a WRITTEN FILE — a
       * required field here would make a committed, honest, older file fail to
       * type rather than making it truer.
       */
      registeredNoActivityReported?: number;
      routeUnread?: number;
    }
  >;
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

/**
 * **A DELIBERATELY WEAK TEST THAT MAY ONLY EVER WITHHOLD A CLAIM.**
 *
 * `namesAgree` is the MATCHING bar and it stays exactly as strict as it was:
 * it decides whether a committee's money may appear on a named person's card,
 * and loosening it puts a stranger's money there.
 *
 * This answers a different question — *could the row the agency just handed us
 * be about this person?* — and it exists for one purpose: **to forbid the
 * product from claiming an absence.** It never licenses a match, never fills a
 * field and never reaches a reader. Because its only effect is to make the
 * product say less, being generous here is the safe direction, which is the
 * opposite of `namesAgree`, where being generous is the dangerous one.
 *
 * The case that produced it: New Hampshire's registry holds
 * `Raiche, Jonathan M. (Raiche, Jon )` for 2026 Merrimack County Attorney; the
 * certified ballot carries `Jon Raiche` for Merrimack County Attorney. The
 * strict bar correctly refuses that as a match. What was NOT correct is that
 * the product then published *"No reports on file with the New Hampshire
 * Secretary of State"* — a claim about a government's records that the
 * government's own answer contradicted.
 *
 * Surname must agree exactly. A forename pair counts as compatible when the
 * two are equal, or one is a prefix of the other of at least two characters —
 * `Jon`/`Jonathan`, `Meg`/`Meghan`. That is a stated, checkable rule rather
 * than a distance threshold, and `Allen`/`Erica` is not compatible under it.
 */
export function mayBeSamePerson(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  // Agencies file `SURNAME, FORENAME`; ballots carry `Forename Surname`. The
  // surname is whichever token the two share exactly, so compare SETS for it
  // rather than trusting either side's word order.
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t));
  if (shared.length === 0) return false;
  const restA = ta.filter((t) => !shared.includes(t));
  const restB = tb.filter((t) => !shared.includes(t));
  // Nothing left to disagree about: the shared tokens already carry both names.
  if (restA.length === 0 || restB.length === 0) return true;
  for (const x of restA) {
    for (const y of restB) {
      const short = x.length <= y.length ? x : y;
      const long = x.length <= y.length ? y : x;
      if (short.length >= 2 && long.startsWith(short)) return true;
    }
  }
  return false;
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
  { cls: "FEDERAL", pattern: /\b(united states senat(e|or)|house of representatives|congress(ional)?|president)\b/ },
  /*
   * **NEW HAMPSHIRE'S VOCABULARY, ADDED 2026-08-31 (Session C).**
   *
   * Three of these were not additions but REPAIRS, and one of them was
   * dangerous rather than merely absent:
   *
   * - `Executive Council` matched the MUNICIPAL rule's `council`, so New
   *   Hampshire's statewide executive council classified as a town council.
   *   That is a WRONG class, not a null — and a wrong class is the one thing
   *   `officesAgree` cannot defend against, because two wrong classes can
   *   agree with each other. STATE is tested before MUNICIPAL, so naming it
   *   here fixes it.
   * - `state senate` did not match `State Senator` and `State Senator,
   *   District 7`: the word boundary after `senate` fails against the `r`.
   *   The ballot says senator and the filing says senate, so BOTH spellings
   *   are named rather than relying on one side's habit.
   * - `State Representative` matched nothing at all, which is most of a New
   *   Hampshire ballot.
   *
   * The county additions are NH's actual filed office names, read from the
   * CFS filer records rather than guessed: `County Attorney`, `County
   * Treasurer`, `Register of Deeds`, `Register of Probate`.
   *
   * This widens what can be RECOGNISED. It does not loosen agreement:
   * `officesAgree` still demands two classes that are equal, and an office
   * neither side can classify is still a LEAD.
   */
  /*
   * **ARIZONA'S STATEWIDE VOCABULARY, ADDED 2026-08-31 (Session C2).**
   *
   * Arizona elects six statewide executives besides the Governor, plus an
   * elected Corporation Commission that has no New England or New Jersey
   * analogue. NONE of them matched any rule: `Secretary of State`, `Attorney
   * General`, `State Treasurer`, `Superintendent of Public Instruction`,
   * `State Mine Inspector` and `Corporation Commissioner` all classified as
   * `null`, and `null` is a LEAD. That is 22 of the 49 non-federal candidacies
   * on the Arizona pilot ballot unable to match a filing that exists.
   *
   * Each addition is a full multi-word office title, and that is deliberate
   * rather than terse. The dangerous direction here is a WRONG class, not a
   * null: `officesAgree` defends against one side being unrecognised and
   * cannot defend against two sides that are both wrong in the same way. A
   * bare `\btreasurer\b` would swallow `County Treasurer`, and a bare
   * `\bcommissioner\b` would swallow `County Commissioner` — which is a
   * county candidate's money on a statewide candidate's card. The titles
   * below cannot collide with a county or municipal office because no county
   * or municipal office is called any of them.
   */
  {
    cls: "STATE",
    pattern:
      /\b(general assembly|general court|state senate|state senator|state representative|executive council(l?or)?|governor|assembly|secretary of state|attorney general|state treasurer|superintendent of public instruction|state mine inspector|corporation commissioner)\b/,
  },
  {
    cls: "COUNTY",
    pattern:
      /\b(county commissioner|board of county commissioners|freeholder|county clerk|county attorney|county treasurer|register of (deeds|probate)|sheriff|surrogate|county office)\b/,
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
  const registeredCandidacies = new Set<string>();
  const absentCandidacies = new Set<string>();
  for (const r of records) {
    if (r.filingState === "FILED") for (const k of r.targetKeys) filedCandidacies.add(k);
    else if (r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED")
      for (const k of r.targetKeys) registeredCandidacies.add(k);
    else if (r.filingState === "NO_REPORTS_ON_FILE") for (const k of r.targetKeys) absentCandidacies.add(k);
  }
  /*
   * A candidacy that has BOTH a filing and an absence record resolves as filed:
   * the absence was written for a location pass that another committee
   * answered. The same reasoning orders the middle state — a committee with
   * money outranks a sibling committee with none, and a NAMED committee
   * reporting nothing outranks the registry holding nothing, because the
   * stronger statement is the one the agency actually made.
   */
  for (const k of filedCandidacies) {
    registeredCandidacies.delete(k);
    absentCandidacies.delete(k);
  }
  for (const k of registeredCandidacies) absentCandidacies.delete(k);

  const filed = filedCandidacies.size;
  const registeredNoActivityReported = registeredCandidacies.size;
  const noReportsOnFile = absentCandidacies.size;
  return {
    candidaciesInScope,
    filed,
    registeredNoActivityReported,
    noReportsOnFile,
    lead: records.filter((r) => r.filingState === "LEAD").length,
    routeUnread: records.filter((r) => r.filingState === "ROUTE_UNREAD").length,
    unresolved: Math.max(
      0,
      candidaciesInScope - filed - registeredNoActivityReported - noReportsOnFile,
    ),
    filedRecords: records.filter((r) => r.filingState === "FILED").length,
  };
}

/**
 * Only a record that states a FACT ABOUT THE AGENCY'S HOLDINGS may reach a
 * reader — a filing, a registered committee's reported activity, or a sourced
 * dated absence. Asked here rather than at each surface, so no surface can
 * decide otherwise (the RULING 118 shape: ask once).
 *
 * The two that never render are the two that are about US: a `LEAD` is a guess
 * about a named person's money, and a `ROUTE_UNREAD` is our own failed
 * retrieval. RULING 139 — the product does not announce its own failure; it
 * states what is known and moves on.
 */
export function isRenderable(record: StateMoneyRecord): boolean {
  return (
    record.filingState === "FILED" ||
    record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED" ||
    record.filingState === "NO_REPORTS_ON_FILE" ||
    /*
     * `OURS_GAP` renders and carries no money (RULING 224). What may never
     * reach a reader is an unproven committee's FIGURES, and this record has
     * none: `totals` is null throughout and no committee is attributed. What
     * reaches the reader is a sentence about us and a date.
     */
    record.filingState === "OURS_GAP"
  );
}
