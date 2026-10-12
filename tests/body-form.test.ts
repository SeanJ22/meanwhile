import assert from "node:assert/strict";
import test from "node:test";

import { classKeyFor } from "../lib/officials/body-definitions.ts";
import { formFor, stateOf } from "../lib/officials/body-form.ts";

/** LSAD 43 is the town suffix and LSAD 44 is township. */
test("forms: LSAD 44 is a township and LSAD 43 is not", () => {
  assert.equal(classKeyFor({ divisionType: "place", lsad: "44" }), "township");
  assert.equal(classKeyFor({ divisionType: "place", lsad: "43" }), "municipality");
  assert.equal(classKeyFor({ divisionType: "place", lsad: "21" }), "municipality");
  assert.equal(classKeyFor({ divisionType: "place", lsad: "25" }), "municipality");
});

test("forms: the eleven New Jersey Towns are stamped as Towns, not townships", () => {
  /* By OCD-ID, never by name string. */
  for (const slug of ["morristown", "kearny", "newton", "boonton", "westfield"]) {
    const stamp = formFor({
      ocdId: `ocd-division/country:us/state:nj/place:${slug}`,
      divisionType: "place",
      lsad: "43",
    });
    assert.equal(stamp.formKey, "nj:town", `${slug} is stamped ${stamp.formKey}`);
    assert.equal(stamp.label, "a New Jersey Town");
    assert.equal(stamp.basis, "tiger-lsad");
  }
});

test("forms: a New Jersey township and a New Hampshire town are DIFFERENT forms", () => {
  const njTownship = formFor({
    ocdId: "ocd-division/country:us/state:nj/county:sussex/place:frankford_township",
    divisionType: "place",
    lsad: "44",
  });
  const nhTown = formFor({
    ocdId: "ocd-division/country:us/state:nh/county:strafford/place:madbury_town",
    divisionType: "place",
    lsad: "43",
  });
  assert.equal(njTownship.formKey, "nj:township");
  assert.equal(nhTown.formKey, "nh:town");
  assert.notEqual(njTownship.formKey, nhTown.formKey);
});

test("forms: the same LSAD in two states never produces one national form", () => {
  const njTown = formFor({
    ocdId: "ocd-division/country:us/state:nj/place:morristown",
    divisionType: "place",
    lsad: "43",
  });
  const azTown = formFor({
    ocdId: "ocd-division/country:us/state:az/place:patagonia",
    divisionType: "place",
    lsad: "43",
  });
  assert.notEqual(
    njTown.formKey,
    azTown.formKey,
    "a national `town` form would be false in both states — the stamp is state-scoped",
  );
});

test("forms: an unclassified school district is unstampable, never assumed independent", () => {
  const stamp = formFor({
    ocdId: "ocd-division/country:us/state:nh/school_district:nothing_the_census_knows",
    divisionType: "school_district",
    schoolDependency: "UNCLASSIFIED",
  });
  assert.equal(stamp.formKey, null);
  assert.match(stamp.unstampableReason ?? "", /independent or dependent/);

  // And omitting it entirely is the same answer — never a base-rate guess.
  const omitted = formFor({
    ocdId: "ocd-division/country:us/state:nh/school_district:nothing_the_census_knows",
    divisionType: "school_district",
  });
  assert.equal(omitted.formKey, null);
});

test("forms: a place with no legal type code is unstampable, never named from its label", () => {
  const noCode = formFor({
    ocdId: "ocd-division/country:us/state:nj/place:princeton",
    divisionType: "place",
    lsad: "00",
  });
  assert.equal(noCode.formKey, null);
  assert.match(noCode.unstampableReason ?? "", /no legal municipal type/);

  const noLsad = formFor({
    ocdId: "ocd-division/country:us/state:nj/place:somewhere",
    divisionType: "place",
    lsad: null,
  });
  assert.equal(noLsad.formKey, null);
  assert.match(noLsad.unstampableReason ?? "", /not guessable from a name/);
});

test("forms: a body with no division is unstampable rather than defaulted", () => {
  const stamp = formFor({ ocdId: null, divisionType: "place", lsad: "43" });
  assert.equal(stamp.formKey, null);
  assert.match(stamp.unstampableReason ?? "", /no division/);
});

test("forms: stateOf reads the state structurally and refuses a nameless id", () => {
  assert.equal(stateOf("ocd-division/country:us/state:nj/place:morristown"), "nj");
  assert.equal(stateOf("ocd-division/country:us"), null);
});
