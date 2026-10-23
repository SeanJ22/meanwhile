import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";

delete process.env.ANTHROPIC_API_KEY;

import { installPimaLocalFinance, installRegistryAuthority, syntheticPimaLocalFinance } from "./helpers/promoted-fixtures.ts";

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

const { financeQuestionAsked } =
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

test("ROUTE: unbound county donations never become person or body money", async () => {
  const body = await ask("Who has donated campaign money to Vail school district candidates?");
  assert.equal(body.subject?.id, VAIL_BOARD);
  assert.equal(body.records?.filter(record => record.kind.startsWith("FINANCE_")).length, 0);
  assert.doesNotMatch(JSON.stringify(body), /Pat Donor|297\.86|Candidate One for VUSD Board/);
  assert.ok(body.gaps?.some(gap => gap.whose === "OURS"));
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

  const gap = body.gaps?.find((g) => /no applicable|No applicable|not linked a verified/.test(g.statement));
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
