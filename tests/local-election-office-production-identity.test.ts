import assert from "node:assert/strict";
import test from "node:test";
import type { LocalElectionOffice } from "../lib/sources/local-election-offices/model.ts";
import { localElectionOfficeProductionIdentity as identity, type ProductionLocalOfficeGeography } from "../scripts/eo01-production-identity.mts";

const office = (extra: Partial<LocalElectionOffice>): LocalElectionOffice => ({ id: "office", state: "OR", divisionId: "division", office: "County Clerk", directoryUrl: "https://sos.oregon.gov/elections/Pages/county-officials.aspx", checkedAt: "2026-10-23", fields: {}, ...extra });
const division = (extra: Partial<ProductionLocalOfficeGeography>): ProductionLocalOfficeGeography => ({ ocdId: "division", label: "Benton County", divisionType: "county", geoid: "41003", parentOcdId: null, ...extra });

test("an acquired ID and FIPS assigned together cannot hide the wrong native county", () => {
  const result = identity(office({ directoryJurisdiction: "Baker", countyFips: "41003" }), division({}));
  assert.equal(result.matched, false);
  assert.equal(result.nameMatched, false);
  assert.equal(result.nativeJurisdiction, "Baker");
  assert.equal(result.productionLabel, "Benton County");
  assert.equal(identity(office({ directoryJurisdiction: "St. Louis County", countyFips: "29510" }), division({ label: "St. Louis city", geoid: "29510" })).matched, false);
});

test("municipal proper names and municipal government types remain distinct", () => {
  const oldTown = office({ state: "ME", town: "Old Town", directoryJurisdiction: "Old Town", municipalityType: "CITY" });
  assert.equal(identity(oldTown, division({ label: "Old Town city", divisionType: "place", geoid: "2355125" })).matched, true);
  assert.equal(identity(oldTown, division({ label: "Old city", divisionType: "place", geoid: "2355125" })).matched, false);
  assert.equal(identity({ ...oldTown, town: "Adams", directoryJurisdiction: "Adams", municipalityType: "TOWN" }, division({ label: "Adams city", divisionType: "place" })).matched, false);
  assert.equal(identity(office({ state: "MO", directoryJurisdiction: "Kansas City", municipalityType: "CITY" }), division({ label: "Kansas City city", divisionType: "place", geoid: "2938000" })).matched, true);
});

test("the Census compound Massachusetts designation requires the actual exact municipality GEOID", () => {
  const agawam = office({ state: "MA", town: "Agawam", directoryJurisdiction: "Agawam", municipalityType: "CITY", countyFips: "25013", countySubdivisionGeoid: "2501300840" });
  const actual = division({ label: "Agawam Town city", divisionType: "place", geoid: "2501300840" });
  assert.equal(identity(agawam, actual).matched, true);
  assert.equal(identity(agawam, { ...actual, geoid: "2501300841" }).matched, false);
  assert.equal(identity({ ...agawam, state: "ME" }, actual).matched, false);
});

test("county identity comes from actual production geography even when its separate parent was not selected", () => {
  const andover = office({ state: "CT", town: "Andover", directoryJurisdiction: "Andover", municipalityType: "TOWN", countyFips: "09110", countySubdivisionGeoid: "0911001080" });
  const actual = division({ label: "Andover town", divisionType: "place", geoid: "0911001080" });
  const result = identity(andover, actual);
  assert.equal(result.matched, true);
  assert.equal(result.productionCountyGeoid, "09110");
  assert.match(result.countyGeoidEvidence, /actual production 10-digit/);
  assert.equal(identity({ ...andover, countyFips: "09120" }, actual).matched, false);
});

test("a native within-county limit independently catches a wrong assigned county for a cross-county city", () => {
  const city = office({ state: "MO", town: "Kansas City", directoryJurisdiction: "Kansas City within Jackson Co. - Kansas City Board of Elections", municipalityType: "CITY", countyFips: "29095" });
  const actual = division({ label: "Kansas City city", divisionType: "place", geoid: "2938000" });
  const jackson = division({ label: "Jackson County", geoid: "29095" });
  assert.equal(identity(city, actual, jackson).matched, true);
  const clay = division({ label: "Clay County", geoid: "29047" });
  const wrong = identity({ ...city, countyFips: "29047" }, actual, clay);
  assert.equal(wrong.matched, false);
  assert.equal(wrong.nativeCountyRestriction, "Jackson Co.");
  assert.match(wrong.reasons[0], /explicit within-county restriction/);
});
