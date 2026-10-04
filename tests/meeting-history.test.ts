import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS, meetingHistoryContract, meetingHistoryScope } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  buildMeetingHistorySnapshot,
  mergeMeetingHistory,
  movableToHistory,
  moveConcludedMeetingsToHistory,
  readMeetingHistory,
} from "../lib/civic-data/meeting-history.ts";
import { processRegisteredMeetingHistoryCandidate } from "../lib/civic-data/promotion.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { readMeetingsProjection, validateSnapshot, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import { promoteMeetingPartition, promoteMeetingPartitions } from "../scripts/ingest.ts";

const SEED = "2026-01-01T12:00:00.000Z";
const NOW = "2026-09-08T13:00:01.000Z";
const NEXT = "2026-09-08T14:00:01.000Z";
const daysBefore = (days: number, from = NOW) => new Date(Date.parse(from) - days * 86_400_000).toISOString();

const legistar = MEETING_PARTITION_CONTRACTS.find((partition) => partition.meetingSource === "legistar")!;
const url = "https://webapi.legistar.com/v1/pima/events";

function meeting(suffix: string, startsAt: string, extra: Partial<Meeting> = {}): Meeting {
  return {
    id: `${legistar.meetingSource}:${suffix}`,
    ocdId: legistar.ocdId,
    bodyId: legistar.bodyId,
    bodyName: legistar.wiring!.config.insiteBodyName ?? legistar.wiring!.publishingOrg,
    title: `${legistar.wiring!.jurisdiction} meeting ${suffix}`,
    startsAt,
    timeZone: legistar.wiring!.timeZone,
    location: null,
    agendaUrl: null,
    jurisdiction: legistar.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: url, sourceOrg: legistar.wiring!.publishingOrg, collectedAt: SEED, verifiedAt: null },
    ...extra,
  };
}

function report(at: string): ChildRunReport {
  const bytes = `${legistar.meetingSource}:${at}`;
  return {
    source: legistar.meetingSource,
    ok: true,
    error: null,
    fetched: 1,
    normalized: 1,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    acquisitions: [{
      source: legistar.meetingSource, requestedUrl: url, finalUrl: url, httpStatus: 200,
      rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: Buffer.byteLength(bytes),
    }],
  };
}

function agendaDocument(row: Meeting): AgendaDocument {
  return {
    id: `${row.id}@${"b".repeat(64)}`, meetingId: row.id, ocdId: row.ocdId, documentUrl: `${url}?agenda=1`,
    contentHash: "b".repeat(64), retrievedAt: SEED, contentType: "text/html", text: "Official agenda", extraction: "html",
    extractionNote: null, sourceUrl: url, sourceOrg: row.provenance.sourceOrg, collectedAt: SEED, verifiedAt: null,
  };
}

const concludedWithAgenda = (suffix: string, startsAt: string) =>
  meeting(suffix, startsAt, { status: "CONCLUDED", agendaUrl: "https://example.gov/agenda/1" });

async function seed(rows: Meeting[], documents: AgendaDocument[] = []) {
  const store = new MemoryRoutineDataStore();
  const [seeded] = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: rows, agendaDocuments: documents,
    reports: [report(SEED)], generatedAt: SEED,
  });
  assert.equal(seeded?.outcome.candidate.state, "PROMOTED", seeded?.outcome.candidate.failureDetail ?? "");
  return store;
}

const oldRecord = concludedWithAgenda("old-with-agenda", "2025-12-21T17:00:00.000Z");
const oldBare = meeting("old-bare", "2025-12-22T17:00:00.000Z", { status: "CONCLUDED" });
const recent = concludedWithAgenda("recent", daysBefore(30));

function promotedRows(store: MemoryRoutineDataStore, scope: string) {
  return store.readPromotion<MeetingsSnapshot>("MEETING", scope).then((row) => row?.payload ?? null);
}

test("DB-06: only a concluded sitting that carries a record, older than the held window, is movable", () => {
  const doc = agendaDocument(meeting("doc-only", daysBefore(200), { status: "CONCLUDED" }));
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1, generatedAt: NOW, counts: { fresh: 0, carried: 0, total: 5 }, sources: [],
    meetings: [
      concludedWithAgenda("old", daysBefore(200)),
      concludedWithAgenda("recent", daysBefore(100)),
      meeting("old-bare", daysBefore(200), { status: "CONCLUDED" }),
      meeting("old-scheduled", daysBefore(200), { agendaUrl: "https://example.gov/a" }),
      meeting("doc-only", daysBefore(200), { status: "CONCLUDED" }),
    ],
    agendaDocuments: [doc],
  };
  const movable = movableToHistory(snapshot, NOW)!;
  assert.deepEqual(movable.meetings.map(({ id }) => id).sort(), ["legistar:doc-only", "legistar:old"]);
  assert.equal(movable.agendaDocuments.length, 1);
  assert.equal(movableToHistory({ ...snapshot, meetings: [snapshot.meetings[1]!, snapshot.meetings[2]!] }, NOW), null);
});

test("DB-06: a history snapshot is a valid carried snapshot, append-only, and merges into its partition once", () => {
  const row = concludedWithAgenda("old", "2025-12-21T17:00:00.000Z");
  const history = buildMeetingHistorySnapshot({ history: null, moved: [row], agendaDocuments: [agendaDocument(row)], generatedAt: NOW });
  validateSnapshot(history);
  assert.equal(history.meetings[0]?.carried?.reason, "OUTSIDE_FETCH_WINDOW");
  assert.equal(history.meetings[0]?.carried?.lastFreshAt, SEED);
  const second = concludedWithAgenda("older", "2025-11-01T17:00:00.000Z");
  const grown = buildMeetingHistorySnapshot({ history, moved: [second], agendaDocuments: [], generatedAt: NEXT });
  assert.deepEqual(grown.meetings.map(({ id }) => id), ["legistar:older", "legistar:old-with-agenda".replace("old-with-agenda", "old")]);
  const live: MeetingsSnapshot = {
    formatVersion: 1, generatedAt: NOW, counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ source: "legistar", ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }],
    meetings: [recent], agendaDocuments: [],
  };
  const merged = mergeMeetingHistory(live, grown);
  validateSnapshot(merged);
  assert.equal(merged.meetings.length, 3);
  // A sitting both hold is the live one.
  const both = mergeMeetingHistory({ ...live, meetings: [recent, row] , counts: { fresh: 2, carried: 0, total: 2 }, sources: live.sources }, grown);
  assert.equal(both.meetings.filter(({ id }) => id === row.id).length, 1);
  assert.equal(both.meetings.find(({ id }) => id === row.id)?.carried, undefined);
});

test("DB-06: an old concluded sitting with a record moves to history first, then leaves the partition", async () => {
  const store = await seed([oldRecord, oldBare, recent], [agendaDocument(oldRecord)]);
  const fresh = meeting("fresh", daysBefore(-5));
  const [result] = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: [fresh], agendaDocuments: [],
    reports: [report(NOW)], generatedAt: NOW,
  });
  assert.equal(result?.outcome.candidate.state, "PROMOTED", result?.outcome.candidate.failureDetail ?? "");
  const live = (await promotedRows(store, legistar.scope))!;
  const liveIds = live.meetings.map(({ id }) => id);
  assert.ok(!liveIds.includes(oldRecord.id), "the sitting left the partition");
  assert.ok(!liveIds.includes(oldBare.id), "a bare old sitting still ages out");
  assert.ok(live.agendaDocuments.every(({ meetingId }) => meetingId !== oldRecord.id));
  const removed = result!.candidate.removalEvidence!.find((row) => row.key === `meeting:${oldRecord.id}`);
  assert.equal(removed?.code, "MOVED_TO_HISTORY");

  const history = (await promotedRows(store, meetingHistoryScope(legistar.scope)))!;
  assert.deepEqual(history.meetings.map(({ id }) => id), [oldRecord.id]);
  assert.equal(history.agendaDocuments.length, 1, "its agenda moves with it");
  const readHistory = await readMeetingHistory(legistar, { store });
  assert.equal(readHistory.kind, "PROMOTED", JSON.stringify("detail" in readHistory ? readHistory.detail : readHistory));

  // The Reader's composition still answers for it: nothing is in neither place.
  const composed = await readMeetingsProjection({ store, now: NOW, bypassCache: true, allowUnconfiguredBootstrap: false });
  assert.equal(composed.kind, "PROMOTED", JSON.stringify("detail" in composed ? composed.detail : composed));
  const ids = composed.kind === "PROMOTED" ? composed.value.meetings.map(({ id }) => id) : [];
  assert.ok(ids.includes(oldRecord.id) && ids.includes(fresh.id));
});

test("DB-06: a refused history write moves nothing, and the partition keeps every record", async () => {
  const store = await seed([oldRecord]);
  const move = await moveConcludedMeetingsToHistory({
    store, partition: legistar, previous: (await promotedRows(store, legistar.scope))!, generatedAt: NOW,
    door: async (candidate, now) => processRegisteredMeetingHistoryCandidate(store, legistar.id, {
      ...candidate, dependentChecks: [...candidate.dependentChecks, { consumer: "test", passed: false, detail: "refused on purpose" }],
    }, now),
  });
  assert.equal(move.outcome, "REFUSED");
  assert.equal(move.moved.size, 0);
  assert.equal(await promotedRows(store, meetingHistoryScope(legistar.scope)), null);
  // The next partition pass carries the sitting exactly as DB-01 does.
  const [result] = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: [meeting("fresh", daysBefore(-5))], agendaDocuments: [],
    reports: [report(NOW)], generatedAt: NOW,
    previousByContract: new Map([[legistar.id, (await promotedRows(store, legistar.scope))!]]),
  });
  assert.equal(result?.outcome.candidate.state, "PROMOTED", result?.outcome.candidate.failureDetail ?? "");
});

test("DB-06: a partition cannot remove a sitting into a history that does not hold it", async () => {
  const store = await seed([oldRecord, recent]);
  const previous = (await promotedRows(store, legistar.scope))!;
  const snapshot: MeetingsSnapshot = {
    ...previous, generatedAt: NOW,
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ ...previous.sources[0]!, fetched: 1, normalized: 1, acquisitions: report(NOW).acquisitions }],
    meetings: [recent], agendaDocuments: [],
  };
  const evidence = {
    key: `meeting:${oldRecord.id}`, code: "MOVED_TO_HISTORY" as const,
    historyScope: meetingHistoryScope(legistar.scope), historyVersionId: "cv-none",
    lowerBound: new Date(Date.parse(NOW) - 120 * 86_400_000).toISOString(), priorStartsAt: oldRecord.startsAt,
  };
  const refused = await promoteMeetingPartition(store, legistar, snapshot, [], [evidence]);
  assert.notEqual(refused.outcome.candidate.state, "PROMOTED", "no history, no removal");
  assert.match(refused.outcome.candidate.failureDetail ?? JSON.stringify(refused.outcome.candidate.receipt ?? {}), /MOVED_TO_HISTORY|history|horizon|HORIZON/i);
});

test("DB-06: the way back keeps every record in its partition", async () => {
  const store = await seed([oldRecord]);
  const previous = process.env.WTP_MEETING_HISTORY_MOVE;
  process.env.WTP_MEETING_HISTORY_MOVE = "off";
  try {
    const [result] = await promoteMeetingPartitions({
      store, partitions: [legistar], meetings: [meeting("fresh", daysBefore(-5))], agendaDocuments: [],
      reports: [report(NOW)], generatedAt: NOW,
    });
    assert.equal(result?.outcome.candidate.state, "PROMOTED", result?.outcome.candidate.failureDetail ?? "");
    const live = (await promotedRows(store, legistar.scope))!;
    assert.ok(live.meetings.some(({ id }) => id === oldRecord.id));
    assert.equal(await promotedRows(store, meetingHistoryScope(legistar.scope)), null);
  } finally {
    if (previous === undefined) delete process.env.WTP_MEETING_HISTORY_MOVE;
    else process.env.WTP_MEETING_HISTORY_MOVE = previous;
  }
});

test("DB-06: history contracts are derived from their partition and never join the partition list", () => {
  const contract = meetingHistoryContract(legistar);
  assert.equal(contract.historyOf, legistar.id);
  assert.equal(contract.scope, `${legistar.scope}:history`);
  assert.ok(!MEETING_PARTITION_CONTRACTS.some((partition) => partition.scope === contract.scope || partition.id === contract.id));
});

/* ── DB-55: meeting history already deleted is restored ─────────────────── */

const EARLIER_NOW = "2026-09-08T12:00:00.000Z";

async function seedThenDeleteTheOldWay() {
  const keep = concludedWithAgenda("kept-in-window", daysBefore(30, EARLIER_NOW));
  const store = await seed([oldRecord, oldBare, keep], [agendaDocument(oldRecord)]);
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1, generatedAt: EARLIER_NOW,
    counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ source: "legistar", ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 }, acquisitions: report(EARLIER_NOW).acquisitions }],
    meetings: [keep], agendaDocuments: [],
  };
  // What every pass did before DB-01: remove every sitting outside the shown 90 days, records or not.
  const removal = (row: Meeting) => ({
    key: `meeting:${row.id}`, code: "OUTSIDE_REGISTERED_SERVING_WINDOW" as const,
    windowContract: "MEETING_READER_SERVING_WINDOW_V1" as const,
    lowerBound: new Date(Date.parse(EARLIER_NOW) - 90 * 86_400_000).toISOString(),
    upperBound: new Date(Date.parse(EARLIER_NOW) + 90 * 86_400_000).toISOString(),
    priorStartsAt: row.startsAt,
  });
  const agendaRemoval = {
    ...removal(oldRecord), key: `agenda-document:${oldRecord.id}`, parentMeetingKey: `meeting:${oldRecord.id}`,
  };
  const deleted = await promoteMeetingPartition(store, legistar, snapshot, [], [removal(oldRecord), removal(oldBare), agendaRemoval]);
  assert.equal(deleted.outcome.candidate.state, "PROMOTED", deleted.outcome.candidate.failureDetail ?? "");
  return store;
}

test("DB-55: a sitting the old rule removed is restored from an earlier promoted version, then moves to history", async () => {
  const store = await seedThenDeleteTheOldWay();
  const gone = (await promotedRows(store, legistar.scope))!;
  assert.ok(!gone.meetings.some(({ id }) => id === oldRecord.id), "it was deleted the old way");

  process.env.WTP_MEETING_HISTORY_RESTORE = "on";
  try {
    const [restoredPass] = await promoteMeetingPartitions({
      store, partitions: [legistar], meetings: [meeting("fresh", daysBefore(-5))], agendaDocuments: [],
      reports: [report(NOW)], generatedAt: NOW,
      // History moves on the pass after the restore, which is what the partition keeps until then.
    });
    assert.equal(restoredPass?.outcome.candidate.state, "PROMOTED", restoredPass?.outcome.candidate.failureDetail ?? "");
  } finally {
    delete process.env.WTP_MEETING_HISTORY_RESTORE;
  }
  const back = (await promotedRows(store, legistar.scope))!;
  const row = back.meetings.find(({ id }) => id === oldRecord.id);
  assert.ok(row, "the concluded sitting with an agenda is back in its partition");
  assert.equal(row?.carried?.reason, "OUTSIDE_FETCH_WINDOW");
  assert.equal(row?.carried?.lastFreshAt, SEED, "it keeps the instant it was really read");
  assert.equal(row?.agendaUrl, oldRecord.agendaUrl);
  assert.ok(back.agendaDocuments.every(({ meetingId }) => back.meetings.some(({ id }) => id === meetingId)));
  assert.ok(!back.meetings.some(({ id }) => id === oldBare.id), "a sitting that carried no record is not brought back");

  // The next ordinary pass moves it into history, history first.
  const [next] = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: [meeting("fresh", daysBefore(-5, NEXT))], agendaDocuments: [],
    reports: [report(NEXT)], generatedAt: NEXT,
  });
  assert.equal(next?.outcome.candidate.state, "PROMOTED", next?.outcome.candidate.failureDetail ?? "");
  const history = (await promotedRows(store, meetingHistoryScope(legistar.scope)))!;
  assert.ok(history.meetings.some(({ id }) => id === oldRecord.id));
  assert.ok(!(await promotedRows(store, legistar.scope))!.meetings.some(({ id }) => id === oldRecord.id));
});

test("DB-55: nothing is restored unless it is asked for, and a restore is idempotent", async () => {
  const store = await seedThenDeleteTheOldWay();
  const [plain] = await promoteMeetingPartitions({
    store, partitions: [legistar], meetings: [meeting("fresh", daysBefore(-5))], agendaDocuments: [],
    reports: [report(NOW)], generatedAt: NOW,
  });
  assert.equal(plain?.outcome.candidate.state, "PROMOTED");
  assert.ok(!(await promotedRows(store, legistar.scope))!.meetings.some(({ id }) => id === oldRecord.id), "off by default");
  process.env.WTP_MEETING_HISTORY_RESTORE = "on";
  try {
    for (const at of [NEXT, "2026-09-08T15:00:01.000Z"]) {
      await promoteMeetingPartitions({
        store, partitions: [legistar], meetings: [meeting("fresh", daysBefore(-5, at))], agendaDocuments: [],
        reports: [report(at)], generatedAt: at,
      });
    }
  } finally {
    delete process.env.WTP_MEETING_HISTORY_RESTORE;
  }
  const live = (await promotedRows(store, legistar.scope))!;
  const history = (await promotedRows(store, meetingHistoryScope(legistar.scope)))!;
  const holding = [...live.meetings, ...history.meetings].filter(({ id }) => id === oldRecord.id);
  assert.equal(holding.length, 1, "restored once, in one place");
});
