import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { entryInSlice, newFieldManualEntry, normalizeEntry, type FieldManualQuery } from "../lib/control-plane/field-manual.ts";
import { openHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";
import { FIELD_MANUAL_SLICE_SQL, fieldManualSliceParams, pgFieldManualRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createFixMapRepository, FIX_MAP_DDL, methodWorksOf, stateOfPlace, type FixMapRow } from "../lib/method/fix-map.ts";

test("bootstrap declares the manual rows and fix-map summaries, one statement per entry", () => {
  assert.ok(BOOTSTRAP_VERSION >= 32);
  assert.ok(DECLARED_TABLES.includes("cp_field_manual_entries"));
  assert.ok(DECLARED_TABLES.includes("cp_fix_map"));
  assert.ok(DECLARED_TABLES.includes("cp_fix_method_summaries"));
  assert.ok(DECLARED_TABLES.includes("cp_field_manual"), "the old document table stays declared while its copy is kept");
  for (const ddl of [...FIX_MAP_DDL, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL]) {
    assert.ok(BOOTSTRAP_DDL.includes(ddl));
    assert.equal(ddl.replace(/\$\$[\s\S]*?\$\$/g, "").trim().split(";").filter((part) => part.trim() !== "").length, 1, "the HTTP driver prepares one statement per query");
  }
});

test("a slice is asked of Postgres by role, kind, record class, platform and the job's place and state", () => {
  const params = fieldManualSliceParams({ role: "SCOUT", recordClass: "Meetings", platform: "Legistar",
    ocdIds: ["ocd-division/country:us/state:az/county:pima/place:tucson#governing"] });
  assert.deepEqual(params, [["SCOUT", "SHARED"], null, "meetings", false,
    ["ocd-division/country:us", "ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima",
      "ocd-division/country:us/state:az/county:pima/place:tucson"], "legistar", "az"]);
  assert.match(FIELD_MANUAL_SLICE_SQL, /value->'reach'->'places', '\[\]'::jsonb\) \?\| \$5::text\[\]/);
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
  assert.match(calls[0]!.sql, /FROM cp_fix_method_summaries s JOIN unnest/);
  assert.deepEqual(calls[0]!.params, [["a", "b"], [null, null]]);
  assert.match(calls[1]!.sql, /DISTINCT ON \(method_id\) \* FROM cp_fix_map WHERE state = 'WORKS'/);
  assert.deepEqual(calls[1]!.params, [50]);
  const row = (placeId: string, at: string, state: FixMapRow["state"] = "WORKS"): FixMapRow =>
    ({ methodId: "m", placeId, state, triedAt: at, attemptId: null, cause: null, updatedAt: at });
  const held = methodWorksOf([row("ocd-division/country:us/state:az/county:pima", "2026-10-01T00:00:00Z"),
    row("ocd-division/country:us/state:nj/county:morris", "2026-10-03T00:00:00Z"), row("ocd-division/country:us/state:nh/place:concord", "2026-10-02T00:00:00Z", "FAILS")], ["m"]);
  assert.deepEqual(held.get("m"), { places: ["ocd-division/country:us/state:nj/county:morris", "ocd-division/country:us/state:az/county:pima"], states: ["az", "nj"] });
  assert.equal(stateOfPlace("ocd-division/country:us/state:tx/county:harris#governing"), "tx");
});

test("a runner slice reads scoped SQL and never opens or rewrites a national held copy", async () => {
  const NOW = "2026-10-08T12:00:00.000Z";
  const entry = normalizeEntry(newFieldManualEntry("t", "az-lesson", { role: "SCOUT", kind: "LESSON", title: "AZ lesson", summary: "s", outcome: "YIELDED", states: ["az"] }));
  const seen: string[] = [];
  const sql: Sql = { query: async text => { seen.push(text); return [{ id: entry.id, revision: 1, updated_at: NOW, value: entry }]; } };
  const dir = await mkdtemp(join(tmpdir(), "manual-copies-"));
  const copies = openHeldCopies(dir, { log: line => assert.fail(line) });
  const held = pgFieldManualRepository(sql, { copies });
  assert.deepEqual((await held.slice({ role: "SCOUT", state: "az" })).map(row => row.value), [entry]);
  assert.deepEqual(seen, [FIELD_MANUAL_SLICE_SQL]);
  assert.deepEqual(await readdir(dir), []);
});

test("SQL manual slices exclude other places and source routes while preserving transferable methods and ranking", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { projectFieldManual } = await import("../lib/control-plane/field-manual.ts");
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE cp_field_manual_entries (id text PRIMARY KEY, revision integer, updated_at timestamptz, value jsonb)");
    for (const ddl of BOOTSTRAP_DDL.filter(ddl => ddl.startsWith("CREATE INDEX") && /cp_field_manual_(reach|everywhere|transferable|platform_reach)/.test(ddl))) await db.exec(ddl);
    await db.exec(FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL);
    const states = ["al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc"];
    const entries = states.flatMap(state => Array.from({ length: 30 }, (_, i) => normalizeEntry(newFieldManualEntry("t", `${state}-${i}`, {
      role: "HUNTER", kind: "ROUTE", title: `${state} ${i}`, summary: "A place's source", outcome: "YIELDED", states: [state],
      ocdIds: [`ocd-division/country:us/state:${state}/county:${i}`], url: `https://${state}-${i}.gov` }))));
    entries.push(normalizeEntry(newFieldManualEntry("t", "transferable", { role: "SHARED", kind: "METHOD", title: "Shared method", summary: "Read the API", outcome: "YIELDED", platforms: ["legistar"] })));
    entries.push(...(["SCOUT", "HUNTER", "SHARED"] as const).map(role => normalizeEntry(newFieldManualEntry("t", `playbook-${role}`, {
      role, kind: "PLAYBOOK", title: role, summary: "Shared role instructions", outcome: "REFERENCE", portable: true }))));
    entries.push(...Array.from({ length: 18 }, (_, i) => normalizeEntry(newFieldManualEntry("t", `note-${i}`, {
      role: "HUNTER", kind: "NOTE", title: `Note ${i}`, summary: "Local instructions", outcome: "YIELDED",
      ocdIds: ["ocd-division/country:us/state:az/county:12"] }))));
    entries.push(...[
      { key: "state", kind: "LESSON", states: ["az"], recordClasses: ["meetings"] },
      { key: "body", kind: "LESSON", bodyIds: ["Council"] },
      { key: "portable", kind: "LESSON", portable: true, platforms: ["civicplus"] },
      { key: "other-method", kind: "METHOD", platforms: ["civicplus"] },
    ].map(({ key, ...fields }) => normalizeEntry(newFieldManualEntry("t", key, {
      role: "HUNTER", title: key, summary: "A bounded shared instruction", outcome: "YIELDED", ...fields }))));
    await db.query("INSERT INTO cp_field_manual_entries SELECT e->>'id', 1, now(), e FROM jsonb_array_elements($1::jsonb) e", [JSON.stringify(entries)]);
    await db.exec("ANALYZE cp_field_manual_entries");
    const query: FieldManualQuery = { role: "HUNTER", ocdIds: ["ocd-division/country:us/state:az/county:12"], limit: 12 };
    const repo = pgFieldManualRepository({ query: async (sql, params) => (await db.query(sql, [...(params ?? [])])).rows });
    const actual = (await repo.slice(query)).map(row => row.value);
    const expected = entries.filter(entry => entryInSlice(entry, query));
    assert.equal(actual.length, 25);
    assert.deepEqual(actual.map(e => e.id).sort(), expected.map(e => e.id).sort());
    assert.deepEqual(projectFieldManual({ entries: actual }, query), projectFieldManual({ entries: expected }, query));
    assert.equal(projectFieldManual({ entries: actual }, query).lines.length, 12);
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) < 15000);
    for (const selection of [
      { ...query, platform: "Legistar" }, { ...query, state: "AZ", recordClass: "Meetings" },
      { ...query, ocdIds: query.ocdIds!.map(place => place.toUpperCase()), bodyIds: ["Council"] },
      { role: "SCOUT" as const }, { kinds: [] }, { ...query, everywhere: true, platform: "legistar" }, {},
    ]) {
      const sliced = (await repo.slice(selection)).map(row => row.value);
      const matched = entries.filter(entry => entryInSlice(entry, selection));
      assert.deepEqual(sliced.map(e => e.id).sort(), matched.map(e => e.id).sort(), JSON.stringify(selection));
      assert.deepEqual(projectFieldManual({ entries: sliced }, selection), projectFieldManual({ entries: matched }, selection));
    }
    const plan = await db.query(`EXPLAIN ${FIELD_MANUAL_SLICE_SQL}`, [...fieldManualSliceParams(query), null]);
    assert.match(JSON.stringify(plan.rows), /cp_field_manual_reach_places/);
    assert.doesNotMatch(JSON.stringify(plan.rows), /Seq Scan/);
    const playbook = { role: "SCOUT" as const, kinds: ["PLAYBOOK"], everywhere: true };
    assert.equal((await repo.slice(playbook)).length, 2);
    const globalPlan = await db.query(`EXPLAIN ${FIELD_MANUAL_SLICE_SQL}`, [...fieldManualSliceParams(playbook), null]);
    assert.match(JSON.stringify(globalPlan.rows), /cp_field_manual_entries_kind/);
    assert.doesNotMatch(JSON.stringify(globalPlan.rows), /Seq Scan/);
  } finally { await db.close(); }
});
