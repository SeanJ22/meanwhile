import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemoryRoutineDataStore,
  type PreparedReaderProjectionInput,
  type RoutineDataStore,
} from "../lib/civic-data/store.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";
import {
  MEETINGS_PREPARED_SCOPE,
  preparePublishedMeetingSnapshot,
  readPreparedMeetingsProjection,
} from "../lib/meetings/prepared-snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";

function preparedInput(overrides: Partial<PreparedReaderProjectionInput> = {}): PreparedReaderProjectionInput {
  const generatedAt = overrides.generatedAt ?? "2026-09-01T00:00:00.000Z";
  return {
    recordClass: "MEETING",
    scope: MEETINGS_PREPARED_SCOPE,
    payload: { formatVersion: 1, generatedAt, counts: { fresh: 0, carried: 0, total: 0 }, sources: [], meetings: [], agendaDocuments: [] },
    composedFrom: [{ contractId: "c-1", versionId: "v-1" }],
    factSha256: "f".repeat(64),
    generatedAt,
    composedAt: generatedAt,
    sourceThrough: null,
    retrievedAt: null,
    promotedThrough: null,
    ...overrides,
  };
}

function fakeStore(overrides: Partial<RoutineDataStore>): RoutineDataStore {
  const notImplemented = async (): Promise<never> => { throw new Error("FAKE_STORE_METHOD_NOT_IMPLEMENTED"); };
  return {
    create: notImplemented,
    transition: notImplemented,
    promote: notImplemented,
    appendEvidence: notImplemented,
    events: async () => [],
    clock: async () => ({}),
    readCandidate: async () => null,
    readCandidates: async () => [],
    readPromotion: async () => null,
    readPromotions: async () => [],
    readPromotionIdentity: async () => null,
    readPromotionIdentities: async () => [],
    readPreparedReaderProjection: async () => null,
    writePreparedReaderProjection: async () => ({ published: false, sequence: 0 }),
    ...overrides,
  };
}

test("the prepared projection publishes monotonically — an older composition can never overwrite a newer one", async () => {
  const store = new MemoryRoutineDataStore();
  const scope = MEETINGS_PREPARED_SCOPE;

  // First publication: expected absent (null) → lands at sequence 1.
  const first = await store.writePreparedReaderProjection(preparedInput({ generatedAt: "2026-09-01T00:00:00.000Z" }), null);
  assert.deepEqual(first, { published: true, sequence: 1 });

  // A stale pass that read the row while it was still absent tries to write over
  // sequence 1 with an older `expectedSequence`; it must NOT land.
  const stale = await store.writePreparedReaderProjection(preparedInput({ generatedAt: "2026-08-01T00:00:00.000Z" }), null);
  assert.equal(stale.published, false, "a null-expected write over an existing row is refused");
  assert.equal(stale.sequence, 1, "the newer row is untouched");

  // The current holder advances from sequence 1 → 2.
  const advance = await store.writePreparedReaderProjection(preparedInput({ generatedAt: "2026-09-02T00:00:00.000Z" }), 1);
  assert.deepEqual(advance, { published: true, sequence: 2 });

  // Another pass that still believes the row is at sequence 1 is refused (CAS miss).
  const casMiss = await store.writePreparedReaderProjection(preparedInput({ generatedAt: "2026-08-15T00:00:00.000Z" }), 1);
  assert.equal(casMiss.published, false, "a CAS write at a superseded sequence cannot regress the row");
  assert.equal(casMiss.sequence, 2);

  const row = await store.readPreparedReaderProjection("MEETING", scope);
  assert.equal(row?.sequence, 2);
  assert.equal((row?.payload as { generatedAt: string }).generatedAt, "2026-09-02T00:00:00.000Z", "the newest composition is what serves");
});

test("the reader fast-path serves the one prepared row and reconstructs the exact partitions shape", async () => {
  const contracts = MEETING_PARTITION_CONTRACTS;
  assert.ok(contracts.length >= 2, "fixture assumes multiple partition contracts");
  // Compose was from the first two partitions only; the rest are NOT_RECORDED.
  const composedFrom = [
    { contractId: contracts[0]!.id, versionId: "ver-a" },
    { contractId: contracts[1]!.id, versionId: "ver-b" },
  ];
  const payload = { formatVersion: 1, generatedAt: "2026-09-05T00:00:00.000Z", counts: { fresh: 1, carried: 0, total: 1 }, sources: [], meetings: [{ id: "x" }], agendaDocuments: [] };
  const store = fakeStore({
    readPreparedReaderProjection: async () => ({
      recordClass: "MEETING",
      scope: MEETINGS_PREPARED_SCOPE,
      sequence: 7,
      payload,
      composedFrom,
      factSha256: "a".repeat(64),
      generatedAt: "2026-09-05T00:00:00.000Z",
      composedAt: "2026-09-05T00:01:00.000Z",
      sourceThrough: "2026-09-05T00:00:00.000Z",
      retrievedAt: "2026-09-05T00:00:00.000Z",
      promotedThrough: "2026-09-05T00:00:30.000Z",
    }),
  });

  const result = await readPreparedMeetingsProjection({ store });
  assert.equal(result.kind, "PROMOTED");
  if (result.kind !== "PROMOTED") return;
  assert.equal(result.value, payload, "the prepared payload is served verbatim, no re-compose");
  assert.equal(result.partitions.length, contracts.length, "every contract is represented in the readback array");
  const promoted = result.partitions.filter((p) => p.kind === "PROMOTED");
  assert.equal(promoted.length, 2, "exactly the composed partitions are PROMOTED");
  assert.equal(promoted.find((p) => p.contractId === contracts[0]!.id)?.versionId, "ver-a");
  assert.ok(result.partitions.some((p) => p.kind === "NOT_RECORDED"), "uncomposed partitions are NOT_RECORDED, not invented");
  assert.match(result.detail, /prepared reader snapshot/);
});

test("the reader fast-path falls back to the composing reader only when no prepared row exists", async () => {
  // Absent prepared row + a store with no promotions → the fallback path runs
  // (readMeetingsProjection), never the prepared-serving detail.
  const store = fakeStore({ readPreparedReaderProjection: async () => null });
  const result = await readPreparedMeetingsProjection({ store });
  assert.doesNotMatch(
    result.kind === "PROMOTED" ? result.detail : result.kind,
    /prepared reader snapshot/,
    "with no prepared row the result comes from the composing reader, not the fast path",
  );
});

test("preparing over an unchanged promoted set is idempotent and never recomposes", async () => {
  // The prepared row's coupling already matches the current promoted partitions,
  // so prepare must return CURRENT without touching the expensive compose. We
  // prove the compose was skipped by making any candidate read throw: if the
  // orchestration composed, it would surface as FAILED/NOT_COMPOSABLE, not CURRENT.
  const contracts = MEETING_PARTITION_CONTRACTS;
  const promotions: PromotedProjection[] = contracts.map((contract) => ({
    key: `MEETING:${contract.scope}`,
    sourceId: contract.sourceId,
    recordClass: "MEETING",
    scope: contract.scope,
    versionId: `ver-${contract.id}`,
    lastKnownGoodVersionId: `ver-${contract.id}`,
    promotedAt: "2026-09-06T00:00:00.000Z",
    payload: {},
    receipt: {} as never,
  }));
  const composedFrom = contracts.map((contract) => ({ contractId: contract.id, versionId: `ver-${contract.id}` }));
  const store = fakeStore({
    readPromotions: (async () => promotions) as RoutineDataStore["readPromotions"],
    readCandidates: async () => { throw new Error("COMPOSE_MUST_NOT_RUN_ON_IDEMPOTENT_PREPARE"); },
    readPreparedReaderProjection: async () => ({
      recordClass: "MEETING",
      scope: MEETINGS_PREPARED_SCOPE,
      sequence: 3,
      payload: {},
      composedFrom,
      factSha256: "b".repeat(64),
      generatedAt: "2026-09-06T00:00:00.000Z",
      composedAt: "2026-09-06T00:00:10.000Z",
      sourceThrough: null,
      retrievedAt: null,
      promotedThrough: null,
    }),
    writePreparedReaderProjection: async () => { throw new Error("IDEMPOTENT_PREPARE_MUST_NOT_WRITE"); },
  });

  const result = await preparePublishedMeetingSnapshot(store, "2026-09-06T00:05:00.000Z");
  assert.equal(result.status, "CURRENT");
  if (result.status === "CURRENT") {
    assert.equal(result.coupledPartitions, contracts.length);
    assert.equal(result.sequence, 3);
  }
});
