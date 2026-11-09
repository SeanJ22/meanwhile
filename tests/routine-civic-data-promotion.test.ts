import assert from "node:assert/strict";
import test from "node:test";

import { processRegisteredRoutineCandidate,
  routineCandidateContractIssue } from "../lib/civic-data/promotion.ts";
import { processRoutineCandidate } from "../lib/civic-data/candidate-lifecycle.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { failedAcquisitionCandidate, fecFundingCandidate, normalizedHash, officialStateRollCallsCandidate } from "../lib/civic-data/candidate-builders.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import { sourceProjectionEvidence, type CandidateVersionRecord, type RoutineCandidate, type RoutineRecordClass } from "../lib/civic-data/types.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { stateRollAttribution, stateRollPublisher } from "../lib/sources/legiscan/types.ts";
import { parseReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import {
  recordRoutineReaderProjectionReadback,
} from "../lib/civic-data/reader-verification.ts";

const HASH = "a".repeat(64);
const NOW = "2026-09-07T12:00:00.000Z";
const READER_CODE_SHA_A = "c".repeat(40);

test("opaque worker editions use real source chronology while stale and unexpected versions remain refused", () => {
  for (const [recordClass, sourceId, prefix] of [
    ["REGISTRY_RUNTIME_BINDING", "registry-reviewed-bindings", "worker-roster"],
    ["CURATED_READER_RECORD", "curated-reader-primary-sources", "worker"],
  ] as const) {
    const base = candidate("worker-order-before", { recordClass, sourceId });
    const priorVersion = `${prefix}:wr-${"f".repeat(24)}`;
    const nextVersion = `${prefix}:wr-${"0".repeat(24)}`;
    const prior: CandidateVersionRecord = { candidate: { ...base, temporal: { ...base.temporal,
      version: priorVersion, expectedVersion: priorVersion, sourceThrough: "2026-09-06T00:00:00.000Z" } },
      state: "PROMOTED", acquisitionSucceeded: true, receipt: null, promotedVersion: base.id,
      lastKnownGoodVersion: null, failureCode: null, failureDetail: null };
    const next = { ...base, id: "worker-order-after", temporal: { ...base.temporal,
      version: nextVersion, expectedVersion: nextVersion, sourceThrough: "2026-09-07T00:00:00.000Z" } };
    const temporal = (value: RoutineCandidate) => validateRoutineCandidate(value, prior, NOW).receipt.checks.find(check => check.check === "TEMPORAL_VALIDITY")!;
    assert.equal(temporal(next).verdict, "PASS", "random audit hash order cannot reject a later source");
    assert.equal(temporal({ ...next, temporal: { ...next.temporal, sourceThrough: "2026-09-05T00:00:00.000Z" } }).code, "SOURCE_THROUGH_REGRESSION");
    assert.equal(temporal({ ...next, temporal: { ...next.temporal, expectedVersion: "different" } }).code, "WRONG_PERIOD_OR_VINTAGE");
    assert.equal(temporal({ ...next, temporal: { ...next.temporal, sourceThrough: "unresolved" } }).code, "WORKER_SOURCE_CHRONOLOGY_UNKNOWN");
    assert.equal(temporal({ ...next, retrieval: { ...next.retrieval, retrievedAt: "2026-09-06T12:00:00.000Z" } }).code, "ACQUISITION_TIME_REGRESSION");
  }
});

test("the generic transition driver cannot write a production store outside an exact registered contract door", async () => {
  // Avoid opening a database connection: the authority refusal must happen
  // before the generic driver can perform even its first store read.
  const productionStore = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
  await assert.rejects(
    processRoutineCandidate(productionStore, candidate("unregistered-production-candidate"), NOW),
    /PRODUCTION_PROMOTION_REQUIRES_REGISTERED_CONTRACT_DOOR/,
  );
  await assert.rejects(
    processRoutineCandidate(productionStore, candidate("forged-admission"), NOW, undefined, Symbol("REGISTERED_PRODUCTION_DOOR")),
    /PRODUCTION_PROMOTION_REQUIRES_REGISTERED_CONTRACT_DOOR/,
  );
});

function candidate(id: string, over: Partial<RoutineCandidate> = {}): RoutineCandidate {
  const built: RoutineCandidate = {
    id,
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-candidates:2026",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-candidates:2026"),
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
      parserVersion: "fec-funding/4",
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
  if (!built.normalization.succeeded) return built;
  return {
    ...built,
    normalization: {
      ...built.normalization,
      normalizedHash: normalizedHash(built.readModel),
      normalizedPayloadHash: normalizedHash(built.normalizedPayload),
    },
  };
}

function stateMemberCandidate(id: string): RoutineCandidate {
  return candidate(id, {
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    sourceProjectionEvidence: sourceProjectionEvidence("nh-general-court", "STATE_LEGISLATOR", "US-NH"),
    retrieval: {
      succeeded: true,
      requestedUrl: "https://gc.nh.gov/downloads/Members.txt",
      finalUrl: "https://gc.nh.gov/downloads/Members.txt",
      httpStatus: 200,
      retrievedAt: NOW,
      rawHash: HASH,
    },
    normalization: { succeeded: true, parserVersion: "nh-general-court/3", schemaVersion: "Members.txt:2025-2026", normalizedHash: HASH, inputRecords: 1, outputRecords: 1, droppedRecords: 0, missingRequiredFields: [] },
    identities: [{ subjectId: "nh-house-seat-001", jurisdiction: "US-NH", identifiers: { seatNo: "001", chamber: "H", district: "Merrimack 1" }, matchBasis: "OFFICIAL_ID", ambiguous: false, chamber: "H", office: "Representative", term: "2025-2026", district: "Merrimack 1" }],
    temporal: { version: "2025-2026", expectedVersion: "2025-2026", sourceThrough: NOW, staleAtRetrieval: false },
    semantics: { factKind: "current legislative membership", violations: [] },
    horizon: { kind: "BOUNDED", query: "complete Members.txt", returnedRecords: 1, declaredTotal: 1, paginationComplete: true, claimsComplete: true },
    readModel: { formatVersion: 1, jurisdiction: "US-NH", term: "2025-2026", members: [{ seatNo: "001", chamber: "H" }] },
  });
}

function stateRollCandidate(id: string): RoutineCandidate {
  return candidate(id, {
    sourceId: "nh-general-court",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-NH:2025-2026:house",
    sourceProjectionEvidence: sourceProjectionEvidence("nh-general-court", "STATE_ROLL_CALL", "US-NH:2025-2026:house"),
    retrieval: { succeeded: true, requestedUrl: "https://gc.nh.gov/nhgcrollcalls/", finalUrl: "https://gc.nh.gov/nhgcrollcalls/", httpStatus: 200, retrievedAt: NOW, rawHash: HASH },
    normalization: { succeeded: true, parserVersion: "nh-general-court/3", schemaVersion: "official-rolls:2025-2026", normalizedHash: HASH, inputRecords: 1, outputRecords: 1, droppedRecords: 0, missingRequiredFields: [] },
    identities: [{ subjectId: "2026-H-295", jurisdiction: "US-NH", identifiers: { rollCallId: "295", eventId: "HB1-enactment" }, matchBasis: "OFFICIAL_ID", ambiguous: false, chamber: "House", term: "2025-2026", session: "2026" }],
    temporal: { version: "2025-2026", expectedVersion: "2025-2026", sourceThrough: NOW, staleAtRetrieval: false },
    semantics: { factKind: "official roll-call decision", actionStage: "enactment vote", expectedActionStage: "enactment vote", violations: [] },
    horizon: { kind: "BOUNDED", query: "official House roll 295", returnedRecords: 1, declaredTotal: 1, paginationComplete: true, claimsComplete: true },
    readModel: { formatVersion: 1, jurisdiction: "US-NH", term: "2025-2026", session: "2026", rolls: [{ id: "2026-H-295" }], positions: [] },
  });
}

function censusReferenceCandidate(id: string): RoutineCandidate {
  return candidate(id, {
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    sourceProjectionEvidence: sourceProjectionEvidence("census-data-api", "CENSUS_REFERENCE", "acs-population"),
    retrieval: { succeeded: true, requestedUrl: "https://api.census.gov/data/2024/acs/acs5", finalUrl: "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E", httpStatus: 200, retrievedAt: NOW, rawHash: HASH },
    normalization: { succeeded: true, parserVersion: "census-data-api/3", schemaVersion: "ACSDT5Y2024:B01003", normalizedHash: HASH, inputRecords: 1, outputRecords: 1, droppedRecords: 0, missingRequiredFields: [] },
    identities: [{ subjectId: "04000US04", jurisdiction: "US", identifiers: { product: "acs5", vintage: "2024", geography: "state:04" }, matchBasis: "OFFICIAL_ID", ambiguous: false }],
    temporal: { version: "2024", expectedVersion: "2024", sourceThrough: "2024", staleAtRetrieval: false },
    semantics: { factKind: "ACS 5-year population estimate", violations: [] },
    horizon: { kind: "BOUNDED", query: "state:04", returnedRecords: 1, declaredTotal: 1, paginationComplete: true, claimsComplete: true },
    readModel: { formatVersion: 1, vintage: 2024, zcta: [], state: [{ code: "04", population: 1, marginOfError: null }] },
  });
}

async function seed(store: MemoryRoutineDataStore, good: RoutineCandidate = candidate("fec-good-1")): Promise<RoutineCandidate> {
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
  good: RoutineCandidate = candidate("fec-good-1"),
): Promise<void> {
  const store = new MemoryRoutineDataStore();
  await seed(store, good);
  const bad = mutate({ ...structuredClone(good), id: `bad-${code.toLowerCase()}` });
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

test("duplicate civic member keys are refused before a delta or pointer can collapse facts", async () => {
  await expectHeld(
    (base) => ({
      ...base,
      civicRecords: [
        { key: "candidate:H6AZ01001", record: { amount: 10 } },
        { key: "candidate:H6AZ01001", record: { amount: 20 } },
      ],
    }),
    "PARSE_INVALID",
    "CIVIC_RECORD_KEYS_DUPLICATED",
  );
});

test("a normalized payload whose declared digest names different bytes is refused before LKG moves", async () => {
  await expectHeld((base) => ({
    ...base,
    normalizedPayload: { amount: 11 },
  }), "PARSE_INVALID", "NORMALIZED_PAYLOAD_HASH_MISMATCH");
});

test("a Reader projection whose declared digest names different bytes is refused before LKG moves", async () => {
  await expectHeld((base) => ({
    ...base,
    readModel: { version: "tampered", rows: [{ candidateId: "H6AZ01001", amount: 99 }] },
  }), "PARSE_INVALID", "NORMALIZED_READ_MODEL_HASH_MISMATCH");
});

test("a registered production candidate must bind its normalized evidence, not only its Reader payload", async () => {
  const store = new MemoryRoutineDataStore();
  const exact = candidate("registered-evidence-hash-missing", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { formatVersion: 1, candidates: [], absences: [] },
  });
  const withoutEvidenceDigest: RoutineCandidate = {
    ...exact,
    normalization: { ...exact.normalization, normalizedPayloadHash: undefined },
  };
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", withoutEvidenceDigest, NOW);
  assert.equal(outcome.promoted, null);
  assert.equal(outcome.candidate.state, "PARSE_INVALID");
  assert.equal(outcome.candidate.failureCode, "NORMALIZED_PAYLOAD_HASH_MISSING");
  assert.equal(await store.readPromotion("FEC_FUNDING", "federal-supported"), null);
});

test("a supplied civic-member projection cannot hide or replace the members derived from Reader", async () => {
  await expectHeld((base) => ({
    ...base,
    civicRecords: [{ key: "candidate:forged", record: { amount: 999 } }],
  }), "PARSE_INVALID", "CIVIC_RECORD_PROJECTION_MISMATCH");
});

test("an unexplained removal from any OPEN/incomplete horizon is refused generically", async () => {
  const firstIdentity = candidate("shape").identities[0]!;
  const good = candidate("open-horizon-two-records", {
    normalization: { ...candidate("shape").normalization, inputRecords: 2, outputRecords: 2 },
    horizon: { ...candidate("shape").horizon, returnedRecords: 2 },
    identities: [firstIdentity, { ...firstIdentity, subjectId: "H6AZ01002", identifiers: { candidate_id: "H6AZ01002" } }],
    readModel: { candidates: [
      { fecCandidateId: "H6AZ01001", amount: 10 },
      { fecCandidateId: "H6AZ01002", amount: 20 },
    ] },
  });
  await expectHeld((base) => {
    const readModel = { candidates: [{ fecCandidateId: "H6AZ01001", amount: 10 }] };
    return {
      ...base,
      normalization: {
        ...base.normalization,
        normalizedHash: normalizedHash(readModel),
        inputRecords: 1,
        outputRecords: 1,
      },
      horizon: { ...base.horizon, returnedRecords: 1 },
      identities: base.identities.slice(0, 1),
      readModel,
    };
  }, "HORIZON_UNRESOLVED", "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED", good);
});

test("the standing promotion door binds adapter output to its exact registered contract", () => {
  const exact = candidate("registered-fec", { scope: "federal-supported" });
  assert.equal(routineCandidateContractIssue("fec-funding", exact), null);
  assert.match(routineCandidateContractIssue("fec-funding", { ...exact, scope: "other" }) ?? "", /scope/);
  assert.match(routineCandidateContractIssue("fec-funding", { ...exact, sourceId: "census-data-api" }) ?? "", /source/);
  assert.match(routineCandidateContractIssue("fec-funding", { ...exact, recordClass: "CENSUS_REFERENCE" }) ?? "", /record class/);
  assert.match(routineCandidateContractIssue("fec-funding", { ...exact, normalization: { ...exact.normalization, parserVersion: "fec-funding\/1" } }) ?? "", /parser/);
  assert.match(routineCandidateContractIssue("fec-funding", { ...exact, retrieval: { ...exact.retrieval, requestedUrl: "https://example.gov/" } }) ?? "", /FINAL_ROUTE_NOT_REGISTERED/);
});

test("registered promotion confirms its atomic write fingerprint without a second Reader pass", async () => {
  const store = new MemoryRoutineDataStore();
  const exact = candidate("registered-reader-readback", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { formatVersion: 1, candidates: [], absences: [] },
  });
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", exact, NOW);
  assert.equal(outcome.promoted?.versionId, exact.id);
  assert.equal(outcome.readerReadback?.versionId, exact.id);
  assert.equal(outcome.readerReadback?.projectionId, "funding-snapshot");
  assert.equal(outcome.readerReadback?.status, "PASS");
  assert.equal(outcome.readerReadback?.evidenceKind, "WRITE_CONTENT_FINGERPRINT");
  assert.equal(outcome.readerReadback?.verifierId, "lib/civic-data/reader-readback.ts#publicationFingerprintIssue");
  const events = await store.events(exact.id);
  assert.deepEqual(events.map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"]);
  assert.equal(parseReaderProjectionReadback(events.at(-1)?.detail ?? ""), null);
});

test("production event time uses its own write clock and the latest durable scope event", async (t) => {
  const productionStore = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
  const latest = "2026-09-07T12:00:00.010Z";
  const query = { from: () => query, innerJoin: () => query, where: async () => [{ at: latest }] };
  Object.defineProperty(productionStore, "db", { value: { select: (columns: object) => {
    assert.deepEqual(Object.keys(columns), ["at"], "only one timestamp crosses the wire");
    return query;
  } } });
  let wallClock = Date.parse("2026-09-07T12:00:00.009Z");
  t.mock.method(Date, "now", () => wallClock);
  assert.equal(await productionStore.eventObservedAt("REGISTRY_RUNTIME_BINDING", "registry", NOW), latest);
  wallClock = Date.parse("2026-09-07T12:00:00.011Z");
  assert.equal(await productionStore.eventObservedAt("REGISTRY_RUNTIME_BINDING", "registry", "2099-01-01T00:00:00.000Z"), "2026-09-07T12:00:00.011Z");
});

test("registered promotion freezes the candidate in place, so no async store step can swap its payload", async () => {
  class MutatingStore extends MemoryRoutineDataStore {
    target: RoutineCandidate | null = null;
    mutated = false;
    refused = false;

    override async readPromotion<T>(recordClass: RoutineRecordClass, scope: string) {
      if (!this.mutated && this.target !== null) {
        this.mutated = true;
        const tampered = { formatVersion: 1, candidates: "not-an-array", absences: [] };
        try {
          Object.assign(this.target, { readModel: tampered });
          Object.assign(this.target.normalization, { normalizedHash: normalizedHash(tampered) });
        } catch (error) { this.refused = error instanceof TypeError; }
      }
      return super.readPromotion<T>(recordClass, scope);
    }
  }

  const store = new MutatingStore();
  const exact = candidate("registered-durable-snapshot", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { formatVersion: 1, candidates: [{ fecCandidateId: "H6AZ01001" }], absences: [] },
  });
  store.target = exact;
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", exact, NOW);

  assert.equal(store.mutated, true);
  assert.equal(store.refused, true, "the frozen candidate refuses the swap");
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.ok(Array.isArray((outcome.promoted?.payload as { candidates?: unknown }).candidates));
  assert.ok(Array.isArray((exact.readModel as { candidates?: unknown }).candidates));
});

test("a malformed typed Reader projection is refused before it can replace LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const exact = candidate("registered-reader-rejected", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { version: "pointer-readable-but-not-a-funding-snapshot" },
  });
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", exact, NOW);

  assert.equal(outcome.promoted, null);
  assert.equal(outcome.readerReadback, null);
  assert.equal(outcome.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(outcome.candidate.failureCode, "DEPENDENT_CONSUMER_REJECTED");
  assert.match(outcome.candidate.failureDetail ?? "", /does not satisfy FundingSnapshot/);
  assert.equal(await store.readPromotion("FEC_FUNDING", "federal-supported"), null);
});

test("a nested Reader row without a stable civic identity is refused even when its digests match", async () => {
  const store = new MemoryRoutineDataStore();
  const exact = candidate("registered-reader-row-without-identity", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { formatVersion: 1, candidates: [{}], absences: [] },
  });
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", exact, NOW);

  assert.equal(outcome.promoted, null);
  assert.equal(outcome.readerReadback, null);
  assert.equal(outcome.candidate.state, "PARSE_INVALID");
  assert.equal(outcome.candidate.failureCode, "CIVIC_RECORD_KEY_INVALID");
  assert.equal(await store.readPromotion("FEC_FUNDING", "federal-supported"), null);
});

test("a promotion reports its durable record without reading the promoted envelope back again", async () => {
  class CountingStore extends MemoryRoutineDataStore {
    readonly wholeCandidateReads: string[] = [];

    override async readCandidate(candidateId: string) {
      this.wholeCandidateReads.push(candidateId);
      return super.readCandidate(candidateId);
    }
  }
  const store = new CountingStore();
  const exact = candidate("promotion-outcome-no-reread", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { formatVersion: 1, candidates: [], absences: [] },
  });
  const outcome = await processRoutineCandidate(store, exact, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual(store.wholeCandidateReads.filter((id) => id === exact.id), [], "the promoted candidate is never read whole again");
  assert.deepEqual(outcome.candidate, await store.readCandidate(exact.id), "the reported record is exactly the durable one");
});

test("publication checks only the returned write fingerprint and never reads or appends a receipt", async () => {
  const store = new MemoryRoutineDataStore();
  const first = candidate("fingerprint-write", {
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    readModel: { formatVersion: 1, candidates: [], absences: [] },
  });
  const promoted = (await processRoutineCandidate(store, first, NOW)).promoted!;
  const before = await store.events(first.id);
  store.readPromotionIdentity = async () => { throw Error("unexpected pointer reread"); };
  store.readCandidate = async () => { throw Error("unexpected candidate reread"); };
  store.appendEvidence = async () => { throw Error("unexpected receipt write"); };
  const checked = await recordRoutineReaderProjectionReadback(store, ROUTINE_SOURCE_CONTRACTS[0], promoted, NOW, READER_CODE_SHA_A);
  assert.equal(checked?.status, "PASS");
  const mismatch = await recordRoutineReaderProjectionReadback(store, ROUTINE_SOURCE_CONTRACTS[0], {
    ...promoted, writeFingerprint: {expected:promoted.writeFingerprint!.expected,stored:"0".repeat(64)},
  }, NOW);
  assert.equal(mismatch?.status, "FAIL");
  assert.deepEqual(await store.events(first.id), before);
});

test("dependent evidence can affect only its exact source, record class, and scope", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceProjectionEvidence: sourceProjectionEvidence("meetings-public-bodies", "MEETING", "supported-bodies"),
  }), "DEPENDENT_CONSUMER_INVALID", "DEPENDENT_EVIDENCE_SCOPE_MISMATCH");
});

test("a pointer whose LKG candidate is missing cannot bless a replacement", async () => {
  class MissingLkgStore extends MemoryRoutineDataStore {
    hiddenCandidateId: string | null = null;

    override async readCandidate(candidateId: string) {
      if (candidateId === this.hiddenCandidateId) return null;
      return super.readCandidate(candidateId);
    }
  }

  const store = new MissingLkgStore();
  const good = candidate("fec-good-before-missing-lkg");
  await seed(store, good);
  store.hiddenCandidateId = good.id;
  const replacement = candidate("fec-replacement-after-missing-lkg");
  const outcome = await processRoutineCandidate(store, replacement, NOW);
  assert.equal(outcome.promoted, null);
  assert.equal(outcome.candidate.state, "CANNOT_TELL");
  assert.equal(outcome.candidate.receipt?.decision, "CANNOT_TELL");
  assert.equal(outcome.candidate.failureCode, "LKG_CANDIDATE_MISSING");
  assert.equal(outcome.candidate.receipt?.checks.find((check) => check.check === "TEMPORAL_VALIDITY")?.code, "LKG_CANDIDATE_MISSING");
  assert.equal((await store.readPromotion("FEC_FUNDING", "federal-candidates:2026"))?.versionId, good.id);
});

test("a non-null but invalid LKG row cannot bless a replacement", async () => {
  const mutations: Array<[string, (row: CandidateVersionRecord) => CandidateVersionRecord]> = [
    ["wrong state", (row) => ({ ...row, state: "VALIDATED" })],
    ["wrong scope", (row) => ({ ...row, candidate: { ...row.candidate, scope: "other-scope" } })],
    ["mismatched receipt", (row) => ({ ...row, receipt: row.receipt ? { ...row.receipt, validatedAt: "2026-09-07T12:00:01.000Z" } : null })],
    ["divergent LKG field", (row) => ({ ...row, lastKnownGoodVersion: "other-version" })],
  ];
  for (const [label, mutate] of mutations) {
    class TamperedLkgStore extends MemoryRoutineDataStore {
      tamperId: string | null = null;

      override async readCandidate(candidateId: string) {
        const row = await super.readCandidate(candidateId);
        return row && candidateId === this.tamperId ? mutate(row) : row;
      }
    }
    const store = new TamperedLkgStore();
    const good = candidate(`good-before-${label.replace(/\s/g, "-")}`);
    await seed(store, good);
    store.tamperId = good.id;
    const outcome = await processRoutineCandidate(store, candidate(`replacement-after-${label.replace(/\s/g, "-")}`), NOW);
    assert.equal(outcome.promoted, null, label);
    assert.equal(outcome.candidate.state, "CANNOT_TELL", label);
    assert.equal(outcome.candidate.failureCode, "LKG_PROMOTION_PROOF_INVALID", label);
    assert.equal((await store.readPromotion(good.recordClass, good.scope))?.versionId, good.id, label);
  }
});

test("FEC candidate identity accepts the official nine-character office forms and rejects a numeric congressional impostor", () => {
  const snapshot = (fecCandidateId: string, office: "H" | "S" | "P"): FundingSnapshot => ({
    formatVersion: 1,
    fetchedAt: NOW,
    cycle: 2026,
    matchReport: { rosterMatched: 1, rosterTotal: 1, ballotMatched: 0, ballotTotal: 0 },
    candidates: [{
      dataClass: "FEC_COMMITTEE",
      fecCandidateId,
      name: "Official identifier control",
      state: office === "P" ? "US" : "VA",
      office: office as "H" | "S",
      district: office === "H" ? "01" : null,
      targetKeys: ["control:official-id"],
      matchRoutes: ["bioguide-bridge"],
      principalCommitteeId: "C00999999",
      cycle: 2026,
      totals: { receipts: 1, disbursements: 0, cashOnHand: 1, individualItemized: 1, individualUnitemized: 0, smallDonorShare: 0, coverageEndDate: "2026-06-30" },
      topContributions: [],
      provenance: { sourceUrl: "https://www.fec.gov/", sourceOrg: "Federal Election Commission", collectedAt: NOW, verifiedAt: NOW },
    }],
    absences: [],
  });
  const build = (fecCandidateId: string, office: "H" | "S" | "P") => fecFundingCandidate({
    snapshot: snapshot(fecCandidateId, office),
    rawBodies: ["official FEC response"],
    finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
    retrievedAt: NOW,
    excludedFacts: [],
  });
  assert.deepEqual(build("H8VA01233", "H").normalization.missingRequiredFields, []);
  assert.deepEqual(build("S0NH00219", "S").normalization.missingRequiredFields, []);
  assert.deepEqual(build("P80001571", "P").normalization.missingRequiredFields, []);
  assert.deepEqual(build("H12345678", "H").normalization.missingRequiredFields, ["Official identifier control:candidate_id"]);
});

test("official state roll identity, term, event and stage can promote directly", async () => {
  const store = new MemoryRoutineDataStore();
  const official = officialStateRollCallsCandidate({
    sourceId: "az-legislature",
    jurisdiction: "US-AZ",
    rawBodies: ["official roll bytes"],
    requestedUrl: "https://apps.azleg.gov/BillStatus/BillOverview/84058",
    finalUrl: "https://apps.azleg.gov/BillStatus/BillOverview/84058",
    httpStatus: 200,
    retrievedAt: NOW,
    term: "57th Legislature",
    expectedTerm: "57th Legislature",
    session: "2nd Regular Session",
    declaredRollTotal: 1,
    identityAuthority: {
      contractId: "az-state-legislators",
      versionId: "az-roster-good-v1",
      currentOfficeholderIds: ["az-legislature:2295"],
      sessionParticipantIds: ["az-legislature:2295"],
      sessionParticipantSourceVersion: "az-official-participants-v1",
    },
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
    positions: [{ officeholderId: "az-legislature:2295", officialPersonId: "2295", rollCallId: "azleg:57:2R:HB2321:third-reading", position: "YES", publisherPosition: "Yea" }],
  });
  const outcome = await processRoutineCandidate(store, official, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.sourceId, "az-legislature");
  const promotedRolls = (outcome.promoted?.payload as { rollCalls: { sourceId?: "az-legislature" }[] }).rollCalls;
  assert.equal(stateRollAttribution(promotedRolls), null, "official rows must not be mislabeled as LegiScan data");
  assert.equal(stateRollPublisher(promotedRolls[0]), "Arizona State Legislature");
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
  }), "SOURCE_BLOCKED", "FINAL_ROUTE_NOT_REGISTERED");
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

test("a future-dated acquisition cannot replace LKG with a pointer the Reader will refuse", async () => {
  await expectHeld((base) => ({
    ...base,
    retrieval: { ...base.retrieval, retrievedAt: "2026-09-07T12:00:00.001Z" },
  }), "TEMPORAL_INVALID", "ACQUISITION_TIME_AFTER_VALIDATION");
});

test("a delayed older acquisition cannot overwrite a newer source-scoped LKG", async () => {
  await expectHeld((base) => ({
    ...base,
    retrieval: { ...base.retrieval, retrievedAt: "2026-09-07T11:59:59.999Z" },
  }), "TEMPORAL_INVALID", "ACQUISITION_TIME_REGRESSION");
});

test("a FEC period that regresses behind the class LKG is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    temporal: { ...base.temporal, sourceThrough: "2026-09-05T00:00:00.000Z" },
  }), "TEMPORAL_INVALID", "SOURCE_THROUGH_REGRESSION");
});

test("a sourced state member publishes while optional term metadata is absent", async () => {
  const store = new MemoryRoutineDataStore();
  const base = stateMemberCandidate("state-member-partial-term");
  const partial = { ...base, identities: base.identities.map(identity => ({ ...identity, term: undefined })) };
  const outcome = await processRoutineCandidate(store, partial, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? undefined);
  assert.equal(outcome.candidate.candidate.identities[0].term, undefined, "no individual term is invented from the source edition");
  assert.equal((await store.readPromotion("STATE_LEGISLATOR", "US-NH"))?.versionId, partial.id);
});

test("a state member without a sourced office is refused and holds the state LKG", async () => {
  await expectHeld((base) => ({
    ...base,
    identities: [{
      ...base.identities[0],
      office: undefined,
    }],
  }), "IDENTITY_UNRESOLVED", "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE", stateMemberCandidate("state-member-good-1"));
});

test("a state member whose chamber and term contradict the normalized seat is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    identities: [{
      ...base.identities[0],
      chamber: "S",
      term: "2023-2024",
    }],
  }), "IDENTITY_UNRESOLVED", "STATE_MEMBER_CHAMBER_TERM_MISMATCH", stateMemberCandidate("state-member-good-2"));
});

test("wrong roll-call event/stage is refused without weakening exact roll identity", async () => {
  await expectHeld((base) => ({
    ...base,
    semantics: {
      ...base.semantics,
      actionStage: "agenda publication",
      expectedActionStage: "enactment vote",
    },
  }), "SEMANTIC_INVALID", "WRONG_ACTION_STAGE", stateRollCandidate("state-roll-good-1"));
});

test("wrong Census vintage is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    identities: [{
      ...base.identities[0],
      identifiers: { ...base.identities[0].identifiers, vintage: "2023" },
    }],
    temporal: { ...base.temporal, version: "2023", expectedVersion: "2024" },
  }), "TEMPORAL_INVALID", "WRONG_PERIOD_OR_VINTAGE", censusReferenceCandidate("census-good-1"));
});

test("wrong Census schema is refused", async () => {
  await expectHeld((base) => ({
    ...base,
    normalization: { ...base.normalization, parserVersion: "census-data-api/1" },
  }), "PARSE_INVALID", "PARSER_VERSION_UNREGISTERED", censusReferenceCandidate("census-good-2"));
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
    parserVersion: "fec-funding/4",
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
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-candidate:H6AZ00000:2026"),
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/4",
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

test("LegiScan bill authority cannot promote state roll calls", async () => {
  await expectHeld((base) => ({
    ...base,
    sourceId: "legiscan-bills",
    recordClass: "STATE_ROLL_CALL",
    scope: "US-AZ:2026",
    retrieval: { ...base.retrieval, finalUrl: "https://api.legiscan.com/?op=getDatasetList" },
    normalization: { ...base.normalization, parserVersion: "legiscan-bulk/1" },
  }), "SOURCE_BLOCKED", "SOURCE_NOT_COMPETENT_FOR_RECORD_CLASS");
});

test("attributed LegiScan projections require exact state-specific source and identity verification", async () => {
  const store = new MemoryRoutineDataStore();
  const base = candidate("unverified-vendor-projection"), scope = "US-AZ:legiscan-votes:v1";
  const outcome = await processRoutineCandidate(store, { ...base, sourceId: "legiscan", recordClass: "STATE_ROLL_CALL", scope,
    sourceProjectionEvidence: sourceProjectionEvidence("legiscan", "STATE_ROLL_CALL", scope),
    retrieval: { ...base.retrieval, requestedUrl: "https://api.legiscan.com/?op=getDatasetList&state=AZ", finalUrl: "https://api.legiscan.com/?op=getDatasetList&state=AZ" },
    normalization: { ...base.normalization, parserVersion: "legiscan-votes/1" },
  }, NOW);
  assert.equal(outcome.promoted, null);
  assert.ok(outcome.candidate.failureCode);
});

test("all standing routine-source destructive classes are enumerated by the contract", () => {
  const covered = new Set<RoutineRecordClass>([
    "FEC_FUNDING", "STATE_LEGISLATOR", "CENSUS_REFERENCE", "CENSUS_GEOGRAPHY",
    "MEETING", "DOTGOV_REFERENCE", "STATE_ROLL_CALL",
    "STATE_LEGISLATOR_VOTES", "STATE_BILL", "REGISTRATION", "MEETING_OUTCOME", "FEDERAL_DIRECTORY",
    "GOOGLE_CIVIC_VOTERINFO",
    "FEDERAL_MONEY", "CAMPAIGN_FINANCE",
    // The derived meeting-source wiring never removes a row (a trigger suspends it), so any removal is
    // refused by the generic incomplete-horizon rule (tests/derived-meeting-family.test.ts).
    "CURATED_READER_RECORD",
    "FEDERAL_CIVIC_RECORD",
  ]);
  const standingClasses = new Set(ROUTINE_SOURCE_TASKS.map((task) => task.recordClass));
  assert.deepEqual([...covered].sort(), [...standingClasses].sort());
});
