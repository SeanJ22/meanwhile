import assert from "node:assert/strict";
import { test } from "node:test";

import {
  indexByDivision,
  holdersFor,
  senatorsFor,
  stateOcdIdFrom,
} from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { coverageAt } from "../lib/registry/server.ts";
import roster from "../lib/registry/officeholders-us.json" with { type: "json" };

/**
 * Putting names on screen, and the one thing that must not happen: a name
 * rendered where there is no record, or a footnote claiming nothing is sourced
 * beside a name that is.
 */

const VAIL: [number, number] = [32.04903, -110.62291];
const TUCSON: [number, number] = [32.22174, -110.97133];
const ROCKAWAY: [number, number] = [40.91, -74.51];

test("state identifier is read from the hierarchy, not from a name", () => {
  assert.equal(
    stateOcdIdFrom("ocd-division/country:us/state:az/cd:6"),
    "ocd-division/country:us/state:az",
  );
  assert.equal(
    stateOcdIdFrom("ocd-division/country:us/state:nh/county:merrimack/place:newbury"),
    "ocd-division/country:us/state:nh",
  );
  assert.equal(stateOcdIdFrom("ocd-division/country:us"), null);
});

test("a division electing several people keeps all of them", () => {
  const set: OfficeholderSet = {
    scope: "test",
    generatedAt: "2026-08-12T00:00:00.000Z",
    officeholders: [
      person("a", "Zoe Adams"),
      person("b", "Alex Brown"),
    ],
    divisions: [
      { officeholderId: "a", ocdId: "ocd-division/country:us/state:az", bodyId: null },
      { officeholderId: "b", ocdId: "ocd-division/country:us/state:az", bodyId: null },
    ],
    unmatched: [],
  };

  const index = indexByDivision([set]);
  const holders = holdersFor(index, "ocd-division/country:us/state:az");

  assert.equal(holders.length, 2);
  // Alphabetical, deliberately: any data-derived order is an order the reader
  // could read meaning into, and CLAUDE.md forbids ordering by fit.
  assert.deepEqual(holders.map((h) => h.name), ["Alex Brown", "Zoe Adams"]);
});

test("a link pointing at no person is skipped, never rendered blank", () => {
  const set: OfficeholderSet = {
    scope: "test",
    generatedAt: "2026-08-12T00:00:00.000Z",
    officeholders: [],
    divisions: [
      { officeholderId: "ghost", ocdId: "ocd-division/country:us/state:az", bodyId: null },
    ],
    unmatched: [],
  };

  assert.equal(holdersFor(indexByDivision([set]), "ocd-division/country:us/state:az").length, 0);
});

test("senators are found from the state prefix of a local division", () => {
  const index = indexByDivision([roster as unknown as OfficeholderSet]);
  const senators = senatorsFor(index, [
    "ocd-division/country:us/state:az/county:pima",
  ]);

  assert.equal(senators.length, 2, "Arizona elects two senators");
  assert.ok(senators.every((s) => s.officeTitle === "U.S. Senator"));
});

test("senators are not duplicated when several divisions share a state", () => {
  const index = indexByDivision([roster as unknown as OfficeholderSet]);
  const senators = senatorsFor(index, [
    "ocd-division/country:us/state:az/county:pima",
    "ocd-division/country:us/state:az/cd:6",
    "ocd-division/country:us/state:az/sldl:19",
  ]);

  assert.equal(senators.length, 2);
});

test("85641 now names its representative, which it could not before", async () => {
  // The sentence this replaces: "We haven't sourced their names or meeting
  // schedules yet", rendered under AZ-6.
  const coverage = await coverageAt(VAIL[0], VAIL[1], 0);
  const az6 = coverage.seats.find((s) => s.label === "AZ-6");

  assert.ok(az6, "85641 must resolve AZ-6");
  assert.equal(az6.representatives.length, 1);
  assert.ok(az6.representatives[0].name.length > 0);
  assert.ok(
    az6.representatives[0].sourceUrl?.startsWith("https://"),
    "a rendered name must carry the record it came from",
  );
  assert.equal(coverage.senators.length, 2);
});

test("state legislative seats report no record rather than a name", async () => {
  // Until Plural Open lands (D03). An empty list means we have no record — it
  // must never be read, or rendered, as the seat being vacant.
  const coverage = await coverageAt(VAIL[0], VAIL[1], 0);
  const legislative = coverage.seats.filter((s) => s.divisionType !== "cd");

  assert.ok(legislative.length > 0);
  assert.ok(legislative.every((s) => s.representatives.length === 0));
});

test("the footnote can tell a partly-sourced point from an unsourced one", async () => {
  const coverage = await coverageAt(VAIL[0], VAIL[1], 0);

  // Exactly the condition the copy switches on: some seats named, not all.
  assert.ok(coverage.seatCounts.named > 0);
  assert.ok(coverage.seatCounts.named < coverage.seatCounts.total);
});

test("every rendered name carries a source, at all four kinds of point", async () => {
  for (const point of [VAIL, TUCSON, ROCKAWAY]) {
    const coverage = await coverageAt(point[0], point[1], 0);
    const named = [
      ...coverage.seats.flatMap((s) => s.representatives),
      ...coverage.senators,
    ];

    assert.ok(named.length > 0, "expected at least the federal delegation");
    for (const holder of named) {
      assert.ok(
        holder.sourceUrl,
        `${holder.name} would render without a source record`,
      );
    }
  }
});

test("coverage still answers when no roster is loaded at all", () => {
  // The degrade path: a missing roster must cost the names, not the answer.
  const index = indexByDivision([]);
  assert.equal(holdersFor(index, "ocd-division/country:us/state:az/cd:6").length, 0);
  assert.equal(senatorsFor(index, ["ocd-division/country:us/state:az"]).length, 0);
});

function person(id: string, name: string) {
  return {
    id,
    name,
    officeTitle: "U.S. Senator",
    level: "FEDERAL" as const,
    termStart: "2025-01-03",
    termEnd: "2031-01-03",
    partyLabel: null,
    websiteUrl: null,
    contactFormUrl: null,
    phone: null,
    photo: null,
    provenance: {
      sourceUrl: "https://example.invalid/roster",
      sourceOrg: "test",
      collectedAt: "2026-08-12T00:00:00.000Z",
      verifiedAt: null,
    },
  };
}
