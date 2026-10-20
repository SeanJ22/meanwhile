import assert from "node:assert/strict";
import test from "node:test";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { meetingAcquisitionFailureDomain, meetingRoutePartition } from "../lib/civic-data/meeting-partitions.ts";
import { HELD_MEETING_INPUT_SQL, HELD_MEETING_VENUES_SQL, readHeldMeetingInput } from "../lib/control-plane/scheduler/providers/held-meeting-input.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { VenueEntry } from "../lib/meetings/venue-cache.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import type { Body } from "../lib/registry/types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { readerMigrationDb, savePromotedFixture } from "./helpers/dg-migration-db.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";

const AT = "2026-10-20T04:00:00.000Z", DIVISION = "ocd-division/country:us/state:nh/place:example_town";
const BODY_ID = `${DIVISION}#governing`, SOURCE_URL = "https://example.nh.gov/calendar.ics";
const VENUE_SCOPE = requiredManualProductionContract("venue-resolutions").scope;
const UNLOADED = { $civicPayloadPart: "out-of-scope-part-must-never-be-loaded" };

function wiring(bodyId = BODY_ID, ocdId: string | null = DIVISION): BodySourceWiring {
  return { bodyId, ocdId, agendaSourceType: "ICAL", jurisdiction: "Example Town, NH", publishingOrg: "Example Town Clerk",
    timeZone: "America/New_York", config: { feedUrl: SOURCE_URL, slug: "example" }, verifiedAt: AT };
}

const partition = (row = wiring()) => meetingRoutePartition("ical", row.bodyId, {
  wiring: row, ocdId: row.ocdId, acquisitionFailureDomain: meetingAcquisitionFailureDomain("ical", row),
});

function body(row = wiring()): Body {
  return { id: row.bodyId, ocdId: row.ocdId, name: "Example Select Board", bodyClass: "governing", bodyOrigin: "SOURCED",
    coverageStatus: "LIVE", agendaSourceType: "ICAL", agendaSourceRef: SOURCE_URL, meetingCadence: null, homepageUrl: null,
    demandCount: 0, sourceDataset: "GOV_DIRECTORY", provenance: { sourceUrl: SOURCE_URL, sourceOrg: "Example Town", collectedAt: AT, verifiedAt: AT } };
}

function venue(row = wiring(), name = "Town Hall"): VenueEntry {
  return { sourceId: "ical", bodyOcdId: row.ocdId, ...(row.ocdId === null ? { tenant: row.config.slug } : {}), match: name,
    name, address: "1 Main Street", lat: 43, lng: -71, addressSourceUrl: "https://example.nh.gov/town-hall",
    coordinateSourceUrl: "https://example.nh.gov/town-hall", verifiedAt: AT };
}

function snapshot(row = wiring()): MeetingsSnapshot {
  const meeting: Meeting = { id: "ical:one", bodyId: row.bodyId, ocdId: row.ocdId, bodyName: "Select Board", title: "Public meeting",
    startsAt: "2026-10-22T18:00:00.000Z", timeZone: row.timeZone, location: null, agendaUrl: "https://example.nh.gov/agenda",
    jurisdiction: row.jurisdiction, status: "SCHEDULED",
    provenance: { sourceUrl: SOURCE_URL, sourceOrg: row.publishingOrg, collectedAt: AT, verifiedAt: AT } };
  return { formatVersion: 1, generatedAt: AT, counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ source: "ical", ok: true, error: null, fetched: 1, normalized: 1,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }],
    meetings: [meeting], agendaDocuments: [{ id: "ical:one@hash", meetingId: meeting.id, ocdId: row.ocdId,
      documentUrl: meeting.agendaUrl!, contentHash: "a".repeat(64), retrievedAt: AT, contentType: "text/html",
      text: "Public meeting agenda. ".repeat(3000), extraction: "html", extractionNote: null,
      sourceUrl: meeting.agendaUrl!, sourceOrg: row.publishingOrg, collectedAt: AT, verifiedAt: AT }] };
}

async function fixture(row = wiring(), options: {
  readonly previousSource?: string; readonly omitVenues?: boolean; readonly omitPrevious?: boolean;
} = {}) {
  const db = await readerMigrationDb();
  const save = (recordClass: RoutineRecordClass, scope: string, sourceId: string, value: unknown) =>
    savePromotedFixture(db, { recordClass, scope, sourceId, value, at: AT });
  const selectedBody = body(row), selectedPartition = partition(row), previous = snapshot(row), selectedVenue = venue(row);
  const saveRegistry = (selected: Body = selectedBody) => save("REGISTRY_RUNTIME_BINDING", "US-NH:reader-registry-runtime", "reader-registry-runtime", {
    registry: { generatedAt: AT, bodies: [
      { id: "ocd-division/country:us/state:az/place:other#body", ocdId: "ocd-division/country:us/state:az/place:other",
        name: "OTHER_STATE_BODY_".repeat(3000), unneeded: UNLOADED }, selected,
    ], divisions: UNLOADED }, country: UNLOADED,
  });
  const savePrevious = (value: MeetingsSnapshot = previous, source: string = selectedPartition.sourceId) =>
    save("MEETING", selectedPartition.scope, source, value);
  const saveVenues = (values: unknown[] = [selectedVenue]) => save("CURATED_READER_RECORD", VENUE_SCOPE, "curated-reader-primary-sources", {
    kind: "venue-resolutions", records: values, unrelatedCountryData: UNLOADED,
  });
  const registryEncoding = await saveRegistry();
  if (!options.omitPrevious) await savePrevious(previous, options.previousSource);
  if (!options.omitVenues) await saveVenues();
  await save("MEETING", "source:ical:body:outside-this-partition", "meetings-public-bodies", UNLOADED);
  return { ...db, row, selectedBody, selectedPartition, previous, selectedVenue, registryEncoding, saveRegistry, savePrevious, saveVenues };
}

test("held meeting inputs materialize one body, its original partition and venue rows from immutable payload members", async () => {
  const f = await fixture();
  try {
    assert.ok(f.registryEncoding.parts.length > 0, "the fixture exercises immutable storage rather than only inline JSON");
    const second = venue(f.row, "Library"), outside = venue(wiring(`${DIVISION}#outside`, "ocd-division/country:us/state:az/place:other"));
    await f.saveVenues([{ ...outside, name: "OTHER_STATE_VENUE_".repeat(3000), coordinateSourceUrl: UNLOADED }, f.selectedVenue, second]);
    const statements: string[] = [], responses: unknown[] = [];
    const query: Query = async (sql, params) => {
      statements.push(sql); const rows = await f.query(sql, params); responses.push(rows); return rows;
    };
    const input = await readHeldMeetingInput(query, f.selectedPartition);
    assert.deepEqual(input, { partition: f.selectedPartition, registry: { generatedAt: AT, divisions: [], bodies: [f.selectedBody] },
      previous: f.previous, venues: [f.selectedVenue, second] });
    assert.equal(statements.length, 2);
    assert.equal(statements[0], HELD_MEETING_INPUT_SQL);
    assert.equal(statements[1], HELD_MEETING_VENUES_SQL);
    assert.doesNotMatch(JSON.stringify(responses), /OTHER_STATE_BODY|OTHER_STATE_VENUE|out-of-scope-part/);
    assert.match(input.previous!.agendaDocuments[0]!.text!, /Public meeting agenda/);
    assert.equal(input.previous!.agendaDocuments[0]!.retrievedAt, AT, "loading never refreshes an evidence clock");
  } finally { await f.pg.close(); }
});

test("a verified empty venue scope is distinct from unavailable placement, and both permit the calendar", async () => {
  const f = await fixture();
  try {
    const heldVenue = f.selectedVenue;
    f.previous.meetings[0]!.location = { name: heldVenue.name, address: heldVenue.address, lat: heldVenue.lat, lng: heldVenue.lng };
    await f.savePrevious();
    await f.saveVenues([venue(wiring(`${DIVISION}#other`, "ocd-division/country:us/state:nh/place:elsewhere"))]);
    const empty = await readHeldMeetingInput(f.query, f.selectedPartition);
    assert.deepEqual(empty.venues, []);
    assert.equal(empty.venuesUnavailable, undefined);
    assert.deepEqual(empty.previous, f.previous);
    const missingFixture = await fixture(wiring(), { omitVenues: true });
    let missing: Awaited<ReturnType<typeof readHeldMeetingInput>>;
    try { missing = await readHeldMeetingInput(missingFixture.query, missingFixture.selectedPartition); }
    finally { await missingFixture.pg.close(); }
    assert.deepEqual(missing.venues, []);
    assert.match(missing.venuesUnavailable!, /VENUES_NOT_HELD/);
    assert.deepEqual(missing.previous, snapshot(), "venue absence preserves every prior verified fact and evidence clock");
    const unavailable = await readHeldMeetingInput(async (sql, params) => {
      if (sql === HELD_MEETING_VENUES_SQL) throw new Error("CIVIC_PAYLOAD_PART_MISSING");
      return f.query(sql, params);
    }, f.selectedPartition);
    assert.deepEqual(unavailable.registry.bodies, [f.selectedBody]);
    assert.deepEqual(unavailable.previous, f.previous);
    assert.deepEqual(unavailable.venues, []);
    assert.match(unavailable.venuesUnavailable!, /CIVIC_PAYLOAD_PART_MISSING/);
    const unheld = await fixture(wiring(), { omitPrevious: true });
    try { assert.equal((await readHeldMeetingInput(unheld.query, unheld.selectedPartition)).previous, null, "a genuinely unheld prior partition stays null"); }
    finally { await unheld.pg.close(); }
  } finally { await f.pg.close(); }
});

test("scope mismatches refuse without handing another subject's held facts to a worker", async t => {
  const f = await fixture();
  try {
    await t.test("a different state or adapter in the supplied partition never queries", async () => {
      const query: Query = async () => { throw new Error("Wrong scope reached the database"); };
      await assert.rejects(readHeldMeetingInput(query, { ...f.selectedPartition, ocdId: "ocd-division/country:us/state:az/place:other" }), /PARTITION_NOT_ONE_BODY/);
      await assert.rejects(readHeldMeetingInput(query, { ...f.selectedPartition, meetingSource: "iqm2" }), /PARTITION_NOT_ONE_BODY/);
    });
    await t.test("the selected registry body belongs to the declared division", async () => {
      await f.saveRegistry({ ...f.selectedBody, ocdId: "ocd-division/country:us/state:az/place:other" });
      await assert.rejects(readHeldMeetingInput(f.query, f.selectedPartition), /REGISTRY_NOT_ONE_BODY/);
      await f.saveRegistry();
    });
    await t.test("a different pointer source is refused", async () => {
      const wrong = await fixture(wiring(), { previousSource: "another-publisher" });
      try { await assert.rejects(readHeldMeetingInput(wrong.query, wrong.selectedPartition), /PREVIOUS_NOT_ONE_BODY/); }
      finally { await wrong.pg.close(); }
    });
    await t.test("foreign meetings are named as a scope error rather than silently dropped", async () => {
      const foreign = { ...f.previous.meetings[0]!, id: "foreign", bodyId: `${DIVISION}#other`, unneeded: UNLOADED };
      await f.savePrevious({ ...f.previous, meetings: [...f.previous.meetings, foreign] });
      await assert.rejects(readHeldMeetingInput(f.query, f.selectedPartition), /PREVIOUS_NOT_ONE_BODY/);
      await f.savePrevious();
    });
    await t.test("a response outside the injected query's contract is checked again", async () => {
      const [row] = await f.query(HELD_MEETING_INPUT_SQL, ["NH", f.row.bodyId, f.selectedPartition.scope]);
      await assert.rejects(readHeldMeetingInput(async () => [{ ...row, bodies: [{ ...f.selectedBody, id: `${DIVISION}#other` }] }], f.selectedPartition), /REGISTRY_NOT_ONE_BODY/);
      const [venueRow] = await f.query(HELD_MEETING_VENUES_SQL, [VENUE_SCOPE, ["ical"], f.row.ocdId, "example"]);
      const refused = await readHeldMeetingInput(async sql => sql === HELD_MEETING_INPUT_SQL ? [row!] :
        [{ ...venueRow, venues: [{ ...f.selectedVenue, sourceId: "iqm2" }] }], f.selectedPartition);
      assert.deepEqual(refused.venues, [], "a foreign venue never reaches the worker");
      assert.match(refused.venuesUnavailable!, /VENUE_NOT_ONE_BODY/);
    });
  } finally { await f.pg.close(); }
});

test("a body without a Census division only receives its own configured venue tenant", async () => {
  const row = wiring("curated:nh/example-school#board", null), f = await fixture(row);
  try {
    const selected = venue(row);
    await f.saveVenues([{ ...selected, tenant: "someone-else", name: UNLOADED }, selected]);
    assert.deepEqual((await readHeldMeetingInput(f.query, f.selectedPartition)).venues, [selected]);
  } finally { await f.pg.close(); }
});
