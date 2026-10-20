import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { readPlatformDirectory } from "../lib/control-plane/discovery/platform-directory.ts";
import { readPlatformOrders, orderedPlatformGovernments } from "../lib/control-plane/discovery/platform-orders.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";
import { platformRequestPacer } from "../lib/control-plane/discovery/platform-request-pacing.ts";

test("Admin's last pause applies without a config row; cancelled dispatches and closed leads never choose focus", async () => {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE cp_admin_config(id text,value jsonb);
    CREATE TABLE cp_log_research_intents(log_key text,position int,record jsonb);
    CREATE TABLE cp_lead_orders(value jsonb);`);
  const query = async (sql: string, params: readonly unknown[]) => (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
  const intent = async (position: number, record: unknown) => pg.query("INSERT INTO cp_log_research_intents VALUES('level-1',$1,$2)", [position, JSON.stringify(record)]);
  try {
    await intent(1, { kind: "INTENT", action: "PAUSE_RUNNER" });
    assert.deepEqual(await readPlatformOrders(query), { paused: true, subjects: [] });
    await intent(2, { kind: "INTENT", action: "DISPATCH", intentId: "one", note: "Harris County TX" });
    await intent(3, { kind: "INTENT", action: "DISPATCH", intentId: "two", note: "Cook County IL" });
    await intent(4, { kind: "INTENT", action: "CANCEL_DISPATCH", note: "one" });
    await intent(5, { kind: "INTENT", action: "RESUME_RUNNER" });
    await pg.query("INSERT INTO cp_lead_orders VALUES($1),($2)", [JSON.stringify({ open: true, rows: [{ state: "QUEUED", place: "ocd-division/country:us/state:ny/place:new_york" }] }),
      JSON.stringify({ open: false, rows: [{ state: "QUEUED", place: "ocd-division/country:us/state:ca" }] })]);
    const orders = await readPlatformOrders(query);
    assert.equal(orders.paused, false);
    assert.deepEqual(orders.subjects, ["ocd-division/country:us/state:ny/place:new_york", "assignment:dispatch:two", "dispatch:Cook County IL"]);
  } finally { await pg.close(); }
});

test("directory metadata avoids repeated downloads and a failed refresh retains its original source timestamp", async () => {
  const root = await mkdtemp(join(tmpdir(), "mp01-directory-")), repos = createMemoryRepositories(), vault = cycleVault(root);
  let now = "2026-10-20T00:00:00.000Z", requests = 0, fail = false;
  const runtime = { now: () => now, spaceOut: async () => {}, budget: { spent: () => false }, vault: vault.put,
    open: async () => { requests++; return { status: fail ? 503 : 200, body: "client\nexample\n", contentType: "text/csv", bytes: 15, location: null, transportError: null }; } };
  const input = { name: "Platform clients", url: "https://example.gov/clients.csv", repos, vault, runtime,
    validate: (text: string) => { assert.match(text, /^client\n/); } };
  try {
    const first = await readPlatformDirectory(input);
    assert.ok(first);
    assert.deepEqual(await readPlatformDirectory(input), first);
    assert.equal(requests, 1);
    now = "2026-10-21T00:00:00.000Z"; fail = true;
    assert.deepEqual(await readPlatformDirectory(input), first, "a retrieval failure cannot replace the working directory or freshen its evidence");
    assert.equal(requests, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent platform requests serialize on the publisher while unrelated hosts can proceed", async () => {
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const admitted: string[] = [];
  const pace = platformRequestPacer(async host => { admitted.push(host); }, async host => {
    admitted.push(host); if (admitted.filter(value => value === host).length === 1) await first;
  });
  const a = pace("https://alpha.legistar.com/Calendar.aspx"), b = pace("https://webapi.legistar.com/v1/beta/bodies");
  await pace("https://example.gov/");
  assert.deepEqual(admitted.sort(), ["example.gov", "legistar.com"]);
  release(); await Promise.all([a, b]);
  assert.equal(admitted.filter(host => host === "legistar.com").length, 2);
});

test("a district Admin order pages its published ZIP overlap and then one native government, using the ordered plan", async () => {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE civic_data_promotions(key text,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb);
    CREATE TABLE civic_data_candidates(id text,normalized_hash text);`);
  const government = { id: "government:US-NY:cog:1", jurisdictionId: "ny:city:fixture", aliases: [], bodyIds: [], state: "NY", name: "Fixture Government",
    countyFips: "36061", associations: [{ divisionId: "ocd-division/country:us/state:ny/place:new_york", basis: "SOURCE_CODE" }] };
  await pg.query("INSERT INTO civic_data_candidates VALUES('version',$1)", ["c".repeat(64)]);
  await pg.query("INSERT INTO civic_data_promotions VALUES('REGISTRATION:US-NY:registration:v1','REGISTRATION','US-NY:registration:v1','version',now(),$1)", [JSON.stringify({ governments: [government] })]);
  await pg.query("INSERT INTO civic_data_promotions VALUES('geo',$1,$2,'geography',now(),$3)", [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, JSON.stringify({ scopes: [
    { type: "congressional_district", version: "cd:119", groupings: [{ geoid: "3610", stateAbbr: "NY", overlaps: [{ zcta5: "10001" }] }] },
    { type: "congressional_district", version: "cd:118", groupings: [{ geoid: "3610", stateAbbr: "NY", overlaps: [{ zcta5: "10002" }] }] },
  ] })]);
  const query = async (sql: string, params: readonly unknown[]) => {
    assert.match(sql, /LIMIT 1/);
    const rows = (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    if (sql.includes("AS zip") && rows.length) assert.equal(rows[0].zip, "10001");
    return rows;
  };
  try {
    const found: string[] = [];
    for await (const page of orderedPlatformGovernments(async () => { throw new Error("No assignment download is needed"); }, query,
      ["geography:ny:congressional_district:3610:cd:119", "geography:ny:zcta:10001"])) found.push(page.government.id);
    assert.deepEqual(found, [government.id], "the same government is worked once even when two owner places overlap");
  } finally { await pg.close(); }
});
