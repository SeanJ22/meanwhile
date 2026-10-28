import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Client, Pool, neonConfig } from "@neondatabase/serverless";
import { readerDatabaseQuery, installReaderDatabaseQuery, warmReaderConnections } from "../lib/reader/database.ts";
import type { ReadOnlyQuery, Statement } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { withReaderRoute } from "../lib/db/reader-route.ts";
import { factReader } from "../lib/facts/db.ts";

const statement: Statement = { text: "SELECT $1::text AS selected", params: ["this place"] };

test("startup warms connections once, releases successful checkouts and reads no civic records", async () => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect, originalFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-startup.invalid/fixture";
  let checkouts = 0, releases = 0, httpReads = 0;
  const client = Object.assign(new Client(), { release() { releases++; } });
  Pool.prototype.connect = (async () => { if (++checkouts === 1) throw new Error("First socket unavailable"); return client; }) as typeof Pool.prototype.connect;
  neonConfig.fetchFunction = async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (new Headers(init?.headers).get("Neon-Batch-Read-Only") !== "true") return new Response("Readonly fixture", { status: 503 });
    httpReads++;
    assert.deepEqual(JSON.parse(String(init?.body)).queries.map((row: {query:string}) => row.query), ["SELECT 1 AS ready"]);
    return Response.json({ results: [{ command: "SELECT", rowCount: 1, fields: [{ name: "ready", dataTypeID: 23 }], rows: [["1"]] }] });
  };
  try {
    await warmReaderConnections(); await warmReaderConnections();
    assert.equal(checkouts, 2); assert.equal(releases, 1); assert.equal(httpReads, 1);
  } finally {
    Pool.prototype.connect = originalConnect; neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("a foreground ballot reads version-checked facts over read-only HTTP while the map keeps its socket pool", async () => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect, originalFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@ballot-pool.invalid/fixture";
  const pools: Pool[] = [];
  const client = Object.assign(new Client(), { release() {} });
  client.query = (async (text: string, values: unknown[]) => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [],
    rows: selectedRows(text, values[0], values.at(-1)) })) as typeof client.query;
  Pool.prototype.connect = (async function (this: Pool) { pools.push(this); return client; }) as typeof Pool.prototype.connect;
  let httpReads = 0;
  neonConfig.fetchFunction = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (headers.get("Neon-Batch-Read-Only") !== "true") return new Response("Readonly fixture", { status: 503 });
    httpReads++;
    assert.equal(headers.get("Neon-Batch-Isolation-Level"), "RepeatableRead");
    const body = JSON.parse(String(init?.body)) as { queries: { query: string; params: unknown[] }[] };
    assert.equal(body.queries.length, 1);
    const { query, params } = body.queries[0];
    const row = selectedRows(query, params[0], params.at(-1))[0];
    const fields = Object.entries(row).map(([name, value]) => ({ name, dataTypeID: typeof value === "boolean" ? 16 : 25 }));
    const values = Object.values(row).map(value => typeof value === "boolean" ? value ? "t" : "f" : value);
    return new Response(JSON.stringify({ results: [{ command: "SELECT", rowCount: 1, fields, rows: [values] }] }),
      { headers: { "content-type": "application/json" } });
  };
  try {
    for (const route of ["/api/meetings", "/ballot", "/api/meetings"])
      assert.deepEqual(await withReaderRoute(route, () => factReader()!(statement.text, [...statement.params])), [{ selected: "this place" }]);
    await withReaderRoute("/ballot", async () => {
      const reader = readerDatabaseQuery() as ReadOnlyQuery & { canonicalBody: ReadOnlyQuery };
      assert.deepEqual(await reader.canonicalBody([statement]), [[{ selected: "this place" }]]);
    });
    assert.equal(httpReads, 1, "the foreground ballot does not wait for a map socket");
    assert.equal(pools.length, 3);
    assert.equal(pools[0], pools[1], "ordinary readers retain their existing shared pool");
    assert.equal(pools[0], pools[2], "canonical payloads retain the socket's efficient wire format and version protocol");
  } finally {
    Pool.prototype.connect = originalConnect; neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

function selectedRows(text: string, selected: unknown, held: unknown = []): Record<string, unknown>[] {
  if (/^(?:BEGIN|COMMIT|ROLLBACK)/.test(text)) return [];
  const ordinal = /row_number\(\) OVER \(\) AS (db04_ordinal_[a-f0-9]+)/.exec(text)?.[1];
  const etag = /'hex'\) AS (db04_etag_[a-f0-9]+)/.exec(text)?.[1];
  const unchanged = /AS (db04_unchanged_[a-f0-9]+)/.exec(text)?.[1];
  const version = /AS (db04_version_[a-f0-9]+)/.exec(text)?.[1];
  const retainedMarker = /AS (db04_retained_[a-f0-9]+)/.exec(text)?.[1];
  assert.ok(ordinal && etag && unchanged && version && retainedMarker, "reader bodies must come through a versioned projection");
  const revision = createHash("sha256").update(JSON.stringify(selected)).digest("hex");
  const retained = Array.isArray(held) && held.includes(revision);
  return [{ selected: retained ? null : selected, [ordinal]: "1", [etag]: revision, [unchanged]: retained, [version]: revision, [retainedMarker]: retained }];
}

test("a bounded reader query uses the shared socket client once and returns it after a complete answer", async () => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect, originalFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-socket.invalid/fixture";
  const calls: { text: string; values: unknown[] }[] = [], releases: (Error | boolean | undefined)[] = [];
  const client = Object.assign(new Client(), { release(error?: Error | boolean) { releases.push(error); } });
  client.query = (async (text: string, values: unknown[]) => {
    calls.push({ text, values });
    return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: selectedRows(text, values[0], values.at(-1)) };
  }) as typeof client.query;
  Pool.prototype.connect = (async () => client) as typeof Pool.prototype.connect;
  neonConfig.fetchFunction = async () => { throw new Error("A reader socket query must not use HTTP"); };
  try {
    assert.deepEqual(await readerDatabaseQuery(1800)!([statement]), [[{ selected: "this place" }]]);
    assert.equal(calls.length, 1, "a single reader query adds no protocol round trips");
    assert.ok(calls[0].text.includes("LEFT JOIN LATERAL"), "one snapshot checks versions before returning changed bodies");
    assert.deepEqual(calls[0].values, [...statement.params, []]);
    assert.deepEqual(releases, [undefined]);
  } finally {
    Pool.prototype.connect = originalConnect; neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("a cold checked reader answer fits the original one-second deadline with one database round trip", async context => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-one-second.invalid/fixture";
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  const client = Object.assign(new Client(), { release() {} });
  client.query = ((text: string, values: unknown[]) => {
    calls.push(text);
    return new Promise(resolve => setTimeout(() => resolve({ command: "SELECT", rowCount: 1, oid: 0, fields: [],
      rows: selectedRows(text, values[0], values.at(-1)) }), 400));
  }) as typeof client.query;
  Pool.prototype.connect = (async () => client) as typeof Pool.prototype.connect;
  let answer: unknown, failure: unknown;
  try {
    const pending = readerDatabaseQuery(1000)!([statement]).then(value => { answer = value; }, error => { failure = error; });
    for (let turn = 0; turn < 50 && calls.length === 0; turn++) await Promise.resolve();
    assert.equal(calls.length, 1);
    for (let tick = 0; tick < 10; tick++) {
      context.mock.timers.tick(100);
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    }
    await pending;
    assert.equal(failure, undefined);
    assert.deepEqual(answer, [[{ selected: "this place" }]]);
    assert.equal(calls.length, 1, "version comparison and changed bodies use the original single statement budget");
  } finally {
    context.mock.timers.reset(); Pool.prototype.connect = originalConnect;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("the reader deadline rejects and discards an active socket before another read can reuse it", async context => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-timeout.invalid/fixture";
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
    for (let tick = 0; tick < 30 && texts.length === 0; tick++) await Promise.resolve();
    assert.equal(texts.length, 1);
    context.mock.timers.tick(1799);
    assert.equal(releases.length, 0);
    context.mock.timers.tick(1);
    await failed;
    assert.equal(releases.length, 1, "a timed-out client is released exactly once");
    assert.ok(releases[0] instanceof Error, "the Pool discards clients released with an error instead of returning them to its idle shelf");
    assert.equal(texts.length, 1, "expiry adds no cleanup SQL on the unfinished connection");
    assert.ok(texts[0].includes("LEFT JOIN LATERAL"));
  } finally {
    context.mock.timers.reset(); Pool.prototype.connect = originalConnect;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});

test("the reader deadline includes the pool wait and an expired checkout never executes SQL", async context => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-pool-wait.invalid/fixture";
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
    await assert.rejects(readerDatabaseQuery(1800)!([statement]), error => error === failure);
    assert.equal(reads, 1);
    installReaderDatabaseQuery(null);
    assert.equal(readerDatabaseQuery(1800), null);
  } finally { installReaderDatabaseQuery(undefined); }
});

test("a broken reader connection fails its own read and leaves the function serving the next one", async () => {
  const originalUrl = process.env.DATABASE_URL, originalConnect = Pool.prototype.connect, originalError = console.error;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@reader-broken.invalid/fixture";
  const logged: string[] = [];
  console.error = (line: string) => { logged.push(line); };
  const pools: Pool[] = [];
  let fail = true;
  const client = Object.assign(new Client(), { release() {} });
  client.query = (async (text: string) => ({ command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: selectedRows(text, "next") })) as typeof client.query;
  Pool.prototype.connect = (async function (this: Pool) {
    pools.push(this);
    if (fail) throw new Error("unsupported startup parameter");
    this.emit("connect", client);
    return client;
  }) as typeof Pool.prototype.connect;
  try {
    await assert.rejects(readerDatabaseQuery(1800)!([statement]), /unsupported startup parameter/);
    assert.doesNotThrow(() => pools[0].emit("error", new Error("terminating connection due to administrator command")));
    fail = false;
    assert.deepEqual(await readerDatabaseQuery(1800)!([statement]), [[{ selected: "next" }]]);
    assert.doesNotThrow(() => client.emit("error", new Error("Connection terminated unexpectedly")));
    assert.deepEqual(logged, ["Reader database connection failed: terminating connection due to administrator command",
      "Reader database connection failed: Connection terminated unexpectedly"]);
  } finally {
    Pool.prototype.connect = originalConnect; console.error = originalError;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
});
