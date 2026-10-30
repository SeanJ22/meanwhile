import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT,
  MoneyFlattened,
  currentVersionOf,
  independentSpendingAbout,
  lineageOf,
  supersede,
  totalReceivedBy,
  type CampaignFinanceFiling,
  type Contribution,
  type IndependentExpenditure,
  type IndependentExpenditureReport,
  type PoliticalCommittee,
} from "../lib/control-plane/campaign-finance/model.ts";

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

test("an outside group supporting a candidate is an IE + SUPPORTS, and is EXCLUDED from receipts", () => {
  assert.equal(SUPPORTING_IE.relation.stance, "SUPPORTS");
  assert.equal(SUPPORTING_IE.relation.aboutCandidacyId, "fixture:candidacy:one");
  assert.equal(SUPPORTING_IE.notCoordinated, true);

  const received = totalReceivedBy(CANDIDATE_COMMITTEE, [CANDIDATE_FILING]);
  assert.equal(received.total, 1_000, "the candidate received 1,000 and not one cent more");
  assert.equal(received.rows, 1);

  const outside = independentSpendingAbout("fixture:candidacy:one", [IE_REPORT]);
  assert.equal(outside.supporting, 250_000);
  assert.equal(outside.opposing, 0);

  assert.notEqual(received.total, received.total + outside.supporting);

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

test("an independent expenditure CANNOT be flattened into a contribution", () => {
  assert.equal("intoCommitteeId" in SUPPORTING_IE, false);
  assert.equal("amountReceived" in SUPPORTING_IE, false);
  assert.equal(
    Object.keys(SUPPORTING_IE).some((k) => /^(to|into|recipient)/i.test(k)),
    false,
    "an independent expenditure must name no recipient committee",
  );

  assert.equal("contributions" in IE_REPORT, false);
  assert.equal("independentExpenditures" in CANDIDATE_FILING, false);

  assert.equal(INDEPENDENT_EXPENDITURE_IS_NOT_A_RECEIPT(SUPPORTING_IE), 250_000);

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

test("an amended filing supersedes the claim and BOTH versions stay traceable", () => {
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

  assert.equal(after.length, 2);
  assert.ok(after.find((f) => f.id === original.id), "the superseded original must survive");
  assert.ok(after.find((f) => f.id === amendment.id));

  const fromOriginal = lineageOf(after, original.id).map((f) => f.id);
  const fromAmendment = lineageOf(after, amendment.id).map((f) => f.id);
  assert.deepEqual(fromOriginal, [original.id, amendment.id]);
  assert.deepEqual(fromAmendment, [original.id, amendment.id], "the chain is reachable from the newest version too");
  assert.deepEqual(after.find((f) => f.id === original.id)?.amendedBy, [amendment.id]);

  const current = currentVersionOf(after, original.id);
  assert.equal(current?.id, amendment.id);
  assert.equal(totalReceivedBy(CANDIDATE_COMMITTEE, [current!]).total, 1_500);
  assert.equal(
    totalReceivedBy(CANDIDATE_COMMITTEE, [after.find((f) => f.id === original.id)!]).total,
    1_000,
    "a reader who saw 1,000 last week must still be able to find where it came from",
  );

  const second: CampaignFinanceFiling = { ...amendment, id: "fixture:filing:q2-a2", version: 3, amends: amendment.id, amendedBy: [] };
  const afterTwo = supersede(after, second);
  assert.deepEqual(lineageOf(afterTwo, original.id).map((f) => f.id), [
    original.id,
    amendment.id,
    second.id,
  ]);
  assert.equal(afterTwo.length, 3);

  assert.throws(() => supersede([original], { ...amendment, amends: null }), /names no filing it amends/);
  assert.throws(() => supersede([], amendment), /which is not in this set/);
  assert.throws(
    () => supersede([original], { ...amendment, version: 1 }),
    /moves forward or it is not an amendment/,
  );
});
