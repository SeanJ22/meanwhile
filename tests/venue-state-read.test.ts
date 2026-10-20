import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { currentVenueCache } from "../lib/meetings/venue-cache.ts";
import { LEGACY_VENUE_SCOPE } from "../lib/meetings/venue-projection.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

test("venue reads transfer only the selected state's pins and exact division-less tenant, then release them for the next state", async () => {
  const pg = new PGlite();
  const own = { id: "venue:ical:az:room", sourceId: "ical", bodyOcdId: "ocd-division/country:us/state:az/place:tucson", name: "AZ room" };
  const tenant = { id: "venue:diligent:curated:tenant/pcc:room", sourceId: "diligent", bodyOcdId: null, tenant: "pcc", name: "College room" };
  const foreign = { id: "venue:ical:nj:room", sourceId: "ical", bodyOcdId: "ocd-division/country:us/state:nj/place:example", name: "Other state ".repeat(100_000) };
  const unrelated = { id: "venue:diligent:curated:tenant/other:room", sourceId: "diligent", bodyOcdId: null, tenant: "other", name: "Unrelated college" };
  const payload = { kind: "venue-resolutions", records: [own, foreign, tenant, unrelated] };
  const store = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
  const scopes: string[] = [];
  store.readPromotion = async (_recordClass, scope) => { scopes.push(scope); return null; };
  let transferred = "";
  try {
    installFixtureDoors();
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    await insertPublishedSliceFixture(pg, {id: "v1", sourceId: "curated-reader-primary-sources", recordClass: "CURATED_READER_RECORD", scope: LEGACY_VENUE_SCOPE,
      readModel: payload, at: "2026-10-19T00:00:00Z"});
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      transferred += JSON.stringify(rows); return rows;
    })));
    const read = await readCuratedReaderProjection("venue-resolutions", { state: "AZ", store, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    assert.deepEqual(currentVenueCache().map(row => row.name), [own.name, tenant.name]);
    assert.ok(!transferred.includes("Other state"));
    assert.ok(!transferred.includes("Unrelated college"));
    assert.deepEqual(scopes, ["US-AZ:venue-resolutions"]);
    const legacyBody = await readCuratedReaderProjection("venue-resolutions", { state: "AZ", bodyOcdIds: [own.bodyOcdId], store });
    assert.equal(legacyBody.kind, "PROMOTED", "a body keeps its legacy pin before its new state pointer exists");
    assert.deepEqual(currentVenueCache().map(row => row.name), [own.name]);
    const scope = "US-AZ:venue-resolutions";
    const current = { kind: "venue-resolutions", records: [{ ...own, name: "Current AZ room" }, { ...own, id: "other-az-place", bodyOcdId: "ocd-division/country:us/state:az/place:mesa", name: "Other Arizona place ".repeat(100_000) }] };
    await insertPublishedSliceFixture(pg, {id: "v2", sourceId: "curated-reader-primary-sources", recordClass: "CURATED_READER_RECORD", scope,
      readModel: current, at: "2026-10-19T00:00:00Z"});
    transferred = "";
    const body = await readCuratedReaderProjection("venue-resolutions", { state: "AZ", bodyOcdIds: [own.bodyOcdId], store });
    assert.equal(body.metadata.scope, scope);
    assert.deepEqual(currentVenueCache().map(row => row.name), ["Current AZ room"]);
    assert.ok(!transferred.includes("Other Arizona place"), "a body does not transfer the rest of its new state pointer");
    assert.ok(!transferred.includes("College room"), "a body does not load another tenant's legacy pins");
    const empty = await readCuratedReaderProjection("venue-resolutions", { state: "AL", store, bypassCache: true });
    assert.equal(empty.kind, "PROMOTED", "an empty state slice is a valid inventory of reviewed pins");
    assert.deepEqual(currentVenueCache(), []);
    await assert.rejects(readCuratedReaderProjection("venue-resolutions", { store }), /STATE_REQUIRED/);
  } finally { installReaderDatabaseQuery(undefined); installFixtureDoors(); await pg.close(); }
});
