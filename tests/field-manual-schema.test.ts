import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { entryInSlice, newFieldManualEntry, type FieldManualQuery } from "../lib/control-plane/field-manual.ts";
import { openHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";
import { FIELD_MANUAL_SLICE_SQL, fieldManualSliceParams, pgFieldManualRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createFixMapRepository, FIX_MAP_DDL, methodWorksOf, stateOfPlace, type FixMapRow } from "../lib/method/fix-map.ts";

test("version 27 declares the manual's rows and the fix map, one statement per bootstrap entry", () => {
  assert.ok(BOOTSTRAP_VERSION >= 27);
  assert.ok(DECLARED_TABLES.includes("cp_field_manual_entries"));
  assert.ok(DECLARED_TABLES.includes("cp_fix_map"));
  assert.ok(DECLARED_TABLES.includes("cp_field_manual"), "the old document table stays declared while its copy is kept");
  for (const ddl of [...FIX_MAP_DDL, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL]) {
    assert.ok(BOOTSTRAP_DDL.includes(ddl));
    assert.equal(ddl.trim().split(";").filter((part) => part.trim() !== "").length, 1, "the HTTP driver prepares one statement per query");
  }
});

test("a slice is asked of Postgres by role, kind, record class, platform and the job's place and state", () => {
  const params = fieldManualSliceParams({ role: "SCOUT", recordClass: "Meetings", platform: "Legistar",
    ocdIds: ["ocd-division/country:us/state:az/county:pima/place:tucson#governing"] });
  assert.deepEqual(params, [["SCOUT", "SHARED"], null, "meetings", false, ["METHOD", "ROUTE", "MANIFEST_BRANCH"],
    ["ocd-division/country:us", "ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima",
      "ocd-division/country:us/state:az/county:pima/place:tucson"], "legistar", "az"]);
  assert.match(FIELD_MANUAL_SLICE_SQL, /value->'reach'->'places', '\[\]'::jsonb\) \?\| \$6::text\[\]/);
  assert.match(FIELD_MANUAL_SLICE_SQL, /ORDER BY id ASC LIMIT \d+/);
  assert.deepEqual(fieldManualSliceParams({ kinds: ["PLAYBOOK"], everywhere: true }).slice(0, 4), [null, ["PLAYBOOK"], null, true]);
});

test("where a method works is read per method, never the whole map", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const repo = createFixMapRepository(async (sql, params) => { calls.push({ sql, params }); return []; });
  assert.equal((await repo.worksFor([])).size, 0);
  assert.equal(calls.length, 0, "no methods, no read");
  await repo.worksFor(["a", "b", "a"]);
  await repo.workingMethods(50);
  assert.match(calls[0]!.sql, /WHERE method_id = ANY\(\$1::text\[\]\) AND state = 'WORKS' GROUP BY method_id/);
  assert.deepEqual(calls[0]!.params, [["a", "b"]]);
  assert.match(calls[1]!.sql, /DISTINCT ON \(method_id\) \* FROM cp_fix_map WHERE state = 'WORKS'/);
  assert.deepEqual(calls[1]!.params, [50]);
  const row = (placeId: string, at: string, state: FixMapRow["state"] = "WORKS"): FixMapRow =>
    ({ methodId: "m", placeId, state, triedAt: at, attemptId: null, cause: null, updatedAt: at });
  const held = methodWorksOf([row("ocd-division/country:us/state:az/county:pima", "2026-10-01T00:00:00Z"),
    row("ocd-division/country:us/state:nj/county:morris", "2026-10-03T00:00:00Z"), row("ocd-division/country:us/state:nh/place:concord", "2026-10-02T00:00:00Z", "FAILS")], ["m"]);
  assert.deepEqual(held.get("m"), { places: ["ocd-division/country:us/state:nj/county:morris", "ocd-division/country:us/state:az/county:pima"], states: ["az", "nj"] });
  assert.equal(stateOfPlace("ocd-division/country:us/state:tx/county:harris#governing"), "tx");
});

test("on the runner a slice is the held copy filtered by the slice rule: a later read moves only changed rows; without a copy it is asked of Postgres", async () => {
  const NOW = "2026-10-08T12:00:00.000Z";
  const entries = [
    newFieldManualEntry("t", "playbook-scout", { role: "SCOUT", kind: "PLAYBOOK", title: "Scout playbook", summary: "s", outcome: "SUCCEEDED" }),
    newFieldManualEntry("t", "playbook-parser", { role: "PARSER", kind: "PLAYBOOK", title: "Parser playbook", summary: "s", outcome: "SUCCEEDED" }),
    newFieldManualEntry("t", "az-lesson", { role: "SCOUT", kind: "LESSON", title: "AZ lesson", summary: "s", outcome: "SUCCEEDED", states: ["az"] }),
  ];
  const rows = entries.map((value) => ({ id: value.id, revision: 1, updated_at: NOW, value })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const seen: string[] = [];
  const sql: Sql = { query: async (text) => {
    seen.push(text);
    if (text.includes("SELECT now() AS read_at")) return [{ read_at: NOW }];
    if (text.includes("FROM cp_field_manual_entries") && !text.includes("changed_at >=") && !text.includes("id >")) return rows;
    return [];
  } };
  const query: FieldManualQuery = { role: "SCOUT", kinds: ["PLAYBOOK"], everywhere: true };
  const expected = entries.filter((entry) => entryInSlice(entry, query)).map((entry) => entry.id).sort();
  assert.deepEqual(expected, [entries[0]!.id]);

  const copies = openHeldCopies(await mkdtemp(join(tmpdir(), "manual-copies-")), { log: (line) => assert.fail(line) });
  const held = pgFieldManualRepository(sql, { copies });
  assert.deepEqual((await held.slice(query)).map((row) => row.id), expected);
  assert.ok(seen.every((text) => !text.includes("value->>'role'")), "the copy is filled by the whole read, not the slice SQL");
  seen.length = 0;
  assert.deepEqual((await held.slice({ role: "PARSER", kinds: ["PLAYBOOK"], everywhere: true })).map((row) => row.value.title), ["Parser playbook"]);
  assert.equal(seen.length, 2, "the clock and one page of changed rows");
  assert.match(seen[1]!, /WHERE changed_at >= \$1::timestamptz/);

  seen.length = 0;
  const plain = pgFieldManualRepository(sql);
  await plain.slice(query);
  assert.deepEqual(seen, [FIELD_MANUAL_SLICE_SQL]);
});
