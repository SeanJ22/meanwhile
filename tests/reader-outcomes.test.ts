import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { meetingPartitionId } from "../lib/meetings/body-scope.ts";
import { meetingReaderRecords } from "../lib/meetings/reader-records.ts";
import { outcomePartitionScope, setDoorOutcomePointers } from "../lib/outcomes/door-outcome-pointers.ts";
import { getOutcomeSnapshot, loadedFrom, outcomeEvidenceFor, outcomePointers, outcomeProjectionReadState, readSelectedMeetingOutcomes, readStateMeetingOutcomes, refreshOutcomeSnapshotFromPromoted, resetOutcomeSnapshotCache, sittingsForBody } from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { meetingOutcomeEvidenceFor, outcomeSittingsOnDate } from "../lib/ask/meeting-outcomes.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json", import.meta.url), "utf8")) as OutcomeSnapshot;
const sitting = fixture.sittings.find(row => row.agenda.length && row.outcomes.length && row.rollCalls.length)!;
const BODY = sitting.bodyId!, SCOPE = "US-AZ:county:pima:legistar-outcomes";
const CALENDAR_ID = "legistar-insite:pima:calendar-alias";
const own: OutcomeSnapshot = { ...fixture, sittings: [sitting] };

function sourceRow(payload: OutcomeSnapshot = own, scope = SCOPE) {
  const entry = provenEdgeEntry({ recordClass: "MEETING_OUTCOME", scope, sourceId: "outcome-source", versionId: `outcomes:${scope}`, value: payload });
  const projection = entry.projection;
  return { key: projection.key, record_class: projection.recordClass, scope, source_id: projection.sourceId,
    current_version_id: projection.versionId, last_known_good_version_id: projection.lastKnownGoodVersionId,
    promoted_at: projection.promotedAt, retrieved_at: entry.attested.retrievedAt, validation_receipt: projection.receipt,
    temporal: { staleAtRetrieval: false, version: "2026", sourceThrough: entry.attested.sourceThrough },
    published: true, snapshot_shape_valid: true, payload };
}

async function outcomeDatabase(t: TestContext) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,source_id text,current_version_id text,
      last_known_good_version_id text,promoted_at timestamptz,validation_receipt jsonb,payload jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,retrieved_at timestamptz,state text,acquisition_succeeded boolean,
      promoted_version_id text,last_known_good_version_id text,record_class text,scope text,source_id text,candidate jsonb);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    CREATE TABLE entity(id text PRIMARY KEY,state text)`);
  for (const statement of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8").split("--> statement-breakpoint")) {
    if (/^\s*CREATE FUNCTION reader_/.test(statement)) await pg.exec(statement);
  }
  const put = async (payload: OutcomeSnapshot, scope: string) => {
    const row = sourceRow(payload, scope), encoded = partitionCivicPayload(payload);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await pg.query(`INSERT INTO civic_data_promotions VALUES($1,'MEETING_OUTCOME',$2,$3,$4,$4,$5,$6,$7)`,
      [row.key, scope, row.source_id, row.current_version_id, row.promoted_at, JSON.stringify(row.validation_receipt), JSON.stringify(encoded.value)]);
    await pg.query(`INSERT INTO civic_data_candidates VALUES($1,$2,'PROMOTED',true,$1,$1,'MEETING_OUTCOME',$3,$4,$5)`,
      [row.current_version_id, row.retrieved_at, scope, row.source_id, JSON.stringify({ temporal: row.temporal })]);
  };
  return { pg, put };
}

test("a cold selected outcome read preserves agenda, actions and votes through verified calendar aliases without global priming", async () => {
  resetOutcomeSnapshotCache();
  let reads = 0;
  const snapshot = await readSelectedMeetingOutcomes(["AZ"], BODY, [CALENDAR_ID, sitting.meetingId], async statements => {
    reads++;
    assert.equal(statements.length, 1);
    assert.deepEqual(statements[0].params[0], ["US-AZ:%"]);
    assert.deepEqual(statements[0].params[1], [CALENDAR_ID, sitting.meetingId, BODY]);
    assert.deepEqual(statements[0].params[2], [CALENDAR_ID, sitting.meetingId]);
    assert.deepEqual(statements[0].params[3], ["legistar", "legistar-insite"].map(kind =>
      `MEETING_OUTCOME:${outcomePartitionScope(meetingPartitionId(kind, BODY))}`));
    return [[sourceRow()]];
  });
  assert.equal(reads, 1);
  const records = meetingReaderRecords(CALENDAR_ID, BODY, [sitting.meetingId], snapshot);
  assert.equal(records.status, "HELD");
  assert.deepEqual(records.agenda, sitting.agenda);
  assert.deepEqual(records.actions, sitting.outcomes);
  assert.deepEqual(records.rollCalls, sitting.rollCalls);
  assert.equal(records.counts.votes, sitting.rollCalls.reduce((count, row) => count + row.votes.length, 0));
  assert.deepEqual(outcomeEvidenceFor({ meetingId: sitting.meetingId, bodyId: BODY, questionClass: "WHAT_WAS_NOTICED" }, snapshot).records, sitting.agenda);
});

test("confirmed absence is an empty result; unavailable, malformed and invalid publication proofs stay failures", async () => {
  const empty = await readSelectedMeetingOutcomes(["AZ"], BODY, [sitting.meetingId], async () => [[]]);
  assert.deepEqual(empty.sittings, []);
  assert.equal(meetingReaderRecords(sitting.meetingId, BODY, [], empty).status, "NOT_HELD");
  await assert.rejects(readSelectedMeetingOutcomes(["AZ"], BODY, [sitting.meetingId], null), /STORE_NOT_CONFIGURED/);
  await assert.rejects(readSelectedMeetingOutcomes(["AZ"], BODY, [sitting.meetingId], async () => { throw new Error("database unavailable"); }), /database unavailable/);
  for (const row of [
    { ...sourceRow(), published: false },
    { ...sourceRow(), last_known_good_version_id: "other-version" },
    { ...sourceRow(), validation_receipt: { ...sourceRow().validation_receipt, candidateId: "other-version" } },
    { ...sourceRow(), snapshot_shape_valid: false },
    { ...sourceRow(), payload: { ...own, sittings: [{ ...sitting, agenda: null }] } },
    { ...sourceRow(), scope: "US-CA:wrong-state" },
  ]) await assert.rejects(readSelectedMeetingOutcomes(["AZ"], BODY, [sitting.meetingId], async () => [[row]]), /READER_OUTCOME_/);
});

test("duplicate or conflicting sitting identities remain ambiguous even when another calendar alias has records", async () => {
  const alias = { ...sitting, meetingId: CALENDAR_ID };
  const snapshot = await readSelectedMeetingOutcomes(["AZ"], BODY, [CALENDAR_ID, sitting.meetingId], async () => [[
    sourceRow({ ...own, sittings: [sitting, alias] }),
    sourceRow({ ...own, sittings: [{ ...sitting, bodyId: `${BODY}-other` }] }, "US-AZ:place:second:outcomes"),
  ]]);
  assert.equal(snapshot.sittings.length, 3, "source readings are never collapsed before identity checks");
  assert.equal(meetingReaderRecords(sitting.meetingId, BODY, [], snapshot).status, "IDENTITY_UNRESOLVED");
  assert.equal(meetingReaderRecords(CALENDAR_ID, BODY, [sitting.meetingId], snapshot).status, "IDENTITY_UNRESOLVED");
});

test("one SQL statement selects exact sitting payload parts from state and derived body-door sources", async t => {
  const { pg, put } = await outcomeDatabase(t);
  const unrelated = { ...sitting, meetingId: "legistar:pima:unrelated", agenda: [{ ...sitting.agenda[0], title: "Other sitting. ".repeat(10_000) }] };
  await put({ ...own, sittings: [sitting, unrelated] }, SCOPE);
  await put({ ...own, sittings: [sitting] }, "US-CA:place:unrelated:outcomes");
  const doorSitting = { ...sitting, meetingId: CALENDAR_ID };
  await put({ ...own, sittings: [doorSitting] }, outcomePartitionScope(meetingPartitionId("legistar-insite", BODY)));
  await put({ ...own, sittings: [sitting] }, outcomePartitionScope(meetingPartitionId("legistar", `${BODY}-unrelated`)));
  let reads = 0;
  const query: ReadOnlyQuery = async statements => {
    reads++;
    assert.equal(statements.length, 1);
    return [(await pg.query<Record<string, unknown>>(statements[0].text, [...statements[0].params])).rows];
  };
  const snapshot = await readSelectedMeetingOutcomes(["AZ"], BODY, [CALENDAR_ID, sitting.meetingId], query);
  assert.equal(reads, 1);
  assert.deepEqual(snapshot.sittings.map(row => row.meetingId).sort(), [CALENDAR_ID, sitting.meetingId].sort());
  assert.deepEqual(snapshot.sittings.find(row => row.meetingId === sitting.meetingId), sitting);
  assert.ok(!JSON.stringify(snapshot).includes("Other sitting."));
  await pg.query("UPDATE civic_data_candidates SET state='VALIDATED' WHERE scope=$1", [SCOPE]);
  await assert.rejects(readSelectedMeetingOutcomes(["AZ"], BODY, [sitting.meetingId], query), /PUBLICATION_INVALID/);
});

test("a cold Ask reads published doors without a runner catalogue, keeps old years and isolates each request's state", async t => {
  const { pg, put } = await outcomeDatabase(t);
  const body = "b:demo", otherBody = "b:california", unregisteredBody = "independent:board";
  const current = { ...sitting, slug: "demo", bodyId: body, meetingId: "legistar:demo:1825" };
  const old = { ...current, meetingId: "legistar:demo:2018", startsAt: "2018-01-09T09:00:00-07:00" };
  const source = outcomePartitionScope(meetingPartitionId("legistar", body));
  await pg.query("INSERT INTO entity VALUES($1,'AZ'),($2,'CA')", [body, otherBody]);
  await put({ ...own, tenants: ["demo"], sittings: [current, old] }, source);
  await put({ ...own, sittings: [{ ...sitting, bodyId: otherBody, meetingId: "legistar:other-state:1" }] }, outcomePartitionScope(meetingPartitionId("legistar", otherBody)));
  await put({ ...own, sittings: [{ ...sitting, bodyId: unregisteredBody, meetingId: "legistar:independent:1" }] }, outcomePartitionScope(meetingPartitionId("legistar", unregisteredBody)));
  const ocdBody = "ocd-division/country:us/state:az/place:demo#governing";
  await put({ ...own, sittings: [{ ...sitting, bodyId: ocdBody, meetingId: "legistar:ocd-door:1" }] }, outcomePartitionScope(meetingPartitionId("legistar", ocdBody)));
  setDoorOutcomePointers([]); resetOutcomeSnapshotCache();
  assert.ok(!outcomePointers().some(pointer => pointer.scope === source), "the published door is absent from the process-local catalogue");
  let reads = 0;
  const query: ReadOnlyQuery = async statements => {
    reads++;
    assert.equal(statements.length, 1);
    return [(await pg.query<Record<string, unknown>>(statements[0].text, [...statements[0].params])).rows];
  };
  installReaderDatabaseQuery(query);
  t.after(() => { installReaderDatabaseQuery(undefined); resetOutcomeSnapshotCache(); });
  await withReaderSelection({ states: ["AZ"], keys: new Set([body]) }, async () => {
    await Promise.all([refreshOutcomeSnapshotFromPromoted(), refreshOutcomeSnapshotFromPromoted()]);
    assert.equal(reads, 1, "one canonical statement is shared within the reader request");
    const held = getOutcomeSnapshot();
    assert.deepEqual(sittingsForBody(body), [current, old]);
    assert.deepEqual(outcomeSittingsOnDate(body, "2018-01-09"), [old], "an older year remains available without a current calendar row");
    assert.ok(held.sittings.some(row => row.bodyId === ocdBody), "encoded state-door scopes work without a body entity");
    assert.ok(held.sittings.every(row => row.bodyId !== otherBody && row.bodyId !== unregisteredBody));
    const answer = meetingOutcomeEvidenceFor({ bodyId: body, meetingId: old.meetingId, startsAt: old.startsAt, question: "What did the board decide?" });
    assert.ok(answer.records.some(record => record.kind === "MEETING_ACTION"));
    assert.equal(loadedFrom(), "DATA_PLANE");
    assert.equal(outcomeProjectionReadState().kind, "PROMOTED");
    await withReaderSelection({ states: ["CA"], keys: new Set() }, async () => {
      await refreshOutcomeSnapshotFromPromoted();
      assert.deepEqual(getOutcomeSnapshot().sittings.map(row => row.bodyId), [otherBody]);
    });
    assert.equal(getOutcomeSnapshot(), held, "another state's request cannot replace this request's held history");
  });
  assert.deepEqual(getOutcomeSnapshot().sittings, [], "reader results never prime the process-global runner store");
  const exact = await readStateMeetingOutcomes(["AZ"], [unregisteredBody], query);
  assert.ok(exact.sittings.some(row => row.bodyId === unregisteredBody), "an exact body selector works without an OCD id or entity row");
  await pg.query("UPDATE civic_data_candidates SET state='VALIDATED' WHERE scope=$1", [source]);
  await withReaderSelection({ states: ["AZ"], keys: new Set() }, async () => {
    await assert.rejects(refreshOutcomeSnapshotFromPromoted(), /PUBLICATION_INVALID/);
    assert.equal(loadedFrom(), "EMPTY_STORE");
    assert.equal(outcomeProjectionReadState().kind, "STORE_UNREACHABLE");
    assert.deepEqual(getOutcomeSnapshot().sittings, []);
  });
  await withReaderSelection({ states: [], keys: new Set() }, async () => {
    await assert.rejects(refreshOutcomeSnapshotFromPromoted(), /STATE_REQUIRED/);
    assert.equal(loadedFrom(), "EMPTY_STORE", "an unselected request never falls back to the runner catalogue");
  });
});
