import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import type { CensusDistrictEdge } from "../../lib/census-geography/district-edge.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../../lib/civic-data/store.ts";
import { processRegisteredFanOutCandidate, type PromotionOutcome } from "../../lib/civic-data/promotion.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../../lib/census-geography/publication.ts";
import { flushDatabaseTransfer } from "../../lib/db/transfer.ts";
import { readerQuery } from "../../lib/civic-data/promoted-reader-query.ts";
import { readCensusGeographyIndex } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import { censusGeographyCompletionCandidate } from "../../lib/census-geography/candidate.ts";

interface Statement { query: string; params: unknown[] }
interface Transfer { requests: number; statements: number; bytesRead: number; bytesWritten: number }
export interface DatabaseMeasurement {
  firstRun: Transfer & { runtimeMs: number };
  unchangedRun: Transfer & { runtimeMs: number };
  candidateBytes: number;
  readModelBytes: number;
  index: CensusDistrictEdge;
}

export const databaseMeasurementMethod = "Real Neon driver HTTP JSON request/response bodies, with every production state promotion SQL statement executed by one persistent local PostgreSQL engine in a separate process; no external database writes.";

const difference = (after: Transfer, before: Transfer): Transfer => ({ requests: after.requests - before.requests,
  statements: after.statements - before.statements, bytesRead: after.bytesRead - before.bytesRead,
  bytesWritten: after.bytesWritten - before.bytesWritten });

async function metrics(endpoint: string): Promise<Transfer> {
  const response = await fetch(`${endpoint}/metrics`);
  assert.ok(response.ok);
  return response.json() as Promise<Transfer>;
}

function proxyDatabase(endpoint: string): () => void {
  const originalFetch = neonConfig.fetchFunction;
  neonConfig.fetchFunction = (async (_endpoint: unknown, init: { body: string }) => fetch(`${endpoint}/query`, {
    method: "POST", headers: { "content-type": "application/json" }, body: init.body,
  })) as typeof neonConfig.fetchFunction;
  return () => { neonConfig.fetchFunction = originalFetch; };
}

export async function serveCensusPromotionDatabase(peakRssBytes: () => number): Promise<void> {
  const root = resolve(import.meta.dirname, "../..");
  const pg = new PGlite();
  const migrationDirectory = join(root, "lib", "db", "migrations");
  for (const file of (await readdir(migrationDirectory)).filter(file => /^(?:002[5-9]|003[01])_/.test(file)).sort()) {
    for (const statement of (await readFile(join(migrationDirectory, file), "utf8")).split("--> statement-breakpoint")) await pg.exec(statement);
  }
  const transfer: Transfer = { requests: 0, statements: 0, bytesRead: 0, bytesWritten: 0 };
  let serialized: Promise<unknown> = Promise.resolve();
  const execute = async (encodedRequest: string) => {
    const body = JSON.parse(encodedRequest) as Partial<Statement> & { queries?: Statement[] };
    const statements = body.queries ?? [{ query: body.query!, params: body.params! }];
    transfer.requests++;
    transfer.statements += statements.length;
    transfer.bytesWritten += Buffer.byteLength(encodedRequest);
    const results = [];
    if (body.queries) await pg.exec("BEGIN");
    try {
      for (const statement of statements) {
        const description = await pg.describeQuery(statement.query);
        const serializers = Object.fromEntries(description.queryParams.map(parameter => [parameter.dataTypeID, (value: unknown) => String(value)]));
        const result = await pg.query<Record<string, unknown>>(statement.query, statement.params, { serializers });
        const fields = result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID }));
        const rows = result.rows.map(row => fields.map(field => {
          const value = row[field.name];
          if (value === null || value === undefined) return null;
          if (field.dataTypeID === 16) return value ? "t" : "f";
          if (field.dataTypeID === 114 || field.dataTypeID === 3802) return JSON.stringify(value);
          if (value instanceof Date) return value.toISOString();
          return String(value);
        }));
        results.push({ command: statement.query.trim().split(/\s+/)[0].toUpperCase(), rowCount: result.affectedRows ?? rows.length, rowAsArray: true, fields, rows });
      }
      if (body.queries) await pg.exec("COMMIT");
    } catch (error) {
      await pg.exec("ROLLBACK");
      throw error;
    }
    const encoded = JSON.stringify(body.queries ? { results } : results[0]);
    transfer.bytesRead += Buffer.byteLength(encoded);
    return encoded;
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/metrics") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...transfer, peakRssBytes: peakRssBytes() }));
      } else if (request.method === "POST" && request.url === "/query") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const result = serialized.then(() => execute(body));
        serialized = result.catch(() => {});
        const encoded = await result;
        response.writeHead(200, { "content-type": "application/json" }).end(encoded);
      } else if (request.method === "POST" && request.url === "/close") {
        await serialized;
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...transfer, peakRssBytes: peakRssBytes() }));
        server.close();
        await pg.close();
      } else response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ message: String(error) }));
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.stdout.write(`${JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}`, method: databaseMeasurementMethod })}\n`);
}

async function measurePromotion(endpoint: string, publish: (store: RoutineDataStore) => Promise<PromotionOutcome>) {
  const restore = proxyDatabase(endpoint);
  try {
    const root = resolve(import.meta.dirname, "../..");
    const postgres = new PostgresRoutineDataStore();
    Object.assign(postgres, { readCache: null, writeAuthority: {
      repo: root, sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), capability: "ROUTINE_CONTRACT", contract: CENSUS_GEO_CONTRACT_ID,
      parentPid: process.ppid, nonce: "2".repeat(64),
    } });
    const store = Object.fromEntries(Object.getOwnPropertyNames(PostgresRoutineDataStore.prototype)
      .filter(name => name !== "constructor" && typeof (postgres as unknown as Record<string, unknown>)[name] === "function")
      .map(name => [name, ((postgres as unknown as Record<string, (...args: unknown[]) => unknown>)[name]).bind(postgres)])) as unknown as RoutineDataStore;
    const before = await metrics(endpoint), started = performance.now();
    const outcome = await publish(store);
    assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
    assert.equal(outcome.readerReadback?.status, "PASS");
    await flushDatabaseTransfer();
    const after = await metrics(endpoint);
    const firstRun = { ...difference(after, before), runtimeMs: performance.now() - started };
    const candidate = outcome.candidate.candidate;
    const recheckStarted = performance.now();
    const recheck = await processRegisteredFanOutCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate);
    assert.ok(recheck.promoted && recheck.confirmed);
    await flushDatabaseTransfer();
    return { firstRun, unchangedRun: { ...difference(await metrics(endpoint), after), runtimeMs: performance.now() - recheckStarted },
      candidateBytes: Buffer.byteLength(JSON.stringify(candidate)), readModelBytes: Buffer.byteLength(JSON.stringify(candidate.readModel)), candidate };
  } finally {
    await flushDatabaseTransfer();
    restore();
  }
}

export async function measureCensusPromotion(endpoint: string, publish: (store: RoutineDataStore) => Promise<PromotionOutcome>): Promise<DatabaseMeasurement> {
  const { candidate, ...measurement } = await measurePromotion(endpoint, publish);
  const index = candidate.readModel as CensusDistrictEdge;
  assert.equal(Object.keys(index.states).length, 1);
  return { ...measurement, index };
}

export async function measureCensusCompletion(endpoint: string, completedAt: string, completedStates: number) {
  const candidate = censusGeographyCompletionCandidate({ completedAt, completedStates });
  const { candidate: _candidate, ...measurement } = await measurePromotion(endpoint,
    store => processRegisteredFanOutCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate, completedAt));
  return measurement;
}

export async function measureCensusStateIndex(endpoint: string, state: string) {
  const restore = proxyDatabase(endpoint);
  try {
    const before = await metrics(endpoint), started = performance.now();
    const index = await readCensusGeographyIndex(readerQuery(), state);
    assert.equal(index.kind, "HELD");
    if (index.kind !== "HELD") throw new Error("Published state metadata unread");
    assert.deepEqual(Object.keys(index.value.states), [state]);
    await flushDatabaseTransfer();
    const transfer = difference(await metrics(endpoint), before);
    return { ...transfer, runtimeMs: performance.now() - started, state, readModelBytes: Buffer.byteLength(JSON.stringify(index.value)), stateKeys: Object.keys(index.value.states) };
  } finally {
    await flushDatabaseTransfer();
    restore();
  }
}
