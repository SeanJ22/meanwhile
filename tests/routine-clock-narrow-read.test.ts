import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../lib/db/schema.ts";
import {
  CANDIDATE_PROOF_OMITTED,
  MemoryRoutineDataStore,
  candidateProofRead,
  candidateProofView,
  latestReaderReadbacksRead,
  meetingPayloadSittingStarts,
  newestReaderReadback,
  pointerMoveEventsRead,
  POINTER_MOVE_DETAIL_PREFIX,
  readLatestReaderReadbacks,
  readPointerMoveEvents,
  proofConsistentSuccess,
  ROUTINE_CLOCK_CANDIDATE_FIELDS,
  routineClockCandidateRead,
  routineClockCandidateView,
  routineClockConfirmationRead,
  promotedPointerIdentityRead,
  routineClockPointedObservedRead,
  routineClockPointerRead,
  sittingStartsRead,
  type RoutineClockRecord,
} from "../lib/civic-data/store.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import {
  attestPromotedVersion,
  clearPromotedReadModelCache,
  promotionProofIssue,
  readPromotedCivicData,
  readPromotedCivicDataBatch,
} from "../lib/civic-data/read-model.ts";
import { isUnchangedConfirmationEvent, parseUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";
import {
  attestedPromotionFor,
  parseAttestedPromotions,
  promotedPayloadSha256,
  serializeAttestedPromotions,
  type AttestedPromotion,
} from "../lib/civic-data/attested-promotion.ts";
import {
  VALIDATION_CHECKS,
  sourceProjectionEvidence,
  type CandidateVersionRecord,
  type RoutineCandidate,
  type ValidationReceipt,
} from "../lib/civic-data/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const HASH = "a".repeat(64);
/** Anything that carries a promoted dataset; none of it may cross the wire for the clock. */
const DATASET = /payload|normalizedPayload|readModel|retainedSourceResponses|identities|"identity"/i;

function selectList(query: { toSQL(): { sql: string } }): string {
  const text = query.toSQL().sql;
  return text.slice(0, text.indexOf(" from "));
}

function candidate(id: string, overrides: Partial<RoutineCandidate> = {}): RoutineCandidate {
  const normalizedPayload = { rows: Array.from({ length: 50 }, (_, index) => ({ id: `${id}-${index}` })) };
  const readModel = { candidates: normalizedPayload.rows.map((row) => ({ ...row, amount: 1 })) };
  return {
    id,
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    retrieval: {
      succeeded: true,
      requestedUrl: "https://api.open.fec.gov/v1/",
      finalUrl: "https://api.open.fec.gov/v1/",
      httpStatus: 200,
      retrievedAt: "2026-09-08T12:00:00.000Z",
      rawHash: HASH,
    },
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/4",
      schemaVersion: "2",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: 50,
      outputRecords: 50,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: "H6AZ01001",
      jurisdiction: "US",
      identifiers: { candidate_id: "H6AZ01001" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: { version: "2026", expectedVersion: "2026", sourceThrough: "2026-09-08T12:00:00.000Z", staleAtRetrieval: false },
    semantics: { factKind: "filed total", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "supported candidates",
      returnedRecords: 50,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "funding reader", passed: true, detail: "accepted" }],
    normalizedPayload,
    readModel,
    ...overrides,
  };
}

function receiptFor(value: RoutineCandidate, decision: ValidationReceipt["decision"] = "GOOD"): ValidationReceipt {
  return {
    contractVersion: 2,
    decision,
    candidateId: value.id,
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    validatedAt: value.retrieval.retrievedAt,
    checks: VALIDATION_CHECKS.map((check) => ({ check, verdict: "PASS", code: `${check}_PASS`, detail: "persisted proof" })),
    excludedFacts: [],
  };
}

function promoted(value: RoutineCandidate, overrides: Partial<CandidateVersionRecord> = {}): CandidateVersionRecord {
  return {
    candidate: value,
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt: receiptFor(value),
    promotedVersion: value.id,
    lastKnownGoodVersion: value.id,
    failureCode: null,
    failureDetail: null,
    ...overrides,
  };
}

function pointerFor(value: RoutineCandidate, overrides: Record<string, unknown> = {}) {
  return {
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    versionId: value.id,
    lastKnownGoodVersionId: value.id,
    receipt: receiptFor(value),
    ...overrides,
  };
}

function narrowed(record: CandidateVersionRecord): RoutineClockRecord {
  return { ...record, candidate: routineClockCandidateView(record.candidate) };
}

test("the routine clock reads a pointer's identity and proof, never its promoted payload", () => {
  const select = selectList(routineClockPointerRead(drizzle.mock({ schema }), "FEC_FUNDING", "federal-supported"));
  assert.doesNotMatch(select, DATASET);
  for (const column of ["source_id", "record_class", "scope", "current_version_id", "last_known_good_version_id", "validation_receipt"]) {
    assert.match(select, new RegExp(`"${column}"`), `the pointer read must still carry ${column}`);
  }
});

test("the routine clock builds its candidate view in Postgres; the payload and read model never leave the database", () => {
  const select = selectList(routineClockCandidateRead(drizzle.mock({ schema }), "cv-example"));
  assert.doesNotMatch(select, DATASET);
  assert.doesNotMatch(select, /"candidate"(?!\s*(?:->|#>))/, "the whole candidate column is never selected");
  assert.match(select, /jsonb_strip_nulls\(jsonb_build_object\(/);
  for (const field of ROUTINE_CLOCK_CANDIDATE_FIELDS.top) {
    assert.match(select, new RegExp(`'${field}', "civic_data_candidates"\\."candidate"->'${field}'`));
  }
  for (const field of ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval) {
    assert.match(select, new RegExp(`'${field}', "civic_data_candidates"\\."candidate"#>'\\{retrieval,${field}\\}'`));
  }
  assert.match(select, /'parserVersion', "civic_data_candidates"\."candidate"#>'\{normalization,parserVersion\}'/);
});

test("the clock view names exactly the fields the clock proves; widening it is a visible cost decision", () => {
  assert.deepEqual(ROUTINE_CLOCK_CANDIDATE_FIELDS, {
    top: ["id", "sourceId", "recordClass", "scope", "bootstrapImport"],
    retrieval: ["retrievedAt", "sourceCheck"],
    normalization: ["parserVersion"],
  });
  const view = routineClockCandidateView(candidate("view-shape"));
  assert.deepEqual(Object.keys(view).sort(), ["id", "normalization", "recordClass", "retrieval", "scope", "sourceId"]);
  assert.deepEqual(view.retrieval, { retrievedAt: "2026-09-08T12:00:00.000Z" });
  assert.deepEqual(view.normalization, { parserVersion: "fec-funding/4" });
  assert.doesNotMatch(JSON.stringify(view), /view-shape-\d/, "no dataset row survives the view");
});

test("both stores' clocks read through the narrowed view, never a whole row", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const postgresClock = postgres.slice(postgres.indexOf("  async clock("));
  assert.match(postgresClock, /routineClockPointerRead\(this\.db, recordClass, scope\)/);
  assert.match(postgresClock, /routineClockCandidateRead\(this\.db, pointer\.currentVersionId\)/);
  assert.doesNotMatch(postgresClock, /\.select\(\)/, "a whole-row select in the clock moves every promoted dataset each pass");
  const memory = source.slice(source.indexOf("export class MemoryRoutineDataStore"), source.indexOf("function rowToCandidate("));
  const memoryClock = memory.slice(memory.indexOf("  async clock("));
  assert.match(memoryClock, /routineClockCandidateView\(pointedRow\.candidate\)/);
});

test("the narrowed view decides exactly what the whole candidate decides", () => {
  const base = candidate("clock-base");
  const imported = candidate("clock-imported", {
    bootstrapImport: { kind: "TRUSTED_LKG_IMPORT" } as unknown as RoutineCandidate["bootstrapImport"],
  });
  const cases: { name: string; record: CandidateVersionRecord; pointer: ReturnType<typeof pointerFor>; expected: string | undefined }[] = [
    { name: "consistent promotion", record: promoted(base), pointer: pointerFor(base), expected: base.retrieval.retrievedAt },
    { name: "pointer moved on", record: promoted(base), pointer: pointerFor(base, { versionId: "cv-other" }), expected: undefined },
    { name: "pointer from another source", record: promoted(base), pointer: pointerFor(base, { sourceId: "other-source" }), expected: undefined },
    { name: "refused receipt", record: promoted(base, { receipt: receiptFor(base, "FAIL") }), pointer: pointerFor(base), expected: undefined },
    { name: "validated, not promoted", record: promoted(base, { state: "VALIDATED" }), pointer: pointerFor(base), expected: undefined },
    { name: "failed acquisition", record: promoted(base, { acquisitionSucceeded: false }), pointer: pointerFor(base), expected: undefined },
    { name: "trusted LKG import", record: promoted(imported), pointer: pointerFor(imported), expected: undefined },
  ];
  for (const { name, record, pointer, expected } of cases) {
    const whole = proofConsistentSuccess(record as RoutineClockRecord, pointer as never);
    assert.equal(whole, expected, `${name}: whole-candidate decision`);
    assert.equal(proofConsistentSuccess(narrowed(record), pointer as never), whole, `${name}: the narrowed view must decide the same`);
  }
  assert.deepEqual(routineClockCandidateView(imported).bootstrapImport, { kind: "TRUSTED_LKG_IMPORT" });
});

test("the memory store's clock, read through the view, keeps its attempt and success instants", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("memory-clock");
  await store.create({ ...promoted(value), state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: null }, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: value.retrieval.retrievedAt,
    detail: "persisted acquisition",
  });
  await store.transition(value.id, "NORMALIZED", value.retrieval.retrievedAt, "persisted normalization");
  const receipt = receiptFor(value);
  await store.transition(value.id, "VALIDATED", value.retrieval.retrievedAt, "persisted validation", receipt);
  await store.promote(value.id, receipt, "2026-09-08T12:01:00.000Z");
  assert.deepEqual(await store.clock(value.sourceId, value.recordClass, value.scope), {
    lastAttemptedAt: value.retrieval.retrievedAt,
    lastSucceededAt: value.retrieval.retrievedAt,
    lastSucceededObservedAt: value.retrieval.retrievedAt,
  });
});

test("a MEETING clock reports its sitting starts, and the pointed success as its store-observed first event", async () => {
  const store = new MemoryRoutineDataStore();
  const scope = "source:legistar:body:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Apima%23governing";
  const readModel = {
    meetings: [
      { id: "legistar:pima-1", startsAt: "2026-09-29T09:00:00-07:00" },
      { id: "legistar:pima-2", startsAt: "2026-10-06T09:00:00-07:00" },
      { id: "legistar:pima-3", startsAt: null },
    ],
  };
  const value = candidate("meeting-clock", {
    sourceId: "meetings-public-bodies",
    recordClass: "MEETING",
    scope,
    sourceProjectionEvidence: sourceProjectionEvidence("meetings-public-bodies", "MEETING", scope),
    readModel,
    normalization: { ...candidate("meeting-clock").normalization, normalizedHash: normalizedHash(readModel) },
  });
  // The first event lands after the claimed retrieval, as a real acquisition's does.
  const observedAt = "2026-09-08T12:00:02.500Z";
  await store.create({ ...promoted(value), state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: null }, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: observedAt,
    detail: "persisted acquisition",
  });
  await store.transition(value.id, "NORMALIZED", observedAt, "persisted normalization");
  const receipt = { ...receiptFor(value), validatedAt: observedAt };
  await store.transition(value.id, "VALIDATED", observedAt, "persisted validation", receipt);
  // Before any promotion the store reports no sitting list; the runner reads
  // that as never published and retries on the base cadence.
  assert.equal("sittingStarts" in await store.clock(value.sourceId, value.recordClass, value.scope), false);
  await store.promote(value.id, receipt, "2026-09-08T12:01:00.000Z");
  assert.deepEqual(await store.clock(value.sourceId, value.recordClass, value.scope), {
    lastAttemptedAt: observedAt,
    lastSucceededAt: value.retrieval.retrievedAt,
    lastSucceededObservedAt: observedAt,
    sittingStarts: ["2026-09-29T09:00:00-07:00", "2026-10-06T09:00:00-07:00"],
  });
});

test("a MEETING pointer's sitting starts are built in Postgres; the promoted payload never leaves the database", () => {
  const text = sittingStartsRead(drizzle.mock({ schema }), "source:x:body:y").toSQL().sql;
  const select = text.slice(0, text.indexOf(" from \"civic_data_promotions\""));
  assert.match(select, /jsonb_agg\(m->'startsAt'\)/);
  assert.match(select, /'\[\]'::jsonb\)/, "a promoted scope with no sittings reports an empty list, never none (R20)");
  assert.deepEqual(meetingPayloadSittingStarts({ meetings: [] }), []);
  assert.deepEqual(meetingPayloadSittingStarts({}), []);
  assert.match(select, /jsonb_array_elements\(case when jsonb_typeof\((?:"civic_data_promotions"\.)?"payload"->'meetings'\) = 'array'/);
  assert.doesNotMatch(select, /select (?:"civic_data_promotions"\.)?"payload"[,\s]/, "the payload column is never selected whole");
  assert.doesNotMatch(select, /::timestamptz/, "no cast can fail the clock; the runner parses the strings");
  const observed = routineClockPointedObservedRead(drizzle.mock({ schema }), "MEETING", "source:x:body:y").toSQL().sql;
  assert.doesNotMatch(observed.slice(0, observed.indexOf(" from ")), DATASET);
  assert.match(observed, /"civic_data_candidate_events"\."sequence" = \$\d/);
});

test("a live candidate's proof reads neither its identity set nor its change set and records, and decides the same", async () => {
  const store = new MemoryRoutineDataStore();
  const value = candidate("proof-view", {
    changeSet: { outcome: "CHANGED", added: [{ key: "k", after: { amount: 1 } }], changed: [], removed: [], held: [] },
    civicRecords: [{ key: "k", record: { amount: 1 } }],
  } as unknown as Partial<RoutineCandidate>);
  await store.create({ ...promoted(value), state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: null }, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: value.retrieval.retrievedAt,
    detail: "persisted acquisition",
  });
  await store.transition(value.id, "NORMALIZED", value.retrieval.retrievedAt, "persisted normalization");
  const receipt = receiptFor(value);
  await store.transition(value.id, "VALIDATED", value.retrieval.retrievedAt, "persisted validation", receipt);
  await store.promote(value.id, receipt, "2026-09-08T12:01:00.000Z");
  const pointer = await store.readPromotion(value.recordClass, value.scope);
  assert.ok(pointer);
  const whole = await store.readCandidate(value.id);
  const narrowed = await store.readCandidateProof(value.id);
  assert.ok(whole && narrowed);
  for (const field of ["identities", "changeSet", "civicRecords"]) {
    assert.equal(Object.hasOwn(whole.candidate, field), true, `the whole row carries ${field}`);
    assert.equal(Object.hasOwn(narrowed.candidate, field), false, `the proof never reads ${field}`);
  }
  assert.deepEqual(candidateProofView(whole.candidate), narrowed.candidate);
  const decide = (record: CandidateVersionRecord) => promotionProofIssue(value.recordClass, value.scope, pointer, record);
  assert.equal(decide(narrowed), null);
  assert.equal(decide(whole), null);
  const tampers: readonly ((record: CandidateVersionRecord) => CandidateVersionRecord)[] = [
    (record) => ({ ...record, candidate: { ...record.candidate, readModel: { tampered: true } } }),
    (record) => ({ ...record, candidate: { ...record.candidate, normalizedPayload: { tampered: true } } }),
    (record) => ({ ...record, candidate: { ...record.candidate, id: "cv-other" } }),
    (record) => ({ ...record, receipt: receiptFor(value, "FAIL") }),
  ];
  for (const tamper of tampers) {
    const issue = decide(tamper(whole));
    assert.ok(issue, "the whole row refuses the tamper");
    assert.equal(decide(tamper(narrowed)), issue, "the narrowed row refuses it the same way");
  }
  const [batch] = await store.readCandidateProofs([value.id, "cv-missing"]);
  assert.deepEqual(batch, { candidateId: value.id, record: narrowed });
  const read = await readPromotedCivicData(value.recordClass, value.scope, { store, bypassCache: true, now: "2026-09-08T13:00:00.000Z" });
  assert.equal(read.kind, "PROMOTED");
});

test("the proof view is built in Postgres; the identity column and a live row's change set, records and identities never leave", () => {
  const text = candidateProofRead(drizzle.mock({ schema }), ["cv-example"]).toSQL().sql;
  const select = text.slice(0, text.indexOf(" from \"civic_data_candidates\""));
  assert.match(select, /case when "candidate" \? 'bootstrapImport'\s+then "candidate"\s+else "candidate" - 'changeSet' - 'civicRecords' - 'identities' end/);
  assert.doesNotMatch(select, /"identity"/, "the identity column is never selected");
  assert.doesNotMatch(select, /select "candidate"|, "candidate",/, "the whole candidate column is never selected bare");
  for (const column of ["state", "acquisition_succeeded", "validation_receipt", "promoted_version_id", "last_known_good_version_id"]) {
    assert.match(select, new RegExp(`"${column}"`), `the proof still reads ${column}`);
  }
  assert.deepEqual(CANDIDATE_PROOF_OMITTED, { unlessImported: ["changeSet", "civicRecords", "identities"] });
});

test("an attested version is served from its pointer alone; any mismatch runs the full proof", async () => {
  class CountingStore extends MemoryRoutineDataStore {
    candidateReads = 0;
    override async readCandidate(candidateId: string) {
      this.candidateReads += 1;
      return super.readCandidate(candidateId);
    }
    override async readCandidateProof(candidateId: string) {
      this.candidateReads += 1;
      return super.readCandidateProof(candidateId);
    }
  }
  const supervisor = new CountingStore();
  const value = candidate("attested");
  await supervisor.create({ ...promoted(value), state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: null }, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: value.retrieval.retrievedAt,
    detail: "persisted acquisition",
  });
  await supervisor.transition(value.id, "NORMALIZED", value.retrieval.retrievedAt, "persisted normalization");
  const receipt = receiptFor(value);
  await supervisor.transition(value.id, "VALIDATED", value.retrieval.retrievedAt, "persisted validation", receipt);
  await supervisor.promote(value.id, receipt, "2026-09-08T12:01:00.000Z");
  const now = "2026-09-08T13:00:00.000Z";
  clearPromotedReadModelCache();
  assert.equal(attestPromotedVersion(value.recordClass, value.scope, supervisor), null, "nothing is attested before a proof");
  const proven = await readPromotedCivicData(value.recordClass, value.scope, { store: supervisor, now });
  assert.equal(proven.kind, "PROMOTED");
  const attested = attestPromotedVersion(value.recordClass, value.scope, supervisor);
  assert.ok(attested);
  assert.equal(attested.versionId, value.id);
  assert.equal(attested.retrievedAt, value.retrieval.retrievedAt);

  // A child is a fresh process: a different store object over the same rows.
  const child = () => {
    clearPromotedReadModelCache();
    const store = new CountingStore();
    Object.assign(store, {
      candidates: (supervisor as unknown as { candidates: unknown }).candidates,
      history: (supervisor as unknown as { history: unknown }).history,
      promotions: (supervisor as unknown as { promotions: unknown }).promotions,
    });
    return store;
  };
  const exact = child();
  const read = await readPromotedCivicData(value.recordClass, value.scope, { store: exact, now, attested });
  assert.equal(exact.candidateReads, 0, "the attested version's candidate is not read again");
  assert.deepEqual(read, proven, "the attested read reports exactly what the proof reported");

  for (const [name, mismatch] of [
    ["another version", { ...attested, versionId: "cv-other" }],
    ["another payload", { ...attested, payloadSha256: "b".repeat(64) }],
    ["another scope", { ...attested, scope: "other-scope" }],
  ] as const) {
    const store = child();
    const again = await readPromotedCivicData(value.recordClass, value.scope, { store, now, attested: mismatch });
    assert.equal(store.candidateReads, 1, `${name}: the full proof runs`);
    assert.equal(again.kind, "PROMOTED");
  }
  const verifying = child();
  await readPromotedCivicData(value.recordClass, value.scope, { store: verifying, now, attested, bypassCache: true });
  assert.equal(verifying.candidateReads, 1, "verification never takes an attestation");
});

test("attestations parse whole or not at all", () => {
  const good: AttestedPromotion = {
    recordClass: "REGISTRY_RUNTIME_BINDING",
    scope: "US:reader-registry-runtime-bindings",
    versionId: "cv-1",
    payloadSha256: "c".repeat(64),
    retrievedAt: "2026-09-14T04:24:35.148Z",
    staleAtRetrieval: false,
    version: "2026",
    sourceThrough: null,
  };
  assert.deepEqual(parseAttestedPromotions(serializeAttestedPromotions([good])), [good]);
  assert.equal(attestedPromotionFor([good], "REGISTRY_RUNTIME_BINDING", good.scope), good);
  assert.equal(attestedPromotionFor([good], "MEETING", good.scope), null);
  for (const bad of [undefined, "", "{", "{}", "[1]", JSON.stringify([{ ...good, payloadSha256: "short" }]),
    JSON.stringify([good, { ...good, retrievedAt: "not a time" }]), JSON.stringify([{ ...good, staleAtRetrieval: "no" }])]) {
    assert.deepEqual(parseAttestedPromotions(bad), [], `refused: ${String(bad).slice(0, 40)}`);
  }
  assert.equal(promotedPayloadSha256({ b: 1, a: 2 }), promotedPayloadSha256({ a: 2, b: 1 }), "canonical, key order free");
});

async function promotedStore(value: RoutineCandidate): Promise<MemoryRoutineDataStore> {
  const store = new MemoryRoutineDataStore();
  await store.create({ ...promoted(value), state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: null }, {
    candidateId: value.id,
    sequence: 1,
    state: "FETCHED",
    at: value.retrieval.retrievedAt,
    detail: "persisted acquisition",
  });
  await store.transition(value.id, "NORMALIZED", value.retrieval.retrievedAt, "persisted normalization");
  const receipt = receiptFor(value);
  await store.transition(value.id, "VALIDATED", value.retrieval.retrievedAt, "persisted validation", receipt);
  await store.promote(value.id, receipt, "2026-09-08T12:01:00.000Z");
  return store;
}

const CONFIRMING_RETRIEVAL = {
  requestedUrl: "https://api.open.fec.gov/v1/",
  finalUrl: "https://api.open.fec.gov/v1/",
  httpStatus: 200,
  rawHash: "e".repeat(64),
  retrievedAt: "2026-09-08T18:00:00.000Z",
};

test("an unchanged re-check is a confirmation on the pointed version: readers keep it, the clock moves", async () => {
  const value = candidate("confirmed");
  const store = await promotedStore(value);
  const pointerBefore = await store.readPromotion(value.recordClass, value.scope);
  const input = {
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    parserVersion: value.normalization.parserVersion,
    pointerVersionId: value.id,
    readModelHash: value.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED" as const,
    retrieval: CONFIRMING_RETRIEVAL,
  };
  const outcome = await store.confirmUnchanged(input, "2026-09-08T18:00:03.000Z");
  assert.deepEqual(outcome, { kind: "CONFIRMED", versionId: value.id, at: "2026-09-08T18:00:03.000Z" });
  const { latestConfirmation, ...pointerAfter } = (await store.readPromotion(value.recordClass, value.scope))!;
  assert.deepEqual(pointerAfter, pointerBefore, "the pointer does not move");
  assert.equal(latestConfirmation?.observedAt, "2026-09-08T18:00:03.000Z", "the read carries the version's newest confirmation");
  const events = await store.events(value.id);
  assert.deepEqual(events.map(({ state }) => state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
  assert.equal(parseUnchangedConfirmation(events.at(-1)!.detail)?.retrieval.retrievedAt, "2026-09-08T18:00:00.000Z");
  assert.deepEqual(await store.clock(value.sourceId, value.recordClass, value.scope), {
    lastAttemptedAt: "2026-09-08T18:00:03.000Z",
    lastSucceededAt: "2026-09-08T18:00:00.000Z",
    lastSucceededObservedAt: "2026-09-08T18:00:03.000Z",
  });

  // Each refusal writes nothing.
  const refusedAt = "2026-09-08T19:00:00.000Z";
  const refusals: readonly [string, Parameters<MemoryRoutineDataStore["confirmUnchanged"]>[0]][] = [
    ["POINTER_MOVED", { ...input, pointerVersionId: "cv-other" }],
    ["HASH_DIFFERS", { ...input, readModelHash: "f".repeat(64) }],
    ["EVIDENCE_INVALID", { ...input, basis: "PUBLISHER_STAMPS_UNCHANGED" }],
    ["EVIDENCE_INVALID", {
      ...input,
      basis: "PUBLISHER_STAMPS_UNCHANGED",
      stamps: [{ key: "s1", held: { modified: "a" }, fetched: { modified: "b" } }],
    }],
    ["EVIDENCE_INVALID", { ...input, retrieval: { ...CONFIRMING_RETRIEVAL, httpStatus: 404 } }],
  ];
  for (const [kind, refused] of refusals) {
    assert.equal((await store.confirmUnchanged(refused, refusedAt)).kind, kind);
  }
  assert.equal((await store.events(value.id)).length, 5, "no refusal wrote an event");

  // A stamp basis with every stamp equal is a confirmation too.
  const stamped = await store.confirmUnchanged({
    ...input,
    basis: "PUBLISHER_STAMPS_UNCHANGED",
    stamps: [{ key: "sitting:1826", held: { EventLastModifiedUtc: "2026-09-22T20:00:00Z" }, fetched: { EventLastModifiedUtc: "2026-09-22T20:00:00Z" } }],
    retrieval: { ...CONFIRMING_RETRIEVAL, retrievedAt: "2026-09-08T20:00:00.000Z" },
  }, "2026-09-08T20:00:01.000Z");
  assert.equal(stamped.kind, "CONFIRMED");

  // A later attempt that has not promoted is later than the confirmation: the retry clock owns it.
  const later = candidate("attempt-after-confirmation", {
    retrieval: { ...value.retrieval, retrievedAt: "2026-09-08T21:00:00.000Z" },
  });
  await store.create({ ...promoted(later), state: "FETCHED", receipt: null, promotedVersion: null, lastKnownGoodVersion: value.id }, {
    candidateId: later.id,
    sequence: 1,
    state: "FETCHED",
    at: "2026-09-08T21:00:02.000Z",
    detail: "persisted acquisition",
  });
  const clock = await store.clock(value.sourceId, value.recordClass, value.scope);
  assert.equal(clock.lastAttemptedAt, "2026-09-08T21:00:02.000Z");
  assert.equal(clock.lastSucceededObservedAt, "2026-09-08T20:00:01.000Z");
});

test("a real 304 advances the source clock while held replay preserves both check and original evidence dates", async () => {
  const base = candidate("held-check");
  const value = { ...base, retrieval: { ...base.retrieval, sourceCheck: { requestedUrl: base.retrieval.requestedUrl,
    finalUrl: base.retrieval.finalUrl!, httpStatus: 200 as const, rawHash: base.retrieval.rawHash!, checkedAt: base.retrieval.retrievedAt } } };
  const store = await promotedStore(value);
  const checkedAt = "2026-09-09T12:00:00.000Z";
  const input = { sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope,
    parserVersion: value.normalization.parserVersion, pointerVersionId: value.id, readModelHash: value.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED" as const, retrieval: { ...value.retrieval, rawHash: value.retrieval.rawHash!,
      sourceCheck: { ...value.retrieval.sourceCheck!, httpStatus: 304 as const, checkedAt } } };
  assert.equal((await store.confirmUnchanged(input, "2026-09-09T12:00:03.000Z")).kind, "CONFIRMED");
  const checked = await store.clock(value.sourceId, value.recordClass, value.scope);
  assert.equal(checked.lastSucceededAt, value.retrieval.retrievedAt);
  assert.equal(checked.lastSucceededObservedAt, checkedAt);
  assert.equal(checked.lastAttemptedAt, checkedAt);
  const upgradedParser = await store.clock(value.sourceId, value.recordClass, value.scope, "fec-funding/5");
  assert.equal(upgradedParser.lastAttemptedAt, undefined, "an older parser's confirmation cannot postpone the upgraded parser's first attempt");
  assert.equal(upgradedParser.lastSucceededParserVersion, "fec-funding/4");
  assert.equal(upgradedParser.lastSucceededObservedAt, checkedAt, "the real source check remains true for the prior GOOD");
  assert.equal((await store.confirmUnchanged(input, "2026-09-09T18:00:00.000Z")).kind, "CONFIRMED");
  assert.deepEqual(await store.clock(value.sourceId, value.recordClass, value.scope), checked);
  const read = await readPromotedCivicData(value.recordClass, value.scope, { store, now: "2026-09-09T18:00:00.000Z", maxAgeMs: 86400000, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.retrievedAt, value.retrieval.retrievedAt);
  assert.equal(read.metadata.checkedAt, checkedAt);
  assert.equal(read.metadata.stale, "CURRENT");
  const beforeDelayedReplay = (await store.events(value.id)).length;
  assert.deepEqual(await store.confirmUnchanged({ ...input, retrieval: { ...input.retrieval,
    sourceCheck: value.retrieval.sourceCheck } }, "2026-09-09T19:00:00.000Z"), {
    kind: "CONFIRMED", versionId: value.id, at: "2026-09-09T18:00:00.000Z",
  });
  assert.equal((await store.events(value.id)).length, beforeDelayedReplay, "a delayed older check cannot replace the newest provider receipt");
  assert.deepEqual(await store.clock(value.sourceId, value.recordClass, value.scope), checked);
  assert.equal((await store.confirmUnchanged({ ...input, retrieval: { ...input.retrieval,
    sourceCheck: { ...input.retrieval.sourceCheck, checkedAt: "2026-10-01T00:00:00Z" } } }, "2026-09-09T18:00:01.000Z")).kind, "EVIDENCE_INVALID");
});

test("a trusted-LKG import is never confirmed: a live read of it promotes instead", async () => {
  const imported = candidate("imported-pointer", {
    bootstrapImport: { kind: "TRUSTED_LKG_IMPORT" } as unknown as RoutineCandidate["bootstrapImport"],
  });
  const key = `${imported.recordClass}:${imported.scope}`;
  const store = new MemoryRoutineDataStore();
  Object.assign(store, {
    candidates: new Map([[imported.id, promoted(imported)]]),
    history: new Map([[imported.id, [{ candidateId: imported.id, sequence: 1, state: "PROMOTED", at: imported.retrieval.retrievedAt, detail: "imported" }]]]),
    promotions: new Map([[key, {
      key,
      sourceId: imported.sourceId,
      recordClass: imported.recordClass,
      scope: imported.scope,
      versionId: imported.id,
      lastKnownGoodVersionId: imported.id,
      payload: imported.readModel,
      receipt: receiptFor(imported),
      promotedAt: "2026-09-08T12:01:00.000Z",
    }]]),
  });
  const outcome = await store.confirmUnchanged({
    sourceId: imported.sourceId,
    recordClass: imported.recordClass,
    scope: imported.scope,
    parserVersion: imported.normalization.parserVersion,
    pointerVersionId: imported.id,
    readModelHash: imported.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED",
    retrieval: CONFIRMING_RETRIEVAL,
  }, "2026-09-08T18:00:03.000Z");
  assert.equal(outcome.kind, "POINTER_IS_IMPORT");
});

test("the Postgres confirmation is one guarded insert, and the clock reads one event detail for it", () => {
  const source = readFileSync(join(ROOT, "lib", "civic-data", "store.ts"), "utf8");
  const postgres = source.slice(source.indexOf("export class PostgresRoutineDataStore"));
  const start = postgres.indexOf("  async confirmUnchanged(");
  const method = postgres.slice(start, postgres.indexOf("  async promote(", start));
  for (const guard of [
    /\$\{civicDataCandidates\.normalizedHash\} = \$\{input\.readModelHash\}/,
    /and not \(\$\{civicDataCandidates\.candidate\} \? 'bootstrapImport'\)/,
    /\$\{civicDataPromotions\.currentVersionId\} = \$\{id\}/,
    /\$\{civicDataPromotions\.lastKnownGoodVersionId\} = \$\{id\}/,
    /\$\{civicDataCandidateEvents\.at\} > \$\{at\}::timestamptz/,
    /this\.candidateEventLock\(id\)/,
    /\$\{priorCheckedAt\} > \$\{checkedAt\}::timestamptz/,
  ]) assert.match(method, guard);
  const select = selectList(routineClockConfirmationRead(drizzle.mock({ schema }), "FEC_FUNDING", "federal-supported"));
  assert.doesNotMatch(select, DATASET);
  assert.match(select, /"detail"/);
});

test("a confirmed version is as fresh as its confirmation, on the cold, warm and batch reads", async () => {
  const value = candidate("fresh-by-confirmation");
  const store = await promotedStore(value);
  const week = 7 * 24 * 3_600_000;
  const maxAgeMs = week;
  // Two days past the version's own retrieval plus a week: stale by the version alone.
  const now = new Date(Date.parse(value.retrieval.retrievedAt) + week + 2 * 24 * 3_600_000).toISOString();
  clearPromotedReadModelCache();
  const unconfirmed = await readPromotedCivicData(value.recordClass, value.scope, { store, now, maxAgeMs });
  assert.equal(unconfirmed.metadata.stale, "STALE");

  const confirmedAt = new Date(Date.parse(now) - 3_600_000).toISOString();
  const outcome = await store.confirmUnchanged({
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    parserVersion: value.normalization.parserVersion,
    pointerVersionId: value.id,
    readModelHash: value.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED",
    retrieval: { ...CONFIRMING_RETRIEVAL, retrievedAt: confirmedAt },
  }, confirmedAt);
  assert.equal(outcome.kind, "CONFIRMED");

  // Warm: this store already proved the version, so the identity read decides.
  const warm = await readPromotedCivicData(value.recordClass, value.scope, { store, now, maxAgeMs });
  assert.equal(warm.metadata.stale, "CURRENT");
  assert.equal(warm.metadata.retrievedAt, confirmedAt);
  assert.equal(warm.metadata.versionId, value.id, "readers keep the confirmed version");

  // Cold: a fresh process proves the version and reads its confirmation with it.
  clearPromotedReadModelCache();
  const cold = await readPromotedCivicData(value.recordClass, value.scope, { store, now, maxAgeMs });
  assert.equal(cold.metadata.stale, "CURRENT");
  assert.equal(cold.metadata.retrievedAt, confirmedAt);

  // Batch: the set-oriented read, cold and then warm.
  clearPromotedReadModelCache();
  for (const pass of ["cold", "warm"]) {
    const [batch] = await readPromotedCivicDataBatch(value.recordClass, [value.scope], { store, now, maxAgeMs });
    assert.equal(batch?.metadata.stale, "CURRENT", pass);
    assert.equal(batch?.metadata.retrievedAt, confirmedAt, pass);
  }
});

test("pointer reads carry the newest confirmation from Postgres beside the pointer, never a payload", () => {
  const identity = promotedPointerIdentityRead(drizzle.mock({ schema }), "FEC_FUNDING", ["federal-supported"]).toSQL().sql;
  assert.match(identity, /select confirmation\.detail from civic_data_candidate_events as confirmation/);
  assert.match(identity, /confirmation\.candidate_id = "civic_data_promotions"\."current_version_id"/);
  assert.match(identity, /left\(confirmation\.detail, \$\d+\) = \$\d+/, "the prefix is compared exactly, never with LIKE");
  assert.match(identity, /order by confirmation\.sequence desc\s+limit 1/);
  assert.doesNotMatch(identity, /"payload"|"validation_receipt"/, "an identity read carries no dataset");
});

test("readback inspection and the proof pin read one narrow row set, never a version's gathered confirmations", async () => {
  const id = "cv-long-pointed";
  const readback = (sequence: number, at: string) => ({
    candidateId: id, sequence, state: "PROMOTED" as const, at, detail: `READER_PROJECTION_READBACK_V2 {"n":${sequence}}`,
  });
  const confirmation = (sequence: number, at: string) => ({
    candidateId: id, sequence, state: "PROMOTED" as const, at, detail: `UNCHANGED_CONFIRMATION_V1 {"n":${sequence}}`,
  });
  const history = [
    { candidateId: id, sequence: 1, state: "FETCHED" as const, at: "2026-09-08T12:00:00.000Z", detail: "Acquired raw a." },
    { candidateId: id, sequence: 2, state: "NORMALIZED" as const, at: "2026-09-08T12:00:00.000Z", detail: "Normalized." },
    { candidateId: id, sequence: 3, state: "VALIDATED" as const, at: "2026-09-08T12:00:00.000Z", detail: "Every applicable GOOD check passed." },
    { candidateId: id, sequence: 4, state: "PROMOTED" as const, at: "2026-09-08T12:01:00.000Z", detail: `Atomic pointer MEETING:x moved from cv-old to ${id}.` },
    readback(5, "2026-09-08T12:02:00.000Z"),
    confirmation(6, "2026-09-08T13:00:00.000Z"),
    { candidateId: id, sequence: 7, state: "PROMOTED" as const, at: "2026-09-08T13:00:00.000Z", detail: 'UNCHANGED_CONFIRMATION_SOURCES_V1 {"n":7}' },
    readback(8, "2026-09-08T14:00:00.000Z"),
    readback(9, "2026-09-08T14:00:00.000Z"),
    confirmation(10, "2026-09-08T15:00:00.000Z"),
  ];
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { history: new Map([[id, history]]) });
  // A store without the narrowed doors: the helpers filter its whole history instead.
  const plain = { events: (candidateId: string) => store.events(candidateId) };

  for (const reader of [store, plain]) {
    const [newest, ...rest] = await readLatestReaderReadbacks(reader, [id, "cv-never-read-back"]);
    assert.equal(newest?.sequence, 9, "the newest instant, then the highest sequence: inspection's own order");
    assert.deepEqual(rest, [], "one row per version, none for a version never read back");
    assert.deepEqual((await readPointerMoveEvents(reader, id)).map(({ sequence }) => sequence), [4], "the move alone");
  }
  assert.deepEqual(
    newestReaderReadback([...history].reverse()),
    newestReaderReadback(history),
    "the choice does not depend on the order events arrive in",
  );
  assert.equal(history.filter(isUnchangedConfirmationEvent).length, 3, "the receipts and their sources event are the confirmations");
  assert.equal(history.every((event) => event.state !== "PROMOTED" || isUnchangedConfirmationEvent(event) || event.detail.startsWith(POINTER_MOVE_DETAIL_PREFIX) || event.detail.startsWith("READER_PROJECTION_READBACK_V2 ")), true);
});

test("the narrowed event reads are chosen in Postgres: one newest readback per version, the move alone", () => {
  const db = drizzle.mock({ schema });
  const readbacks = latestReaderReadbacksRead(db, ["cv-a", "cv-b"]).toSQL().sql;
  assert.match(readbacks, /^select distinct on \("civic_data_candidate_events"\."candidate_id"\)/);
  assert.match(readbacks, /left\("civic_data_candidate_events"\."detail", \$\d+\) = \$\d+/, "the prefix is compared exactly, never with LIKE");
  assert.match(readbacks, /order by "civic_data_candidate_events"\."candidate_id", "civic_data_candidate_events"\."at" desc, "civic_data_candidate_events"\."sequence" desc$/);
  const moves = pointerMoveEventsRead(db, "cv-a").toSQL();
  assert.match(moves.sql, /"civic_data_candidate_events"\."state" = \$\d+/);
  assert.match(moves.sql, /left\("civic_data_candidate_events"\."detail", \$\d+\) = \$\d+/);
  assert.ok(moves.params.includes(POINTER_MOVE_DETAIL_PREFIX));
  for (const text of [readbacks, moves.sql]) assert.doesNotMatch(text, /"id"|"payload"|"candidate"[^_]/, "event columns only");
});

test("a confirmation's runner receipt is proved from the pointer and its newest confirmation, never the dataset", async () => {
  const { durableRoutineRunnerReceiptIssue, parseRoutineRunnerReceipt } = await import("../lib/civic-data/runner-receipt.ts");
  const { ZERO_RELEASE_EVENTS } = await import("../lib/civic-data/release.ts");
  const value = candidate("receipt-confirmed");
  const store = await promotedStore(value);
  const at = "2026-09-08T18:00:03.000Z";
  const confirmed = await store.confirmUnchanged({
    sourceId: value.sourceId,
    recordClass: value.recordClass,
    scope: value.scope,
    parserVersion: value.normalization.parserVersion,
    pointerVersionId: value.id,
    readModelHash: value.normalization.normalizedHash!,
    basis: "READ_MODEL_RECOMPUTED",
    retrieval: CONFIRMING_RETRIEVAL,
  }, at);
  assert.equal(confirmed.kind, "CONFIRMED");
  const line = "RCD_RECEIPT=" + JSON.stringify({
    source: "fec-funding", candidateId: value.id, acquisitionSucceeded: true, state: "PROMOTED", decision: "GOOD",
    promotedVersion: value.id, lastKnownGoodVersion: value.id, confirmedAt: at, structuralReleaseContract: ZERO_RELEASE_EVENTS,
  });
  const parsed = parseRoutineRunnerReceipt(line);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.receipt.confirmedAt, at);
  const expected = { id: "fec-funding", sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope };
  // Count every dataset door: a confirmation's proof opens none of them.
  let datasetReads = 0;
  const counting = Object.assign(Object.create(store), {
    readPromotion: (...args: Parameters<typeof store.readPromotion>) => { datasetReads += 1; return store.readPromotion(...args); },
    readCandidate: (...args: Parameters<typeof store.readCandidate>) => { datasetReads += 1; return store.readCandidate(...args); },
    readCandidateProof: (...args: Parameters<typeof store.readCandidateProof>) => { datasetReads += 1; return store.readCandidateProof(...args); },
  }) as typeof store;
  assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt, expected, counting, "SUCCESS"), null);
  assert.equal(datasetReads, 0, "no payload or candidate envelope is read to prove a confirmation");
  // A confirmation the pointer does not carry is refused.
  const stale = { ...parsed.receipt, confirmedAt: "2026-09-08T17:00:00.000Z" };
  assert.match(await durableRoutineRunnerReceiptIssue(stale, expected, counting, "SUCCESS") ?? "", /does not carry the reported confirmation/);
  // A malformed instant is a schema failure, never a guess.
  assert.equal(parseRoutineRunnerReceipt(line.replace(at, "not a time")).ok, false);
});
