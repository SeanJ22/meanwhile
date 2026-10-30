import assert from "node:assert/strict";
import test from "node:test";
import { readPlacePackage } from "../lib/reader/place.ts";
import { buildPlacePackage } from "../lib/reader/place-builder.ts";
import { packReadyPlace } from "../lib/reader/place-ready.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { markUniqueGovernmentRecipientNames, registrationRecipientNamesSql } from "../lib/registration/recipient-names.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishFederalMoneyPartition } from "../lib/federal-money/edge-publication.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { federalMoneyRows } from "../lib/federal-money/view.ts";
import { federalMoneyLookupKeys, type FederalMoneyFact } from "../lib/federal-money/model.ts";

const STATE = "ocd-division/country:us/state:wi", COUNTY = `${STATE}/county:milwaukee`, AT = "2026-10-26T00:00:00.000Z";
const NATIVE = "government:US-WI:cog:510410", GOVERNMENT = "wi:county:county-of-milwaukee", BOARD = "wtp-body/milwaukee#governing";
const provenance = { sourceUrl: "https://example.gov/census", sourceOrg: "Census", collectedAt: AT, verifiedAt: AT };

test("a place's existing parent and native ids carry recipient aliases to its body card without another read or a name match", async () => {
  const definition = { bodyClass: "GOVERNING" as const, bodyOrigin: "SOURCED" as const, coverageStatus: "NOT_ATTEMPTED" as const,
    agendaSourceType: "NONE" as const, agendaSourceRef: null, meetingCadence: null, homepageUrl: null, demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const, provenance };
  const nativeBoard = "old-native-board", similarBoard = "same-name-board", explicitBoard = "explicit-body-alias";
  const runtime: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: AT,
    bodies: [
      { ...definition, id: BOARD, name: "County board", ocdId: COUNTY },
      { ...definition, id: nativeBoard, name: "County board", ocdId: COUNTY, censusId: "510410" },
      { ...definition, id: similarBoard, name: "County board", ocdId: COUNTY },
      { ...definition, id: explicitBoard, name: "County board", ocdId: COUNTY },
    ], divisions: [{ ocdId: COUNTY, label: "Milwaukee County", divisionType: "county", tier: "local", state: "WI",
      parentOcdId: STATE, lsad: null, funcstat: null, classfp: null, geoid: "55079", canonicalOcdId: COUNTY,
      canonicalMatch: "exact", sourceDataset: "TIGER_CB2023", provenance }] },
    bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
  const government: RegistrationGovernmentListing = { id: NATIVE, aliases: [GOVERNMENT], jurisdictionId: GOVERNMENT,
    state: "WI", name: "County board", kind: "GOVERNMENT", governmentClass: "COUNTY", nativeIds: { census_pid6: "510410" },
    status: null, sourceVintage: "2022", website: null, officePhone: null, officeAddress: null, countyFips: "55079",
    associations: [{ divisionId: COUNTY, layer: "county", geoid: "55079", basis: "SOURCE_CODE" }], bodyIds: [explicitBoard], recipientNameUnique: true, provenance };
  const row = { registration_held: true, registry: runtime, governments: [government], divisions: [],
    entities: runtime.registry.bodies.map(body => ({ id: body.id, name: body.name, placed: true, division: COUNTY,
      parent_id: body.id === BOARD ? GOVERNMENT : COUNTY })), fields: [], rosters: [], comments: [], sittings: [],
    agenda_documents: [], agenda_document_links: [], parts: {} };
  let reads = 0;
  const place = await buildPlacePackage({ state: "WI", divisionIds: [COUNTY] }, async () => {
    reads++;
    return [row];
  });
  assert.equal(reads, 1);
  const expected = [GOVERNMENT, NATIVE, nativeBoard, explicitBoard].sort();
  assert.deepEqual(place.bodies.find(body => body.id === BOARD)?.recipientIds, [...expected, BOARD].sort());
  assert.deepEqual(place.bodies.find(body => body.id === BOARD)?.recipientNames, [government.name]);
  assert.equal(place.bodies.find(body => body.id === BOARD)?.recipientState, "WI");
  assert.deepEqual(place.bodies.find(body => body.id === nativeBoard)?.recipientIds, expected);
  assert.deepEqual(place.bodies.find(body => body.id === explicitBoard)?.recipientIds, expected);
  assert.equal(place.bodies.find(body => body.id === similarBoard)?.recipientIds, undefined,
    "the same body name and division never establish the recipient government");
  const coverage = stateCoverage({ state: "WI", registry: runtime, version: "fixture" }, [COUNTY], 0, 0, [], place.bodies);
  assert.deepEqual(coverage.bodies.find(body => body.bodyId === BOARD)?.recipientIds, [...expected, BOARD].sort());
  assert.deepEqual(coverage.bodies.find(body => body.bodyId === BOARD)?.recipientNames, [government.name]);
  assert.equal(coverage.bodies.find(body => body.bodyId === BOARD)?.recipientState, "WI");
  assert.equal(coverage.bodies.find(body => body.bodyId === similarBoard)?.recipientIds, undefined);
  assert.equal(reads, 1);
  let pageReads = 0;
  const saved = await readPlacePackage({ state: "WI", placeId: "zip:53202", divisionIds: [COUNTY] }, async () => {
    pageReads++;
    return [{ page: packReadyPlace(place) }];
  });
  assert.equal(pageReads, 1);
  assert.deepEqual(saved.bodies, place.bodies, "the saved ZIP page retains recipient identities and source service areas");
  const ambiguous = await buildPlacePackage({ state: "WI", divisionIds: [COUNTY] }, async () => [{ ...row,
    governments: [government, { ...government, id: "different-government", nativeIds: {}, bodyIds: [] }] }]);
  assert.equal(ambiguous.bodies.find(body => body.id === BOARD)?.recipientNames, undefined,
    "a parent alias claimed by two governments cannot identify either as the recipient");
});

test("a nested city board reads its own source-coded city area, including receipts and separately classified area awards", async t => {
  const nested = `${COUNTY}/place:milwaukee_city`, canonical = `${STATE}/place:milwaukee`, bodyId = `${nested}#council`;
  const governmentId = "government:US-WI:cog:city", governmentAlias = "wi:city:city-of-milwaukee";
  const source = { ...provenance, sourceUrl: "https://www.usaspending.gov/award/city" };
  const definition = { id: bodyId, name: "City council", ocdId: nested, bodyClass: "GOVERNING" as const, bodyOrigin: "SOURCED" as const,
    coverageStatus: "NOT_ATTEMPTED" as const, agendaSourceType: "NONE" as const, agendaSourceRef: null, meetingCadence: null,
    homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY" as const, provenance };
  const division = { ocdId: nested, label: "Milwaukee", divisionType: "place" as const, tier: "local" as const, state: "WI", parentOcdId: STATE,
    lsad: null, funcstat: null, classfp: null, geoid: "5553000", canonicalOcdId: canonical, canonicalMatch: "exact" as const,
    sourceDataset: "TIGER_CB2023" as const, provenance };
  const runtime: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: AT, bodies: [definition], divisions: [division] },
    bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
  const government = { id: governmentId, aliases: [governmentAlias], name: "CITY OF MILWAUKEE", state: "WI", nativeIds: {}, bodyIds: [],
    governmentClass: "MUNICIPAL", recipientNameUnique: true, associations: [{ divisionId: canonical, layer: "place", geoid: "5553000", basis: "SOURCE_CODE" }] };
  const row = { registration_held: true, registry: runtime, governments: [government], divisions: [],
    entities: [{ id: bodyId, name: definition.name, placed: true, division: nested, parent_id: governmentAlias }],
    fields: [], rosters: [], comments: [], sittings: [], agenda_documents: [], agenda_document_links: [], parts: {} };
  const place = await buildPlacePackage({ state: "WI", divisionIds: [nested] }, async () => [row]);
  const coverage = stateCoverage({ state: "WI", registry: runtime, version: "city" }, [nested], 0, 0, [], place.bodies);
  const city = coverage.bodies[0];
  assert.equal(city.moneyDivisionId, canonical);
  assert.equal(city.ocdId, nested, "the body keeps its original identity and governing location");
  const records: FederalMoneyFact[] = ["CITY OF MILWAUKEE", "UNRELATED HOUSING ORGANIZATION"].map((recipient, n) => ({
    id: `usaspending:city-${n}`, sourceId: `city-${n}`, source: "usaspending", state: "WI", kind: "GRANT", title: "Housing assistance",
    amount: 100, amountLabel: "Federal obligation", period: "2026-10-25", recipient, uei: null, identifiers: {}, geography: [],
    bodyIds: [], divisionIds: [canonical], joinStatus: "JOINED", joinReason: "Exact source city area.", details: { recipientState: "WI" },
    provenance: { sourceUrl: source.sourceUrl, sourceOrg: "USAspending", publicationDate: AT, retrievedAt: AT, official: true, rawHash: "a".repeat(64) },
  }));
  const directory = mkdtempSync(join(tmpdir(), "fm01-city-area-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  await publishFederalMoneyPartition({ store: artifactStore, previous: null, versionId: "city", checkedAt: AT,
    projection: { formatVersion: 2, source: "usaspending", state: "WI", partition: { year: "2026", place: canonical, shard: "" }, records,
      lookupKeys: federalMoneyLookupKeys(records), counts: { loaded: 2, joined: 2, unjoined: 0 } } });
  const target = { divisionId: city.moneyDivisionId!, bodyId: city.bodyId, bodyIds: city.recipientIds,
    recipientNames: city.recipientNames, recipientState: city.recipientState };
  const read = await readFederalMoneyForPlace(target, { artifactStore });
  const rows = federalMoneyRows(read.sources[0].records, target);
  assert.deepEqual(rows.map(row => row.relationship), ["BOTH", "GEOGRAPHY"]);
  const multiple = await buildPlacePackage({ state: "WI", divisionIds: [nested] }, async () => [{ ...row,
    governments: [{ ...government, associations: [...government.associations, { ...government.associations[0], divisionId: `${STATE}/place:other` }] }] }]);
  assert.equal(multiple.bodies[0].moneyDivisionId, undefined, "multiple source areas never select one for the reader");
  const hostCounty = await buildPlacePackage({ state: "WI", divisionIds: [nested] }, async () => [{ ...row,
    governments: [{ ...government, governmentClass: "SPECIAL DISTRICT", associations: [{ ...government.associations[0], divisionId: COUNTY, layer: "county" }] }] }]);
  assert.equal(hostCounty.bodies[0].moneyDivisionId, undefined, "a district's host county never substitutes for its spending area");
});

test("a paged inventory's legal-name identity remains unique across the complete state and keeps the government type", async () => {
  const records = [
    { id: "first-town", name: "Town of Union", state: "WI" },
    { id: "city", name: "Union City", state: "WI" },
    { id: "county", name: "County of Union", state: "WI" },
    { id: "second-town", name: "Union Town", state: "WI" },
    { id: "other-state", name: "City of Union", state: "MN" },
  ] as RegistrationGovernmentListing[];
  const expected = markUniqueGovernmentRecipientNames(records);
  assert.deepEqual(expected.map(row => row.recipientNameUnique), [false, true, true, false, true]);
  const { pg } = await migratedReaderDb();
  try {
    const statement = `SELECT ${registrationRecipientNamesSql("$1::jsonb", "reader_inventory_payload($1::jsonb,0,3)")} AS payload`;
    const response = await pg.query<{ payload: { governments: RegistrationGovernmentListing[]; governmentCount: number } }>(statement,
      [JSON.stringify({ governments: records })]);
    const payload = response.rows[0].payload;
    assert.equal(payload.governmentCount, records.length);
    assert.deepEqual(payload.governments, expected.slice(0, 3));
    assert.equal(payload.governments[0].recipientNameUnique, false,
      "the other Union town outside the selected page still prevents a name-only recipient claim");
  } finally { await pg.close(); }
});
