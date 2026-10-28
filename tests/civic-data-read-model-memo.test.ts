import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import {
  clearPromotedReadModelCache,
  promotedEdgeEntryOf,
  readPromotedCivicData,
  readPromotedCivicDataBatch,
  type CivicDataReadStore,
} from "../lib/civic-data/read-model.ts";
import { publishedCandidateMetadata, promotedPointerIdentity, type CandidateVersionReadback } from "../lib/civic-data/store.ts";
import type {
  CandidateVersionRecord,
  PromotedProjection,
  RoutineRecordClass,
} from "../lib/civic-data/types.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type ValidationReceipt } from "../lib/civic-data/types.ts";

const CLASS: RoutineRecordClass = "FEC_FUNDING";

interface Version {
  projection: PromotedProjection;
  candidate: CandidateVersionRecord;
}

function version(scope: string, versionId: string, payload: unknown, recordClass: RoutineRecordClass = CLASS): Version {
  const payloadHash = normalizedHash(payload);
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: versionId,
    sourceId: "fec-open-api",
    recordClass,
    scope,
    validatedAt: "2026-09-01T00:01:00.000Z",
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS",
      code: `${check}_PASS`,
      detail: `${check} was proven for ${versionId}.`,
    })),
    excludedFacts: [],
  };
  const projection = {
    key: `${recordClass}:${scope}`,
    sourceId: "fec-open-api",
    recordClass,
    scope,
    versionId,
    lastKnownGoodVersionId: versionId,
    promotedAt: "2026-09-02T00:00:00.000Z",
    payload,
    receipt,
  } satisfies PromotedProjection;
  const candidate = {
    candidate: {
      id: versionId,
      sourceId: "fec-open-api",
      recordClass,
      scope,
      sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", recordClass, scope),
      retrieval: {
        succeeded: true,
        requestedUrl: "https://api.open.fec.gov/v1/candidates/search/",
        finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
        httpStatus: 200,
        retrievedAt: "2026-09-01T00:00:00.000Z",
        rawHash: "a".repeat(64),
      },
      normalization: {
        succeeded: true,
        parserVersion: "fec-funding/4",
        schemaVersion: "2",
        normalizedHash: payloadHash,
        normalizedPayloadHash: payloadHash,
        inputRecords: 1,
        outputRecords: 1,
        droppedRecords: 0,
        missingRequiredFields: [],
      },
      identities: [],
      temporal: { version: "2026", expectedVersion: "2026", sourceThrough: "2026-08-31", staleAtRetrieval: false },
      semantics: { factKind: "test", violations: [] },
      horizon: { kind: "OPEN_FACT_SET", query: "test", returnedRecords: 1, declaredTotal: null, paginationComplete: true, claimsComplete: false },
      absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
      dependentChecks: [{ consumer: "test", passed: true, detail: "accepted" }],
      normalizedPayload: payload,
      readModel: payload,
    },
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt,
    promotedVersion: versionId,
    lastKnownGoodVersion: versionId,
    failureCode: null,
    failureDetail: null,
  } satisfies CandidateVersionRecord;
  return { projection, candidate };
}

interface SpyCounts {
  readPromotion: number;
  readCandidate: number;
  readMetadata: number;
  readPromotions: number;
  readPromotionScopes: string[][];
  readCandidates: string[][];
  readPromotionIdentity: number;
  readPromotionIdentities: string[][];
}

function spyStore(
  pointers: Map<string, Version>,
  options: {
    readonly identity?: boolean;
    readonly identitiesFail?: boolean;
    readonly gate?: Promise<void>;
    readonly failFirstReads?: number;
  } = {},
) {
  const counts: SpyCounts = {
    readPromotion: 0,
    readCandidate: 0,
    readMetadata: 0,
    readPromotions: 0,
    readPromotionScopes: [],
    readCandidates: [],
    readPromotionIdentity: 0,
    readPromotionIdentities: [],
  };
  const byVersion = new Map<string, CandidateVersionRecord>();
  const record = (v: Version) => byVersion.set(v.projection.versionId, v.candidate);
  for (const v of pointers.values()) record(v);
  const store = {
    readPublishedCandidateMetadata: async (candidateId: string) => {
      counts.readMetadata++;
      const row = byVersion.get(candidateId);
      return row ? publishedCandidateMetadata(row) : null;
    },
    readPromotion: async <R>(_recordClass: RoutineRecordClass, scope: string) => {
      counts.readPromotion += 1;
      const attempt = counts.readPromotion;
      if (options.gate) await options.gate;
      if (attempt <= (options.failFirstReads ?? 0)) throw new Error("pointer read failed");
      return (pointers.get(scope)?.projection ?? null) as PromotedProjection<R> | null;
    },
    readCandidate: async (candidateId: string) => {
      counts.readCandidate += 1;
      return byVersion.get(candidateId) ?? null;
    },
    readPromotions: async <R>(_recordClass: RoutineRecordClass, scopes: readonly string[]) => {
      counts.readPromotions += 1;
      counts.readPromotionScopes.push([...scopes]);
      return scopes.flatMap((scope) => {
        const projection = pointers.get(scope)?.projection;
        return projection ? [projection as PromotedProjection<R>] : [];
      });
    },
    readCandidates: async (candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> => {
      counts.readCandidates.push([...candidateIds]);
      return candidateIds.flatMap((id) => {
        const rec = byVersion.get(id);
        return rec ? [{ candidateId: id, record: rec }] : [];
      });
    },
    ...(options.identity
      ? {
          readPromotionIdentity: async (_recordClass: RoutineRecordClass, scope: string) => {
            counts.readPromotionIdentity += 1;
            const projection = pointers.get(scope)?.projection;
            return projection ? promotedPointerIdentity(projection) : null;
          },
          readPromotionIdentities: async (_recordClass: RoutineRecordClass, scopes: readonly string[]) => {
            counts.readPromotionIdentities.push([...scopes]);
            if (options.identitiesFail) throw new Error("identity read failed");
            return scopes.flatMap((scope) => {
              const projection = pointers.get(scope)?.projection;
              return projection ? [promotedPointerIdentity(projection)] : [];
            });
          },
        }
      : {}),
  };
  const advance = (scope: string, next: Version) => {
    record(next);
    pointers.set(scope, next);
  };
  return { store: store as unknown as CivicDataReadStore, counts, advance };
}

beforeEach(() => clearPromotedReadModelCache());

test("every operation rechecks the pointer and candidate through the store", async () => {
  const pointers = new Map([["federal-supported", version("federal-supported", "v-a", { answer: 1 })]]);
  const { store, counts } = spyStore(pointers, { identity: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const result: Awaited<ReturnType<typeof readPromotedCivicData<{ answer: number }>>> = await readPromotedCivicData<{ answer: number }>(CLASS, "federal-supported", { store });
    assert.equal(result.kind, "PROMOTED");
    if (result.kind === "PROMOTED") assert.equal(result.value.answer, 1);
  }
  assert.equal(counts.readPromotion, 3);
  assert.equal(counts.readCandidate, 3);
  assert.equal(counts.readPromotionIdentity, 0, "there is one store read path");
});

test("the next read sees a moved pointer without waiting for a TTL", async () => {
  const scope = "federal-supported";
  const { store, advance } = spyStore(new Map([[scope, version(scope, "v-a", { answer: 1 })]]));
  await readPromotedCivicData(CLASS, scope, { store });
  advance(scope, version(scope, "v-b", { answer: 2 }));
  const result = await readPromotedCivicData<{ answer: number }>(CLASS, scope, { store });
  assert.equal(result.kind, "PROMOTED");
  if (result.kind === "PROMOTED") assert.equal(result.value.answer, 2);
});

test("a changed candidate behind the same pointer is checked on the next read", async () => {
  const scope = "federal-supported", held = version(scope, "v-a", { answer: 1 });
  const { store } = spyStore(new Map([[scope, held]]));
  assert.equal((await readPromotedCivicData(CLASS, scope, { store })).kind, "PROMOTED");
  Object.assign(held.candidate, { state: "VALIDATED" });
  const result = await readPromotedCivicData(CLASS, scope, { store });
  assert.equal(result.kind, "STORE_UNREACHABLE");
  if (result.kind === "STORE_UNREACHABLE") assert.equal(result.code, "PROMOTION_PROOF_INVALID");
});

test("an absent pointer is checked again on the next read", async () => {
  const scope = "federal-supported";
  const { store, advance } = spyStore(new Map());
  assert.equal((await readPromotedCivicData(CLASS, scope, { store })).kind, "NOT_RECORDED");
  advance(scope, version(scope, "v-a", { answer: 1 }));
  assert.equal((await readPromotedCivicData(CLASS, scope, { store })).kind, "PROMOTED");
});

test("batch reads recheck all rows and see updates and removals immediately", async () => {
  const pointers = new Map([
    ["scope-a", version("scope-a", "v-a", { answer: 1 })],
    ["scope-b", version("scope-b", "v-b", { answer: 2 })],
  ]);
  const { store, counts, advance } = spyStore(pointers, { identity: true });
  await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });
  advance("scope-b", version("scope-b", "v-b2", { answer: 3 }));
  pointers.delete("scope-a");
  const results = await readPromotedCivicDataBatch<{ answer: number }>(CLASS, ["scope-a", "scope-b"], { store });
  assert.equal(results[0]?.kind, "NOT_RECORDED");
  assert.equal(results[1]?.kind, "PROMOTED");
  if (results[1]?.kind === "PROMOTED") assert.equal(results[1].value.answer, 3);
  assert.deepEqual(counts.readPromotionScopes, [["scope-a", "scope-b"], ["scope-a", "scope-b"]]);
  assert.deepEqual(counts.readCandidates, [["v-a", "v-b"], ["v-b2"]]);
});

test("concurrent reads each ask the store for current rows", async () => {
  const scope = "federal-supported";
  const { store, counts } = spyStore(new Map([[scope, version(scope, "v-a", { answer: 1 })]]));
  const results = await Promise.all([1, 2, 3].map(() => readPromotedCivicData(CLASS, scope, { store })));
  assert.deepEqual(results.map(result => result.kind), ["PROMOTED", "PROMOTED", "PROMOTED"]);
  assert.equal(counts.readPromotion, 3);
  assert.equal(counts.readCandidate, 3);
});

test("readers of different stores check their own candidate rows", async () => {
  const scope = "federal-supported";
  const first = spyStore(new Map([[scope, version(scope, "same-id", { answer: 1 })]]));
  const second = spyStore(new Map([[scope, version(scope, "same-id", { answer: 2 })]]));
  await readPromotedCivicData(CLASS, scope, { store: first.store });
  const result = await readPromotedCivicData<{ answer: number }>(CLASS, scope, { store: second.store });
  assert.equal(result.kind, "PROMOTED");
  if (result.kind === "PROMOTED") assert.equal(result.value.answer, 2);
  assert.equal(second.counts.readCandidate, 1);
});

const STATE_SCOPE = "US-AZ:state-election-ballots";
const STATE_CLASS = "BALLOT_CANDIDACY";

test("state operations recheck publication metadata and keep compact edge attestations", async () => {
  const { store, counts } = spyStore(new Map([[STATE_SCOPE, version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS)]]));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
    assert.equal(result.kind, "PROMOTED");
    assert.equal(promotedEdgeEntryOf(result, STATE_CLASS, STATE_SCOPE, store)?.kind, "PROMOTED");
  }
  assert.equal(counts.readPromotion, 2);
  assert.equal(counts.readMetadata, 2);
  assert.equal(counts.readCandidate, 0);
});

test("state publication metadata and the one loaded payload must still agree", async () => {
  const source = version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS);
  const metadata = publishedCandidateMetadata(source.candidate);
  for (const [name, projection, proof] of [
    ["changed payload", { ...source.projection, payload: { answer: 2 } }, metadata],
    ["wrong scope", source.projection, { ...metadata, candidate: { ...metadata.candidate, scope: "US-NH:state-election-ballots" } }],
    ["wrong version", source.projection, { ...metadata, promotedVersion: "other" }],
    ["nonpromoted candidate", source.projection, { ...metadata, state: "VALIDATED" }],
    ["missing candidate", source.projection, null],
    ["wrong hash", source.projection, { ...metadata, candidate: { ...metadata.candidate, normalization: { ...metadata.candidate.normalization, normalizedHash: "f".repeat(64) } } }],
    ["mismatched receipt", source.projection, { ...metadata, receipt: { ...metadata.receipt!, candidateId: "other" } }],
    ["different receipt facts", source.projection, { ...metadata, receipt: { ...metadata.receipt!, excludedFacts: [{ code: "HELD", detail: "An additional held fact." }] } }],
  ] as const) {
    const read = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, {  store: {
      readPromotion: async <T>() => projection as PromotedProjection<T>,
      readPublishedCandidateMetadata: async () => proof as typeof metadata | null,
      readCandidate: async () => { throw new Error("No candidate payload read is allowed."); },
    } });
    assert.equal(read.kind, "STORE_UNREACHABLE", name);
    if (read.kind === "STORE_UNREACHABLE") assert.equal(read.code,
      proof === null ? "PROMOTION_CANDIDATE_MISSING" : "PROMOTION_PROOF_INVALID", name);
  }
  const { store: originalStore } = spyStore(new Map([[STATE_SCOPE, source]]));
  const store = { ...originalStore,
    readPublishedCandidateMetadata: async () => ({ ...metadata, receipt: structuredClone(metadata.receipt) }) };
  const read = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
  const edge = promotedEdgeEntryOf(read, STATE_CLASS, STATE_SCOPE, store);
  assert.equal(edge?.kind, "PROMOTED");
  if (edge?.kind !== "PROMOTED") return;
  assert.equal((await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { edge })).kind, "PROMOTED");
  const altered = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { edge: {
    ...edge, projection: { ...edge.projection, payload: { answer: 99 } },
  } });
  assert.equal(altered.kind, "STORE_UNREACHABLE");
});

test("Postgres published metadata reads only metadata and resolves encoded evidence fields", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { neonConfig } = await import("../lib/db/client.ts");
  const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
  const pg = new PGlite();
  const metadata = publishedCandidateMetadata(version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS).candidate);
  const oldFetch = neonConfig.fetchFunction, oldUrl = process.env.DATABASE_URL, oldReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  const queries: string[] = [];
  const fields = ["retrieval", "temporal", "normalization"] as const;
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,candidate jsonb,state text,acquisition_succeeded boolean,
    validation_receipt jsonb,promoted_version_id text,last_known_good_version_id text,failure_code text,failure_detail text,raw_hash text,normalized_hash text,parser_version text);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);`);
  for (const [index, field] of fields.entries()) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",
    [String(index+1).repeat(64),{kind:"object",value:metadata.candidate[field]}]);
  await pg.query("INSERT INTO civic_data_candidates(id,candidate,state,acquisition_succeeded,validation_receipt,promoted_version_id,last_known_good_version_id,failure_code,failure_detail) VALUES('az-a',$1,'PROMOTED',true,$2,'az-a','az-a',null,null)",
    [metadata.candidate,metadata.receipt]);
  neonConfig.fetchFunction = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(!body.queries,"metadata reads never flush accounting or write a fixture");
    queries.push(body.query);
    const result=await pg.query<Record<string,unknown>>(body.query,body.params);
    return new Response(JSON.stringify({command:"SELECT",rowCount:result.rows.length,rowAsArray:true,fields:result.fields,
      rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];
        return value===null?null:typeof value==="object"?JSON.stringify(value):typeof value==="boolean"?(value?"t":"f"):String(value);
      }))}));
  };
  process.env.DATABASE_URL = "postgresql://fixture:fixture@ep-state-metadata.us-east-2.aws.neon.tech/neondb";
  try {
    for (const encoded of [false,true]) {
      const candidate=encoded?{...metadata.candidate,...Object.fromEntries(fields.map((field,index)=>
        [field,{$civicPayloadPart:String(index+1).repeat(64)}]))}:metadata.candidate;
      await pg.query("UPDATE civic_data_candidates SET candidate=$1,raw_hash=$2 WHERE id='az-a'",[candidate,encoded?'encoded-fixture':'inline-fixture']);
      queries.length=0;
      const read=await new PostgresRoutineDataStore().readPublishedCandidateMetadata("az-a");
      const expected = encoded ? metadata : { ...metadata, candidate: { ...metadata.candidate,
        normalization: { ...metadata.candidate.normalization, stateRecordHashes: null } } };
      assert.deepEqual(read,expected,"inline SQL represents an absent state index as JSON null; encoded metadata retains its stored shape");
      assert.match(queries[0],/content-v1/,"the version is checked before the metadata body");
      const bodyReads=queries.filter(query=>query.includes("jsonb_build_object"));
      assert.equal(bodyReads.length,1);
      assert.doesNotMatch(bodyReads[0],/->\s*'(?:readModel|normalizedPayload|identities|civicRecords|changeSet)'/);
      assert.deepEqual(Object.keys(read!.candidate).sort(),["id","normalization","recordClass","retrieval","scope","sourceId","temporal"]);
    }
  } finally {
    neonConfig.fetchFunction=oldFetch;
    if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
    if(oldReport===undefined)delete process.env.WTP_VITAL_SIGNS_REPORT;else process.env.WTP_VITAL_SIGNS_REPORT=oldReport;
    await pg.close();
  }
});
