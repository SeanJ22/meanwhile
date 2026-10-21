import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { factDb } from "./helpers/fact-db.ts";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { derivedMeetingFamilyScope, meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import { readPlannerMeetingBodies } from "../lib/civic-data/planner-meeting-state-read.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { heldBodyGaps } from "../lib/ask/held-gaps.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";

const STATE = "ocd-division/country:us/state:az", CITY = `${STATE}/place:tucson`;
const BODY = `${CITY}#council`, RUNTIME_BODY = `${CITY}#runtime-only`, AT = "2026-10-21T12:00:00.000Z";
const SOURCE = "https://example.gov/meetings";

async function fixture() {
  const db = await factDb();
  for (const name of ["0025_typical_fixer.sql", "0031_civic_payload_parts.sql"]) {
    const sql = readFileSync(new URL(`../lib/db/migrations/${name}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) await db.pg.exec(statement);
  }
  const readerFunctions = readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8")
    .split("--> statement-breakpoint").filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
  for (const sql of readerFunctions) await db.pg.exec(sql);
  await db.pg.exec(BOOTSTRAP_DDL.find(ddl => ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("))!);
  const publish = async (recordClass: string, scope: string, payload: unknown, version: string, at = AT) => {
    const encoded = partitionCivicPayload(payload);
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    const source = `fixture:${scope}`;
    const receipt = { decision: "GOOD", candidateId: version, recordClass, scope, sourceId: source };
    await db.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,normalized_hash,
      retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      VALUES($1,$2,$3,$4,'PROMOTED',true,$5,$6::text::timestamptz,$6::text,'fixture','{}',$7,$8,$1,$1)`,
      [version, source, recordClass, scope, "a".repeat(64), at, JSON.stringify({ readModel: encoded.value }), JSON.stringify(receipt)]);
    await db.query(`INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8) ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,
      last_known_good_version_id=excluded.last_known_good_version_id,promoted_at=excluded.promoted_at,payload=excluded.payload,validation_receipt=excluded.validation_receipt`,
      [`${recordClass}:${scope}`, source, recordClass, scope, version, at, JSON.stringify(encoded.value), JSON.stringify(receipt)]);
  };
  const meeting = (id: string, startsAt: string, bodyId = BODY): Meeting => ({ id, bodyId, ocdId: CITY, bodyName: bodyId,
    title: `Public meeting ${id}`, startsAt, timeZone: "UTC", location: null, agendaUrl: `${SOURCE}/${id}`, jurisdiction: "Local", status: "SCHEDULED",
    provenance: { sourceUrl: SOURCE, sourceOrg: "Fixture council", collectedAt: AT, verifiedAt: AT } });
  const snapshot = (meetings: Meeting[], agendaDocuments: unknown[] = []) => ({ formatVersion: 1, generatedAt: AT, meetings, agendaDocuments,
    sources: [], counts: { fresh: meetings.length, carried: 0, total: meetings.length } });
  return { db, publish, meeting, snapshot };
}

function gapDecisions(snapshot: { meetings: Meeting[]; agendaDocuments: unknown[] }, bodyId: string) {
  const { agendaDocuments: _documents, ...decisions } = heldBodyGaps({ bodyId, meetings: snapshot.meetings,
    documents: snapshot.agendaDocuments as Parameters<typeof heldBodyGaps>[0]["documents"], sittings: [], now: Date.parse(AT) });
  return decisions;
}

function agendaMeanings(snapshot: MeetingsSnapshot) {
  // Re-fetch metadata and capture IDs do not change which agenda was held or
  // how its full text is classified by heldBodyGaps.
  return [...new Set(snapshot.agendaDocuments.map(document => JSON.stringify([
    document.meetingId, document.documentUrl, document.sourceOrg, document.extraction, document.extractionNote, document.text,
  ])))].sort();
}

test("planner meetings preserve canonical gap decisions and exact bounded agenda text on the production schema", async t => {
  t.mock.method(Date, "now", () => Date.parse(AT));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("The planner fixture must not use the network"); });
  const { db, publish, meeting, snapshot } = await fixture();
  t.after(() => db.pg.close());
  const bodyIds = [BODY, ...Array.from({ length: 65 }, (_, n) => `${CITY}#fixture-${String(n).padStart(3, "0")}`)];
  for (const id of bodyIds) await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$1,'AZ')", [id]);
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES('elsewhere','body','Elsewhere','NH')");
  await publish("REGISTRY_RUNTIME_BINDING", "US-AZ:reader-registry-runtime", {
    formatVersion: 1, registry: { generatedAt: AT, bodies: [{ id: RUNTIME_BODY, ocdId: CITY, name: "Runtime-only council" }], divisions: [] },
    bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {},
  }, "runtime");
  const readableText = "Readable α𐐀 text".padEnd(32).repeat(5000) + "\n1. Authorize the new public library hours";
  const portalText = "Portal α𐐀 preamble".padEnd(32).repeat(4000) + "\nPublic Portal • CivicClerk requires JavaScript";
  const oldText = Array.from({ length: 26000 }, (_, n) => `Archived agenda ${n} α𐐀`.padEnd(32)).join("");
  const meetings = [meeting("readable", "2026-10-20T14:00:00Z"), meeting("portal", "2026-10-22T14:00:00Z"),
    { ...meeting("cancelled", "2026-10-23T14:00:00Z"), status: "CANCELED" as const },
    meeting("rescheduled", "2020-01-01T14:00:00Z"), meeting("far-future", "2030-01-01T14:00:00Z")];
  const doc = (m: Meeting, text: string, extraction = "html") => ({ id: `document:${m.id}`, meetingId: m.id,
    documentUrl: m.agendaUrl, sourceUrl: m.agendaUrl, sourceOrg: "Fixture council", text, extraction, collectedAt: AT, retrievedAt: AT });
  const scope = meetingPartitionScope("fixture", BODY);
  const archived = { ...meeting("archived", "2020-03-01T14:00:00Z"), title: "Latest archived meeting title" };
  const movedArchive = meeting("archive-moved", "2019-05-01T14:00:00Z");
  const archivePages = Array.from({ length: 65 }, (_, n) => meeting(`fixture:archive-page-${n}`, new Date(Date.UTC(2018, 0, n + 1, 14)).toISOString()));
  await publish("MEETING", scope, snapshot([
    { ...archived, title: "Superseded archived meeting title", startsAt: "2017-03-01T14:00:00Z" }, movedArchive, ...archivePages,
  ], [doc(archived, "Superseded archived agenda", "pdf")]), "archive-v0", "2020-01-01T00:00:00Z");
  await publish("MEETING", scope, snapshot([archived], [doc(archived, "Intermediate archived agenda", "pdf")]), "archive-v1", "2021-01-01T00:00:00Z");
  const movedArchiveText = "1. Authorize the next public library funding hearing";
  // A later capture may hold the latest document without repeating the old
  // calendar row. Calendar and document winners are chosen independently.
  await publish("MEETING", scope, snapshot([], [doc(archived, oldText, "pdf"), doc(movedArchive, movedArchiveText, "pdf")]), "archive-v2", "2022-01-01T00:00:00Z");
  const readable = doc(meetings[0], readableText);
  await publish("MEETING", scope, snapshot(meetings, [readable,
    { ...readable, id: "readable-second-capture", retrievedAt: "2026-10-21T12:01:00Z" }, doc(meetings[1], portalText)]), "current-v2");
  const runtimeMeeting = meeting("runtime", "2026-10-22T16:00:00Z", RUNTIME_BODY);
  await publish("MEETING", derivedMeetingFamilyScope("US-AZ"), snapshot([runtimeMeeting, meeting("elsewhere", "2026-10-22T16:00:00Z", "elsewhere")]), "family");
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'fixture')", [SOURCE, AT, "b".repeat(64)]);
  for (const [id, startsAt] of [["rescheduled", "2026-10-24T14:00:00Z"], ["archive-moved", "2026-10-25T14:00:00Z"]]) {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'meeting','Rescheduled','AZ',$2)", [`meeting:${id}`, BODY]);
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'starts_at',$2,'new date','live','OFFICIAL',1,'Official rescheduling notice',$3,'fixture')`,
      [`meeting:${id}`, JSON.stringify({ startsAt, timeZone: "UTC" }), AT]);
  }
  const canonical = await readPlacePackage({ state: "AZ", divisionIds: [], allBodies: true, includeHistory: true, includeAgenda: true }, db.query);
  const responses: { bytes: number; text: string }[] = [];
  const query: ReadOnlyQuery = async statements => {
    const result = await Promise.all(statements.map(async s => (await db.pg.query<Record<string, unknown>>(s.text, [...s.params])).rows));
    responses.push({ bytes: Buffer.byteLength(JSON.stringify(result)), text: statements.map(s => s.text).join("\n") });
    return result;
  };
  const upper = Date.parse(AT) + meetingSettingsFromValues().shownAheadDays * 86_400_000;
  const actual = new Map<string, MeetingsSnapshot>();
  for await (const body of readPlannerMeetingBodies("AZ", query, AT)) {
    const loaded = await body.load();
    assert.ok(loaded);
    actual.set(body.bodyId, loaded.snapshot);
  }
  assert.deepEqual([...actual.keys()].sort(), canonical.bodies.map(body => body.id).sort(), "runtime-only and empty bodies survive body paging; other states stay outside it");
  for (const [bodyId, held] of actual) {
    const full = canonical.bodySnapshots[bodyId];
    const retained = full.meetings.filter(m => !Number.isFinite(Date.parse(m.startsAt)) || Date.parse(m.startsAt) <= upper);
    const ids = new Set(retained.map(m => m.id));
    const expected = { ...full, meetings: retained, agendaDocuments: full.agendaDocuments.filter(d => ids.has(d.meetingId)) };
    assert.deepEqual(held.meetings, expected.meetings, `${bodyId}: canonical dates, cancellations, aliases and historical meetings`);
    assert.deepEqual(agendaMeanings(held), agendaMeanings(expected), `${bodyId}: every distinct held agenda and its complete text match`);
    assert.deepEqual(gapDecisions(held, bodyId), gapDecisions(expected, bodyId), `${bodyId}: the planner makes the same holding decisions`);
  }
  const held = actual.get(BODY)!;
  assert.equal(held.agendaDocuments.find(d => d.meetingId === "readable")?.text, readableText, "complete Unicode text survives chunk boundaries");
  assert.equal(held.agendaDocuments.find(d => d.meetingId === "archived")?.text, oldText, "the newest archive document wins independently of the calendar version, with its full text");
  assert.equal(held.meetings.find(m => m.id === "archived")?.title, archived.title, "the newest eligible archive calendar wins for a repeated meeting ID");
  assert.equal(held.meetings.find(m => m.id === "archived")?.startsAt, archived.startsAt);
  assert.equal(held.agendaDocuments.find(d => d.meetingId === "archive-moved")?.text, movedArchiveText, "a later candidate's agenda attaches to a historical meeting held in an earlier candidate");
  assert.equal(held.meetings.find(m => m.id === "archive-moved")?.startsAt, "2026-10-25T14:00:00Z", "live facts can move a historical calendar row into the upcoming window");
  assert.equal(held.meetings.filter(m => m.id.startsWith("fixture:archive-page-")).length, archivePages.length, "all archive pages are retained");
  assert.equal(held.meetings.find(m => m.id === "rescheduled")?.startsAt, "2026-10-24T14:00:00Z");
  const gaps = gapDecisions(held, BODY).gaps;
  assert.ok(gaps.some(gap => gap.code === "AGENDA_NOT_HELD" && gap.sitting?.meetingId === "portal"), "a portal marker beyond the first text chunk remains a portal");
  assert.ok(!gaps.some(gap => gap.sitting?.meetingId === "cancelled"), "cancelled sittings create no acquisition gaps");
  assert.ok(responses.length > 6, "the state inventory, body pages and large text have separate bounded reads");
  assert.ok(Math.max(...responses.map(row => row.bytes)) < 250_000, `each SQL response remains bounded; largest ${Math.max(...responses.map(row => row.bytes))} bytes`);
});

test("planner meetings reject a pointer advance between archive inventory and the current calendar", { timeout: 30_000 }, async t => {
  t.mock.method(Date, "now", () => Date.parse(AT));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("The planner fixture must not use the network"); });
  const { db, publish, meeting, snapshot } = await fixture();
  t.after(() => db.pg.close());
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Council','AZ')", [BODY]);
  const scope = meetingPartitionScope("fixture", BODY), key = `MEETING:${scope}`;
  const historical = meeting("current-becomes-history", "2020-01-01T14:00:00Z");
  await publish("MEETING", scope, snapshot([historical]), "current-v2");
  const prior = (await db.query("SELECT * FROM civic_data_promotions WHERE key=$1", [key]))[0]!;
  await publish("MEETING", scope, snapshot([]), "current-v3");
  const next = (await db.query("SELECT * FROM civic_data_promotions WHERE key=$1", [key]))[0]!;
  const pointTo = async (row: Record<string, unknown>) => db.query(`UPDATE civic_data_promotions
    SET current_version_id=$1,last_known_good_version_id=$1,payload=$2,validation_receipt=$3 WHERE key=$4`,
    [row.current_version_id, JSON.stringify(row.payload), JSON.stringify(row.validation_receipt), key]);
  await pointTo(prior);
  let releaseCurrent!: () => void;
  const advanced = new Promise<void>(resolve => { releaseCurrent = resolve; });
  const query: ReadOnlyQuery = async statements => {
    const isCurrent = statements.some(statement => statement.text.startsWith("WITH RECURSIVE planner_input"));
    if (isCurrent) await advanced;
    const result = await Promise.all(statements.map(async statement =>
      (await db.pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows));
    if (!isCurrent && statements.some(statement => statement.text.includes("FROM archived_versions"))) {
      await pointTo(next);
      releaseCurrent();
    }
    return result;
  };
  await assert.rejects(async () => {
    for await (const body of readPlannerMeetingBodies("AZ", query, AT)) await body.load();
  }, /PLANNER_MEETING_CHANGED:AZ:/);
  const canonical = await readPlacePackage({ state: "AZ", divisionIds: [], allBodies: true, includeHistory: true, includeAgenda: true }, db.query);
  assert.ok(canonical.meetings.some(row => row.id === historical.id),
    "after the advance, the former current calendar belongs in history; silently combining the old archive inventory with the new current calendar would drop it");
});
