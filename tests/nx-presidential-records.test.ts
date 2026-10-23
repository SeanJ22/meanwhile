import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { presidentialRegisterRecords, presidentialBillRecords, presidentialFecMoney, senateTieVoteLinks, senateTieVoteRecord, acquirePresidentialRecords, SENATE_TIE_VOTES_URL, SENATE_VETO_INDEX_URL, senateVetoAdministration, senateVetoBills, presidentialRegisterSlug, PRESIDENTIAL_DOCUMENTS_URL, resolvePresidentialFecIdentity } from "../lib/sources/white-house/presidential-records.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";

const ROOT = join(import.meta.dirname, "fixtures/nx-executive/presidential");
const fixture = (name: string) => readFileSync(join(ROOT, name), "utf8");
const NOW = "2026-10-23T02:42:00.000Z";
const president = { id: "white-house:donald-j-trump", name: "Donald J. Trump", termStart: "2025-01-20", termEnd: "2029-01-20", fecCandidateIds: ["P80001571"] } as unknown as Officeholder;
const vice = { id: "white-house:jd-vance", name: "JD Vance", termStart: "2025-01-20", termEnd: "2029-01-20" } as unknown as Officeholder;
const frUrl = "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bpresident%5D=donald-trump";
const page = (url: string, body: string) => ({ url, body, retrievedAt: NOW });

test("saved Federal Register rows use signing dates, native order numbers and explicit signer query", () => {
  const records = presidentialRegisterRecords(page(frUrl, fixture("register-orders.json")), president, "donald-trump");
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, "EXECUTIVE_ORDER");
  assert.equal(records[0].date, "2026-10-19");
  assert.equal(records[0].details.publicationDate, "2026-10-22");
  assert.equal(records[0].details.designation, "14437");
  assert.equal(records[0].evidenceSourceUrl, frUrl);
  assert.ok(fixture("register-orders.json").includes(records[0].quote));
  assert.throws(() => presidentialRegisterRecords(page(frUrl, fixture("register-orders.json")), president, "joe-biden"), /SIGNER_UNBOUND/);
  assert.equal(presidentialRegisterRecords(page(frUrl, fixture("register-orders.json")), { ...president, termStart: "2027-01-20" }, "donald-trump").length, 0);
  assert.equal(presidentialRegisterRecords(page(frUrl, fixture("register.json")), president, "donald-trump").length, 0, "untyped default metadata cannot prove an order or memorandum");
});

test("saved Congress actions require explicit presidential signature and retain one event despite duplicate action systems", () => {
  const url = "https://api.congress.gov/v3/bill/119/hr/1/actions?format=json&limit=250";
  const records = presidentialBillRecords(page(url, fixture("congress-actions.json")), president);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "BILL_SIGNED");
  assert.equal(records[0].date, "2025-07-04");
  assert.equal(records[0].sourceUrl, "https://www.congress.gov/bill/119th-congress/house-bill/1/all-actions");
  assert.equal(records[0].quote, "Signed by President.");
  const body = JSON.parse(fixture("congress-actions.json"));
  body.actions = body.actions.filter((row: { text: string }) => row.text !== "Signed by President.");
  assert.equal(presidentialBillRecords(page(url, JSON.stringify(body)), president).length, 0, "became law does not prove a signature");
  assert.throws(() => presidentialBillRecords(page(url.replace("/hr/1/", "/hr/2/"), fixture("congress-actions.json")), president), /MISMATCH/);
  assert.equal(presidentialBillRecords(page(url, fixture("congress-actions.json")), { ...president, termStart: "2029-01-20", termEnd: "2033-01-20" }).length, 0);
});

test("saved FEC totals retain the actual filing period and source-native identity without donor addresses", () => {
  const money = presidentialFecMoney(fixture("fec-totals.json"), "P80001571", 2024, NOW)!;
  assert.equal(money.totals.receipts, 29133.95);
  assert.equal(money.totals.coverageEndDate, "2024-08-08");
  assert.equal(money.cycle, 2024);
  assert.equal(money.filingUrl, "https://docquery.fec.gov/cgi-bin/fecimg/?202408089666131832");
  assert.equal(money.totals.smallDonorShare, null, "zero denominator is not a small donor share");
  assert.doesNotMatch(JSON.stringify(money), /address_street|address_zip/);
  assert.throws(() => presidentialFecMoney(fixture("fec-totals.json"), "P00000000", 2024, NOW), /MISMATCH/);
  assert.equal(presidentialFecMoney(fixture("fec-totals.json"), "P80001571", 2026, NOW), null);
});

test("saved Senate index binds eight JD Vance tie votes, while the actual roll call proves direction and Senate tally", () => {
  const links = senateTieVoteLinks(page(SENATE_TIE_VOTES_URL, fixture("senate-ties.html")), vice);
  assert.equal(links.length, 8);
  const hegs = links.find(row => row.url.endsWith("vote_119_1_00015.xml"))!;
  const vote = senateTieVoteRecord(page(hegs.url, fixture("senate-vote.xml")), vice, hegs);
  assert.equal(vote.date, "2025-01-24");
  assert.equal(vote.details.vote, "Yea");
  assert.equal(vote.details.yeas, 50);
  assert.equal(vote.details.nays, 50);
  assert.equal(vote.kind, "TIE_BREAKING_VOTE");
  assert.match(vote.details.result!, /Vice President.*voted Yea/);
  assert.throws(() => senateTieVoteLinks(page(SENATE_TIE_VOTES_URL, fixture("senate-ties.html")), { ...vice, name: "Another Vance" }), /UNBOUND/);
  assert.throws(() => senateTieVoteRecord(page(hegs.url, fixture("senate-vote.xml").replace("<tie_breaker_vote>Yea", "<tie_breaker_vote>")), vice, hegs), /UNVERIFIED/);
  assert.throws(() => senateTieVoteRecord(page(hegs.url, fixture("senate-vote.xml")), vice, { ...hegs, date: "2025-01-25" }), /UNVERIFIED/);
});

test("failed Senate detail remains standing work and cannot claim the full vote floor", async () => {
  const seen: string[] = [];
  const acquire = async (options: KnownReleaseOptions): Promise<KnownRelease> => {
    seen.push(options.url);
    if (options.url !== SENATE_TIE_VOTES_URL) throw new Error("publisher temporarily unavailable");
    const body = fixture("senate-ties.html");
    return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url,
      bytes: new TextEncoder().encode(body), sha256: "a".repeat(64), httpStatus: 200, retrievedAt: NOW, sourceObservedAt: NOW,
      checkedAt: NOW, lastCheckStatus: 200, contentType: "text/html", etag: null, lastModified: null, reused: true };
  };
  const result = await acquirePresidentialRecords({ signal: new AbortController().signal, vicePresident: vice, acquire });
  assert.equal(result.coverage.tieBreakingVotes, false);
  assert.equal(result.captures.length, 1);
  assert.equal(result.records.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(seen[0], SENATE_TIE_VOTES_URL);
});


test("saved Senate veto table distinguishes the current administration and discovers bills despite later override votes", () => {
  const administration = senateVetoAdministration(page(SENATE_VETO_INDEX_URL, fixture("senate-veto-index.html")), president);
  assert.equal(administration.url, "https://www.senate.gov/legislative/vetoes/TrumpDJ2.htm");
  assert.equal(administration.total, 2);
  const bills = senateVetoBills(page(administration.url, fixture("senate-vetoes.html")), president, administration);
  assert.deepEqual(bills, [{ congress: 119, type: "hr", number: "131" }, { congress: 119, type: "hr", number: "504" }]);
  const prior = senateVetoAdministration(page(SENATE_VETO_INDEX_URL, fixture("senate-veto-index.html")), { ...president, termStart: "2017-01-20" });
  assert.equal(prior.url, "https://www.senate.gov/legislative/vetoes/TrumpDJ.htm");
  assert.equal(prior.total, 10);
  assert.throws(() => senateVetoBills(page(administration.url, fixture("senate-vetoes.html")), president, { ...administration, total: 3 }), /INCOMPLETE/);
});


test("the saved complete Federal Register response carries orders, proclamations and memoranda independently", () => {
  const body = fixture("register-complete.json");
  const root = JSON.parse(body);
  assert.equal(root.count, root.results.length);
  assert.equal(root.next_page_url, undefined);
  const records = presidentialRegisterRecords(page(frUrl, body), president, "donald-trump");
  assert.equal(records.filter(row => row.kind === "EXECUTIVE_ORDER").length, 292);
  assert.equal(records.filter(row => row.kind === "PROCLAMATION").length, 189);
  assert.equal(records.filter(row => row.kind === "MEMORANDUM").length, 35);
  assert.ok(records.every(row => row.date >= president.termStart));
});

test("real Congress veto actions remain a veto when later override motions change latestAction", () => {
  const url = "https://api.congress.gov/v3/bill/119/hr/131/actions?format=json&limit=250";
  const records = presidentialBillRecords(page(url, fixture("congress-veto-actions.json")), president);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "VETO");
  assert.equal(records[0].date, "2025-12-29");
  assert.equal(records[0].details.billId, "119:hr:131");
});

test("official Federal Register directory supplies the current signer slug and refuses an unrelated name", () => {
  const captured = page(PRESIDENTIAL_DOCUMENTS_URL, fixture("register-presidents.html"));
  assert.equal(presidentialRegisterSlug(captured, president), "donald-trump");
  assert.throws(() => presidentialRegisterSlug(captured, { ...president, name: "Another Trump" }), /UNRESOLVED/);
});

test("the FEC supplies the President's unique native identity and party using the election year", () => {
  const url = "https://api.open.fec.gov/v1/candidates/?office=P&election_year=2024&name=Donald+J.+Trump";
  const result = resolvePresidentialFecIdentity(page(url, fixture("fec-candidates.json")), president, 2024);
  assert.equal(result.candidateId, "P80001571");
  assert.equal(result.partyLabel, "REPUBLICAN PARTY");
  assert.equal(result.quote, "TRUMP, DONALD J.");
  assert.equal(result.evidenceSourceUrl, url);
  assert.throws(() => resolvePresidentialFecIdentity(page(url, fixture("fec-candidates.json")), { ...president, name: "Donald Q. Trump" }, 2024), /UNRESOLVED/);
  const root = JSON.parse(fixture("fec-candidates.json"));
  root.results.push({ ...root.results[0], candidate_id: "P00000000" });
  assert.throws(() => resolvePresidentialFecIdentity(page(url, JSON.stringify(root)), president, 2024), /UNRESOLVED/);
});

test("a failed Congress source preserves independently complete presidential documents and discovered FEC money", async () => {
    const acquired: string[] = [];
    const acquire = async (options: KnownReleaseOptions): Promise<KnownRelease> => {
      acquired.push(options.url);
      const url = new URL(options.url);
      if (url.hostname === "api.open.fec.gov") assert.equal(new Headers(options.headers).get("X-Api-Key"), "fixture-fec-key");
      const name = url.pathname === "/presidential-documents" ? "register-presidents.html" : url.hostname === "www.federalregister.gov" ? "register-complete.json" : url.pathname === "/v1/candidates/" ? "fec-candidates.json" : url.pathname.includes("/totals/") ? "fec-totals.json" : null;
      if (!name) throw new Error("Congress source unavailable");
      const body = fixture(name);
      return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url,
        bytes: new TextEncoder().encode(body), sha256: "b".repeat(64), httpStatus: 200, retrievedAt: NOW, sourceObservedAt: NOW,
        checkedAt: NOW, lastCheckStatus: 200, contentType: name.endsWith("html") ? "text/html" : "application/json", etag: null, lastModified: null, reused: true };
    };
    const result = await acquirePresidentialRecords({ signal: new AbortController().signal, now: () => NOW, acquire,
      credentials: { fec: "fixture-fec-key", congress: "fixture-congress-key" },
      president: { person: { ...president, fecCandidateIds: [] }, congresses: [119], fecCycle: 2024 } });
    assert.equal(result.coverage.executiveOrders, true);
    assert.equal(result.coverage.proclamations, true);
    assert.equal(result.coverage.memoranda, true);
    assert.equal(result.coverage.campaignMoney, true);
    assert.equal(result.coverage.signedBills, false);
    assert.equal(result.coverage.vetoedBills, false);
    assert.equal(result.fecIdentity?.candidateId, "P80001571");
    assert.equal(result.records.length, 516);
    assert.equal(result.money?.totals.receipts, 29133.95);
    assert.ok(result.money?.evidenceSourceUrl?.includes("/candidate/P80001571/totals/"));
    assert.ok(acquired.includes(PRESIDENTIAL_DOCUMENTS_URL));
    assert.equal(result.gaps.length, 2);
    assert.ok(result.captures.every(capture => !capture.requestedUrl.includes("fixture-fec-key") && !capture.requestedUrl.includes("fixture-congress-key")));
});
