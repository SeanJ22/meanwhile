import assert from "node:assert/strict";
import { test } from "node:test";

import { indexAudits, wasLookedAt } from "../lib/registry/audit.ts";
import { COVERAGE_AUDIT_FILE } from "../lib/registry/coverage-audit.ts";
import { linksForMeeting, venueLink } from "../lib/registry/links.ts";
import { FIXTURES } from "../lib/sources/mock/fixtures.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import type { Meeting } from "../lib/sources/types.ts";

/**
 * The link ladder and the coverage audit — 4.6.10 and 4.6.1.
 *
 * The assertions worth having here are the negative ones. It is easy to check
 * that a link renders; what actually protects the product is checking that
 * nothing invents one, and that "we looked and found nothing" cannot be claimed
 * by a body nobody looked at.
 */

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
  // Directions default to Google Maps (author's 2a, 2026-08-14) via the
  // documented universal link, which opens the native app on both platforms.
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
  // A body with no hunted URLs must not produce a body rung. This is the
  // guard against the tempting "just build one from the jurisdiction name".
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

test("every audit row points at a body that exists", () => {
  const ids = new Set(registry.bodies.map((b) => b.id));
  for (const audit of COVERAGE_AUDIT_FILE.audits) {
    assert.ok(ids.has(audit.bodyId), `audit for unknown body ${audit.bodyId}`);
  }
});

test("every URL recorded in the audit is http(s) and absolute", () => {
  for (const audit of COVERAGE_AUDIT_FILE.audits) {
    const urls = [
      audit.homepageUrl,
      audit.agendaSourceRef,
      ...audit.rungs.map((r) => r.url),
    ].filter((u): u is string => u !== null);
    for (const url of urls) {
      assert.doesNotThrow(() => new URL(url), `unparseable ${url}`);
      assert.match(url, /^https?:\/\//, `not absolute http(s): ${url}`);
    }
  }
});

test("NO_SOURCE_FOUND is never claimed for a body nobody looked at", () => {
  const audits = indexAudits(COVERAGE_AUDIT_FILE);
  for (const body of registry.bodies) {
    if (body.coverageStatus === "NO_SOURCE_FOUND") {
      assert.ok(
        wasLookedAt(audits, body.id),
        `${body.id} claims an exhausted search with no audit row`,
      );
    }
  }
});

test("a body with no audit row is NOT_ATTEMPTED, and that is most of them", () => {
  const audits = indexAudits(COVERAGE_AUDIT_FILE);
  // Derived rows only: a curated row (D28/D29) carries its status from the
  // curation itself, whose citation lives on the row's own provenance.
  const unaudited = registry.bodies.filter(
    (b) => !audits.has(b.id) && b.bodyOrigin === "DERIVED_FROM_DIVISION_TYPE",
  );
  assert.ok(unaudited.length > 0);
  for (const body of unaudited) {
    assert.equal(
      body.coverageStatus,
      "NOT_ATTEMPTED",
      `${body.id} has no audit row but claims ${body.coverageStatus}`,
    );
    // The corollary: an unaudited body cannot have a homepage either, because
    // the only thing that populates one is a hunt.
    assert.equal(body.homepageUrl, null);
  }
});

test("every audited body carries the status and URLs its audit recorded", () => {
  const byId = new Map(registry.bodies.map((b) => [b.id, b]));
  for (const audit of COVERAGE_AUDIT_FILE.audits) {
    const body = byId.get(audit.bodyId)!;
    assert.equal(body.coverageStatus, audit.coverageStatus, audit.bodyId);
    assert.equal(body.homepageUrl, audit.homepageUrl, audit.bodyId);
    assert.equal(body.agendaSourceRef, audit.agendaSourceRef, audit.bodyId);
    assert.equal(body.agendaSourceType, audit.agendaSourceType, audit.bodyId);
  }
});

test("no body carries a terminal blocked state", () => {
  // SOURCE_BLOCKED was removed from CoverageStatus 2026-08-13 under the
  // public-records constraint: a closed route is recorded on its audit rung
  // (BLOCKED_TERMS / BLOCKED_ROBOTS) and the next rung is attempted — the
  // body itself is never marked blocked. This pins the generated data to the
  // same rule the type now enforces at compile time, because registry.json is
  // a committed artifact that could carry a stale value the compiler never
  // sees.
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

test("the Vail correction is recorded, not silently dropped", () => {
  // The dead BoardDocs URL must stay in the audit as a MISS. Deleting it would
  // let the next session rediscover it from the same search result and record
  // it as fact — the miss is the finding.
  const vail = COVERAGE_AUDIT_FILE.audits.find((a) => a.bodyId.includes("vail"))!;
  const boarddocs = vail.rungs.find((r) => r.url?.includes("boarddocs"));
  assert.ok(boarddocs, "the refuted BoardDocs URL should remain on the record");
  assert.equal(boarddocs.outcome, "MISS");
  // The second Vail correction (2026-08-13): the NovusAgenda tenant answered
  // 200 with zero meetings in any window — it is the pre-2017 archive. It
  // stays on the record as a MISS the same way BoardDocs does, and the wired
  // source is the district's own events API.
  const novus = vail.rungs.find((r) => r.url?.includes("novusagenda"));
  assert.ok(novus, "the empty NovusAgenda tenant should remain on the record");
  assert.equal(novus.outcome, "MISS");
  assert.equal(vail.agendaSourceType, "APPTEGY");
});

test("every mock meeting's division resolves to a registry division", () => {
  // THE SILENT ZERO-MATCH GUARD, and it is here because this join was broken
  // the whole time and nothing said so. The fixtures carried flat identifiers
  // — `state:nh/place:newbury` — while the registry nests New Hampshire and
  // New Jersey subdivisions under their county and suffixes the type:
  // `state:nh/county:merrimack/place:newbury_town`. Tucson and the three
  // counties happened to match, so the popup looked fine in Arizona and simply
  // had no body link in Newbury or Rockaway, with no error anywhere.
  //
  // Asserts the COUNT AND THE DENOMINATOR rather than "some matched", because a
  // partial match is exactly what this looked like from the outside.
  // Cochise County and its municipalities are deliberately outside the
  // three-county boundary clip — they exist to push 85641 onto a wider rung of
  // the radius ladder — so having no registry division is correct for them and
  // is not the bug above. Naming them explicitly keeps a clip from ever reading
  // as a broken join, and a broken join from hiding behind "probably the clip".
  const OUTSIDE_THE_CLIP = new Set([
    "ocd-division/country:us/state:az/county:cochise",
    "ocd-division/country:us/state:az/place:douglas",
    "ocd-division/country:us/state:az/place:sierra_vista",
  ]);

  const divisions = new Set(registry.divisions.map((d) => d.ocdId));
  const fixtureIds = [...new Set(FIXTURES.map((f) => f.DivisionOcdId))];
  const inClip = fixtureIds.filter((id) => !OUTSIDE_THE_CLIP.has(id));
  const unmatched = inClip.filter((id) => !divisions.has(id));

  assert.deepEqual(
    unmatched,
    [],
    `${unmatched.length} of ${inClip.length} in-clip fixture divisions match nothing in the registry`,
  );
  // The denominator, asserted rather than assumed: if the fixture set shrinks,
  // "0 unmatched" would otherwise stay green while covering nothing.
  assert.equal(inClip.length, 11, "in-clip fixture divisions");
  assert.ok(fixtureIds.length >= 10, "the fixture set should span all four zips");
});
