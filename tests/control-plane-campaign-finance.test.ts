/**
 * CAMPAIGN FINANCE INTELLIGENCE — the seeded failures, #12 through #15.
 *
 * Four failure modes, each of which this repository can produce today and none
 * of which announces itself:
 *
 *   **#12** A local race with no FEC data reads as a race with no money. The
 *   FEC's jurisdiction ends above the county line — its OWN combined directory
 *   lists no Arizona county officer and no city clerk — so federal silence is a
 *   fact about federal scope and never about a local government.
 *
 *   **#13** Finance complete for three of four candidates renders as an
 *   ordering. The fourth card has no number on it, and the reader supplies the
 *   missing meaning: "raised nothing". Fail closed for the whole contest.
 *
 *   **#14** An outside group's spending gets summed into a candidate's receipts,
 *   and the candidate appears to have raised money nobody gave them.
 *
 *   **#15** An amendment overwrites the claim it corrects, and the number a
 *   reader saw last week becomes unfindable.
 *
 * Plus the two structural guards: coverage SYMMETRY across candidates in one
 * contest, and the statute routing that sends a school-district election to the
 * COUNTY officer.
 *
 * ## Fixtures versus findings, stated once
 *
 * Tests that exercise the EVALUATOR use fixtures whose ids begin with
 * `fixture:`. They are inputs to a function, and they assert nothing about any
 * real committee, filing or amount — there is no independent-expenditure data
 * anywhere in this repository (tracker D51, blocked behind PB10/D23), so an IE
 * test could only be a fixture. Tests that assert about the WORLD read the
 * committed artifacts: `data/ballot/az-pima-2026.json`, `data/fec/fec-2026.json`,
 * `states/az/sources.md` and `lib/funding/state-vocabulary.ts`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";
import {
  ARIZONA_REGIME,
  AZ_SECRETARY_OF_STATE,
  FEC_AUTHORITY,
  PIMA_COUNTY_FILING_OFFICER,
  TUCSON_CITY_CLERK,
  fecAbsenceIsNotClosure,
  resolveFilingAuthority,
} from "../lib/control-plane/campaign-finance/authority.ts";
import {
  candidateFinanceFeatureEligibility,
  evaluateCoverage,
  symmetryCheck,
} from "../lib/control-plane/campaign-finance/coverage.ts";
import {
  INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT,
  MoneyFlattened,
  currentVersionOf,
  independentSpendingAbout,
  lineageOf,
  supersede,
  totalReceivedBy,
  type CampaignFinanceFiling,
  type CandidateFinanceCoverage,
  type Contribution,
  type IndependentExpenditure,
  type IndependentExpenditureReport,
  type PoliticalCommittee,
} from "../lib/control-plane/campaign-finance/model.ts";
import {
  AZ_LOCAL_ROUTES,
  US_HOUSE_6_CANDIDACIES,
  arizonaLocalObligation,
  federalObligation,
} from "../lib/control-plane/campaign-finance/obligations.ts";
import { coverageFixture } from "./control-plane-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "..");
const NOW = "2026-08-28T00:00:00.000Z";
const AS_OF = "2026-08-28";

/* ── Fixture builders. Every id says `fixture:` out loud. ─────────────────── */

function fixtureCandidate(
  over: Partial<CandidateFinanceCoverage> & { candidacyId: string; displayName: string },
): CandidateFinanceCoverage {
  return {
    committeeIds: ["fixture:committee:a"],
    filingAuthorityResolved: true,
    filingAuthorityIds: ["fixture:authority"],
    filingsAcquired: ["fixture:filing:q1", "fixture:filing:q2"],
    filingPeriodsExpected: ["2026 Q1", "2026 Q2"],
    filingPeriodsMissing: [],
    latestThroughDate: "2026-06-30",
    acquisitionDepth: "ITEMIZED_TRANSACTIONS",
    openRouteIds: [],
    identityGaps: [],
    amendmentGaps: [],
    asymmetryExplanation: null,
    ...over,
  };
}


/* ══ #12 — a local race with no FEC data stays OPEN ═══════════════════════ */

test("#12 FEC absence does NOT close a local race, and the statute finds the custodian", () => {
  const verdict = fecAbsenceIsNotClosure({
    contestId: "ballot-az-pima:prop-423",
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    county: "Pima",
  });

  // The state is OPEN, and there is no input that makes it anything else.
  assert.equal(verdict.coverageState, "OPEN");
  assert.equal(verdict.closesTheContest, false);

  // And the local custodian WAS found — by statute, not by portal.
  assert.equal(verdict.resolution.status, "RESOLVED");
  assert.equal(verdict.resolution.authority?.id, PIMA_COUNTY_FILING_OFFICER.id);
  assert.equal(verdict.resolution.statutoryBasis, "A.R.S. § 16-928");
  assert.match(
    verdict.resolution.statutoryQuote ?? "",
    /county officer in charge of elections is the filing officer for county, school district/,
  );

  // The FEC's silence is characterised as a scope fact, with the committed
  // artifact that proves the scope.
  const boundary = verdict.owedRoutes.find(
    (r) => r.declaration.routeId === "FEC_JURISDICTION_BOUNDARY",
  );
  assert.ok(boundary, "the verdict must name WHY federal silence is not evidence");
  assert.equal(boundary.disposition, "NOT_APPLICABLE");
  assert.match(boundary.citation, /fec_combined_federal_state_disclosure_directory\.csv/);

  // Not vacuous: the cited artifact really does stop above the county line.
  const directory = readFileSync(
    join(ROOT, "data", "reference", "fec_combined_federal_state_disclosure_directory.csv"),
    "utf8",
  );
  const azRows = directory
    .split(/\r?\n/)
    .filter((line) => line.startsWith("ARIZONA,"))
    .map((line) => line.split(",")[1]);
  assert.ok(azRows.includes("SECRETARY OF STATE"), "the AZ rows were not read correctly");
  assert.equal(
    azRows.some((office) => /COUNTY|CLERK|PIMA/i.test(office ?? "")),
    false,
    "the FEC's own state directory lists no Arizona county officer or city clerk — that is why " +
      "its silence about a school-district race says nothing about the race",
  );

  assert.match(verdict.why, /jurisdiction/);
});

test("#12 the local WorkItem stays OPEN and names its exact remaining routes", () => {
  const obligation = arizonaLocalObligation(NOW);

  assert.equal(obligation.item.state, "OPEN");
  assert.equal(obligation.acquiredEvidencePaths.length, 0, "nothing of this money is acquired");

  const openIds = obligation.openRoutes.map((r) => r.declaration.routeId).sort();
  assert.deepEqual(
    openIds,
    [
      "AZ_PIMA_COUNTY_CAMPAIGN_FINANCE_PAGE",
      "AZ_PIMA_EASYVOTE_PUBLIC_FILINGS",
      "AZ_SEETHEMONEY_LIVE_BROWSER",
      "AZ_SEETHEMONEY_PLAIN_FETCH",
      "AZ_SOS_FTP_CFSDATA2",
      "EASYVOTE_TENANT_LIST",
      "PIMA_COUNTY_SCHOOL_SUPERINTENDENT",
    ],
    "every route is open — an obligation that names 'the rest' names nothing",
  );

  // Every open route carries a disposition from the governed vocabulary, and
  // none of them is a terminal one wearing an open face.
  for (const route of obligation.openRoutes) {
    assert.ok(
      ["UNWALKED", "DISCOVERED", "BLOCKED_CURRENTLY", "REQUIRES_NEW_ADAPTER"].includes(
        route.disposition,
      ),
      `${route.declaration.routeId} carries ${route.disposition}, which is not an open disposition`,
    );
    assert.ok(route.citation.length > 0, `${route.declaration.routeId} cites nothing`);
  }

  // The contract's inherited floor is the routes, not a worker's memory of them.
  assert.deepEqual(
    [...obligation.item.contract.inheritedRouteFloor].sort(),
    [...AZ_LOCAL_ROUTES.map((r) => r.declaration.routeId)].sort(),
  );
  assert.equal(obligation.item.contract.requiresCompleteDenominator, true);
});

test("#12 the recorded Arizona walls are carried verbatim, including the unwalked rung 6", () => {
  const obligation = arizonaLocalObligation(NOW);
  const byId = new Map(obligation.routes.map((r) => [r.declaration.routeId, r]));

  const spa = byId.get("AZ_SEETHEMONEY_PLAIN_FETCH");
  assert.ok(spa);
  assert.equal(spa.disposition, "BLOCKED_CURRENTLY");
  assert.equal(spa.transport, "REACHABLE", "a 200 that carries no record is REACHABLE and blocked");
  assert.match(spa.note, /SPA shell/);

  const browser = byId.get("AZ_SEETHEMONEY_LIVE_BROWSER");
  assert.ok(browser);
  assert.equal(browser.disposition, "UNWALKED");
  assert.equal(browser.rung, 6);
  assert.equal(browser.lastAttemptedOn, null, "an unwalked route has no attempt date");
  assert.equal(browser.transport, null, "an unattempted route has no transport reading");
  assert.match(browser.note, /NOT YET WALKED/);

  const tenants = byId.get("EASYVOTE_TENANT_LIST");
  assert.ok(tenants);
  assert.equal(tenants.disposition, "UNWALKED");
  assert.match(tenants.note, /UNANSWERED as of 2026-08-26/);
  assert.match(tenants.note, /AZ21/);

  // NOT VACUOUS: the source these were transcribed from still says so.
  const vocabulary = readFileSync(join(ROOT, "lib", "funding", "state-vocabulary.ts"), "utf8");
  const azBlock = vocabulary.slice(vocabulary.indexOf('state: "AZ"'), vocabulary.indexOf('state: "NJ"'));
  assert.match(azBlock, /single-page-app shell/);
  assert.match(azBlock, /rung: 6[\s\S]*?NOT YET WALKED/);

  const sources = readFileSync(join(ROOT, "states", "az", "sources.md"), "utf8");
  assert.match(sources, /Whether an EasyVote tenant list exists is UNANSWERED as of 2026-08-26/);
});

/* ══ The statute: authority level need not match office level ═════════════ */

test("a school-district contest routes to the COUNTY officer, not the Secretary of State", () => {
  const school = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "ballot-az-pima:prop-423",
    county: "Pima",
  });

  assert.equal(school.status, "RESOLVED");
  assert.equal(school.authority?.id, PIMA_COUNTY_FILING_OFFICER.id);
  assert.notEqual(
    school.authority?.id,
    AZ_SECRETARY_OF_STATE.id,
    "routing school-district money to the state portal is the portal question answering the statute question",
  );

  // THE POINT: the authority's level is COUNTY while the office's level is
  // SCHOOL_DISTRICT, and the mismatch is REPORTED rather than left to be noticed.
  assert.equal(school.officeLevel, "SCHOOL_DISTRICT");
  assert.equal(school.authorityLevel, "COUNTY");
  assert.notEqual(school.authorityLevel, school.officeLevel);
  assert.match(school.levelMismatchNote ?? "", /LEVEL MISMATCH/);
  assert.match(school.levelMismatchNote ?? "", /routes by WHICH ELECTION the money influences/);

  // The other three branches of the same statute, so the routing is a table and
  // not one special case.
  const legislative = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "LEGISLATIVE",
    contestId: "ballot-az-pima:state-senate-19",
  });
  assert.equal(legislative.authority?.id, AZ_SECRETARY_OF_STATE.id);
  assert.equal(legislative.levelMismatchNote, null, "a legislative office at the state level is no mismatch");

  const city = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "CITY_OR_TOWN",
    contestId: "fixture:tucson-council",
    municipality: "Tucson",
  });
  assert.equal(city.authority?.id, TUCSON_CITY_CLERK.id);

  const college = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "COMMUNITY_COLLEGE_DISTRICT",
    contestId: "fixture:pima-community-college",
    county: "Pima",
  });
  assert.equal(college.authorityLevel, "COUNTY", "the statute names community college districts too");

  // An unwalked county resolves OPEN and names the route — never the state
  // authority as a fallback.
  const unknownCounty = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "fixture:some-other-county",
    county: "Yavapai",
  });
  assert.equal(unknownCounty.status, "OPEN");
  assert.equal(unknownCounty.authority, null, "an unresolved custodian is null, never the state one");
  assert.ok(unknownCounty.openRoutes.length > 0, "an OPEN resolution must name what is owed");
});

test("the statute and the denominator are quoted from the state's own record, not paraphrased", () => {
  assert.equal(ARIZONA_REGIME.federated, true);
  assert.equal(ARIZONA_REGIME.filingJurisdictionCount, 109);
  assert.equal(ARIZONA_REGIME.filingJurisdictionBreakdown, "1 State, 15 County, 93 City/Town");
  assert.equal(ARIZONA_REGIME.statutorySourceUrl, "https://www.azleg.gov/ars/16/00928.htm");
  assert.equal(ARIZONA_REGIME.statutoryReadOn, "2026-08-26");

  const sources = readFileSync(join(ROOT, "states", "az", "sources.md"), "utf8");
  for (const rule of ARIZONA_REGIME.routing) {
    assert.ok(
      sources.includes(rule.quote.replace(/\s+/g, " ")) ||
        rule.quote.split(" ").every((word) => sources.includes(word)),
      `the quote for ${rule.officeLevel} is not traceable to states/az/sources.md`,
    );
  }
  assert.match(sources, /109 filing jurisdictions — 1 State, 15\s*\n?County, 93 City\/Town/);

  // The federal statutory basis is NULL, and the open question says so rather
  // than a plausible citation filling the gap.
  assert.equal(FEC_AUTHORITY.statutoryBasis, null);
  assert.match(FEC_AUTHORITY.statutoryOpenQuestion ?? "", /has NOT been read from source/);
});

/* ══ #13 — three of four fails closed for the whole contest ═══════════════ */

test("#13 finance complete for 3 of 4 candidates: named gap, and features FAIL CLOSED", () => {
  const universe = [
    "fixture:contest:a",
    "fixture:contest:b",
    "fixture:contest:c",
    "fixture:contest:d",
  ];
  const coverage = coverageFixture({
    contestId: "fixture:four-candidate-contest",
    candidateUniverse: universe,
    perCandidate: [
      fixtureCandidate({ candidacyId: "fixture:contest:a", displayName: "Candidate A" }),
      fixtureCandidate({ candidacyId: "fixture:contest:b", displayName: "Candidate B" }),
      fixtureCandidate({ candidacyId: "fixture:contest:c", displayName: "Candidate C" }),
      // The fourth: authority resolved, nothing acquired. This is a gap in OUR
      // collection and is never a statement that this candidate raised nothing.
      fixtureCandidate({
        candidacyId: "fixture:contest:d",
        displayName: "Candidate D",
        committeeIds: [],
        filingsAcquired: [],
        filingPeriodsMissing: ["2026 Q1", "2026 Q2"],
        latestThroughDate: null,
        acquisitionDepth: "AUTHORITY_RESOLVED",
      }),
    ],
  });

  const eligibility = candidateFinanceFeatureEligibility(coverage);
  assert.equal(eligibility.candidatesComplete, 3);
  assert.equal(eligibility.candidatesOwed, 4);
  assert.equal(
    eligibility.eligible,
    false,
    "three of four is not a partial display — it is an ordering, and the fourth card reads as zero",
  );
  assert.equal(eligibility.blockedBy.length, 1);
  assert.match(eligibility.blockedBy[0], /Candidate D/);
  assert.match(eligibility.blockedBy[0], /missing period\(s\): 2026 Q1, 2026 Q2/);
  assert.match(eligibility.why, /NO candidate-level finance feature is eligible for this contest/);

  const verdict = evaluateCoverage(coverage, AS_OF);
  assert.equal(verdict.status, "PARTIAL");
  assert.equal(verdict.completeAsOf, null, "PARTIAL never carries a completeness date");
  assert.equal(verdict.featureEligibility.eligible, false);

  // The gaps are NAMED and attributed to the candidate, not counted.
  const dGaps = verdict.gaps.filter((g) => g.subject === "fixture:contest:d");
  assert.ok(dGaps.length >= 3, `expected named gaps for the fourth candidate, got ${dGaps.length}`);
  assert.deepEqual(
    [...new Set(dGaps.map((g) => g.kind))].sort(),
    ["COMMITTEE_UNIDENTIFIED", "FILING_NOT_ACQUIRED"],
  );
  for (const gap of dGaps) assert.ok(gap.nextMove.length > 0, "a gap with no next move is a complaint");

  // And a candidate on the ballot with NO coverage record at all is caught too —
  // the failure mode where the denominator quietly shrinks to what we found.
  const shrunk = evaluateCoverage(
    coverageFixture({
      contestId: "fixture:denominator-shrink",
      candidateUniverse: universe,
      perCandidate: coverage.perCandidate.slice(0, 3),
    }),
    AS_OF,
  );
  assert.equal(shrunk.featureEligibility.eligible, false);
  assert.match(shrunk.featureEligibility.blockedBy.join(" "), /carrying NO coverage record at all/);

  // Four of four DOES pass — otherwise this guard would be refusing everything.
  const allFour = coverageFixture({
    contestId: "fixture:complete-contest",
    candidateUniverse: universe,
    perCandidate: universe.map((id, i) =>
      fixtureCandidate({ candidacyId: id, displayName: `Candidate ${i}` }),
    ),
  });
  const complete = evaluateCoverage(allFour, AS_OF);
  assert.equal(complete.featureEligibility.eligible, true);
  assert.equal(complete.status, "COMPLETE_AS_OF");
  assert.equal(complete.completeAsOf, AS_OF);
});

/* ══ Neutrality: symmetric acquisition across a contest ═══════════════════ */

test("unexplained asymmetric acquisition depth across two candidates FAILS symmetryCheck", () => {
  const coverage = coverageFixture({
    contestId: "fixture:asymmetric-contest",
    candidateUniverse: ["fixture:sym:incumbent", "fixture:sym:challenger"],
    perCandidate: [
      fixtureCandidate({ candidacyId: "fixture:sym:incumbent", displayName: "The Incumbent" }),
      fixtureCandidate({
        candidacyId: "fixture:sym:challenger",
        displayName: "The Challenger",
        filingsAcquired: [],
        filingPeriodsMissing: ["2026 Q1", "2026 Q2"],
        latestThroughDate: null,
        acquisitionDepth: "COMMITTEE_IDENTIFIED",
        asymmetryExplanation: null,
      }),
    ],
  });

  const report = symmetryCheck(coverage);
  assert.equal(report.verdict, "FAILURE");
  assert.ok(report.unexplained.length > 0);
  assert.deepEqual(
    [...new Set(report.unexplained.map((f) => f.dimension))].sort(),
    ["ACQUISITION_DEPTH", "COMPLETENESS"],
  );
  assert.equal(report.unexplained[0].shallower, "fixture:sym:challenger");
  assert.match(report.why, /thumb on the scale/);

  // An authority resolved for one candidate and not the other is its own failure:
  // the custodian is a property of the CONTEST.
  const halfResolved = symmetryCheck(
    coverageFixture({
      contestId: "fixture:half-resolved",
      candidateUniverse: ["fixture:sym:a", "fixture:sym:b"],
      perCandidate: [
        fixtureCandidate({ candidacyId: "fixture:sym:a", displayName: "A" }),
        fixtureCandidate({
          candidacyId: "fixture:sym:b",
          displayName: "B",
          filingAuthorityResolved: false,
        }),
      ],
    }),
  );
  assert.equal(halfResolved.verdict, "FAILURE");
  assert.ok(halfResolved.findings.some((f) => f.dimension === "AUTHORITY_DISCOVERY"));
});

test("a legitimate asymmetry WITH a source-supported explanation passes", () => {
  const explained = symmetryCheck(
    coverageFixture({
      contestId: "fixture:explained-contest",
      candidateUniverse: ["fixture:exp:a", "fixture:exp:b"],
      perCandidate: [
        fixtureCandidate({ candidacyId: "fixture:exp:a", displayName: "A" }),
        fixtureCandidate({
          candidacyId: "fixture:exp:b",
          displayName: "B",
          latestThroughDate: "2026-03-31",
          asymmetryExplanation: {
            reason:
              "This filer's most recent report on file covers through 2026-03-31; the difference is " +
              "the filers' own report periods, not how hard either candidate was hunted.",
            sourceCitation: "data/fec/fec-2026.json — totals.coverageEndDate, per filer",
            recordedOn: "2026-08-26",
          },
        }),
      ],
    }),
  );
  assert.equal(explained.verdict, "EXPLAINED_ASYMMETRY");
  assert.equal(explained.unexplained.length, 0);
  assert.ok(explained.findings.some((f) => f.dimension === "LATEST_THROUGH"));

  // An "explanation" with no source citation is not an explanation.
  const uncited = symmetryCheck(
    coverageFixture({
      contestId: "fixture:uncited-contest",
      candidateUniverse: ["fixture:unc:a", "fixture:unc:b"],
      perCandidate: [
        fixtureCandidate({ candidacyId: "fixture:unc:a", displayName: "A" }),
        fixtureCandidate({
          candidacyId: "fixture:unc:b",
          displayName: "B",
          latestThroughDate: "2026-03-31",
          asymmetryExplanation: {
            reason: "we ran out of time on this one",
            sourceCitation: "   ",
            recordedOn: "2026-08-26",
          },
        }),
      ],
    }),
  );
  assert.equal(uncited.verdict, "FAILURE");

  // One candidate is never evidence of neutrality — the report says so.
  const lonely = symmetryCheck(
    coverageFixture({
      contestId: "fixture:one-candidate",
      candidateUniverse: ["fixture:one:a"],
      perCandidate: [fixtureCandidate({ candidacyId: "fixture:one:a", displayName: "A" })],
    }),
  );
  assert.equal(lonely.verdict, "SYMMETRIC");
  assert.match(lonely.why, /absence of the question/);
});

test("the real federal contest's asymmetry is explained by the filers' own report periods", () => {
  const federal = federalObligation(NOW);
  const report = symmetryCheck(federal.coverage);
  assert.notEqual(
    report.verdict,
    "FAILURE",
    `AZ-06 must not carry an unexplained asymmetry: ${report.unexplained.map((f) => f.detail).join(" | ")}`,
  );
  // Every candidacy on the real ballot has a coverage record — the denominator
  // is the ballot, not what the snapshot happened to answer.
  assert.equal(federal.coverage.candidateUniverse.length, 4);
  assert.equal(federal.coverage.perCandidate.length, 4);
  for (const person of federal.coverage.perCandidate) {
    assert.equal(person.filingAuthorityResolved, true);
    assert.equal(person.filingAuthorityIds[0], FEC_AUTHORITY.id);
  }

  // NOT VACUOUS: the four candidacies really are the four on the committed ballot.
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "az-pima-2026.json"), "utf8"),
  ) as { candidacies: { id: string; contestId: string }[] };
  const onBallot = ballot.candidacies
    .filter((c) => c.contestId === "ballot-az-pima:us-house-6")
    .map((c) => c.id)
    .sort();
  assert.deepEqual(onBallot, [...US_HOUSE_6_CANDIDACIES.map((c) => c.candidacyId)].sort());

  // The federal obligation still does not close: Schedule E is unread.
  assert.equal(federal.item.state, "OPEN");
  const scheduleE = federal.openRoutes.find(
    (r) => r.declaration.routeId === "FEC_SCHEDULE_E_INDEPENDENT_EXPENDITURES",
  );
  assert.ok(scheduleE, "independent expenditures are unread and the obligation must say so");
  assert.equal(scheduleE.disposition, "BLOCKED_CURRENTLY");
  assert.match(scheduleE.note, /PB10\/D23/);
  assert.ok(federal.acquiredEvidencePaths.includes("data/fec/fec-2026.json"));
});

/* ══ #14 — an independent expenditure is not a receipt ════════════════════ */

const OUTSIDE_GROUP: PoliticalCommittee = {
  id: "fixture:committee:outside-group",
  registeredName: "FIXTURE OUTSIDE GROUP — NOT A REAL FILER",
  type: "INDEPENDENT_EXPENDITURE",
  aliases: [],
  registrations: [],
  authorizedByCandidacyId: null,
  sourceCitations: ["tests/control-plane-campaign-finance.test.ts — fixture, asserts nothing about the world"],
};

const CANDIDATE_COMMITTEE: PoliticalCommittee = {
  id: "fixture:committee:candidate",
  registeredName: "FIXTURE CANDIDATE COMMITTEE — NOT A REAL FILER",
  type: "CANDIDATE_AUTHORIZED",
  aliases: [],
  registrations: [],
  authorizedByCandidacyId: "fixture:candidacy:one",
  sourceCitations: ["tests/control-plane-campaign-finance.test.ts — fixture"],
};

const CONTRIBUTION: Contribution = {
  recordKind: "CONTRIBUTION",
  intoCommitteeId: CANDIDATE_COMMITTEE.id,
  amountReceived: 1_000,
  contributorNameAsFiled: "FIXTURE, DONOR",
  receivedOn: "2026-04-01",
  filingId: "fixture:filing:q2",
  sourceCitation: "fixture",
};

const CANDIDATE_FILING: CampaignFinanceFiling = {
  id: "fixture:filing:q2",
  committeeId: CANDIDATE_COMMITTEE.id,
  kind: "PERIODIC_REPORT",
  filingPeriod: { label: "2026 Q2", coversFrom: "2026-04-01", coversThrough: "2026-06-30", dueOn: null },
  filedAt: "2026-07-15",
  filingAuthorityId: "fixture:authority",
  sourceArtifactId: null,
  sourceUrl: null,
  version: 1,
  amends: null,
  amendedBy: [],
  contributions: [CONTRIBUTION],
  expenditures: [],
};

const SUPPORTING_IE: IndependentExpenditure = {
  recordKind: "INDEPENDENT_EXPENDITURE",
  bySpenderCommitteeId: OUTSIDE_GROUP.id,
  amountSpentIndependently: 250_000,
  relation: {
    stance: "SUPPORTS",
    aboutCandidacyId: "fixture:candidacy:one",
    evidenceField: "the report's own support/oppose indicator",
    sourceCitation: "fixture",
  },
  notCoordinated: true,
  spentOn: "2026-05-01",
  purposeAsFiled: "MEDIA PLACEMENT",
  reportId: "fixture:ie-report:1",
  sourceCitation: "fixture",
};

const IE_REPORT: IndependentExpenditureReport = {
  id: "fixture:ie-report:1",
  filerCommitteeId: OUTSIDE_GROUP.id,
  filingAuthorityId: "fixture:authority",
  filingPeriod: { label: "2026 pre-election", coversFrom: null, coversThrough: null, dueOn: null },
  filedAt: "2026-05-05",
  sourceArtifactId: null,
  sourceUrl: null,
  independentExpenditures: [SUPPORTING_IE],
};

test("#14 an outside group supporting a candidate is an IE + SUPPORTS, and is EXCLUDED from receipts", () => {
  // Recorded as what it is: a typed, evidenced stance toward a CANDIDACY.
  assert.equal(SUPPORTING_IE.relation.stance, "SUPPORTS");
  assert.equal(SUPPORTING_IE.relation.aboutCandidacyId, "fixture:candidacy:one");
  assert.equal(SUPPORTING_IE.notCoordinated, true);

  const received = totalReceivedBy(CANDIDATE_COMMITTEE, [CANDIDATE_FILING]);
  assert.equal(received.total, 1_000, "the candidate received 1,000 and not one cent more");
  assert.equal(received.rows, 1);

  const outside = independentSpendingAbout("fixture:candidacy:one", [IE_REPORT]);
  assert.equal(outside.supporting, 250_000);
  assert.equal(outside.opposing, 0);

  // The two numbers are reported side by side and are never one number.
  assert.notEqual(received.total, received.total + outside.supporting);

  // Money spent about the OTHER side is counted under OPPOSES, never netted.
  const opposing = independentSpendingAbout("fixture:candidacy:two", [
    {
      ...IE_REPORT,
      id: "fixture:ie-report:2",
      independentExpenditures: [
        {
          ...SUPPORTING_IE,
          reportId: "fixture:ie-report:2",
          amountSpentIndependently: 40_000,
          relation: { ...SUPPORTING_IE.relation, stance: "OPPOSES", aboutCandidacyId: "fixture:candidacy:two" },
        },
      ],
    },
  ]);
  assert.equal(opposing.opposing, 40_000);
  assert.equal(opposing.supporting, 0);
});

test("#14 an independent expenditure CANNOT be flattened into a contribution", () => {
  // STRUCTURAL: it carries neither field name a receipts aggregation keys on.
  assert.equal("intoCommitteeId" in SUPPORTING_IE, false);
  assert.equal("amountReceived" in SUPPORTING_IE, false);
  // It names no recipient committee at all — its object is a candidacy, and a
  // candidacy is not an account money can land in.
  assert.equal(
    Object.keys(SUPPORTING_IE).some((k) => /^(to|into|recipient)/i.test(k)),
    false,
    "an independent expenditure must name no recipient committee",
  );

  // CONTAINER: the IE report has no `contributions` field for it to be filed
  // into, and the committee filing has no `independentExpenditures` field.
  assert.equal("contributions" in IE_REPORT, false);
  assert.equal("independentExpenditures" in CANDIDATE_FILING, false);

  // TYPE-LEVEL: the witness is only callable while the invariant holds. If
  // `intoCommitteeId` or `amountReceived` is ever added to IndependentExpenditure,
  // `IndependentExpenditureIsNotAReceipt` resolves to `never` and this line stops
  // compiling — the guard goes red in the commit that breaks it.
  assert.equal(INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT(SUPPORTING_IE), 250_000);

  // RUNTIME: forcing one through a cast throws rather than inflating the total.
  const smuggled: CampaignFinanceFiling = {
    ...CANDIDATE_FILING,
    id: "fixture:filing:smuggled",
    contributions: [CONTRIBUTION, SUPPORTING_IE as unknown as Contribution],
  };
  assert.throws(
    () => totalReceivedBy(CANDIDATE_COMMITTEE, [smuggled]),
    (error: unknown) => {
      assert.ok(error instanceof MoneyFlattened);
      assert.equal(error.offendingKind, "INDEPENDENT_EXPENDITURE");
      assert.match(error.message, /misstates who is behind a candidate/);
      return true;
    },
    "a cast must fail loudly — a silently larger receipts total is the whole failure mode",
  );
});

/* ══ #15 — an amendment supersedes without deleting ═══════════════════════ */

test("#15 an amended filing supersedes the claim and BOTH versions stay traceable", () => {
  const original = CANDIDATE_FILING;
  const amendment: CampaignFinanceFiling = {
    ...original,
    id: "fixture:filing:q2-a1",
    version: 2,
    amends: original.id,
    amendedBy: [],
    filedAt: "2026-08-01",
    contributions: [{ ...CONTRIBUTION, amountReceived: 1_500, filingId: "fixture:filing:q2-a1" }],
  };

  const after = supersede([original], amendment);

  // NOTHING WAS DELETED. Both versions are in the set.
  assert.equal(after.length, 2);
  assert.ok(after.find((f) => f.id === original.id), "the superseded original must survive");
  assert.ok(after.find((f) => f.id === amendment.id));

  // The lineage is WALKABLE in both directions, from either end.
  const fromOriginal = lineageOf(after, original.id).map((f) => f.id);
  const fromAmendment = lineageOf(after, amendment.id).map((f) => f.id);
  assert.deepEqual(fromOriginal, [original.id, amendment.id]);
  assert.deepEqual(fromAmendment, [original.id, amendment.id], "the chain is reachable from the newest version too");
  assert.deepEqual(after.find((f) => f.id === original.id)?.amendedBy, [amendment.id]);

  // The CURRENT claim is the amendment; the earlier number is still findable.
  const current = currentVersionOf(after, original.id);
  assert.equal(current?.id, amendment.id);
  assert.equal(totalReceivedBy(CANDIDATE_COMMITTEE, [current!]).total, 1_500);
  assert.equal(
    totalReceivedBy(CANDIDATE_COMMITTEE, [after.find((f) => f.id === original.id)!]).total,
    1_000,
    "a reader who saw 1,000 last week must still be able to find where it came from",
  );

  // A second amendment extends the chain rather than replacing it.
  const second: CampaignFinanceFiling = { ...amendment, id: "fixture:filing:q2-a2", version: 3, amends: amendment.id, amendedBy: [] };
  const afterTwo = supersede(after, second);
  assert.deepEqual(lineageOf(afterTwo, original.id).map((f) => f.id), [
    original.id,
    amendment.id,
    second.id,
  ]);
  assert.equal(afterTwo.length, 3);

  // And the refusals: an amendment with no antecedent, an antecedent we do not
  // hold, and a version that moves backwards.
  assert.throws(() => supersede([original], { ...amendment, amends: null }), /names no filing it amends/);
  assert.throws(() => supersede([], amendment), /which is not in this set/);
  assert.throws(
    () => supersede([original], { ...amendment, version: 1 }),
    /moves forward or it is not an amendment/,
  );
});

/* ══ RULING 126 — nothing added here reaches Postgres ═════════════════════ */

test("nothing this domain adds introduces a Postgres table (RULING 126, wall 1)", () => {
  // The SAME mechanism tests/campaign-finance-firewall.test.ts uses, run again
  // here so this workstream's own change is the thing under test rather than a
  // guard someone else owns.
  const MONEY_WORDS =
    /(contribution|contributor|campaign_finance|campaignfinance|receipt|disbursement|committee|donor|fundrais|cash_on_hand)/i;

  const tables: { name: string; export: string; columns: string[] }[] = [];
  for (const [exportName, value] of Object.entries(schema)) {
    let config;
    try {
      config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue;
    }
    tables.push({ name: config.name, export: exportName, columns: config.columns.map((c) => c.name) });
  }

  // Not vacuous: the schema really was read.
  assert.ok(tables.length >= 8, `only ${tables.length} tables enumerated — the sweep never looked`);
  for (const expected of ["search_log", "reactions", "feedback", "intake_limiter"]) {
    assert.ok(tables.some((t) => t.name === expected), `${expected} missing — the sweep is reading the schema wrong`);
  }

  const offenders: string[] = [];
  for (const t of tables) {
    if (MONEY_WORDS.test(t.name) || MONEY_WORDS.test(t.export)) offenders.push(`table ${t.name}`);
    for (const col of t.columns) if (MONEY_WORDS.test(col)) offenders.push(`${t.name}.${col}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "the campaign-finance domain model is TYPES plus committed-JSON semantics. A table here would " +
      "put the money in the same database as the sold stores, and a join needs two tables: " +
      offenders.join(", "),
  );

  // And this workstream's own directory contains no Drizzle table definition and
  // imports nothing from lib/db — the shape that would create one.
  //
  // The file list is READ FROM THE DIRECTORY rather than named, because a named
  // list is a guard that silently stops covering the next file added beside it —
  // and `filing-regime.ts` was exactly that next file. The four known modules are
  // asserted present so a directory read that returned nothing cannot pass.
  const dir = join(ROOT, "lib", "control-plane", "campaign-finance");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  for (const known of ["model.ts", "authority.ts", "coverage.ts", "obligations.ts", "filing-regime.ts"]) {
    assert.ok(files.includes(known), `${known} was not swept — this guard is reading the wrong directory`);
  }
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    const imports = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    for (const specifier of imports) {
      assert.equal(
        /\/db\/|drizzle/.test(specifier),
        false,
        `lib/control-plane/campaign-finance/${file} imports ${specifier} — the money must not reach the database layer`,
      );
    }
    assert.equal(/\bpgTable\s*\(/.test(text), false, `${file} defines a pgTable`);
  }
});
