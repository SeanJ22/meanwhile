import { preloadCanonicalMeetingDependencies } from "../lib/meetings/ingest-dependencies.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { afterEach, beforeEach } from "node:test";
import { installFactReader } from "../lib/facts/db.ts";

import { MEETING_PARTITION_CONTRACTS, LEGACY_MEETINGS_AGGREGATE_SCOPE } from "../lib/civic-data/meeting-partitions.ts";
import { readMeetingPartitionProjection } from "../lib/meetings/snapshot.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { getMeetingSource } from "../lib/meetings/registry.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";

import { agendaDocumentRecordKey } from "../lib/civic-data/changes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import { repairMeetingReaderProjectionReadbacks } from "../lib/civic-data/reader-verification.ts";
import { READER_PROJECTION_READBACK_PREFIX } from "../lib/civic-data/reader-readback.ts";
import { parseUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import { wiringForSelectedMeetingSource } from "../lib/sources/composite/wiring.ts";
import { promoteMeetingPartition, promoteMeetingPartitions, reconcileSuccessfulMeetingPartition, selectedMeetingPartitions } from "../scripts/ingest.ts";

import { readEveryBody } from "./helpers/meeting-body-national.ts";

const FIRST = "2026-09-08T12:00:00.000Z";
const SECOND = "2026-09-08T13:00:00.000Z";

const factReads: string[] = [];
beforeEach(() => {
  factReads.length = 0;
  installFactReader(async text => { factReads.push(text); return []; });
});
afterEach(() => {
  installFactReader(undefined);
  assert.deepEqual(factReads, [], "published meeting composition does not query facts");
});

const legistar = MEETING_PARTITION_CONTRACTS.find((partition) => partition.meetingSource === "legistar")!;
const insite = MEETING_PARTITION_CONTRACTS.find((partition) =>
  partition.meetingSource === "legistar-insite" && partition.bodyId.includes("place:mesa"),
)!;

function urlFor(source: string): string {
  return source === "legistar"
    ? "https://webapi.legistar.com/v1/pima/events"
    : source === "legistar-insite"
      ? "https://mesa.legistar.com/Calendar.aspx"
      : `https://calendar.google.com/calendar/ical/${source}/basic.ics`;
}

function evidence(source: string, version: string) {
  const bytes = `${source}:${version}`;
  return [{
    source,
    requestedUrl: urlFor(source),
    finalUrl: urlFor(source),
    httpStatus: 200,
    rawHash: createHash("sha256").update(bytes).digest("hex"),
    byteCount: Buffer.byteLength(bytes),
  }];
}

function meeting(partition: typeof legistar, version: string, suffix: string): Meeting {
  return {
    id: `${partition.meetingSource}:${suffix}`,
    ocdId: partition.ocdId,
    bodyId: partition.bodyId,
    bodyName: partition.wiring!.config.insiteBodyName ?? partition.wiring!.publishingOrg,
    title: `${partition.wiring!.jurisdiction} meeting ${suffix}`,
    startsAt: "2026-09-20T17:00:00.000Z",
    timeZone: partition.wiring!.timeZone,
    location: null,
    agendaUrl: null,
    jurisdiction: partition.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: {
      sourceUrl: urlFor(partition.meetingSource),
      sourceOrg: partition.wiring!.publishingOrg,
      collectedAt: version,
      verifiedAt: null,
    },
  };
}

function report(source: string, version: string, ok = true): ChildRunReport {
  return {
    source,
    ok,
    error: ok ? null : `${source} timed out`,
    ...(ok ? {} : { failure: "WALL" as const }),
    fetched: ok ? 1 : 0,
    normalized: ok ? 1 : 0,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    ...(ok ? { acquisitions: evidence(source, version) } : {}),
  };
}

function agendaDocument(row: Meeting, retrievedAt: string): AgendaDocument {
  return {
    id: `${row.id}@${"b".repeat(64)}`,
    meetingId: row.id,
    ocdId: row.ocdId,
    documentUrl: `${urlFor(row.id.split(":")[0]!)}?agenda=1`,
    contentHash: "b".repeat(64),
    retrievedAt,
    contentType: "text/html",
    text: "Official agenda",
    extraction: "html",
    extractionNote: null,
    sourceUrl: urlFor(row.id.split(":")[0]!),
    sourceOrg: row.provenance.sourceOrg,
    collectedAt: retrievedAt,
    verifiedAt: null,
  };
}

class CountingMeetingStore extends MemoryRoutineDataStore {
  readPromotionCalls = 0;
  readPromotionsCalls = 0;
  readPromotionIdentitiesCalls = 0;

  reset(): void {
    this.readPromotionCalls = 0;
    this.readPromotionsCalls = 0;
    this.readPromotionIdentitiesCalls = 0;
  }

  override async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string) {
    this.readPromotionCalls += 1;
    return super.readPromotion<T>(recordClass, scope);
  }

  override async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ) {
    this.readPromotionsCalls += 1;
    return super.readPromotions<T>(recordClass, scopes);
  }

  override async readPromotionIdentities(recordClass: RoutineRecordClass, scopes: readonly string[]) {
    this.readPromotionIdentitiesCalls += 1;
    return super.readPromotionIdentities(recordClass, scopes);
  }
}

test("an authenticated zero-row meeting response is CANNOT_TELL, never false healthy or promoted absence", async () => {
  const store = new MemoryRoutineDataStore();
  const source = report(legistar.meetingSource, FIRST);
  const [result] = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [],
    agendaDocuments: [],
    reports: [{ ...source, fetched: 0, normalized: 0 }],
    generatedAt: FIRST,
  });
  assert.equal(result?.outcome.promoted, null);
  assert.equal(result?.outcome.candidate.state, "CANNOT_TELL");
  assert.equal(result?.outcome.candidate.failureCode, "ZERO_IS_NOT_ABSENCE");
  assert.equal(result?.outcome.candidate.receipt?.checks.find(({ check }) => check === "SOURCE_AUTHENTICITY")?.verdict, "PASS");
  assert.equal(await store.readPromotion("MEETING", legistar.scope), null);
  assert.deepEqual((await store.events(result!.candidate.id)).map(({ state }) => state), ["FETCHED", "NORMALIZED", "CANNOT_TELL"]);
});

test("a successful thin response retains unexplained in-window rows with exact held evidence", async () => {
  const store = new MemoryRoutineDataStore();
  const prior = meeting(legistar, FIRST, "retained-on-thin-success");
  const [seeded] = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [prior],
    agendaDocuments: [],
    reports: [report(legistar.meetingSource, FIRST)],
    generatedAt: FIRST,
  });
  assert.equal(seeded?.outcome.candidate.state, "PROMOTED");

  const fresh = meeting(legistar, SECOND, "new-row");
  const [next] = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [fresh],
    agendaDocuments: [],
    reports: [report(legistar.meetingSource, SECOND)],
    generatedAt: SECOND,
  });
  assert.equal(next?.outcome.candidate.state, "PROMOTED");
  const snapshot = next?.outcome.promoted?.payload as { meetings: Meeting[]; counts: { fresh: number; carried: number }; };
  assert.deepEqual(snapshot.meetings.map(({ id }) => id).sort(), [fresh.id, prior.id].sort());
  assert.equal(snapshot.counts.fresh, 1);
  assert.equal(snapshot.counts.carried, 1);
  assert.equal(snapshot.meetings.find(({ id }) => id === prior.id)?.carried?.reason, "UNEXPLAINED_DISAPPEARANCE");
  assert.equal(next?.outcome.candidate.candidate.changeSet?.removed.length, 0);
  assert.deepEqual(next?.outcome.candidate.receipt?.excludedFacts.map(({ key, code }) => ({ key, code })), [{
    key: `meeting:${prior.id}`,
    code: "MEETING_UNEXPLAINED_DISAPPEARANCE_RETAINED",
  }]);
});

test("caller-invented narrow bounds cannot remove an in-window meeting", async () => {
  const store = new MemoryRoutineDataStore();
  const prior = meeting(legistar, FIRST, "must-remain-in-window");
  const [seeded] = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [prior],
    agendaDocuments: [],
    reports: [report(legistar.meetingSource, FIRST)],
    generatedAt: FIRST,
  });
  assert.equal(seeded?.outcome.candidate.state, "PROMOTED");

  const fresh = meeting(legistar, SECOND, "fresh-row");
  const snapshot = {
    formatVersion: 1 as const,
    generatedAt: SECOND,
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ ...report(legistar.meetingSource, SECOND), error: null, fetched: 1, normalized: 1 }],
    meetings: [fresh],
    agendaDocuments: [],
  };
  const refused = await promoteMeetingPartition(store, legistar, snapshot, [], [{
    key: `meeting:${prior.id}`,
    code: "OUTSIDE_REGISTERED_SERVING_WINDOW",
    windowContract: "MEETING_READER_SERVING_WINDOW_V1",
    lowerBound: "2026-09-21T00:00:00.000Z",
    upperBound: "2026-09-22T00:00:00.000Z",
    priorStartsAt: prior.startsAt,
  }]);
  assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED");
  assert.equal(refused.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH");
  assert.equal((await store.readPromotion("MEETING", legistar.scope))?.versionId, seeded?.candidate.id);
});

test("only exact out-of-window meeting evidence removes a row and its attached agenda document", async () => {
  const store = new MemoryRoutineDataStore();
  const seedAt = "2026-01-01T12:00:00.000Z";
  const old = { ...meeting(legistar, seedAt, "aged-out"), startsAt: "2025-12-20T17:00:00.000Z" };
  const document = agendaDocument(old, seedAt);
  const seeded = await promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [old],
    agendaDocuments: [document],
    reports: [report(legistar.meetingSource, seedAt)],
    generatedAt: seedAt,
  });
  assert.equal(seeded[0]?.outcome.candidate.state, "PROMOTED");

  const fresh = meeting(legistar, SECOND, "still-served");
  const previous = await readMeetingPartitionProjection(legistar, { store, bypassCache: true, now: SECOND });
  assert.equal(previous.kind, "PROMOTED");
  const priorPartition = previous.kind === "PROMOTED"
    ? previous.value
    : null;
  const reconciliation = reconcileSuccessfulMeetingPartition({
    sourceName: legistar.meetingSource,
    generatedAt: SECOND,
    freshMeetings: [fresh],
    freshAgendaDocuments: [],
    previous: priorPartition,
  });
  // The sitting's held agenda is one record, keyed by the sitting.
  assert.deepEqual(reconciliation.removalEvidence.map(({ key }) => key).sort(), [
    agendaDocumentRecordKey(document),
    `meeting:${old.id}`,
  ].sort());

  const snapshot = {
    formatVersion: 1 as const,
    generatedAt: SECOND,
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ ...report(legistar.meetingSource, SECOND), error: null, fetched: 1, normalized: 1 }],
    meetings: [fresh],
    agendaDocuments: [],
  };
  const mismatched = reconciliation.removalEvidence.map((row) =>
    row.key.startsWith("agenda-document:") ? { ...row, parentMeetingKey: "meeting:not-the-parent" } : row
  );
  const refused = await promoteMeetingPartition(store, legistar, snapshot, [], mismatched);
  assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED");
  assert.equal(refused.outcome.candidate.failureCode, "REMOVAL_EVIDENCE_MISMATCH");
  assert.equal((await store.readPromotion("MEETING", legistar.scope))?.versionId, seeded[0]?.candidate.id);

  const validAt = "2026-09-08T13:00:01.000Z";
  const validReconciliation = reconcileSuccessfulMeetingPartition({
    sourceName: legistar.meetingSource,
    generatedAt: validAt,
    freshMeetings: [fresh],
    freshAgendaDocuments: [],
    previous: priorPartition,
  });
  const promoted = await promoteMeetingPartition(store, legistar, {
    ...snapshot,
    generatedAt: validAt,
    sources: [{ ...report(legistar.meetingSource, validAt), error: null, fetched: 1, normalized: 1 }],
  }, [], validReconciliation.removalEvidence);
  assert.equal(promoted.outcome.candidate.state, "PROMOTED");
  assert.deepEqual(promoted.outcome.candidate.candidate.changeSet?.removed.map(({ key }) => key).sort(), [
    agendaDocumentRecordKey(document),
    `meeting:${old.id}`,
  ].sort());
});

test("one meeting source/body failure retains only its LKG while another partition promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await promoteMeetingPartitions({
    store,
    partitions: [legistar, insite],
    meetings: [meeting(legistar, FIRST, "pima-1"), meeting(insite, FIRST, "mesa-1")],
    agendaDocuments: [],
    reports: [report("legistar", FIRST), report("legistar-insite", FIRST)],
    generatedAt: FIRST,
  });
  assert.equal(first.every((result) => result.outcome.promoted !== null), true);
  const legistarLkg = first[0]!.candidate.id;

  const second = await promoteMeetingPartitions({
    store,
    partitions: [legistar, insite],
    meetings: [meeting(insite, SECOND, "mesa-2")],
    agendaDocuments: [],
    reports: [report("legistar", SECOND, false), report("legistar-insite", SECOND)],
    generatedAt: SECOND,
  });
  assert.equal(second[0]!.outcome.promoted, null);
  assert.equal(second[0]!.outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(second[0]!.outcome.candidate.lastKnownGoodVersion, legistarLkg);
  assert.equal(second[1]!.outcome.candidate.state, "PROMOTED");
  assert.equal((await store.readPromotion("MEETING", legistar.scope))?.versionId, legistarLkg);
  assert.equal((await store.readPromotion("MEETING", insite.scope))?.versionId, second[1]!.candidate.id);
  assert.equal(await store.readPromotion("MEETING", LEGACY_MEETINGS_AGGREGATE_SCOPE), null);

  const { read, plan } = await readEveryBody(store, SECOND);
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.equal(read.value.meetings.some((row) => row.id === "legistar:pima-1"), true);
    assert.equal(read.value.meetings.some((row) => row.id === "legistar-insite:mesa-2"), true);
  }
  assert.deepEqual(plan.stats.failed, [], "the failed check refused nothing already served");

  const failedClock = await store.clock(legistar.sourceId, legistar.recordClass, legistar.scope);
  const healthyClock = await store.clock(insite.sourceId, insite.recordClass, insite.scope);
  const failedTask = routineTaskFromContract(legistar);
  const healthyTask = routineTaskFromContract(insite);
  assert.equal(failedClock.lastAttemptedAt, SECOND);
  assert.equal(failedClock.lastSucceededAt, FIRST);
  assert.equal(healthyClock.lastAttemptedAt, SECOND);
  assert.equal(healthyClock.lastSucceededAt, SECOND);
  assert.equal(routineTaskDue(failedTask, failedClock, Date.parse(SECOND) + 30 * 60_000), false);
  assert.equal(routineTaskDue(failedTask, failedClock, Date.parse(SECOND) + 60 * 60_000), true);
  // The healthy sibling keeps its own sitting-window clock: twice daily when
  // its body has no sitting within seven days, hourly when it does.
  assert.equal(healthyClock.lastSucceededObservedAt, SECOND);
  assert.equal(routineTaskDue(healthyTask, healthyClock, Date.parse(SECOND) + 60 * 60_000, false), false);
  // Hourly is owed 60 minutes after the success and admitted 25 minutes before.
  assert.equal(routineTaskDue(healthyTask, healthyClock, Date.parse(SECOND) + 35 * 60_000 - 1, true), false);
  assert.equal(routineTaskDue(healthyTask, healthyClock, Date.parse(SECOND) + 35 * 60_000, true), true);
});

test("meeting Reader repair reads each partition once and correlates exact partition receipts", async () => {
  const store = new CountingMeetingStore();
  const promoted = await promoteMeetingPartitions({
    store,
    partitions: [legistar, insite],
    meetings: [meeting(legistar, FIRST, "aggregate-pima"), meeting(insite, FIRST, "aggregate-mesa")],
    agendaDocuments: [],
    reports: [report("legistar", FIRST), report("legistar-insite", FIRST)],
    generatedAt: FIRST,
  });
  assert.equal(promoted.every(({ outcome }) => outcome.promoted !== null), true);
  // A partition promotion reads no sibling partition; the repair below is the one read that records every receipt.
  assert.equal(store.readPromotionsCalls, 0, "a partition promotion never reads the sibling partitions' payloads");
  assert.equal(promoted.every(({ outcome }) => outcome.readerReadback === null), true);
  const before = await Promise.all(promoted.map(async ({ candidate }) => ({
    contractId: candidate.scope === legistar.scope ? legistar.id : insite.id,
    pointer: await store.readPromotion("MEETING", candidate.scope),
    candidate: await store.readCandidate(candidate.id),
    events: await store.events(candidate.id),
  })));
  store.reset();

  const repairs = await repairMeetingReaderProjectionReadbacks(
    store,
    [legistar, insite],
    SECOND,
    "f".repeat(40),
  );
  assert.equal(store.readPromotionIdentitiesCalls, 1, "one identity-only pointer batch names every partition version");
  assert.equal(store.readPromotionCalls, 2, "each partition's payload crosses once, as its own Reader reads it");
  assert.equal(store.readPromotionsCalls, 0, "no national batch of payloads is read");
  assert.deepEqual(repairs.map(({ contractId, ok }) => ({ contractId, ok })), [
    { contractId: legistar.id, ok: true },
    { contractId: insite.id, ok: true },
  ]);
  for (const repair of repairs) {
    assert.equal(repair.ok, true);
    if (!repair.ok) continue;
    assert.equal(repair.value.kind, "RECORDED");
    if (repair.value.kind !== "RECORDED") continue;
    const expected = promoted.find(({ candidate }) => candidate.scope ===
      (repair.contractId === legistar.id ? legistar.scope : insite.scope));
    assert.equal(repair.value.receipt.contractId, repair.contractId);
    assert.equal(repair.value.receipt.versionId, expected?.candidate.id);
    assert.equal(repair.value.receipt.status, "PASS");
  }

  for (const snapshot of before) {
    const contract = snapshot.contractId === legistar.id ? legistar : insite;
    const candidateId = snapshot.candidate!.candidate.id;
    assert.deepEqual(await store.readPromotion("MEETING", contract.scope), snapshot.pointer);
    assert.deepEqual(await store.readCandidate(candidateId), snapshot.candidate);
    const afterEvents = await store.events(candidateId);
    assert.deepEqual(afterEvents.slice(0, snapshot.events.length), snapshot.events);
    assert.equal(afterEvents.length, snapshot.events.length + 1);
    assert.equal(afterEvents.at(-1)?.state, "PROMOTED");
    assert.match(afterEvents.at(-1)?.detail ?? "", new RegExp(`^${READER_PROJECTION_READBACK_PREFIX}`));
  }

  // The ordinary pass: every receipt is already current, so no partition's
  // payload crosses the wire at all; the identity batch alone decides it.
  store.reset();
  const current = await repairMeetingReaderProjectionReadbacks(
    store,
    [legistar, insite],
    new Date(Date.parse(SECOND) + 1).toISOString(),
    "f".repeat(40),
  );
  assert.deepEqual(current.map((repair) => repair.ok ? repair.value.kind : repair.error), ["CURRENT", "CURRENT"]);
  assert.equal(store.readPromotionIdentitiesCalls, 1);
  assert.equal(store.readPromotionCalls + store.readPromotionsCalls, 0, "a current pass reads no partition payload");
});

test("R31: meeting receipts carry across a commit that changed no Reader code without reading the partitions", async () => {
  const store = new CountingMeetingStore();
  const promoted = await promoteMeetingPartitions({
    store,
    partitions: [legistar, insite],
    meetings: [meeting(legistar, FIRST, "attest-pima"), meeting(insite, FIRST, "attest-mesa")],
    agendaDocuments: [],
    reports: [report("legistar", FIRST), report("legistar-insite", FIRST)],
    generatedAt: FIRST,
  });
  assert.equal(promoted.every(({ outcome }) => outcome.promoted !== null), true);
  const first = await repairMeetingReaderProjectionReadbacks(store, [legistar, insite], SECOND, "f".repeat(40));
  assert.deepEqual(first.map((repair) => repair.ok ? repair.value.kind : repair.error), ["RECORDED", "RECORDED"]);

  const later = (ms: number) => new Date(Date.parse(SECOND) + ms).toISOString();

  // An unchanged closure: every partition's PASS carries to the new commit; nothing is read.
  store.reset();
  const attested = await repairMeetingReaderProjectionReadbacks(store, [legistar, insite], later(1), "e".repeat(40), {
    attestor: () => ({ identical: true, detail: "closure byte-identical" }),
  });
  for (const repair of attested) {
    assert.equal(repair.ok, true);
    if (!repair.ok || repair.value.kind !== "RECORDED") throw new Error(`not recorded: ${repair.contractId}`);
    assert.equal(repair.value.receipt.status, "PASS");
    assert.equal(repair.value.receipt.verifierCodeSha, "e".repeat(40));
    assert.match(repair.value.receipt.detail, /^ATTESTED, not re-read/);
  }
  assert.equal(store.readPromotionCalls + store.readPromotionsCalls, 0, "no partition payload crosses the wire");

  // A changed closure: each partition is read again.
  store.reset();
  const reread = await repairMeetingReaderProjectionReadbacks(store, [legistar, insite], later(2), "d".repeat(40), {
    attestor: () => ({ identical: false, detail: "closure changed" }),
  });
  assert.deepEqual(reread.map((repair) => repair.ok && repair.value.kind === "RECORDED" ? repair.value.receipt.status : "not recorded"), ["PASS", "PASS"]);
  assert.equal(store.readPromotionCalls, 2, "a changed closure reads each partition once");
  for (const repair of reread) {
    if (repair.ok && repair.value.kind === "RECORDED") assert.doesNotMatch(repair.value.receipt.detail, /ATTESTED/);
  }
});

test("a semantic refusal holds only the exact source/body partition", async () => {
  const store = new MemoryRoutineDataStore();
  const goodMeeting = meeting(legistar, FIRST, "good");
  const source = report("legistar", FIRST);
  const snapshot = {
    formatVersion: 1 as const,
    generatedAt: FIRST,
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ ...source, error: null, fetched: 1, normalized: 1 }],
    meetings: [goodMeeting],
    agendaDocuments: [],
  };
  const good = await promoteMeetingPartition(store, legistar, snapshot);
  assert.equal(good.outcome.candidate.state, "PROMOTED");
  const bad = await promoteMeetingPartition(
    store,
    legistar,
    { ...snapshot, generatedAt: SECOND },
    ["source/body semantic probe failed"],
  );
  assert.equal(bad.outcome.promoted, null);
  assert.equal(bad.outcome.candidate.state, "SEMANTIC_INVALID");
  assert.equal((await store.readPromotion("MEETING", legistar.scope))?.versionId, good.candidate.id);
  assert.equal(await store.readPromotion("MEETING", insite.scope), null);
});

test("production membership and scopes are one-to-one and the global disposition is absent", () => {
  assert.equal(MEETING_PARTITION_CONTRACTS.length > 100, true);
  assert.equal(new Set(MEETING_PARTITION_CONTRACTS.map((partition) => partition.id)).size, MEETING_PARTITION_CONTRACTS.length);
  assert.equal(new Set(MEETING_PARTITION_CONTRACTS.map((partition) => partition.scope)).size, MEETING_PARTITION_CONTRACTS.length);
  assert.equal(MEETING_PARTITION_CONTRACTS.some((partition) => partition.scope === LEGACY_MEETINGS_AGGREGATE_SCOPE), false);
});

test("one partition invocation narrows a shared adapter to exactly one body", () => {
  const sourceName = "ical";
  const siblings = MEETING_PARTITION_CONTRACTS.filter((partition) => partition.meetingSource === sourceName);
  assert.equal(siblings.length > 1, true, "the control source must exercise shared-adapter membership");
  const selected = siblings[0]!;
  assert.deepEqual(
    wiringForSelectedMeetingSource(sourceName, [{ sourceName, bodyId: selected.bodyId }])
      .map((row) => row.bodyId),
    [selected.bodyId],
  );
  assert.throws(
    () => wiringForSelectedMeetingSource(sourceName, [{ sourceName, bodyId: "not-wired" }]),
    /MEETING_PARTITION_SELECTION_NOT_WIRED/,
  );
});

test("the executable promotion door accepts exactly one registered partition", () => {
  assert.deepEqual(
    selectedMeetingPartitions(["--promote", `--only-partition=${legistar.id}`]).map((row) => row.id),
    [legistar.id],
  );
  assert.throws(() => selectedMeetingPartitions(["--promote"]), /MEETING_PARTITION_EXACTLY_ONE_REQUIRED/);
  assert.throws(
    () => selectedMeetingPartitions([`--partitions=${legistar.id},${insite.id}`]),
    /MEETING_PARTITION_BATCH_ARGUMENT_RETIRED/,
  );
});

test("a canonical preload outage emits no fabricated source attempt", async () => {
  const observed: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => observed.push(values.map(String).join(" "));
  try {
    await assert.rejects(
      preloadCanonicalMeetingDependencies({
        sourceName: "composite", state: "AZ",
        refreshRegistry: async () => { throw new Error("registry store unavailable"); },
        refreshVenues: async () => undefined,
      }),
      /registry store unavailable/,
    );
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(observed.filter((line) => line.includes("RCD_MEETING_PARTITION_RECEIPT=")), []);
});

test("production Reader configuration cannot reopen live composite acquisition", () => {
  const env = process.env as Record<string, string | undefined>;
  const priorNodeEnv = env.NODE_ENV;
  const priorMeetingSource = env.WTP_MEETING_SOURCE;
  env.NODE_ENV = "production";
  env.WTP_MEETING_SOURCE = "composite";
  try {
    assert.throws(getMeetingSource, /PRODUCTION_MEETING_SOURCE_MUST_BE_CANONICAL:composite/);
  } finally {
    if (priorNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = priorNodeEnv;
    if (priorMeetingSource === undefined) delete env.WTP_MEETING_SOURCE;
    else env.WTP_MEETING_SOURCE = priorMeetingSource;
  }
});

test("a meeting child takes the supervisor's registry attestation, and a malformed one leaves its own full proof", async () => {
  const attestation = {
    recordClass: "REGISTRY_RUNTIME_BINDING",
    scope: "US-AZ:reader-registry-runtime",
    versionId: "registry-reviewed-bindings:trusted-lkg:bb4500a518c9712b66e104569e74b71b",
    payloadSha256: "d".repeat(64),
    retrievedAt: "2026-09-14T04:24:35.148Z",
    staleAtRetrieval: false,
    version: "2026",
    sourceThrough: null,
  };
  const seen: unknown[] = [];
  const run = (value: string | undefined) => preloadCanonicalMeetingDependencies({
    sourceName: "composite", state: "AZ",
    refreshRegistry: async (states, options) => { assert.deepEqual(states, ["AZ"]); seen.push(options); },
    refreshVenues: async () => undefined,
    env: { WTP_ROUTINE_ATTESTED_PROMOTIONS: value },
  });
  await run(JSON.stringify([attestation]));
  await run(JSON.stringify([{ ...attestation, payloadSha256: "not-a-hash" }]));
  await run(undefined);
  assert.deepEqual(seen, [{ attested: attestation }, {}, {}]);
});

test("a meeting re-check that finds no new fact is confirmed on the pointed version; a real change still promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const run = (rows: readonly Meeting[], at: string) => promoteMeetingPartitions({
    store,
    partitions: [legistar],
    meetings: [...rows],
    agendaDocuments: [],
    reports: [report(legistar.meetingSource, at)],
    generatedAt: at,
  });
  const [first] = await run([meeting(legistar, FIRST, "unchanged")], FIRST);
  assert.equal(first?.outcome.candidate.state, "PROMOTED");
  const pointer = await store.readPromotion("MEETING", legistar.scope);
  assert.ok(pointer);

  // The same sitting read again: only its observation stamps moved.
  const [second] = await run([meeting(legistar, SECOND, "unchanged")], SECOND);
  assert.equal(second?.outcome.confirmed?.versionId, pointer.versionId);
  assert.equal(second?.outcome.confirmed?.at, SECOND);
  assert.equal(second?.outcome.confirmed?.recheck.changeSet?.outcome, "UNCHANGED");
  assert.equal(second?.outcome.candidate.candidate.id, pointer.versionId, "the receipt names the pointed version");
  const { latestConfirmation, ...kept } = (await store.readPromotion("MEETING", legistar.scope))!;
  assert.deepEqual(kept, pointer, "readers keep their version");
  assert.equal(latestConfirmation?.observedAt, SECOND, "and the pointer read carries the confirmation");
  assert.equal(await store.readCandidate(second!.candidate.id), null, "no new candidate row");
  const events = await store.events(pointer.versionId);
  const receipts = events.map((event) => parseUnchangedConfirmation(event.detail)).filter((row) => row !== null);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.basis, "CHANGE_SET_UNCHANGED");
  assert.equal(receipts[0]!.readModelHash, first!.outcome.candidate.candidate.normalization.normalizedHash);
  const clock = await store.clock(legistar.sourceId, "MEETING", legistar.scope);
  assert.equal(clock.lastAttemptedAt, SECOND);
  assert.equal(clock.lastSucceededObservedAt, SECOND, "the confirmation is the source's latest success");

  // A changed fact is a new version, exactly as before.
  const later = "2026-09-08T14:00:00.000Z";
  const [third] = await run([{ ...meeting(legistar, later, "unchanged"), title: "Special session" }], later);
  assert.equal(third?.outcome.confirmed, undefined);
  assert.equal(third?.outcome.candidate.state, "PROMOTED");
  assert.notEqual((await store.readPromotion("MEETING", legistar.scope))?.versionId, pointer.versionId);
});

/* ── Meeting history stops being deleted ─────────────────────────── */

const HELD_READ = "2026-09-08T13:00:01.000Z";
const HELD_LATER = "2026-09-08T14:00:01.000Z";
const daysBefore = (days: number) => new Date(Date.parse(HELD_READ) - days * 86_400_000).toISOString();

function priorSnapshot(rows: readonly Meeting[], documents: readonly AgendaDocument[] = []) {
  return {
    formatVersion: 1 as const,
    generatedAt: "2026-09-01T13:00:00.000Z",
    counts: { fresh: rows.length, carried: 0, total: rows.length },
    sources: [],
    meetings: [...rows],
    agendaDocuments: [...documents],
  };
}

function reconcileAt(prior: readonly Meeting[], documents: readonly AgendaDocument[] = [], sourceName = legistar.meetingSource) {
  return reconcileSuccessfulMeetingPartition({
    sourceName,
    generatedAt: HELD_READ,
    freshMeetings: [meeting(legistar, HELD_READ, "fresh")],
    freshAgendaDocuments: [],
    previous: priorSnapshot(prior, documents),
  });
}

test("DB-01: a concluded meeting with an agenda is kept past 120 days; one with no record is removed", () => {
  const withAgenda: Meeting = {
    ...meeting(legistar, HELD_READ, "with-agenda"),
    startsAt: daysBefore(200),
    status: "CONCLUDED",
    agendaUrl: "https://example.gov/agenda/1",
  };
  const withMinutesDocument: Meeting = { ...meeting(legistar, HELD_READ, "with-doc"), startsAt: daysBefore(150), status: "CONCLUDED" };
  const bare: Meeting = { ...meeting(legistar, HELD_READ, "bare"), startsAt: daysBefore(200), status: "CONCLUDED" };
  const reconciliation = reconcileAt([withAgenda, withMinutesDocument, bare], [agendaDocument(withMinutesDocument, HELD_READ)]);
  const kept = reconciliation.meetings.map(({ id }) => id);
  assert.ok(kept.includes(withAgenda.id), "a concluded meeting with an agenda link is kept");
  assert.ok(kept.includes(withMinutesDocument.id), "a concluded meeting with a stored agenda document is kept");
  assert.ok(!kept.includes(bare.id), "a concluded meeting carrying nothing still ages out");
  assert.deepEqual(reconciliation.removalEvidence.map(({ key }) => key), [`meeting:${bare.id}`]);
  const [evidence] = reconciliation.removalEvidence;
  assert.equal(evidence?.code === "OUTSIDE_REGISTERED_SERVING_WINDOW" ? evidence.windowContract : null, "MEETING_READER_SERVING_WINDOW_V2");
});

test("DB-01: rows outside the dates a read fetched are carried as outside the fetch, never as a disappearance", () => {
  const ninetyFive: Meeting = { ...meeting(legistar, HELD_READ, "ninety-five"), startsAt: daysBefore(95), status: "CONCLUDED" };
  const inside: Meeting = { ...meeting(legistar, HELD_READ, "inside"), startsAt: daysBefore(10), status: "CONCLUDED" };
  const withRecord: Meeting = { ...meeting(legistar, HELD_READ, "old-record"), startsAt: daysBefore(130), status: "CONCLUDED", agendaUrl: "https://example.gov/a" };
  const reasons = (reconciliation: ReturnType<typeof reconcileAt>) =>
    new Map(reconciliation.meetings.filter((row) => row.carried).map((row) => [row.id, row.carried?.reason]));
  // legistar fetches the held 120 days, so a row 95 days back that its answer leaves out was asked about.
  const held = reasons(reconcileAt([ninetyFive, inside, withRecord]));
  assert.equal(held.get(ninetyFive.id), "UNEXPLAINED_DISAPPEARANCE");
  assert.equal(held.get(inside.id), "UNEXPLAINED_DISAPPEARANCE");
  assert.equal(held.get(withRecord.id), "OUTSIDE_FETCH_WINDOW", "130 days back was never asked about");
  // An adapter that reads whatever its feed lists (onbase) never asked about 95 days back either.
  const feed = reconcileAt([ninetyFive, inside], [], "onbase");
  assert.equal(reasons(feed).get(ninetyFive.id), "OUTSIDE_FETCH_WINDOW");
  assert.equal(reasons(feed).get(inside.id), "UNEXPLAINED_DISAPPEARANCE");
  assert.deepEqual(feed.removalEvidence, []);
});

test("DB-01: the validator accepts a V1 removal for one pass and refuses removing a kept record", async () => {
  const store = new MemoryRoutineDataStore();
  const seedAt = "2026-01-01T12:00:00.000Z";
  const old = { ...meeting(legistar, seedAt, "aged-out"), startsAt: "2025-12-20T17:00:00.000Z" };
  const record = { ...meeting(legistar, seedAt, "has-minutes"), startsAt: "2025-12-21T17:00:00.000Z", status: "CONCLUDED" as const, agendaUrl: "https://example.gov/agenda/9" };
  const seeded = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: [old, record], agendaDocuments: [],
    reports: [report(legistar.meetingSource, seedAt)], generatedAt: seedAt,
  });
  assert.equal(seeded[0]?.outcome.candidate.state, "PROMOTED");
  const fresh = meeting(legistar, SECOND, "still-served");
  const snapshotOf = (rows: Meeting[], at = HELD_READ) => ({
    formatVersion: 1 as const,
    generatedAt: at,
    counts: { fresh: rows.length, carried: 0, total: rows.length },
    sources: [{ ...report(legistar.meetingSource, at), error: null, fetched: rows.length, normalized: rows.length }],
    meetings: rows,
    agendaDocuments: [],
  });
  const window = (contract: "MEETING_READER_SERVING_WINDOW_V1" | "MEETING_READER_SERVING_WINDOW_V2", days: number, at: string) => ({
    code: "OUTSIDE_REGISTERED_SERVING_WINDOW" as const,
    windowContract: contract,
    lowerBound: new Date(Date.parse(at) - days * 86_400_000).toISOString(),
    upperBound: new Date(Date.parse(at) + days * 86_400_000).toISOString(),
  });
  const refused = await promoteMeetingPartition(store, legistar, snapshotOf([fresh, old]), [], [
    { ...window("MEETING_READER_SERVING_WINDOW_V2", 120, HELD_READ), key: `meeting:${record.id}`, priorStartsAt: record.startsAt },
  ]);
  assert.equal(refused.outcome.candidate.state, "HORIZON_UNRESOLVED", "a concluded meeting carrying an agenda is never removed");
  const accepted = await promoteMeetingPartition(store, legistar, snapshotOf([fresh, record], HELD_LATER), [], [
    { ...window("MEETING_READER_SERVING_WINDOW_V1", 90, HELD_LATER), key: `meeting:${old.id}`, priorStartsAt: old.startsAt },
  ]);
  assert.equal(accepted.outcome.candidate.state, "PROMOTED", accepted.outcome.candidate.failureDetail ?? "");
});
