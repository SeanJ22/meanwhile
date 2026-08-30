/**
 * COVERAGE — what a contest owes, what we hold, and what may therefore render.
 *
 * ## Three rules, and each has cost this project something to learn
 *
 * **1. The denominator comes from the ballot, not from the hunt.** A coverage
 * number computed over "candidates we found money for" measures our own output
 * and always reads 100%. `CampaignFinanceCoverage.candidateUniverse` carries its
 * own source, and a coverage record whose universe is empty is refused rather
 * than scored.
 *
 * **2. Gaps are NAMED, never counted.** "3 filings missing" is a number a reader
 * can do nothing with; three labels are three next actions. Every gap this file
 * emits carries the subject it belongs to and the reason.
 *
 * **3. FEATURE ELIGIBILITY FAILS CLOSED, at the CONTEST level.** If finance
 * coverage is complete for three of four candidates, no candidate-level finance
 * feature is eligible to render for that contest — not for the three, not with a
 * caveat on the fourth. This is not "show everything we find" being contradicted;
 * it is that rule's other half. Money shown for three candidates and absent for a
 * fourth is not an incomplete display, it is an ORDERING: the reader reads the
 * fourth as having raised nothing, which is a claim we never made and cannot
 * support. The correct response to an incomplete hunt is more hunting.
 *
 * ## Symmetry
 *
 * `symmetryCheck` is the neutrality guard. It compares matched candidates in ONE
 * contest for equivalent acquisition depth, filing-authority discovery and
 * completeness. **Unexplained asymmetry is a FAILURE.** A legitimate asymmetry —
 * a filer whose most recent report genuinely covers an earlier period, a
 * candidate with no registered committee — passes only with an
 * `AsymmetryExplanation` that cites a source. "We looked harder at the incumbent"
 * is exactly the failure this catches, and it is invisible without the check
 * because both candidates' cards look fine on their own.
 *
 * All dates are caller-supplied. Nothing here reads a clock.
 */

import {
  MEASURE_SIDES,
  depthRank,
  type AcquisitionDepth,
  type CampaignFinanceCoverage,
  type CandidateFinanceCoverage,
  type CoverageStatus,
  type MeasureSideCoverage,
} from "./model.ts";

/* ── Named gaps ───────────────────────────────────────────────────────────── */

export const GAP_KINDS = [
  /** No filing authority resolved for this subject. */
  "AUTHORITY_UNRESOLVED",
  /** Authority known, no committee identified for the candidacy. */
  "COMMITTEE_UNIDENTIFIED",
  /** Committee known, expected filings not acquired. */
  "FILING_NOT_ACQUIRED",
  /** We do not know how many filings are DUE — the denominator itself is missing. */
  "PERIOD_DENOMINATOR_UNKNOWN",
  /** A filing is known to be amended and the amendment is not held. */
  "AMENDMENT_NOT_HELD",
  /** Two records may or may not be the same committee/person. */
  "IDENTITY_UNRESOLVED",
  /** A route bearing on this subject has no terminal disposition. */
  "ROUTE_OPEN",
  /**
   * We do not know WHICH AUTHORITY GOVERNS THIS CONTEST — the filing rule itself
   * is unread, or read and not yet tied to an office. Distinct from
   * `AUTHORITY_UNRESOLVED`, which is per-candidate: this one is the contest's.
   */
  "FILING_REGIME_UNRESOLVED",
  /**
   * A candidacy is on the ballot and carries NO coverage record at all. The
   * asymmetry that hides from a per-candidate sweep, because the shallower side
   * is not in the list being swept.
   */
  "COVERAGE_RECORD_ABSENT",
  /**
   * A ballot question whose two SIDES were not covered equally — or where the
   * side question was never asked at all.
   *
   * The unit of neutrality in a candidate contest is the candidate. In a measure
   * contest there are no candidates, so the unit is the SIDE, and until this
   * kind existed nothing was checking it.
   */
  "MEASURE_SIDE_UNCOVERED",
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export interface NamedGap {
  readonly kind: GapKind;
  /** The candidacy, committee or contest the gap belongs to. Never "the contest" alone. */
  readonly subject: string;
  /** What is missing, in words. */
  readonly what: string;
  /** What would close it. A gap with no next move is a complaint. */
  readonly nextMove: string;
}

/* ── Symmetry ─────────────────────────────────────────────────────────────── */

export const SYMMETRY_VERDICTS = ["SYMMETRIC", "EXPLAINED_ASYMMETRY", "FAILURE"] as const;
export type SymmetryVerdict = (typeof SYMMETRY_VERDICTS)[number];

export interface SymmetryFinding {
  /** The dimension that differs. */
  readonly dimension:
    | "ACQUISITION_DEPTH"
    | "AUTHORITY_DISCOVERY"
    | "COMPLETENESS"
    | "LATEST_THROUGH"
    | "COVERAGE_RECORD_ABSENT"
    /** One side of a ballot question carries no coverage record, or was never asked about. */
    | "MEASURE_SIDE_ABSENT"
    /** One side's committee register was read and the other's was not. */
    | "COMMITTEE_UNIVERSE_SOURCE";
  readonly deeper: string;
  readonly shallower: string;
  readonly detail: string;
  /** Present only when a source-supported explanation was filed for the shallower side. */
  readonly explainedBy: string | null;
}

export interface SymmetryReport {
  readonly contestId: string;
  readonly verdict: SymmetryVerdict;
  readonly findings: readonly SymmetryFinding[];
  /** Findings with no source-supported explanation. Non-empty means FAILURE. */
  readonly unexplained: readonly SymmetryFinding[];
  readonly why: string;
}

/**
 * Compare every candidate in one contest against the deepest-covered one.
 *
 * The reference is the MAXIMUM rather than the mean, deliberately: the deepest
 * acquisition is proof of what was achievable here, so every shallower candidate
 * owes either the same depth or a reason.
 */
export function symmetryCheck(coverage: CampaignFinanceCoverage): SymmetryReport {
  const people = coverage.perCandidate;

  /**
   * **THE OMITTED PEER, CHECKED FIRST AND AGAINST THE BALLOT.**
   *
   * This block is here because the rest of this function sweeps
   * `perCandidate` — and a candidate who was silently left out of the hunt is
   * not IN `perCandidate`. Comparing the list against itself reports a contest
   * where one candidate got coverage and a peer got none as perfectly
   * symmetric, which is the seeded failure wearing this guard's own uniform.
   *
   * So the denominator is `candidateUniverse`, which comes from the ballot, and
   * a missing record is the DEEPEST asymmetry there is: the shallower side was
   * not merely covered less, it was not asked about. It can carry no
   * `AsymmetryExplanation` either, because the record that would hold one is the
   * thing that is missing — so `explainedBy` is structurally null and the
   * verdict is structurally FAILURE.
   */
  const covered = new Set(people.map((p) => p.candidacyId));
  const omitted = coverage.candidateUniverse.filter((id) => !covered.has(id));
  const omittedFindings: SymmetryFinding[] = omitted.map((candidacyId) => ({
    dimension: "COVERAGE_RECORD_ABSENT",
    deeper: people[0]?.candidacyId ?? coverage.contestId,
    shallower: candidacyId,
    detail:
      `${candidacyId} is on the ballot for ${coverage.contestId} (universe source: ` +
      `${coverage.candidateUniverseSource}) and carries NO finance coverage record, while ` +
      `${people.length} peer(s) in the same contest do. A peer who is absent from the comparison ` +
      "cannot be found by comparing the ones who are present.",
    explainedBy: null,
  }));

  if (people.length < 2) {
    if (omittedFindings.length > 0) {
      return {
        contestId: coverage.contestId,
        verdict: "FAILURE",
        findings: omittedFindings,
        unexplained: omittedFindings,
        why:
          `${omittedFindings.length} candidacy(ies) on the ballot for ${coverage.contestId} carry no ` +
          "coverage record at all. This is not a thin contest; it is a contest whose denominator " +
          "shrank to what we happened to find, and a denominator that measures our own output " +
          "always reads complete.",
      };
    }
    return {
      contestId: coverage.contestId,
      verdict: "SYMMETRIC",
      findings: [],
      unexplained: [],
      why:
        `${people.length} candidate coverage record(s) — there is no second candidate to be ` +
        "asymmetric with. This is not evidence of neutrality; it is the absence of the question.",
    };
  }

  const deepest = people.reduce((a, b) => (depthRank(b.acquisitionDepth) > depthRank(a.acquisitionDepth) ? b : a));
  const anyAuthorityResolved = people.some((p) => p.filingAuthorityResolved);
  const latestThroughSeen = people
    .map((p) => p.latestThroughDate)
    .filter((d): d is string => d !== null)
    .sort();
  const newestThrough = latestThroughSeen.at(-1) ?? null;

  const findings: SymmetryFinding[] = [...omittedFindings];

  for (const person of people) {
    const explained = person.asymmetryExplanation;
    const explainedBy =
      explained && explained.sourceCitation.trim().length > 0
        ? `${explained.reason} [${explained.sourceCitation}, recorded ${explained.recordedOn}]`
        : null;

    if (depthRank(person.acquisitionDepth) < depthRank(deepest.acquisitionDepth)) {
      findings.push({
        dimension: "ACQUISITION_DEPTH",
        deeper: deepest.candidacyId,
        shallower: person.candidacyId,
        detail:
          `${person.displayName} is covered to ${person.acquisitionDepth} while ${deepest.displayName} ` +
          `is covered to ${deepest.acquisitionDepth} in the same contest.`,
        explainedBy,
      });
    }

    if (anyAuthorityResolved && !person.filingAuthorityResolved) {
      findings.push({
        dimension: "AUTHORITY_DISCOVERY",
        deeper: deepest.candidacyId,
        shallower: person.candidacyId,
        detail:
          `The filing authority was resolved for at least one candidate in this contest and not for ` +
          `${person.displayName}. The custodian is a property of the CONTEST; one candidate's ` +
          "resolution is the other's too unless a filed reason says otherwise.",
        explainedBy,
      });
    }

    if (
      person.filingPeriodsMissing.length > deepest.filingPeriodsMissing.length ||
      (person.filingsAcquired.length === 0 && deepest.filingsAcquired.length > 0)
    ) {
      findings.push({
        dimension: "COMPLETENESS",
        deeper: deepest.candidacyId,
        shallower: person.candidacyId,
        detail:
          `${person.displayName} holds ${person.filingsAcquired.length} filing(s) with ` +
          `${person.filingPeriodsMissing.length} period(s) missing, against ` +
          `${deepest.displayName}'s ${deepest.filingsAcquired.length} and ` +
          `${deepest.filingPeriodsMissing.length}.`,
        explainedBy,
      });
    }

    if (newestThrough !== null && person.latestThroughDate !== null && person.latestThroughDate < newestThrough) {
      findings.push({
        dimension: "LATEST_THROUGH",
        deeper: deepest.candidacyId,
        shallower: person.candidacyId,
        detail:
          `${person.displayName}'s latest acquired filing covers through ${person.latestThroughDate}; ` +
          `another candidate in this contest is covered through ${newestThrough}.`,
        explainedBy,
      });
    }
  }

  const unexplained = findings.filter((f) => f.explainedBy === null);

  if (findings.length === 0) {
    return {
      contestId: coverage.contestId,
      verdict: "SYMMETRIC",
      findings,
      unexplained,
      why: `All ${people.length} candidates are covered to the same depth, authority state and completeness.`,
    };
  }
  if (unexplained.length === 0) {
    return {
      contestId: coverage.contestId,
      verdict: "EXPLAINED_ASYMMETRY",
      findings,
      unexplained,
      why:
        `${findings.length} asymmetr(y/ies), every one carrying a source-supported explanation. ` +
        "The difference is a property of the filings, not of how hard we looked.",
    };
  }
  return {
    contestId: coverage.contestId,
    verdict: "FAILURE",
    findings,
    unexplained,
    why:
      `${unexplained.length} unexplained asymmetr(y/ies) in ${coverage.contestId}. A reader cannot ` +
      "tell 'this candidate raised less' from 'we looked less hard at this candidate', and the " +
      "second is this product putting a thumb on the scale. Either acquire to the same depth or " +
      "file a source-supported explanation.",
  };
}

/* ── The OTHER symmetry unit: the sides of a ballot question ──────────────── */

/**
 * **A MEASURE HAS NO CANDIDATES, SO `symmetryCheck` HAS NOTHING TO COMPARE.**
 *
 * That is not a small omission, it is a hole shaped exactly like the guard. Run
 * `symmetryCheck` on Proposition 423 and it reports:
 *
 * > 0 candidate coverage record(s) — there is no second candidate to be
 * > asymmetric with.
 *
 * …and returns `SYMMETRIC`. A contest where the YES committees were hunted, the
 * NO committees were not, and nobody recorded a reason, passes the neutrality
 * guard cleanly — because the guard was counting the wrong noun. Money shown for
 * one side of a ballot question and absent for the other is read by a reader as
 * one side having raised nothing, which is the same failure as the four-card
 * candidate contest, one tier down.
 *
 * So the unit here is the SIDE, and the three states are kept apart:
 *
 *   - `measureSides` **undefined** — the side question was never asked. FAILURE,
 *     and it must be, because the alternative is that forgetting to ask is
 *     indistinguishable from asking and finding nothing.
 *   - a side present with `committeeUniverseSource: null` — we did not read a
 *     register, so we do not know what is on that side. A gap.
 *   - a side present with a source and an empty committee list — the register
 *     WAS read and that side has no registered committee. A finding about the
 *     filers, and legitimately symmetric with the other side only if the other
 *     side was read from the same register.
 *
 * A candidate contest returns `SYMMETRIC` from here with no findings: the side
 * unit does not apply, `symmetryCheck` governs it, and reporting a false failure
 * would train a reader to ignore this guard.
 */
export function sideSymmetryCheck(coverage: CampaignFinanceCoverage): SymmetryReport {
  if (coverage.candidateUniverse.length > 0) {
    return {
      contestId: coverage.contestId,
      verdict: "SYMMETRIC",
      findings: [],
      unexplained: [],
      why:
        `${coverage.contestId} is a candidate contest — its neutrality unit is the CANDIDATE, and ` +
        "symmetryCheck governs it. The side unit does not apply here.",
    };
  }

  const sides = coverage.measureSides;
  if (sides === undefined) {
    const findings: SymmetryFinding[] = MEASURE_SIDES.map((side) => ({
      dimension: "MEASURE_SIDE_ABSENT",
      deeper: coverage.contestId,
      shallower: `${coverage.contestId}#${side}`,
      detail:
        `${coverage.contestId} is a ballot question with no candidates, and it carries no side ` +
        `coverage at all — so the ${side} side has not been asked about. A measure's neutrality ` +
        "unit is the side; comparing a list of candidates that is empty on both sides reports " +
        "perfect symmetry for a contest nobody covered.",
      explainedBy: null,
    }));
    return {
      contestId: coverage.contestId,
      verdict: "FAILURE",
      findings,
      unexplained: findings,
      why:
        `${coverage.contestId} has no candidates and no measureSides record. The side question was ` +
        "never asked, and an unasked question is not a symmetric answer.",
    };
  }

  const bySide = new Map<string, MeasureSideCoverage>(sides.map((s) => [s.side, s]));
  const findings: SymmetryFinding[] = [];

  for (const side of MEASURE_SIDES) {
    if (!bySide.has(side)) {
      findings.push({
        dimension: "MEASURE_SIDE_ABSENT",
        deeper: `${coverage.contestId}#${MEASURE_SIDES.filter((s) => s !== side).join("/")}`,
        shallower: `${coverage.contestId}#${side}`,
        detail:
          `The ${side} side of ${coverage.contestId} carries no coverage record while the other ` +
          "side does. A side that is absent from the comparison cannot be found by comparing the " +
          "sides that are present, and it can carry no explanation either — the record that would " +
          "hold one is the thing that is missing.",
        explainedBy: null,
      });
    }
  }

  const present = MEASURE_SIDES.map((s) => bySide.get(s)).filter(
    (s): s is MeasureSideCoverage => s !== undefined,
  );

  if (present.length === 2) {
    const [a, b] = present;
    const explanationFor = (side: MeasureSideCoverage): string | null => {
      const e = side.asymmetryExplanation;
      return e && e.sourceCitation.trim().length > 0
        ? `${e.reason} [${e.sourceCitation}, recorded ${e.recordedOn}]`
        : null;
    };

    const deeper = depthRank(a.acquisitionDepth) >= depthRank(b.acquisitionDepth) ? a : b;
    const shallower = deeper === a ? b : a;

    if (depthRank(shallower.acquisitionDepth) < depthRank(deeper.acquisitionDepth)) {
      findings.push({
        dimension: "ACQUISITION_DEPTH",
        deeper: `${coverage.contestId}#${deeper.side}`,
        shallower: `${coverage.contestId}#${shallower.side}`,
        detail:
          `The ${shallower.side} side is covered to ${shallower.acquisitionDepth} while the ` +
          `${deeper.side} side is covered to ${deeper.acquisitionDepth} on the same question.`,
        explainedBy: explanationFor(shallower),
      });
    }

    /**
     * THE REGISTER ASYMMETRY, which is the one that actually happens.
     *
     * Nobody sets out to hunt one side of a bond override. What happens is that
     * a committee turns up under a searchable name on one side, the other side
     * has no obvious name to search, and the second search never gets recorded
     * as owed. A null `committeeUniverseSource` beside a non-null one is that,
     * exactly, and it is invisible in a committee count because both sides can
     * read zero.
     */
    if ((a.committeeUniverseSource === null) !== (b.committeeUniverseSource === null)) {
      const unread = a.committeeUniverseSource === null ? a : b;
      const read = unread === a ? b : a;
      findings.push({
        dimension: "COMMITTEE_UNIVERSE_SOURCE",
        deeper: `${coverage.contestId}#${read.side}`,
        shallower: `${coverage.contestId}#${unread.side}`,
        detail:
          `The ${read.side} side's committee universe was read from ${read.committeeUniverseSource}; ` +
          `the ${unread.side} side's was never read from anything. An empty committee list with no ` +
          "source is not a finding that no committee registered — it is a search nobody ran.",
        explainedBy: explanationFor(unread),
      });
    }

    if (!a.filingAuthorityResolved !== !b.filingAuthorityResolved) {
      const unresolved = a.filingAuthorityResolved ? b : a;
      findings.push({
        dimension: "AUTHORITY_DISCOVERY",
        deeper: `${coverage.contestId}#${(unresolved === a ? b : a).side}`,
        shallower: `${coverage.contestId}#${unresolved.side}`,
        detail:
          `The filing authority is resolved for one side of ${coverage.contestId} and not for the ` +
          `${unresolved.side} side. The custodian is a property of the QUESTION; one side's ` +
          "resolution is the other's too unless a filed reason says otherwise.",
        explainedBy: explanationFor(unresolved),
      });
    }

    if (a.filingsAcquired.length !== b.filingsAcquired.length) {
      const fewer = a.filingsAcquired.length < b.filingsAcquired.length ? a : b;
      const more = fewer === a ? b : a;
      findings.push({
        dimension: "COMPLETENESS",
        deeper: `${coverage.contestId}#${more.side}`,
        shallower: `${coverage.contestId}#${fewer.side}`,
        detail:
          `The ${fewer.side} side holds ${fewer.filingsAcquired.length} filing(s) against the ` +
          `${more.side} side's ${more.filingsAcquired.length} on the same question.`,
        explainedBy: explanationFor(fewer),
      });
    }
  }

  const unexplained = findings.filter((f) => f.explainedBy === null);

  if (findings.length === 0) {
    return {
      contestId: coverage.contestId,
      verdict: "SYMMETRIC",
      findings,
      unexplained,
      why:
        `Both sides of ${coverage.contestId} are covered to the same depth, from the same register, ` +
        "under the same resolved authority, with the same number of filings held.",
    };
  }
  if (unexplained.length === 0) {
    return {
      contestId: coverage.contestId,
      verdict: "EXPLAINED_ASYMMETRY",
      findings,
      unexplained,
      why:
        `${findings.length} asymmetr(y/ies) between the sides of ${coverage.contestId}, every one ` +
        "carrying a source-supported explanation. The difference is a property of the filings, not " +
        "of how hard either side was hunted.",
    };
  }
  return {
    contestId: coverage.contestId,
    verdict: "FAILURE",
    findings,
    unexplained,
    why:
      `${unexplained.length} unexplained asymmetr(y/ies) between the sides of ${coverage.contestId}. ` +
      "A reader cannot tell 'this side raised less' from 'we looked less hard at this side', and " +
      "the second is this product putting a thumb on the scale of a ballot question.",
  };
}

/* ── Feature eligibility, failing closed ──────────────────────────────────── */

export interface FeatureEligibility {
  readonly contestId: string;
  readonly eligible: boolean;
  /** Candidates with complete coverage. Reported, and NOT a licence to render. */
  readonly candidatesComplete: number;
  readonly candidatesOwed: number;
  readonly blockedBy: readonly string[];
  readonly why: string;
}

/** A candidate is complete when the custodian is known and no period is missing. */
export function candidateCoverageComplete(person: CandidateFinanceCoverage): boolean {
  return (
    person.filingAuthorityResolved &&
    person.filingPeriodsExpected !== null &&
    person.filingPeriodsMissing.length === 0 &&
    person.amendmentGaps.length === 0 &&
    person.identityGaps.length === 0 &&
    depthRank(person.acquisitionDepth) >= depthRank("SUMMARY_TOTALS")
  );
}

/**
 * **Fail closed, at the contest level.**
 *
 * Three of four is refused. So is three of four plus a caveat on the fourth,
 * because the caveat does not survive the reader's glance at four cards where
 * one has no number on it.
 */
export function candidateFinanceFeatureEligibility(
  coverage: CampaignFinanceCoverage,
): FeatureEligibility {
  const owed = coverage.candidateUniverse.length;
  const byId = new Map(coverage.perCandidate.map((p) => [p.candidacyId, p]));
  const blocked: string[] = [];
  let complete = 0;

  /**
   * **AN UNRESOLVED FILING REGIME BLOCKS THE WHOLE CONTEST, AND DOES NOT CLOSE
   * IT.**
   *
   * Two different failures share one cause here. If we do not know which
   * authority governs this contest, then (a) every per-candidate record was
   * built against a custodian nobody established, so "no filings missing" means
   * "no filings expected from an office we never identified"; and (b) rendering
   * money on that basis puts a number under a candidate's name sourced to a
   * government we did not confirm holds it.
   *
   * The block is at the CONTEST level for the same reason the three-of-four rule
   * is: a caveat does not survive the reader's glance at the cards.
   */
  if (coverage.filingRegimeState !== "RESOLVED") {
    blocked.push(
      `${coverage.contestId}: the filing regime is ${coverage.filingRegimeState}` +
        `${coverage.filingRegimeId === null ? "" : ` (rule ${coverage.filingRegimeId})`} — we have ` +
        "not established which authority governs this contest, so no per-candidate record can be " +
        "complete against a custodian's calendar",
    );
  }

  for (const candidacyId of coverage.candidateUniverse) {
    const person = byId.get(candidacyId);
    if (!person) {
      blocked.push(`${candidacyId}: on the ballot and carrying NO coverage record at all`);
      continue;
    }
    if (candidateCoverageComplete(person)) {
      complete += 1;
      continue;
    }
    const reasons: string[] = [];
    if (!person.filingAuthorityResolved) reasons.push("filing authority unresolved");
    if (person.filingPeriodsExpected === null) reasons.push("expected-period denominator unknown");
    if (person.filingPeriodsMissing.length > 0)
      reasons.push(`missing period(s): ${person.filingPeriodsMissing.join(", ")}`);
    if (person.amendmentGaps.length > 0) reasons.push(`amendment(s) not held: ${person.amendmentGaps.join(", ")}`);
    if (person.identityGaps.length > 0) reasons.push(`identity unresolved: ${person.identityGaps.join(", ")}`);
    if (depthRank(person.acquisitionDepth) < depthRank("SUMMARY_TOTALS"))
      reasons.push(`acquisition depth is ${person.acquisitionDepth}`);
    blocked.push(`${person.displayName} (${person.candidacyId}): ${reasons.join("; ")}`);
  }

  if (owed === 0) {
    return {
      contestId: coverage.contestId,
      eligible: false,
      candidatesComplete: 0,
      candidatesOwed: 0,
      blockedBy: ["the candidate universe is empty — there is no denominator to be complete against"],
      why:
        "A coverage record with no candidate universe cannot be complete, because completeness is " +
        "measured against the ballot and this record does not know what the ballot says.",
    };
  }

  if (blocked.length === 0) {
    return {
      contestId: coverage.contestId,
      eligible: true,
      candidatesComplete: complete,
      candidatesOwed: owed,
      blockedBy: [],
      why: `All ${owed} candidate(s) on the ballot for ${coverage.contestId} carry complete finance coverage.`,
    };
  }

  return {
    contestId: coverage.contestId,
    eligible: false,
    candidatesComplete: complete,
    candidatesOwed: owed,
    blockedBy: blocked,
    why:
      `Finance coverage is complete for ${complete} of ${owed} candidates in ${coverage.contestId}. ` +
      "NO candidate-level finance feature is eligible for this contest — not for the covered ones. " +
      "Money shown for some candidates and missing for another is read as the other having raised " +
      "nothing, which is a claim we never made. The correct response is more hunting.",
  };
}

/* ── The verdict ──────────────────────────────────────────────────────────── */

export interface CoverageVerdict {
  readonly contestId: string;
  readonly status: CoverageStatus;
  readonly completeAsOf: string | null;
  readonly gaps: readonly NamedGap[];
  readonly candidatesOwed: number;
  readonly candidatesComplete: number;
  readonly openRouteIds: readonly string[];
  readonly symmetry: SymmetryReport;
  /**
   * The SIDE symmetry of a ballot question. Always present, and on a candidate
   * contest it reports SYMMETRIC-not-applicable rather than being omitted, so a
   * caller never has to know which kind of contest it is holding.
   */
  readonly sideSymmetry: SymmetryReport;
  readonly featureEligibility: FeatureEligibility;
  readonly deepestAcquisition: AcquisitionDepth;
  readonly why: string;
}

/**
 * Evaluate one contest's coverage.
 *
 * The status is DERIVED from the gaps, never asserted by the caller — the same
 * rule `lib/workstate` already runs under, where item completion is derived from
 * child state and a model may not type "done" while unresolved children exist.
 * `COMPLETE_AS_OF` additionally requires a symmetry pass: a contest covered
 * unevenly is not complete, it is skewed.
 */
export function evaluateCoverage(
  coverage: CampaignFinanceCoverage,
  asOf: string,
): CoverageVerdict {
  const gaps: NamedGap[] = [];
  const byId = new Map(coverage.perCandidate.map((p) => [p.candidacyId, p]));

  /**
   * The contest-level routing question, asked before any per-candidate one.
   *
   * `NO_REGIME_ON_RECORD` is the state that must never be able to reach
   * `COMPLETE_AS_OF`: it says this repository has not read the rule that names
   * the custodian, and a contest declared complete on that basis would be
   * asserting an absence about a government we never identified, let alone
   * asked. Emitting a gap is what keeps it out of the terminal branch below —
   * derived from state, never typed by a caller.
   */
  if (coverage.filingRegimeState !== "RESOLVED") {
    gaps.push({
      kind: "FILING_REGIME_UNRESOLVED",
      subject: coverage.contestId,
      what:
        `the filing regime for this contest is ${coverage.filingRegimeState}` +
        `${coverage.filingRegimeId === null ? "" : ` (rule ${coverage.filingRegimeId})`} — we do ` +
        "not know which authority governs it",
      nextMove:
        coverage.filingRegimeState === "NO_REGIME_ON_RECORD"
          ? "Read this jurisdiction's filing-officer rule from its own government's site and add the " +
            "regime to data/campaign-finance/filing-regimes.json. Until then the custodian is UNKNOWN, " +
            "which is a fact about us and never about whether these filings exist."
          : "The routing rule is known and the office holding it is not. Walk the route from the " +
            "rule's ROLE to a named office; do not substitute the jurisdiction-wide authority.",
    });
  }

  for (const candidacyId of coverage.candidateUniverse) {
    const person = byId.get(candidacyId);
    if (!person) {
      gaps.push({
        kind: "COVERAGE_RECORD_ABSENT",
        subject: candidacyId,
        what: "on the ballot for this contest and carrying no finance coverage record at all",
        nextMove:
          "Create the coverage record and resolve the filing authority for the contest — the " +
          "custodian is already known for the other candidates.",
      });
      continue;
    }
    if (!person.filingAuthorityResolved) {
      gaps.push({
        kind: "AUTHORITY_UNRESOLVED",
        subject: person.candidacyId,
        what: `no filing authority resolved for ${person.displayName}`,
        nextMove:
          "Resolve it from the jurisdiction's filing-officer statute, not from which portal " +
          "happens to be reachable.",
      });
    }
    if (person.committeeIds.length === 0) {
      gaps.push({
        kind: "COMMITTEE_UNIDENTIFIED",
        subject: person.candidacyId,
        what: `no committee identified for ${person.displayName}`,
        nextMove: "Search the authority's committee register for this candidacy.",
      });
    }
    if (person.filingPeriodsExpected === null) {
      gaps.push({
        kind: "PERIOD_DENOMINATOR_UNKNOWN",
        subject: person.candidacyId,
        what: `we do not know how many reports are DUE for ${person.displayName}`,
        nextMove:
          "Read the authority's own reporting calendar. Without it, 'filings acquired' has no " +
          "denominator and cannot state completeness.",
      });
    }
    for (const period of person.filingPeriodsMissing) {
      gaps.push({
        kind: "FILING_NOT_ACQUIRED",
        subject: person.candidacyId,
        what: `${person.displayName}: no filing held for period ${period}`,
        nextMove: `Acquire the ${period} report from the resolved filing authority.`,
      });
    }
    for (const amendment of person.amendmentGaps) {
      gaps.push({
        kind: "AMENDMENT_NOT_HELD",
        subject: person.candidacyId,
        what: `${person.displayName}: an amendment is known to exist and is not held — ${amendment}`,
        nextMove:
          "Acquire the amendment. Until it is held, the superseded version is the only claim we " +
          "have and it is known to be wrong.",
      });
    }
    for (const identity of person.identityGaps) {
      gaps.push({
        kind: "IDENTITY_UNRESOLVED",
        subject: person.candidacyId,
        what: `${person.displayName}: ${identity}`,
        nextMove:
          "Resolve on filed evidence. Name, office and year must all agree; two of three is a LEAD " +
          "and a LEAD never renders.",
      });
    }
  }

  for (const contestGap of coverage.identityGaps) {
    gaps.push({
      kind: "IDENTITY_UNRESOLVED",
      subject: coverage.contestId,
      what: contestGap,
      nextMove: "Resolve on filed evidence before any of the affected money renders.",
    });
  }
  for (const contestGap of coverage.amendmentGaps) {
    gaps.push({
      kind: "AMENDMENT_NOT_HELD",
      subject: coverage.contestId,
      what: contestGap,
      nextMove: "Acquire the amendment; the superseded claim stays in the record beside it.",
    });
  }
  for (const filing of coverage.filingsMissing) {
    gaps.push({
      kind: "FILING_NOT_ACQUIRED",
      subject: coverage.contestId,
      what: `filing not acquired: ${filing}`,
      nextMove: "Walk the route that publishes it.",
    });
  }

  const openRoutes = coverage.routes.filter(
    (r) => !["INGESTED", "WALKED_NO_YIELD", "NOT_APPLICABLE"].includes(r.disposition),
  );
  for (const openRoute of openRoutes) {
    gaps.push({
      kind: "ROUTE_OPEN",
      subject: openRoute.declaration.routeId,
      what: `${openRoute.declaration.label} — ${openRoute.disposition}: ${openRoute.note}`,
      nextMove: `Walk it against ${openRoute.declaration.target}. Source: ${openRoute.citation}`,
    });
  }

  const symmetry = symmetryCheck(coverage);

  /**
   * THE SIDE SWEEP, whose findings become gaps like any other.
   *
   * They are pushed as gaps rather than only reported alongside, because
   * `COMPLETE_AS_OF` is derived from `gaps.length === 0` — a side failure that
   * lived only in its own report would let a one-sided ballot question reach
   * completion while the report beside it said FAILURE.
   */
  const sideSymmetry = sideSymmetryCheck(coverage);
  for (const finding of sideSymmetry.unexplained) {
    gaps.push({
      kind: "MEASURE_SIDE_UNCOVERED",
      subject: finding.shallower,
      what: finding.detail,
      nextMove:
        finding.dimension === "MEASURE_SIDE_ABSENT"
          ? "Record coverage for this side of the question — including, explicitly, whether a " +
            "register was read and what it said. An unasked side is not an empty one."
          : "Acquire this side to the same depth as the other, or file a source-supported " +
            "explanation for why the filings themselves differ.",
    });
  }

  const featureEligibility = candidateFinanceFeatureEligibility(coverage);
  const complete = coverage.perCandidate.filter(candidateCoverageComplete).length;
  const deepest =
    coverage.perCandidate.length === 0
      ? ("NONE" as AcquisitionDepth)
      : coverage.perCandidate.reduce((a, b) =>
          depthRank(b.acquisitionDepth) > depthRank(a.acquisitionDepth) ? b : a,
        ).acquisitionDepth;

  let status: CoverageStatus;
  let why: string;
  if (
    gaps.length === 0 &&
    symmetry.verdict !== "FAILURE" &&
    sideSymmetry.verdict !== "FAILURE" &&
    featureEligibility.eligible
  ) {
    status = "COMPLETE_AS_OF";
    why =
      `Every candidate on the ballot for ${coverage.contestId} is answered, no route is open, and ` +
      `the contest passes symmetry. COMPLETE_AS_OF ${asOf} means every currently eligible avenue ` +
      "has a disposition under the current method — never that no other source exists.";
  } else if (complete > 0) {
    status = "PARTIAL";
    why =
      `${complete} of ${coverage.candidateUniverse.length} candidates answered, with ${gaps.length} ` +
      "named gap(s). PARTIAL is a state of the HUNT and never a licence to render: the correct " +
      "response to an incomplete hunt is more hunting.";
  } else {
    status = "OPEN";
    why =
      `${gaps.length} named gap(s) and no candidate fully answered in ${coverage.contestId}. This is ` +
      "a claim about our collection, never about whether these filings exist.";
  }

  return {
    contestId: coverage.contestId,
    status,
    completeAsOf: status === "COMPLETE_AS_OF" ? asOf : null,
    gaps,
    candidatesOwed: coverage.candidateUniverse.length,
    candidatesComplete: complete,
    openRouteIds: openRoutes.map((r) => r.declaration.routeId),
    symmetry,
    sideSymmetry,
    featureEligibility,
    deepestAcquisition: deepest,
    why,
  };
}

/** A one-screen report. Names every gap; never prints a bare count. */
export function describeCoverage(verdict: CoverageVerdict): string {
  const lines = [
    `CAMPAIGN FINANCE COVERAGE — ${verdict.contestId}`,
    `  status: ${verdict.status}${verdict.completeAsOf ? ` (as of ${verdict.completeAsOf})` : ""}`,
    `  candidates answered: ${verdict.candidatesComplete} of ${verdict.candidatesOwed}`,
    `  deepest acquisition: ${verdict.deepestAcquisition}`,
    `  symmetry: ${verdict.symmetry.verdict} — ${verdict.symmetry.why}`,
    `  candidate finance features eligible: ${verdict.featureEligibility.eligible ? "yes" : "NO"}`,
  ];
  for (const blocker of verdict.featureEligibility.blockedBy) lines.push(`      blocked by ${blocker}`);
  lines.push(`  named gaps: ${verdict.gaps.length}`);
  for (const gap of verdict.gaps) lines.push(`      [${gap.kind}] ${gap.subject} — ${gap.what}`);
  return lines.join("\n");
}
