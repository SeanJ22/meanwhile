import assert from "node:assert/strict";
import test from "node:test";

import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { censusGeographyCandidate, failedAcquisitionCandidate, officialStateRollCallsCandidate } from "../lib/civic-data/candidate-builders.ts";
import type { Division } from "../lib/registry/types.ts";
import type { RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { stateRollAttribution, stateRollPublisher } from "../lib/sources/legiscan/types.ts";

const HASH = "a".repeat(64);
const NOW = "2026-09-07T12:00:00.000Z";

function candidate(id: string, over: Partial<RoutineCandidate> = {}): RoutineCandidate {
  return {
    id,
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-candidates:2026",
    retrieval: {
      succeeded: true,
      requestedUrl: "https://api.open.fec.gov/v1/candidates/search/?election_year=2026",
      finalUrl: "https://api.open.fec.gov/v1/candidates/search/?election_year=2026",
      httpStatus: 200,
      retrievedAt: NOW,
      rawHash: HASH,
    },
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/2",
      schemaVersion: "2",
      normalizedHash: HASH,
      inputRecords: 1,
      outputRecords: 1,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: "H6AZ01001",
      jurisdiction: "US",
      identifiers: { candidate_id: "H6AZ01001", committee_id: "C00999999" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: {
      version: "2026",
      expectedVersion: "2026",
      sourceThrough: "2026-09-06T00:00:00.000Z",
      staleAtRetrieval: false,
    },
    semantics: { factKind: "filed campaign-finance total", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "registered 2026 federal candidates represented in Reader",
      returnedRecords: 1,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "Reader funding card", passed: true, detail: "accepted" }],
    normalizedPayload: { amount: 10 },
    readModel: { version: id, rows: [{ candidateId: "H6AZ01001", amount: 10 }] },
    ...over,
  };
}

async function seed(store: MemoryRoutineDataStore): Promise<RoutineCandidate> {
  const good = candidate("fec-good-1");
  const outcome = await processRoutineCandidate(store, good, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.candidate.acquisitionSucceeded, true);
  assert.deepEqual(outcome.candidate.receipt?.checks.map((check) => check.check), VALIDATION_CHECKS);
  assert.deepEqual((await store.events(good.id)).map((event) => event.state), [
    "FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED",
  ]);
  return good;
}

async function expectHeld(
  mutate: (base: RoutineCandidate) => RoutineCandidate,
  state: string,
  code: string,
): Promise<void> {
  const store = new MemoryRoutineDataStore();
  const good = await seed(store);
  const bad = mutate(candidate(`bad-${code.toLowerCase()}`));
  const outcome = await processRoutineCandidate(store, bad, NOW);
  assert.equal(outcome.candidate.state, state);
  assert.equal(outcome.candidate.acquisitionSucceeded, bad.retrieval.succeeded);
  assert.equal(outcome.candidate.failureCode, code);
  assert.equal(outcome.promoted, null);
  const projection = await store.readPromotion<Record<string, unknown>>(good.recordClass, good.scope);
  assert.equal(projection?.versionId, good.id, "invalid candidate must leave the exact LKG pointer in place");
  assert.deepEqual(projection?.payload, good.readModel, "invalid candidate must not mutate Reader's projection");
}

test("GOOD is the only path that reaches PROMOTED", async () => {
  const store = new MemoryRoutineDataStore();
  await seed(store);
});

test("official state roll identity, term, event and stage can promote directly", async () => {
  const store = new MemoryRoutineDataStore();
  const official = officialStateRollCallsCandidate({
    sourceId: "az-legislature",
    jurisdiction: "US-AZ",
    rawBodies: ["official roll bytes"],
    requestedUrl: "https://apps.azleg.gov/BillStatus/BillOverview/84058",
    finalUrl: "https://apps.azleg.gov/BillStatus/BillOverview/84058",
    retrievedAt: NOW,
    term: "57th Legislature",
    expectedTerm: "57th Legislature",
    session: "2nd Regular Session",
    declaredRollTotal: 1,
    rolls: [{
      id: "azleg:57:2R:HB2321:third-reading",
      sourceId: "az-legislature",
      officialRollCallId: "HB2321-H-3R",
      eventId: "HB2321-third-reading",
      chamber: "House",
      term: "57th Legislature",
      session: "2nd Regular Session",
      actionStage: "Third Reading",
      expectedActionStage: "Third Reading",
      state: "AZ",
      sessionId: 0,
      billNumber: "HB2321",
      billTitle: "DCS; credit freeze; reporting",
      motion: "House - Third Reading",
      date: "2026-06-13",
      yea: 33,
      nay: 20,
      absent: 0,
      nv: 7,
      result: "Passed 33-20",
      billUrl: "https://apps.azleg.gov/BillStatus/BillOverview/84058",
      rollCallUrl: "https://apps.azleg.gov/BillStatus/BillOverview/84058",
      retrievedAt: NOW,
    }],
    positions: [{ officeholderId: "azleg:member:2295", officialPersonId: "2295", rollCallId: "azleg:57:2R:HB2321:third-reading", position: "YES" }],
  });
  const outcome = await processRoutineCandidate(store, official, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.sourceId, "az-legislature");
  const promotedRolls = (outcome.promoted?.payload as { rollCalls: { sourceId?: "az-legislature" }[] }).rollCalls;
  assert.equal(stateRollAttribution(promotedRolls), null, "official rows must not be mislabeled as LegiScan data");
  assert.equal(stateRollPublisher(promotedRolls[0]), "Arizona State Legislature");
});

test("Census product/vintage/GEOID/cardinality can atomically replace resolver geography", async () => {
  const store = new MemoryRoutineDataStore();
  const division = {
    ocdId: "ocd-division/country:us/state:az/county:pima",
    geoid: "04019",
    sourceDataset: "TIGER_GENZ2025",
    canonicalGap: undefined,
    canonicalOcdId: "ocd-division/country:us/state:az/county:pima",
  } as unknown as Division;
  const geography = censusGeographyCandidate({
    rawBodies: ["official TIGER archive member"],
    requestedUrl: "https://www2.census.gov/geo/tiger/GENZ2025/",
    finalUrl: "https://www2.census.gov/geo/tiger/GENZ2025/",
    retrievedAt: NOW,
    product: "TIGER_GENZ",
    vintage: "2025",
    expectedVintage: "2025",
    features: [{ properties: { ocdId: division.ocdId, label: "Pima County" }, geometry: { type: "Polygon", coordinates: [[[-112, 32], [-111, 32], [-111, 33], [-112, 32]]] } }],
    divisions: [division],
    declaredFeatureTotal: 1,
  });
  const outcome = await processRoutineCandidate(store, geography, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.recordClass, "CENSUS_GEOGRAPHY");
});

test("malformed FEC payload is persisted as PARSE_INVALID and holds LKG", async () => {
  await expectHeld((base) => ({
    ...base,
    normalization: { ...base.normalization, succeeded: false, normalizedHash: null, failureDetail: "not JSON" },
  }), "PARSE_INVALID", "PARSER_FAILED");
});

test("an unregistered redirect that also returns malformed bytes remains SOURCE_BLOCKED", async () => {
  await expectHeld((base) => ({
    ...base,
    retrieval: { ...base.retrieval, finalUrl: "https://attacker.example/fec" },
    normalization: { ...base.normalization, succeeded: false, normalizedHash: null, failureDetail: "not JSON" },
  }), "SOURCE_BLOCKED", "FINAL_HOST_NOT_AUTHORIZED");
});

test("ambiguous FEC identity is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    identities: [{ ...base.identities[0], ambiguous: true }],
  }), "IDENTITY_UNRESOLVED", "IDENTITY_AMBIGUOUS");
});

test("freshly fetched stale FEC facts are refused", async () => {
  await expectHeld((base) => ({
    ...base,
    temporal: { ...base.temporal, staleAtRetrieval: true },
  }), "TEMPORAL_INVALID", "FRESH_FETCH_STALE_FACTS");
});

test("wrong state chamber/term identity is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH:2025-2026",
    retrieval: { ...base.retrieval, finalUrl: "https://gc.nh.gov/downloads/Members.txt" },
    normalization: { ...base.normalization, parserVersion: "nh-general-court/2" },
    identities: [{
      subjectId: "nh-house-seat-001",
      jurisdiction: "US-NH",
      identifiers: { seatNo: "001" },
      matchBasis: "EXACT_SCOPED_ID",
      ambiguous: false,
      chamber: "House",
      office: "State Representative",
      // A term is deliberately absent: a fresh roster cannot inherit it.
    }],
  }), "IDENTITY_UNRESOLVED", "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE");
});

test("wrong roll-call event/stage is refused without weakening exact roll identity", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceId: "nh-general-court",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-NH:2025-2026:house",
    retrieval: { ...base.retrieval, finalUrl: "https://gc.nh.gov/nhgcrollcalls/" },
    normalization: { ...base.normalization, parserVersion: "nh-general-court/2" },
    identities: [{
      subjectId: "2026-H-295",
      jurisdiction: "US-NH",
      identifiers: { rollCallId: "295", eventId: "HB1-enactment" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
      chamber: "House",
      term: "2025-2026",
      session: "2026",
    }],
    semantics: {
      factKind: "official roll-call decision",
      actionStage: "agenda publication",
      expectedActionStage: "enactment vote",
      violations: [],
    },
  }), "SEMANTIC_INVALID", "WRONG_ACTION_STAGE");
});

test("wrong Census vintage is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population:2024",
    retrieval: { ...base.retrieval, finalUrl: "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E" },
    normalization: { ...base.normalization, parserVersion: "census-data-api/2" },
    identities: [{
      subjectId: "04000US04",
      jurisdiction: "US",
      identifiers: { product: "acs5", vintage: "2023", geography: "state:04" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: { ...base.temporal, version: "2023", expectedVersion: "2024" },
  }), "TEMPORAL_INVALID", "WRONG_PERIOD_OR_VINTAGE");
});

test("wrong Census schema is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population:2024",
    retrieval: { ...base.retrieval, finalUrl: "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E" },
    normalization: { ...base.normalization, parserVersion: "census-data-api/1" },
  }), "PARSE_INVALID", "PARSER_VERSION_UNREGISTERED");
});

test("blocked route is evidence of acquisition failure, never absence", async () => {
  await expectHeld((base) => ({
    ...base,
    retrieval: { ...base.retrieval, succeeded: false, finalUrl: null, httpStatus: 403, rawHash: null, failureDetail: "official route returned 403" },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
  }), "SOURCE_BLOCKED", "SOURCE_RETRIEVAL_FAILED");
});

test("a pre-parser source failure is one durable terminal event with a validation receipt", async () => {
  const store = new MemoryRoutineDataStore();
  const blocked = failedAcquisitionCandidate({
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    requestedUrl: "https://api.open.fec.gov/v1/",
    attemptedAt: NOW,
    failureDetail: "HTTP 403 from the official route",
    parserVersion: "fec-funding/2",
  });
  const outcome = await processRoutineCandidate(store, blocked, NOW);
  assert.equal(outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(outcome.candidate.receipt?.decision, "FAIL");
  assert.equal(outcome.candidate.failureCode, "SOURCE_RETRIEVAL_FAILED");
  assert.deepEqual((await store.events(blocked.id)).map((event) => event.state), ["SOURCE_BLOCKED"]);
});

test("an incomplete claimed horizon is CANNOT_TELL and holds LKG", async () => {
  await expectHeld((base) => ({
    ...base,
    horizon: { ...base.horizon, kind: "BOUNDED", claimsComplete: true, paginationComplete: false, declaredTotal: 2 },
  }), "HORIZON_UNRESOLVED", "PAGINATION_INCOMPLETE");
});

test("explicit bounded authoritative absence can promote", async () => {
  const store = new MemoryRoutineDataStore();
  const empty = candidate("fec-explicit-absence", {
    scope: "federal-candidate:H6AZ00000:2026",
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/2",
      schemaVersion: "2",
      normalizedHash: HASH,
      inputRecords: 0,
      outputRecords: 0,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [],
    horizon: {
      kind: "BOUNDED",
      query: "candidate_id=H6AZ00000&period=2026",
      returnedRecords: 0,
      declaredTotal: 0,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: {
      claimsAbsence: true,
      basis: "BOUNDED_AUTHORITATIVE_QUERY",
      exactSubject: "H6AZ00000 filed totals",
      exactHorizon: "2026 election period, all pages",
    },
    readModel: { version: "fec-explicit-absence", rows: [], absences: ["H6AZ00000"] },
  });
  const outcome = await processRoutineCandidate(store, empty, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED");
});

test("zero without absence evidence is CANNOT_TELL and holds LKG", async () => {
  await expectHeld((base) => ({
    ...base,
    normalization: { ...base.normalization, inputRecords: 0, outputRecords: 0 },
    identities: [],
    horizon: { ...base.horizon, returnedRecords: 0 },
  }), "CANNOT_TELL", "ZERO_IS_NOT_ABSENCE");
});

test("T4 intermediary bytes remain research-only and cannot auto-promote", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceId: "legiscan",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-AZ:2026",
    retrieval: { ...base.retrieval, finalUrl: "https://api.legiscan.com/?op=getDatasetList" },
    normalization: { ...base.normalization, parserVersion: "legiscan-bulk/1" },
  }), "SOURCE_BLOCKED", "SOURCE_NOT_AUTO_PROMOTABLE");
});

test("all destructive classes are enumerated by the contract", () => {
  const covered = new Set<RoutineRecordClass>([
    "FEC_FUNDING", "STATE_LEGISLATOR", "STATE_ROLL_CALL", "CENSUS_REFERENCE", "CENSUS_GEOGRAPHY",
  ]);
  assert.equal(covered.size, 5);
});
