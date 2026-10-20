import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { PGlite } from "@electric-sql/pglite";
import { parseFecBulk } from "../lib/funding/fec-bulk.ts";
import { discoverFecCandidates } from "../lib/funding/fec-discovery.ts";
import { projectFecDiscovery, fecOrganizationRows } from "../lib/funding/fec-collector.ts";
import { collectFecOrganizationReceipts } from "../lib/funding/fec-transaction-file.ts";
import { parseFecPage, type FecReadPage } from "../lib/funding/fec-api.ts";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { FEC_STATES, fecFundingScope, fecFundingContractId } from "../lib/civic-data/fec-state-scope.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { readFecStateSnapshot } from "../lib/funding/fec-state-read.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";

const ROOT = "tests/fixtures/fec-national", NOW = "2026-10-20T00:00:00Z", cycle = 2026;
const bulk = (state: string) => parseFecBulk(`${ROOT}/cn-2026.txt`, `${ROOT}/weball-2026.txt`, cycle, NOW, state);

test("streamed FEC files preserve every native registration one state at a time", async () => {
  let registrations = 0, states = 0, missingTotals = 0;
  const source = new Map(FEC_STATES.map(state => [state, { count: 0, ids: createHash("sha256") }]));
  for await (const line of createInterface({ input: createReadStream(`${ROOT}/cn-2026.txt`), crlfDelay: Infinity })) {
    const row = line.split("|"), own = source.get(row[4] as typeof FEC_STATES[number]);
    if (own && Number(row[3]) === cycle && ["H", "S"].includes(row[5])) { own.count++; own.ids.update(row[0]).update("\n"); }
  }
  for (const state of FEC_STATES) {
    const parsed = await bulk(state); registrations += parsed.registrations.length; if (parsed.registrations.length) states++;
    assert.ok(parsed.registrations.every(row => row.state === state && row.candidateId.slice(2, 4) === state));
    assert.equal(parsed.registrations.length, source.get(state)!.count, `${state}: every eligible native registration survives`);
    const actualIds = createHash("sha256"); for (const row of parsed.registrations) actualIds.update(row.candidateId).update("\n");
    assert.equal(actualIds.digest("hex"), source.get(state)!.ids.digest("hex"), `${state}: native identity inventory is exact`);
    const rows = projectFecDiscovery(parsed, cycle); assert.equal(rows.length, parsed.registrations.length);
    missingTotals += rows.filter(row => row.totals.receipts === null).length;
  }
  assert.equal(FEC_STATES.length, 56);
  assert.ok(registrations >= 2_000); assert.ok(states >= 50); assert.ok(missingTotals > 0);
  console.log("Exact state/territory FEC native inventories:", JSON.stringify(Object.fromEntries([...source].map(([state, row]) => [state, row.count]))));
  assert.equal(ROUTINE_SOURCE_CONTRACTS.filter(row => row.id.startsWith("fec-funding:")).length, FEC_STATES.length);
  assert.equal(ROUTINE_SOURCE_CONTRACTS.some(row => row.id === "fec-funding"), false);
  for (const state of FEC_STATES) {
    const contract = ROUTINE_SOURCE_CONTRACTS.find(row => row.id === fecFundingContractId(state))!;
    assert.equal(contract.scope, fecFundingScope(state)); assert.ok(contract.acquisitionAdapter.command.includes(`--state=${state}`));
    assert.equal(contract.cadence.defaultEveryMs, 7 * 86_400_000); assert.equal(contract.retry.afterMs, 6 * 3_600_000);
  }
});

test("state FEC discovery requires and checks the API state filter on both chambers and totals", async () => {
  const data = (name: string) => parseFecPage(readFileSync(`${ROOT}/${name}`, "utf8")).results.filter(row => row.state === "TX");
  let calls = 0;
  const read: FecReadPage = async (path, params) => {
    calls++; assert.equal(params.state, "TX");
    const results = data(path === "/candidates/totals/" ? "totals.json" : params.office === "H" ? "candidates-h.json" : "candidates-s.json").filter(row => row.office === params.office);
    return { results, pagination: { count: results.length, pages: 1 }, sourceObservedAt: NOW };
  };
  const found = await discoverFecCandidates({ state: "TX", cycle, read, observedAt: () => NOW, bulk: async () => { throw new Error("unexpected bulk"); } });
  assert.equal(calls, 4); assert.ok(found.registrations.every(row => row.state === "TX"));
  const fallback = await discoverFecCandidates({ state: "TX", cycle, observedAt: () => NOW, bulk: () => bulk("TX"), read: async () => {
    const results = parseFecPage(readFileSync(`${ROOT}/candidates-h.json`, "utf8")).results;
    return { results, pagination: { count: results.length, pages: 1 } };
  } });
  assert.equal(fallback.route, "bulk"); assert.ok(fallback.registrations.every(row => row.state === "TX"));
});

test("committee pagination reconciles amendments on disk while keeping only current public organization receipts", async () => {
  const committee = "C00000001", receipt = (id: string, amount: number) => ({ sub_id: id, transaction_id: `T${id}`, file_number: id, report_year: 2026, report_type: "Q1",
    committee_id: committee, entity_type: "PAC", line_number: "11C", contributor_name: `Organization ${id}`, contribution_receipt_amount: amount });
  let calls = 0;
  const rows = await collectFecOrganizationReceipts(async (_path, params) => {
    if (!calls++) return { results: [receipt("1", 100), { ...receipt("2", 1000), entity_type: "IND", contributor_name: "Private Canary" }], pagination: { count: 4, last_indexes: { last_index: "2", last_contribution_receipt_amount: 100 } }, sourceObservedAt: NOW };
    assert.equal(params.last_index, "2");
    return { results: [{ ...receipt("3", 75), original_sub_id: "1" }, receipt("4", 50)], pagination: { count: 4 }, sourceObservedAt: NOW };
  }, committee, cycle, row => fecOrganizationRows([row], committee));
  assert.equal(calls, 2); assert.deepEqual(rows.map(row => row.amount), [75, 50]);
  assert.ok(rows.every(row => row.sourceObservedAt === NOW)); assert.ok(!JSON.stringify(rows).includes("Private Canary"));
});

test("legacy funding transfers only the selected state plus its needed committee books and refresh keys", async () => {
  const pg = new PGlite(), own = projectFecDiscovery(await bulk("TX"), cycle)[0];
  own.topContributions = [{ dataClass: "FEC_CONTRIBUTOR", kind: "COMMITTEE_OR_ORGANIZATION", contributorName: "Needed organization", contributorCommitteeId: "C00000001", amount: 75,
    receiptDate: null, city: null, state: null, entityType: "PAC", lineNumber: "11C", committeeType: null, organizationType: null, designation: null }];
  const foreign = { ...own, fecCandidateId: "H0NJ00001", state: "NJ", name: "Other state country payload ".repeat(50_000) };
  const payload = { formatVersion: 1, cycle, fetchedAt: NOW, candidates: [foreign, own], absences: [],
    matchReport: { rosterMatched: 0, rosterTotal: 0, ballotMatched: 0, ballotTotal: 0 }, secondHop: [{ committeeId: "C00000001", name: "Needed books" }, { committeeId: "C00000002", name: "Other books ".repeat(50_000) }],
    refreshAttempts: { [own.fecCandidateId]: NOW, C00000001: NOW, H0NJ00001: "Other attempt ".repeat(50_000), C00000002: NOW } };
  const encoded = partitionCivicPayload(payload), store = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
  store.readPromotion = async () => null;
  let transferred = "";
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, { id: "legacy-fec", sourceId: "fec-open-api", recordClass: "FEC_FUNDING", scope: "federal-supported", readModel: payload, storedReadModel: encoded.value, at: NOW });
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows; transferred += JSON.stringify(rows); return rows;
    })));
    const read = await readFecStateSnapshot("TX", { store });
    assert.equal(read.kind, "PROMOTED"); if (read.kind !== "PROMOTED") throw new Error("missing legacy read");
    assert.deepEqual(read.value.candidates.map(row => row.fecCandidateId), [own.fecCandidateId]);
    assert.deepEqual(read.value.secondHop?.map(row => row.committeeId), ["C00000001"]);
    assert.deepEqual(Object.keys(read.value.refreshAttempts ?? {}).sort(), ["C00000001", own.fecCandidateId].sort());
    assert.equal(read.metadata.scope, "federal-supported"); assert.equal(read.metadata.versionId, "legacy-fec");
    assert.ok(!transferred.includes("Other state country") && !transferred.includes("Other books") && !transferred.includes("Other attempt"));
    assert.equal(read.sourceInput?.readModelSha256, canonicalCivicDataHash(payload));
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});

test("state candidates cannot carry another state's money and retain a complete empty source horizon", async () => {
  const rows = projectFecDiscovery(await bulk("TX"), cycle), snapshot = { formatVersion: 1 as const, cycle, fetchedAt: NOW, candidates: rows, absences: [],
    matchReport: { rosterMatched: 0, rosterTotal: 0, ballotMatched: 0, ballotTotal: 0 } };
  const candidate = fecFundingCandidate({ state: "TX", snapshot, rawBodies: ["captured"], finalUrl: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", retrievedAt: NOW, excludedFacts: [] });
  assert.equal(candidate.scope, fecFundingScope("TX")); assert.ok(candidate.identities.every(row => row.jurisdiction === "US-TX"));
  assert.throws(() => fecFundingCandidate({ state: "NJ", snapshot, rawBodies: ["captured"], finalUrl: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", retrievedAt: NOW, excludedFacts: [] }), /STATE_BOUNDARY/);
  const empty = fecFundingCandidate({ state: "AS", snapshot: { ...snapshot, candidates: [] }, rawBodies: ["captured complete state query"], finalUrl: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", retrievedAt: NOW, excludedFacts: [] });
  assert.equal(empty.absence.claimsAbsence, true); assert.equal(empty.horizon.paginationComplete, true); assert.deepEqual((empty.readModel as { absences: unknown[] }).absences, []);
});


test("state publication confirms an unchanged snapshot, holds LKG on source failure, and promotes a complete empty state", async () => {
  const store = new MemoryRoutineDataStore(), state = "TX";
  const snapshot = { formatVersion: 1 as const, cycle, fetchedAt: NOW, candidates: projectFecDiscovery(await bulk(state), cycle), absences: [],
    matchReport: { rosterMatched: 0, rosterTotal: 0, ballotMatched: 0, ballotTotal: 0 } };
  const candidate = fecFundingCandidate({ state, snapshot, rawBodies: ["captured"], finalUrl: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", retrievedAt: NOW, excludedFacts: [] });
  const promoted = await processRegisteredRoutineCandidate(store, fecFundingContractId(state), candidate, NOW);
  assert.ok(promoted.promoted, JSON.stringify(promoted.candidate.receipt));
  assert.equal(promoted.readerReadback?.status, "PASS", JSON.stringify(promoted.readerReadback));
  const at = "2026-10-20T01:00:00Z", recheck = { ...candidate, id: `cv-${"f".repeat(32)}`, retrieval: { ...candidate.retrieval, retrievedAt: at } };
  const unchanged = await processRegisteredRoutineCandidate(store, fecFundingContractId(state), recheck, at);
  assert.ok(unchanged.confirmed); assert.equal(unchanged.confirmed.versionId, candidate.id);
  assert.equal(await store.readCandidateSummary(recheck.id), null);
  const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: fecFundingContractId(state), attemptedAt: "2026-10-20T02:00:00Z",
    requestedUrl: "https://api.open.fec.gov/v1/", failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "FEC unavailable") });
  assert.equal(failed.outcome.candidate.state, "SOURCE_BLOCKED"); assert.equal(failed.receipt.lastKnownGoodVersion, candidate.id);
  assert.equal((await store.readPromotion("FEC_FUNDING", fecFundingScope(state)))?.versionId, candidate.id);
  const empty = fecFundingCandidate({ state: "AS", snapshot: { ...snapshot, candidates: [] }, rawBodies: ["captured complete AS state query"], finalUrl: "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip", retrievedAt: NOW, excludedFacts: [] });
  const outcome = await processRegisteredRoutineCandidate(store, fecFundingContractId("AS"), empty, NOW);
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
  assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
  const emptyHeld = await store.readPromotion<{ candidates: unknown[]; absences: unknown[] }>("FEC_FUNDING", fecFundingScope("AS"));
  assert.deepEqual(emptyHeld?.payload.candidates, []); assert.deepEqual(emptyHeld?.payload.absences, []);
});


test("place FEC reads filter native target arrays and state before transfer and never revive old rows after a state publication", async () => {
  const pg = new PGlite(), base = projectFecDiscovery(await bulk("TX"), cycle)[0];
  const own = { ...base, fecCandidateId: "H8TX07140", office: "H" as const, district: "07", targetKeys: ["congress:F000468", "fec:H8TX07140"] };
  const other = { ...base, fecCandidateId: "H0TX08001", office: "H" as const, district: "08", targetKeys: ["fec:H0TX08001"], name: "Unneeded same-state record ".repeat(40_000) };
  const foreign = { ...own, fecCandidateId: "H0NJ07001", state: "NJ", name: "Forbidden other-state record ".repeat(40_000) };
  const senator = { ...base, fecCandidateId: "S0TX00001", office: "S" as const, district: null, targetKeys: ["fec:S0TX00001"] };
  const snapshot = { formatVersion: 1 as const, cycle, fetchedAt: NOW, candidates: [other, foreign, own, senator], absences: [], secondHop: [], refreshAttempts: {},
    matchReport: { rosterMatched: 0, rosterTotal: 0, ballotMatched: 0, ballotTotal: 0 } };
  const store = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore; store.readPromotion = async () => null;
  let transferred = "";
  const publish = async (scope: string, id: string, readModel: typeof snapshot) => {
    const encoded = partitionCivicPayload(readModel);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, { id, sourceId: "fec-open-api", recordClass: "FEC_FUNDING", scope, readModel, storedReadModel: encoded.value, at: NOW });
  };
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA); await publish("federal-supported", "legacy-place-fec", snapshot);
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows; transferred += JSON.stringify(rows); return rows;
    })));
    const read = await readFecStateSnapshot("TX", { store, targetKeys: ["congress:F000468"] });
    assert.equal(read.kind, "PROMOTED"); if (read.kind !== "PROMOTED") throw new Error("Missing place funding");
    assert.deepEqual(read.value.candidates.map(row => row.fecCandidateId), [own.fecCandidateId]);
    assert.ok(!transferred.includes("Unneeded same-state") && !transferred.includes("Forbidden other-state"));
    transferred = "";
    const district = await readFecStateSnapshot("TX", { store, districts: ["07"] });
    assert.equal(district.kind, "PROMOTED"); if (district.kind === "PROMOTED") assert.deepEqual(district.value.candidates.map(row => row.fecCandidateId), [own.fecCandidateId, senator.fecCandidateId]);
    assert.ok(!transferred.includes("Unneeded same-state") && !transferred.includes("Forbidden other-state"));
    await publish(fecFundingScope("TX"), "current-place-fec", { ...snapshot, candidates: [other] });
    const current = await readFecStateSnapshot("TX", { store, targetKeys: ["congress:F000468"] });
    assert.equal(current.kind, "PROMOTED"); if (current.kind === "PROMOTED") { assert.deepEqual(current.value.candidates, []); assert.equal(current.metadata.versionId, "current-place-fec"); }
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
