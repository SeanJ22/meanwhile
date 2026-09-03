import { geometryPath } from "../lib/holdings/files.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { subdivisionIdentity } from "../lib/ocd/divisions.ts";

/**
 * County subdivisions, and the collisions that forced their shape.
 *
 * Phase 4.6 needs to know which divisions have a government before it can
 * derive a body for one. Two facts from the data drive everything here, and
 * both are easy to regress silently:
 *
 * 1. A municipality's Census layer varies by state. Arizona's are places; New
 *    Jersey's and New Hampshire's are county subdivisions. Newbury NH and
 *    Rockaway Township NJ have no polygon at all without the second layer.
 * 2. `NAME` is not unique, even inside one county.
 */

function load(file: string) {
  const raw = readFileSync(geometryPath(file), "utf8");
  return JSON.parse(raw) as {
    features: { properties: { ocdId: string; label: string; lsad?: string } }[];
  };
}

test("Rockaway borough and Rockaway township stay separate governments", () => {
  // Both sit in Morris County and both slug to "rockaway" from NAME alone.
  // They are two municipalities with two councils; collapsing them would merge
  // two governments onto one join key.
  const borough = subdivisionIdentity("34", "Morris County", "Rockaway borough", "21");
  const township = subdivisionIdentity("34", "Morris County", "Rockaway township", "44");

  assert.ok(borough && township);
  assert.notEqual(borough.ocdId, township.ocdId);
  assert.equal(
    township.ocdId,
    "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
  );
});

test("the same name in two counties gets two identifiers", () => {
  // Six Washington townships and five Franklins in New Jersey alone.
  const morris = subdivisionIdentity("34", "Morris County", "Washington township", "44");
  const warren = subdivisionIdentity("34", "Warren County", "Washington township", "44");

  assert.ok(morris && warren);
  assert.notEqual(morris.ocdId, warren.ocdId);
});

test("every committed subdivision identifier is unique", () => {
  for (const file of ["cousub-04.geojson", "cousub-33.geojson", "cousub-34.geojson"]) {
    const ids = load(file).features.map((f) => f.properties.ocdId);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${file}: duplicate OCD-IDs — the join key is not unique`,
    );
  }
});

test("the municipalities behind two target zips have geometry", () => {
  // Neither is in the place file. Before county subdivisions were built, the
  // app had no polygon for either, so no derivation could ever find them.
  const nh = load("cousub-33.geojson").features.map((f) => f.properties.ocdId);
  assert.ok(
    nh.includes("ocd-division/country:us/state:nh/county:merrimack/place:newbury_town"),
    "Newbury NH (03255) has no subdivision polygon",
  );

  const nj = load("cousub-34.geojson").features.map((f) => f.properties.ocdId);
  assert.ok(
    nj.includes("ocd-division/country:us/state:nj/county:morris/place:rockaway_township"),
    "Rockaway Township NJ (07866) has no subdivision polygon",
  );
});

test("every subdivision carries the LSAD that says whether it governs", () => {
  // Without this the derivation cannot tell a town from a statistical CCD, and
  // Arizona's 15 committed subdivisions are *all* CCDs.
  for (const file of ["cousub-04.geojson", "cousub-33.geojson", "cousub-34.geojson"]) {
    for (const f of load(file).features) {
      assert.ok(
        f.properties.lsad && f.properties.lsad.length > 0,
        `${file}: ${f.properties.label} has no LSAD`,
      );
    }
  }
});

test("Arizona's county subdivisions are all statistical, not governments", () => {
  // LSAD 22 is a Census County Division. Deriving a council for one would
  // invent a government for "Tucson CCD", which does not exist.
  const az = load("cousub-04.geojson").features;
  assert.ok(az.length > 0);
  assert.ok(
    az.every((f) => f.properties.lsad === "22"),
    "expected every Arizona county subdivision to be a CCD",
  );
});

test("places still carry LSAD, so a CDP can be told from a city", () => {
  const az = load("place-04.geojson").features;
  const tucson = az.find((f) => f.properties.label === "Tucson");
  const vail = az.find((f) => f.properties.label === "Vail");

  assert.equal(tucson?.properties.lsad, "25", "Tucson is an incorporated city");
  assert.equal(vail?.properties.lsad, "57", "Vail is a CDP with no municipality");
});
