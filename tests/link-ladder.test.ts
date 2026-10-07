import assert from "node:assert/strict";
import { test } from "node:test";

import { linksForMeeting, venueLink } from "../lib/registry/links.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import type { Meeting } from "../lib/sources/types.ts";

const BASE: Meeting = {
  id: "test:1",
  ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
  bodyName: "Select Board",
  title: "Regular Meeting",
  startsAt: "2026-08-14T18:00:00-04:00",
  timeZone: "America/New_York",
  location: {
    name: "Newbury Town Office, Meeting Room",
    address: "937 Route 103, Newbury, NH 03255",
    lat: 43.322,
    lng: -72.038,
  },
  agendaUrl: null,
  jurisdiction: "Newbury, NH",
  status: "SCHEDULED",
  provenance: {
    sourceUrl: null,
    sourceOrg: "Town of Newbury Clerk",
    collectedAt: "2026-08-12T00:00:00Z",
    verifiedAt: null,
  },
};

test("a meeting with no URLs and no body still offers directions, and nothing else", () => {
  const links = linksForMeeting(BASE, null);
  assert.deepEqual(
    links.map((l) => l.rung),
    ["VENUE_MAP"],
  );
  // The one rung that exists is derived, so it can never be read as a citation.
  assert.equal(links[0].kind, "DERIVED");
  // Directions use the Google Maps universal link, which opens the native app on both platforms.
  assert.ok(
    links[0].url.startsWith("https://www.google.com/maps/dir/?api=1"),
    `directions should be a Google Maps universal link, got ${links[0].url}`,
  );
});

test("the ladder never constructs a link it was not given", () => {
  const links = linksForMeeting(BASE, {
    divisionLabel: "Newbury town",
    homepageUrl: null,
    agendaSourceRef: null,
  });
  assert.ok(!links.some((l) => l.rung === "BODY_HOMEPAGE"));
  assert.ok(!links.some((l) => l.rung === "AGENDA_PORTAL"));
});

test("rungs come back in ladder order, agenda first", () => {
  const links = linksForMeeting(
    {
      ...BASE,
      agendaUrl: "https://example.gov/agenda.pdf",
      provenance: { ...BASE.provenance, sourceUrl: "https://example.gov/meeting/1" },
    },
    {
      divisionLabel: "Newbury town",
      homepageUrl: "https://www.newbury.nh.gov/",
      agendaSourceRef: "https://newburynh.civicweb.net/Portal/MeetingTypeList.aspx",
    },
  );
  assert.deepEqual(
    links.map((l) => l.rung),
    ["AGENDA", "MEETING_RECORD", "AGENDA_PORTAL", "BODY_HOMEPAGE", "VENUE_MAP"],
  );
  // Everything but the map link is sourced.
  assert.equal(links.filter((l) => l.kind === "SOURCED").length, 4);
});

test("the meeting record rung is dropped when it duplicates the agenda", () => {
  const url = "https://example.gov/agenda.pdf";
  const links = linksForMeeting(
    { ...BASE, agendaUrl: url, provenance: { ...BASE.provenance, sourceUrl: url } },
    null,
  );
  assert.equal(links.filter((l) => l.url === url).length, 1);
});

test("a non-http URL never reaches an href", () => {
  const links = linksForMeeting(
    { ...BASE, agendaUrl: "javascript:alert(1)" },
    { divisionLabel: "x", homepageUrl: "mailto:clerk@example.gov", agendaSourceRef: null },
  );
  assert.ok(links.every((l) => /^https?:/.test(l.url)));
});

test("the body homepage rung is labelled with the division, never a minted body name", () => {
  const links = linksForMeeting(BASE, {
    divisionLabel: "Newbury town",
    homepageUrl: "https://www.newbury.nh.gov/",
    agendaSourceRef: null,
  });
  const home = links.find((l) => l.rung === "BODY_HOMEPAGE")!;
  assert.equal(home.label, "Newbury town");
  // Body.name is null on every registry row; nothing may render a board's name.
  assert.ok(!/board|council|supervisors|commission/i.test(home.label));
});

test("a venue with no usable coordinates produces no map link", () => {
  assert.equal(venueLink({ ...BASE.location!, lat: NaN, lng: -72 }), null);
});

test("no body carries a terminal blocked state", () => {
  // registry.json is a committed artifact, so it could carry a status the type no longer allows.
  const valid = new Set([
    "LIVE",
    "MANUAL",
    "KNOWN_UNCOVERED",
    "NO_SOURCE_FOUND",
    "NOT_ATTEMPTED",
  ]);
  for (const body of registry.bodies) {
    assert.ok(
      valid.has(body.coverageStatus),
      `${body.id} carries ${body.coverageStatus}`,
    );
  }
});
