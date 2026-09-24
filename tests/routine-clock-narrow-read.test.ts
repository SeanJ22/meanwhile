import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../lib/db/schema.ts";
import {
  MemoryRoutineDataStore,
  proofConsistentSuccess,
  ROUTINE_CLOCK_CANDIDATE_FIELDS,
  routineClockCandidateRead,
  routineClockCandidateView,
  routineClockPointedObservedRead,
  routineClockPointerRead,
  sittingStartsRead,
  type RoutineClockRecord,
} from "../lib/civic-data/store.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import {
  VALIDATION_CHECKS,
  sourceProjectionEvidence,
  type CandidateVersionRecord,
  type RoutineCandidate,
  type ValidationReceipt,
} from "../lib/civic-data/types.ts";

/*
 * The routine clock runs for every routine task on every 5-minute pass. It
 * once read whole rows: 52.7 MB of promoted payloads and candidates received
 * per pass against production (2026-09-22), about 15 GB/day of billed
 * transfer, to produce two timestamps. These guards keep it a due-ness check.
 */

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
      parserVersion: "fec-funding/2",
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
});

test("the clock view names exactly the fields the clock proves; widening it is a visible cost decision", () => {
  assert.deepEqual(ROUTINE_CLOCK_CANDIDATE_FIELDS, {
    top: ["id", "sourceId", "recordClass", "scope", "bootstrapImport"],
    retrieval: ["retrievedAt"],
  });
  const view = routineClockCandidateView(candidate("view-shape"));
  assert.deepEqual(Object.keys(view).sort(), ["id", "recordClass", "retrieval", "scope", "sourceId"]);
  assert.deepEqual(view.retrieval, { retrievedAt: "2026-09-08T12:00:00.000Z" });
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
  assert.match(select, /jsonb_array_elements\(case when jsonb_typeof\((?:"civic_data_promotions"\.)?"payload"->'meetings'\) = 'array'/);
  assert.doesNotMatch(select, /select (?:"civic_data_promotions"\.)?"payload"[,\s]/, "the payload column is never selected whole");
  assert.doesNotMatch(select, /::timestamptz/, "no cast can fail the clock; the runner parses the strings");
  const observed = routineClockPointedObservedRead(drizzle.mock({ schema }), "MEETING", "source:x:body:y").toSQL().sql;
  assert.doesNotMatch(observed.slice(0, observed.indexOf(" from ")), DATASET);
  assert.match(observed, /"civic_data_candidate_events"\."sequence" = \$\d/);
});
