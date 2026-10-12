import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCsv } from "../lib/reference/index.ts";

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
import {
  AZ_LOCAL_ROUTES,
  arizonaLocalObligation,
} from "../lib/control-plane/campaign-finance/obligations.ts";
import { installFundingFirstSeed } from "./helpers/registry-runtime-first-seed.ts";

await installFundingFirstSeed();

const ROOT = resolve(import.meta.dirname, "..");
const NOW = "2026-08-28T00:00:00.000Z";



test("FEC absence does NOT close a local race, and the statute finds the custodian", () => {
  const verdict = fecAbsenceIsNotClosure({
    contestId: "ballot-az-pima:prop-423",
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    county: "Pima",
  });

  assert.equal(verdict.coverageState, "OPEN");
  assert.equal(verdict.closesTheContest, false);

  assert.equal(verdict.resolution.status, "RESOLVED");
  assert.equal(verdict.resolution.authority?.id, PIMA_COUNTY_FILING_OFFICER.id);
  assert.equal(verdict.resolution.statutoryBasis, "A.R.S. § 16-928");
  assert.match(
    verdict.resolution.statutoryQuote ?? "",
    /county officer in charge of elections is the filing officer for county, school district/,
  );

  const boundary = verdict.owedRoutes.find(
    (r) => r.declaration.routeId === "FEC_JURISDICTION_BOUNDARY",
  );
  assert.ok(boundary, "the verdict must name WHY federal silence is not evidence");
  assert.equal(boundary.disposition, "NOT_APPLICABLE");
  assert.match(boundary.citation, /fec_combined_federal_state_disclosure_directory\.csv/);

  const directory = readFileSync(
    join(ROOT, "data", "reference", "fec_combined_federal_state_disclosure_directory.csv"),
    "utf8",
  );
  const azRows = parseCsv(directory)
    .filter(([jurisdiction]) => jurisdiction === "ARIZONA")
    .map(([, office]) => office);
  assert.ok(azRows.includes("SECRETARY OF STATE"), "the AZ rows were not read correctly");
  assert.equal(
    azRows.some((office) => /COUNTY|CLERK|PIMA/i.test(office ?? "")),
    false,
    "the FEC's own state directory lists no Arizona county officer or city clerk — that is why " +
      "its silence about a school-district race says nothing about the race",
  );

  assert.match(verdict.why, /jurisdiction/);
});

test("the local WorkItem stays OPEN and names its exact remaining routes", () => {
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

  for (const route of obligation.openRoutes) {
    assert.ok(
      ["UNWALKED", "DISCOVERED", "BLOCKED_CURRENTLY", "REQUIRES_NEW_ADAPTER"].includes(
        route.disposition,
      ),
      `${route.declaration.routeId} carries ${route.disposition}, which is not an open disposition`,
    );
    assert.ok(route.citation.length > 0, `${route.declaration.routeId} cites nothing`);
  }

  assert.deepEqual(
    [...obligation.item.contract.inheritedRouteFloor].sort(),
    [...AZ_LOCAL_ROUTES.map((r) => r.declaration.routeId)].sort(),
  );
  assert.equal(obligation.item.contract.requiresCompleteDenominator, true);
});

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

  assert.equal(school.officeLevel, "SCHOOL_DISTRICT");
  assert.equal(school.authorityLevel, "COUNTY");
  assert.notEqual(school.authorityLevel, school.officeLevel);
  assert.match(school.levelMismatchNote ?? "", /LEVEL MISMATCH/);
  assert.match(school.levelMismatchNote ?? "", /routes by WHICH ELECTION the money influences/);

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

  assert.equal(FEC_AUTHORITY.statutoryBasis, null);
  assert.match(FEC_AUTHORITY.statutoryOpenQuestion ?? "", /has NOT been read from source/);
});

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

  // TYPE-LEVEL: the witness is only callable while the invariant holds. If
  // `intoCommitteeId` or `amountReceived` is ever added to IndependentExpenditure,
  // `IndependentExpenditureIsNotAReceipt` resolves to `never` and this line stops
  // compiling.
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
