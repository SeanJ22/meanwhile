import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAMBER_TITLE,
  designationFromLabel,
  designationKey,
  indexDivisions,
  normalize,
  parseCsv,
  rowsToPeople,
  type PluralPerson,
} from "../lib/sources/plural/index.ts";
import { coverageAt } from "../lib/registry/server.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/**
 * State legislators, and the reconciliation that makes them attachable.
 *
 * The interesting failure is New Hampshire. Plural designates House districts
 * "Merrimack 8"; this repo's identifiers are Census numeric codes (`sldl:608`).
 * A direct join scores **0 of 201** and does so silently — the same shape as
 * the at-large trap in the federal roster, and the reason both are pinned here.
 */

const DIVISIONS = (
  registry as { divisions: { ocdId: string; label: string; divisionType: string }[] }
).divisions;

test("designation normalization survives zero-padding", () => {
  assert.equal(designationKey("Merrimack 08"), designationKey("Merrimack 8"));
  assert.equal(designationKey("  merrimack   8 "), "MERRIMACK 8");
  assert.equal(designationKey("19"), "19");
});

test("the registry label yields the designation Plural publishes", () => {
  assert.equal(designationFromLabel("State House District Merrimack 08"), "MERRIMACK 8");
  assert.equal(designationFromLabel("State Senate District 19"), "19");
  assert.equal(designationFromLabel("Assembly District 25"), "25");
});

test("New Hampshire House districts index by designation, not by number", () => {
  const index = indexDivisions(DIVISIONS);

  // sldl:608 is labelled "State House District Merrimack 08". A join on the
  // identifier's digits would look for 608 and find nothing.
  const ocdId = index.get("nh|lower|MERRIMACK 8");
  assert.ok(ocdId, "NH Merrimack 8 must resolve");
  assert.match(ocdId, /state:nh\/sldl:/);
});

test("New Jersey's lower chamber members are Assemblymembers", () => {
  // Not derivable and not guessable. Calling them Representatives would be a
  // small fabrication rendered to a reader.
  assert.equal(CHAMBER_TITLE.nj.lower, "Assemblymember");
  assert.equal(CHAMBER_TITLE.az.lower, "State Representative");
});

test("a state with no chamber-title entry reports rather than inventing one", () => {
  const set = normalize(
    [person({ id: "ocd-person/x", state: "tx", current_district: "1" })],
    new Map(),
    "2026-08-12T00:00:00.000Z",
    "48",
  );

  assert.equal(set.officeholders.length, 0);
  assert.match(set.unmatched[0].reason, /no chamber title/);
});

test("a district outside the clipped coverage is reported, not dropped silently", () => {
  const index = indexDivisions(DIVISIONS);
  const set = normalize(
    [person({ id: "ocd-person/y", state: "az", current_district: "2" })],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  // The person is still a real legislator and is kept; only the link is absent.
  assert.equal(set.officeholders.length, 1);
  assert.equal(set.divisions.length, 0);
  assert.equal(set.unmatched.length, 1);
  assert.match(set.unmatched[0].reason, /outside the clipped boundary coverage/);
});

test("CSV parsing handles quoted fields with embedded commas", () => {
  const rows = parseCsv('id,name\n1,"Last, First"\n2,Plain\n');
  assert.deepEqual(rows[1], ["1", "Last, First"]);
  assert.deepEqual(rows[2], ["2", "Plain"]);
});

test("rows without an id are skipped", () => {
  const people = rowsToPeople(
    "id,name,current_party,current_district,current_chamber,email,image,links,sources\n" +
      ",Nobody,,,,,,,\n" +
      "ocd-person/a,Real Person,Democratic,19,upper,,,,\n",
    "az",
  );
  assert.equal(people.length, 1);
  assert.equal(people[0].name, "Real Person");
});

test("provenance names the bulk file the row was read from", () => {
  const index = indexDivisions(DIVISIONS);
  const set = normalize(
    [person({ id: "ocd-person/z", state: "az", current_district: "19" })],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  assert.equal(
    set.officeholders[0].provenance.sourceUrl,
    "https://data.openstates.org/people/current/az.csv",
  );
  assert.equal(set.officeholders[0].provenance.verifiedAt, null);
});

test("no Plural photo is shipped — the URL is a hotlink of unknown licence", () => {
  const index = indexDivisions(DIVISIONS);
  const set = normalize(
    [
      person({
        id: "ocd-person/p",
        state: "az",
        current_district: "19",
        image: "https://example.invalid/face.jpg",
      }),
    ],
    index,
    "2026-08-12T00:00:00.000Z",
    "04",
  );

  assert.equal(set.officeholders[0].photo, null);
});

test("an Arizona legislative district returns one senator and two representatives", async () => {
  // The many-to-many case the brief says breaks a one-district-per-seat column,
  // now visible in real data rather than argued from the statute.
  const coverage = await coverageAt(32.04903, -110.62291, 0);

  const house = coverage.seats.find((s) => s.divisionType === "sldl");
  const senate = coverage.seats.find((s) => s.divisionType === "sldu");

  assert.equal(house?.representatives.length, 2, "AZ elects two per LD");
  assert.equal(senate?.representatives.length, 1);
});

test("all four target-zip seat types are now named", async () => {
  for (const [lat, lng] of [
    [32.04903, -110.62291],
    [40.91, -74.51],
    [43.32, -72.03],
  ]) {
    const coverage = await coverageAt(lat, lng, 0);
    assert.equal(
      coverage.seatCounts.named,
      coverage.seatCounts.total,
      "every seat at this point should now have someone",
    );
    for (const seat of coverage.seats) {
      for (const holder of seat.representatives) {
        assert.ok(holder.sourceUrl, `${holder.name} would render without a source`);
      }
    }
  }
});

function person(overrides: Partial<PluralPerson>): PluralPerson {
  return {
    id: "ocd-person/test",
    name: "Test Person",
    current_party: "Independent",
    current_district: "19",
    current_chamber: "lower",
    email: "",
    image: "",
    links: "",
    sources: "",
    state: "az",
    ...overrides,
  };
}
