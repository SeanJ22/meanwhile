import assert from "node:assert/strict";
import test from "node:test";

import { plainOrderType, parsePlainOrder } from "../lib/control-plane/operator-chat/orders.ts";
import type { OperatorContext } from "../lib/control-plane/operator-chat/context.ts";
import { divisionsOfPlace } from "../lib/hunt/packet-read.ts";
import { readPlaceWords, type NamedPlace, type PlaceWordsDeps } from "../lib/hunt/place-words.ts";
import { huntCostView } from "../lib/hunt/cost-per-fact.ts";

test("plain words send agents to a place", () => {
  for (const words of ["hunt AZ-01", "Hunt in Arizona", "find everything in AZ-01", "send agents to AZ-01"]) {
    assert.equal(plainOrderType(words), "fleet.deployHere", words);
  }
  const order = parsePlainOrder("hunt AZ-01", { from: "/admin" } as OperatorContext);
  assert.ok(order && "type" in order);
  assert.equal(order.subject, "geo:az.congressional_district.0401");
  assert.deepEqual(order.input, { note: "AZ-01" });
});

const COUNTRY = "ocd-division/country:us";
const AZ = "ocd-division/country:us/state:az";
const named = (rows: readonly NamedPlace[]) => async () => {
  const byName = new Map<string, NamedPlace[]>();
  for (const row of rows) {
    const slug = row.divisionId.split("/place:")[1]!;
    for (const key of new Set([slug, slug.replace(/_(city|town|township|borough|village)$/, "")])) byName.set(key, [...byName.get(key) ?? [], row]);
  }
  return byName;
};
const place = (divisionId: string, label: string, state: string, county: string | null, zips: string[]): NamedPlace => ({ divisionId, label, state, county, zips });
const deps = (rows: readonly NamedPlace[]): PlaceWordsDeps => ({
  named: named(rows),
  zipState: async zip => zip === "85701" ? "AZ" : null,
  zipDivisions: async zips => new Map(zips.map(zip => [zip, zip === "85643"
    ? [`${AZ}/county:cochise`, `${AZ}/place:willcox`, `${AZ}/place:bowie`, `${AZ}/school_district:willcox_unified_district`]
    : [`${AZ}/county:pima`, `${AZ}/place:tucson`]])),
  resolveDivisions: async p => ({ label: `resolved ${p.kind}`, covers: "", divisions: [{ id: `${AZ}/${p.kind}`, label: p.kind }] }),
});
const WILLCOX = place(`${AZ}/place:willcox`, "Willcox, AZ", "az", null, ["85643"]);
const SPRINGFIELDS = [place("ocd-division/country:us/state:il/place:springfield", "Springfield, IL", "il", null, ["62701"]),
  place("ocd-division/country:us/state:ma/place:springfield", "Springfield, MA", "ma", null, ["01103"])];

test("a town or city by name resolves the way a ZIP does: every division its ZIPs touch except the other towns", async () => {
  for (const words of ["Willcox", "Willcox, AZ", "willcox AZ", "Willcox, Arizona"]) {
    const read = await readPlaceWords(words, deps([WILLCOX]));
    assert.equal(read.state, "PLACE", words);
    assert.ok(read.state === "PLACE");
    assert.equal(read.label, "Willcox, AZ");
    assert.deepEqual(read.divisionIds, [COUNTRY, AZ, `${AZ}/county:cochise`, `${AZ}/place:willcox`, `${AZ}/school_district:willcox_unified_district`]);
  }
});

test("a name that matches several places offers each, and each choice names one place", async () => {
  const read = await readPlaceWords("Springfield", deps(SPRINGFIELDS));
  assert.equal(read.state, "CHOICES");
  assert.ok(read.state === "CHOICES");
  assert.deepEqual(read.choices.map(c => c.label), ["Springfield, IL", "Springfield, MA"]);
  const chosen = await readPlaceWords(read.choices[1]!.words, deps(SPRINGFIELDS));
  assert.ok(chosen.state === "PLACE" && chosen.label === "Springfield, MA");
});

test("a town is preferred to its county's subdivision of the same name", async () => {
  const rows = [place("ocd-division/country:us/state:pa/place:abbottstown", "Abbottstown, PA", "pa", null, ["17301"]),
    place("ocd-division/country:us/state:pa/county:adams/place:abbottstown_borough", "Abbottstown Borough, Adams County, PA", "pa", "adams", ["17301"])];
  const read = await readPlaceWords("Abbottstown, PA", deps(rows));
  assert.ok(read.state === "PLACE" && read.label === "Abbottstown, PA");
});

test("districts, states, place keys and ZIPs keep their own reading; unknown words name nothing", async () => {
  const d = deps([WILLCOX]);
  assert.equal((await readPlaceWords("AZ-01", d) as { label: string }).label, "resolved district");
  assert.equal((await readPlaceWords("Arizona", d) as { label: string }).label, "resolved state");
  assert.equal((await readPlaceWords("geo:az.county.04019", d) as { label: string }).label, "resolved county");
  assert.equal((await readPlaceWords("85701", d) as { label: string }).label, "resolved zip");
  assert.equal((await readPlaceWords("the meetings", d)).state, "NONE");
});

test("a place's divisions are every division its ZIPs touch, with its state and the country", async () => {
  const ids = await divisionsOfPlace(["85701", "85705"], ["AZ"], async zips => new Map(zips.map(zip => [zip,
    zip === "85701" ? ["ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/place:tucson"]
      : ["ocd-division/country:us/state:az/county:pima"]])));
  assert.deepEqual(ids, ["ocd-division/country:us", "ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima",
    "ocd-division/country:us/state:az/place:tucson"]);
});

test("cost per published fact is spend over published facts, and unknown while a charge is unpriced", () => {
  assert.equal(huntCostView({ usd: 12, unpriced: 0, search_usd: 2, jobs: 4 }, { reported: 30, published: 8 }).usdPerPublishedFact, 1.5);
  assert.equal(huntCostView({ usd: 12, unpriced: 1, search_usd: 2, jobs: 4 }, { reported: 30, published: 8 }).usdPerPublishedFact, null);
  assert.equal(huntCostView({ usd: 12, unpriced: 0, search_usd: 2, jobs: 4 }, { reported: 30, published: 0 }).usdPerPublishedFact, null);
});
