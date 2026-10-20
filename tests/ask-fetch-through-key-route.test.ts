import { installFundingFixture } from "./helpers/funding-fixture.ts";
import test from "./helpers/playbooks.ts";
import assert from "node:assert/strict";
import { installFederalVotes, installPromotedValue, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
await installRegistryAuthority();
await installFederalVotes();
import { getFundingSnapshot } from "../lib/funding/snapshot.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { resetGroundedState } from "../lib/ask/grounded-state.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
delete process.env.ANTHROPIC_API_KEY;
const { POST } = await import("@/app/api/ask/grounded/route");

test("normal Ask detail requests fetch every registered FEC page and deliver each filed PAC row and source", async () => {
  await installFundingFixture("AZ");
  const contract = requiredRoutineContract("fec-funding:AZ");
  installPromotedValue({ recordClass: "FEC_FUNDING", scope: contract.scope, sourceId: contract.sourceId,
    versionId: "test:ask-finance-detail", value: getFundingSnapshot() });
  const candidate = getFundingSnapshot().candidates.find(c => c.name.toLowerCase().includes("ciscomani"))!;
  assert.ok(candidate?.principalCommitteeId);
  const target = candidate.targetKeys.find(k => k.startsWith("congress:"))!;
  assert.equal(fundingAnswerForTarget(target).kind, "funding");
  const priorFetch = globalThis.fetch, priorKey = process.env.FEC_API_KEY;
  process.env.FEC_API_KEY = "route-fixture-secret";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    const address = new URL(String(url));
    assert.equal(address.hostname, "api.open.fec.gov", "fixture never permits a real network call");
    assert.equal(address.searchParams.get("api_key"), "route-fixture-secret");
    assert.equal(address.searchParams.get("committee_id"), candidate.principalCommitteeId);
    assert.equal(init?.redirect, "error"); calls++;
    return Response.json({ results: [{ sub_id: "filed-row", committee_id: candidate.principalCommitteeId,
      entity_type: "PAC", line_number: "11C", contributor_name: "Fixture Filed PAC", contribution_receipt_amount: 250,
      contribution_receipt_date: "2026-09-01", contributor_street_1: "PRIVATE ADDRESS",
      pdf_url: "https://docquery.fec.gov/pdf/fixture.pdf" }], pagination: { count: 1 } });
  };
  try {
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST",
      headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ballot-ca36-route" },
      body: JSON.stringify({ question: "List every PAC that gave to Juan Ciscomani this year", today: "2026-10-05", ocdIds: ["ocd-division/country:us/state:az"],
        activeSubjects: [{ id: target, kind: "PERSON", name: "Juan Ciscomani", focused: true }] }) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.subject?.kind, "PERSON", JSON.stringify(body)); assert.equal(calls, 1, JSON.stringify(body));
    assert.equal(body.denominators.financeDetailComplete, 1);
    assert.ok(body.records.some((r: { text: string; sourceUrl: string }) => r.text.includes("Fixture Filed PAC") && r.sourceUrl === "https://docquery.fec.gov/pdf/fixture.pdf"));
    assert.match(body.answer, /requested filed organization receipts/);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE ADDRESS|route-fixture-secret|api_key/);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.FEC_API_KEY; else process.env.FEC_API_KEY = priorKey;
  }
});
