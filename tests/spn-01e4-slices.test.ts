import assert from "node:assert/strict";
import test from "node:test";
import { markSlicesOn, markPublicationSlices } from "../lib/core/slice-marks.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { forgetNationalShelf, refreshNationalShelf } from "../lib/reader/shelf.ts";
import { placeRegistry, stateRegistry } from "../lib/reader/state-shelf.ts";
import { owedMs, SLICE_BYTES_PER_HOUR, sliceTurn } from "../lib/reader/slice-lane.ts";
import type { AgendaBody, HistoryBody, MeetingsBody } from "../lib/reader/slice-meetings.ts";
import { buildSlices, ENTITY_CARDS, MEETING_CARDS, packSlice, readSlices, SLICE_CARDS, unpackSlice, writeSlices, type SliceCard } from "../lib/reader/slices.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { migratedFactDb, migratedReaderDb } from "./helpers/migrated-reader-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:example", OTHER = "ocd-division/country:us/state:az/place:other";
const BODY = "az:city:example#governing", OTHER_BODY = "az:city:other#governing", FOLDED = "az:city:example#old";
const AT = "2026-10-24T08:00:00.000Z", encoded = encodeURIComponent;
const CURRENT = `source:legistar:body:${encoded(BODY)}`, FAMILY = "source:derived:family:US-AZ";
const meeting = (id: string, extra: Record<string, unknown> = {}) => ({ id, ocdId: PLACE, bodyId: BODY, title: id, startsAt: "2026-11-02T18:00:00-07:00", timeZone: "America/Phoenix", ...extra });
const header = { formatVersion: 1, generatedAt: AT, counts: { fresh: 1, total: 1 }, sources: [{ source: "legistar", ok: true, error: null, acquisitions: [{ source: "legistar", rawHash: "a".repeat(64) }] }] };

async function open() {
  const db = await migratedFactDb();
  for (const ddl of WORK_DDL) await db.pg.exec(ddl);
  const place = (id: string) => db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'AZ')", [id]);
  const board = async (id: string, at: string) => { await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$1,'AZ')", [id]); await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA')", [id, at]); };
  await place(PLACE); await place(OTHER); await board(BODY, PLACE); await board(OTHER_BODY, OTHER);
  await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2)", [BODY, FOLDED]);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/cal','https://example.gov/cal',$1,$2,'k')", [AT, "a".repeat(64)]);
  await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('meeting:legistar:m1','meeting','m1','AZ',$1)", [BODY]);
  const fact = (field: string, value: unknown, quote: string) => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
    VALUES('meeting:legistar:m1',$1,$2::jsonb,$3,'live','OFFICIAL',1,$4,$5,'t')`, [field, JSON.stringify(value), String(value), quote, AT]);
  await fact("title", "Regular meeting", "Regular meeting"); await fact("room", "Room 4", "Meets in Room 4");
  return { db, fact };
}

test("the migration lets a place hold the meetings, history and agenda cards, and no other", async () => {
  const { db } = await open();
  try {
    for (const card of MEETING_CARDS) await db.query("INSERT INTO place_slice(place_id,card,body,fingerprint) VALUES($1,$2,NULL,'x')", [PLACE, card]);
    await assert.rejects(db.query("INSERT INTO place_slice(place_id,card,body,fingerprint) VALUES($1,'bogus',NULL,'x')", [PLACE]), /place_slice_card_check/);
  } finally { await db.pg.close(); }
});

test("a board's meetings cards hold its calendars, sittings, agenda papers and held history and nothing of another board's, and a place's hold the meetings no board owns", async () => {
  const { db } = await open();
  try {
    const { publish } = db;
    await publish({ id: "cv-old", recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: "2026-01-01T00:00:00.000Z", value: { ...header, meetings: [meeting("m0", { startsAt: "2020-01-01T18:00:00-07:00" })], agendaDocuments: [] } });
    await publish({ id: "cv-1", recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("m1"), meeting("mx", { bodyId: OTHER_BODY, ocdId: OTHER })],
      agendaDocuments: [{ id: "d1", meetingId: "m1", ocdId: PLACE, documentUrl: "https://example.gov/a.pdf", text: "The agenda text." }] } });
    await publish({ id: "cv-h", recordClass: "MEETING", scope: `${CURRENT}:history`, sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("m-past", { startsAt: "2026-09-01T18:00:00-07:00" })], agendaDocuments: [] } });
    await publish({ id: "cv-f", recordClass: "MEETING", scope: FAMILY, sourceId: "derived", at: AT, value: { ...header, meetings: [meeting("m3", { bodyId: undefined }), meeting("m4", { bodyId: FOLDED }), meeting("m5", { bodyId: OTHER_BODY, ocdId: OTHER })],
      agendaDocuments: [], derivedMembers: [{ bodyId: BODY, source: "ical", outcome: "FRESH", status: "ok" }, { bodyId: OTHER_BODY, source: "ical", outcome: "FRESH", status: "ok" }] } });
    await publish({ id: "cv-o", recordClass: "MEETING", scope: `source:legistar:body:${encoded(OTHER_BODY)}`, sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("mo", { bodyId: OTHER_BODY, ocdId: OTHER })], agendaDocuments: [] } });

    const built = await buildSlices(db.query, new Map([BODY, OTHER_BODY, PLACE, OTHER].map(subject => [subject, new Set<SliceCard>(MEETING_CARDS)])));
    const ids = (body: { parts: MeetingsBody["parts"] }) => body.parts.map(part => [part.s, part.r.map(row => row.id)]);
    const meetings = built.get(BODY)!.get("meetings") as MeetingsBody;
    assert.deepEqual(ids(meetings), [[FAMILY, ["m4"]], [CURRENT, ["m1"]]], "its own calendar's meetings, and the family's rows for it by the name the board was folded from");
    const [family, own] = meetings.parts;
    assert.deepEqual([own!.c, own!.v, meetings.s], [null, "cv-1", BODY]); assert.ok("acquisitions" in (own!.h.sources as Record<string, unknown>[])[0]!, "a board's own calendar keeps its acquisitions");
    assert.ok(!("acquisitions" in (family!.h.sources as Record<string, unknown>[])[0]!), "the family's sources are reported without their acquisitions"); assert.deepEqual(family!.m!.map(member => member.bodyId), [BODY]);
    assert.ok(!("meetings" in own!.h) && !("agendaDocuments" in own!.h), "a header holds no rows");
    assert.deepEqual(meetings.sittings.map(row => [row[0], row[1], row[2], row[3], row[5], row.length]), [[BODY, "meeting:legistar:m1", "room", "Room 4", "live", 7], [BODY, "meeting:legistar:m1", "title", "Regular meeting", "live", 6]],
      "a sitting's quote is kept only when it is not the value");
    assert.deepEqual([meetings.sources, meetings.stamps], [["https://example.gov/cal"], [[0, AT]]]);
    assert.deepEqual((built.get(BODY)!.get("agenda") as AgendaBody).documents.map(document => document.id), ["d1"]);
    const history = built.get(BODY)!.get("history") as HistoryBody;
    assert.deepEqual([history.parts.map(part => part.r.map(row => row.id)), history.archived.map(row => row.id)], [[["m-past"]], ["m0"]], "held history, and a sitting only an earlier version of the calendar carries");
    assert.deepEqual(ids(built.get(OTHER_BODY)!.get("meetings") as MeetingsBody), [[FAMILY, ["m5"]], [`source:legistar:body:${encoded(OTHER_BODY)}`, ["mo"]]], "another board's rows inside this board's partition are not this board's");
    assert.deepEqual(ids(built.get(PLACE)!.get("meetings") as MeetingsBody), [[FAMILY, ["m3"]]], "the meeting no board owns is held by the place it names");
    assert.equal(built.get(OTHER)!.get("meetings"), null);

    // What is written is what a reader gets back with the page, and the large ones are stored packed.
    assert.equal(await writeSlices(db.query, built), 12);
    const stored = await db.query("SELECT card,body FROM place_slice WHERE place_id=$1 ORDER BY card", [BODY]);
    assert.ok(stored.some(row => row.card === "meetings" && ("z" in (row.body as object) || "d" in (row.body as object))), "a slice is stored packed when that is shorter");
    await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA') ON CONFLICT DO NOTHING", [OTHER_BODY, PLACE]);
    const read = await readSlices(db.query, [PLACE], ["meetings"]);
    assert.deepEqual([...read.keys()].sort(), [BODY, OTHER_BODY, PLACE].sort(), "a place's page reads its own card and those of the boards filed on it");
    assert.deepEqual(read.get(BODY)!.get("meetings"), JSON.parse(JSON.stringify(meetings)));
    assert.equal(await writeSlices(db.query, built), 0, "slices that read the same are not written again");
  } finally { await db.pg.close(); }
});

test("a calendar, a confirmation, a history and a registration published mark the slices they reach, and a sitting filed marks its board's places", async () => {
  const { db } = await open();
  try {
    const list = workList(db.query, { owner: "marks-test" });
    markSlicesOn(() => list);
    const marked = async (input: Parameters<typeof markPublicationSlices>[1]) => {
      await db.query("DELETE FROM work"); await markPublicationSlices(db.query, input);
      return (await db.query("SELECT place_id,field FROM work ORDER BY place_id,field")).map(row => `${({ [PLACE]: "place", [BODY]: "board", [OTHER_BODY]: "other-board" } as Record<string, string>)[String(row.place_id)]}:${row.field}`);
    };
    await db.publish({ id: "cv-1", recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting("m1")], agendaDocuments: [] } });
    await db.publish({ id: "cv-f", recordClass: "MEETING", scope: FAMILY, sourceId: "derived", at: AT, value: { ...header, meetings: [meeting("m3", { bodyId: undefined }), meeting("m4", { bodyId: FOLDED }), meeting("m5", { bodyId: OTHER_BODY, ocdId: OTHER })], agendaDocuments: [] } });
    await db.publish({ id: "cv-r", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", sourceId: "census", at: AT, value: { governments: [{ id: "g1", name: "Example", associations: [{ divisionId: PLACE }] }], divisions: [] } });
    assert.deepEqual(await marked({ recordClass: "MEETING", scope: CURRENT }), ["board:agenda", "board:history", "board:meetings"], "a calendar reaches the meetings, agenda and history of its board alone");
    assert.deepEqual(await marked({ recordClass: "MEETING", scope: `${CURRENT}:history` }), ["board:history"]);
    assert.deepEqual(await marked({ recordClass: "MEETING", scope: FAMILY }), ["board:agenda", "board:history", "board:meetings", "other-board:agenda", "other-board:history", "other-board:meetings", "place:agenda", "place:history", "place:meetings"],
      "a state's family reaches every board its rows name, under the name the board was folded into, and the place a row names without a board");
    assert.deepEqual(await marked({ recordClass: "REGISTRATION", scope: "US-AZ:registration:v1" }), ["place:bodies"]);
    assert.deepEqual(await marked({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-AZ:reader-registry-runtime" }), [], "the registry is held on the shelf, whose version moves with the pointer");
    // Once the board's cards are built, a calendar read again marks nothing; only a row that differs does, and only the card it is on.
    const { cardInputs } = await import("../lib/reader/slice-meetings.ts");
    await writeSlices(db.query, await buildSlices(db.query, new Map([[BODY, new Set<SliceCard>(MEETING_CARDS)]])), await cardInputs(db.query, [BODY]));
    const later = (id: string, title: string, rawHash: string) => db.publish({ id, recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: "2026-10-24T09:00:00.000Z",
      value: { ...header, generatedAt: "2026-10-24T09:00:00.000Z", sources: [{ ...header.sources[0]!, acquisitions: [{ source: "legistar", rawHash }] }], meetings: [meeting("m1", { title })], agendaDocuments: [] } });
    await later("cv-2", "m1", "b".repeat(64));
    assert.deepEqual(await marked({ recordClass: "MEETING", scope: CURRENT }), [], "a calendar read again, with only the moments and bytes it was read at moved, marks nothing");
    await later("cv-3", "Moved to 7 PM", "c".repeat(64));
    assert.deepEqual(await marked({ recordClass: "MEETING", scope: CURRENT }), ["board:meetings"], "a row that differs marks the card it is on");
    const { slicesOf } = await import("../lib/core/slice-marks.ts");
    assert.deepEqual((await slicesOf(db.query, ["meeting:legistar:m1"])).map(mark => [mark.placeId, mark.card]), [[BODY, "meetings"]], "a sitting's facts reach the meetings of its board");
  } finally { await db.pg.close(); }
});

test("the backfill gives slices to the places of the most populated ZIPs first, and builds places nobody asked for only while the hour's allowance of reads is not spent", async () => {
  const db = await migratedFactDb();
  for (const ddl of WORK_DDL) await db.pg.exec(ddl);
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,page_priority) VALUES('zip:90001','place','Big','AZ',90000),('zip:90002','place','Small','AZ',5)");
    await db.query("INSERT INTO entity(id,kind,name,state) SELECT 'ocd-division/country:us/state:az/place:big'||n,'place','Big','AZ' FROM generate_series(1,110) n");
    await db.query("INSERT INTO entity(id,kind,name,state) SELECT 'ocd-division/country:us/state:az/place:small'||n,'place','Small','AZ' FROM generate_series(1,5) n");
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES('ocd-division/country:us/state:az/place:aaa','place','Unseen','AZ')");
    await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) SELECT '90001','ocd-division/country:us/state:az/place:big'||n,1,2026 FROM generate_series(1,110) n");
    await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) SELECT '90002','ocd-division/country:us/state:az/place:small'||n,1,2026 FROM generate_series(1,5) n");
    const list = workList(db.query, { owner: "order-test" }), built = async () => new Set((await db.query("SELECT DISTINCT place_id FROM place_slice")).map(row => String(row.place_id).split(":").at(-1)));
    const first = await sliceTurn({ list, facts: db.query });
    assert.deepEqual([first.backfilled, [...await built()].every(place => place!.startsWith("big"))], [100, true], "a hundred places of the biggest ZIP, none from a smaller one or from no ZIP");
    await sliceTurn({ list, facts: db.query });
    assert.deepEqual([...await built()].filter(place => !place!.startsWith("big")).sort(), ["small1", "small2", "small3", "small4", "small5"], "the rest of the big ZIP, then the next ZIP, and only then places no ZIP lays over");
    await sliceTurn({ list, facts: db.query });
    assert.ok((await built()).has("aaa"));
    assert.equal(owedMs(0), 0); assert.equal(owedMs(SLICE_BYTES_PER_HOUR / 1.05), 3_600_000); assert.equal(owedMs(SLICE_BYTES_PER_HOUR / 4.2), 900_000);
  } finally { await db.pg.close(); }
});

test("a state's registry is read into the shelf once, with whether its registration is held, and again only when its pointer moves", async () => {
  const { pg, publish } = await migratedReaderDb();
  installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows)));
  try {
    const registry = (id: string, divisions: unknown[]) => ({ id, recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: "US-AZ:reader-registry-runtime", sourceId: "registry-reviewed-bindings", at: AT,
      value: { formatVersion: 1, registry: { generatedAt: AT, bodies: [], divisions }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { formatVersion: 1, rule: "x", rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } });
    await publish(registry("rr-1", []));
    const first = await stateRegistry("AZ");
    assert.deepEqual([first.model?.registry.divisions, first.registrationHeld], [[], false]);
    assert.equal(await stateRegistry("AZ"), first, "held in memory, not read again");
    await publish(registry("rr-2", [{ ocdId: PLACE }]));
    await publish({ id: "reg-1", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", sourceId: "census", at: AT, value: { governments: [{ id: "g1", name: "Example", associations: [{ divisionId: PLACE }] }], divisions: [] } });
    await refreshNationalShelf();
    const next = await stateRegistry("AZ");
    assert.deepEqual([next.model?.registry.divisions.map(division => division.ocdId), next.registrationHeld], [[PLACE], true], "a published registry or registration moves the version, and the part is read again");
  } finally { installReaderDatabaseQuery(undefined); forgetNationalShelf(); await pg.close(); }
});

test("a state's registry gives a place the boards that serve it, its divisions and their parents, and the candidacies, photos and executives of its people", () => {
  const body = (id: string, ocdId: string | null, extra: Record<string, unknown> = {}) => ({ id, ocdId, ...extra });
  const holder = (id: string, divisions: string[]) => ({ holder: { id, divisions, officeTitle: "Mayor", name: id, authority: "STATE_PEOPLE", sourceUrl: null }, status: "RESOLVED", candidacy: null, reason: "", unresolvedCandidacyIds: [] });
  const model = { formatVersion: 1,
    registry: { generatedAt: AT, bodies: [body("b1", PLACE), body("b2", OTHER), body("b3", null, { alsoServesOcdIds: [PLACE] }), body("b4", OTHER)],
      divisions: [{ ocdId: PLACE, parentOcdId: "state:az" }, { ocdId: "state:az", parentOcdId: null }, { ocdId: OTHER, parentOcdId: "state:az" }] },
    bodyRosters: [{ bodyId: "b1", members: [{ id: "roster:b1#1", personId: "p1" }] }, { bodyId: "b2", members: [] }],
    rosterReaderDispositions: [{ sourceId: "roster:b1#1", canonicalId: "roster:b1#1" }, { sourceId: "roster:b2#1", canonicalId: "roster:b2#1" }],
    statewideExecutives: [{ stateOcdId: "state:az", holder: { id: "gov" } }, { stateOcdId: "state:nm", holder: { id: "other-gov" } }],
    officialCandidacies: { formatVersion: 1, rule: "x", rows: [holder("p1", []), holder("someone", [OTHER]), holder("mayor", [PLACE]), holder("gov", [])] },
    officialPhotos: { photos: [{ officeholderId: "p1" }, { officeholderId: "someone" }, { officeholderId: "x", personId: "p1" }] },
    rosterPhotos: { "roster:b1#1": "u1", "roster:b2#1": "u2" } } as unknown as RegistryRuntimeReadModel;
  const mine = placeRegistry(model, { divisionIds: [PLACE, "state:az"], boardIds: ["b4"] });
  assert.deepEqual(mine.registry.bodies.map(row => row.id), ["b1", "b3", "b4"], "boards that serve it, or also serve it, or its page already has");
  assert.deepEqual(mine.registry.divisions.map(row => row.ocdId), [PLACE, "state:az", OTHER], "its divisions, the parents of its boards' divisions");
  assert.deepEqual(mine.bodyRosters.map(row => row.bodyId), ["b1"]);
  assert.deepEqual(mine.rosterReaderDispositions.map(row => row.sourceId), ["roster:b1#1"]);
  assert.deepEqual(mine.statewideExecutives.map(row => row.holder.id), ["gov"]);
  assert.deepEqual(mine.officialCandidacies.rows.map(row => row.holder.id), ["p1", "someone", "mayor", "gov"], "people it seats, and those whose seats lie in its divisions, which include those of its boards");
  assert.deepEqual(mine.officialPhotos.photos.map(row => row.officeholderId), ["p1", "someone", "x"]);
  assert.deepEqual(Object.keys(mine.rosterPhotos), ["roster:b1#1"]);
});

test("a slice is stored as itself when tiny, against the shared dictionary when small, in brotli when large, and reads back the same", () => {
  const tiny = { v: 2 }, small = { v: 2, sources: ["https://example.gov/api"], stamps: [[0, AT, "OFFICIAL"]], boards: [], entities: [{ id: BODY, k: "body", n: "Example City Council", f: { name: ["Example City Council", 0] } }] };
  const large = { v: 1, parts: Array.from({ length: 300 }, (_, i) => ({ id: `legistar:example:${i}`, title: `Regular meeting of the board of directors, session ${i}`, startsAt: "2026-11-02T18:00:00-07:00" })) };
  assert.equal(packSlice(tiny), tiny);
  assert.deepEqual([Object.keys(packSlice(small) as object), Object.keys(packSlice(large) as object)], [["d"], ["z"]]);
  for (const body of [tiny, small, large]) assert.deepEqual(unpackSlice(packSlice(body)), body);
});

test("every card has one owner: entity cards and meeting cards are disjoint and make the whole set", () => {
  assert.deepEqual([...ENTITY_CARDS, ...MEETING_CARDS], [...SLICE_CARDS]);
});
