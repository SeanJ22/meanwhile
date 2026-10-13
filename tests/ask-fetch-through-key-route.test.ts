import test from "./helpers/playbooks.ts";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { installFederalVotes, installPromotedValue, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
await installRegistryAuthority();
await installFederalVotes();
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { getFundingSnapshot, refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { resetGroundedState } from "../lib/ask/grounded-state.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
delete process.env.ANTHROPIC_API_KEY;
const { POST } = await import("@/app/api/ask/grounded/route");

test("normal Ask detail requests fetch every registered FEC page and deliver each filed PAC row and source", async t => {
  await refreshFundingFromPromoted({ store: new MemoryRoutineDataStore() });
  const contract = requiredRoutineContract("fec-funding");
  installPromotedValue({ recordClass: "FEC_FUNDING", scope: contract.scope, sourceId: contract.sourceId,
    versionId: "test:ask-finance-detail", value: getFundingSnapshot() });
  const candidate = getFundingSnapshot().candidates.find(c => c.name.toLowerCase().includes("ciscomani"))!;
  assert.ok(candidate?.principalCommitteeId);
  const target = candidate.targetKeys.find(k => k.startsWith("congress:"))!;
  assert.equal(fundingAnswerForTarget(target).kind, "funding");
  const priorKey = process.env.FEC_API_KEY, priorNoProxy = process.env.no_proxy;
  process.env.FEC_API_KEY = "route-fixture-secret";
  process.env.no_proxy = "*";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => assert.fail("fixture refuses unpinned fetches"));
  t.mock.method(http, "request", () => assert.fail("fixture refuses unexpected HTTP requests"));
  t.mock.method(dns, "lookup", async (hostname: string) => {
    assert.equal(hostname, "api.open.fec.gov");
    return [{ address: "93.184.216.34", family: 4 }];
  });
  t.mock.method(https, "request", (options: https.RequestOptions) => {
    assert.equal(options.hostname, "93.184.216.34", "the socket uses the checked DNS answer");
    assert.equal(options.servername, "api.open.fec.gov");
    assert.equal((options.headers as Record<string, string>).host, "api.open.fec.gov");
    assert.equal(options.method, "GET");
    const address = new URL(options.path!, "https://api.open.fec.gov");
    assert.equal(address.searchParams.get("api_key"), "route-fixture-secret");
    assert.equal(address.searchParams.get("committee_id"), candidate.principalCommitteeId);
    calls++;
    const body = JSON.stringify({ results: [{ sub_id: "filed-row", committee_id: candidate.principalCommitteeId,
      entity_type: "PAC", line_number: "11C", contributor_name: "Fixture Filed PAC", contribution_receipt_amount: 250,
      contribution_receipt_date: "2026-09-01", contributor_street_1: "PRIVATE ADDRESS",
      pdf_url: "https://docquery.fec.gov/pdf/fixture.pdf" }], pagination: { count: 1 } });
    const response = Object.assign(Readable.from([Buffer.from(body)]), {
      statusCode: 200, rawHeaders: ["content-type", "application/json", "content-length", String(Buffer.byteLength(body))],
    });
    const request = Object.assign(new EventEmitter(), { end: () => queueMicrotask(() => request.emit("response", response)) });
    return request;
  });
  syncBuiltinESMExports();
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
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (priorKey === undefined) delete process.env.FEC_API_KEY; else process.env.FEC_API_KEY = priorKey;
    if (priorNoProxy === undefined) delete process.env.no_proxy; else process.env.no_proxy = priorNoProxy;
  }
});
