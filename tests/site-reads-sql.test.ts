import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assembleAuthorityRecords, type AuthorityPatch } from "../lib/meetings/authority-records.ts";
import { readPopulationFacts } from "../lib/reference/population-facts.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-parts.ts";

const pima = "ocd-division/country:us/state:az/county:pima";
const foreign = "ocd-division/country:us/state:ny/county:albany";

async function database(seed?: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE database_transfer_daily(day date);
    CREATE TABLE entity(id text PRIMARY KEY,kind text,state char(2));
    CREATE TABLE entity_place(entity_id text,place_id text);
    CREATE TABLE fact(id bigint PRIMARY KEY,entity_id text,field text,status text);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,candidate jsonb,retrieved_at timestamptz);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,current_version_id text,payload jsonb);
    CREATE TABLE civic_data_reader_projections(key text PRIMARY KEY,sequence integer,payload jsonb,composed_from jsonb DEFAULT '[]');`);
  if (seed) await seed(db);
  for (const name of [
    "0036_ne01.sql",
    "NE-01_index.sql",
    "NE-01_index_00.sql",
    "NE-01_index_01.sql",
    "NE-01_index_02.sql",
    "NE-01_index_03.sql",
    "NE-01_index_04.sql",
    "NE-01_index_05.sql",
    "NE-01_index_06.sql",
    "NE-01_index_07.sql",
    "NE-01_index_08.sql",
    "NE-01_index_09.sql",
    "NE-01_index_10.sql",
    "NE-01_index_11.sql",
    "NE-01_index_12.sql",
    "NE-01_index_13.sql",
    "NE-01_index_14.sql",
    "NE-01_index_15.sql",
    "NE-01_index_versions.sql",
  ]) {
    for (const statement of readFileSync(`lib/db/migrations/${name}`, "utf8").split("--> statement-breakpoint")) await db.exec(statement);
  }
  return db;
}

async function selected(db: PGlite, pointer: string, keys: string[], point: readonly number[] | null = null) {
  const { rows: [row] } = await db.query<{ base: unknown; patches: AuthorityPatch[] }>(
    "SELECT base,reader_selected_records(pointer_key,$2,$3) patches FROM reader_place_roots WHERE pointer_key=$1", [pointer, keys, point]);
  return assembleAuthorityRecords(row.base, row.patches, { keys: new Set(keys) });
}

test("key-vote misses preserve every card and fetched roll while excluding other members' positions", async () => {
  const db = await database();
  try {
    const value = { selectionVersion: "v1", snapshot: { entries: [{ id: "held-law", title: "Held law" }] },
      positions: { positions: { "held-law|senate|119-1:1": { "congress:A000001": "YES", "congress:B000002": "NO" }, "held-law|senate|119-1:2": {} } } };
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["key-votes", "v1", value]);
    assert.deepEqual(await selected(db, "key-votes", ["congress:A000001"]), {
      ...value, positions: { positions: { "held-law|senate|119-1:1": { "congress:A000001": "YES" }, "held-law|senate|119-1:2": {} } },
    });
  } finally { await db.close(); }
});

test("partition iteration preserves interleaved source order without joining every group into one value", async () => {
  const db = await database();
  try {
    const rows = Array.from({ length: 2000 }, (_, n) => ({ state: n % 2 ? "CA" : "TX", id: n, text: "Source row ".repeat(30) }));
    const encoded = partitionCivicPayload(rows);
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    const actual = await db.query<{item: unknown}>("SELECT reader_payload_value(item) item FROM reader_payload_members($1) ORDER BY ordinal_index", [encoded.value]);
    assert.deepEqual(actual.rows.map(row => row.item), rows);
  } finally { await db.close(); }
});

test("fact clocks invalidate the states and families that display a changed field", async () => {
  const db = await database();
  try {
    await db.exec(`INSERT INTO entity VALUES('az-board','body','AZ'),('tx-board','body','TX'),('person-one','person','AZ'),('sitting','meeting','TX');
      INSERT INTO fact VALUES(1,'az-board','member:person-one','live'),(2,'tx-board','member:person-one','live');`);
    const versions = async (family: string) => (await db.query<{state: string; revision: string}>(
      "SELECT state,revision::text FROM reader_fact_state_versions WHERE family=$1 ORDER BY state", [family])).rows;
    const before = await versions("registry-runtime");
    await db.exec("INSERT INTO fact VALUES(3,'person-one','phone','live')");
    const changed = await versions("registry-runtime");
    assert.deepEqual(changed.map(row => row.state), ["az", "tx"]);
    assert.ok(changed.every(row => row.revision !== before.find(old => old.state === row.state)?.revision));
    await db.exec("INSERT INTO fact VALUES(4,'tx-board','comment:period','live'),(5,'sitting','name','live')");
    assert.deepEqual(await versions("registry-runtime"), changed);
    assert.deepEqual((await versions("comment-access")).map(row => row.state), ["tx"]);
    await db.query("INSERT INTO entity VALUES($1,'body',NULL)", [`${pima}#new-board`]);
    await db.query("INSERT INTO fact VALUES(6,$1,'comment:period','live')", [`${pima}#new-board`]);
    assert.deepEqual((await versions("comment-access")).map(row => row.state), ["az", "tx"]);
    const prior = await versions("registry-runtime");
    await db.exec("INSERT INTO fact VALUES(7,'person-one','phone:tx-board','live')");
    const scoped = await versions("registry-runtime");
    assert.equal(scoped.find(row => row.state === "az")?.revision, prior.find(row => row.state === "az")?.revision);
    assert.notEqual(scoped.find(row => row.state === "tx")?.revision, prior.find(row => row.state === "tx")?.revision);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["REGISTRY_RUNTIME_BINDING:owned", "v1", {
      registry: { bodies: [{ id: "az-board", ocdId: pima }] },
    }]);
    await db.exec("INSERT INTO fact VALUES(8,'az-board','office_phone','live')");
    assert.equal((await db.query<{ owner_key: string }>("SELECT owner_key FROM reader_fact_place_versions WHERE family='registry-runtime' AND owner_key=$1", [pima])).rows[0].owner_key, pima);
  } finally { await db.close(); }
});

test("indexed misses follow civic identities without following an election, door or source", async () => {
  const db = await database();
  try {
    const contests = Array.from({ length: 729 }, (_, id) => ({ id: `contest:${id}`, ocdId: id === 0 ? pima : foreign,
      electionId: "shared-election", doorId: "shared-door", geoid: "04001", source: { id: "shared-provider" } }));
    const candidacies = contests.map(contest => ({ id: `candidate:${contest.id}`, contestId: contest.id,
      personId: `person:${contest.id}`, electionId: "shared-election", doorId: "shared-door" }));
    const value = { contests, candidacies };
    const encoded = partitionCivicPayload(value);
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["ballot", "v1", encoded.value]);
    assert.deepEqual(await selected(db, "ballot", [pima]), { contests: [contests[0]], candidacies: [candidacies[0]] });
    assert.equal((await db.query<{current_version_id: string}>("SELECT current_version_id FROM civic_data_promotions")).rows[0].current_version_id, "v1");
  } finally { await db.close(); }
});

test("backfill leaves canonical pointers untouched and later changes remove obsolete indexed facts", async () => {
  const db = await database();
  try {
    const value = { bodies: [{ id: `${pima}#board`, ocdId: pima }, { id: `${foreign}#board`, ocdId: foreign }] };
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["registry", "v1", value]);
    await db.exec(`CREATE FUNCTION refuse_pointer_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'canonical pointer rewritten'; END $$;
      CREATE TRIGGER protect_pointer BEFORE UPDATE ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION refuse_pointer_rewrite();`);
    await db.exec("SELECT reader_index_projection(key,current_version_id,payload) FROM civic_data_promotions");
    assert.deepEqual(await selected(db, "registry", [pima]), { bodies: [value.bodies[0]] });
    const [before] = (await db.query<{ xmin: string }>("SELECT xmin::text FROM reader_place_records WHERE pointer_key='registry' AND selectors && $1", [[pima]])).rows;
    await db.query("SELECT reader_index_projection($1,$2,$3)", ["registry", "v2", { bodies: [value.bodies[0]] }]);
    assert.deepEqual(await selected(db, "registry", [foreign]), { bodies: [] });
    assert.equal((await db.query<{ xmin: string }>("SELECT xmin::text FROM reader_place_records WHERE pointer_key='registry' AND selectors && $1", [[pima]])).rows[0].xmin, before.xmin);
    assert.equal((await db.query<{current_version_id: string}>("SELECT current_version_id FROM civic_data_promotions")).rows[0].current_version_id, "v1");
  } finally { await db.close(); }
});

test("fact readback dispositions travel only with the members shown", async () => {
  const db = await database();
  try {
    const own = { sourceId: "roster:own", canonicalId: "roster:own", state: "READER_ELIGIBLE" };
    const roster = { bodyId: `${pima}#board`, members: [{ id: own.canonicalId }] };
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["registry", "v1", {
      bodies: [{ id: roster.bodyId, ocdId: pima }], bodyRosters: [roster],
      rosterReaderDispositions: [own, { ...own, sourceId: "roster:other", canonicalId: "roster:other" }],
    }]);
    const read = await selected(db, "registry", [pima]) as { rosterReaderDispositions: unknown[] };
    assert.deepEqual(read.rosterReaderDispositions, [own]);
  } finally { await db.close(); }
});

test("nearby meeting misses use the location index and retain the carried footer", async () => {
  const db = await database();
  try {
    const near = { id: "near", ocdId: foreign, location: { lat: 32.2, lng: -110.9 }, carried: { lastFreshAt: "2026-10-01T12:00:00Z" } };
    const far = { id: "far", ocdId: foreign, location: { lat: 40, lng: -74 }, carried: { lastFreshAt: "2026-09-30T12:00:00Z" } };
    await db.query("INSERT INTO civic_data_reader_projections(key,sequence,payload) VALUES($1,$2,$3)", ["meeting", 1,
      { counts: { carried: 2, total: 2 }, meetings: [near, far] }]);
    const read = await selected(db, "prepared:meeting", [pima], [-110.9, 32.2]) as { meetings: unknown[]; carriedSummary: unknown };
    assert.deepEqual(read.meetings, [near]);
    assert.deepEqual(read.carriedSummary, { count: 2, lastFreshAt: null });
    const limited = await db.query<{ patches: AuthorityPatch[] }>(
      "SELECT reader_selected_records($1,$2,$3,true,NULL,25) patches", ["prepared:meeting", [pima], [-110.1, 32.2]]);
    assert.deepEqual(limited.rows[0].patches, []);
    await db.query("UPDATE civic_data_reader_projections SET sequence=2,payload=$1 WHERE key='meeting'", [
      { counts: { total: 1 }, meetings: [{ ...near, location: far.location }] }]);
    assert.deepEqual((await selected(db, "prepared:meeting", [pima], [-110.9, 32.2]) as {meetings: unknown[]}).meetings, []);
  } finally { await db.close(); }
});

test("a map miss excludes agenda text and selects only the place's freshness couplings", async () => {
  const db = await database();
  try {
    const own = { contractId: `meetings:legistar:${encodeURIComponent(`${pima}#board`)}`, versionId: "own" };
    const other = { contractId: `meetings:legistar:${encodeURIComponent(`${foreign}#board`)}`, versionId: "other" };
    await db.query("INSERT INTO civic_data_reader_projections VALUES($1,$2,$3,$4)", ["map", 1,
      { meetings: [{ id: "meeting", bodyId: `${pima}#board`, ocdId: pima }], agendaDocuments: [{ id: "doc", meetingId: "meeting", text: "agenda" }] }, [own, other]]);
    const { rows: [row] } = await db.query<{ patches: AuthorityPatch[]; coupling: unknown }>(
      "SELECT reader_selected_records($1,$2,NULL,false) patches,reader_selected_couplings($1,$2) coupling", ["prepared:map", [pima]]);
    assert.deepEqual(row.patches.map(patch => patch.path[0]), ["meetings"]);
    assert.deepEqual(row.coupling, [own]);
  } finally { await db.close(); }
});

test("indexed vote misses follow descriptions without following the other voters", async () => {
  const db=await database();
  try {
    const own="congress:A000001",other="congress:B000002";
    const value={snapshot:{votes:[{id:"senate:119:1",title:"Held vote"},{id:"senate:119:2",title:"Other vote"}],
      positions:[{officeholderId:own,voteId:"senate:119:1",position:"YES"},{officeholderId:other,voteId:"senate:119:1",position:"NO"}]}};
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)",["votes","v1",value]);
    assert.deepEqual(await selected(db,"votes",[own]),{snapshot:{votes:[{...value.snapshot.votes[0],readerPartyVoters:{yes:[own],no:[other]}}],positions:[value.snapshot.positions[0]]}});
    const state={rollCalls:[{id:"nj:1",billTitle:"Held"}],positions:[
      {officeholderId:own,rollCallId:"nj:1",position:"YES"},{officeholderId:other,rollCallId:"nj:1",position:"NO"}]};
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)",["state","v1",state]);
    assert.deepEqual(await selected(db,"state",[own]),{rollCalls:state.rollCalls,positions:[state.positions[0]]});
  } finally { await db.close(); }
});

test("ballot misses use place versions and carry only the selected election's metadata", async () => {
  const db = await database();
  try {
    const ballots = Object.fromEntries(Array.from({ length: 100 }, (_, n) => [`election:${n}`, {
      election: { id: `election:${n}`, title: `Official election ${n}`, source: "Official metadata ".repeat(100) },
      contests: [{ id: `contest:${n}`, ocdId: n === 0 ? pima : foreign }],
      candidacies: [{ id: `candidacy:${n}`, contestId: `contest:${n}`, personId: `person:${n}` }],
    }]));
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["ballot", "v1", { ballots }]);
    const root = (await db.query<{ base: unknown }>("SELECT base FROM reader_place_roots WHERE pointer_key='ballot'")).rows[0];
    assert.deepEqual(root.base, { ballots: {} });
    const actual = await selected(db, "ballot", [pima]);
    assert.deepEqual(actual, { ballots: { "election:0": { ...ballots["election:0"], districtFamilies: [] } } });
    const places = (await db.query<{ owner_key: string }>("SELECT owner_key FROM reader_place_versions WHERE pointer_key='ballot' AND state='az'")).rows;
    assert.deepEqual(places, [{ owner_key: pima }]);
  } finally { await db.close(); }
});


test("population keeps its scoped reader without duplicating the national source in the reader index", async () => {
  const db = await database();
  try {
    await db.exec("ALTER TABLE civic_data_promotions ADD COLUMN record_class text,ADD COLUMN scope text");
    const fact = (code: string) => ({ geography: "state", code, name: "Recorded state", population: 100,
      marginOfError: null, attribution: { sourceKind: "OFFICIAL", period: "2024" } });
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5)", ["CENSUS_REFERENCE:acs-population", "v1",
      { state: [fact("04"), fact("36")], zcta: [], geographies: [] }, "CENSUS_REFERENCE", "acs-population"]);
    const actual = await readPopulationFacts(["state:04"], async statements => Promise.all(statements.map(async statement =>
      (await db.query<Record<string, unknown>>(statement.text, [...statement.params])).rows)));
    assert.deepEqual(actual, { kind: "HELD", rows: [fact("04")] });
    assert.equal((await db.query("SELECT * FROM reader_place_roots WHERE pointer_key='CENSUS_REFERENCE:acs-population'")).rows.length, 0);
  } finally { await db.close(); }
});


test("existing facts start with the canonical place owner before publication", async () => {
  const db = await database(async db => {
    await db.exec("INSERT INTO entity VALUES('held-board','body','AZ'); INSERT INTO fact VALUES(1,'held-board','office_phone','live'),(2,'held-board','comment:period','live')");
    await db.query("INSERT INTO civic_data_candidates VALUES($1,$2,now())", ["held-version", {}]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3)", ["REGISTRY_RUNTIME_BINDING:owned", "held-version", {
      registry: { bodies: [{ id: "held-board", ocdId: pima }] },
    }]);
  });
  try {
    const rows = (await db.query<{ family: string; owner_key: string }>("SELECT family,owner_key FROM reader_fact_place_versions ORDER BY family")).rows;
    assert.deepEqual(rows, [{ family: "comment-access", owner_key: pima }, { family: "registry-runtime", owner_key: pima }]);
    await db.exec("UPDATE fact SET status='archived' WHERE id=2");
    assert.deepEqual((await db.query<{ owner_key: string }>("SELECT DISTINCT owner_key FROM reader_fact_place_versions")).rows, [{ owner_key: pima }]);
  } finally { await db.close(); }
});
