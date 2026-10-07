/**
 * State, county and local campaign money: the half the FEC cannot answer.
 * These records render for readers and never enter an export or a sold
 * aggregate. They extend the funding corpus's data-class union and share its
 * render path.
 *
 * An absence of filings is not zero dollars: small-race candidates may sit
 * under a reporting threshold, and `$0` would be a false claim while blank
 * would look like we never looked. See `FilingState`.
 *
 * Matching is the dangerous part: a wrong join renders someone else's money
 * on a candidate's card. A match requires all three of registered name,
 * office sought and election year to agree with our certified-ballot row;
 * anything less is a `LEAD` and does not render.
 */

import type { Provenance } from "../sources/types.ts";
import type { StateMoneyFunding } from "./state-money-funding.ts";

/** The jurisdiction is carried by each sourced money record. */
export type MoneyJurisdiction = string;

/**
 * Whether this candidate's money is filed, absent, or merely suspected.
 *
 * - `FILED`: reports are on file and the totals are what they say.
 * - `REGISTERED_NO_ACTIVITY_REPORTED`: the agency holds this committee and
 *   publishes zero receipts and expenditures. Renders, with its own sentence.
 * - `NO_REPORTS_ON_FILE`: the agency was asked on `checkedAt`, with a read
 *   proven complete against its own published count, and holds nothing that
 *   could be this candidate. A sourced, dated statement.
 * - `LEAD`: something plausible that does not meet the matching bar. Does not render.
 * - `ROUTE_UNREAD`: the route did not answer. Our gap; does not render.
 * - `OURS_GAP`: see below.
 */
export type FilingState =
  | "FILED"
  | "REGISTERED_NO_ACTIVITY_REPORTED"
  | "NO_REPORTS_ON_FILE"
  | "LEAD"
  | "ROUTE_UNREAD"
  /*
   * A record for this person exists at the agency and we have read it, but
   * something we have not resolved (a different seat, a name we must not
   * guess at) stands between it and a figure. Renders, with no receipts,
   * expenditures, committee or dollar figure: a sentence about us plus the
   * agency's own next filing deadline.
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
 * Top-line figures only. Every field is nullable: a state that does not
 * publish a line renders as not publishing it, never as zero.
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
  /** Held source descriptor and key reference; never a credential value. */
  detailSource?: import("./finance-detail-source.ts").FinanceDoorDetailSource;
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
   * The date the agency was asked, on every record including
   * `NO_REPORTS_ON_FILE`: a read stamp, minted by the code path that read.
   */
  checkedAt: string;
  provenance: Provenance;
  /**
   * Set when a refresh could not read the route and this record was carried
   * forward. `checkedAt` stays the date the facts were actually read; this
   * field is for audit, not for readers.
   */
  retainedFrom?: { attemptedAt: string; reason: string } | null;
  /**
   * Present only on `OURS_GAP`. `whatIsMissing` is one plain sentence about
   * what we could not settle. `nextDue` is the agency's own next filing
   * deadline from its published calendar; `null` means it states none after
   * today.
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
  /** The three-way split, stated with its denominator. */
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
     * Committee records behind `filed`. May exceed `filed` (primary and general
     * committees), so it is its own number and coverage never reads over 100%.
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
      /** Optional: older written snapshots predate these two states. */
      registeredNoActivityReported?: number;
      routeUnread?: number;
    }
  >;
  records: StateMoneyRecord[];
}

/**
 * The matching bar, in one function so no caller can lower it. The join is on
 * a name, which can always drop or mismatch rows, so the bar is a
 * conjunction and its failure is `LEAD`, never a silent drop.
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
 * Name agreement, deliberately conservative. Agencies file
 * `SURNAME, FORENAME MIDDLE SUFFIX`; ballots carry `Forename Surname`. Token
 * sets are compared after stripping punctuation, suffixes and single-letter
 * initials, with no fuzzy-distance threshold.
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
 * A deliberately weak test that may only ever withhold a claim: could the row
 * the agency handed us be about this person? It forbids claiming an absence;
 * it never licenses a match, fills a field or reaches a reader. `namesAgree`
 * stays the strict matching bar.
 *
 * Surname must agree exactly. Forenames are compatible when equal, or one is
 * a prefix of the other of at least two characters (`Jon`/`Jonathan`).
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
 * Office agreement compares classes, not words: an agency may file an office
 * category (`MUNICIPAL OFFICE`, `SCHOOL BOARD`) while the ballot carries the
 * title (`Member of the Township Committee`). Each side maps to a class; an
 * unmapped side is `null`, and `null` never agrees.
 *
 * Order is load-bearing: `Member of the Board of County Commissioners`
 * contains `commissioner`, so COUNTY is tested before MUNICIPAL, and STATE
 * (e.g. `Executive Council`) before MUNICIPAL's `council`.
 */
export type OfficeClass = "COUNTY" | "SCHOOL" | "MUNICIPAL" | "STATE" | "FEDERAL";

const OFFICE_CLASS_RULES: readonly { cls: OfficeClass; pattern: RegExp }[] = [
  { cls: "FEDERAL", pattern: /\b(united states senat(e|or)|house of representatives|congress(ional)?|president)\b/ },
  /*
   * Both `senate` and `senator` are named, because the ballot and the filing
   * use different forms.
   */
  /*
   * Statewide executive offices are full multi-word titles so they cannot
   * swallow a county office: a bare `treasurer` or `commissioner` would put a
   * county candidate's money on a statewide card.
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
  // An office neither side can classify is never agreement.
  if (ca === null || cb === null) return false;
  return ca === cb;
}

/**
 * The split, recomputed from the records themselves. It counts candidacies;
 * the committee record count is a separate number, since one candidate can
 * have several committees. Both come from the array the surface renders.
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
 * Only a record that states a fact about the agency's holdings may reach a
 * reader: a filing, a registered committee's reported activity, a sourced
 * dated absence, or an `OURS_GAP` sentence. A `LEAD` and a `ROUTE_UNREAD`
 * never render. Asked here so no surface decides otherwise.
 */
export function isRenderable(record: StateMoneyRecord): boolean {
  return (
    record.filingState === "FILED" ||
    record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED" ||
    record.filingState === "NO_REPORTS_ON_FILE" ||
    /* `OURS_GAP` renders with no money: totals are null and no committee is attributed. */
    record.filingState === "OURS_GAP"
  );
}
