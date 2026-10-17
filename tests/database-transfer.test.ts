import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { databaseTransferFetch } from "../lib/db/transfer-by-caller.ts";
import { flushDatabaseTransfer, pendingDatabaseTransfer, type DatabaseTransfer } from "../lib/db/transfer.ts";

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

test("database accounting streams chunks before the remaining body is available", async () => {
  const rows: DatabaseTransfer[] = [];
  let release!: () => void;
  const remaining = new Promise<void>(resolve => { release = resolve; });
  let part = 0;
  const counted = databaseTransferFetch(async () => new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (part++ === 0) controller.enqueue(Buffer.from("Cochis"));
      else { await remaining; controller.enqueue(Buffer.from("é")); controller.close(); }
    },
    }, { highWaterMark: 0 })), row => { rows.push(row); });
  const response = await counted("https://database.invalid/sql", {
    headers: { "neon-connection-string": "postgresql://local.invalid/staging" },
  });
  const reader = response.body!.getReader();
  assert.equal(Buffer.from((await reader.read()).value!).toString(), "Cochis");
  assert.equal(rows.length, 0);
  release();
  assert.equal(Buffer.from((await reader.read()).value!).toString(), "é");
  assert.equal((await reader.read()).done, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].responseBytes, Buffer.byteLength("Cochisé"));
});

test("database accounting records consumed bytes once on cancellation or body failure", async () => {
  for (const failure of [false, true]) {
    const rows: DatabaseTransfer[] = [];
    let part = 0, cancelled = false;
    const expected = new Error("database body interrupted");
    const counted = databaseTransferFetch(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (part++ === 0) controller.enqueue(Buffer.from("data"));
        else controller.error(expected);
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 })), row => { rows.push(row); });
    const response = await counted("https://database.invalid/sql", {
      headers: { "neon-connection-string": "postgresql://local.invalid/staging" }, body: "select 1",
    });
    const reader = response.body!.getReader();
    assert.equal(Buffer.from((await reader.read()).value!).toString(), "data");
    if (failure) await assert.rejects(reader.read(), expected);
    else await reader.cancel("reader finished");
    assert.equal(cancelled, !failure);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].responseBytes, 4);
    assert.equal(rows[0].requestBytes, 8);
  }
});

test("an admitted direct parent counts as runner and a dedicated feedback read is excluded", async () => {
  const saved = { ...process.env };
  const rows: DatabaseTransfer[] = [];
  Object.assign(process.env, { DATABASE_URL: "postgresql://reader.invalid/staging", FEEDBACK_DATABASE_URL: "postgresql://feedback.invalid/staging",
    WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" });
  delete process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY;
  try {
    const counted = databaseTransferFetch(async () => new Response("[]"), row => { rows.push(row); });
    await (await counted("https://database.invalid/sql", { headers: { "neon-connection-string": process.env.DATABASE_URL! } })).text();
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
    assert.deepEqual(writes[1]![0]!.params.slice(3, 6).map(Number), [2, requestBytes, 2 * Buffer.byteLength(response)]);
    const detail = JSON.parse(writes[1]![0]!.params[6] as string) as Record<string, number[]>;
    assert.equal(Object.values(detail).reduce((sum, counts) => sum + counts[2], 0), 2 * Buffer.byteLength(response));
    assert.deepEqual(pendingDatabaseTransfer(), [], "the successful accounting write is not itself counted");
  } finally {
    failWriter();
    await flushDatabaseTransfer();
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});
