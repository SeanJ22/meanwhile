import assert from "node:assert/strict";
import test from "node:test";

import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import {
  buildPdcV2TrustedLkgReattestationCandidate,
  executePdcV2TrustedLkgImportPlan,
  type PdcV2TrustedLkgImportPlan,
} from "../lib/civic-data/trusted-lkg-import-plan.ts";
import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { READER_PROJECTION_READBACK_PREFIX } from "../lib/civic-data/reader-readback.ts";
import {
  readPromotedCivicData,
  readPromotedCivicDataBatch,
} from "../lib/civic-data/read-model.ts";
import {
  projectRoutineDataObservability,
  type RoutineCandidateRow,
  type RoutinePromotionRow,
} from "../lib/civic-data/observability.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import {
  MemoryRoutineDataStore,
  PromotionBaseChangedError,
} from "../lib/civic-data/store.ts";
import { PDC_V2_FROZEN_BASE_SHA } from "../lib/civic-data/trusted-lkg-import.ts";
import type {
  CandidateEvent,
  CandidateVersionRecord,
  PromotedProjection,
  RoutineCandidate,
  ValidationReceipt,
} from "../lib/civic-data/types.ts";

const RETRIEVED = "2026-09-08T00:00:00.000Z";
const CUTOVER = "2026-09-09T12:00:00.000Z";
const IMPORTER_SHA = "a".repeat(40);

function sourceCandidate(): RoutineCandidate {
  return fecFundingCandidate({
    snapshot: {
      formatVersion: 1,
      fetchedAt: RETRIEVED,
      cycle: 2026,
      matchReport: { rosterMatched: 1, rosterTotal: 1, ballotMatched: 0, ballotTotal: 0 },
      candidates: [{
        dataClass: "FEC_COMMITTEE",
        fecCandidateId: "H6AZ01001",
        name: "Integrity successor control",
        state: "AZ",
        office: "H",
        district: "01",
        targetKeys: ["congress:integrity-control"],
        matchRoutes: ["bioguide-bridge"],
        principalCommitteeId: "C00999999",
        cycle: 2026,
        totals: {
          receipts: 10,
          disbursements: 1,
          cashOnHand: 9,
          individualItemized: 10,
          individualUnitemized: 0,
          smallDonorShare: 0,
          coverageEndDate: "2026-06-30",
        },
        topContributions: [],
        provenance: {
          sourceUrl: "https://api.open.fec.gov/v1/",
          sourceOrg: "Federal Election Commission",
          collectedAt: RETRIEVED,
          verifiedAt: RETRIEVED,
        },
      }],
      absences: [],
    },
    rawBodies: ["exact predecessor FEC bytes"],
    finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
    retrievedAt: RETRIEVED,
    excludedFacts: [],
  });
}

function legacyCandidate(): RoutineCandidate {
  const current = sourceCandidate();
  const { normalizedPayloadHash: _missingPermanentDigest, ...normalization } = current.normalization;
  return JSON.parse(JSON.stringify({ ...current, normalization })) as RoutineCandidate;
}

function emptyPlan(): PdcV2TrustedLkgImportPlan {
  return {
    contractVersion: 1,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    frozenRoot: "C:/immutable-frozen-base",
    importerCodeSha: IMPORTER_SHA,
    importedAt: CUTOVER,
    candidates: [],
    meetingPartitionIdsWithLkg: [],
    meetingPartitionIdsWithoutLkg: [],
    meetingRows: 0,
    agendaDocumentRows: 0,
    manualContractIds: [],
  };
}

async function seededLegacyStore<T extends MemoryRoutineDataStore>(store: T): Promise<{
  readonly store: T;
  readonly predecessor: CandidateVersionRecord;
  readonly pointer: PromotedProjection;
}> {
  const legacy = legacyCandidate();
  const seeded = await processRoutineCandidate(store, legacy, RETRIEVED);
  assert.equal(seeded.candidate.state, "PROMOTED");
  const predecessor = await store.readCandidate(legacy.id);
  const pointer = await store.readPromotion(legacy.recordClass, legacy.scope);
  assert.ok(predecessor);
  assert.ok(pointer);
  return { store, predecessor, pointer };
}

test("legacy durable LKG receives an exact no-data-change integrity successor and is immediately due", async () => {
  const { store, predecessor, pointer } = await seededLegacyStore(new MemoryRoutineDataStore());
  const before = structuredClone(predecessor);
  const result = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(result.promoted, 1);
  assert.equal(result.reattestedExisting, 1);
  assert.equal(result.skippedExisting, 0);
  assert.equal(result.dispositions[0]?.contractId, "fec-funding");
  assert.equal(result.dispositions[0]?.disposition, "REATTESTED_EXISTING_AUTHORITY");

  const currentPointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(currentPointer);
  assert.notEqual(currentPointer.versionId, pointer.versionId);
  const successor = await store.readCandidate(currentPointer.versionId);
  assert.ok(successor);
  assert.equal(successor.candidate.bootstrapImport?.kind, "TRUSTED_LKG_REATTESTATION");
  assert.equal(successor.candidate.retrieval.retrievedAt, RETRIEVED, "no new publisher retrieval is claimed");
  assert.equal(successor.candidate.temporal.sourceThrough, predecessor.candidate.temporal.sourceThrough);
  assert.equal(successor.candidate.temporal.staleAtRetrieval, true);
  assert.deepEqual(successor.candidate.readModel, predecessor.candidate.readModel);
  assert.deepEqual(successor.candidate.normalizedPayload, predecessor.candidate.normalizedPayload);
  assert.equal(successor.candidate.changeSet?.outcome, "UNCHANGED");
  assert.deepEqual(await store.readCandidate(predecessor.candidate.id), before, "the predecessor row remains immutable");

  const read = await readPromotedCivicData("FEC_FUNDING", "federal-supported", {
    store,
    now: CUTOVER,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, successor.candidate.id);
  const contract = requiredRoutineContract("fec-funding");
  const observableCandidate = (row: CandidateVersionRecord): RoutineCandidateRow => ({
    id: row.candidate.id,
    sourceId: row.candidate.sourceId,
    recordClass: row.candidate.recordClass,
    scope: row.candidate.scope,
    state: row.state,
    acquisitionSucceeded: row.acquisitionSucceeded,
    retrievedAt: row.candidate.retrieval.retrievedAt,
    sourceThrough: row.candidate.temporal.sourceThrough,
    candidate: row.candidate,
    validationReceipt: row.receipt,
    promotedVersionId: row.promotedVersion,
    lastKnownGoodVersionId: row.lastKnownGoodVersion,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  });
  const promotionRow: RoutinePromotionRow = {
    key: currentPointer.key,
    sourceId: currentPointer.sourceId,
    recordClass: currentPointer.recordClass,
    scope: currentPointer.scope,
    currentVersionId: currentPointer.versionId,
    lastKnownGoodVersionId: currentPointer.lastKnownGoodVersionId,
    promotedAt: currentPointer.promotedAt,
    payload: currentPointer.payload,
    validationReceipt: currentPointer.receipt,
  };
  const successorEvents = (await store.events(successor.candidate.id)).map((event) => ({
    id: `event:${event.candidateId}:${event.sequence}`,
    ...event,
  }));
  const predecessorEvents = (await store.events(before.candidate.id)).map((event) => ({
    id: `event:${event.candidateId}:${event.sequence}`,
    ...event,
  }));
  const admin = projectRoutineDataObservability({
    candidates: [observableCandidate(before), observableCandidate(successor)],
    events: [...predecessorEvents, ...successorEvents],
    promotions: [promotionRow],
  }, CUTOVER, [contract]);
  assert.equal(admin.contracts[0]?.canonicalPromotion.kind, "MEASURED");
  if (admin.contracts[0]?.canonicalPromotion.kind !== "MEASURED") {
    assert.fail("Admin canonical proof missing");
  }
  assert.equal(admin.contracts[0].canonicalPromotion.value.authorityOrigin, "TRUSTED_LKG_IMPORT");
  for (const window of ["24h", "7d", "30d"] as const) {
    const history = admin.contracts[0].histories[window];
    assert.ok(
      history.counts.promotions.members.some((event) => event.candidateId === successor.candidate.id),
      `${window} includes the exact re-attestation promotion event`,
    );
    assert.ok(
      history.counts.unchangedOutcomes.members.some((outcome) =>
        outcome.candidateId === successor.candidate.id && outcome.outcome === "UNCHANGED"),
      `${window} proves the exact no-data-change re-attestation outcome`,
    );
  }
  const clock = await store.clock(contract.sourceId, contract.recordClass, contract.scope);
  assert.deepEqual(clock, {}, "neither transfer nor predecessor timestamp postpones the next source read");
  assert.equal(routineTaskDue(routineTaskFromContract(contract), clock, Date.parse(CUTOVER)), true);

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal((await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId, successor.candidate.id);
});

test("a date-only legacy GOOD receipt is re-attested instead of being misclassified as 0026-ready", async () => {
  const store = new MemoryRoutineDataStore();
  const { predecessor, pointer } = await seededLegacyStore(store);
  const internals = store as unknown as {
    readonly candidates: Map<string, CandidateVersionRecord>;
    readonly history: Map<string, CandidateEvent[]>;
    readonly promotions: Map<string, PromotedProjection>;
  };
  const legacyReceipt: ValidationReceipt = {
    ...predecessor.receipt!,
    // Date.parse accepts this legacy shape, but the permanent contract does
    // not: its exact terminal event clock cannot be recovered from a date.
    validatedAt: "2026-09-08",
  };
  internals.candidates.set(predecessor.candidate.id, {
    ...predecessor,
    receipt: legacyReceipt,
  });
  internals.promotions.set(pointer.key, {
    ...pointer,
    promotedAt: "2026-09-08T00:02:00.000Z",
    receipt: legacyReceipt,
  });
  internals.history.set(predecessor.candidate.id, (internals.history.get(predecessor.candidate.id) ?? [])
    .map((event) => event.state === "VALIDATED"
      ? { ...event, at: "2026-09-08T00:01:00.000Z" }
      : event.state === "PROMOTED"
        ? { ...event, at: "2026-09-08T00:02:00.000Z" }
        : event));

  const result = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(result.dispositions[0]?.disposition, "REATTESTED_EXISTING_AUTHORITY");
  const successorPointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(successorPointer);
  assert.notEqual(successorPointer.versionId, predecessor.candidate.id);
  const successor = await store.readCandidate(successorPointer.versionId);
  assert.ok(successor?.receipt);
  assert.equal(new Date(Date.parse(successor.receipt.validatedAt)).toISOString(), successor.receipt.validatedAt);
  assert.ok((await store.events(successorPointer.versionId)).some((event) =>
    event.state === "VALIDATED" && Date.parse(event.at) === Date.parse(successor.receipt!.validatedAt)
  ));
  assert.equal(
    (await store.readCandidate(predecessor.candidate.id))?.receipt?.validatedAt,
    "2026-09-08",
    "the malformed legacy row remains immutable historical evidence",
  );
});

test("re-attestation refuses pointer tamper, legacy-digest tamper, and cross-contract laundering", async () => {
  const { predecessor, pointer } = await seededLegacyStore(new MemoryRoutineDataStore());
  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("fec-funding"),
    pointer: { ...pointer, payload: { candidates: [] } },
    predecessor,
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /predecessor row, candidate, receipt, payload, or legacy digest/);

  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("fec-funding"),
    pointer,
    predecessor: {
      ...predecessor,
      candidate: {
        ...predecessor.candidate,
        normalization: { ...predecessor.candidate.normalization, normalizedHash: "f".repeat(64) },
      },
    },
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /legacy normalized hash binds neither/);

  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("dotgov"),
    pointer,
    predecessor,
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /REATTESTATION_CONTRACT_MISMATCH:dotgov/);
});

class ReattestationRaceStore extends MemoryRoutineDataStore {
  override async promote(candidateId: string, receipt: ValidationReceipt, at: string) {
    const row = await this.readCandidate(candidateId);
    if (row?.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION") {
      throw new PromotionBaseChangedError(
        candidateId,
        row.candidate.bootstrapImport.predecessorVersionId,
        "concurrent-newer-authority",
      );
    }
    return super.promote(candidateId, receipt, at);
  }
}

class InterruptedReattestationReadbackStore extends MemoryRoutineDataStore {
  interrupted = false;

  override async appendEvidence(
    ...args: Parameters<MemoryRoutineDataStore["appendEvidence"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["appendEvidence"]>>> {
    const [candidateId, , , detail] = args;
    const row = await this.readCandidate(candidateId);
    if (
      !this.interrupted &&
      row?.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION" &&
      detail.startsWith(READER_PROJECTION_READBACK_PREFIX)
    ) {
      this.interrupted = true;
      throw new Error("SIMULATED_REATTESTATION_READBACK_INTERRUPTION");
    }
    return super.appendEvidence(...args);
  }
}

class DuplicatePredecessorBatchStore extends MemoryRoutineDataStore {
  duplicateCandidateId: string | null = null;

  override async readCandidates(
    ...args: Parameters<MemoryRoutineDataStore["readCandidates"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["readCandidates"]>>> {
    const rows = await super.readCandidates(...args);
    const duplicate = this.duplicateCandidateId === null
      ? undefined
      : rows.find(({ candidateId }) => candidateId === this.duplicateCandidateId);
    return duplicate ? [...rows, structuredClone(duplicate)] : rows;
  }
}

test("a pointer race leaves the predecessor live and the successor durably refused", async () => {
  const { store, predecessor } = await seededLegacyStore(new ReattestationRaceStore());
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /TRUSTED_LKG_REATTESTATION_PROMOTION_REFUSED:fec-funding:PROMOTION_BASE_CHANGED/,
  );
  assert.equal(
    (await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId,
    predecessor.candidate.id,
  );
  const events = (await store.events(predecessor.candidate.id));
  assert.equal(events.at(-1)?.state, "PROMOTED");
});

test("replay repairs a missing typed Reader receipt after pointer promotion without rewriting authority", async () => {
  const store = new InterruptedReattestationReadbackStore();
  const { predecessor } = await seededLegacyStore(store);
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /SIMULATED_REATTESTATION_READBACK_INTERRUPTION/,
  );
  assert.equal(store.interrupted, true);
  const promotedBeforeReplay = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(promotedBeforeReplay);
  assert.notEqual(promotedBeforeReplay.versionId, predecessor.candidate.id);
  assert.equal(
    (await store.events(promotedBeforeReplay.versionId))
      .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX)).length,
    0,
  );

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal(
    (await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId,
    promotedBeforeReplay.versionId,
    "receipt repair must not create another authority version",
  );
  const readbacks = (await store.events(promotedBeforeReplay.versionId))
    .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX));
  assert.equal(readbacks.length, 1);
});

test("permanent Reader proof fails closed without the exact predecessor row", async () => {
  const { store } = await seededLegacyStore(new MemoryRoutineDataStore());
  await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  const pointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(pointer);
  const successor = await store.readCandidate(pointer.versionId);
  assert.ok(successor);
  const predecessorId = successor.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ? successor.candidate.bootstrapImport.predecessorVersionId
    : assert.fail("successor lacks re-attestation evidence");
  const missingPredecessorStore = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: async (candidateId: string) => candidateId === predecessorId
      ? null
      : store.readCandidate(candidateId),
  };
  const read = await readPromotedCivicData("FEC_FUNDING", "federal-supported", {
    store: missingPredecessorStore,
    now: CUTOVER,
    bypassCache: true,
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  if (read.kind !== "STORE_UNREACHABLE") assert.fail("expected fail-closed proof result");
  assert.equal(read.code, "PROMOTION_PROOF_INVALID");
  assert.match(read.detail, /exact immutable predecessor candidate row is unavailable/);
});

test("batch Reader proof rejects duplicate predecessor rows instead of selecting one", async () => {
  const store = new DuplicatePredecessorBatchStore();
  await seededLegacyStore(store);
  await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  const pointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(pointer);
  const successor = await store.readCandidate(pointer.versionId);
  assert.ok(successor);
  store.duplicateCandidateId = successor.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ? successor.candidate.bootstrapImport.predecessorVersionId
    : assert.fail("successor lacks re-attestation evidence");

  const [read] = await readPromotedCivicDataBatch("FEC_FUNDING", ["federal-supported"], {
    store,
    now: CUTOVER,
    bypassCache: true,
  });
  assert.equal(read?.kind, "STORE_UNREACHABLE");
  if (read?.kind !== "STORE_UNREACHABLE") assert.fail("expected fail-closed proof result");
  assert.equal(read.code, "PROMOTION_PROOF_INVALID");
  assert.match(read.detail, /more than one immutable predecessor row/);
});
