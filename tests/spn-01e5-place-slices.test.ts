import assert from "node:assert/strict";
import test from "node:test";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { forgetNationalShelf } from "../lib/reader/shelf.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { PLACE_SLICES_SQL } from "../lib/reader/place-slices.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readReaderEdgeMeetings } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import type { Query } from "../lib/facts/publish.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";
import { seedPlaceSlices } from "./helpers/place-pages.ts";

const PLACE = "ocd-division/country:us/state:az/place:example", NEIGHBOR = "ocd-division/country:us/state:az/place:neighbor";
const BODY = "az:city:example#governing", SECOND = "az:city:example#planning", FAR = "az:city:neighbor#governing", FOLDED = "az:city:example#old", UNFILED = "az:city:nowhere#governing";
const AT = "2026-10-24T08:00:00.000Z", encoded = encodeURIComponent, FAMILY = "source:derived:family:US-AZ";
const CALENDAR = (board: string) => `source:legistar:body:${encoded(board)}`;
const meeting = (id: string, bodyId: string, extra: Record<string, unknown> = {}) => ({ id, ocdId: PLACE, bodyId, bodyName: bodyId, title: id, startsAt: "2026-11-02T18:00:00-07:00", timeZone: "America/Phoenix",
  jurisdiction: "City", status: "SCHEDULED", location: null, agendaUrl: null, provenance: { sourceUrl: "https://example.gov/cal", sourceOrg: "example.gov", collectedAt: AT, verifiedAt: AT, kind: "OFFICIAL" }, ...extra });
const header = { formatVersion: 1, generatedAt: AT, counts: { fresh: 1, total: 1 }, sources: [{ source: "legistar", ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }] };

async function open() {
  const db = await migratedFactDb();
  installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => (await db.pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows)));
  const place = (id: string) => db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'AZ')", [id]);
  const board = async (id: string, at: string | null) => {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$1,'AZ')", [id]);
    if (at) await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA')", [id, at]);
  };
  await place(PLACE); await place(NEIGHBOR);
  await board(BODY, PLACE); await board(SECOND, PLACE); await board(FAR, NEIGHBOR); await board(UNFILED, null);
  await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2)", [BODY, FOLDED]);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/cal','https://example.gov/cal',$1,$2,'k')", [AT, "a".repeat(64)]);
  await db.publish({ id: "cv-1", recordClass: "MEETING", scope: CALENDAR(BODY), sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("m1", BODY)],
    agendaDocuments: [{ id: "d1", meetingId: "m1", ocdId: PLACE, documentUrl: "https://example.gov/a.pdf", text: "The agenda text." }] } });
  await db.publish({ id: "cv-h", recordClass: "MEETING", scope: `${CALENDAR(BODY)}:history`, sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("m-past", BODY, { startsAt: "2026-09-01T18:00:00-07:00" })], agendaDocuments: [] } });
  await db.publish({ id: "cv-2", recordClass: "MEETING", scope: CALENDAR(SECOND), sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("m2", SECOND)], agendaDocuments: [] } });
  await db.publish({ id: "cv-f", recordClass: "MEETING", scope: FAMILY, sourceId: "derived", at: AT, value: { ...header, meetings: [meeting("m3", FOLDED, { startsAt: "2026-11-04T18:00:00-07:00" }), meeting("m4", FAR, { ocdId: NEIGHBOR })], agendaDocuments: [], derivedMembers: [{ bodyId: BODY, source: "ical", outcome: "FRESH", status: "ok" }] } });
  return db;
}

/** Counts the statements a read sends to the fact store. */
const counted = (query: Query) => { const seen: string[] = []; return { seen, query: (async (text, params) => { seen.push(text); return query(text, params); }) as Query }; };

test("a place is read from its slices alone, in one statement, and nothing reads a saved page", async () => {
  const db = await open();
  try {
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [PLACE] });
    const reads = counted(db.query);
    const held = await readPlacePackage({ state: "AZ", divisionIds: [PLACE] }, reads.query);
    assert.deepEqual(held.bodies.map(body => body.id), [BODY, SECOND], "the boards filed on the place, a folded board under its surviving name");
    assert.deepEqual(held.meetings.map(row => [row.id, row.bodyId]).sort(), [["m1", BODY], ["m2", SECOND], ["m3", BODY]], "its boards' own calendars, and the family's rows for them under the name the board survives under");
    assert.equal(reads.seen.filter(text => /place_page/.test(text)).length, 0, "no saved page is read");
    assert.equal(reads.seen.length, 1, "one statement for the whole place");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM place_page"))[0]!.n, 0);
    assert.equal(held.meetings.some(row => row.id === "m-past"), false, "held history is not part of the calendar until it is asked for");
    assert.deepEqual(held.snapshot.agendaDocuments, [], "agenda papers wait for an opened meeting");
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await db.pg.close(); }
});

test("history and agenda papers come from their cards, and only when asked for", async () => {
  const db = await open();
  try {
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [PLACE] });
    const history = await readPlacePackage({ state: "AZ", divisionIds: [PLACE], includeHistory: true }, db.query);
    assert.ok(history.meetings.some(row => row.id === "m-past"));
    const agenda = await readPlacePackage({ state: "AZ", divisionIds: [PLACE], includeAgenda: true }, db.query);
    assert.deepEqual(agenda.snapshot.agendaDocuments.map(document => document.id), ["d1"]);
    const opened = await readPlacePackage({ state: "AZ", divisionIds: [PLACE], includeAgenda: true, meetingIds: ["m1"] }, db.query);
    assert.deepEqual([opened.snapshot.agendaDocuments.map(document => document.id), opened.bodies.every(body => body.roster === null)], [["d1"], true], "an opened meeting carries its papers and no rosters");
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await db.pg.close(); }
});

test("boards named by id are shown wherever they are filed, by their surviving name, and their neighbours are the boards of the places they serve", async () => {
  const db = await open();
  try {
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [], bodyIds: [FAR, FOLDED, UNFILED] });
    const named = await readPlacePackage({ state: "AZ", divisionIds: [], bodyIds: [FAR, FOLDED, UNFILED] }, db.query);
    assert.deepEqual(named.bodies.map(body => body.id).sort(), [BODY, FAR, UNFILED].sort(), "a folded board is its survivor; a board filed nowhere is still the board");
    assert.deepEqual(named.meetings.map(row => row.id).sort(), ["m1", "m3", "m4"].sort());
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [], bodyIds: [BODY], neighbors: true });
    const near = await readPlacePackage({ state: "AZ", divisionIds: [], bodyIds: [BODY], neighbors: true }, db.query);
    assert.deepEqual(near.bodies.map(body => body.id), [BODY, SECOND], "the boards filed on the same place");
    const mixed = await readPlacePackage({ state: "AZ", divisionIds: [PLACE], bodyIds: [FAR] }, db.query);
    assert.deepEqual(mixed.bodies.map(body => body.id), [BODY, SECOND, FAR], "a place and a territory's board together");
    assert.deepEqual((await readPlacePackage({ state: "AZ", divisionIds: [], bodyIds: [] }, db.query)).bodies, [], "no place and no board is an empty answer, not an error");
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await db.pg.close(); }
});

test("the calendar, agenda and Ask readers take their meetings from the same slices", async () => {
  const db = await open();
  try {
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [], bodyIds: [BODY], neighbors: true });
    const settings = meetingSettingsFromValues();
    const calendar = await readReaderEdgeMeetings({ bodyIds: [BODY], neighbors: true, window: "HELD", query: db.query, settings, now: AT });
    assert.ok(calendar.kind === "PROMOTED" || calendar.kind === "BOOTSTRAP", calendar.kind);
    if (calendar.kind === "PROMOTED" || calendar.kind === "BOOTSTRAP") assert.deepEqual(calendar.value.meetings.map(row => row.id).sort(), ["m-past", "m1", "m2", "m3"].sort());
    const agenda = await readReaderEdgeMeetings({ bodyIds: [BODY], neighbors: true, window: "HELD", meetingIds: ["m1"], query: db.query, settings, now: AT });
    if (agenda.kind === "PROMOTED" || agenda.kind === "BOOTSTRAP") assert.deepEqual(agenda.value.agendaDocuments.map(document => document.id), ["d1"]);
    else assert.fail(agenda.kind);
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await db.pg.close(); }
});

test("the order a page is read in is the same however the facts and registrations were written", async () => {
  const db = await open();
  try {
    const fact = (field: string, value: unknown) => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES('meeting:legistar:m1',$1,$2::jsonb,$3,'live','OFFICIAL',1,$3,$4,'t')`, [field, JSON.stringify(value), String(value), AT]);
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('meeting:legistar:m1','meeting','m1','AZ',$1)", [BODY]);
    await fact("title", "Regular meeting"); await fact("room", "Room 4"); await fact("agenda_url", "https://example.gov/a");
    await db.publish({ id: "reg-1", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", sourceId: "census", at: AT, value: { governments: [
      { id: "g-z", name: "Zeta", jurisdictionId: "g-z", associations: [{ divisionId: PLACE }] }, { id: "g-a", name: "Alpha", jurisdictionId: "g-a", associations: [{ divisionId: PLACE }] }], divisions: [] } });
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [PLACE] });
    const held = await readPlacePackage({ state: "AZ", divisionIds: [PLACE] }, db.query);
    assert.deepEqual(held.governments.map(government => government.id), ["g-a", "g-z"], "governments by id, not by the order the registration lists them");
    assert.deepEqual(held.bodies.find(body => body.id === BODY)!.sittings.map(row => row.field), ["title", "agendaUrl"], "a sitting's facts in the order they were filed, each field once");
    assert.equal(JSON.stringify(await readPlacePackage({ state: "AZ", divisionIds: [PLACE] }, db.query)), JSON.stringify(held), "reading again gives the same bytes");
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await db.pg.close(); }
});

test("the map and the ballot share one slice read for their request, and a later request reads current data", async () => {
  const db = await open();
  try {
    await seedPlaceSlices(db.query, { state: "AZ", divisionIds: [PLACE] });
    let reads = 0;
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      if (statement.text === PLACE_SLICES_SQL) reads++;
      return (await db.pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
    })));
    const selection = { keys: new Set(["85701"]), states: ["AZ"] };
    await withReaderSelection(selection, async () => {
      const map = readPlacePackage({ state: "az", divisionIds: [PLACE] }), ballot = readPlacePackage({ state: "AZ", divisionIds: [PLACE, PLACE] });
      assert.equal(map, ballot);
      assert.equal(await map, await ballot);
      assert.equal(reads, 1);
    });
    await withReaderSelection({ ...selection }, () => readPlacePackage({ state: "AZ", divisionIds: [PLACE] }));
    assert.equal(reads, 2, "a settled place response cannot outlive its request");
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await db.pg.close(); }
});
