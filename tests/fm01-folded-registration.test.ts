import assert from "node:assert/strict";
import test from "node:test";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { isCivicPayloadPart, partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { registrationRecipientNamesSql } from "../lib/registration/recipient-names.ts";
import type { RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";

const ROOT = "ocd-division/country:us/state:wi", COUNTY = `${ROOT}/county:milwaukee`, ELSEWHERE = `${ROOT}/county:elsewhere`;
const NATIVE = "government:US-WI:cog:510410", GOVERNMENT = "wi:county:county-of-milwaukee", BOARD = "wtp-body/milwaukee#governing";
const AT = "2026-10-26T00:00:00.000Z";
const provenance = { sourceUrl: "https://example.gov/census", sourceOrg: "Census", collectedAt: AT, verifiedAt: AT };

test("folded state registration carries a county's source fields and recipient metadata through one place read", async () => {
  const { pg, publish } = await migratedReaderDb();
  try {
    await pg.exec(BOOTSTRAP_DDL.find(ddl => ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("))!);
    await pg.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Wisconsin','WI',NULL),($2,'place','Milwaukee County','WI',$1),($3,'place','Elsewhere County','WI',$1),
      ($4,'government','County of Milwaukee','WI',$2),($5,'body','County Board','WI',$4)`, [ROOT, COUNTY, ELSEWHERE, GOVERNMENT, BOARD]);
    const division = { ocdId: COUNTY, label: "Milwaukee County", divisionType: "county", tier: "local", state: "WI",
      parentOcdId: ROOT, lsad: null, funcstat: null, classfp: null, geoid: "55079", canonicalOcdId: COUNTY,
      canonicalMatch: "exact", sourceDataset: "TIGER_CB2023", provenance,
      sourceDescription: "Saved county boundary description. ".repeat(1200) };
    const government = { id: NATIVE, aliases: [GOVERNMENT], jurisdictionId: GOVERNMENT, state: "WI", name: "County of Milwaukee",
      kind: "GOVERNMENT", governmentClass: "COUNTY", nativeIds: { census_pid6: "510410" }, status: null, sourceVintage: "2022",
      website: "https://example.gov/county", officePhone: "414-555-0100", officeAddress: "901 N 9th Street", countyFips: "55079",
      // This source-sized association forces its row, array, government row,
      // government array and state root through the real payload codec.
      associations: [{ divisionId: COUNTY, layer: "county", geoid: "55079", basis: "SOURCE_CODE",
        sourceText: "Saved county association. ".repeat(1800) }], bodyIds: [BOARD], provenance };
    const other = { ...government, id: "government:US-WI:cog:other", aliases: [], jurisdictionId: "wi:county:other", name: "County of Elsewhere",
      nativeIds: { census_pid6: "other" }, associations: [{ ...government.associations[0], divisionId: ELSEWHERE, geoid: "55000" }], bodyIds: [] };
    const runtime = { formatVersion: 1, registry: { generatedAt: AT, bodies: [{ id: BOARD, ocdId: COUNTY, name: "County Board",
      censusId: "510410", bodyClass: "GOVERNING", bodyOrigin: "SOURCED", coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE",
      agendaSourceRef: null, meetingCadence: null, homepageUrl: "https://example.gov/county", demandCount: 0, sourceDataset: "GOV_DIRECTORY", provenance }],
    divisions: [division] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
    await publish({ id: "folded-runtime", value: runtime, at: AT, recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-WI:reader-registry-runtime", sourceId: "fixture" });
    const storeRegistration = async (id: string, competingName: string) => {
      const source = { formatVersion: 1, state: "WI", governments: [government, { ...other, name: competingName }],
        divisions: [division, { ...division, ocdId: ELSEWHERE, label: "Elsewhere County", geoid: "55000" }], bodies: [] };
      const encoded = partitionCivicPayload(source);
      assert.ok(isCivicPayloadPart(encoded.value), "the state root is folded, as it is in production");
      assert.ok(encoded.parts.filter(part => typeof part.payload === "object" && part.payload !== null && "kind" in part.payload && part.payload.kind === "array").length >= 3,
        "nested arrays are stored as payload parts too");
      for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await publish({ id, value: encoded.value, at: AT, recordClass: "REGISTRATION", scope: "US-WI:registration:v1", sourceId: "fixture" });
      return encoded.value;
    };
    let reads = 0;
    const query = async (sql: string, params: readonly unknown[] = []) => {
      reads++;
      return (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    };
    const folded = await storeRegistration("folded-registration-unique", "County of Elsewhere");
    const place = await readPlacePackage({ state: "WI", divisionIds: [COUNTY] }, query);
    assert.equal(reads, 1);
    assert.equal(place.registrationHeld, true);
    assert.deepEqual(place.divisions, [division]);
    assert.equal(place.governments.length, 1, "the other county's source fields stay outside this place");
    assert.deepEqual(place.governments[0], { ...government, recipientNameUnique: true, govDomains: [] });
    const board = place.bodies.find(row => row.id === BOARD);
    assert.ok(board);
    assert.deepEqual(board.recipientIds, [BOARD, GOVERNMENT, NATIVE].sort());
    assert.deepEqual(board.recipientNames, [government.name]);
    assert.equal(board.recipientState, "WI");

    const selected = `reader_place_payload($1::jsonb,$2::text[],NULL)`;
    type GovernmentPayload = { governments: RegistrationGovernmentListing[] };
    const projection = async (source: unknown) => (await pg.query<{ payload: GovernmentPayload; baseline: GovernmentPayload }>(
      `SELECT ${registrationRecipientNamesSql("$1::jsonb", selected)} AS payload,${selected} AS baseline`, [JSON.stringify(source), [NATIVE]])).rows[0];
    const projected = await projection(folded);
    const withoutMarkers = (payload: GovernmentPayload) => payload.governments.map(({ recipientNameUnique: _marker, ...row }) => row);
    assert.deepEqual(withoutMarkers(projected.payload), projected.baseline.governments,
      "the nonwindow annotation preserves its existing projection's rows and every source field");
    assert.equal(projected.payload.governments.find(row => row.id === NATIVE)?.recipientNameUnique, true,
      "a nonwindow government-id read receives the unique-name marker from the folded full-state source");

    const ambiguousFolded = await storeRegistration("folded-registration-ambiguous", "Milwaukee County");
    const ambiguous = await readPlacePackage({ state: "WI", divisionIds: [COUNTY] }, query);
    assert.equal(reads, 2, "each place request still issues exactly one statement");
    assert.equal(ambiguous.governments[0].recipientNameUnique, false);
    assert.deepEqual(ambiguous.bodies.find(row => row.id === BOARD)?.recipientNames, [],
      "an equivalent legal name outside the selected county blocks name-only attribution");
    assert.deepEqual(ambiguous.bodies.find(row => row.id === BOARD)?.recipientIds, board.recipientIds,
      "the existing parent and native identities survive a name ambiguity");
    const ambiguousProjection = await projection(ambiguousFolded);
    assert.deepEqual(withoutMarkers(ambiguousProjection.payload), ambiguousProjection.baseline.governments);
    assert.equal(ambiguousProjection.payload.governments.find(row => row.id === NATIVE)?.recipientNameUnique, false,
      "nonwindow projection does not mistake a selected subset for a unique full-state name");
  } finally { await pg.close(); }
});
