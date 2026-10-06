import assert from "node:assert/strict";
import test from "node:test";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

import {
  BOUNDARY_PROVENANCE,
  districtCardSources,
  meetingCardSources,
  mergeSources,
  personCardSources,
  sourceCountLabel,
} from "../lib/officials/card-sources.ts";
import { governingRosterHoldersForDivision } from "../lib/registry/body-rosters.ts";
import { statewideExecutivesFor } from "../lib/officials/statewide-executives.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * The false-sentence guard (item 1, 2026-08-16).
 *
 * What shipped to production: the battlecard Sources tab said "Nothing on
 * this card came from an external record" on the Tucson Unified District
 * card, whose boundary is Census TIGER/Line, whose governing board is the
 * district's own roster page, and whose sittings come off the district's own
 * agenda vendor. Every fact on that card came from an external record. The
 * sentence was false, live, on a product whose entire claim is sourced
 * accuracy.
 *
 * The cause was a single hardcoded `sources: []` — the tab had never been
 * wired to the provenance the rows underneath were already carrying. So this
 * file holds two invariants, per the brief:
 *
 *   1. **Per card class, the stated source count equals the rendered rows.**
 *      Both come from the same array, and this proves it stays that way.
 *   2. **The empty sentence and a populated card can never coexist.** A card
 *      holding any externally sourced fact returns at least one source, so
 *      the honest-empty branch is unreachable from a populated card.
 *
 * The district case is asserted against the COMMITTED roster — the real
 * store, not a fixture — because the defect was a real district card and a
 * fixture-only test would have passed on the broken code too.
 */

const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";

function meetingFixture(id: string, org: string, url: string | null): Meeting {
  return {
    id,
    title: `Sitting ${id}`,
    bodyName: "Governing Board",
    jurisdiction: "Tucson Unified School District",
    ocdId: TUSD,
    startsAt: "2026-09-01T18:00:00.000Z",
    endsAt: null,
    timeZone: "America/Phoenix",
    status: "SCHEDULED",
    location: {
      name: "1010 E Tenth St",
      address: "1010 E Tenth St, Tucson AZ",
      lat: 32.21,
      lng: -110.95,
    },
    agendaUrl: null,
    provenance: {
      sourceUrl: url,
      sourceOrg: org,
      collectedAt: "2026-08-16",
      verifiedAt: null,
    },
  } as Meeting;
}

test("the committed Tucson Unified roster resolves — the card under the defect", () => {
  const roster = governingRosterHoldersForDivision(TUSD);
  assert.ok(
    roster.length > 0,
    "the district whose Sources tab was false must still hold a roster; " +
      "without one this test proves nothing about the defect",
  );
  for (const holder of roster) {
    assert.ok(
      holder.provenance,
      `${holder.name} must carry the roster page's publisher and read date`,
    );
  }
});

test("a district card with a roster and meetings is never sourceless", () => {
  const roster = governingRosterHoldersForDivision(TUSD);
  const meetings = [
    meetingFixture("m1", "Tucson Unified School District", "https://tusd1.org/a"),
    meetingFixture("m2", "Tucson Unified School District", "https://tusd1.org/a"),
  ];

  const sources = districtCardSources(roster, meetings);

  assert.ok(
    sources.length > 0,
    "THE DEFECT: this returned an empty array on production and the tab " +
      "rendered 'Nothing on this card came from an external record'",
  );
  assert.equal(
    sourceCountLabel(sources),
    String(sources.length),
    "the stated N must be the rendered row count, not a second derivation",
  );
});

test("a district card with NO roster and NO meetings still cites its boundary", () => {
  // The boundary is what makes the card exist at all, and it has a publisher.
  // This is the closest a district card gets to honestly empty, and it is
  // still not empty.
  const sources = districtCardSources([], []);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].provenance.sourceOrg, BOUNDARY_PROVENANCE.sourceOrg);
});

test("a meeting card lists the sitting and the body's roster", () => {
  const roster = governingRosterHoldersForDivision(TUSD);
  const sources = meetingCardSources(
    meetingFixture("m1", "Tucson Unified School District", "https://tusd1.org/a"),
    roster,
  );
  assert.ok(sources.length > 0);
  assert.equal(sourceCountLabel(sources), String(sources.length));
});

test("a person card cites the record its identity came from", () => {
  const governors = statewideExecutivesFor([
    "ocd-division/country:us/state:az/county:pima",
  ]);
  assert.ok(governors.length > 0, "AZ must resolve a governor");

  for (const holder of governors) {
    const sources = personCardSources(holder);
    assert.ok(
      sources.length > 0,
      `${holder.name}'s card must name where the record was read from`,
    );
    assert.equal(sourceCountLabel(sources), String(sources.length));
    assert.ok(
      sources[0].provenance.sourceOrg.length > 0,
      "a publisher, not just a URL",
    );
  }
});

test("same-source rows merge, and the merged row states the count", () => {
  const provenance = {
    sourceUrl: "https://example.gov/calendar",
    sourceOrg: "Example Town Clerk",
    collectedAt: "2026-08-16",
    verifiedAt: null,
  };
  const merged = mergeSources([
    { what: "One", provenance },
    { what: "Two", provenance },
    { what: "Three", provenance },
  ]);

  assert.equal(merged.length, 1, "one publisher and page is one source row");
  assert.match(
    merged[0].what,
    /2 more from this source/,
    "a merged row states how many facts it is behind — a count with its " +
      "denominator, never a silent collapse",
  );
});

test("distinct publishers never merge", () => {
  const merged = mergeSources([
    {
      what: "A",
      provenance: {
        sourceUrl: "https://a.gov/x",
        sourceOrg: "A",
        collectedAt: "2026-08-16",
        verifiedAt: null,
      },
    },
    {
      what: "B",
      provenance: {
        sourceUrl: "https://b.gov/x",
        sourceOrg: "B",
        collectedAt: "2026-08-16",
        verifiedAt: null,
      },
    },
  ]);
  assert.equal(merged.length, 2);
});

test("a holder with no record at all contributes no row, and says so by absence", () => {
  const bare: SeatHolder = {
    id: "test:nobody",
    name: "Nobody",
    officeTitle: "Test Seat",
    partyLabel: null,
    termEnd: null,
    birthDate: null,
    websiteUrl: null,
    sourceUrl: null,
    provenance: null,
    email: null,
    phone: null,
    contactFormUrl: null,
    photoUrl: null,
    campaignUrl: null,
  };
  assert.equal(personCardSources(bare).length, 0);
  assert.equal(sourceCountLabel([]), null, "no count is stated when there is none");
});

test("shared meeting card retains agenda, minutes, decisions and comment sources with their exact read dates", () => {
  const meeting = meetingFixture("shared", "Calendar publisher", "https://calendar.gov/sitting");
  const agendas = { ...meeting.provenance, sourceUrl: "https://agenda.gov/document", collectedAt: "2026-10-01" };
  const minutes = { ...meeting.provenance, sourceUrl: "https://minutes.gov/document", collectedAt: "2026-10-02" };
  const records = { ...meeting.provenance, sourceUrl: "https://records.gov/outcomes", collectedAt: "2026-10-03" };
  const commentAccess = { ...meeting.provenance, sourceUrl: "https://comment.gov/rules", collectedAt: "2026-10-04" };
  const sources = meetingCardSources(meeting, [], { agendas: [agendas], minutes: [minutes], records: [records], commentAccess: [commentAccess] });
  for (const provenance of [agendas, minutes, records, commentAccess]) assert.deepEqual(sources.find(row => row.provenance.sourceUrl === provenance.sourceUrl)?.provenance, provenance);
  assert.equal(sourceCountLabel(sources), String(sources.length));
});

test("carried sitting metadata cannot disappear into its calendar's ordinary source row", () => {
  const meeting = meetingFixture("carried:one", "Example Clerk", "https://clerk.example.gov/calendar");
  meeting.carried = { source: "calendar", lastFreshAt: "2026-09-30", reason: "UNEXPLAINED_DISAPPEARANCE" };
  const sources = meetingCardSources(meeting, []);
  const carried = sources.find(row => row.dataAttrs?.["data-meeting-carried-source"] === meeting.id);
  assert.ok(carried);
  assert.equal(carried.provenance.collectedAt, meeting.carried.lastFreshAt);
  assert.match(carried.what, /latest check of this calendar didn't find this listing/);
  assert.doesNotMatch(carried.what, /couldn't reach/);
  assert.equal(sourceCountLabel(sources), String(sources.length));
});
