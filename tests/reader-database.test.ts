import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, Pool, neonConfig } from "@neondatabase/serverless";
import { readerDatabaseQuery, readerHttpQuery, installReaderDatabaseQuery } from "../lib/reader/database.ts";
import type { Statement } from "../lib/control-plane/admin-view/promoted-slices.ts";

const statement: Statement = { text: "SELECT $1::text AS selected", params: ["this place"] };

test("a small detail uses one read-only HTTP transaction and preserves transport failures", async () => {
  const originalUrl = process.env.DATABASE_URL, originalFetch = neonConfig.fetchFunction, originalReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-http.invalid/fixture";
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  const calls: { body: unknown; readOnly: string | null }[] = [];
  const failure = new Error("The detail transport failed");
  neonConfig.fetchFunction = async (_url, init) => {
    calls.push({ body: JSON.parse(String(init?.body)), readOnly: new Headers(init?.headers).get("Neon-Batch-Read-Only") });
    if (calls.length > 1) throw failure;
    return Response.json({ results: [{ command: "SELECT", rowCount: 1, fields: [{ name: "selected", dataTypeID: 25 }], rows: [["this place"]] }] });
  };
  try {
    const query = readerHttpQuery()!;
    assert.deepEqual(await query([statement]), [[{ selected: "this place" }]]);
    assert.deepEqual(calls, [{ body: { queries: [{ query: statement.text, params: [...statement.params] }] }, readOnly: "true" }]);
    await assert.rejects(query([statement]), /The detail transport failed/);
    assert.equal(calls.length, 2, "an HTTP failure does not retry through another transport");
  } finally {
    neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
  }
});

test("a bounded reader query uses the shared socket client once and returns it after a complete answer", async () => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect, originalFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-socket.invalid/fixture";
  const calls: { text: string; values: unknown[] }[] = [], releases: (Error | boolean | undefined)[] = [];
  const client = Object.assign(new Client(), { release(error?: Error | boolean) { releases.push(error); } });
  client.query = (async (text: string, values: unknown[]) => {
    calls.push({ text, values });
    return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ selected: values[0] }] };
  }) as typeof client.query;
  Pool.prototype.connect = (async () => client) as typeof Pool.prototype.connect;
  neonConfig.fetchFunction = async () => { throw new Error("A reader socket query must not use HTTP"); };
  try {
    assert.deepEqual(await readerDatabaseQuery(1800)!([statement]), [[{ selected: "this place" }]]);
    assert.deepEqual(calls, [{ text: statement.text, values: [...statement.params] }], "a single selected read adds no transaction or timeout SQL round trips");
    assert.deepEqual(releases, [undefined]);
  } finally {
    Pool.prototype.connect = originalConnect; neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("the reader deadline rejects and discards an active socket before another read can reuse it", async context => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-socket.invalid/fixture";
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const releases: (Error | boolean | undefined)[] = [], texts: string[] = [];
  let rejectQuery: ((error: Error) => void) | undefined;
  const client = Object.assign(new Client(), { release(error?: Error | boolean) {
    releases.push(error);
    if (error instanceof Error) rejectQuery?.(error);
  } });
  client.query = ((text: string) => {
    texts.push(text);
    return new Promise<never>((_, reject) => { rejectQuery = reject; });
  }) as typeof client.query;
  Pool.prototype.connect = (async () => client) as typeof Pool.prototype.connect;
  try {
    const pending = readerDatabaseQuery(1800)!([statement]);
    const failed = assert.rejects(pending, error => error instanceof Error && error.name === "TimeoutError" && error.message === "READER_DATABASE_TIMEOUT");
    await Promise.resolve();
    context.mock.timers.tick(1799);
    assert.equal(releases.length, 0);
    context.mock.timers.tick(1);
    await failed;
    assert.equal(releases.length, 1, "a timed-out client is released exactly once");
    assert.ok(releases[0] instanceof Error, "the Pool discards clients released with an error instead of returning them to its idle shelf");
    assert.deepEqual(texts, [statement.text], "expiry adds no cleanup SQL on the unfinished connection");
  } finally {
    context.mock.timers.reset(); Pool.prototype.connect = originalConnect;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("the reader deadline includes the pool wait and an expired checkout never executes SQL", async context => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-socket.invalid/fixture";
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const releases: (Error | boolean | undefined)[] = [];
  let calls = 0, checkout: ((client: Client & { release(error?: Error | boolean): void }) => void) | undefined;
  const client = Object.assign(new Client(), { release(error?: Error | boolean) { releases.push(error); } });
  client.query = (async () => { calls++; return { command: "SELECT", rowCount: 0, oid: 0, fields: [], rows: [] }; }) as typeof client.query;
  Pool.prototype.connect = (() => new Promise(resolve => { checkout = resolve; })) as typeof Pool.prototype.connect;
  try {
    const pending = readerDatabaseQuery(1800)!([statement]);
    const failed = assert.rejects(pending, /READER_DATABASE_TIMEOUT/);
    context.mock.timers.tick(1800);
    await failed;
    assert.equal(calls, 0);
    checkout!(client);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(calls, 0, "late connection acquisition cannot restart the expired reader query");
    assert.deepEqual(releases, [undefined], "a late clean checkout is returned without ever running SQL");
  } finally {
    context.mock.timers.reset(); Pool.prototype.connect = originalConnect;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("the shared reader preserves an explicitly installed read-only query and its failures", async () => {
  let reads = 0;
  const failure = new Error("The injected read failed");
  const query = async () => { reads++; throw failure; };
  installReaderDatabaseQuery(query);
  try {
    assert.equal(readerDatabaseQuery(1800), query);
    assert.equal(readerHttpQuery(), query);
    await assert.rejects(readerDatabaseQuery(1800)!([statement]), error => error === failure);
    assert.equal(reads, 1);
    installReaderDatabaseQuery(null);
    assert.equal(readerDatabaseQuery(1800), null);
    assert.equal(readerHttpQuery(), null);
  } finally { installReaderDatabaseQuery(undefined); }
});
