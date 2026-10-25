import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "../lib/db/client.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

test("candidate fields cross Postgres inline or through just their own payload parts, including an older pinned version", async t => {
  const pg = new PGlite(), originalFetch = neonConfig.fetchFunction, originalUrl = process.env.DATABASE_URL;
  const originalReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  process.env.DATABASE_URL = "postgres://readonly:fixture@ep-candidate-path.invalid/neondb";
  t.after(async () => {
    neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    await pg.close();
  });
  await pg.exec("CREATE TABLE civic_data_candidates(id text PRIMARY KEY,candidate jsonb); CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)");
  const captures = [{ requestedUrl: "https://publisher.example/old-release", rawHash: "old-capture" }];
  const ref = (hash: string) => ({ $civicPayloadPart: hash.repeat(64) });
  const unused = "unrelated_roster_must_not_cross_the_wire";
  await pg.query("INSERT INTO civic_data_candidates VALUES('inline',$1),('partitioned',$2),('newer',$3)", [
    { normalizedPayload: { captures, roster: unused.repeat(10_000) }, readModel: unused.repeat(10_000) }, ref("a"),
    { normalizedPayload: { captures: [{ rawHash: "new-capture" }] } },
  ]);
  for (const [hash, payload] of [
    ["a", { kind: "object", value: { normalizedPayload: ref("b"), readModel: ref("d") } }],
    ["b", { kind: "object", value: { captures: ref("c"), roster: ref("d") } }],
    ["c", captures],
  ] as const) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [hash.repeat(64), payload]);
  const bodies: string[] = [], statements: string[] = [];
  neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    assert.ok(!request.queries, "readonly field reads never write or fetch a bulk candidate copy");
    statements.push(request.query);
    assert.match(request.query, /^\s*(WITH|SELECT)\b/i);
    const result = await pg.query<Record<string, unknown>>(request.query, request.params);
    const body = JSON.stringify({ command: "SELECT", rowCount: result.rows.length, rowAsArray: true, fields: result.fields,
      rows: result.rows.map(row => result.fields.map(field => row[field.name] === null ? null : typeof row[field.name] === "object"
        ? JSON.stringify(row[field.name]) : String(row[field.name]))) });
    bodies.push(body);
    return new Response(body);
  };
  const store = new PostgresRoutineDataStore();
  for (const id of ["inline", "partitioned"]) assert.deepEqual(await store.readCandidatePath(id, ["normalizedPayload", "captures"]), captures);
  assert.equal(await store.readCandidatePath("missing", ["normalizedPayload", "captures"]), null);
  assert.equal(await store.readCandidatePath("inline", ["normalizedPayload", "missing"]), null);
  assert.ok(statements.some(query => query.includes("civic_data_payload_parts")), "partitioned field actually resolves its parts");
  for (const body of bodies) {
    assert.ok(!body.includes(unused));
    assert.ok(!body.includes("new-capture"), "the source pointer moving cannot change a pinned version's captures");
  }
});
