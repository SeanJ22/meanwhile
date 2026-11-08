import assert from "node:assert/strict";
import test from "node:test";

import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readZipPlace, withPlaceMapReads } from "../lib/place-map/reader.ts";
import { stateContainersStatement } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { openStateMirror } from "../lib/reader/state-mirror.ts";
import { composeStateAnswer } from "../lib/reader/state-response.ts";
import { withStateSeam } from "../lib/reader/state-seam.ts";
import { registryFixtureForState } from "./helpers/promoted-fixtures.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const AT = "2026-10-19T12:00:00.000Z", ZIPS = ["03046", "03301", "03801"];
const person = (id: string, name: string) => ({ id, name, officeTitle: "State Representative", state: "NH", level: "STATE", nativeIds: {}, memberships: [],
  provenance: { sourceUrl: "https://gencourt.state.nh.us/", sourceOrg: "General Court", collectedAt: AT, verifiedAt: AT } });

test("a state read from its copy gives the answer the database gives, ZIP for ZIP, and the copy holds nothing of the other states", async () => {
  const source = await migratedFactDb();
  try {
    const geography = stateContainersStatement("NH");
    const groupings = (state: string, fips: string, overlaps: string[]) => [{ geoid: `${fips}02`, ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/cd:2`, label: "District 2",
      stateFips: fips, stateAbbr: state, overlaps: overlaps.map(zcta5 => ({ zcta5, whole: true, fraction: 1 })) }];
    await source.publish({ id: "geo", recordClass: geography.params[0] as "CENSUS_GEOGRAPHY", scope: String(geography.params[1]), sourceId: "census-geography", at: AT,
      value: { scopes: [{ type: "congressional_district", version: "2025", versionMeta: { plan: "119", states: ["NH", "VT"], retrievalComplete: true, sourceUrls: ["https://www.census.gov/"], observedAt: AT },
        groupings: [...groupings("NH", "33", ZIPS), ...groupings("VT", "50", ["05401"])] }] } });
    await source.publish({ id: "registry", recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("NH"), sourceId: "registry-reviewed-bindings", at: AT, value: registryFixtureForState("NH") });
    const roster = (state: string, id: string) => ({ formatVersion: 1, sourceId: "plural-openstates", jurisdiction: `US-${state}`, generatedAt: AT,
      roster: { scope: "33", generatedAt: AT, currentMembershipComplete: true, officeholders: [person(`plural:${state.toLowerCase()}:${id}`, `${id} Member`)],
        divisions: [{ officeholderId: `plural:${state.toLowerCase()}:${id}`, ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/sldl:27` }], unmatched: [] } });
    await source.publish({ id: "people", recordClass: "STATE_LEGISLATOR", scope: "US-NH:openstates-people:v1", sourceId: "plural-openstates", at: AT, value: roster("NH", "a") });
    // Another state's entry, which the copy must leave behind.
    await source.publish({ id: "vt", recordClass: "STATE_LEGISLATOR", scope: "US-VT:openstates-people:v1", sourceId: "plural-openstates", at: AT, value: roster("VT", "v") });

    const readFrom = async (read: () => Promise<unknown>) => { installFactReader(source.query); installReaderDatabaseQuery(async statements => Promise.all(statements.map(s => source.query(s.text, s.params)))); return read(); };
    const entries = new Map<string, Awaited<ReturnType<typeof readZipPlace>>>();
    for (const zip of ZIPS) entries.set(zip, await withPlaceMapReads(() => readZipPlace(zip)));
    const direct = await readFrom(async () => {
      const out = new Map<string, unknown>();
      for (const zip of ZIPS) out.set(zip, await withPlaceMapReads(() => composeStateAnswer("NH", zip, entries.get(zip)!)));
      return out;
    }) as Map<string, { body: Record<string, unknown> }>;

    const copy = await openStateMirror(source.query, "NH");
    try {
      installFactReader(async () => { throw new Error("the source is not read once the state is copied"); });
      installReaderDatabaseQuery(async () => { throw new Error("the source is not read once the state is copied"); });
      for (const zip of ZIPS) {
        const copied = await withStateSeam(copy.seam, () => withPlaceMapReads(() => composeStateAnswer("NH", zip, entries.get(zip)!)));
        assert.deepEqual(JSON.parse(JSON.stringify(copied)), JSON.parse(JSON.stringify(direct.get(zip))), zip);
      }
      assert.ok(Object.keys(direct.get("03046")!.body).length > 5);
      const held = await copy.seam.facts("SELECT key FROM civic_data_promotions ORDER BY key");
      assert.ok(held.length > 0 && held.every(row => !String(row.key).includes("US-VT")), "no other state's entry is copied");
      const groups = (await copy.seam.facts("SELECT payload->'scopes'->0->'groupings' AS groupings FROM civic_data_promotions WHERE record_class='CENSUS_GEOGRAPHY'"))[0]!.groupings as { stateAbbr: string }[];
      assert.deepEqual(groups.map(g => g.stateAbbr), ["NH"], "only the state's Census groupings are copied");
    } finally { await copy.close(); }
  } finally { await source.pg.close(); }
});
