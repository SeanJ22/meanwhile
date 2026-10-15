import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { readerEdgeInputFingerprint, checkReaderEdgePublicationInputs } from "../lib/civic-data/reader-edge-inputs.ts";
import { meetingPartitionId, meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import { outcomePartitionScope } from "../lib/civic-data/outcome-partitions.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import { UNCHANGED_CONFIRMATION_PREFIX } from "../lib/civic-data/unchanged-confirmation.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { ReaderArtifactStore } from "../lib/meetings/edge-store.ts";

const AT = "2026-10-15T12:00:00.000Z";
const body = "ocd-division/country:us/state:az/place:tucson#governing";
const scope = meetingPartitionScope("civicplus", body);
async function fixture() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY,value jsonb NOT NULL);
    CREATE INDEX door_state ON cp_doors((value #>> '{scopeState}'),id);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,scope text,current_version_id text,last_known_good_version_id text,promoted_at timestamptz);
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer,detail text,PRIMARY KEY(candidate_id,sequence));
    CREATE TABLE entity(id text PRIMARY KEY,state char(2));
    CREATE TABLE fact(id integer,entity_id text,status text,checked_at timestamptz);
    INSERT INTO entity VALUES ('fixture','AZ');
    INSERT INTO fact VALUES (1,'fixture','live','${AT}');`);
  await pg.exec(readFileSync(new URL("../lib/db/migrations/R4_reader_publication_inputs.sql", import.meta.url), "utf8"));
  const query: Query = async (sql, params = []) => (await pg.query<Record<string, unknown>>(sql,[...params])).rows;
  const put = async (recordClass: string, scope: string, version: string) => {
    await pg.query(`INSERT INTO civic_data_promotions VALUES($1,'fixture',$2,$3,$3,$4) ON CONFLICT(key)
      DO UPDATE SET current_version_id=EXCLUDED.current_version_id,last_known_good_version_id=EXCLUDED.current_version_id`,[`${recordClass}:${scope}`,scope,version,AT]);
  };
  await put("MEETING",scope,"source-1");
  await put("REGISTRY_RUNTIME_BINDING",REGISTRY_RUNTIME_SCOPE,"registry-1");
  await pg.query("INSERT INTO cp_doors VALUES ('door-1',$1::jsonb)",[JSON.stringify({ scopeState: "US-AZ", kind: "civicplus", bodyIds: [body],
    status: "OPEN", holds: ["meetings"], config: { url: "https://example.gov/calendar" }, meeting: { route: "ical" }, revision: 1 })]);
  return { pg, put, query, input: { state: "US-AZ", queryDoors: query, queryPromotions: query, queryFacts: query, codeVersion: "code-1" } };
}

test("publication identity follows promotions, 304 checks, OWNER facts and registry changes without reading another state", async () => {
  const f = await fixture();
  try {
    const original = await readerEdgeInputFingerprint(f.input);
    assert.equal(await readerEdgeInputFingerprint(f.input), original);
    await f.put("MEETING", meetingPartitionScope("civicplus", body.replace("state:az", "state:nm")), "unrelated-2");
    assert.equal(await readerEdgeInputFingerprint(f.input), original);
    await f.pg.exec("UPDATE cp_doors SET value=jsonb_set(value,'{revision}','2')");
    assert.equal(await readerEdgeInputFingerprint(f.input), original);
    await f.put("MEETING", scope, "source-2");
    const promoted = await readerEdgeInputFingerprint(f.input);
    assert.notEqual(promoted, original);
    await f.pg.query("INSERT INTO civic_data_candidate_events VALUES('source-2',1,'PROMOTED')");
    assert.equal(await readerEdgeInputFingerprint(f.input), promoted);
    await f.pg.query("INSERT INTO civic_data_candidate_events VALUES('source-2',2,$1)",[`${UNCHANGED_CONFIRMATION_PREFIX}{"observedAt":"${AT}"}`]);
    const confirmed = await readerEdgeInputFingerprint(f.input);
    assert.notEqual(confirmed, promoted);
    await f.pg.exec("INSERT INTO fact VALUES(2,'fixture','live','2026-10-15T12:00:00Z')");
    const ownerEdit = await readerEdgeInputFingerprint(f.input);
    assert.notEqual(ownerEdit, confirmed);
    await f.pg.exec("UPDATE fact SET checked_at='2026-10-15T13:00:00Z' WHERE id=2");
    const checked = await readerEdgeInputFingerprint(f.input);
    assert.notEqual(checked, ownerEdit);
    await f.put("REGISTRY_RUNTIME_BINDING",REGISTRY_RUNTIME_SCOPE,"registry-2");
    const registry = await readerEdgeInputFingerprint(f.input);
    assert.notEqual(registry, checked);
    await f.pg.exec(`UPDATE cp_doors SET value=jsonb_set(value,'{config,url}','"https://example.gov/new-calendar"')`);
    assert.notEqual(await readerEdgeInputFingerprint(f.input), registry);
    assert.notEqual(await readerEdgeInputFingerprint({ ...f.input, codeVersion: "code-2" }), await readerEdgeInputFingerprint(f.input));
  } finally { await f.pg.close(); }
});

test("state aggregates return three compact rows at largest-state volume and use the state index amid national noise", async () => {
  const f = await fixture();
  try {
    await f.pg.exec(`INSERT INTO cp_doors SELECT 'door-'||n,jsonb_build_object('scopeState','US-AZ','kind','civicplus','bodyIds',jsonb_build_array('body-'||n)) FROM generate_series(2,20802) n;
      INSERT INTO civic_data_promotions SELECT 'az-'||n,'fixture','US-AZ:body:'||n,'v-'||n,'v-'||n,'${AT}' FROM generate_series(1,20802) n;
      INSERT INTO civic_data_promotions SELECT 'tx-'||n,'fixture','US-TX:body:'||n,'vtx-'||n,'vtx-'||n,'${AT}' FROM generate_series(1,50000) n;
      ANALYZE civic_data_promotions;`);
    let calls = 0, bytes = 0;
    const read: Query = async (sql, params) => { const rows=await f.query(sql,params); calls++; bytes+=Buffer.byteLength(JSON.stringify(rows)); return rows; };
    const fingerprint = await readerEdgeInputFingerprint({ ...f.input, queryDoors: read, queryPromotions: read, queryFacts: read });
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(calls,3); assert.ok(bytes<300,`compact metadata: ${bytes}`);
    const plan = await f.pg.query("EXPLAIN SELECT key FROM civic_data_promotions WHERE civic_scope_state(scope)='US-AZ'");
    assert.match(JSON.stringify(plan.rows),/civic_data_promotions_state_idx/);
    await f.pg.exec("UPDATE civic_data_promotions SET current_version_id='unrelated' WHERE key='tx-50000'");
    assert.equal(await readerEdgeInputFingerprint(f.input),fingerprint);
    for (const [scope,state] of [[body,"US-AZ"],[meetingPartitionScope("civicplus",body),"US-AZ"],
      [outcomePartitionScope(meetingPartitionId("legistar",body)),"US-AZ"],
      ["ocd-division/country:us/district:dc#council","US-DC"],["ocd-division/country:us/territory:pr#council","US-PR"],
      ["US-AZ+US-NH+US-NJ:shared","US"],[REGISTRY_RUNTIME_SCOPE,"US"]]) {
      const result=await f.pg.query<{ state:string }>("SELECT civic_scope_state($1) AS state",[scope]);
      assert.equal(result.rows[0]!.state,state,scope);
    }
  } finally { await f.pg.close(); }
});

test("matching stored metadata avoids publication; absent metadata or a different input requires the canonical child", async () => {
  const f = await fixture();
  try {
    const fingerprint = await readerEdgeInputFingerprint(f.input);
    let held: { fingerprint: string; sequence: number } | null = { fingerprint, sequence: 4 };
    const store = { kind: "netlify-blobs", readPublicationIdentity: async (state: string | undefined) => {
      assert.equal(state, "AZ"); return held;
    }, readManifest: async () => { throw new Error("must not read the state manifest"); } } as unknown as ReaderArtifactStore;
    assert.equal((await checkReaderEdgePublicationInputs({ ...f.input, artifactStore: store })).current?.readerEdge, "CURRENT");
    held = null;
    assert.equal((await checkReaderEdgePublicationInputs({ ...f.input, artifactStore: store })).current, null);
    held = { fingerprint, sequence: 4 };
    await f.pg.exec("INSERT INTO fact VALUES(2,'fixture','live','2026-10-15T12:00:00Z')");
    assert.equal((await checkReaderEdgePublicationInputs({ ...f.input, artifactStore: store })).current, null);
  } finally { await f.pg.close(); }
});
