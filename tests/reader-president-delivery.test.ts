import assert from "node:assert/strict";
import test from "node:test";
import { stateCoverage } from "../lib/reader/coverage.ts";
import { mergeReaderCoverage, stateCoverageForZip, type ReaderStateResponse } from "../lib/reader/client.ts";
import { groupOfficials } from "../lib/officials/tier-grouping.ts";
import { panelSeatsFor, FEDERAL_SEAT_TYPES } from "../lib/state/panel-seats.ts";
import { zipOnly } from "../lib/state/resolved-location.ts";
import { verifiedPresident, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import type { ReaderStatePackage } from "../lib/reader/state.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";

const COUNTRY = "ocd-division/country:us", STATE = `${COUNTRY}/state:az`, CD7 = `${STATE}/cd:7`, CD3 = `${STATE}/cd:3`;
const AT = "2026-10-12T00:00:00.000Z", URL = `${ADMINISTRATION_URL}jordan-example/`;
const president = verifiedPresident({ url: ADMINISTRATION_URL, html: `<a href="${URL}">President Jordan Example</a>` },
  { url: URL, html: "<main><h1>Jordan Example</h1><p>President of the United States</p></main>", retrievedAt: AT });

function member(id: string, name: string, senate = false): Officeholder {
  return { id: `congress:${id}`, nativeIds: { bioguide: [id] }, name, officeTitle: senate ? "U.S. Senator" : "U.S. Representative", level: "FEDERAL", state: "AZ", chamber: senate ? "senate" : "house",
    termStart: "2025-01-01", termEnd: "2027-01-01", birthDate: null, partyLabel: null, websiteUrl: "https://www.congress.gov/member", phone: "202-555-0100", email: null,
    contactFormUrl: null, campaignUrl: null, photo: null, provenance: { sourceUrl: "https://www.congress.gov/member", sourceOrg: "Congress", collectedAt: AT, verifiedAt: AT } };
}
const congress: OfficeholderSet = { scope: "AZ", generatedAt: AT,
  officeholders: [member("X000007", "Seventh House member"), member("X000003", "Third House member"), member("K000377", "First senator", true), member("G000574", "Second senator", true)],
  divisions: [
    { officeholderId: "congress:X000007", ocdId: CD7, bodyId: null }, { officeholderId: "congress:X000003", ocdId: CD3, bodyId: null },
    { officeholderId: "congress:K000377", ocdId: STATE, bodyId: null }, { officeholderId: "congress:G000574", ocdId: STATE, bodyId: null },
  ], unmatched: [] };
function state(heldPresident: OfficeholderSet | null): ReaderStatePackage {
  return { state: "AZ", version: "fixture", boundaryUrl: "/boundaries.pmtiles", president: heldPresident,
    registry: { formatVersion: 1, registry: { generatedAt: AT, divisions: [
      { ocdId: STATE, label: "Arizona", divisionType: "state", tier: "state" },
      ...[CD7, CD3].map(ocdId => ({ ocdId, label: ocdId === CD7 ? "Seventh district" : "Third district", divisionType: "cd", tier: "national" })),
    ], bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } } as unknown as RegistryRuntimeReadModel,
    federal: { roster: congress } as FederalDirectoryReadModel, people: null, legislativePeople: null,
    stateLegislatorAuthority: { scope: "US-AZ", kind: "NOT_RECORDED", metadata: {}, code: null, detail: "fixture" },
  } as ReaderStatePackage;
}

test("the sourced current President reaches both ZIPs' existing Federal rows and survives local-data merging", () => {
  const coverage = stateCoverage(state(president), [STATE, CD7, CD3], 32.2, -110.9);
  const payload: ReaderStateResponse = { state: "AZ", version: "held", coverage, directory: null, boundaryUrl: "/boundaries.pmtiles",
    zipPlaces: { "85701": { ids: [CD7], partial: [], samples: 1 }, "85003": { ids: [CD3], partial: [], samples: 1 } } };
  assert.deepEqual(coverage.seatCounts, { total: 3, named: 3 });
  for (const [zip, house] of [["85701", "congress:X000007"], ["85003", "congress:X000003"]]) {
    const scoped = stateCoverageForZip(payload, zip)!;
    const country = scoped.seats.find(seat => seat.ocdId === COUNTRY)!;
    assert.equal(country.label, "United States");
    assert.equal(country.divisionType, "country");
    assert.equal(country.representatives[0].name, "Jordan Example");
    assert.equal(country.representatives[0].sourceUrl, URL);
    assert.equal(country.representatives[0].officeTitle, "President of the United States");
    assert.equal(country.representatives[0].fieldSources?.name?.sourceUrl, URL);
    assert.deepEqual(scoped.seatCounts, { total: 2, named: 2 });
    const rows = panelSeatsFor(scoped, zipOnly(zip), FEDERAL_SEAT_TYPES).yours;
    assert.ok(rows.some(row => row.representatives.some(holder => holder.id === president.officeholders[0].id)), "existing Federal panel data includes the President without changing its markup");
    assert.deepEqual(groupOfficials(scoped).federal.map(row => row.holder.id).sort(), [house, "congress:K000377", "congress:G000574", president.officeholders[0].id].sort());
    const local = { ...scoped, seats: scoped.seats.filter(seat => seat.ocdId !== COUNTRY) };
    const merged = mergeReaderCoverage(scoped, local, 1)!;
    assert.equal(merged.seats.filter(seat => seat.ocdId === COUNTRY).length, 1);
    assert.equal(groupOfficials(merged).federal.length, 4, "local results preserve the President, House member and both senators");
  }
});

test("an unavailable or historical President adds no invented current holder and preserves the delegation", () => {
  const ended = { ...president, officeholders: president.officeholders.map(person => ({ ...person, memberships: person.memberships?.map(membership => ({ ...membership, current: false })) })) };
  for (const held of [null, ended]) {
    const coverage = stateCoverage(state(held), [STATE, CD7, CD3], 32.2, -110.9);
    assert.equal(coverage.seats.some(seat => seat.ocdId === COUNTRY), false);
    assert.equal(groupOfficials(coverage).federal.length, 4);
    assert.deepEqual(coverage.seatCounts, { total: 2, named: 2 });
  }
});
