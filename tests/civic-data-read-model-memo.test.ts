import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { withReaderSelection } from "../lib/db/reader-route.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import {
  attestPromotedVersion,
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

test("the single read proves a version once, then attests without re-reading the candidate", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts } = spyStore(pointers);

  const first = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  const second = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });

  assert.equal(first.kind, "PROMOTED");
  assert.equal(second.kind, "PROMOTED");
  if (first.kind === "PROMOTED" && second.kind === "PROMOTED") {
    assert.equal(first.value.answer, 1);
    assert.deepEqual(second.value, first.value);
  }
  // The pointer is re-read every time (freshness); the candidate is fetched ONCE.
  assert.equal(counts.readPromotion, 2, "the pointer is always read fresh");
  assert.equal(counts.readCandidate, 1, "the candidate envelope is hauled once, then attested");
});

test("a pointer move to a new version is fetched and re-proved, never masked by the memo", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts, advance } = spyStore(pointers);

  const first = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  assert.equal(first.kind, "PROMOTED");
  if (first.kind === "PROMOTED") assert.equal(first.value.answer, 1);

  // A new promotion advances the pointer to v-b. The instance still holds v-a as
  // proven — the memo must NOT serve it. The freshly read pointer names v-b.
  advance("US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-b", { answer: 2 }));

  const second = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  assert.equal(second.kind, "PROMOTED");
  if (second.kind === "PROMOTED") {
    assert.equal(second.value.answer, 2, "the new version is served — a pointer move is honored");
  }
  assert.equal(counts.readCandidate, 2, "v-b's candidate is fetched and proved; the memo did not mask it");
});

test("a bypassCache read never uses the memo — it re-proves the version every time", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts } = spyStore(pointers);

  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store, bypassCache: true });
  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store, bypassCache: true });

  assert.equal(counts.readCandidate, 2, "the verification path re-fetches and re-proves each time");
});

test("the batch read fetches candidate envelopes only for versions not yet proven", async () => {
  const pointers = new Map([
    ["scope-a", version("scope-a", "v-a", { answer: 1 })],
    ["scope-b", version("scope-b", "v-b", { answer: 2 })],
  ]);
  const { store, counts } = spyStore(pointers);

  const first = await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });
  assert.deepEqual(first.map((r) => r.kind), ["PROMOTED", "PROMOTED"]);
  assert.equal(counts.readCandidates.length, 1, "the first batch read hauls candidates once");
  assert.deepEqual(new Set(counts.readCandidates[0]), new Set(["v-a", "v-b"]), "both versions' envelopes are hauled");

  const second = await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });
  assert.deepEqual(second.map((r) => r.kind), ["PROMOTED", "PROMOTED"]);
  assert.equal(counts.readPromotions, 2, "each batch read re-reads the pointers");
  assert.equal(counts.readCandidates.length, 1, "no envelope is hauled on the steady-state read");
});

test("the batch read hauls only the moved partition's envelope when one pointer advances", async () => {
  const pointers = new Map([
    ["scope-a", version("scope-a", "v-a", { answer: 1 })],
    ["scope-b", version("scope-b", "v-b", { answer: 2 })],
  ]);
  const { store, counts, advance } = spyStore(pointers);

  await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });
  advance("scope-b", version("scope-b", "v-b2", { answer: 3 }));
  const second = await readPromotedCivicDataBatch<{ answer: number }>(CLASS, ["scope-a", "scope-b"], { store });

  assert.equal(counts.readCandidates.length, 2, "the second read hauls candidates again");
  assert.deepEqual(counts.readCandidates[1], ["v-b2"], "only the moved partition's envelope is hauled; scope-a is attested");
  const b = second[1];
  assert.equal(b.kind, "PROMOTED");
  if (b.kind === "PROMOTED") assert.equal(b.value.answer, 3);
});

test("an unmoved pointer is served from this store's proof after asking only its identity", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts } = spyStore(pointers, { identity: true });

  const first = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  const second = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  const third = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });

  assert.equal(first.kind, "PROMOTED");
  assert.deepEqual(second, first, "the proved result is served unchanged");
  assert.deepEqual(third, first);
  assert.equal(counts.readPromotion, 1, "the payload is read once");
  assert.equal(counts.readCandidate, 1, "the candidate is read and proved once");
  assert.equal(counts.readPromotionIdentity, 2, "each later read asks only which version the pointer names");
});

test("a moved pointer is read whole and proved again, never served from the old proof", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts, advance } = spyStore(pointers, { identity: true });

  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store });
  advance("US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-b", { answer: 2 }));
  const moved = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });

  assert.equal(moved.kind, "PROMOTED");
  if (moved.kind === "PROMOTED") assert.equal(moved.value.answer, 2, "the new version is served");
  assert.equal(counts.readPromotionIdentity, 1);
  assert.equal(counts.readPromotion, 2, "the moved pointer's payload is read");
  assert.equal(counts.readCandidate, 2, "the new version is proved");

  const again = await readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  if (again.kind === "PROMOTED") assert.equal(again.value.answer, 2);
  assert.equal(counts.readPromotion, 2, "the new proof is the one re-served");
});

test("a pointer whose identity changed in any field is read whole", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts, advance } = spyStore(pointers, { identity: true });

  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store });
  const same = version("US-AZ:fec-funding:v1", "v-a", { answer: 1 });
  advance("US-AZ:fec-funding:v1", { ...same, projection: { ...same.projection, promotedAt: "2026-09-03T00:00:00.000Z" } });
  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store });

  assert.equal(counts.readPromotion, 2, "a different promotedAt is not the proved pointer");
});

test("a bypassCache read never asks the identity and always proves again", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { store, counts } = spyStore(pointers, { identity: true });

  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store });
  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store, bypassCache: true });
  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store, bypassCache: true });

  assert.equal(counts.readPromotionIdentity, 0, "the verification path never takes the shortcut");
  assert.equal(counts.readPromotion, 3);
  assert.equal(counts.readCandidate, 3);
});

test("a proof is served only to the store that made it", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const a = spyStore(pointers, { identity: true });
  const b = spyStore(pointers, { identity: true });

  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store: a.store });
  await readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store: b.store });

  assert.equal(b.counts.readPromotionIdentity, 0, "store b has proved nothing yet");
  assert.equal(b.counts.readPromotion, 1, "store b reads its own pointer whole");
});

test("the batch read asks identities for proved scopes and reads only the moved one whole", async () => {
  const pointers = new Map([
    ["scope-a", version("scope-a", "v-a", { answer: 1 })],
    ["scope-b", version("scope-b", "v-b", { answer: 2 })],
  ]);
  const { store, counts, advance } = spyStore(pointers, { identity: true });

  await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });
  const unchanged = await readPromotedCivicDataBatch<{ answer: number }>(CLASS, ["scope-a", "scope-b"], { store });
  assert.deepEqual(unchanged.map((r) => r.kind), ["PROMOTED", "PROMOTED"]);
  assert.deepEqual(counts.readPromotionScopes, [["scope-a", "scope-b"]], "nothing moved: no payload is read again");
  assert.deepEqual(counts.readPromotionIdentities, [["scope-a", "scope-b"]]);

  advance("scope-b", version("scope-b", "v-b2", { answer: 3 }));
  const moved = await readPromotedCivicDataBatch<{ answer: number }>(CLASS, ["scope-a", "scope-b"], { store });
  assert.deepEqual(counts.readPromotionScopes[1], ["scope-b"], "only the moved scope's payload is read");
  assert.deepEqual(counts.readCandidates[1], ["v-b2"], "only the moved scope is proved");
  const [a, b] = moved;
  assert.equal(a?.kind, "PROMOTED");
  assert.equal(b?.kind, "PROMOTED");
  if (a?.kind === "PROMOTED") assert.equal(a.value.answer, 1);
  if (b?.kind === "PROMOTED") assert.equal(b.value.answer, 3);
});

test("a failed batch identity read decides nothing: every scope is read whole", async () => {
  const pointers = new Map([
    ["scope-a", version("scope-a", "v-a", { answer: 1 })],
    ["scope-b", version("scope-b", "v-b", { answer: 2 })],
  ]);
  const { store, counts } = spyStore(pointers, { identity: true, identitiesFail: true });

  await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });
  const second = await readPromotedCivicDataBatch(CLASS, ["scope-a", "scope-b"], { store });

  assert.deepEqual(second.map((r) => r.kind), ["PROMOTED", "PROMOTED"]);
  assert.equal(counts.readPromotionIdentities.length, 1, "the identity read was attempted");
  assert.deepEqual(counts.readPromotionScopes[1], ["scope-a", "scope-b"], "the failure falls back to the whole read");
});

test("a bypassCache batch read never asks identities", async () => {
  const pointers = new Map([["scope-a", version("scope-a", "v-a", { answer: 1 })]]);
  const { store, counts } = spyStore(pointers, { identity: true });

  await readPromotedCivicDataBatch(CLASS, ["scope-a"], { store });
  await readPromotedCivicDataBatch(CLASS, ["scope-a"], { store, bypassCache: true });

  assert.deepEqual(counts.readPromotionIdentities, []);
  assert.equal(counts.readPromotions, 2);
});

function opened(): { gate: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  return { gate, open };
}

test("concurrent readers of a cold scope share one read and one proof", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { gate, open } = opened();
  const { store, counts } = spyStore(pointers, { identity: true, gate });

  const readers = [1, 2, 3].map(() => readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store }));
  open();
  const results = await Promise.all(readers);

  assert.deepEqual(results.map((r) => r.kind), ["PROMOTED", "PROMOTED", "PROMOTED"]);
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
  assert.equal(counts.readPromotion, 1, "one pointer read serves every concurrent reader");
  assert.equal(counts.readCandidate, 1, "one candidate read and proof serves every concurrent reader");
});

test("a shared read that fails decides nothing: a waiting reader reads for itself", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { gate, open } = opened();
  const { store, counts } = spyStore(pointers, { identity: true, gate, failFirstReads: 1 });

  const first = readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store });
  const second = readPromotedCivicData<{ answer: number }>(CLASS, "US-AZ:fec-funding:v1", { store });
  open();
  const [failed, recovered] = await Promise.all([first, second]);

  assert.equal(failed.kind, "STORE_UNREACHABLE");
  assert.equal(recovered.kind, "PROMOTED", "the waiter is not handed the failure");
  if (recovered.kind === "PROMOTED") assert.equal(recovered.value.answer, 1);
  assert.equal(counts.readPromotion, 2);
});

test("verification reads never share a read", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { gate, open } = opened();
  const { store, counts } = spyStore(pointers, { identity: true, gate });

  const reads = [
    readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store, bypassCache: true }),
    readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store, bypassCache: true }),
  ];
  open();
  await Promise.all(reads);

  assert.equal(counts.readPromotion, 2, "each verification read reads and proves for itself");
  assert.equal(counts.readCandidate, 2);
});

test("readers of different stores never share a read", async () => {
  const pointers = new Map([["US-AZ:fec-funding:v1", version("US-AZ:fec-funding:v1", "v-a", { answer: 1 })]]);
  const { gate, open } = opened();
  const a = spyStore(pointers, { identity: true, gate });
  const b = spyStore(pointers, { identity: true, gate });

  const reads = [
    readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store: a.store }),
    readPromotedCivicData(CLASS, "US-AZ:fec-funding:v1", { store: b.store }),
  ];
  open();
  await Promise.all(reads);

  assert.equal(a.counts.readPromotion, 1);
  assert.equal(b.counts.readPromotion, 1);
});

const STATE_SCOPE = "US-AZ:state-election-ballots";
const STATE_CLASS = "BALLOT_CANDIDACY";

test("state store reads share only the active load and retain a compact edge attestation", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { store, counts } = spyStore(new Map([[STATE_SCOPE, version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS)]]), { gate, identity: true });
  const first = readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
  const second = readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.kind, "PROMOTED");
  assert.deepEqual(two, one);
  assert.equal(counts.readPromotion, 1);
  assert.equal(counts.readMetadata, 1);
  assert.equal(counts.readCandidate, 0, "published state reads never fetch a candidate payload");
  const entry = promotedEdgeEntryOf(one, STATE_CLASS, STATE_SCOPE, store);
  assert.equal(entry?.kind, "PROMOTED");
  assert.equal(attestPromotedVersion(STATE_CLASS, STATE_SCOPE, store)?.payloadSha256, normalizedHash({ answer: 1 }));

  await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
  assert.equal(counts.readPromotion, 2, "the next explicit operation reads its own state unit");
  assert.equal(counts.readMetadata, 2, "no completed state proof keeps the prior candidate alive");
  assert.equal(counts.readPromotionIdentity, 0);
});

test("state pointer reuse belongs to one reader selection", async () => {
  const { store, counts } = spyStore(new Map([[STATE_SCOPE, version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS)]]), { identity: true });
  await withReaderSelection({ keys: new Set(["US-AZ"]) }, async () => {
    await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
    const reused = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store });
    assert.equal(reused.kind, "PROMOTED");
    assert.equal(promotedEdgeEntryOf(reused, STATE_CLASS, STATE_SCOPE, store)?.kind, "PROMOTED");
  });
  assert.equal(counts.readPromotion, 1);
  assert.equal(counts.readMetadata, 1);
  assert.equal(counts.readPromotionIdentity, 1);
  await withReaderSelection({ keys: new Set(["US-AZ"]) }, () => readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store }));
  assert.equal(counts.readPromotion, 2);
  assert.equal(counts.readMetadata, 2);
});

test("state batch and verification reads leave no persistent payload proof", async () => {
  const { store, counts } = spyStore(new Map([[STATE_SCOPE, version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS)]]), { identity: true });
  await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store, bypassCache: true });
  assert.equal(attestPromotedVersion(STATE_CLASS, STATE_SCOPE, store), null);
  await readPromotedCivicDataBatch(STATE_CLASS, [STATE_SCOPE, STATE_SCOPE], { store });
  await readPromotedCivicDataBatch(STATE_CLASS, [STATE_SCOPE], { store });
  assert.equal(counts.readPromotion, 3);
  assert.equal(counts.readMetadata, 3);
  assert.equal(counts.readPromotions, 0);
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
    const read = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { bypassCache: true, store: {
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
  const read = await readPromotedCivicData(STATE_CLASS, STATE_SCOPE, { store, bypassCache: true });
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
  const { neonConfig } = await import("@neondatabase/serverless");
  const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
  const metadata = publishedCandidateMetadata(version(STATE_SCOPE, "az-a", { answer: 1 }, STATE_CLASS).candidate);
  const oldFetch = neonConfig.fetchFunction, oldUrl = process.env.DATABASE_URL;
  const queries: string[] = [];
  let encoded = false;
  const fields = ["retrieval", "temporal", "normalization"] as const;
  const parts = new Map(fields.map((field, index) => [String(index + 1).repeat(64), { kind: "object", value: metadata.candidate[field] }]));
  const result = (columns: readonly (readonly [string, number])[], rows: readonly unknown[][]) => ({
    command: "SELECT", rowCount: rows.length, rowAsArray: true,
    fields: columns.map(([name, dataTypeID]) => ({ name, dataTypeID })),
    rows: rows.map(row => row.map(value => value === null ? null : typeof value === "object" ? JSON.stringify(value) : value)),
  });
  neonConfig.fetchFunction = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { query?: string; queries?: unknown[] };
    if (body.queries) return new Response(JSON.stringify({ results: body.queries.map(() => result([], [])) }));
    const query = body.query!;
    queries.push(query);
    if (query.includes('from "civic_data_payload_parts"')) return new Response(JSON.stringify(result(
      [["hash", 25], ["payload", 3802]], [...parts].map(([hash, payload]) => [hash, payload]),
    )));
    const candidate = encoded ? { ...metadata.candidate, ...Object.fromEntries(fields.map((field, index) =>
      [field, { $civicPayloadPart: String(index + 1).repeat(64) }])) } : metadata.candidate;
    return new Response(JSON.stringify(result(
      [["id", 25], ["candidate", 3802], ["state", 25], ["acquisition_succeeded", 16], ["receipt", 3802],
        ["promoted_version_id", 25], ["last_known_good_version_id", 25], ["failure_code", 25], ["failure_detail", 25]],
      [["az-a", candidate, "PROMOTED", "t", metadata.receipt, "az-a", "az-a", null, null]],
    )));
  }) as typeof neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@ep-state-metadata.us-east-2.aws.neon.tech/neondb";
  try {
    for (encoded of [false, true]) {
      queries.length = 0;
      const read = await new PostgresRoutineDataStore().readPublishedCandidateMetadata("az-a");
      assert.deepEqual(read, metadata);
      assert.equal(queries.length, encoded ? 2 : 1);
      assert.match(queries[0], /jsonb_build_object/);
      assert.doesNotMatch(queries[0], /->\s*'(?:readModel|normalizedPayload|identities|civicRecords|changeSet)'/);
      assert.deepEqual(Object.keys(read!.candidate).sort(), ["id", "normalization", "recordClass", "retrieval", "scope", "sourceId", "temporal"]);
    }
  } finally {
    neonConfig.fetchFunction = oldFetch;
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  }
});
