import assert from "node:assert/strict";
import test from "node:test";
import { validateMeetingHistoryTransfer, validateMeetingPartitionTransfer } from "../lib/db/r4-meeting-partitions.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { processRegisteredMeetingPartitionCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { buildMeetingHistorySnapshot } from "../lib/civic-data/meeting-history.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const CHECKED = "2026-09-08T12:00:00.000Z";
const CUTOVER = "2026-10-15T12:00:00.000Z";
const partition = MEETING_PARTITION_CONTRACTS.find(row => row.meetingSource === "legistar")!;
const url = "https://webapi.legistar.com/v1/pima/events";
const check = { requestedUrl: url, finalUrl: url, httpStatus: 200 as const, rawHash: "a".repeat(64), checkedAt: CHECKED };

function snapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1, generatedAt: CHECKED, counts: { fresh: 1, carried: 0, total: 1, duplicatesCollapsed: 0 },
    sources: [{ source: partition.meetingSource, ok: true, error: null, fetched: 1, normalized: 1,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{ source: partition.meetingSource, requestedUrl: url, finalUrl: url, httpStatus: 200,
        rawHash: check.rawHash, byteCount: 512 }] }],
    meetings: [{ id: "legistar:retained-body-meeting", ocdId: partition.ocdId!, bodyId: partition.bodyId,
      bodyName: partition.wiring!.publishingOrg, title: "Board meeting", startsAt: "2026-09-15T12:00:00.000Z",
      timeZone: partition.wiring!.timeZone, location: null, agendaUrl: null, jurisdiction: partition.wiring!.jurisdiction,
      status: "SCHEDULED", provenance: { sourceUrl: url, sourceOrg: partition.wiring!.publishingOrg,
        collectedAt: CHECKED, verifiedAt: null } }], agendaDocuments: [],
  };
}

test("family cutover preserves original facts and check time while immediately making the body due", async () => {
  const input = snapshot();
  const transferred = await validateMeetingPartitionTransfer(partition, input, check, CUTOVER);
  assert.equal(transferred.record.state, "PROMOTED");
  assert.deepEqual(transferred.pointer.payload, input);
  assert.equal(transferred.record.candidate.retrieval.retrievedAt, CHECKED);
  assert.equal(transferred.record.candidate.retrieval.sourceCheck?.checkedAt, CHECKED);
  const store = new MemoryRoutineDataStore();
  await processRegisteredMeetingPartitionCandidate(store, partition.id, transferred.record.candidate, CUTOVER);
  const read = await readPromotedCivicData<MeetingsSnapshot>("MEETING", partition.scope, { store, now: CUTOVER, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("transfer was unreadable");
  assert.equal(read.metadata.checkedAt, CHECKED);
  assert.equal(read.value.meetings[0]!.provenance.collectedAt, CHECKED);
  const clock = await store.clock(partition.sourceId, "MEETING", partition.scope);
  assert.equal(clock.lastSucceededObservedAt, CHECKED);
  assert.equal(clock.lastAttemptedAt, CHECKED);
  assert.equal(routineTaskDue(routineTaskFromContract(partition), clock, Date.parse(CUTOVER), false), true);
});

test("a failed or suspended family's carried rows retain their last successful source evidence", async () => {
  const input = snapshot();
  input.meetings = input.meetings.map(meeting => ({ ...meeting, carried: { source: partition.meetingSource,
    reason: "SOURCE_UNAVAILABLE" as const, lastFreshAt: CHECKED } }));
  input.counts = { ...input.counts, fresh: 0, carried: 1 };
  input.sources = [{ ...input.sources[0]!, fetched: 0, normalized: 0 },
    { source: partition.meetingSource, ok: false, error: "The calendar route remains unavailable.", fetched: 0, normalized: 0,
      carriedForward: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }];
  const transferred = await validateMeetingPartitionTransfer(partition, input, check, CUTOVER);
  assert.deepEqual(transferred.pointer.payload, input);
  assert.equal(transferred.record.candidate.retrieval.sourceCheck?.checkedAt, CHECKED);
});

test("family cutover cannot bypass normal source verification", async () => {
  const input = snapshot();
  const invalid = { ...input, sources: input.sources.map(row => ({ ...row, acquisitions: row.acquisitions?.map(value => ({
    ...value, requestedUrl: "https://foreign.example.invalid/meetings", finalUrl: "https://foreign.example.invalid/meetings",
  })) })) };
  await assert.rejects(validateMeetingPartitionTransfer(partition, invalid, check, CUTOVER), /FINAL_ROUTE_NOT_REGISTERED/);
});

test("history cutover remains readable from immutable evidence after the family pointer retires", async () => {
  const original = await validateMeetingPartitionTransfer(partition, snapshot(), check, CHECKED);
  const history = buildMeetingHistorySnapshot({ history: null, moved: snapshot().meetings, agendaDocuments: [], generatedAt: CHECKED });
  const transferred = await validateMeetingHistoryTransfer(partition, history, original.record, original.pointer.promotedAt, CUTOVER);
  const read = await readPromotedCivicData<MeetingsSnapshot>("MEETING", transferred.pointer.scope, { bypassCache: true, now: CUTOVER,
    store: { readCandidate: async id => id === transferred.record.candidate.id ? transferred.record : original.record,
      readPromotion: async (_recordClass, scope) => scope === transferred.pointer.scope ? transferred.pointer as never : null } });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("history transfer was unreadable");
  assert.equal(read.value.meetings[0]!.carried?.lastFreshAt, CHECKED);
  assert.equal(read.value.meetings[0]!.provenance.sourceUrl, url);
});

test("SQL cutover preserves baseline family and history evidence through constrained durable storage and retires idempotently", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFileSync } = await import("node:fs");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { transferMeetingFamilies } = await import("../lib/db/r4-meeting-partitions.ts");
  const database = new PGlite();
  const readSql = (name: string) => readFileSync(new URL(`../lib/db/migrations/${name}`, import.meta.url), "utf8");
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/r4-meeting-families.json", import.meta.url), "utf8"));
  try {
    await database.exec(readSql("0025_typical_fixer.sql"));
    const persist = async ({ record, pointer, events }: typeof fixture.rows[number]) => database.transaction(async transaction => {
      const candidate = record.candidate;
      await transaction.query(`INSERT INTO civic_data_candidates
        (id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,normalized_hash,retrieved_at,source_through,
         parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [candidate.id,candidate.sourceId,candidate.recordClass,
        candidate.scope,record.state,record.acquisitionSucceeded,candidate.retrieval.rawHash,candidate.normalization.normalizedHash,
        candidate.retrieval.retrievedAt,candidate.temporal.sourceThrough,candidate.normalization.parserVersion,
        JSON.stringify(candidate.identities),JSON.stringify(candidate),JSON.stringify(record.receipt),record.promotedVersion,record.lastKnownGoodVersion]);
      for (const event of events) await transaction.query(`INSERT INTO civic_data_candidate_events (candidate_id,sequence,state,at,detail)
        VALUES ($1,$2,$3,$4,$5)`, [candidate.id,event.sequence,event.state,event.at,event.detail]);
      await transaction.query(`INSERT INTO civic_data_promotions (key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (record_class,scope) DO UPDATE SET
        current_version_id=EXCLUDED.current_version_id,last_known_good_version_id=EXCLUDED.last_known_good_version_id,
        promoted_at=EXCLUDED.promoted_at,payload=EXCLUDED.payload,validation_receipt=EXCLUDED.validation_receipt`, [pointer.key,pointer.sourceId,pointer.recordClass,pointer.scope,pointer.versionId,
        pointer.lastKnownGoodVersionId,pointer.promotedAt,JSON.stringify(pointer.payload),JSON.stringify(pointer.receipt)]);
    });
    for (const row of fixture.rows) await persist(row);
    for (const name of ["0026_lame_sunset_bain.sql", "0027_pdc_candidate_history_shape.sql", "0028_wise_ikaris.sql", "0029_unchanged_confirmation_receipts.sql"])
      await database.exec(readSql(name));
    await database.exec("CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY, payload jsonb NOT NULL)");
    const queries: string[] = [];
    const sql = {
      query: (query: string, values: unknown[] = []) => ({ query, values, then: (resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) => {
        queries.push(query);
        return database.query(query, values).then(result => resolve(result.rows), reject);
      } }),
      transaction: (requests: { query: string; values: unknown[] }[]) => database.transaction(async transaction => {
        const results = [];
        for (const request of requests) { queries.push(request.query); results.push((await transaction.query(request.query, request.values)).rows); }
        return results;
      }),
    } as unknown as Parameters<typeof transferMeetingFamilies>[0];
    const repos = createMemoryRepositories();
    for (const door of fixture.doors) await repos.doors.put(door.doorId, door, CUTOVER);
    assert.equal(await transferMeetingFamilies(sql, repos.doors), 2);
    assert.equal(await transferMeetingFamilies(sql, repos.doors), 0);
    const migrated = await database.query<{ scope: string; candidate: { retrieval: { sourceCheck?: { checkedAt: string } }; readModel: MeetingsSnapshot } }>(
      "SELECT scope,candidate FROM civic_data_candidates WHERE scope NOT LIKE 'source:derived:family:%'");
    assert.equal(migrated.rows.length, 2);
    assert.ok(migrated.rows.every(row => row.candidate.readModel.meetings.length === 1));
    const current = migrated.rows.find(row => !row.scope.endsWith(":history"))!;
    assert.equal(current.candidate.retrieval.sourceCheck?.checkedAt, "2026-09-24T20:30:00.000Z");
    assert.ok(queries.every(query => !query.includes("cp_doors")), "doors live on the separately configured control plane");
    for (const row of fixture.laterRows) await persist(row);
    assert.equal(await transferMeetingFamilies(sql, repos.doors), 2, "contract catches the old writer's post-expand promotions");
    assert.equal(await transferMeetingFamilies(sql, repos.doors), 0, "the catch-up is idempotent");
    const advanced = await database.query<{ scope: string; payload: MeetingsSnapshot }>(
      "SELECT scope,payload FROM civic_data_promotions WHERE scope NOT LIKE 'source:derived:family:%'");
    assert.equal(advanced.rows.length, 2);
    assert.ok(advanced.rows.every(row => row.payload.meetings[0]!.title.includes("amended agenda")), "changed fields survive in both live and history projections");
    const live = advanced.rows.find(row => !row.scope.endsWith(":history"))!;
    const livePartition = MEETING_PARTITION_CONTRACTS.find(partition => partition.scope === live.scope)!;
    const newerAt = "2026-09-24T22:30:00.000Z";
    const newerSnapshot = { ...live.payload, generatedAt: newerAt, meetings: live.payload.meetings.map(meeting => ({
      ...meeting, title: "New writer's later check", provenance: { ...meeting.provenance, collectedAt: newerAt } })) };
    const acquisition = newerSnapshot.sources.flatMap(source => source.acquisitions ?? [])[0]!;
    const newer = await validateMeetingPartitionTransfer(livePartition, newerSnapshot,
      { requestedUrl: acquisition.requestedUrl, finalUrl: acquisition.finalUrl, httpStatus: 200, rawHash: acquisition.rawHash, checkedAt: newerAt }, new Date().toISOString());
    await persist(newer);
    assert.equal(await transferMeetingFamilies(sql, repos.doors), 0, "old writer evidence cannot replace a later body check");
    const kept = await database.query<{ payload: MeetingsSnapshot }>("SELECT payload FROM civic_data_promotions WHERE scope=$1", [live.scope]);
    assert.equal(kept.rows[0]!.payload.meetings[0]!.title, "New writer's later check");
    await database.exec(readSql("R4_retire_meeting_families.sql"));
    assert.equal((await database.query("SELECT scope FROM civic_data_promotions WHERE scope LIKE 'source:derived:family:%'")).rows.length, 0);
    assert.equal((await database.query("SELECT id FROM civic_data_candidates")).rows.length, 9, "immutable source citations remain");
    assert.equal(await transferMeetingFamilies(sql, repos.doors), 0);
    await assert.rejects(database.exec("DELETE FROM civic_data_promotions"), /DELETE is forbidden/);
  } finally {
    await database.close();
  }
});
