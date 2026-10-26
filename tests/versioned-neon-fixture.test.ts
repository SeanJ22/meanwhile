import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { versionedSelect } from "../lib/db/versioned-query.ts";
import { unwrapVersionedStatement } from "./helpers/versioned-neon-fixture.ts";

test("canned wire fixtures recover original hoisted WITH statements and retain the version protocol", async () => {
  const originals = [
    "SELECT body FROM held WHERE id=$1",
    "WITH state_promotion AS (SELECT body FROM held WHERE id=$1) SELECT body FROM state_promotion",
    "WITH RECURSIVE roots AS (SELECT body FROM held WHERE id=$1), selected AS (SELECT * FROM roots)\n SELECT body FROM selected",
    "WITH written AS (UPDATE held SET body='new' WHERE id=$1 RETURNING body) SELECT body FROM written",
    "WITH marker AS (SELECT ') db04_source_deadbeef AS MATERIALIZED (' AS note), roots AS (SELECT body FROM held WHERE id=$1) SELECT body FROM roots",
    "WITH marker AS (SELECT $$) db04_source_deadbeef AS MATERIALIZED ($$ AS note), roots AS (SELECT body FROM held WHERE id=$1) SELECT body FROM roots",
    "WITH roots AS (SELECT body FROM held WHERE id=$1 /* ) nested /* ( */ ) */) SELECT body FROM roots -- ) trailing comment\n",
    String.raw`WITH marker AS (SELECT '\' AS note), roots AS (SELECT body FROM held WHERE id=$1) SELECT body FROM roots`,
  ];
  for (const original of originals) {
    const held = new Map<string, string>();
    const read = versionedSelect("fixture", new CivicReadCache({ read: async key => held.get(key) ?? null,
      write: async (key, value) => { held.set(key, value); } }));
    let passes = 0;
    const query = async (sql: string, params: readonly unknown[]) => {
      const native = unwrapVersionedStatement(sql, params);
      assert.equal(native.query.trim(), original.trim());
      assert.deepEqual(native.params, ["selected"]);
      const response = native.wrap({ command: "SELECT", rowCount: 1, fields: [{ name: "body", dataTypeID: 25 }], rows: [["held"]] });
      assert.equal(response.rows[0][0], passes++ ? null : "held", "the same fixture metadata suppresses repeated body bytes");
      return response.rows.map(row => Object.fromEntries(response.fields.map((field, index) => [field.name,
        field.dataTypeID === 16 && row[index] !== null ? row[index] === "t" : row[index]])));
    };
    assert.deepEqual(await read(query, original, ["selected"]), [{ body: "held" }]);
    assert.deepEqual(await read(query, original, ["selected"]), [{ body: "held" }]);
  }
});
