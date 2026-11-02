import assert from "node:assert/strict";
import test from "node:test";
import { readPlannerMeetingBodies } from "../lib/civic-data/planner-meeting-state-read.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { meetingPartitionScope, derivedMeetingFamilyScope } from "../lib/civic-data/meeting-partitions.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { installReaderOn, migratedFactDb } from "./helpers/migrated-reader-db.ts";
import { seedPlaceSlices } from "./helpers/place-pages.ts";

const STATE = "ocd-division/country:us/state:az", CITY = `${STATE}/place:tucson`;
const BODY = `${CITY}#council`, RUNTIME_BODY = `${CITY}#runtime-only`, AT = "2026-10-21T12:00:00.000Z";
const SOURCE = "https://example.gov/meetings";

test("the planner reads a state's boards, sixteen at a time, from their slices, with history and complete agenda text, inside the shown window", async () => {
  const db = await migratedFactDb();
  const undo = await installReaderOn(db.pg);
  try {
    const meeting = (id: string, startsAt: string, bodyId = BODY): Meeting => ({ id, bodyId, ocdId: CITY, bodyName: bodyId, title: `Public meeting ${id}`, startsAt, timeZone: "UTC", location: null,
      agendaUrl: `${SOURCE}/${id}`, jurisdiction: "Local", status: "SCHEDULED", provenance: { sourceUrl: SOURCE, sourceOrg: "Fixture council", collectedAt: AT, verifiedAt: AT } });
    const snapshot = (meetings: Meeting[], agendaDocuments: unknown[] = []) => ({ formatVersion: 1, generatedAt: AT, meetings, agendaDocuments, sources: [], counts: { fresh: meetings.length, carried: 0, total: meetings.length } });
    const ids = [BODY, ...Array.from({ length: 20 }, (_, n) => `${CITY}#fixture-${String(n).padStart(2, "0")}`)];
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ'),($2,'place','Tucson','AZ')", [STATE, CITY]);
    for (const id of ids) {
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body',$1,'AZ',$2)", [id, CITY]);
      await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)", [id, CITY]);
    }
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES('elsewhere','body','Elsewhere','NH'),($1,'body','Runtime-only council','AZ')", [RUNTIME_BODY]);
    const text = "Readable α𐐀 text".padEnd(32).repeat(5000) + "\n1. Authorize the new public library hours";
    const doc = (m: Meeting) => ({ id: `document:${m.id}`, meetingId: m.id, documentUrl: m.agendaUrl, sourceUrl: m.agendaUrl, sourceOrg: "Fixture council", text, extraction: "html", collectedAt: AT, retrievedAt: AT });
    const readable = meeting("readable", "2026-10-22T14:00:00Z"), far = meeting("far-future", "2030-01-01T14:00:00Z"), past = meeting("held-past", "2020-01-01T14:00:00Z");
    await db.publish({ id: "current", recordClass: "MEETING", scope: meetingPartitionScope("fixture", BODY), sourceId: "fixture", at: AT, value: snapshot([readable, far], [doc(readable)]) });
    await db.publish({ id: "history", recordClass: "MEETING", scope: `${meetingPartitionScope("fixture", BODY)}:history`, sourceId: "fixture", at: AT, value: snapshot([past], [doc(past)]) });
    await db.publish({ id: "family", recordClass: "MEETING", scope: derivedMeetingFamilyScope("US-AZ"), sourceId: "derived", at: AT, value: snapshot([meeting("runtime", "2026-10-23T16:00:00Z", RUNTIME_BODY)]) });
    await db.publish({ id: "runtime-registry", recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-AZ:reader-registry-runtime", sourceId: "runtime", at: AT, value: {
      formatVersion: 1, registry: { generatedAt: AT, bodies: [{ id: RUNTIME_BODY, ocdId: CITY, name: "Runtime-only council" }], divisions: [] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } });
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [CITY], bodyIds: [RUNTIME_BODY] });
    const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement => (await db.pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows));
    const held = new Map<string, MeetingsSnapshot>();
    for await (const body of readPlannerMeetingBodies("AZ", query, AT)) {
      const loaded = await body.load();
      assert.ok(loaded);
      held.set(body.bodyId, loaded.snapshot);
    }
    assert.deepEqual([...held.keys()].sort(), [...ids, RUNTIME_BODY].sort(), "runtime-only and empty boards survive paging; other states stay outside it");
    const council = held.get(BODY)!;
    assert.deepEqual(council.meetings.map(row => row.id).sort(), ["held-past", "readable"], "the held past is part of it; a sitting beyond the shown window is not");
    assert.equal(council.agendaDocuments.find(document => document.meetingId === "readable")?.text, text, "the complete text of the agenda");
    assert.equal(council.agendaDocuments.find(document => document.meetingId === "held-past")?.text, text, "and of a held past agenda");
    assert.equal(held.get(RUNTIME_BODY)!.meetings.length, 1);
    assert.ok(meetingSettingsFromValues().shownAheadDays > 0);
    await assert.rejects(async () => { for await (const _ of readPlannerMeetingBodies("A", query, AT)); }, /PLANNER_MEETING_STATE_INVALID/);
  } finally { await undo(); await db.pg.close(); }
});
