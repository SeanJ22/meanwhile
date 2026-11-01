import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildStatePlaceMap } from "../lib/place-map/build.ts";
import { loadStatePlaceMap } from "../lib/place-map/load.ts";
import { legacyZipEntry, type LegacyZipShard } from "../lib/place-map/legacy.ts";
import { stateZipLocations } from "../lib/place-map/location-import.ts";
import { installPlaceMapQuery, lowestZipsForDivisions, readStateZipPlaces, readZipDivisions, readZipPlace, withPlaceMapReads } from "../lib/place-map/reader.ts";
import type { Query } from "../lib/facts/publish.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import type { RegistrationReference } from "../lib/registration/reference.ts";
import { identityEventTables, identitySourceTables, placeBoundaryMigration, readerIdentityMigration, zipLocationMigration } from "./helpers/reader-identity-db.ts";
import { wholeStateLowestZips } from "./helpers/place-map.ts";

const date = "2026-10-28T16:00:00.000Z";
const school = (state: string, name: string) => `ocd-division/country:us/state:${state}/school_district:${name}`;

/** Release 139 lost these school districts for mail-only ZIPs whose area is another ZIP's Census ZCTA. */
const cases = [
  { state: "DE", zip: "19712", zcta: "19706", lost: [school("de", "colonial_school_district")] },
  { state: "SC", zip: "29224", zcta: "29206", lost: [school("sc", "fort_jackson_schools"), school("sc", "richland_county_school_district_2_within_fort_jackson")] },
  { state: "MD", zip: "21123", zcta: "21401", lost: [school("md", "anne_arundel_county_public_schools")] },
] as const;

test("a mail-only ZIP keeps its linked ZCTA's school districts as ones that could govern it", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("lib/db/migrations/0035_r1_fact_store.sql", "utf8"));
    await identitySourceTables(db);
    await identityEventTables(db);
    await db.exec(readerIdentityMigration());
    await db.exec(placeBoundaryMigration());
    await db.exec(readFileSync("lib/db/migrations/RB-A7_expand.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
    await db.exec(readFileSync("lib/db/migrations/ZP-01_expand.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
    await db.exec(readFileSync("lib/db/migrations/0081_spn01e_page_marks.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
    await db.exec(zipLocationMigration());
    const query: Query = async (sql, params = []) => (await db.query(sql, [...params])).rows as Record<string, unknown>[];
    const transaction = <T,>(read: (query: Query) => Promise<T>) => db.transaction(tx => read(async (sql, params = []) => (await tx.query(sql, [...params])).rows as Record<string, unknown>[]));
    for (const { state, zip, zcta } of cases) {
      // The production builder's inputs for one linked pair: the ZCTA's held memberships and the acquired postal link.
      const registration = JSON.parse(readFileSync(`data/derived/registration/${state.toLowerCase()}.json`, "utf8")) as RegistrationReference;
      const shard = JSON.parse(readFileSync(`data/derived/zip-divisions/${zcta.slice(0, 2)}.json`, "utf8")) as LegacyZipShard;
      const map = buildStatePlaceMap({ registration, scopes: [], legacyZips: new Map([[zcta, legacyZipEntry(shard, zcta)!]]),
        legacyZctas: new Set([zcta]), boundaries: [], checkedAt: date, postalLinks: [{ zip, zcta, addressRequired: true }] });
      const zipLocations = (await stateZipLocations(".", state, date)).filter(row => row.zip === zip || row.zip === zcta);
      assert.equal(zipLocations.find(row => row.zip === zip)?.postal?.zcta, zcta);
      await loadStatePlaceMap({ transaction }, { ...map, zipLocations });
    }
    installPlaceMapQuery(query);
    await withPlaceMapReads(async () => {
      for (const { state, zip, zcta, lost } of cases) {
        const entry = await readZipPlace(zip), linked = await readZipPlace(zcta);
        assert.ok(entry, `${zip} is held`);
        for (const id of lost) {
          assert.ok(linked?.ids.includes(id), `${zcta} holds ${id}`);
          assert.ok(entry.ids.includes(id), `${zip} keeps ${id}`);
          assert.ok(entry.partial.includes(id), `${zip} names ${id} as one that could govern a box holder`);
          assert.ok((await readZipDivisions(zip)).some(division => division.ocdId === id && division.divisionType === "school_district"));
        }
        assert.deepEqual(entry.states, [state]);
        assert.ok((await divisionIdsForZipArea(zip, [])).every(id => !(lost as readonly string[]).includes(id)), "the ballot still waits for an address");
        const enumerated = (await readStateZipPlaces(state)).get(zip);
        for (const id of lost) assert.ok(enumerated?.ids.includes(id), `${state}'s ZIP list keeps ${id} for ${zip}`);
        const lowest = await wholeStateLowestZips(state);
        const keyed = await lowestZipsForDivisions(state,lost);
        for (const id of lost) {
          assert.equal(lowest.get(id), zcta, "a division's example ZIP holds it directly");
          assert.equal(keyed.get(id),lowest.get(id),"a keyed witness keeps the same direct postal-own ZIP");
        }
      }
    });
  } finally { installPlaceMapQuery(undefined); await db.close(); }
});
