import assert from "node:assert/strict";
import { test } from "node:test";

import {
  indexByDivision,
  holdersFor,
  senatorsFor,
  stateOcdIdFrom,
} from "../lib/officials/lookup.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

const ROSTER: OfficeholderSet = {
  scope: "test",
  generatedAt: "2026-08-12T00:00:00.000Z",
  officeholders: [person("s1", "Pat Senator"), person("s2", "Lee Senator")],
  divisions: [
    { officeholderId: "s1", ocdId: "ocd-division/country:us/state:az", bodyId: null },
    { officeholderId: "s2", ocdId: "ocd-division/country:us/state:az", bodyId: null },
  ],
  unmatched: [],
};

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
  const index = indexByDivision([ROSTER]);
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
  // Alphabetical, deliberately: a data-derived order implies a meaning to the reader.
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
  const index = indexByDivision([ROSTER]);
  const senators = senatorsFor(index, [
    "ocd-division/country:us/state:az/county:pima",
  ]);

  assert.equal(senators.length, 2, "Arizona elects two senators");
  assert.ok(senators.every((s) => s.officeTitle === "U.S. Senator"));
});

test("senators are not duplicated when several divisions share a state", () => {
  const index = indexByDivision([ROSTER]);
  const senators = senatorsFor(index, [
    "ocd-division/country:us/state:az/county:pima",
    "ocd-division/country:us/state:az/cd:6",
    "ocd-division/country:us/state:az/sldl:19",
  ]);

  assert.equal(senators.length, 2);
});

test("state senators, governors and territorial delegates never become U.S. Senators", () => {
  const others = ["State Senator", "Governor", "U.S. Delegate"].map((officeTitle, index) => ({
    ...person(`other-${index}`, `Other official ${index}`), officeTitle, chamber: "senate",
  }));
  const roster: OfficeholderSet = { ...ROSTER, officeholders: [...ROSTER.officeholders, ...others],
    divisions: [...ROSTER.divisions, ...others.map(holder => ({ officeholderId: holder.id,
      ocdId: "ocd-division/country:us/state:az", bodyId: null }))] };
  assert.deepEqual(senatorsFor(indexByDivision([roster]), ["ocd-division/country:us/state:az"]).map(holder => holder.id).sort(), ["s1", "s2"]);
});

test("a seat with no record resolves to an empty list, never a placeholder", () => {
  // Nobody indexed means "no record yet", never "vacant".
  const index = indexByDivision([]);
  assert.deepEqual(holdersFor(index, "ocd-division/country:us/state:az/sldl:19"), []);
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
