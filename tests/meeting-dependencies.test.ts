import { readDerivedMeetingWiringForState } from "../lib/civic-data/derived-meeting-wiring.ts";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { readStateReference } from "../lib/control-plane/expansion/state-references.ts";
import { factDb } from "./helpers/fact-db.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-parts.ts";
import { preloadMeetingDependencies, readMeetingRegistryBodyIdsForState, readMeetingBodiesForPublication } from "../lib/civic-data/meeting-dependencies.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { currentCuratedReaderRecords } from "../lib/civic-data/curated-reader-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";

const ROOT = "ocd-division/country:us";
const AZ = `${ROOT}/state:az`;
const BODY = `${AZ}/place:fixture#council`;

test("referenced national promotions become indexed dependencies and a worker reads one body", async context => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY,payload jsonb NOT NULL);
      CREATE TABLE civic_data_promotions (record_class text,scope text,current_version_id text,payload jsonb,promoted_at timestamptz NOT NULL DEFAULT '2026-10-15T00:00:00Z',PRIMARY KEY(record_class,scope));`);
    await db.pg.exec(readFileSync(new URL("../lib/db/migrations/R4_meeting_dependencies.sql", import.meta.url), "utf8"));
    const divisions = [ROOT, AZ, `${AZ}/place:fixture`].map(ocdId => ({ ocdId, parentOcdId: ocdId === ROOT ? null : ocdId.slice(0,ocdId.lastIndexOf("/")) }));
    const bodies = [{ id: BODY, ocdId: `${AZ}/place:fixture`, name: "Fixture council" },
      ...Array.from({ length: 5000 }, (_, index) => ({ id: `${ROOT}/state:tx/place:p${index}#council`,
        ocdId: `${ROOT}/state:tx/place:p${index}`, name: `Texas council ${index}` }))];
    const payload = { registry: { generatedAt: "2026-10-15T00:00:00.000Z", divisions, bodies },
      longText: "evidence".repeat(10000) };
    const parts = partitionCivicPayload(payload);
    for (const part of parts.parts) await db.pg.query("INSERT INTO civic_data_payload_parts VALUES ($1,$2::jsonb)", [part.hash,JSON.stringify(part.payload)]);
    const expanded = await db.pg.query<{ value: unknown }>("SELECT expand_meeting_dependency_payload($1::jsonb) AS value", [JSON.stringify(parts.value)]);
    assert.deepEqual(expanded.rows[0].value, payload);
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRY_RUNTIME_BINDING',$1,'registry-1',$2::jsonb)", [REGISTRY_RUNTIME_SCOPE,JSON.stringify(parts.value)]);
    const venue = { id: "venue:fixture", bodyOcdId: `${AZ}/place:fixture`, sourceId: "ical", match: "Town Hall" };
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('CURATED_READER_RECORD',$1,'venue-1',$2::jsonb)",
      [`US:venue-resolutions:${AZ}/place:fixture`,JSON.stringify({ kind: "venue-resolutions", records: [venue] })]);
    const wiringRecord = { id: `ical:${BODY}`, status: "ACTIVE", row: { bodyId: BODY, ocdId: `${AZ}/place:fixture`, kind: "ICAL",
      route: "https://fixture.example/calendar.ics", officialHost: "fixture.example", state: "US-AZ" } };
    await db.pg.query("INSERT INTO civic_data_promotions(record_class,scope,current_version_id,payload) VALUES ('CURATED_READER_RECORD','US:meeting-source-wiring','wiring-1',$1::jsonb)",
      [JSON.stringify({ kind: "meeting-source-wiring", formatVersion: 1, records: [wiringRecord] })]);
    const initialWiring = await readDerivedMeetingWiringForState("az",db.query);
    assert.deepEqual(initialWiring.records,[wiringRecord]);
    assert.equal(initialWiring.versionId,"wiring-1");
    assert.deepEqual([...await readMeetingRegistryBodyIdsForState("az",db.query)],[BODY]);
    let rowsRead = 0, bytesRead = 0;
    await preloadMeetingDependencies({ bodyId: BODY, ocdId: `${AZ}/place:fixture` }, async (text, params) => {
      assert.doesNotMatch(text, /jsonb_array_elements|civic_data_promotions|civic_data_payload_parts/);
      const rows = await db.query(text,params);
      rowsRead += rows.length; bytesRead += Buffer.byteLength(JSON.stringify(rows));
      return rows;
    });
    assert.deepEqual(getRegistryRuntimeReadModel().registry.bodies.map(body => body.id), [BODY]);
    assert.equal(getRegistryRuntimeReadModel().registry.divisions.length, 3);
    assert.deepEqual(currentCuratedReaderRecords("venue-resolutions", []), [venue]);
    assert.ok(rowsRead <= 6, `bounded indexed rows: ${rowsRead}`);
    assert.ok(bytesRead < 3000, `bounded database transfer: ${bytesRead}`);
    const beforeNational = { rowsRead, bytesRead };
    let nationalGovernments = 0, largestStateBodies = 0, jurisdictions = 0, arizonaBodies = 0;
    const started = performance.now();
    for (const file of readdirSync("data/derived/place-reference").filter(name => /^[a-z]{2}\.json$/.test(name))) {
      const state = file.slice(0,2).toUpperCase();
      const units = readStateReference(process.cwd(), state, { units: "state" }).units;
      nationalGovernments += units.length; jurisdictions++;
      const rows = units.flatMap(unit => ["governing", "planning", "finance"].map(role => ({
        id: `${ROOT}/state:${state.toLowerCase()}/government:${unit.pid6}#${role}`,
        ocdId: `${ROOT}/state:${state.toLowerCase()}/government:${unit.pid6}`, name: unit.name,
      })));
      largestStateBodies = Math.max(largestStateBodies,rows.length);
      if (state === "AZ") arizonaBodies = rows.length;
      await db.pg.query(`INSERT INTO civic_meeting_dependencies
        SELECT 'body',row->>'id',$2,'national-fixture','registry-national',row
        FROM jsonb_array_elements($1::jsonb) row ON CONFLICT DO NOTHING`, [JSON.stringify(rows),`US-${state}`]);
      await db.pg.query(`INSERT INTO civic_meeting_dependencies
        SELECT 'wiring','ical:' || (row->>'id'),$2,'US:meeting-source-wiring','wiring-1',
          jsonb_build_object('id','ical:' || (row->>'id'),'status','ACTIVE','row',jsonb_build_object(
            'bodyId',row->>'id','ocdId',row->>'ocdId','kind','ICAL','route','https://fixture.example/calendar.ics',
            'officialHost','fixture.example','state',$2::text))
        FROM jsonb_array_elements($1::jsonb) row ON CONFLICT DO NOTHING`, [JSON.stringify(rows),`US-${state}`]);
    }
    assert.ok(jurisdictions >= 50);
    assert.ok(nationalGovernments >= 90_000);
    rowsRead = 0; bytesRead = 0;
    await preloadMeetingDependencies({ bodyId: BODY, ocdId: `${AZ}/place:fixture` }, async (text,params) => {
      const rows = await db.query(text,params);
      rowsRead += rows.length; bytesRead += Buffer.byteLength(JSON.stringify(rows)); return rows;
    });
    assert.deepEqual({ rowsRead, bytesRead }, beforeNational);
    const nationalWiring = await readDerivedMeetingWiringForState("az",db.query);
    assert.equal(nationalWiring.records.length,arizonaBodies+1);
    assert.ok(nationalWiring.records.every(record => record.row.state === "US-AZ"));
    assert.equal((await readMeetingRegistryBodyIdsForState("az",db.query)).size,arizonaBodies+1);
    const plan = await db.pg.query("EXPLAIN (ANALYZE,BUFFERS) SELECT value FROM civic_meeting_dependencies WHERE kind='body' AND member_id=$1", [BODY]);
    assert.match(JSON.stringify(plan.rows), /Index Scan|Index Only Scan|Bitmap Index Scan/);
    context.diagnostic(JSON.stringify({ jurisdictions, nationalGovernments, nationalBodies: nationalGovernments*3,
      largestStateBodies, rowsRead, bytesRead, runtimeMs: Math.round(performance.now()-started), plan: plan.rows }));
    await db.pg.query("UPDATE civic_data_promotions SET current_version_id='venue-2',payload=$1::jsonb WHERE record_class='CURATED_READER_RECORD' AND scope LIKE '%venue-resolutions%'",
      [JSON.stringify({ kind: "venue-resolutions", records: [{ ...venue, match: "Library" }] })]);
    const updated = await db.pg.query<{ value: { match: string } }>("SELECT value FROM civic_meeting_dependencies WHERE kind='venue'");
    assert.deepEqual(updated.rows.map(row => row.value.match), ["Library"]);
  } finally { await db.pg.close(); }
});

test("scoped venue successors replace legacy rows and district and territory bodies remain indexed", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY,payload jsonb NOT NULL);
      CREATE TABLE civic_data_promotions (record_class text,scope text,current_version_id text,payload jsonb,PRIMARY KEY(record_class,scope));`);
    await db.pg.exec(readFileSync(new URL("../lib/db/migrations/R4_meeting_dependencies.sql", import.meta.url), "utf8"));
    const bodies = [{ id: `${ROOT}/district:dc#governing`, ocdId: `${ROOT}/district:dc` },
      { id: `${ROOT}/territory:pr#governing`, ocdId: `${ROOT}/territory:pr` }];
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRY_RUNTIME_BINDING',$1,'registry-1',$2::jsonb)",
      [REGISTRY_RUNTIME_SCOPE,JSON.stringify({ registry: { generatedAt: "2026-10-15T00:00:00Z", bodies, divisions: [] } })]);
    assert.deepEqual([...await readMeetingRegistryBodyIdsForState("dc",db.query)],[bodies[0].id]);
    assert.deepEqual([...await readMeetingRegistryBodyIdsForState("pr",db.query)],[bodies[1].id]);
    const old = { id: "old", bodyOcdId: `${AZ}/place:fixture` };
    const tenant = { id: "tenant", bodyOcdId: null, tenant: "pcc" };
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('CURATED_READER_RECORD','US:venue-resolutions','legacy',$1::jsonb)",
      [JSON.stringify({ kind: "venue-resolutions", records: [old,tenant] })]);
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('CURATED_READER_RECORD',$1,'scoped',$2::jsonb)",
      [`US:venue-resolutions:${AZ}/place:fixture`,JSON.stringify({ kind: "venue-resolutions", records: [{ ...old,id: "new" }] })]);
    const rows = await db.query("SELECT member_id,scope FROM civic_meeting_dependencies WHERE kind='venue' ORDER BY member_id",[]);
    assert.deepEqual(rows,[{ member_id: "new",scope: `${AZ}/place:fixture` },{ member_id: "tenant",scope: "tenant:pcc" }]);
  } finally { await db.pg.close(); }
});

test("registered meeting bodies keep their source version and reviewed identities take precedence",async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY,payload jsonb NOT NULL);
      CREATE TABLE civic_data_promotions (record_class text,scope text,current_version_id text,payload jsonb,PRIMARY KEY(record_class,scope));`);
    await db.pg.exec(readFileSync(new URL("../lib/db/migrations/R4_meeting_dependencies.sql",import.meta.url),"utf8"));
    const division = { ocdId: `${AZ}/place:fixture`,parentOcdId: AZ,label: "Registered division" };
    const body = { id: BODY,ocdId: division.ocdId,name: "Registered body" };
    const registry = { registry: { generatedAt: "2026-10-15T00:00:00Z",bodies: [],divisions: [
      { ocdId: ROOT,parentOcdId: null },{ ocdId: AZ,parentOcdId: ROOT }] } };
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRY_RUNTIME_BINDING',$1,'registry-1',$2::jsonb)",
      [REGISTRY_RUNTIME_SCOPE,JSON.stringify(registry)]);
    const registration = { state: "AZ",bodies: [body],divisions: [division] };
    await db.pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRATION','US-AZ:registration:v1','registration-1',$1::jsonb)",[JSON.stringify(registration)]);
    assert.deepEqual(await readMeetingBodiesForPublication([BODY],db.query),[body]);
    await preloadMeetingDependencies({ bodyId: BODY,ocdId: division.ocdId },db.query);
    assert.equal(getRegistryRuntimeReadModel().registry.bodies[0]?.name,body.name);
    assert.equal(getRegistryRuntimeReadModel().registry.divisions.find(row => row.ocdId===division.ocdId)?.label,division.label);
    const reviewed = { ...body,name: "Reviewed body" };
    await db.pg.query("UPDATE civic_data_promotions SET current_version_id='registry-2',payload=$1::jsonb WHERE record_class='REGISTRY_RUNTIME_BINDING'",
      [JSON.stringify({ registry: { ...registry.registry,bodies: [reviewed],divisions: [...registry.registry.divisions,{ ...division,label: "Reviewed division" }] } })]);
    assert.deepEqual(await readMeetingBodiesForPublication([BODY],db.query),[reviewed]);
    await preloadMeetingDependencies({ bodyId: BODY,ocdId: division.ocdId },db.query);
    assert.equal(getRegistryRuntimeReadModel().registry.divisions.find(row => row.ocdId===division.ocdId)?.label,"Reviewed division");
    await db.pg.query("UPDATE civic_data_promotions SET current_version_id='registry-3',payload=$1::jsonb WHERE record_class='REGISTRY_RUNTIME_BINDING'",[JSON.stringify(registry)]);
    assert.deepEqual(await readMeetingBodiesForPublication([BODY],db.query),[body]);
    await db.pg.query("UPDATE civic_data_promotions SET current_version_id='registration-2' WHERE record_class='REGISTRATION'");
    await assert.rejects(readMeetingBodiesForPublication([BODY],db.query),/MEETING_DEPENDENCY_VERSION_MISMATCH/);
    await db.pg.query("UPDATE civic_data_promotions SET payload=$1::jsonb WHERE record_class='REGISTRATION'",[JSON.stringify({ ...registration,bodies: [],divisions: [] })]);
    assert.deepEqual(await db.query("SELECT member_id FROM civic_meeting_dependencies WHERE kind='registered-body'",[]),[]);
  } finally { await db.pg.close(); }
});
