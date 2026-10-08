import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { FIELD_MANUAL_SLICE_SQL, fieldManualSliceParams } from "../lib/control-plane/repository/pg-store.ts";
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
