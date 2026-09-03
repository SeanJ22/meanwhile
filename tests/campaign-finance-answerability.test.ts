/**
 * CAMPAIGN FINANCE — CAN A READER ACTUALLY ASK, AND GET A GROUNDED ANSWER?
 *
 * The registry proved we know WHICH PORTAL to search. That is not the product.
 * This file proves the rest of the chain, for two real obligations on one real
 * ballot, and seeds the four failures that would each silently produce a false
 * claim about a government or a candidate.
 *
 * ## Fixtures versus findings, stated once
 *
 * Tests whose ids begin with `fixture:` are INPUTS TO A FUNCTION. They assert
 * nothing about any real committee, filing or amount — and they are the only
 * way to test the independent-expenditure path at all, because **this
 * repository holds no independent-expenditure data of any kind** (tracker D51,
 * blocked behind PB10/D23). Tests that assert about the WORLD read the committed
 * artifacts: `data/fec/fec-2026.json`, `data/states/az/ballot/az-pima-2026.json` and
 * `data/states/az/campaign-finance/az-pima-2026-held.json`.
 *
 * ## Every seeded failure has a POSITIVE CONTROL
 *
 * A guard that refuses everything is not a guard, it is an outage. Each seeded
 * failure below is paired with the legitimate nearby case, and the pair is the
 * assertion: the failure must fail AND the neighbour must still work.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fecAbsenceIsNotClosure,
  resolveFilingAuthority,
  unresolvedAuthorityKeepsCoverageOpen,
} from "../lib/control-plane/campaign-finance/authority.ts";
import {
  candidateFinanceFeatureEligibility,
  evaluateCoverage,
  sideSymmetryCheck,
  symmetryCheck,
} from "../lib/control-plane/campaign-finance/coverage.ts";
import {
  MoneyFlattened,
  independentSpendingAbout,
  totalReceivedBy,
  type CampaignFinanceCoverage,
  type CandidateFinanceCoverage,
  type Contribution,
  type IndependentExpenditureReport,
  type MeasureSideCoverage,
} from "../lib/control-plane/campaign-finance/model.ts";
import {
  FINANCE_QUESTIONS,
  RECORD_KIND_FOR_QUESTION,
  RenderRefused,
  answerIndependentExpenditures,
  answerSetFor,
  answerWhatWasSpent,
  answerWhoContributed,
  attributionsDiffer,
  type AttributedGap,
  type HeldFilingUniverse,
} from "../lib/control-plane/campaign-finance/answers.ts";
import {
  AZ_PIMA_CITATION,
  azExpectedPeriods,
  azPimaCommittees,
  azPimaHeld,
  azPimaMoneyGap,
  azPimaUniverse,
  federalHeldRecordsFor,
  federalIndependentExpenditureGap,
  federalUniverse,
} from "../lib/control-plane/campaign-finance/held-records.ts";

const ROOT = join(import.meta.dirname, "..");
const ASOF = "2026-08-29";

/* ── Shared fixtures ──────────────────────────────────────────────────────── */

function universe(over?: Partial<HeldFilingUniverse>): HeldFilingUniverse {
  return {
    authorityIds: ["fixture:authority"],
    authorityNames: ["Fixture Filing Officer"],
    publisherRoute: "fixture://publisher",
    recordClassesHeld: [],
    recordClassesNotHeld: [],
    periodsExpected: null,
    periodsHeld: [],
    periodsNotHeld: [],
    coversThrough: null,
    evidenceBasis: null,
    itemizationLimit: null,
    isCompleteFilingSet: false,
    sourceCitations: ["fixture:citation"],
    ...over,
  };
}

/** One independent expenditure SUPPORTING a candidacy. Fixture — no such record exists. */
function ieReportSupporting(candidacyId: string, amount: number): IndependentExpenditureReport {
  return {
    id: "fixture:ie-report-1",
    filerCommitteeId: "fixture:outside-group",
    filingAuthorityId: "fixture:authority",
    filingPeriod: { label: "fixture period", coversFrom: null, coversThrough: null, dueOn: null },
    filedAt: null,
    sourceArtifactId: null,
    sourceUrl: null,
    independentExpenditures: [
      {
        recordKind: "INDEPENDENT_EXPENDITURE",
        bySpenderCommitteeId: "fixture:outside-group",
        amountSpentIndependently: amount,
        relation: {
          stance: "SUPPORTS",
          aboutCandidacyId: candidacyId,
          evidenceField: "fixture support/oppose indicator",
          sourceCitation: "fixture:citation",
        },
        notCoordinated: true,
        spentOn: null,
        purposeAsFiled: null,
        reportId: "fixture:ie-report-1",
        sourceCitation: "fixture:citation",
      },
    ],
  };
}

function candidate(over: Partial<CandidateFinanceCoverage> & { candidacyId: string }): CandidateFinanceCoverage {
  return {
    displayName: over.candidacyId,
    committeeIds: ["fixture:cmte"],
    filingAuthorityResolved: true,
    filingAuthorityIds: ["fixture:authority"],
    filingsAcquired: ["fixture:filing"],
    filingPeriodsExpected: ["fixture period"],
    filingPeriodsMissing: [],
    latestThroughDate: "2026-06-30",
    acquisitionDepth: "SUMMARY_TOTALS",
    openRouteIds: [],
    identityGaps: [],
    amendmentGaps: [],
    asymmetryExplanation: null,
    ...over,
  };
}

function coverage(over: Partial<CampaignFinanceCoverage>): CampaignFinanceCoverage {
  return {
    contestId: "fixture:contest",
    contestTitle: "Fixture Contest",
    electionId: "fixture:election",
    electionDate: "2026-11-03",
    jurisdictionOcdId: "ocd-division/country:us/state:az",
    officeLevel: "COUNTY",
    filingRegimeState: "RESOLVED",
    filingRegimeId: "fixture:regime",
    candidateUniverse: [],
    candidateUniverseSource: "fixture:ballot",
    committeeUniverse: [],
    expectedFilingAuthorityIds: ["fixture:authority"],
    expectedFilingPeriods: [],
    filingsAcquired: [],
    filingsMissing: [],
    latestThroughDate: null,
    perCandidate: [],
    routes: [],
    identityGaps: [],
    amendmentGaps: [],
    status: "OPEN",
    completeAsOf: null,
    ...over,
  };
}

function side(over: Partial<MeasureSideCoverage> & { side: "SUPPORT" | "OPPOSE" }): MeasureSideCoverage {
  return {
    committeeIds: ["fixture:cmte"],
    committeeUniverseSource: "fixture:register",
    filingAuthorityResolved: true,
    filingAuthorityIds: ["fixture:authority"],
    filingsAcquired: ["fixture:filing"],
    acquisitionDepth: "SUMMARY_TOTALS",
    latestThroughDate: "2026-06-30",
    openRouteIds: [],
    asymmetryExplanation: null,
    ...over,
  };
}

/* ══ THE FEDERAL PROVING OBLIGATION ═══════════════════════════════════════════
 *
 * ballot-az-pima:us-house-6 -> US federal regime -> Federal Election Commission
 * -> api.open.fec.gov, committed as data/fec/fec-2026.json -> the four certified
 * candidacies' principal committees -> itemized receipts and reported totals.
 */

test("FEDERAL CHAIN: the ballot's four candidacies resolve to the FEC and carry real held records", () => {
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
  ) as { candidacies: { id: string; contestId: string; familyName: string }[] };

  // The DENOMINATOR comes from the ballot, never from what we found.
  const universeIds = ballot.candidacies
    .filter((c) => c.contestId === "ballot-az-pima:us-house-6")
    .map((c) => c.id);
  assert.equal(universeIds.length, 4, "the certified AZ-06 candidate universe");

  const resolution = resolveFilingAuthority({
    jurisdiction: "US",
    officeLevel: "FEDERAL",
    contestId: "ballot-az-pima:us-house-6",
  });
  assert.equal(resolution.status, "RESOLVED");
  assert.equal(resolution.authority?.id, "us:federal:fec");

  // Committee -> money, read from the committed snapshot rather than transcribed.
  const ciscomani = federalHeldRecordsFor(
    "ballot-az-pima:us-house-6:ciscomani-juan",
    "Juan Ciscomani",
  );
  assert.equal(ciscomani.committee?.id, "C00786194", "principal committee id");
  assert.ok(ciscomani.contributions.length > 0, "itemized receipts held");
  assert.ok((ciscomani.aggregate?.reportedReceipts ?? 0) > 0, "reported receipts held");

  // Every contribution is a CONTRIBUTION, into that committee, with a citation.
  for (const row of ciscomani.contributions) {
    assert.equal(row.recordKind, "CONTRIBUTION");
    assert.equal(row.intoCommitteeId, "C00786194");
    assert.ok(row.sourceCitation.includes("data/fec/fec-2026.json"));
  }
});

test("FEDERAL: the FEC totals are an AUTHORITY AGGREGATE and never claim to be a filing", () => {
  const r = federalHeldRecordsFor("ballot-az-pima:us-house-6:mendoza-joanna", "JoAnna Mendoza");
  assert.equal(r.aggregate?.recordKind, "AUTHORITY_AGGREGATE");
  assert.equal(r.aggregate?.isCompleteFilingSet, false);
  assert.equal(r.aggregate?.aggregatedAcrossFilings, null, "the FEC does not publish this count");
  assert.ok(r.aggregate?.id.startsWith("fec-aggregate:"), "id cannot be mistaken for a filing id");
  assert.equal(federalUniverse(r).evidenceBasis, "AUTHORITY_AGGREGATE");
  // Every contribution row points at the aggregate, not at an invented report.
  for (const row of r.contributions) assert.ok(row.filingId.startsWith("fec-aggregate:"));
});

test("FEDERAL: all three reader questions are addressed for a real candidacy", () => {
  const r = federalHeldRecordsFor("ballot-az-pima:us-house-6:ciscomani-juan", "Juan Ciscomani");
  const u = federalUniverse(r);
  const agg = r.aggregate;
  assert.ok(agg !== null);

  const who = answerWhoContributed({
    subjectId: r.candidacyId,
    subjectDisplayName: r.displayName,
    contributions: r.contributions,
    reportedTotal: {
      amount: agg.reportedItemizedReceipts ?? 0,
      label: "itemized individual contributions",
      basis: "the FEC's own committee totals for the cycle",
      sourceCitation: "data/fec/fec-2026.json",
    },
    universe: u,
  });
  assert.equal(who.question, "WHO_CONTRIBUTED");
  assert.ok(who.records.length > 0);
  // The ten rows are NOT the donors, and the answer says so both ways.
  assert.ok(u.itemizationLimit?.includes("not the complete itemized list"));
  assert.ok(who.gaps.some((g) => g.attribution === "OURS"), "the rows-vs-total gap is ours");

  const spent = answerWhatWasSpent({
    subjectId: r.candidacyId,
    subjectDisplayName: r.displayName,
    expenditures: r.expenditures,
    reportedTotal: {
      amount: agg.reportedDisbursements ?? 0,
      label: "total disbursements",
      basis: "the FEC's own committee totals for the cycle",
      sourceCitation: "data/fec/fec-2026.json",
    },
    universe: u,
  });
  /**
   * THE NARROWING IS THE PROOF.
   *
   * `spent` is typed as the `FinanceAnswer` UNION, and the union's
   * independent-expenditure arm carries no `reportedTotal` — so reading that
   * field without first narrowing on `question` does not compile. That is the
   * invariant enforcing itself on this very test: an outside group's spending
   * has no "total received" for a caller to reach for.
   */
  assert.equal(spent.question, "WHAT_WAS_SPENT");
  if (spent.question !== "WHAT_WAS_SPENT") throw new Error("unreachable");
  assert.ok((spent.reportedTotal?.amount ?? 0) > 0, "the spending question IS answerable");
  assert.equal(spent.records.length, 0, "and the itemized rows behind it are not held");

  const ies = answerIndependentExpenditures({
    subjectId: r.candidacyId,
    subjectDisplayName: r.displayName,
    reports: r.independentExpenditureReports,
    universe: u,
    gaps: [federalIndependentExpenditureGap(r.candidacyId) as AttributedGap],
  });
  assert.equal(ies.records.length, 0);
  assert.ok(ies.gaps.some((g) => g.attribution === "THE_LAW"), "our blocker, not the FEC's silence");

  const set = answerSetFor([who, spent, ies]);
  assert.equal(set.everyQuestionAddressed, true);
  assert.equal(set.attributionsDistinct, true);
});

/* ══ THE LOCAL ARIZONA PROVING OBLIGATION ═════════════════════════════════════
 *
 * ballot-az-pima:prop-423 (Vail Unified School District No. 20 budget override)
 * -> A.R.S. § 16-928 -> the PIMA COUNTY OFFICER IN CHARGE OF ELECTIONS, whose
 * portal publishes under the name "Pima County Elections" -> EasyVote
 * (ecf-api.easyvoteapp.com) -> 138 filers / 680 filings, of which 5 committees
 * and 31 filings are the Vail district's -> AND NO MONEY AT ALL.
 */

test("LOCAL AZ CHAIN: a school-district measure routes to the COUNTY officer, not the state and not the FEC", () => {
  const resolution = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "ballot-az-pima:prop-423",
    county: "Pima",
  });
  assert.equal(resolution.status, "RESOLVED");
  assert.equal(resolution.authority?.id, "az:county:pima:officer-in-charge-of-elections");

  // THE LEVEL MISMATCH IS THE FINDING: a SCHOOL_DISTRICT office, a COUNTY custodian.
  assert.equal(resolution.officeLevel, "SCHOOL_DISTRICT");
  assert.equal(resolution.authorityLevel, "COUNTY");
  assert.notEqual(resolution.levelMismatchNote, null);
  assert.notEqual(resolution.authority?.id, "us:federal:fec");
  assert.notEqual(resolution.authority?.id, "az:state:secretary-of-state");
});

test("LOCAL AZ: real committees and real filings were acquired from the county filing officer", () => {
  const held = azPimaHeld();
  assert.equal(held.filingAuthorityIdentification.officeNameAsPublished, "Pima County Elections");
  assert.ok(held.filingAuthorityIdentification.readFrom.startsWith("https://ecf-api.easyvoteapp.com"));

  const committees = azPimaCommittees();
  assert.equal(committees.length, 5, "the five Vail-district committees in the county register");
  const cove = committees.find((c) => c.registeredName === "Citizens of Vail for Education");
  assert.ok(cove, "a real registered committee");
  assert.equal(cove.type, "PAC");
  // Identity is RECORDED, never asserted: the portal gives no candidacy id.
  assert.equal(cove.authorizedByCandidacyId, null);

  assert.equal(held.filingsIndexed.length, 31, "filings indexed for those committees");
  assert.ok(
    held.filingsIndexed.some((f) => f.documentName.includes("2026 July Pre-Election Report")),
    "a real 2026 filing",
  );
});

test("LOCAL AZ: the acquisition holds NO money, and every money answer says so as OUR gap", () => {
  const held = azPimaHeld();
  // Structural: no amount field exists anywhere in the committed local record.
  const raw = JSON.stringify(held);
  assert.ok(!/"amountReceived"|"amountSpent"|"amountSpentIndependently"/.test(raw));
  assert.ok(held.notHeld.length >= 4, "and what is not held is NAMED, not counted");

  const u = azPimaUniverse(ASOF);
  const gap = azPimaMoneyGap("ballot-az-pima:prop-423#SUPPORT") as AttributedGap;

  const who = answerWhoContributed({
    subjectId: "ballot-az-pima:prop-423#SUPPORT",
    subjectDisplayName: "the yes side of Proposition 423",
    contributions: [],
    universe: u,
    gaps: [gap],
  });
  assert.equal(who.records.length, 0);
  assert.ok(who.gaps.every((g) => g.attribution === "OURS"));
  // The reader sentence must NEVER assert absence about the government.
  for (const g of who.gaps) {
    assert.equal(assertsAbsence(g.readerSentence), false, g.readerSentence);
    assert.match(g.readerSentence, /gap in our records|not been able to read/i);
  }
});

/**
 * Does this sentence ASSERT that no money was raised?
 *
 * Naive substring matching cannot answer that, and getting this wrong the first
 * time is instructive: the honest sentence *"that is a gap in our records, not a
 * statement that no money was raised"* contains the forbidden phrase and is the
 * exact sentence the rule wants. The phrase is not the defect; asserting it is.
 *
 * So the DISCLAIMER TAIL is cut first — everything from an explicit negation
 * marker onward — and only the HEAD, which is the claim the sentence actually
 * makes, is tested.
 */
function assertsAbsence(sentence: string): boolean {
  const head = sentence.split(
    /not a statement that|not a sign that|rather than a finding|not a finding|is not a statement/i,
  )[0];
  return /no money was raised|raised nothing|none was raised|did not raise|there are no contributions/i.test(
    head,
  );
}

test("WHOSE GAP: the absence-assertion detector actually detects one", () => {
  // The guard must catch a real assertion...
  assert.equal(assertsAbsence("This committee raised nothing in this period."), true);
  assert.equal(assertsAbsence("No money was raised for the yes side."), true);
  // ...and must NOT flag the honest disclaimer that names the same words.
  assert.equal(
    assertsAbsence(
      "We have not recorded any contributions yet. That is a gap in our records, not a statement " +
        "that no money was raised.",
    ),
    false,
  );
});

test("LOCAL AZ: the expected-period DENOMINATOR is now real, and open periods are not counted as missing", () => {
  const periods = azExpectedPeriods(ASOF);
  assert.equal(periods.all.length, 10, "the AZ 2026 PAC/Party reporting calendar");
  assert.ok(periods.due.length > 0 && periods.due.length < periods.all.length);
  // A period still open for filing is not a missing report.
  assert.ok(periods.notYetDue.includes("Pre-General Election"));
  assert.ok(periods.due.includes("Quarter 2"));
  assert.ok(periods.sourceCitation.includes("ReportingPeriods.txt"));
  assert.equal(azPimaUniverse(ASOF).periodsHeld.length, 0, "and we hold none of them");
});

/* ══ SEEDED FAILURE 1 — FEC ABSENCE MUST NOT CLOSE A NON-FEDERAL RACE ═════════ */

test("SEEDED #1 FAIL CONTROL: no argument to fecAbsenceIsNotClosure closes a local contest", () => {
  for (const input of [
    { jurisdiction: "AZ", officeLevel: "SCHOOL_DISTRICT" as const, county: "Pima" },
    { jurisdiction: "AZ", officeLevel: "COUNTY" as const, county: "Pima" },
    // A county the registry has NOT walked: the rule is known, the office is not.
    { jurisdiction: "AZ", officeLevel: "SCHOOL_DISTRICT" as const, county: "Yavapai" },
    // A jurisdiction whose statute this repository has never read at all.
    { jurisdiction: "WY", officeLevel: "CITY_OR_TOWN" as const, county: null },
  ]) {
    const verdict = fecAbsenceIsNotClosure({
      contestId: "ballot-az-pima:prop-423",
      jurisdiction: input.jurisdiction,
      officeLevel: input.officeLevel,
      county: input.county,
    });
    assert.equal(verdict.coverageState, "OPEN", `${input.jurisdiction}/${input.officeLevel}`);
    assert.equal(verdict.closesTheContest, false);
    assert.ok(verdict.owedRoutes.length > 0, "and the owed routes are NAMED");
    assert.match(verdict.why, /Absence is never asserted/);
  }
});

test("SEEDED #1 POSITIVE CONTROL: the FEC is still the right answer for the federal contest", () => {
  const resolution = resolveFilingAuthority({
    jurisdiction: "US",
    officeLevel: "FEDERAL",
    contestId: "ballot-az-pima:us-house-6",
  });
  assert.equal(resolution.status, "RESOLVED");
  assert.equal(resolution.authority?.id, "us:federal:fec");
  // And the legitimate federal case really does yield money.
  const r = federalHeldRecordsFor("ballot-az-pima:us-house-6:mendoza-joanna", "JoAnna Mendoza");
  assert.ok(r.contributions.length > 0);
  assert.ok((r.aggregate?.reportedDisbursements ?? 0) > 0);
});

/* ══ SEEDED FAILURE 2 — AN IE SUPPORTING A CANDIDATE IS NOT MONEY RECEIVED ════ */

test("SEEDED #2 FAIL CONTROL: an IE cast into the receipts render is REFUSED, not summed", () => {
  const report = ieReportSupporting("fixture:candidacy", 250_000);
  const ie = report.independentExpenditures[0];

  // (a) The RENDER refuses it.
  assert.throws(
    () =>
      answerWhoContributed({
        subjectId: "fixture:candidacy",
        subjectDisplayName: "Fixture Candidate",
        // The cast is the seeded failure: this is what a careless adapter does.
        contributions: [ie as unknown as Contribution],
        universe: universe(),
      }),
    (err: unknown) => {
      assert.ok(err instanceof RenderRefused);
      assert.equal(err.offendingKind, "INDEPENDENT_EXPENDITURE");
      return true;
    },
  );

  // (b) The AGGREGATION refuses it too — two independent guards, not one.
  assert.throws(
    () =>
      totalReceivedBy({ id: "fixture:cmte" }, [
        {
          id: "fixture:filing",
          committeeId: "fixture:cmte",
          kind: "PERIODIC_REPORT",
          filingPeriod: { label: "f", coversFrom: null, coversThrough: null, dueOn: null },
          filedAt: null,
          filingAuthorityId: "fixture:authority",
          sourceArtifactId: null,
          sourceUrl: null,
          version: 1,
          amends: null,
          amendedBy: [],
          contributions: [ie as unknown as Contribution],
          expenditures: [],
        },
      ]),
    MoneyFlattened,
  );
});

test("SEEDED #2 POSITIVE CONTROL: the same IE renders correctly as outside spending", () => {
  const report = ieReportSupporting("fixture:candidacy", 250_000);
  const answer = answerIndependentExpenditures({
    subjectId: "fixture:candidacy",
    subjectDisplayName: "Fixture Candidate",
    reports: [report],
    universe: universe({ recordClassesHeld: ["INDEPENDENT_EXPENDITURE_REPORT"] }),
  });
  assert.equal(answer.question, "INDEPENDENT_EXPENDITURES");
  assert.equal(answer.records.length, 1);
  assert.equal(answer.supporting, 250_000);
  assert.equal(answer.opposing, 0);
  // The number exists and is explicitly NOT the candidate's money.
  assert.equal(answer.isMoneyReceivedByTheSubject, false);
  assert.match(answer.readerSentence, /None of it was received by/);

  // And the separate accounting function agrees, without ever combining them.
  const totals = independentSpendingAbout("fixture:candidacy", [report]);
  assert.equal(totals.supporting, 250_000);

  // Real contributions still render fine beside it — the guard is not an outage.
  const real = federalHeldRecordsFor("ballot-az-pima:us-house-6:ciscomani-juan", "Juan Ciscomani");
  const who = answerWhoContributed({
    subjectId: real.candidacyId,
    subjectDisplayName: real.displayName,
    contributions: real.contributions,
    universe: federalUniverse(real),
  });
  assert.equal(who.records.length, real.contributions.length);
  assert.ok(who.records.every((r) => r.recordKind === "CONTRIBUTION"));
});

test("SEEDED #2: the three questions cannot share a record kind", () => {
  const kinds = FINANCE_QUESTIONS.map((q) => RECORD_KIND_FOR_QUESTION[q]);
  assert.equal(new Set(kinds).size, 3, "three questions, three distinct facts");
});

/* ══ SEEDED FAILURE 3 — SYMMETRY IS MECHANICAL, FOR CANDIDATES AND FOR SIDES ══ */

test("SEEDED #3 FAIL CONTROL (measure sides): one side hunted, the other not, is a FAILURE", () => {
  const oneSided = coverage({
    contestId: "fixture:prop",
    measureSides: [
      side({ side: "SUPPORT" }),
      side({
        side: "OPPOSE",
        committeeIds: [],
        committeeUniverseSource: null,
        filingsAcquired: [],
        acquisitionDepth: "NONE",
        latestThroughDate: null,
      }),
    ],
  });

  const sides = sideSymmetryCheck(oneSided);
  assert.equal(sides.verdict, "FAILURE");
  assert.ok(sides.unexplained.some((f) => f.dimension === "COMMITTEE_UNIVERSE_SOURCE"));
  assert.ok(sides.unexplained.some((f) => f.dimension === "ACQUISITION_DEPTH"));

  /**
   * AND THE PROOF THAT THIS CHECK WAS NEEDED: the pre-existing candidate sweep
   * calls the very same record SYMMETRIC, because a measure has no candidates
   * for it to compare. The guard was counting the wrong noun.
   */
  assert.equal(symmetryCheck(oneSided).verdict, "SYMMETRIC");

  // The contest-level evaluator must not let it through either.
  const verdict = evaluateCoverage(oneSided, ASOF);
  assert.equal(verdict.sideSymmetry.verdict, "FAILURE");
  assert.notEqual(verdict.status, "COMPLETE_AS_OF");
  assert.ok(verdict.gaps.some((g) => g.kind === "MEASURE_SIDE_UNCOVERED"));
});

test("SEEDED #3 FAIL CONTROL (unasked sides): a measure with no side record at all is a FAILURE", () => {
  const unasked = coverage({ contestId: "fixture:prop-unasked" });
  const sides = sideSymmetryCheck(unasked);
  assert.equal(sides.verdict, "FAILURE");
  assert.equal(sides.findings.length, 2, "both sides unasked");
  assert.ok(sides.findings.every((f) => f.dimension === "MEASURE_SIDE_ABSENT"));
  // An unasked question is not a symmetric answer, and cannot be explained away.
  assert.ok(sides.findings.every((f) => f.explainedBy === null));
});

test("SEEDED #3 FAIL CONTROL (candidates): three of four covered blocks the WHOLE contest", () => {
  const threeOfFour = coverage({
    candidateUniverse: ["a", "b", "c", "d"],
    perCandidate: [candidate({ candidacyId: "a" }), candidate({ candidacyId: "b" }), candidate({ candidacyId: "c" })],
  });
  assert.equal(symmetryCheck(threeOfFour).verdict, "FAILURE");
  const eligibility = candidateFinanceFeatureEligibility(threeOfFour);
  assert.equal(eligibility.eligible, false, "not for the three either");
  assert.equal(eligibility.candidatesComplete, 3);
  assert.equal(eligibility.candidatesOwed, 4);
});

test("SEEDED #3 POSITIVE CONTROL: equal sides pass, a SOURCED asymmetry passes, a candidate contest is untouched", () => {
  // (a) Both sides covered the same way.
  const even = coverage({
    contestId: "fixture:prop-even",
    measureSides: [side({ side: "SUPPORT" }), side({ side: "OPPOSE" })],
  });
  assert.equal(sideSymmetryCheck(even).verdict, "SYMMETRIC");

  // (b) A REAL difference in the filings, with a source. Not a failure.
  const explained = coverage({
    contestId: "fixture:prop-explained",
    measureSides: [
      side({ side: "SUPPORT" }),
      side({
        side: "OPPOSE",
        committeeIds: [],
        filingsAcquired: [],
        acquisitionDepth: "AUTHORITY_RESOLVED",
        asymmetryExplanation: {
          reason:
            "The county register was read in full for both sides and no committee has registered " +
            "in opposition to this question.",
          sourceCitation: AZ_PIMA_CITATION,
          recordedOn: ASOF,
        },
      }),
    ],
  });
  assert.equal(sideSymmetryCheck(explained).verdict, "EXPLAINED_ASYMMETRY");

  // (c) NO FALSE POSITIVE on a candidate contest — the side unit does not apply.
  const candidates = coverage({
    candidateUniverse: ["a", "b"],
    perCandidate: [candidate({ candidacyId: "a" }), candidate({ candidacyId: "b" })],
  });
  const sides = sideSymmetryCheck(candidates);
  assert.equal(sides.verdict, "SYMMETRIC");
  assert.equal(sides.findings.length, 0);
  assert.match(sides.why, /candidate contest/);
});

/* ══ SEEDED FAILURE 4 — AN UNRESOLVED AUTHORITY KEEPS COVERAGE OPEN ══════════ */

test("SEEDED #4 FAIL CONTROL: an unresolved authority never closes, and never falls back", () => {
  // The rule is known (A.R.S. § 16-928); the Yavapai office holding it is not.
  const open = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "fixture:contest",
    county: "Yavapai",
  });
  assert.equal(open.status, "OPEN");
  assert.equal(open.authority, null, "no custodian is guessed");
  assert.ok(open.custodianRole !== null, "but the ROLE the statute names is still reported");
  assert.ok(open.openRoutes.length > 0);

  // A jurisdiction whose rule has never been read at all.
  const unread = resolveFilingAuthority({
    jurisdiction: "WY",
    officeLevel: "CITY_OR_TOWN",
    contestId: "fixture:contest",
  });
  assert.equal(unread.status, "NO_REGIME_ON_RECORD");
  assert.equal(unread.authority, null, "and it does NOT fall back to the FEC or to a state");

  for (const resolution of [open, unread]) {
    const verdict = unresolvedAuthorityKeepsCoverageOpen({
      contestId: "fixture:contest",
      resolution,
    });
    assert.equal(verdict.coverageState, "OPEN");
    assert.equal(verdict.closesTheContest, false);
    assert.match(verdict.why, /about what this repository has read|closes nothing/);
  }

  // And the evaluator cannot reach completion on an unresolved regime.
  const unresolvedCoverage = coverage({
    filingRegimeState: "NO_REGIME_ON_RECORD",
    filingRegimeId: null,
    candidateUniverse: ["a"],
    perCandidate: [candidate({ candidacyId: "a" })],
  });
  const verdict = evaluateCoverage(unresolvedCoverage, ASOF);
  assert.notEqual(verdict.status, "COMPLETE_AS_OF");
  assert.ok(verdict.gaps.some((g) => g.kind === "FILING_REGIME_UNRESOLVED"));
  assert.equal(verdict.featureEligibility.eligible, false);
});

test("SEEDED #4 POSITIVE CONTROL: a resolved regime with no gaps DOES reach COMPLETE_AS_OF", () => {
  const complete = coverage({
    contestId: "fixture:complete",
    candidateUniverse: ["a", "b"],
    perCandidate: [candidate({ candidacyId: "a" }), candidate({ candidacyId: "b" })],
  });
  const verdict = evaluateCoverage(complete, ASOF);
  assert.deepEqual(verdict.gaps, [], "the gate is not simply always-closed");
  assert.equal(verdict.status, "COMPLETE_AS_OF");
  assert.equal(verdict.completeAsOf, ASOF);
  assert.equal(verdict.featureEligibility.eligible, true);
  assert.equal(verdict.sideSymmetry.verdict, "SYMMETRIC");
});

/* ══ WHOSE GAP IS IT? ════════════════════════════════════════════════════════ */

test("WHOSE GAP: 'they filed none' and 'we have not read it' are never the same sentence", () => {
  /**
   * Iman Bah's committee reported ZERO itemized individual contributions for the
   * 2026 cycle. Nobody is missing anything — that is THE FILER's filed fact, and
   * it is read from the snapshot rather than asserted here.
   */
  const bah = federalHeldRecordsFor("ballot-az-pima:us-house-6:bah-iman", "Iman Bah");
  assert.equal(bah.contributions.length, 0);
  assert.equal(bah.aggregate?.reportedItemizedReceipts, 0, "the filer reported zero itemized");
  assert.ok((bah.aggregate?.reportedReceipts ?? 0) > 0, "while reporting non-zero total receipts");

  const filerGap: AttributedGap = {
    attribution: "THE_FILER",
    subject: bah.candidacyId,
    what: "the committee reported $0 in itemized individual contributions for this period",
    nextMove: "Nothing is owed. This is what the filer filed.",
    readerSentence:
      "This committee reported no itemized contributions for this period. Contributions under the " +
      "reporting threshold are not itemized by name.",
  };
  const ourGap = azPimaMoneyGap("ballot-az-pima:prop-423") as AttributedGap;

  assert.notEqual(filerGap.readerSentence, ourGap.readerSentence);
  assert.equal(attributionsDiffer([filerGap, ourGap]), true);

  // The seeded collapse: the same sentence used for both owners.
  const collapsed: AttributedGap[] = [
    filerGap,
    { ...ourGap, readerSentence: filerGap.readerSentence },
  ];
  assert.equal(attributionsDiffer(collapsed), false, "the collapse must be detectable");
});

/* ══ COVERAGE LIMITS ═════════════════════════════════════════════════════════ */

test("LIMITS: no answer anywhere can claim to rest on a complete filing set", () => {
  const fed = federalHeldRecordsFor("ballot-az-pima:us-house-6:ciscomani-juan", "Juan Ciscomani");
  for (const u of [federalUniverse(fed), azPimaUniverse(ASOF), universe()]) {
    assert.equal(u.isCompleteFilingSet, false);
    assert.ok(u.sourceCitations.length > 0, "and every universe is cited");
  }
  // The federal denominator is honestly unknown; the Arizona one is now real.
  assert.equal(federalUniverse(fed).periodsExpected, null);
  assert.notEqual(azPimaUniverse(ASOF).periodsExpected, null);
});

test("LIMITS: an answer with no source citation is refused outright", () => {
  assert.throws(
    () =>
      answerWhoContributed({
        subjectId: "fixture:x",
        subjectDisplayName: "X",
        contributions: [],
        universe: universe({ sourceCitations: [] }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof RenderRefused);
      assert.equal(err.offendingKind, "UNCITED");
      return true;
    },
  );
});
