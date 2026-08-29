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
  depthRank,
  type AcquisitionDepth,
  type CampaignFinanceCoverage,
  type CandidateFinanceCoverage,
  type CoverageStatus,
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
    | "COVERAGE_RECORD_ABSENT";
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
  if (gaps.length === 0 && symmetry.verdict !== "FAILURE" && featureEligibility.eligible) {
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
