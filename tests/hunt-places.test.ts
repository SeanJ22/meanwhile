import assert from "node:assert/strict";
import test from "node:test";

import { plainOrderType, parsePlainOrder } from "../lib/control-plane/operator-chat/orders.ts";
import type { OperatorContext } from "../lib/control-plane/operator-chat/context.ts";
import { divisionsOfPlace, placeKeyOfWords } from "../lib/hunt/packet-read.ts";
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

test("a district, a state, a place key or a ZIP names a place; other words name none", async () => {
  const zipState = async (zip: string) => zip === "85701" ? "AZ" : null;
  assert.equal(await placeKeyOfWords("AZ-01", zipState), "geo:az.congressional_district.0401");
  assert.equal(await placeKeyOfWords("Arizona", zipState), "st:az");
  assert.equal(await placeKeyOfWords("geo:az.county.04019", zipState), "geo:az.county.04019");
  assert.equal(await placeKeyOfWords("ZIP 85701", zipState), "geo:az.zcta.85701");
  assert.equal(await placeKeyOfWords("the meetings", zipState), null);
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
