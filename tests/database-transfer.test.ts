import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { databaseTransferFetch, flushDatabaseTransfer, pendingDatabaseTransfer, type DatabaseTransfer } from "../lib/db/transfer.ts";

test("database counter counts actual UTF-8 response bytes and leaves JSON unchanged", async () => {
  const rows: DatabaseTransfer[] = [];
  const body = JSON.stringify({ value: "Cochisé", records: [1, 2, 3] });
  const counted = databaseTransferFetch(async () => new Response(body, { headers: { "content-type": "application/json" } }), row => { rows.push(row); });
  const response = await counted("https://database.invalid/sql", {
    headers: { "neon-connection-string": "postgresql://local.invalid/staging" }, body: "select 1",
  });
  assert.deepEqual(await response.json(), JSON.parse(body));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.responseBytes, Buffer.byteLength(body));
  assert.equal(rows[0]!.requestBytes, 8);
  assert.equal(rows[0]!.requests, 1);
});

test("government/API requests do not count as database transfer", async () => {
  const counted = databaseTransferFetch(async () => new Response("official page"), () => { assert.fail("counted source HTTP"); });
  assert.equal(await (await counted("https://example.gov")).text(), "official page");
});

test("successive database checks use their current Eastern day across daylight-saving offsets", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-02T04:59:59.000Z") });
  const days: string[] = [];
  const counted = databaseTransferFetch(async () => new Response("[]"), row => { days.push(row.day); });
  for (const at of ["2026-01-02T04:59:59.000Z", "2026-01-02T05:00:00.000Z", "2026-07-02T03:59:59.000Z", "2026-07-02T04:00:00.000Z"]) {
    context.mock.timers.setTime(Date.parse(at));
    await (await counted("https://database.invalid/sql", {
      headers: { "neon-connection-string": "postgresql://local.invalid/staging" },
    })).text();
  }
  assert.deepEqual(days, ["2026-01-01", "2026-01-02", "2026-07-01", "2026-07-02"]);
});

test("an admitted direct parent counts as runner and a dedicated feedback read is excluded", async () => {
  const saved = { ...process.env };
  const rows: DatabaseTransfer[] = [];
  Object.assign(process.env, { DATABASE_URL: "postgresql://reader.invalid/staging", FEEDBACK_DATABASE_URL: "postgresql://feedback.invalid/staging",
    WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" });
  delete process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY;
  try {
    const counted = databaseTransferFetch(async () => new Response("[]"), row => { rows.push(row); });
    await counted("https://database.invalid/sql", { headers: { "neon-connection-string": process.env.DATABASE_URL! } });
    assert.equal(rows[0].database, "reader");
    assert.equal(rows[0].client, "runner");
    await counted("https://database.invalid/sql", { headers: { "neon-connection-string": process.env.FEEDBACK_DATABASE_URL! } });
    assert.equal(rows.length, 1);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("answered control-plane reads finish while accounting is held, and a failed flush retains all bytes", async () => {
  const saved = { fetch: neonConfig.fetchFunction, env: { ...process.env } };
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://local:local@ep-reader-transfer-test.us-east-2.aws.neon.tech/neondb",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@ep-cp-transfer-test.us-east-2.aws.neon.tech/neondb",
  });
  const result = { command: "SELECT", rowCount: 1, rowAsArray: true,
    fields: ["id", "revision", "updated_at", "value"].map(name => ({ name, dataTypeID: 25 })),
    rows: [["admin", "1", "2026-10-02T00:00:00.000Z", "{}"]] };
  const response = JSON.stringify(result);
  let failWriter!: () => void;
  const writerHeld = new Promise<void>((_resolve, reject) => {
    failWriter = () => reject(new Error("reader database accounting write failed"));
  });
  const reads: string[] = [];
  const writes: { query: string; params: unknown[] }[][] = [];
  neonConfig.fetchFunction = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.queries) {
      assert.equal(new Headers(init?.headers).get("neon-connection-string"), process.env.DATABASE_URL);
      writes.push(body.queries);
      if (writes.length === 1) await writerHeld;
      return new Response(JSON.stringify({ results: body.queries.map(() => ({ command: "INSERT", rowCount: 1,
        rowAsArray: true, fields: [], rows: [] })) }));
    }
    assert.equal(new Headers(init?.headers).get("neon-connection-string"), process.env.WTP_CONTROL_PLANE_DATABASE_URL);
    reads.push(String(init?.body));
    return new Response(response);
  };
  try {
    const repos = await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!, undefined,
      { skipBootstrap: true, requestBounds: { POINT: 100 } });
    assert.deepEqual((await repos.adminConfig.read("admin"))?.value, {});
    assert.equal(writes.length, 1, "the first accounting write is still held");
    assert.deepEqual((await repos.adminConfig.read("admin"))?.value, {});
    const failedFlush = flushDatabaseTransfer();
    failWriter();
    assert.equal(await failedFlush, false);
    const retained = pendingDatabaseTransfer();
    assert.equal(retained.length, 1);
    assert.equal(retained[0]!.database, "control-plane");
    assert.equal(retained[0]!.requests, 2, "failed in-flight bytes merge with the next answered read");
    const requestBytes = reads.reduce((total, body) => total + Buffer.byteLength(body), 0);
    assert.equal(retained[0]!.requestBytes, requestBytes);
    assert.equal(retained[0]!.responseBytes, 2 * Buffer.byteLength(response));
    assert.equal(await flushDatabaseTransfer(), true);
    assert.equal(writes.length, 2);
    assert.match(writes[1]![0]!.query, /INSERT INTO database_transfer_daily/);
    assert.deepEqual(writes[1]![0]!.params.slice(3).map(Number), [2, requestBytes, 2 * Buffer.byteLength(response)]);
    assert.deepEqual(pendingDatabaseTransfer(), [], "the successful accounting write is not itself counted");
  } finally {
    failWriter();
    await flushDatabaseTransfer();
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});
