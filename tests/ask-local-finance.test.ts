import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";

delete process.env.ANTHROPIC_API_KEY;

import { installPimaLocalFinance, installRegistryAuthority, syntheticPimaLocalFinance } from "./helpers/promoted-fixtures.ts";

/*
 * A synthetic county register and transaction holding. Four committees name the Vail board's office in the
 * register (one with money rows); one names an office the crosswalk does not link; one names a supervisor
 * seat. Committee, donor and payee names are invented.
 */
const VAIL_OFFICE = "School Governing Board - Vail";
const register = (portalFilerId: string, registeredName: string, officeName: string | null, filingCount = 2) =>
  ({ portalFilerId, registeredName, filerType: "Candidate", status: "Active", officeName, filingCount, source: `https://example.test/county-register/${portalFilerId}` });
const contribution = (committee: string, amount: number, date: string, first: string, last: string) => ({
  DocumentFilingId: `f-${committee}-${date}`, DocumentType: "CCFR", ItemizedListType: "Contribution", RecipientCommitteeName: committee, OfficeName: null,
  ContributorFullName: null, ContributorFirstName: first, ContributorMiddleName: null, ContributorLastName: last, ContributorOrganizationName: null,
  ContributionDate: date, ContributionAmount: amount });
const spending = (committee: string, amount: number, date: string, payee: string) => ({
  DocumentFilingId: `d-${committee}-${date}`, DocumentType: "CCFR", ItemizedListType: "Disbursments", CandidateCommitteeName: committee, OfficeName: null,
  PayeeOrganizationName: payee, PayeeFirstName: null, PayeeLastName: null, DistributionDate: date, DistributionAmount: amount });
await installRegistryAuthority();
await installPimaLocalFinance(syntheticPimaLocalFinance({
  held: { committeeRegisterCountyPortal: [
    register("101", "Candidate One for VUSD Board", VAIL_OFFICE, 3),
    register("102", "Candidate Two for VUSD Board", VAIL_OFFICE),
    register("103", "Candidate Three for Vail School Board", VAIL_OFFICE),
    register("104", "Candidate Four Vail Committee", VAIL_OFFICE),
    register("105", "Citizens for Synthetic Schools", "School Governing Board - Elsewhere"),
    register("106", "SYNTHETIC SUPERVISOR CAMPAIGN", null),
  ] },
  transactions: {
    acquisition: { contributionsUrl: "https://example.test/county-contributions", distributionsUrl: "https://example.test/county-distributions", retrievedOn: "2026-08-29" },
    contributions: [
      contribution("Candidate One for VUSD Board", 297.86, "2025-02-27", "Pat", "Donor"),
      contribution("Citizens for Synthetic Schools", 5000, "2025-03-01", "Lee", "Giver"),
    ],
    distributions: [
      spending("Candidate One for VUSD Board", 16, "2025-03-05", "Synthetic Bank"),
      spending("Citizens for Synthetic Schools", 5000, "2025-03-02", "Synthetic Contracting Co"),
    ],
  },
}));

const { financeQuestionAsked, localFinanceEvidenceFor } =
  await import("@/lib/ask/local-finance");
const { POST } = await import("@/app/api/ask/grounded/route");
const { resetGroundedState } = await import("@/lib/ask/grounded-state");

const AZ = "ocd-division/country:us/state:az";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const VAIL_BOARD = `${VAIL}#board`;
const PIMA_BOARD = `${PIMA}#governing`;
const SLDU = "ocd-division/country:us/state:az/sldu:19";
const SLDL = "ocd-division/country:us/state:az/sldl:19";

test("finance wording is detected, and only finance wording", () => {
  for (const q of [
    "Who funded the Vail school board campaigns?",
    "Who are the donors to the school board race?",
    "What campaign contributions has the board race seen?",
    "How much money has the committee raised?",
    "Any independent expenditures in this race?",
    "Where is the campaign money coming from?",
    "Who has donated to the campaign?",
  ]) {
    assert.ok(financeQuestionAsked(q), `should detect: ${q}`);
  }
  for (const q of [
    "What's on the Vail school district agenda?",
    "When does the board meet next?",
    "Who is funding the school district?", // budget, not campaign money
    "Did the board vote on the budget?",
    "How do I contact the board?",
  ]) {
    assert.ok(!financeQuestionAsked(q), `should NOT detect: ${q}`);
  }
});

const vail = localFinanceEvidenceFor({
  kind: "BODY",
  id: VAIL_BOARD,
  name: "Vail Unified School District Governing Board",
});

test("the Vail board gets its register-linked committees as sourced records", () => {
  assert.ok(vail, "a BODY subject always gets finance evidence");
  const committees = vail!.records.filter((r) => r.kind === "FINANCE_COMMITTEE");
  assert.equal(committees.length, 4);
  const names = committees.map((r) => r.text).join("\n");
  assert.match(names, /Candidate One for VUSD Board/);
  assert.match(names, /Candidate Two for VUSD Board/);
  assert.match(names, /Candidate Three for Vail School Board/);
  assert.match(names, /Candidate Four Vail Committee/);
  for (const record of committees) {
    assert.ok(record.sourceUrl, "every register record carries the source it was read from");
    assert.equal(record.bodyId, VAIL_BOARD, "the record states whose it is, for the validator");
  }
});

test("the filed money rows travel as records with amounts and dates in plain language", () => {
  const tx = vail!.records.filter((r) => r.kind === "FINANCE_TRANSACTION");
  assert.ok(tx.length > 0, "the first committee's filed rows must reach the pack");

  const buster = tx.find((r) => /\$297\.86/.test(r.text));
  assert.ok(buster, "the committee's reported contribution is a record");
  assert.doesNotMatch(buster!.text, /Pat Donor/, "R255: an individual donor's name never reaches the reader");
  assert.match(buster!.text, /February 27th, 2025/, "dates spell out on reader surfaces");
  assert.match(buster!.text, /contribution/, "money in says it is money in");
  assert.ok(buster!.sourceUrl, "provenance travels on the record itself");

  const bank = tx.find((r) => /Synthetic Bank/.test(r.text));
  assert.ok(bank, "the committee's reported spending is a record");
  assert.match(bank!.text, /reported spending \$16\.00/, "money out says it is money out");

  for (const record of tx) {
    assert.equal(record.bodyId, VAIL_BOARD);
    assert.ok(!/CCFR/.test(record.text), "no document-type code reaches a reader");
    assert.ok(!/Disbursments/.test(record.text), "no vendor enum value reaches a reader");
  }
});

test("transaction records are ordered by date, newest first — never by amount", () => {
  const dates = vail!.records
    .filter((r) => r.kind === "FINANCE_TRANSACTION")
    .map((r) => r.occurredAt)
    .filter((d): d is string => Boolean(d));
  for (let i = 1; i < dates.length; i += 1) {
    assert.ok(dates[i - 1] >= dates[i], "date descending is the one neutral order");
  }
});

test("a committee the register does not link to the body NEVER appears for it", () => {
  const everything = [...vail!.records.map((r) => r.text), ...vail!.gaps.map((g) => g.statement)].join("\n");
  assert.ok(!/Citizens for Synthetic Schools/.test(everything), "an unlinked committee must not leak");
  assert.ok(!/Synthetic Contracting Co/.test(everything), "nor its transactions");
  assert.ok(!/\$5,000\.00/.test(everything));
});

test("the independent-expenditure class is a NAMED gap, never collapsed into filed money", () => {
  const ie = vail!.gaps.find((g) => /Independent-expenditure reports/.test(g.statement));
  assert.ok(ie, "every finance evidence set names the not-held document class");
  assert.equal(ie!.whose, "OURS", "not acquiring IE reports is a fact about us");
  assert.match(ie!.statement, /not money a campaign received/, "the distinction is stated, not implied");
  assert.match(ie!.statement, /not a finding that no outside spending happened/);
  assert.equal(vail!.denominators.independentExpenditureReportsHeld, 0);

  /* And no RECORD claims to be outside spending — records exist only for the
     filed campaign-finance reports we hold. */
  for (const record of vail!.records) {
    assert.ok(!/independent expenditure/i.test(record.text));
  }
});

test("register-linked committees with no readable money rows are a named gap, with denominators", () => {
  const gap = vail!.gaps.find((g) => /Candidate Two for VUSD Board/.test(g.statement));
  assert.ok(gap, "the committees whose reports we cannot read yet are named");
  assert.equal(gap!.whose, "OURS");
  assert.match(gap!.statement, /cannot say what they raised or spent/);

  assert.equal(vail!.denominators.financeCommitteesLinkedToThisBody, 4);
  assert.equal(vail!.denominators.financeCommitteesWithMoneyRowsHeld, 1);
  assert.ok(vail!.denominators.financeContributionRowsHeldForThisBody >= 1);
  assert.ok(vail!.denominators.financeSpendingRowsHeldForThisBody >= 1);
  assert.equal(vail!.denominators.financeTransactionRecordsShown,
    vail!.records.filter((record) => record.kind === "FINANCE_TRANSACTION").length);
  assert.equal(vail!.denominators.financeTransactionRecordsShown,
    vail!.denominators.financeContributionRowsHeldForThisBody +
    vail!.denominators.financeSpendingRowsHeldForThisBody +
    vail!.denominators.financeOtherMoneyRowsHeldForThisBody);
});

test("a body with no linked committee gets the honest OURS gap, not silence — and no leak", () => {
  const board = localFinanceEvidenceFor({
    kind: "BODY",
    id: PIMA_BOARD,
    name: "Pima County Board of Supervisors",
  });
  assert.ok(board, "a BODY subject always gets an answerable shape");
  assert.equal(board!.records.length, 0, "no held record links a committee to this board");

  const gap = board!.gaps.find((g) => /not linked any campaign-finance committee/.test(g.statement));
  assert.ok(gap, "the empty is named");
  assert.equal(gap!.whose, "OURS");
  assert.match(gap!.statement, /says nothing about whether such a committee exists/);

  const everything = board!.gaps.map((g) => g.statement).join("\n");
  assert.ok(!/SYNTHETIC SUPERVISOR/i.test(everything), "a register-less committee never leaks in by name");
});

test("a person NOT on a covered body gets null — never a false 'nothing recorded'", () => {
  assert.equal(localFinanceEvidenceFor({ kind: "PERSON", id: "p1", name: "Katie Hobbs" }), null);
  assert.equal(
    localFinanceEvidenceFor({ kind: "PERSON", id: "p2", name: "Juan Ciscomani" }),
    null,
  );
});

test("a person ON the covered body gets the body's evidence and the no-attachment gap FIRST", () => {
  const person = localFinanceEvidenceFor({ kind: "PERSON", id: "roster:vail#4", name: "Ed Buster" });
  assert.ok(person, "Ed Buster sits on the Vail board per the district's own roster");
  assert.match(
    person!.gaps[0].statement,
    /not attached any committee to Ed Buster specifically/,
    "the register links committees to an office, never to a person, and the reader is told so first",
  );
  assert.equal(person!.gaps[0].whose, "OURS");
  const committees = person!.records.filter((r) => r.kind === "FINANCE_COMMITTEE");
  assert.equal(committees.length, 4, "the body's own linked committees still travel");
});

test("a measure gets the linkage gap, never an inferred committee position", () => {
  const measure = localFinanceEvidenceFor({
    kind: "MEASURE",
    id: "ballot-az-pima:prop-423",
    name: "Proposition 423",
  });
  assert.ok(measure);
  assert.equal(measure!.records.length, 0);
  assert.match(measure!.gaps[0].statement, /never infer that from a committee's name/);
  assert.equal(measure!.gaps[0].whose, "OURS");
});

interface GroundedBody {
  mode: string;
  subject?: { kind: string; id: string; name: string } | null;
  records?: { kind: string; id: string; text: string; sourceUrl?: string | null }[];
  gaps?: { whose: string; statement: string }[];
  denominators?: Record<string, number>;
}

async function ask(question: string): Promise<GroundedBody> {
  resetGroundedState();
  const request = new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      /* Declared synthetic, as every automated request to this product must
         be — an undeclared one would count as reader signal in a sold store. */
      "x-wtp-synthetic-run": "ask-local-finance-test",
    },
    body: JSON.stringify({
      question,
      ocdIds: [AZ, PIMA, VAIL, SLDU, SLDL],
      today: "2026-08-30",
    }),
  });
  const response = await POST(request);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as GroundedBody;
}

test("ROUTE: a funding question about the Vail board returns finance records with the IE gap", async () => {
  const body = await ask("Who has donated campaign money to Vail school district candidates?");

  assert.equal(body.subject?.id, VAIL_BOARD, "the reader's own words bind the body");
  const committees = body.records?.filter((r) => r.kind === "FINANCE_COMMITTEE") ?? [];
  const tx = body.records?.filter((r) => r.kind === "FINANCE_TRANSACTION") ?? [];
  assert.equal(committees.length, 4);
  assert.ok(tx.length > 0, "the filed money rows reach the delivered pack");
  assert.ok(tx.some((r) => /\$297\.86/.test(r.text)));
  assert.ok(tx.every((r) => !/Pat Donor/.test(r.text)), "individual donor identity is withheld under R255");

  const ie = body.gaps?.find((g) => /Independent-expenditure reports/.test(g.statement));
  assert.ok(ie, "the reader is told outside spending is a different, not-held record class");
  assert.equal(ie!.whose, "OURS");
  assert.equal(body.denominators?.independentExpenditureReportsHeld, 0);
});

test("ROUTE: the same body WITHOUT finance wording gets no finance records — no noise", async () => {
  const body = await ask("What's on the Vail school district agenda?");
  assert.equal(body.subject?.id, VAIL_BOARD);
  const finance = body.records?.filter((r) => r.kind.startsWith("FINANCE_")) ?? [];
  assert.equal(finance.length, 0, "finance evidence rides only on finance questions");
});

test("ROUTE: a funding question about a body with no linked committee gets the OURS gap, not silence", async () => {
  const body = await ask("Who is funding campaigns for the Pima County Board of Supervisors?");

  assert.equal(body.subject?.id, PIMA_BOARD);
  const finance = body.records?.filter((r) => r.kind.startsWith("FINANCE_")) ?? [];
  assert.equal(finance.length, 0, "nothing we hold links a committee to this board");

  const gap = body.gaps?.find((g) => /not linked any campaign-finance committee/.test(g.statement));
  assert.ok(gap, "the reader is told it is OUR gap");
  assert.equal(gap!.whose, "OURS");

  const everything = [
    ...(body.records ?? []).map((r) => r.text),
    ...(body.gaps ?? []).map((g) => g.statement),
  ].join("\n");
  assert.ok(!/SYNTHETIC SUPERVISOR/i.test(everything), "register-less supervisor committees never leak in");
});

test("ROUTE: an FEC-covered federal candidate question gets NO Pima local finance records", async () => {
  const body = await ask("Who are the donors to Juan Ciscomani's campaign?");

  const finance = body.records?.filter((r) => r.kind === "FINANCE_COMMITTEE" || r.kind === "FINANCE_TRANSACTION") ?? [];
  assert.equal(finance.length, 0);
  const everything = [
    ...(body.records ?? []).map((r) => r.text),
    ...(body.gaps ?? []).map((g) => g.statement),
  ].join("\n");
  assert.ok(!/Pima County Elections/.test(everything), "no local filing officer under a federal race");
});

test("a same-name person with no canonical roster identity cannot acquire the body's finance", () => {
  assert.equal(localFinanceEvidenceFor({ kind: "PERSON", id: "unresolved:ed-buster", name: "Ed Buster" }), null);
  assert.equal(localFinanceEvidenceFor({ kind: "PERSON", id: "ballot:unresolved", name: "Ed Buster" }, ["not-a-held-official"]), null);
});
