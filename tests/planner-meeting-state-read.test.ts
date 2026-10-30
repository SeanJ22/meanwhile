import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { factDb } from "./helpers/fact-db.ts";
import { insertMeetingFacts } from "./helpers/meeting-fact-rows.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import { readPlannerMeetingBodies } from "../lib/civic-data/planner-meeting-state-read.ts";
import { buildPlacePackage } from "../lib/reader/place-builder.ts";
import { heldBodyGaps } from "../lib/ask/held-gaps.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";

const STATE = "ocd-division/country:us/state:az", CITY = `${STATE}/place:tucson`;
const BODY = `${CITY}#council`, AT = "2026-10-21T12:00:00.000Z";
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
  await db.pg.exec(readFileSync(new URL("../lib/db/migrations/DB-05_keyed_rows.sql", import.meta.url), "utf8"));
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
  return [...new Set(snapshot.agendaDocuments.map(document => JSON.stringify([
    document.meetingId, document.documentUrl, document.sourceOrg, document.extraction, document.extractionNote, document.text,
  ])))].sort();
}

test("planner meetings preserve canonical gap decisions and exact agenda text on the production schema", async t => {
  t.mock.method(Date, "now", () => Date.parse(AT));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("The planner fixture must not use the network"); });
  const { db, publish, meeting, snapshot } = await fixture();
  t.after(() => db.pg.close());
  const bodyIds = [BODY, ...Array.from({ length: 35 }, (_, n) => `${CITY}#fixture-${String(n).padStart(3, "0")}`)];
  for (const id of bodyIds) await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$1,'AZ')", [id]);
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES('elsewhere','body','Elsewhere','NH')");
  const readableText = "Readable α𐐀 text".padEnd(32).repeat(5000) + "\n1. Authorize the new public library hours";
  const portalText = "Portal α𐐀 preamble".padEnd(32).repeat(4000) + "\nPublic Portal • CivicClerk requires JavaScript";
  const meetings = [meeting("readable", "2026-10-20T14:00:00Z"), meeting("portal", "2026-10-22T14:00:00Z"),
    { ...meeting("cancelled", "2026-10-23T14:00:00Z"), status: "CANCELED" as const },
    meeting("far-future", "2030-01-01T14:00:00Z"), meeting("elsewhere-meeting", "2026-10-22T16:00:00Z", "elsewhere")];
  const doc = (m: Meeting, text: string, extraction = "html") => ({ id: `document:${m.id}`, meetingId: m.id, ocdId: CITY,
    documentUrl: m.agendaUrl, sourceUrl: m.agendaUrl, sourceOrg: "Fixture council", text, extraction, collectedAt: AT, retrievedAt: AT });
  await publish("MEETING", meetingPartitionScope("fixture", BODY), snapshot(meetings, [doc(meetings[0]!, readableText), doc(meetings[1]!, portalText)]), "current");
  await insertMeetingFacts(db.query, meetings.filter(m => m.bodyId === BODY));
  const canonical = await buildPlacePackage({ state: "AZ", divisionIds: [], allBodies: true, includeHistory: true, includeAgenda: true }, db.query);
  const query: ReadOnlyQuery = async statements =>
    Promise.all(statements.map(async s => (await db.pg.query<Record<string, unknown>>(s.text, [...s.params])).rows));
  const upper = Date.parse(AT) + meetingSettingsFromValues().shownAheadDays * 86_400_000;
  const actual = new Map<string, MeetingsSnapshot>();
  for await (const body of readPlannerMeetingBodies("AZ", query, AT)) {
    const loaded = await body.load();
    assert.ok(loaded);
    actual.set(body.bodyId, loaded.snapshot);
  }
  assert.deepEqual([...actual.keys()].sort(), canonical.bodies.map(body => body.id).sort(), "bodies are paged in groups; other states stay outside it");
  for (const [bodyId, held] of actual) {
    const full = canonical.bodySnapshots[bodyId]!;
    const retained = full.meetings.filter(m => !Number.isFinite(Date.parse(m.startsAt)) || Date.parse(m.startsAt) <= upper);
    const ids = new Set(retained.map(m => m.id));
    const expected = { ...full, meetings: retained, agendaDocuments: full.agendaDocuments.filter(d => ids.has(d.meetingId)) };
    assert.deepEqual(held.meetings, expected.meetings, `${bodyId}: canonical dates and cancellations`);
    assert.deepEqual(agendaMeanings(held), agendaMeanings(expected), `${bodyId}: every distinct held agenda and its complete text match`);
    assert.deepEqual(gapDecisions(held, bodyId), gapDecisions(expected, bodyId), `${bodyId}: the planner makes the same holding decisions`);
  }
  const held = actual.get(BODY)!;
  assert.equal(held.agendaDocuments.find(d => d.meetingId === "readable")?.text, readableText, "complete Unicode text survives");
  assert.equal(held.meetings.some(m => m.id === "far-future"), false, "meetings beyond the shown window ahead are left out");
  const gaps = gapDecisions(held, BODY).gaps;
  assert.ok(gaps.some(gap => gap.code === "AGENDA_NOT_HELD" && gap.sitting?.meetingId === "portal"), "a portal marker beyond the first text chunk remains a portal");
  assert.ok(!gaps.some(gap => gap.sitting?.meetingId === "cancelled"), "cancelled sittings create no acquisition gaps");
});
