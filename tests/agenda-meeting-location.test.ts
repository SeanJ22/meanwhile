import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  placeUnplacedFromAgendas,
  placementFor,
  statedAgendaAddress,
  streetKeyOf,
  type PlaceableVenue,
} from "../scripts/lib/agenda-meeting-location.ts";

/**
 * A sitting's place, as its own agenda states it: the address published by the official meeting
 * source, read from the agenda's header.
 */

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "agenda-location-headers.json"), "utf8")) as {
  headers: { meetingId: string; ocdId: string; text: string }[];
};
const header = (id: string) => fixture.headers.find((row) => row.meetingId === id)!;
const PIMA = header("legistar-insite:pima:1381577");
const MESA_STUDY = header("legistar-insite:mesa:1343168");
const MESA_ARTS = header("legistar-insite:mesa:1343177");
const MESA = "ocd-division/country:us/state:az/place:mesa";
const MESA_CITY_HALL: PlaceableVenue = {
  bodyOcdId: MESA, name: "Mesa City Hall, Council Chambers", address: "20 E. Main Street, Mesa, AZ 85201", lat: 33.415155, lng: -111.830942,
};

test("the agenda header's own place and street are read, with city and ZIP when printed", () => {
  const pima = statedAgendaAddress(PIMA.text)!;
  assert.equal(pima.place, "Administration Bldg - East");
  assert.equal(pima.street, "130 W. Congress Street");
  assert.deepEqual([pima.city, pima.state, pima.zip], ["Tucson", "AZ", "85701"], "the floor between street and city is skipped");
  assert.equal(pima.key, "130 w congress st");

  const mesa = statedAgendaAddress(MESA_STUDY.text)!;
  assert.equal(mesa.place, "City Hall", "the document's title words before the place are not the place");
  assert.equal(mesa.street, "20 East Main Street");
  assert.deepEqual([mesa.city, mesa.state, mesa.zip], [null, null, null], "nothing is invented when the header prints no city");
  assert.equal(mesa.key, "20 e main st");

  const arts = statedAgendaAddress(MESA_ARTS.text)!;
  assert.equal(arts.place, "Mesa Arts Center");
  assert.equal(arts.key, "1 e main st");
});

test("two spellings of one building agree; units, spelled numbers and suffix-less streets are handled", () => {
  assert.equal(streetKeyOf("20 E. Main Street, Mesa, AZ 85201")?.key, "20 e main st");
  assert.equal(streetKeyOf("20 East Main St.")?.key, "20 e main st");
  assert.equal(streetKeyOf("One East Main Street")?.key, "1 e main st");
  assert.equal(streetKeyOf("130 W. Congress St. 1st Floor, Tucson, AZ 85701")?.key, "130 w congress st");
  assert.equal(streetKeyOf("1 E. Broadway Blvd, Suite 401")?.key, "1 e broadway", "Broadway with and without Blvd is one street");
  assert.equal(streetKeyOf("1 E. Broadway, 4th Floor")?.key, "1 e broadway");
  assert.equal(streetKeyOf("Tuesday, September 22, 2026 at 5:00 PM"), null, "a date and a time are not an address");
});

test("Legistar publication keeps the source location ahead of an agenda venue-table match", () => {
  const row = {
    id: MESA_STUDY.meetingId, ocdId: MESA, location: null,
    venueGap: { kind: "STATED_NOT_PLACED", publishedText: "Study Session", publisher: "City of Mesa" },
  };
  const { rows, report } = placeUnplacedFromAgendas([row], () => MESA_STUDY.text, [MESA_CITY_HALL]);
  assert.equal(report.placed, 0);
  assert.equal(rows[0],row,"the publisher resolves EventLocation before any office fallback");
});

test("never across divisions, never over an adapter's placement or an online sitting, and never between disagreeing venues", () => {
  const elsewhere: PlaceableVenue = { ...MESA_CITY_HALL, bodyOcdId: "ocd-division/country:us/state:az/place:gilbert" };
  const gap = { id: MESA_STUDY.meetingId, ocdId: MESA, location: null, venueGap: { kind: "STATED_NOT_PLACED" } };
  assert.equal(placementFor(gap, MESA_STUDY.text, [elsewhere]).kind, "NO_REVIEWED_VENUE", "20 E Main St in another city is not this building");

  const placedAlready = { id: "x", ocdId: MESA, location: { name: "Adapter's room", address: null, lat: 1, lng: 2 } };
  const online = { id: "y", ocdId: MESA, location: null, online: { label: "Zoom" } };
  const kept = placeUnplacedFromAgendas([placedAlready, online], () => MESA_STUDY.text, [MESA_CITY_HALL]);
  assert.deepEqual(kept.rows, [placedAlready, online]);
  assert.equal(kept.report.placed, 0);

  const otherPin: PlaceableVenue = { ...MESA_CITY_HALL, name: "City Hall, lower level", lat: 33.4, lng: -111.8 };
  const ambiguous = placementFor(gap, MESA_STUDY.text, [MESA_CITY_HALL, otherPin]);
  assert.equal(ambiguous.kind, "AMBIGUOUS", "two reviewed pins at one address: none is chosen");

  const zipMismatch: PlaceableVenue = { ...MESA_CITY_HALL, address: "1 E. Main Street, Mesa, AZ 85203" };
  assert.equal(placementFor({ ...gap, id: MESA_ARTS.meetingId }, MESA_ARTS.text, [zipMismatch]).kind, "NO_REVIEWED_VENUE", "a stated ZIP must agree");
});

test("an agenda address with no reviewed venue keeps the sitting's named gap, and says so", () => {
  const row = { id: "ical:example:42", ocdId: MESA, location: null, venueGap: { kind: "STATED_NOT_PLACED", publishedText: "Piper Theater at the Mesa Arts Center" } };
  const { rows, report } = placeUnplacedFromAgendas([row], () => MESA_ARTS.text, [MESA_CITY_HALL]);
  assert.deepEqual(rows, [row]);
  assert.equal(report.noReviewedVenue, 1);
  assert.match(report.lines[0]!, /its agenda states "1 East Main Street"; no reviewed venue of its division carries that address/);
});

test("the ingest places unplaced sittings from their own agendas before a partition is promoted", () => {
  const ingest = readFileSync(join(import.meta.dirname, "..", "scripts", "ingest.ts"), "utf8");
  const call = ingest.indexOf("placeUnplacedFromAgendas(");
  assert.ok(call > ingest.indexOf("await retrieveAgendas(meetings);"), "after the agendas are read");
  assert.ok(call < ingest.indexOf("await promoteSelectedMeetingPartitions("), "before the partition is promoted");
  assert.match(ingest, /promoteSelectedMeetingPartitions\(\s*source,\s*agendaPlaced\.rows,/, "the placed rows are the ones promoted");
  assert.match(ingest, /currentVenueCache\(\)/, "only promoted reviewed venues are matched");
});
