import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { federalDirectoryScope } from "../lib/officials/federal-directory-data-plane.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fecFundingScope, fecFundingContractId } from "../lib/civic-data/fec-state-scope.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "./helpers/playbooks.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { discoverFecCandidates, fecRegistration, fecRegistrationTargets } from "../lib/funding/fec-discovery.ts";
import { fecBulkUrls, parseFecBulk } from "../lib/funding/fec-bulk.ts";
import { collectFecSmallDonorLines, projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { parseFecPage, type FecReadPage } from "../lib/funding/fec-api.ts";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { refreshFundingFromPromoted, settleFundingRead } from "../lib/funding/snapshot.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { fecPersonId, fecPersonName, fecRaceMoneyAnswer, requestedFecSubjects } from "../lib/ask/fec-national.ts";
import { campaignMoneyEvidenceFor } from "../lib/ask/campaign-money.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import { GET as fundingGET } from "../app/api/funding/[target]/route.ts";
import { POST as askPOST } from "../app/api/ask/grounded/route.ts";
import FecCandidateProfile from "../app/candidates/[candidate]/page.tsx";
import { installRegistryAuthority, installPromotedValue } from "./helpers/promoted-fixtures.ts";

const ROOT = join(import.meta.dirname, "fixtures/fec-national");
const source = (name: string) => readFileSync(join(ROOT, name), "utf8");
const NOW = "2026-10-12T12:00:00.000Z", cycle = 2026;
const master = source("cn-2026.txt"), summary = source("weball-2026.txt");
const bulk = await parseFecBulk(join(ROOT,"cn-2026.txt"), join(ROOT,"weball-2026.txt"), cycle, NOW, "TX");
const roster = { officeholders: [{ id: "congress:F000468", name: "Lizzie Fletcher", level: "FEDERAL", officeTitle: "U.S. Representative", fecCandidateIds: ["H8TX07140"] },
  { id: "congress:Z999999", name: "Montgomery, Erin", level: "FEDERAL", officeTitle: "U.S. Representative", fecCandidateIds: [] }], divisions: [] } as unknown as OfficeholderSet;
const rows = projectFecDiscovery(bulk, cycle, roster);
const snapshot: FundingSnapshot = { formatVersion: 1, fetchedAt: NOW, cycle, candidates: rows, absences: [], secondHop: [],
  matchReport: { rosterMatched: 1, rosterTotal: 2, ballotMatched: 0, ballotTotal: 0 } };
await installRegistryAuthority();

test("real FEC bulk files promote every current Texas registration, including registrations without totals", async () => {
  const counts: Record<string, number> = {};
  rows.forEach(row => { counts[row.state] = (counts[row.state] ?? 0) + 1; });
  assert.ok(rows.length >= 100); assert.deepEqual(Object.keys(counts), ["TX"]);
  assert.equal(rows.length, bulk.registrations.length);
  assert.ok(rows.some(row => row.totals.receipts === null));
  assert.ok(rows.every(row => row.registration?.label.startsWith("registered with the FEC for ")));
  assert.deepEqual(fecBulkUrls(cycle), { master: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", summary: "https://www.fec.gov/files/bulk-downloads/2026/weball26.zip" });
  const store = new MemoryRoutineDataStore();
  const candidate = fecFundingCandidate({ snapshot, rawBodies: [master, summary], finalUrl: fecBulkUrls(cycle).master, retrievedAt: NOW, excludedFacts: [] });
  const outcome = await processRegisteredRoutineCandidate(store, fecFundingContractId("TX"), candidate, NOW);
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
  await refreshFundingFromPromoted({ state: "TX", store, now: NOW, bypassCache: true });
  assert.equal((await store.readPromotion<FundingSnapshot>("FEC_FUNDING", fecFundingScope("TX")))?.payload.candidates.length, rows.length);
  assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
  console.log("FEC fixture registrations by state:", JSON.stringify(Object.fromEntries(Object.entries(counts).sort())));
});

test("real API records page both chambers and exact-state totals without per-candidate totals calls", async () => {
  const h = parseFecPage(source("candidates-h.json")).results, s = parseFecPage(source("candidates-s.json")).results;
  const totals = parseFecPage(source("totals.json")).results;
  const state = String(totals.find(row => row.office === "H" || row.office === "S")!.state);
  const calls: string[] = [];
  const read: FecReadPage = async (path, params) => {
    assert.equal(params.per_page, 100); assert.equal(params.election_year, cycle); assert.equal(params.state, state);
    if (path === "/candidates/totals/") assert.equal(params.election_full, false);
    calls.push(`${path}:${params.office ?? ""}:${params.page}`);
    const selected = (path === "/candidates/totals/" ? totals : params.office === "H" ? h : s).filter(row => row.state === state && row.office === params.office);
    // Controlled short pages of real source rows; metadata, not page length, proves completion.
    const size = 50, page = Number(params.page);
    return { results: selected.slice((page - 1) * size, page * size), pagination: { count: selected.length, pages: Math.max(1,Math.ceil(selected.length/size)) }, sourceObservedAt: NOW };
  };
  const discovered = await discoverFecCandidates({ state, cycle, read, observedAt: () => NOW, bulk: async () => { throw new Error("bulk must not run"); } });
  assert.equal(discovered.route, "api"); assert.equal(discovered.registrations.length, [...h,...s].filter(row=>row.state===state).length); assert.equal(discovered.totals.length, totals.filter(row=>row.state===state && ["H","S"].includes(String(row.office))).length);
  assert.equal(calls.length, 4); assert.ok(calls.every(path => path.startsWith("/candidates/")));
  const first = totals.find(row => row.state === state && (row.office === "H" || row.office === "S"))!;
  const [row] = projectFecDiscovery({ ...discovered, registrations: [fecRegistration(first, cycle, NOW)] }, cycle);
  assert.equal(row.totals.cashOnHand, Number(first.cash_on_hand_end_period));
});

test("real full-election Senate totals cannot wear a two-year period label", async () => {
  const full = parseFecPage(source("totals-full-election.json")).results;
  assert.ok(full.some(row => row.office === "S" && String(row.coverage_start_date) < "2025-01-01"));
  const result = await discoverFecCandidates({ state: "TX", cycle, observedAt: () => NOW, bulk: async () => bulk,
    read: async path => ({ results: path === "/candidates/totals/" ? full : [], pagination: { count: path === "/candidates/totals/" ? full.length : 0, pages: 1 } }) });
  assert.equal(result.route, "bulk");
  assert.ok(parseFecPage(source("totals.json")).results.every(row => row.is_election === false));
});

test("an unavailable API or incomplete pagination uses bulk, while operational failures propagate", async () => {
  for (const read of [async () => { throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "FEC 503"); },
    async () => ({ results: parseFecPage(source("candidates-h.json")).results, pagination: { count: 101, pages: 1 } })] as FecReadPage[]) {
    const result = await discoverFecCandidates({ state: "TX", cycle, read, observedAt: () => NOW, bulk: async () => bulk });
    assert.equal(result.route, "bulk"); assert.equal(result.registrations.length, rows.length);
  }
  const defect = new Error("VAULT_STORE_UNAVAILABLE");
  await assert.rejects(discoverFecCandidates({ state: "TX", cycle, read: async () => { throw defect; }, observedAt: () => NOW, bulk: async () => bulk }), error => error === defect);
  const directory = await mkdtemp(join(tmpdir(),"fec-invalid-"));
  try { const path=join(directory,"cn.txt");await writeFile(path,master.replace("|2026|", "|2026"));
    await assert.rejects(parseFecBulk(path,join(ROOT,"weball-2026.txt"),cycle,NOW,"TX"),/MASTER_INVALID/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("native FEC IDs bind to Congress; a namesake remains separate and no FEC record creates a ballot contest", async () => {
  assert.equal(fecPersonName(projectFecDiscovery(await parseFecBulk(join(ROOT,"cn-2026.txt"),join(ROOT,"weball-2026.txt"),cycle,NOW,"AL"),cycle).find(row=>row.fecCandidateId==="H0AL01055")!.name), "Jerry Lee Carl Jr");
  const fletcher = rows.find(row => row.fecCandidateId === "H8TX07140")!, challenger = rows.find(row => row.fecCandidateId === "H2TX07101")!;
  assert.equal(fecPersonId(fletcher), "congress:F000468"); assert.equal(fecPersonId(challenger), "fec:H2TX07101");
  assert.deepEqual(challenger.targetKeys, ["fec:H2TX07101"]);
  assert.equal(snapshot.matchReport.ballotTotal, 0);
  assert.ok(rows.every(row => row.targetKeys.every(key => !key.startsWith("ballot-"))));
  const native = bulk.registrations.find(row => row.candidateId === fletcher.fecCandidateId)!;
  assert.equal(fecRegistrationTargets(native, roster).length, 2);
  installPromotedValue({ recordClass: "FEC_FUNDING", scope: fecFundingScope("TX"), sourceId: "fec-open-api", versionId: "test:national-fec", value: snapshot });
  await settleFundingRead("TX");
  assert.deepEqual(readerPersonKeys("fec:H8TX07140").keys, ["congress:F000468", "fec:H8TX07140"]);
  assert.deepEqual(readerPersonKeys(challenger.targetKeys[0]).keys, challenger.targetKeys);
  assert.equal(requestedFecSubjects("How much has Erin Montgomery raised?", [], snapshot)[0]?.entity.id, "fec:H2TX07101");
});

test("real per-candidate small-donor lines survive national and bulk refreshes with their own date", async () => {
  const row = rows.find(row => row.fecCandidateId === "H8TX07140")!;
  assert.equal(row.totals.smallDonorShare, null, "weball's total individual dollars cannot establish the small share");
  const detailed = await collectFecSmallDonorLines(row, async () => ({ ...parseFecPage(source("H8TX07140-totals.json")), sourceObservedAt: NOW }), () => NOW);
  assert.equal(detailed.totals.individualItemized, 235674.59); assert.equal(detailed.totals.individualUnitemized, 33173.88);
  assert.equal(detailed.totals.smallDonorShare, 33173.88 / (235674.59 + 33173.88));
  assert.equal(detailed.totals.smallDonorCoverageEndDate, "2026-06-30");
  const retained = projectFecDiscovery(bulk, cycle, roster, [detailed]).find(row => row.fecCandidateId === detailed.fecCandidateId)!;
  assert.equal(retained.totals.smallDonorShare, detailed.totals.smallDonorShare);
  assert.equal(retained.totals.smallDonorCollectedAt, NOW);
});

test("an out-of-pilot challenger gets a sourced money profile, funding API response and Ask evidence with no private names or mailing addresses", async () => {
  installPromotedValue({ recordClass: "FEC_FUNDING", scope: fecFundingScope("TX"), sourceId: "fec-open-api", versionId: "test:national-fec", value: snapshot });
  await settleFundingRead("TX");
  const answer = fundingAnswerForTarget("fec:H2TX07119"); assert.equal(answer.kind, "funding");
  if (answer.kind !== "funding") return;
  assert.equal(answer.data.sourceOrg, "Federal Election Commission"); assert.ok(answer.data.totals?.receipts !== null);
  const evidence = campaignMoneyEvidenceFor({ kind: "PERSON", id: "fec:H2TX07119", name: "Tina Cohen" }, "fec:H2TX07119");
  assert.equal(evidence.denominators.federalFinanceRecordsReturned, 1);
  const response = await fundingGET(new Request("http://localhost/api/funding/fec:H2TX07119"), { params: Promise.resolve({ target: "fec:H2TX07119" }) });
  assert.equal(response.status, 200); const json = await response.json(); assert.equal(json.data.fecCandidateId, "H2TX07119");
  const profile = renderToStaticMarkup(await FecCandidateProfile({ params: Promise.resolve({ candidate: "H2TX07119" }) }));
  assert.match(profile, /registered with the FEC for House TX-07/); assert.match(profile, /data-funding-section/); assert.match(profile, /Federal Election Commission/);
  // A share the weball totals cannot establish is a card gap, never an invented figure or a field placeholder.
  assert.equal(answer.data.totals?.smallDonorShare, null);
  assert.doesNotMatch(profile, /small-donor share|working on getting/i);
  assert.doesNotMatch(JSON.stringify(json) + profile, /address_street|address_zip|CAND_ST1|donor_name/);
});

test("Ask who is raising the most for TX-7 answers from all FEC registrations and exposes candidate profile links", async () => {
  const question = "who is raising the most for TX-7";
  const composed = fecRaceMoneyAnswer(question, "2026-10-12", snapshot)!;
  assert.ok(composed); assert.equal(composed.pack.denominators.fecRegisteredCandidates, 6);
  assert.equal(validateAnswer(composed.answer, composed.citedUrls, composed.pack).kind, "PASSED");
  assert.ok(composed.pack.records.some(row => row.fecProfile?.candidateId === "H2TX07101"));
  const expected = rows.filter(row => row.state === "TX" && row.district === "07" && row.totals.receipts !== null).sort((a, b) => b.totals.receipts! - a.totals.receipts!)[0];
  assert.ok(composed.citedUrls.includes(expected.provenance.sourceUrl!));
  const response = await askPOST(new Request("http://localhost/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": "fec-national-fixture" },
    body: JSON.stringify({ question, ocdIds: ["ocd-division/country:us/state:tx/cd:7"], today: "2026-10-12", surface: "MAP" }) }));
  assert.equal(response.status, 200); const answer = await response.json();
  assert.equal(answer.mode, "STRUCTURED_GROUNDED"); assert.equal(answer.answer, composed.answer);
  assert.equal(answer.trace.composition.basis, "FEC_FILED_TOTALS");
  assert.ok(answer.records.some((row: { fecProfile?: unknown }) => row.fecProfile));
});


test("a native Congress funding URL keeps its own published money without a reader ZIP or a different state's fallback", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    const directory = { roster: { officeholders: [{ id: "congress:F000468", state: "TX", name: "Lizzie Fletcher" }] } };
    for (const source of [{ id: "native-fec-api", sourceId: "fec-open-api", recordClass: "FEC_FUNDING" as const, scope: fecFundingScope("TX"), payload: snapshot },
      { id: "native-directory-api", sourceId: "congress-directory-project", recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope("TX"), payload: directory }]) {
      const encoded = partitionCivicPayload(source.payload);
      for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await insertPublishedSliceFixture(pg, { ...source, readModel: source.payload, storedReadModel: encoded.value, at: NOW });
    }
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows)));
    for (const query of ["", "?division=ocd-division/country:us/state:nj"]) {
      const response = await fundingGET(new Request(`http://localhost/api/funding/congress:F000468${query}`), { params: Promise.resolve({ target: "congress:F000468" }) });
      assert.equal(response.status, 200); const answer = await response.json();
      assert.equal(answer.data?.fecCandidateId, "H8TX07140"); assert.equal(answer.data?.sourceOrg, "Federal Election Commission");
    }
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
