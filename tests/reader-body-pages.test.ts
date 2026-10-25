import assert from "node:assert/strict";
import test from "node:test";
import { readMeetingBodies } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { snapshotCounts } from "../lib/meetings/snapshot.ts";
import { PLACE_PAGES_SQL, READY_PLACE_SQL, readPlacePackage } from "../lib/reader/place.ts";
import { composePlaceRow } from "../lib/reader/place-decode.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { seedPlacePages } from "./helpers/place-pages.ts";

const AT = "2026-10-24T12:00:00.000Z", AZ = "ocd-division/country:us/state:az", CA = "ocd-division/country:us/state:ca";
const FIRST = `${AZ}/place:example#council`, SECOND = `${AZ}/place:example#planning`, FOREIGN = `${CA}/place:example#council`;

function meeting(bodyId: string, suffix: string, startsAt: string): Meeting {
  return { id: `fixture:${suffix}`, bodyId, ocdId: bodyId.split("#")[0]!, bodyName: "Public board", title: "Public meeting", startsAt,
    timeZone: "UTC", location: null, agendaUrl: null, jurisdiction: "Local", status: "SCHEDULED",
    provenance: { sourceUrl: "https://example.gov/meetings", sourceOrg: "Public board", collectedAt: AT, verifiedAt: AT } };
}

function bodyRow(bodyId: string, meetings: Meeting[]) {
  const state = bodyId.includes("state:az") ? "AZ" : "CA";
  return { page_id: bodyId, page_kind: "body", built_at: AT, body_ids: [bodyId], row: {
    division_ids: [], entities: [{ id: bodyId, kind: "body", state, division: bodyId.split("#")[0] }],
    fields: [], rosters: [], comments: [], sittings: [], governments: [], divisions: [], registration_held: false, parts: {},
    meeting_rows: [{ scope: `source:fixture:body:${encodeURIComponent(bodyId)}`, current_version_id: bodyId, confirmation: null,
      payload: { formatVersion: 1, generatedAt: AT, meetings, sources: [], agendaDocuments: [], counts: snapshotCounts(meetings, 0) } }],
  } };
}

test("state jobs list IDs once per state and defer each bounded page read until its body is loaded", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const soon = meeting(FIRST, "soon", "2026-10-27T12:00:00Z");
  const query: Query = async (text, params = []) => {
    calls.push({ text, params });
    if (text.startsWith("SELECT id FROM entity")) {
      assert.deepEqual(params, [calls.filter(call => call.text.startsWith("SELECT id FROM entity")).length === 1 ? ["AZ"] : ["CA"]]);
      return (params[0] as string[]).includes("AZ") ? [{ id: FIRST }, { id: SECOND }] : [{ id: FOREIGN }];
    }
    assert.equal(text, PLACE_PAGES_SQL);
    assert.equal(params[5], false, "a worker never opens a complete state aggregate");
    const bodies = params[2] as string[];
    assert.equal(bodies.length, 1, "one body calendar crosses the connection");
    return [bodyRow(bodies[0]!, bodies[0] === FIRST ? [meeting(FIRST, "old", "2020-01-01T12:00:00Z"), soon,
      meeting(FIRST, "future", "2028-01-01T12:00:00Z")] : [])];
  };
  const iterator = readMeetingBodies({ states: ["az", "CA"], now: AT, settings: meetingSettingsFromValues(), query });
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value!.bodyId, FIRST);
  assert.equal(calls.length, 1, "listing does not load either body's page");
  const loaded = await first.value!.load();
  assert.deepEqual(loaded?.snapshot.meetings.map(row => row.id), [soon.id], "the configured shown window is still applied");
  assert.equal(calls.length, 2);
  const second = await iterator.next();
  assert.equal(second.value!.bodyId, SECOND);
  assert.equal(calls.length, 2, "moving to the next body loads no calendar");
  assert.deepEqual((await second.value!.load())?.snapshot.meetings, []);
  assert.equal(calls.length, 3);
  const foreign = await iterator.next();
  assert.equal(foreign.value!.state, "CA");
  assert.equal(foreign.value!.bodyId, FOREIGN);
  assert.equal(calls.length, 4, "the next state's ID list is read after this state's IDs are consumed");
  await iterator.return(undefined);
});

test("state selection reads individual body contexts and direct pages select separate current/history answers", async () => {
  const { pg, publish } = await migratedReaderDb();
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const current = meeting(FIRST, "current", AT), other = meeting(SECOND, "other", AT), past = meeting(FIRST, "past", "2020-01-01T12:00:00Z");
  try {
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ'),($2,'body','Council','AZ'),($3,'body','Planning','AZ'),($4,'body','Elsewhere','CA')", [AZ, FIRST, SECOND, FOREIGN]);
    await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias','former-council-id')", [FIRST]);
    for (const [id, scope, meetings] of [["current", "source:derived:family:US-AZ", [current, other]], ["history", "source:derived:family:US-AZ:history", [past]]] as const) {
      await publish({ id, recordClass: "MEETING", scope, sourceId: "fixture", at: AT,
        value: { formatVersion: 1, generatedAt: AT, meetings, sources: [], agendaDocuments: [], counts: snapshotCounts(meetings, 0) } });
    }
    await seedPlacePages(query, { state: "AZ", divisionIds: [], bodyIds: [FIRST, SECOND] });
    let reads = 0;
    const state = await readPlacePackage({ state: "AZ", divisionIds: [], allBodies: true }, async (text, params) => {
      reads++;
      assert.equal(text, PLACE_PAGES_SQL);
      const rows = await query(text, params);
      assert.deepEqual(rows.map(row => row.page_id), [FIRST, SECOND]);
      for (const row of rows) assert.deepEqual((row.row as { entities: { id: string }[] }).entities.map(body => body.id), [row.page_id]);
      return rows;
    });
    assert.equal(reads, 1);
    assert.deepEqual(state.meetings.map(row => row.id).sort(), [current.id, other.id].sort());
    await seedPlacePages(query, { state: "WA", divisionIds: [] });
    const empty = await readPlacePackage({ state: "WA", divisionIds: [], allBodies: true }, async (text, params) => {
      const rows = await query(text, params);
      assert.deepEqual(rows.map(row => row.page_kind), ["empty"], "a state with no bodies uses only its saved empty shell");
      return rows;
    });
    assert.deepEqual(empty.bodies, []);
    assert.equal(empty.snapshotHeldAt, null);
    const alias = await readPlacePackage({ state: "AZ", divisionIds: [], bodyIds: ["former-council-id"] }, query);
    assert.deepEqual(alias.bodies.map(body => body.id), [FIRST]);
    assert.deepEqual(alias.meetings.map(row => row.id), [current.id]);
    for (const includeHistory of [false, true]) {
      const ready = await readPlacePackage({ state: "AZ", placeId: FIRST, divisionIds: [], includeHistory }, async (text, params) => {
        assert.equal(text, READY_PLACE_SQL);
        return query(text, params);
      });
      assert.deepEqual(ready.meetings.map(row => row.id).sort(), (includeHistory ? [past.id, current.id] : [current.id]).sort());
    }
    const zip = "zip:85701";
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Fixture ZIP','AZ')", [zip]);
    await query(`INSERT INTO place_page(place_id,body,history_body,context)
      SELECT $1,body,'{}'::jsonb,'{"formatVersion":1}'::jsonb FROM place_page WHERE place_id=$2`, [zip, FIRST]);
    for (const includeHistory of [false, true]) {
      let zipReads = 0;
      const selected = await readPlacePackage({ state: "AZ", placeId: zip, divisionIds: [], bodyIds: [FIRST], includeHistory }, async (text, params) => {
        zipReads++;
        assert.equal(text, includeHistory ? PLACE_PAGES_SQL : READY_PLACE_SQL, "ZIP history uses the existing bounded place/body context");
        return query(text, params);
      });
      assert.equal(zipReads, 1);
      assert.deepEqual(selected.meetings.map(row => row.id).sort(), (includeHistory ? [past.id, current.id] : [current.id]).sort());
    }
    const [stored] = await query("SELECT body ? 'snapshot' AS direct_current,history_body ? 'snapshot' AS direct_history,context ? 'current' AS raw_current FROM place_page WHERE place_id=$1", [FIRST]);
    assert.deepEqual(stored, { direct_current: true, direct_history: true, raw_current: true });
  } finally { await pg.close(); }
});

test("a worker that omits agendas reads the compact historical body page and keeps permanent past meetings", async () => {
  const old = meeting(FIRST, "old", "2020-01-01T12:00:00Z"), soon = meeting(FIRST, "soon", "2026-10-27T12:00:00Z");
  const row = bodyRow(FIRST, [old, soon, meeting(FIRST, "far-future", "2028-01-01T12:00:00Z")]).row;
  const page = await composePlaceRow({ state: "AZ", divisionIds: [], bodyIds: [FIRST], includeHistory: true }, row);
  let pageReads = 0;
  const query: Query = async (text, params = []) => {
    if (text.startsWith("SELECT id FROM entity")) return [{ id: FIRST }];
    assert.equal(text, READY_PLACE_SQL);
    assert.deepEqual(params, [FIRST, true]);
    pageReads++;
    return [{ page, version: 1 }];
  };
  const iterator = readMeetingBodies({ states: ["AZ"], includeAgenda: false, window: "HELD", now: AT, settings: meetingSettingsFromValues(), query });
  const body = await iterator.next();
  if(body.done)throw new Error("The held body was not listed");
  assert.equal(pageReads, 0);
  const loaded = await body.value.load();
  assert.equal(pageReads, 1);
  assert.deepEqual(loaded?.snapshot.meetings.map(meeting => meeting.id), [old.id, soon.id]);
  assert.deepEqual(loaded?.snapshot.agendaDocuments, []);
  await iterator.return(undefined);
});
