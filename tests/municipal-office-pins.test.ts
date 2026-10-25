import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withMunicipalHallOffices } from "../lib/meetings/municipal-office.ts";
import { placePublishedMeetingPins } from "../lib/meetings/publish-pins.ts";
import type { MeetingPinBody } from "../lib/meetings/pin-location.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { factDb } from "./helpers/fact-db.ts";

const DIVISION = "ocd-division/country:us/state:id/place:boise_city", BODY = `${DIVISION}#governing`;
const NOW = "2026-10-25T09:00:00.000Z";
const { source, target } = JSON.parse(readFileSync(new URL("./fixtures/mt01-municipal-hall-meetings.json", import.meta.url), "utf8")) as { source: Meeting; target: Meeting };
const HALL = source.location!.address!;
const census = JSON.parse(readFileSync(new URL("./fixtures/mt01-municipal-hall-census.json", import.meta.url), "utf8"));
const reply = (value: unknown) => new Response(JSON.stringify(value));

test("the same municipality's published hall address supplies a saved government-office fallback", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    for (const statement of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8").split("--> statement-breakpoint"))
      if (/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement)) await db.pg.exec(statement);
    const scope = `source:iqm2:body:${encodeURIComponent(source.bodyId!)}`;
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3)", [`MEETING:${scope}`, scope, JSON.stringify({ meetings: [source] })]);
    const requests: string[] = [];
    const placed = await placePublishedMeetingPins({ meetings: [target], query: db.query, offices: new Map(), clock: () => NOW,
      fetchImpl: async input => {
        const address = new URL(String(input)).searchParams.get("address")!;
        requests.push(address);
        // The meeting's omitted directional has two competing Census candidates.
        return reply(address.includes("150 N.") ? census : { result: { addressMatches: [
          ...census.result.addressMatches, ...census.result.addressMatches] } });
      } });
    assert.deepEqual(placed.held, []);
    assert.deepEqual(requests, ["150 Capitol Blvd, Boise, ID 83702", "150 N. Capitol Blvd, Boise, ID 83702"]);
    const pin = placed.meetings[0].mapPin!;
    assert.equal(pin.basis, "GOVERNMENT_OFFICE");
    assert.equal(pin.address, HALL);
    assert.equal(pin.provenance.sourceUrl, source.provenance.sourceUrl);
    assert.equal(pin.lat, 43.615387122768);
    assert.equal(pin.lng, -116.201864471479);
    assert.equal(placed.meetings[0].location, null);
    assert.equal(placed.meetings[0].venueGap?.publishedText, target.venueGap!.publishedText);
    assert.equal(placed.meetings[0].id, target.id);
    const following = await placePublishedMeetingPins({ meetings: [target], previous: placed.meetings,
      query: db.query, offices: new Map(), clock: () => "2026-10-25T10:00:00.000Z",
      fetchImpl: async () => { throw Error("Saved office requested Census again"); } });
    assert.deepEqual(following.held, []);
    assert.deepEqual(following.meetings[0].mapPin, pin);
    assert.equal(following.responses.length, 0);
    const withoutHall = await placePublishedMeetingPins({ meetings: [target], previous: placed.meetings,
      offices: new Map(), query: async () => [], fetchImpl: async () => reply({ result: { addressMatches: [] } }) });
    assert.deepEqual(withoutHall.held, []);
    assert.deepEqual(withoutHall.meetings[0].mapPin, pin, "A calendar dropping a hall citation does not erase a saved office pin");
  } finally { await db.pg.close(); }
});

test("a hall cannot borrow a neighboring city, a county, a school district or a mailing address", async () => {
  for (const changed of [
    { bodyId: "ocd-division/country:us/state:id/place:meridian#governing" },
    { ocdId: "ocd-division/country:us/state:id/place:meridian" },
    { jurisdiction: "Boise School District" },
    { jurisdiction: "County of Boise" },
    { location: { ...source.location!, address: "150 N. Capitol Blvd, Meridian, ID 83702" } },
    { location: { ...source.location!, address: "150 N. Capitol Blvd, Boise, WA 83702" } },
    { location: { ...source.location!, address: "P.O. Box 500, Boise, ID 83702" } },
    { location: { ...source.location!, name: "Town Hall Meeting at a library" } },
    { provenance: { ...source.provenance, sourceUrl: null } },
  ]) {
    const unstated = { ...target, venueGap: { kind: "NOT_STATED_BY_PUBLISHER" as const, publishedText: null, publisher: "CITY OF BOISE" } };
    const result = await withMunicipalHallOffices(undefined, [unstated, { ...source, ...changed }], new Map(), () => assert.fail());
    assert.deepEqual(result.get(BODY)?.governmentOfficeAlternatives, [], JSON.stringify(changed));
  }
  const county = { ...target, bodyId: "ocd-division/country:us/state:id/county:ada#governing", jurisdiction: "County of Ada" };
  const result = await withMunicipalHallOffices(async () => { throw Error("A county scanned municipal sources"); }, [county, source], new Map(), () => assert.fail());
  assert.equal(result.size, 0);
});

test("a valid hall after a bounded page is still available to publication", async () => {
  const offsets: number[] = [];
  const result = await withMunicipalHallOffices(async (_sql, params) => {
    offsets.push(params![3] as number);
    const invalid = { body_id: source.bodyId, ocd_id: DIVISION, jurisdiction: source.jurisdiction,
      location: { ...source.location, address: "P.O. Box 500, Boise, ID 83702" }, provenance: source.provenance };
    return params![3] === 0 ? Array.from({ length: 64 }, () => invalid)
      : [{ ...invalid, location: source.location }];
  }, [{ ...target, venueGap: undefined }], new Map(), () => assert.fail());
  assert.deepEqual(offsets, [0, 64]);
  assert.equal(result.get(BODY)?.governmentOfficeAlternatives?.[0].address, HALL);
});

test("a board's own address and an explicit government office retain priority over a hall venue", async () => {
  for (const basis of ["BODY_OFFICE", "GOVERNMENT_OFFICE"] as const) {
    const offices = new Map<string, MeetingPinBody>([[BODY, { bodyId: BODY, name: "Council",
      ...(basis === "BODY_OFFICE" ? { officeContact: { address: "150 N. Capitol Blvd, Boise, ID 83702", phone: null, provenance: source.provenance } }
        : { governmentOffice: { name: "City of Boise", address: "150 N. Capitol Blvd, Boise, ID 83702", provenance: source.provenance } }) }]]);
    const result = await placePublishedMeetingPins({ meetings: [{ ...target, venueGap: { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "CITY OF BOISE" } }, source],
      offices, fetchImpl: async () => reply(census) });
    assert.deepEqual(result.held, []);
    assert.equal(result.meetings[0].mapPin?.basis, basis);
    assert.deepEqual(result.meetings[1], source, "Existing meeting location remains visible");
  }
});
