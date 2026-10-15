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
import { MEETING_PARTITION_CONTRACTS, meetingHistoryContract } from "../lib/civic-data/meeting-partitions.ts";
import type { MeetingsProjectionReadResult, MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

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
    recordRecheck: notImplemented,
    latestCandidate: async () => null,
    events: async () => [],
    clock: async () => ({}),
    readCandidate: async () => null,
    readCandidateSummary: async () => null,
    readCandidates: async () => [],
    readPromotion: async () => null,
    readPromotions: async () => [],
    readPromotionIdentity: async () => null,
    readPromotionIdentities: async () => [],
    readPreparedReaderProjection: async () => null,
    readPreparedReaderProjectionCoupling: async () => null,
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
    { contractId: meetingHistoryContract(contracts[0]!).id, versionId: "history-a" },
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
  assert.equal(promoted.find((p) => p.contractId === contracts[0]!.id)?.history?.versionId, "history-a");
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
  const composedFrom = [...contracts.map((contract) => ({ contractId: contract.id, versionId: `ver-${contract.id}` })),
    { contractId: "meeting-facts", versionId: "facts:none" }];
  // The idempotent pass decides from identities and the serving copy's coupling alone: no partition or composed
  // payload is read to learn that nothing changed.
  const store = fakeStore({
    readPromotions: async () => { throw new Error("PARTITION_PAYLOADS_MUST_NOT_BE_READ_ON_IDEMPOTENT_PREPARE"); },
    readPromotionIdentities: async () => promotions.map(({ payload: _payload, receipt: _receipt, ...identity }) => identity),
    readCandidates: async () => { throw new Error("COMPOSE_MUST_NOT_RUN_ON_IDEMPOTENT_PREPARE"); },
    readPreparedReaderProjection: async () => { throw new Error("PREPARED_PAYLOAD_MUST_NOT_BE_READ_ON_IDEMPOTENT_PREPARE"); },
    readPreparedReaderProjectionCoupling: async () => ({
      recordClass: "MEETING",
      scope: MEETINGS_PREPARED_SCOPE,
      sequence: 3,
      composedFrom,
      generatedAt: "2026-09-06T00:00:00.000Z",
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

function preparedRow(sequence: number, generatedAt = "2026-09-05T00:00:00.000Z") {
  return {
    recordClass: "MEETING" as const,
    scope: MEETINGS_PREPARED_SCOPE,
    sequence,
    payload: { formatVersion: 1, generatedAt, counts: { fresh: 0, carried: 0, total: 0 }, sources: [], meetings: [], agendaDocuments: [] },
    composedFrom: [{ contractId: MEETING_PARTITION_CONTRACTS[0]!.id, versionId: `ver-${sequence}` }],
    factSha256: "a".repeat(64),
    generatedAt,
    composedAt: generatedAt,
    sourceThrough: null,
    retrievedAt: null,
    promotedThrough: null,
  };
}

test("a reader that holds the current prepared row asks only its coupling before serving it again", async () => {
  let current = preparedRow(4);
  const reads = { row: 0, coupling: 0 };
  const store = fakeStore({
    readPreparedReaderProjection: async () => { reads.row += 1; return current; },
    readPreparedReaderProjectionCoupling: async () => {
      reads.coupling += 1;
      const { recordClass, scope, sequence, composedFrom, generatedAt } = current;
      return { recordClass, scope, sequence, composedFrom, generatedAt };
    },
  });

  const first = await readPreparedMeetingsProjection({ store });
  const second = await readPreparedMeetingsProjection({ store });
  assert.equal(first.kind, "PROMOTED");
  assert.equal(second.kind, "PROMOTED");
  if (first.kind === "PROMOTED" && second.kind === "PROMOTED") assert.equal(second.value, first.value, "the held row is served");
  assert.deepEqual(reads, { row: 1, coupling: 1 }, "the 7.5 MB row is read once; the second read asks only the coupling");

  // The runner republishes: the sequence advances and the new row is read.
  current = preparedRow(5, "2026-09-05T01:00:00.000Z");
  const third = await readPreparedMeetingsProjection({ store });
  assert.equal(reads.row, 2, "a new sequence is read whole");
  if (third.kind === "PROMOTED") assert.equal(third.value.generatedAt, "2026-09-05T01:00:00.000Z");
});

test("a held prepared row is re-read when the coupling differs in any part", async () => {
  const held = preparedRow(4);
  let coupling = { recordClass: held.recordClass, scope: held.scope, sequence: 4, composedFrom: held.composedFrom, generatedAt: held.generatedAt };
  let rowReads = 0;
  const store = fakeStore({
    readPreparedReaderProjection: async () => { rowReads += 1; return held; },
    readPreparedReaderProjectionCoupling: async () => coupling,
  });

  await readPreparedMeetingsProjection({ store });
  coupling = { ...coupling, generatedAt: "2026-09-05T02:00:00.000Z" };
  await readPreparedMeetingsProjection({ store });
  assert.equal(rowReads, 2, "the same sequence with another generation time is not the held row");

  coupling = { ...coupling, generatedAt: held.generatedAt, composedFrom: [{ contractId: "other", versionId: "v" }] };
  await readPreparedMeetingsProjection({ store });
  assert.equal(rowReads, 3, "the same sequence composed from other versions is not the held row");
});

test("prepare composes through the pass's shared composition, and only when the coupling changed", async () => {
  const contracts = MEETING_PARTITION_CONTRACTS;
  const identities = contracts.map((contract) => ({
    key: `MEETING:${contract.scope}`,
    sourceId: contract.sourceId,
    recordClass: "MEETING" as const,
    scope: contract.scope,
    versionId: `ver-${contract.id}`,
    lastKnownGoodVersionId: `ver-${contract.id}`,
    promotedAt: "2026-09-06T00:00:00.000Z",
  }));
  const snapshot = { formatVersion: 1, generatedAt: "2026-09-06T00:00:00.000Z", counts: { fresh: 0, carried: 0, total: 0 }, sources: [], meetings: [], agendaDocuments: [] };
  let composed = 0;
  const aggregate = async () => {
    composed += 1;
    return {
      kind: "PROMOTED" as const,
      value: snapshot,
      metadata: {
        recordClass: "MEETING" as const,
        scope: "meetings",
        sourceId: "meetings",
        version: null,
        versionId: null,
        lastKnownGoodVersionId: null,
        sourceThrough: null,
        retrievedAt: null,
        promotedAt: null,
        stale: "CURRENT" as const,
        staleAt: null,
      },
      partitions: contracts.map((contract) => ({
        contractId: contract.id,
        source: contract.meetingSource,
        bodyId: contract.bodyId,
        scope: contract.scope,
        kind: "PROMOTED" as const,
        versionId: `ver-${contract.id}`,
        detail: null,
      })),
      detail: "composed",
    } as unknown as MeetingsProjectionReadResult;
  };
  const writes: unknown[] = [];
  let coupling: { recordClass: "MEETING"; scope: string; sequence: number; composedFrom: { contractId: string; versionId: string }[]; generatedAt: string } | null = null;
  const store = fakeStore({
    readPromotions: async () => { throw new Error("PREPARE_MUST_USE_THE_SHARED_COMPOSITION"); },
    readCandidates: async () => { throw new Error("PREPARE_MUST_USE_THE_SHARED_COMPOSITION"); },
    readPromotionIdentities: async () => identities,
    readPreparedReaderProjectionCoupling: async () => coupling,
    writePreparedReaderProjection: async (input) => {
      writes.push(input);
      return { published: true, sequence: 1 };
    },
  });

  const published = await preparePublishedMeetingSnapshot(store, "2026-09-06T00:05:00.000Z", { aggregate });
  assert.equal(published.status, "PUBLISHED");
  assert.equal(composed, 1, "the changed set is composed once, by the shared composition");
  assert.equal(writes.length, 1);
  assert.equal((writes[0] as { payload: unknown }).payload, snapshot, "the shared composition is what publishes");

  coupling = {
    recordClass: "MEETING",
    scope: MEETINGS_PREPARED_SCOPE,
    sequence: 1,
    composedFrom: [...contracts.map((contract) => ({ contractId: contract.id, versionId: `ver-${contract.id}` })),
      { contractId: "meeting-facts", versionId: "facts:none" }],
    generatedAt: snapshot.generatedAt,
  };
  const current = await preparePublishedMeetingSnapshot(store, "2026-09-06T00:10:00.000Z", { aggregate });
  assert.equal(current.status, "CURRENT");
  assert.equal(composed, 1, "an unchanged set asks for no composition");
});

test("history-only changes republish, and an unreadable history keeps its accepted records and version", async () => {
  const partition = MEETING_PARTITION_CONTRACTS[0]!;
  const history = meetingHistoryContract(partition);
  const memory = new MemoryRoutineDataStore();
  let historyVersion = "history-1", unavailable = false, compositions = 0;
  const identity = (scope: string, versionId: string) => ({ key: `MEETING:${scope}`, sourceId: partition.sourceId,
    recordClass: "MEETING" as const, scope, versionId, lastKnownGoodVersionId: versionId, promotedAt: "2026-09-01T00:00:00Z" });
  const store = fakeStore({
    readPromotionIdentities: async (_recordClass, scopes) => [identity(partition.scope, "live-1"), identity(history.scope, historyVersion)].filter(row => scopes.includes(row.scope)),
    readPreparedReaderProjection: memory.readPreparedReaderProjection.bind(memory),
    readPreparedReaderProjectionCoupling: memory.readPreparedReaderProjectionCoupling.bind(memory),
    writePreparedReaderProjection: memory.writePreparedReaderProjection.bind(memory),
  });
  const aggregate = async (): Promise<MeetingsProjectionReadResult> => {
    compositions++;
    const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: "2026-09-06T00:00:00Z", counts: { fresh: 0, carried: 1, total: 1 }, sources: [],
      meetings: unavailable ? [] : [{ id: `${partition.meetingSource}:retained`, bodyId: partition.bodyId, title: historyVersion,
        startsAt: "2025-01-01T00:00:00Z", status: "CONCLUDED", agendaUrl: "https://official.example/agenda" } as MeetingsSnapshot["meetings"][number]], agendaDocuments: [] };
    return { kind: "PROMOTED", value: snapshot, detail: "fixture composition", metadata: {
      recordClass: "MEETING", scope: "meetings", sourceId: "meetings", version: null, versionId: null,
      lastKnownGoodVersionId: null, sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "CURRENT", staleAt: null,
    }, partitions: [{ contractId: partition.id, source: partition.meetingSource, bodyId: partition.bodyId, scope: partition.scope,
      kind: "PROMOTED", versionId: "live-1", detail: null,
      ...(unavailable ? { historyIssue: "fixture history unavailable" } : { history: { contractId: history.id, versionId: historyVersion } }),
    }] } as MeetingsProjectionReadResult;
  };
  assert.equal((await preparePublishedMeetingSnapshot(store, "2026-09-06T01:00:00Z", { aggregate })).status, "PUBLISHED");
  assert.equal((await preparePublishedMeetingSnapshot(store, "2026-09-06T01:01:00Z", { aggregate })).status, "CURRENT");
  assert.equal(compositions, 1);
  historyVersion = "history-2";
  assert.equal((await preparePublishedMeetingSnapshot(store, "2026-09-06T01:02:00Z", { aggregate })).status, "PUBLISHED");
  let row = (await memory.readPreparedReaderProjection("MEETING", MEETINGS_PREPARED_SCOPE))!;
  assert.equal((row.payload as MeetingsSnapshot).meetings[0].title, "history-2");
  assert.equal(row.composedFrom.find(entry => entry.contractId === history.id)?.versionId, "history-2");
  historyVersion = "history-3"; unavailable = true;
  assert.equal((await preparePublishedMeetingSnapshot(store, "2026-09-06T01:03:00Z", { aggregate })).status, "PUBLISHED");
  row = (await memory.readPreparedReaderProjection("MEETING", MEETINGS_PREPARED_SCOPE))!;
  assert.equal((row.payload as MeetingsSnapshot).meetings[0].title, "history-2");
  assert.equal(row.composedFrom.find(entry => entry.contractId === history.id)?.versionId, "history-2", "a failed read never claims the new history version");
});
