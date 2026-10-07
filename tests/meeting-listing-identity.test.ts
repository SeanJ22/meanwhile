import assert from "node:assert/strict";
import test from "node:test";
import { listingMultiplicityForSource, meetingListingIdentity, type ResolveListingBody } from "../lib/meetings/listing-identity.ts";
import type { Meeting } from "../lib/sources/types.ts";

const resolveBody: ResolveListingBody = (id) => (id?.startsWith("ocd-division/") ? { bodyId: id } : null);
const bodyId = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#conservation-commission";
const sourceId = (id: string) => `ical:newbury-ical-conservation-commission:calendar.${id}.field_date_and_time.0@www.newbury.nh.gov`;
const listing = (id: string): Meeting => ({
  id: sourceId(id), bodyId, ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
  bodyName: "Conservation Commission", title: "Conservation Commission Meeting", startsAt: "2026-11-10T23:00:00.000Z", startPrecision: "MINUTE", timeZone: "America/New_York",
  location: { name: "Newbury Town Office", address: "937 Route 103, Newbury, NH 03255", lat: 43.321682, lng: -72.03705 }, agendaUrl: null, jurisdiction: "Newbury, NH", status: "SCHEDULED",
  provenance: { sourceUrl: `https://www.newbury.nh.gov/conservation-commission/events/${id}`, sourceOrg: "Town of Newbury", collectedAt: "2026-09-04T13:30:22.402Z", verifiedAt: null },
});

test("every differing civic field prevents the exact-equality multiplicity diagnostic", () => {
  const first = listing("43891"), second = listing("42311");
  const mutations: Record<string, (row: Meeting) => void> = {
    body: row => { row.bodyId = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#planning-board"; },
    geography: row => { row.ocdId = "ocd-division/country:us/state:az/county:pima"; },
    bodyName: row => { row.bodyName = "Other held label"; },
    title: row => { row.title = "Executive Session"; },
    time: row => { row.startsAt = "2026-11-10T23:01:00.000Z"; },
    precision: row => { row.startPrecision = "DAY"; },
    zone: row => { row.timeZone = "America/Phoenix"; },
    status: row => { row.status = "CANCELED"; },
    venueName: row => { row.location!.name = "Another room"; },
    venueAddress: row => { row.location!.address = "Another address"; },
    latitude: row => { row.location!.lat += 0.01; },
    longitude: row => { row.location!.lng += 0.01; },
    online: row => { row.location = null; row.online = { label: "Virtual meeting", joinUrl: "https://publisher.example/room" }; },
    agenda: row => { row.agendaUrl = "https://publisher.example/agenda.pdf"; },
    absenceObservation: row => { row.agendaSlotObservedEmpty = true; },
    jurisdiction: row => { row.jurisdiction = "Different sourced geography"; },
    publisher: row => { row.provenance.sourceOrg = "Other authority"; },
    secondHand: row => { row.provenance.secondHand = true; },
    actingBodies: row => { row.actingBodies = []; },
    futureCivicField: row => { Object.assign(row, { publicCommentLimitMinutes: 3 }); },
  };
  for (const [field, mutate] of Object.entries(mutations)) {
    const changed = structuredClone(second); mutate(changed);
    assert.equal(meetingListingIdentity([first, changed], resolveBody).groups.length, 0, field);
  }
});

test("unknown body, invalid time and repeated native IDs stay separate from event multiplicity", () => {
  const first = listing("43891"), second = listing("42311");
  const unknown = meetingListingIdentity([{ ...first, bodyId: undefined }, { ...second, bodyId: "unresolved:body" }], resolveBody);
  assert.equal(unknown.groups.length, 0); assert.deepEqual(unknown.unresolvedBodySourceIds, [first.id, second.id].sort());
  const invalid = meetingListingIdentity([{ ...first, startsAt: "not a date" }, { ...second, startPrecision: "DAY" }], resolveBody);
  assert.equal(invalid.groups.length, 0); assert.deepEqual(invalid.unresolvedTimeSourceIds, [first.id, second.id].sort());
  for (const startsAt of ["2026-11-10", "2026-11-10T23:00:00", "2026-11-10 23:00:00Z"]) {
    const noInstant = meetingListingIdentity([{ ...first, startsAt, startPrecision: undefined }, { ...second, startsAt, startPrecision: undefined }], resolveBody);
    assert.equal(noInstant.groups.length, 0, startsAt);
    assert.deepEqual(noInstant.unresolvedTimeSourceIds, [first.id, second.id].sort(), startsAt);
  }
  const repeated = meetingListingIdentity([first, first, second], resolveBody);
  assert.equal(repeated.recordCount, 3); assert.equal(repeated.sourceListingCount, 2);
  assert.deepEqual(repeated.duplicateNativeIds, [first.id]); assert.equal(repeated.groups.length, 0);
  assert.equal(listingMultiplicityForSource(repeated, first.id), null);
});

test("only read history and equivalent instant spelling may differ; neither grants an attachment", () => {
  const first = listing("43891"), second = listing("42311");
  second.startsAt = "2026-11-10T18:00:00-05:00";
  second.provenance.collectedAt = "2026-09-03T13:30:22.402Z";
  second.provenance.verifiedAt = "2026-09-03";
  const result = meetingListingIdentity([second, first], resolveBody);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result, meetingListingIdentity([first, second], resolveBody), "Order never selects a winning publisher ID");
  assert.equal(listingMultiplicityForSource(result, first.id), result.groups[0]);
  assert.ok(!("agendaUrl" in result.groups[0])); assert.ok(!("outcomes" in result.groups[0]));
  assert.equal(first.agendaUrl, null); assert.equal(second.agendaUrl, null);
});
