/**
 * A method's recorded results name their place the way their writer did: a division, a registry government, a
 * candidate or other subject of one state, a state, or a state's pilot. Each becomes the division the fix map keys on,
 * so a method that worked somewhere has a working record; a result that names no one state records nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { methodAttemptsOf, newFieldManualEntry, normalizeEntry } from "../lib/control-plane/field-manual.ts";
import { methodPlaceOf } from "../lib/method/method-places.ts";
import { doorKindPlatform, planSpread } from "../lib/method/spread.ts";
import { sentMoneyPlaces } from "../lib/method/spread-pass.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";

test("every way a result names its place becomes a division, or nothing when it names no one state", () => {
  assert.equal(methodPlaceOf("ocd-division/country:us/state:az/county:pima#governing"), "ocd-division/country:us/state:az/county:pima");
  assert.equal(methodPlaceOf("az"), "ocd-division/country:us/state:az");
  assert.equal(methodPlaceOf("az:city:town-of-marana"), "ocd-division/country:us/state:az/place:marana", "a government is read to its own division");
  assert.equal(methodPlaceOf("az:state:arizona"), "ocd-division/country:us/state:az");
  assert.equal(methodPlaceOf("az:2026:state-az-sldl-19:state-representative-district-19:caswell-cheryl"), "ocd-division/country:us/state:az",
    "a candidate is placed in their state");
  assert.equal(methodPlaceOf("az-pima-85641"), "ocd-division/country:us/state:az");
  assert.equal(methodPlaceOf("us"), null);
  assert.equal(methodPlaceOf("pilot-counties"), null);
  assert.equal(methodPlaceOf("zz:city:nowhere"), null, "a state this repository does not place");
});

test("a route that yielded in a state has a working record there, from its own outcome", () => {
  const route = normalizeEntry(newFieldManualEntry("data/method/knowledge.json", "legistar-insite-calendar-postback-enumeration", {
    role: "SCOUT", kind: "ROUTE", title: "driving Legistar InSite's own Calendar.aspx date-range postback", summary: "s", outcome: "YIELDED",
    platforms: ["legistar"], observedAt: "2026-08-28T00:00:00.000Z",
    payload: { outcomes: [
      { jurisdiction: "az", outcome: "YIELDED", walkedOn: "2026-08-28" },
      { jurisdiction: "az:city:town-of-marana", outcome: "ZERO", walkedOn: "2026-08-29" },
      { jurisdiction: "us", outcome: "BLOCKED", walkedOn: "2026-08-30" },
    ] },
  }));
  const attempts = methodAttemptsOf(route, "2026-10-08T00:00:00.000Z");
  assert.deepEqual(attempts.map((a) => [a.placeId, a.outcome, a.at]), [
    ["ocd-division/country:us/state:az", "SUCCEEDED", "2026-08-28T00:00:00.000Z"],
    ["ocd-division/country:us/state:az/place:marana", "FAILED", "2026-08-29T00:00:00.000Z"],
  ]);
});

test("a funded place is the member's own division: a registry government is read to it, a candidate funds no door", () => {
  const area = { key: "k", label: "l", budgetUsd: 100, resolved: true, states: ["AZ"], historicalUsd: 0,
    members: new Set(["az:city:town-of-marana", "ocd-division/country:us/state:az/county:pima#governing", "az:2026:state-az-sldl-19:state-representative-district-19:caswell-cheryl"]) };
  assert.deepEqual([...sentMoneyPlaces({ areas: [area as never], sends: null })].sort(), [
    "ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/place:marana",
  ]);
});

const door = (doorId: string, ocdId: string, kind: string, hosts: string[]): DoorRecord =>
  ({ doorId, kind, ocdId, hosts, status: "OPEN", bodyIds: [], holds: ["meetings"], config: {} }) as unknown as DoorRecord;

test("a method reaches every door of its kind or platform, in every state: InSite is Legistar, and any of a door's websites counts", () => {
  assert.equal(doorKindPlatform("legistar-insite"), "legistar");
  const doors = [
    door("pima-api", "ocd-division/country:us/state:az/county:pima", "legistar", ["webapi.legistar.com"]),
    door("pima-insite", "ocd-division/country:us/state:az/county:pima", "legistar-insite", ["pima.legistar.com"]),
    door("mesa-insite", "ocd-division/country:us/state:az/place:mesa", "legistar-insite", ["mesa.legistar.com"]),
    door("morris-page", "ocd-division/country:us/state:nj/county:morris", "page", ["www.morriscountynj.gov", "morriscountynj.legistar.com"]),
    door("tucson-page", "ocd-division/country:us/state:az/place:tucson", "page", ["www.tucsonaz.gov"]),
  ];
  const platformsOf = new Map([["morris-page", ["legistar"]]]);
  const plan = planSpread({ method: { methodId: "m", doorKind: "legistar", platforms: ["legistar"] }, doors,
    detectedPlatforms: (id) => platformsOf.get(id) ?? [], fixMapRows: [], sendPlaceIds: null, paidTriesLeft: 0 });
  assert.equal(plan.matchingDoors, 4, "both Pima doors, Mesa's InSite door and Morris's page on a Legistar website");
  assert.equal(plan.matching, 3, "one try per place");
  assert.deepEqual(plan.plain.map((p) => p.placeId).sort(), [
    "ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/place:mesa", "ocd-division/country:us/state:nj/county:morris",
  ]);
});
