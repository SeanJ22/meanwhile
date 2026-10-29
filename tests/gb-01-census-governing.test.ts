import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { CENSUS_GOVERNING_CURSOR, censusBoards, censusGoverningOrder, makeCensusGoverningBodies } from "../lib/facts/census-governing.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { canonicalBodyId } from "../lib/facts/entities.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { queueUnbuiltPlacePages } from "../scripts/prepare-place-pages.mts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { Division } from "../lib/registry/types.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { factDb } from "./helpers/fact-db.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";

const ROOT = join(import.meta.dirname, "..");
const clocks = factClocks(null);
const purge = async () => ({ purged: true });
const OR = "ocd-division/country:us/state:or", PORTLAND = `${OR}/place:portland`, MULTNOMAH = `${OR}/county:multnomah`,
  SCHOOL = `${OR}/school_district:portland_school_district_1j`;
const CA = "ocd-division/country:us/state:ca", LA = `${CA}/county:los_angeles`;
const CENSUS = "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP";

/** The governments the ordinary registration load files, on the places they govern. */
async function seedGovernments(query: Query): Promise<void> {
  await query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
    ($1,'place','Oregon','OR',NULL),($2,'place','Portland city','OR',$1),($3,'place','Multnomah County','OR',$1),($4,'place','Portland School District 1J','OR',$1),
    ('or:city:city-of-portland','government','City Of Portland','OR',$2),('or:county:county-of-multnomah','government','County Of Multnomah','OR',$3),
    ('or:school:portland-sch-dist-1j','government','Portland Sch Dist 1j','OR',$4),
    ($5,'place','California','CA',NULL),($6,'place','Los Angeles County','CA',$5),('ca:county:county-of-los-angeles','government','County Of Los Angeles','CA',$6)`,
  [OR, PORTLAND, MULTNOMAH, SCHOOL, CA, LA]);
  await query(`INSERT INTO entity_place(entity_id,place_id) VALUES ('or:city:city-of-portland',$1),('or:county:county-of-multnomah',$2),
    ('or:school:portland-sch-dist-1j',$3),('ca:county:county-of-los-angeles',$4)`, [PORTLAND, MULTNOMAH, SCHOOL, LA]);
}

/** Every statement the step sends, inside and outside its transactions. */
function recorded(db: FactDb & { readonly query: Query }) {
  const sql: string[] = [];
  let transactions = 0;
  const query: Query = (text, params) => { sql.push(text); return db.query(text, params); };
  return { sql, get transactions() { return transactions; }, db: { query, transaction: <T>(work: (q: Query) => Promise<T>) => {
    transactions++;
    return db.transaction(q => work((text, params) => { sql.push(text); return q(text, params); }));
  } } };
}

const pgFacts = (pg: PGlite): FactDb & { readonly query: Query } => ({
  query: async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows,
  transaction: work => pg.transaction(tx => work(async (text, params = []) => (await tx.query<Record<string, unknown>>(text, [...params])).rows)),
});

test("Oregon comes first, and each government gets the board its Census division implies", () => {
  assert.deepEqual(censusGoverningOrder(["ak", "ca", "or", "wa"]), ["or", "ak", "ca", "wa"]);
  const boards = new Map(censusBoards(ROOT, "or").map(board => [board.government, board]));
  assert.equal(boards.get("or:city:city-of-portland")?.subject, "or:city:city-of-portland#governing");
  assert.equal(boards.get("or:county:county-of-multnomah")?.subject, "or:county:county-of-multnomah#governing");
  assert.equal(boards.get("or:school:portland-sch-dist-1j")?.subject, "or:school:portland-sch-dist-1j#board");
  assert.equal(boards.get("or:city:city-of-portland")?.record.mailingAddress, "1120 SW 5TH AVE, ROOM 1250, PORTLAND, OR, 97204-1912");
  assert.ok(!boards.has("or:special:port-of-portland"), "a special district is not a division the rule derives a board for");
});

test("one Oregon pass makes Portland's city, county and school boards through the door, and the place shows them as governing", async () => {
  const { pg } = await migratedReaderDb();
  try {
    await pg.exec(BOOTSTRAP_DDL.find(ddl => ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("))!);
    const db = pgFacts(pg);
    await seedGovernments(db.query);
    const report = await makeCensusGoverningBodies({ db, root: ROOT, states: ["or"], clocks, more: () => true, purge });
    assert.deepEqual(report.states, ["OR"]);
    assert.equal(report.live, 5, "the city's address, the county's address and website, the district's address and website");
    assert.deepEqual(report.refused, {});
    assert.deepEqual(await db.query("SELECT id,name,state,parent_id FROM entity WHERE kind='body' ORDER BY id"), [
      { id: "or:city:city-of-portland#governing", name: "City Of Portland governing board", state: "OR", parent_id: "or:city:city-of-portland" },
      { id: "or:county:county-of-multnomah#governing", name: "County Of Multnomah governing board", state: "OR", parent_id: "or:county:county-of-multnomah" },
      { id: "or:school:portland-sch-dist-1j#board", name: "Portland Sch Dist 1j school board", state: "OR", parent_id: "or:school:portland-sch-dist-1j" },
    ]);
    assert.deepEqual(await db.query(`SELECT f.entity_id,f.field,f.value,f.provenance_kind,s.url FROM fact f JOIN source_copy s ON s.id=f.source_copy_id
      WHERE f.entity_id='or:county:county-of-multnomah#governing' ORDER BY f.field`), [
      { entity_id: "or:county:county-of-multnomah#governing", field: "homepage", value: "http://www.multco.us/", provenance_kind: "OFFICIAL", url: CENSUS },
      { entity_id: "or:county:county-of-multnomah#governing", field: "mailing_address", value: "501 SE HAWTHORNE BLVD, STE 600, PORTLAND, OR, 97214-3588", provenance_kind: "OFFICIAL", url: CENSUS },
    ]);
    const quotes = await db.query("SELECT quote FROM fact WHERE produced_by = 'census-governing:OR' AND status = 'live'");
    assert.equal(quotes.length, 5);
    assert.ok(quotes.every(row => /^\d+,\d+,[A-Z]/.test(String(row.quote))), "each fact keeps the Census release's own row for its government");
    // The door queued each board's places; the scheduled page worker builds their ready pages before a reader opens them.
    const pages = await rebuildPlacePages({ db, purge, concurrency: 1 });
    assert.equal(pages.failed, 0);
    assert.equal(pages.remaining, 0);
    const ids = [PORTLAND, MULTNOMAH, SCHOOL];
    const place = await readPlacePackage({ state: "OR", divisionIds: ids }, db.query);
    const ready = await readPlacePackage({ state: "OR", divisionIds: [PORTLAND], placeId: PORTLAND }, db.query);
    assert.equal(ready.bodies.find(body => body.id === "or:city:city-of-portland#governing")?.name, "City Of Portland governing board",
      "Portland's ready page carries the board's held name");
    assert.deepEqual(place.bodies.map(body => body.id).sort(), ["or:city:city-of-portland#governing", "or:county:county-of-multnomah#governing", "or:school:portland-sch-dist-1j#board"]);
    const at = "2026-10-25T00:00:00.000Z";
    const provenance = { sourceUrl: CENSUS, sourceOrg: "U.S. Census Bureau", collectedAt: at, verifiedAt: at };
    const division = (ocdId: string, divisionType: string, label: string): Division => ({ ocdId, divisionType, label, tier: "local", state: "OR", parentOcdId: OR,
      lsad: null, funcstat: null, classfp: null, geoid: null, canonicalOcdId: ocdId, canonicalMatch: "exact", sourceDataset: "TIGER_CB2023", provenance });
    const runtime: RegistryRuntimeReadModel = { formatVersion: 1, registry: { generatedAt: at, bodies: [], divisions: [] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
    const coverage = stateCoverage({ state: "OR", registry: runtime, version: "gb-01" }, ids, 0, 0, [], place.bodies,
      [division(PORTLAND, "place", "Portland city"), division(MULTNOMAH, "county", "Multnomah County"), division(SCHOOL, "school_district", "Portland School District 1J")]);
    assert.deepEqual(coverage.bodies.map(body => [body.bodyId, body.name, body.bodyClass]).sort(), [
      ["or:city:city-of-portland#governing", "City of Portland", "GOVERNING"],
      ["or:county:county-of-multnomah#governing", "Multnomah County", "GOVERNING"],
      ["or:school:portland-sch-dist-1j#board", "Portland School District 1J", "GOVERNING"],
    ]);
    const city = coverage.bodies.find(body => body.bodyId === "or:city:city-of-portland#governing")!;
    assert.equal(city.officeContact?.address, undefined, "a published mailing address alone does not establish a physical office");
  } finally { await pg.close(); }
});

test("states go one at a time, Oregon first, resuming inside a state; a finished cycle costs one cursor read; nothing touches a registry", async () => {
  const db = await factDb();
  try {
    await seedGovernments(db.query);
    const watched = recorded(db);
    let checks = 0;
    const first = await makeCensusGoverningBodies({ db: watched.db, root: ROOT, states: ["ca", "or", "wa"], clocks, purge, more: () => ++checks <= 3 });
    assert.deepEqual(first.states, ["OR"]);
    const paused = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name=$1", [CENSUS_GOVERNING_CURSOR]))[0]!.position));
    assert.equal(paused.state, "or");
    assert.equal(paused.done, false, "the pass stopped inside Oregon at its deadline");
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE produced_by='census-governing:CA'"))[0]!.n, 0, "California waits for Oregon");

    const rest = await makeCensusGoverningBodies({ db: watched.db, root: ROOT, states: ["ca", "or", "wa"], clocks, purge, more: () => true });
    assert.deepEqual(rest.states, ["OR", "CA", "WA"]);
    const order = await db.query("SELECT produced_by, min(id)::int AS first, max(id)::int AS last FROM fact GROUP BY produced_by ORDER BY first");
    assert.deepEqual(order.map(row => row.produced_by), ["census-governing:OR", "census-governing:CA"]);
    assert.ok(Number(order[0]!.last) < Number(order[1]!.first), "every Oregon board is made before California starts");
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE kind='body' ORDER BY id"), [{ id: "ca:county:county-of-los-angeles#governing" },
      { id: "or:city:city-of-portland#governing" }, { id: "or:county:county-of-multnomah#governing" }, { id: "or:school:portland-sch-dist-1j#board" }]);
    assert.ok(watched.sql.length > 0);
    assert.ok(!watched.sql.some(sql => /civic_data_|registry/i.test(sql)), "no promotion, candidate or registry runtime write");

    const done = recorded(db);
    const idle = await makeCensusGoverningBodies({ db: done.db, root: ROOT, states: ["ca", "or", "wa"], clocks, purge, more: () => true });
    assert.deepEqual(idle.states, []);
    assert.deepEqual(done.sql, ["SELECT position FROM pass_cursor WHERE name = $1"]);
    assert.equal(done.transactions, 0);
  } finally { await db.pg.close(); }
});

test("the step's module reaches the store only through the front door and the pass cursor", () => {
  const source = readFileSync(join(ROOT, "lib", "facts", "census-governing.ts"), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map(match => match[1]);
  assert.ok(!imports.some(path => /registry\/(?!derive\.ts|types\.ts)|runtime|promotion|civic-data\/store/.test(path!)), imports.join(", "));
});

test("LA Metro's boards filed under Oregon move to California with their ids and facts; Oregon Metro's stay", async () => {
  const { pg } = await migratedReaderDb();
  try {
    await pg.exec(BOOTSTRAP_DDL.find(ddl => ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("))!);
    const db = pgFacts(pg);
    const metro = "ca:special:los-angeles-county-metro-transit-authority";
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES ($1,'place','Oregon','OR',NULL),($2,'place','California','CA',NULL),
      ($3,'place','Los Angeles County','CA',$2),($4,'government','Los Angeles County Metro Transit Authority','CA',$3),
      ('or:special:metro','government','Metro','OR',$1)`, [OR, CA, LA, metro]);
    await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES ($1,$2)", [metro, LA]);
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES ($1,'census-pid6','142274')", [metro]);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES (1,'https://webapi.legistar.com/v1/metro/bodies','https://webapi.legistar.com/v1/metro/bodies',now(),$1,'metro')", ["c".repeat(64)]);
    const la = Array.from({ length: 66 }, (_, i) => `${OR}#body:la-metro-board-${i}`);
    const oregon = Array.from({ length: 6 }, (_, i) => `${OR}#body:oregon-metro-board-${i}`);
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) SELECT id,'body','Board '||id,'OR',$2 FROM unnest($1::text[]) id`, [[...la, ...oregon], OR]);
    await db.query("INSERT INTO entity_host(entity_id,host) SELECT id,'webapi.legistar.com/v1/metro' FROM unnest($1::text[]) id", [la]);
    await db.query("INSERT INTO entity_host(entity_id,host) SELECT id,'webapi.legistar.com/v1/oregonmetro' FROM unnest($1::text[]) id", [oregon]);
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      SELECT id,f.field,to_jsonb(f.field),f.field,'live','OFFICIAL',1,'',now(),'legistar-members:metro' FROM unnest($1::text[]) id
      CROSS JOIN (VALUES ('name'),('member:ocd-person/one')) f(field)`, [la]);
    const facts = () => db.query("SELECT entity_id,field,value,status FROM fact ORDER BY id");
    const before = await facts();
    const migration = readFileSync(join(ROOT, "lib", "db", "migrations", "GB-01_la_metro_boards.sql"), "utf8");
    for (let run = 0; run < 2; run++) {
      for (const statement of migration.split("--> statement-breakpoint")) await pg.exec(statement);
      assert.deepEqual(await db.query("SELECT state,parent_id,count(*)::int n FROM entity WHERE kind='body' GROUP BY 1,2 ORDER BY 1"),
        [{ state: "CA", parent_id: metro, n: 66 }, { state: "OR", parent_id: OR, n: 6 }]);
      assert.deepEqual(await db.query("SELECT place_id,count(*)::int n FROM entity_place WHERE entity_id=ANY($1::text[]) GROUP BY 1", [la]), [{ place_id: LA, n: 66 }]);
      assert.equal((await db.query("SELECT count(*)::int n FROM entity_place WHERE entity_id=ANY($1::text[])", [oregon]))[0]!.n, 0);
      assert.deepEqual(await facts(), before, "ids, names and member facts are unchanged");
    }
    assert.equal(await canonicalBodyId(db.query, `${metro}#body:la-metro-board-7`), la[7]);
    assert.equal(await canonicalBodyId(db.query, `${LA}#body:la-metro-board-7`), la[7]);
    assert.equal(await canonicalBodyId(db.query, `${metro}#body:oregon-metro-board-1`), `${metro}#body:oregon-metro-board-1`);
    // The deployment queues every unbuilt place after its migrations; the runner's turn builds them.
    await queueUnbuiltPlacePages(db.query);
    await rebuildPlacePages({ db, purge, limit: Number.MAX_SAFE_INTEGER });
    const county = await readPlacePackage({ state: "CA", divisionIds: [LA] }, db.query);
    assert.equal(county.bodies.filter(body => la.includes(body.id)).length, 66, "Los Angeles County shows LA Metro's boards");
    const state = await readPlacePackage({ state: "OR", divisionIds: [OR] }, db.query);
    assert.ok(!state.bodies.some(body => la.includes(body.id)), "Oregon no longer shows them");
  } finally { await pg.close(); }
});
