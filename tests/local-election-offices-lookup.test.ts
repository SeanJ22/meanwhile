import assert from "node:assert/strict";
import test from "node:test";
import type { VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { localElectionOfficesForCounty, localElectionOfficesForPlace, localElectionOfficesForTown, type LocalElectionOffice, type LocalElectionOfficeFile } from "../lib/reference/local-election-offices.ts";

const source = { sourceUrl: "https://elections.wi.gov/clerk-directory", publisher: "Wisconsin Elections Commission", quote: "Adams City Clerk", checkedAt: "2026-10-23", documentHash: "a".repeat(64) };
const office = (id: string, rest: Partial<LocalElectionOffice> = {}): LocalElectionOffice => ({ id, state: "WI", divisionId: `ocd-division/country:us/state:wi/county:adams/place:${id}`, town: "Adams", municipalityType: "CITY", countyFips: "55001", countyName: "Adams County", office: "Adams City Clerk", directoryUrl: source.sourceUrl, checkedAt: source.checkedAt, fields: { office: source }, ...rest });
const file = (offices: LocalElectionOffice[]): LocalElectionOfficeFile => ({ formatVersion: 1, state: "WI", checkedAt: source.checkedAt, offices });
const place: VotingReaderPlace = { precision: "ADDRESS", point: null, states: ["WI"], countyFips: ["55001"], countyNames: ["Adams County"], divisionIds: [], countySubdivisionGeoids: [], towns: ["Adams town"], wards: [], aiannhGeoids: [], precincts: [] };
const city = office("adams_city", { countySubdivisionGeoid: "5500100275" });
const town = office("adams_town", { municipalityType: "TOWN", countySubdivisionGeoid: "5500100300", office: "Adams Town Clerk" });

test("the Wisconsin town and city with the same name retain their own clerks", () => {
  const held = file([city, town]);
  assert.deepEqual(localElectionOfficesForPlace(held, place).map(row => row.id), ["adams_town"]);
  assert.deepEqual(localElectionOfficesForTown(held, "City of Adams", "Adams County").map(row => row.id), ["adams_city"]);
  assert.deepEqual(localElectionOfficesForTown(held, "Adams", "55001", "TOWN").map(row => row.id), ["adams_town"]);
  assert.deepEqual(localElectionOfficesForTown(held, "Adams", "55001"), [], "a bare name cannot choose between two local governments");
});

test("Census subdivision identity wins over an unqualified postal town", () => {
  const held = file([city, town]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...place, countySubdivisionGeoids: ["5500100300"], towns: ["Adams"] }).map(row => row.id), ["adams_town"]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...place, countySubdivisionGeoids: ["5500100275"], towns: ["Adams town"] }).map(row => row.id), ["adams_city"]);
});

test("same-named municipalities in different counties do not leak into the address answer", () => {
  const otherTown = office("adams_town_elsewhere", { municipalityType: "TOWN", countyFips: "55081", countyName: "Monroe County", divisionId: "ocd-division/country:us/state:wi/county:monroe/place:adams_town" });
  const held = file([town, otherTown]);
  assert.deepEqual(localElectionOfficesForPlace(held, place).map(row => row.id), ["adams_town"]);
  assert.deepEqual(localElectionOfficesForTown(held, "Adams town"), []);
  assert.deepEqual(localElectionOfficesForTown(held, "Adams town", "Monroe").map(row => row.id), ["adams_town_elsewhere"]);
});

test("county office lookups use county identity and load only the requested state", () => {
  const county = office("county", { town: undefined, municipalityType: undefined, countySubdivisionGeoid: undefined, divisionId: "ocd-division/country:us/state:wi/county:adams", office: "Adams County Clerk" });
  const otherState = office("other-state", { state: "MI" });
  const held = file([county, town, otherState]);
  assert.deepEqual(localElectionOfficesForCounty(held, "55001").map(row => row.id), ["county"]);
  assert.deepEqual(localElectionOfficesForCounty(held, "Adams").map(row => row.id), ["county"]);
  assert.deepEqual(localElectionOfficesForPlace(held, place).map(row => row.id), ["adams_town"]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...place, states: ["MI"] }), []);
});

test("a county-level directory identifier cannot make every town in the county match", () => {
  const held = file([office("directory-county", { town: "Friendship", municipalityType: "VILLAGE", divisionId: "ocd-division/country:us/state:wi/county:adams" })]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...place, divisionIds: ["ocd-division/country:us/state:wi/county:adams"] }), []);
});

test("matching offices preserve the independently sourced hours and lookup link", () => {
  const hoursSource = { ...source, sourceUrl: "https://local.gov/elections", quote: "Monday through Friday, 8 a.m. to 4 p.m." };
  const held = file([office("adams_town", { municipalityType: "TOWN", hours: hoursSource.quote, pollingPlaceLookup: "https://myvote.wi.gov/en-us/Find-My-Polling-Place", fields: { office: source, hours: hoursSource, pollingPlaceLookup: { ...source, quote: "https://myvote.wi.gov/en-us/Find-My-Polling-Place" } } })]);
  const [matched] = localElectionOfficesForPlace(held, place);
  assert.equal(matched.hours, hoursSource.quote);
  assert.equal(matched.fields.hours?.sourceUrl, hoursSource.sourceUrl);
  assert.equal(matched.fields.pollingPlaceLookup?.quote, matched.pollingPlaceLookup);
});

test("Old Town is a city's proper name, while its municipal kind stays city", () => {
  const clerk = office("old-town", { state: "ME", countyName: "Penobscot County", countyFips: "23019", town: "Old Town", municipalityType: "CITY", divisionId: "ocd-division/country:us/state:me/county:penobscot/place:old_town_city" });
  const held = { ...file([clerk]), state: "ME" };
  assert.deepEqual(localElectionOfficesForTown(held, "Old Town", "23019").map(row => row.id), ["old-town"]);
  assert.deepEqual(localElectionOfficesForTown(held, "Old Town city", "23019").map(row => row.id), ["old-town"]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...place, states: ["ME"], countyFips: ["23019"], countyNames: ["Penobscot County"], towns: ["Old Town city"] }).map(row => row.id), ["old-town"]);
});

test("Kansas City resolves by its full proper name with or without a declared city kind", () => {
  const kansasCity = office("kansas-city", { state: "MO", countyFips: "29095", countyName: "Jackson County", town: "Kansas City city", municipalityType: "CITY", divisionId: "ocd-division/country:us/state:mo/place:kansas_city" });
  const shorterName = office("kansas", { ...kansasCity, id: "kansas", town: "Kansas city", divisionId: "ocd-division/country:us/state:mo/place:kansas" });
  const held = { ...file([kansasCity, shorterName]), state: "MO" };
  assert.deepEqual(localElectionOfficesForTown(held, "Kansas City", "29095").map(row => row.id), ["kansas-city"]);
  assert.deepEqual(localElectionOfficesForTown(held, "Kansas City", "29095", "CITY").map(row => row.id), ["kansas-city"]);
  assert.deepEqual(localElectionOfficesForTown(held, "Kansas City", "29095", "TOWN"), []);
  assert.deepEqual(localElectionOfficesForTown(held, "Kansas", "29095", "CITY").map(row => row.id), ["kansas"]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...place, states: ["MO"], countyFips: ["29095"], countyNames: ["Jackson County"], towns: ["Kansas City"] }).map(row => row.id), ["kansas-city"]);
});

test("a city office limited to one county cannot follow its city ID across a county boundary", () => {
  const restricted = office("shared_city", { countyFips: "55001", countyName: "Adams County", divisionId: "ocd-division/country:us/state:wi/place:shared_city" });
  const county = office("other_county", { town: undefined, municipalityType: undefined, countyFips: "55081", countyName: "Monroe County", divisionId: "ocd-division/country:us/state:wi/county:monroe" });
  const held = file([restricted, county]);
  const acrossBoundary = { ...place, divisionIds: [restricted.divisionId], countyFips: ["55081"], countyNames: ["Monroe County"] };
  assert.deepEqual(localElectionOfficesForPlace(held, acrossBoundary).map(row => row.id), ["other_county"]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...acrossBoundary, countyFips: ["55001"], countyNames: ["Adams County"] }).map(row => row.id), ["shared_city"]);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...acrossBoundary, countyFips: [], countyNames: [] }), []);
});

test("an explicit municipal exclusion applies even when the excluded city's office has not been acquired", () => {
  const county = office("jackson", { state: "MO", town: undefined, municipalityType: undefined, countyFips: "29095", countyName: "Jackson County", divisionId: "ocd-division/country:us/state:mo/county:jackson", excludedMunicipalities: [{ divisionId: "ocd-division/country:us/state:mo/place:kansas_city", name: "Kansas City", municipalityType: "CITY" }] });
  const held = { ...file([county]), state: "MO" };
  const inside = { ...place, states: ["MO"], countyFips: ["29095"], countyNames: ["Jackson County"], point: { lat: 39.1, lng: -94.6 }, divisionIds: [county.divisionId], towns: ["Kansas City city", "Kansas City"] };
  assert.deepEqual(localElectionOfficesForPlace(held, inside), []);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...inside, towns: [], point: null, divisionIds: [county.excludedMunicipalities![0].divisionId] }), []);
  assert.deepEqual(localElectionOfficesForPlace(held, { ...inside, towns: ["Independence city", "Independence"] }).map(row => row.id), ["jackson"]);
  const differentExclusion = { ...county, excludedMunicipalities: [{ ...county.excludedMunicipalities![0], divisionId: "ocd-division/country:us/state:mo/place:kansas", name: "Kansas" }] };
  assert.deepEqual(localElectionOfficesForPlace({ ...held, offices: [differentExclusion] }, inside).map(row => row.id), ["jackson"], "the proper word City is not stripped to reinterpret Kansas City as Kansas");
});
