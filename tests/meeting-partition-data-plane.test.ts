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

test("an empty calendar keeps its pointer without loading the held payload or writing a failed candidate", async t => {
  const store = new MemoryRoutineDataStore();
  const heldRead = t.mock.method(store, "readPromotion");
  const result = await promoteMeetingPartitions({ store, partitions: [legistar], meetings: [], agendaDocuments: [],
    reports: [{ ...report(legistar.meetingSource, FIRST), fetched: 0, normalized: 0 }], generatedAt: FIRST });
  assert.deepEqual(result, []);
  assert.equal(heldRead.mock.callCount(), 0, "retaining the pointer requires no download of its held meeting payload");
  heldRead.mock.restore();
  assert.equal(await store.readPromotion("MEETING", legistar.scope), null);
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
  const previous = await readMeetingPartitionProjection(legistar, { store,  now: SECOND });
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

test("the executable promotion door accepts each registered partition once, in the order given", () => {
  assert.deepEqual(
    selectedMeetingPartitions(["--promote", `--only-partition=${legistar.id}`]).map((row) => row.id),
    [legistar.id],
  );
  assert.deepEqual(
    selectedMeetingPartitions(["--promote", `--only-partition=${insite.id}`, `--only-partition=${legistar.id}`]).map((row) => row.id),
    [insite.id, legistar.id],
  );
  assert.throws(() => selectedMeetingPartitions(["--promote"]), /MEETING_PARTITION_REQUIRED/);
  assert.throws(() => selectedMeetingPartitions([`--only-partition=${legistar.id}`, `--only-partition=${legistar.id}`]), /MEETING_PARTITION_NAMED_TWICE/);
  assert.throws(() => selectedMeetingPartitions(["--only-partition=meetings:legistar:not-registered"]), /MEETING_PARTITION_NOT_REGISTERED/);
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

test("a meeting child loads its registry through the current store path", async () => {
  const seen: unknown[] = [];
  await preloadCanonicalMeetingDependencies({
    sourceName: "composite", state: "AZ",
    refreshRegistry: async (states, options) => { assert.deepEqual(states, ["AZ"]); seen.push(options); },
    refreshVenues: async () => undefined,
  });
  assert.deepEqual(seen, [{}]);
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

test('an unavailable meeting stamp writer never holds publication, and the next unchanged check repairs its stamp',async()=>{
 class StampFailureStore extends MemoryRoutineDataStore {
   fail=true;
   override async appendEvidence(...args:Parameters<MemoryRoutineDataStore['appendEvidence']>){
     if(this.fail&&args[3].startsWith(READER_PROJECTION_READBACK_PREFIX))throw Error('Stamp store unavailable');
     return super.appendEvidence(...args);
   }
 }
 const store=new StampFailureStore();
 const [first]=await promoteMeetingPartitions({store,partitions:[legistar],meetings:[meeting(legistar,FIRST,'stamp-retry')],agendaDocuments:[],reports:[report(legistar.meetingSource,FIRST)],generatedAt:FIRST});
 assert.equal(first.outcome.candidate.state,'PROMOTED');assert.ok(first.outcome.promoted);
 assert.equal(first.outcome.readerReadback,null);
 assert.equal((await store.events(first.candidate.id)).some(e=>e.detail.startsWith(READER_PROJECTION_READBACK_PREFIX)),false);
 store.fail=false;
 const [second]=await promoteMeetingPartitions({store,partitions:[legistar],meetings:[meeting(legistar,SECOND,'stamp-retry')],agendaDocuments:[],reports:[report(legistar.meetingSource,SECOND)],generatedAt:SECOND});
 assert.equal(second.outcome.promoted?.versionId,first.outcome.promoted?.versionId);
 assert.equal(second.outcome.readerReadback?.status,'PASS',second.outcome.readerReadback?.detail);
 assert.equal((await store.events(first.candidate.id)).some(e=>e.detail.startsWith(READER_PROJECTION_READBACK_PREFIX)),true);
});

test("a failed archive or upcoming scope never withholds the other scope's independently read meeting", async () => {
  for (const scope of ["ARCHIVE", "UPCOMING"] as const) {
    const store = new MemoryRoutineDataStore();
    const prior = meeting(legistar, FIRST, `held-${scope}`);
    const [seed] = await promoteMeetingPartitions({ store, partitions: [legistar], meetings: [prior], agendaDocuments: [],
      reports: [report(legistar.meetingSource, FIRST)], generatedAt: FIRST });
    assert.ok(seed?.outcome.promoted);
    const fresh = meeting(legistar, SECOND, `new-${scope}`);
    const [read] = await promoteMeetingPartitions({ store, partitions: [legistar], meetings: [fresh], agendaDocuments: [],
      reports: [{ ...report(legistar.meetingSource, SECOND), partialScopes: [{ scope, ocdIds: [legistar.ocdId], cause: "HTTP404 archive moved" }] }], generatedAt: SECOND });
    assert.ok(read?.outcome.promoted, read?.outcome.candidate.failureDetail ?? "the healthy scope was held");
    const payload = read.outcome.promoted.payload as { meetings: Meeting[] };
    assert.deepEqual(new Set(payload.meetings.map(row => row.id)), new Set([prior.id, fresh.id]));
    assert.ok(read.candidate.excludedFacts?.some(fact => fact.code === "MEETING_SCOPE_UNREAD"));
    const pointer = await store.readPromotion("MEETING", legistar.scope);
    const empty = await promoteMeetingPartitions({ store, partitions: [legistar], meetings: [], agendaDocuments: [],
      reports: [report(legistar.meetingSource, SECOND)], generatedAt: SECOND });
    assert.deepEqual(empty, []);
    assert.equal((await store.readPromotion("MEETING", legistar.scope))?.versionId, pointer?.versionId);
  }
});
