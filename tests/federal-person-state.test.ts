import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { federalDirectoryScope } from "../lib/officials/federal-directory-data-plane.ts";
import { publishedFederalPersonState } from "../lib/civic-data/federal-person-state.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { currentReaderSelection } from "../lib/db/reader-route.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";

const NOW = "2026-10-20T12:00:00.000Z";
test("a native Congress profile resolves its exact published state in SQL without transferring another member", async () => {
  const pg = new PGlite(); let transferred = "", reads = 0;
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for (const [state, id] of [["TX", "congress:F000468"], ["NJ", "congress:G000123"]]) {
      const payload = { roster: { officeholders: [{ id, state, name: `${state} country member `.repeat(30_000) }] } };
      const encoded = partitionCivicPayload(payload);
      for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await insertPublishedSliceFixture(pg, { id: `directory-${state}`, sourceId: "congress-directory-project", recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(state), readModel: payload, storedReadModel: encoded.value, at: NOW });
    }
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      reads++; const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows; transferred += JSON.stringify(rows); return rows;
    })));
    assert.equal(await publishedFederalPersonState("congress:F000468"), "TX");
    assert.equal(reads, 1); assert.deepEqual(JSON.parse(transferred), [{ state: "TX" }]);
    assert.equal(await publishedFederalPersonState("congress:G000123"), "NJ");
    assert.equal(await publishedFederalPersonState("congress:Z999999"), null);
    assert.ok(!transferred.includes("country member"));
    const route = readerRoute("/api/funding/[target]", async (_request: Request) => currentReaderSelection()?.states);
    assert.deepEqual(await route(new Request("http://localhost/api/funding/congress:F000468")), ["TX"], "native member identity supplies its own state without a reader ZIP");
    assert.deepEqual(await route(new Request("http://localhost/api/funding/fec:H8TX07140?division=ocd-division/country:us/state:nj")), ["TX"], "a candidate's encoded state wins over an unrelated reader place");
    await pg.query("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id=$1", ["directory-TX"]);
    assert.equal(await publishedFederalPersonState("congress:F000468"), null, "unproven pointers never route a person to a guessed state");
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
