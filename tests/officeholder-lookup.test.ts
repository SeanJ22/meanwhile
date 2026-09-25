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

test("DC and the territories are roots of the hierarchy too, as lib/ocd/fips.ts mints them (2026-09-25)", () => {
  assert.equal(
    stateOcdIdFrom("ocd-division/country:us/district:dc/place:washington"),
    "ocd-division/country:us/district:dc",
  );
  assert.equal(
    stateOcdIdFrom("ocd-division/country:us/territory:pr/county:adjuntas"),
    "ocd-division/country:us/territory:pr",
  );
  assert.equal(stateOcdIdFrom("ocd-division/country:us/territory:gu"), "ocd-division/country:us/territory:gu");
  assert.equal(stateOcdIdFrom("ocd-division/country:us/territory:az"), null, "only the class the FIPS table gives");
  // No senator sits on a territory's root, so a division there answers with nobody, never another state's.
  const index = indexByDivision([roster as unknown as OfficeholderSet]);
  assert.deepEqual(senatorsFor(index, ["ocd-division/country:us/territory:pr/county:adjuntas"]), []);
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

test("a seat with no record resolves to an empty list, never a placeholder", () => {
  // This used to assert that state legislative seats were unnamed, which was
  // true until Plural landed and then failed — it pinned a moment rather than
  // the mechanism. What must hold forever is that a division nobody is indexed
  // against yields nothing, so the UI can say "no record yet" rather than
  // "vacant". Those are different claims and only one is ours to make.
  const index = indexByDivision([]);
  assert.deepEqual(holdersFor(index, "ocd-division/country:us/state:az/sldl:19"), []);
});

test("seatCounts.named counts exactly the seats that have someone", async () => {
  // The condition the footnote switches on. Asserting the invariant rather
  // than a particular coverage level, so improving coverage does not fail it.
  const coverage = await coverageAt(VAIL[0], VAIL[1], 0);

  const actuallyNamed = coverage.seats.filter(
    (s) => s.representatives.length > 0,
  ).length;

  assert.equal(coverage.seatCounts.named, actuallyNamed);
  assert.equal(coverage.seatCounts.total, coverage.seats.length);
  assert.ok(coverage.seatCounts.named <= coverage.seatCounts.total);
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
    birthDate: null,
    partyLabel: null,
    websiteUrl: null,
    contactFormUrl: null,
    phone: null,
    email: null,
    campaignUrl: null,
    photo: null,
    provenance: {
      sourceUrl: "https://example.invalid/roster",
      sourceOrg: "test",
      collectedAt: "2026-08-12T00:00:00.000Z",
      verifiedAt: null,
    },
  };
}
