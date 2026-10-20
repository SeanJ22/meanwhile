/** Campaign finance: can a reader ask and get a grounded answer. Tests on ids beginning fixture: are function inputs, never claims about real filings; each seeded failure is paired with a positive control. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installFundingFixture } from "./helpers/funding-fixture.ts";

await installFundingFixture();

import {
  fecAbsenceIsNotClosure,
  resolveFilingAuthority,
  unresolvedAuthorityKeepsCoverageOpen,
} from "../lib/control-plane/campaign-finance/authority.ts";
import {
  MoneyFlattened,
  independentSpendingAbout,
  totalReceivedBy,
  type Contribution,
  type IndependentExpenditureReport,
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
  azPimaMoneyGap,
  federalHeldRecordsFor,
  federalIndependentExpenditureGap,
  federalUniverse,
} from "../lib/control-plane/campaign-finance/held-records.ts";

const ROOT = join(import.meta.dirname, "..");
const ASOF = "2026-08-29";

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

  // Committee -> money, read from the held snapshot rather than transcribed.
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
  /** spent is the FinanceAnswer union, and its independent-expenditure arm carries no reportedTotal, so the field cannot be read without narrowing. */
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

/** Does this sentence assert that no money was raised? The disclaimer tail is cut first, and only the claim it makes is tested. */
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

test("SEEDED #4 FAIL CONTROL: an unresolved authority never closes, and never falls back", () => {
  // The rule is known; the county office holding it is not.
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

});

test("WHOSE GAP: 'they filed none' and 'we have not read it' are never the same sentence", () => {
  /** A committee that reported zero itemized contributions: that is the filer's filed fact. */
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

test("LIMITS: no answer anywhere can claim to rest on a complete filing set", () => {
  const fed = federalHeldRecordsFor("ballot-az-pima:us-house-6:ciscomani-juan", "Juan Ciscomani");
  for (const u of [federalUniverse(fed), universe()]) {
    assert.equal(u.isCompleteFilingSet, false);
    assert.ok(u.sourceCitations.length > 0, "and every universe is cited");
  }
  // The federal denominator is honestly unknown.
  assert.equal(federalUniverse(fed).periodsExpected, null);
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
