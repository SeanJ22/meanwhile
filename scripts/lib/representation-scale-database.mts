import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import type { CensusDistrictEdge } from "../../lib/census-geography/district-edge.ts";
import { censusGeographyCandidate } from "../../lib/census-geography/candidate.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../../lib/civic-data/promotion.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../../lib/census-geography/publication.ts";
import { flushDatabaseTransfer } from "../../lib/db/transfer.ts";

interface Statement { query: string; params: unknown[] }
interface Transfer { requests: number; statements: number; bytesRead: number; bytesWritten: number }

export async function measureCensusPromotion(index: CensusDistrictEdge) {
  const root = resolve(import.meta.dirname, "../..");
  const pg = new PGlite();
  const migrationDirectory = join(root, "lib", "db", "migrations");
  for (const file of (await readdir(migrationDirectory)).filter(file => /^(?:002[5-9]|003[01])_/.test(file)).sort()) {
    for (const statement of (await readFile(join(migrationDirectory, file), "utf8")).split("--> statement-breakpoint")) await pg.exec(statement);
  }
  const transfer: Transfer = { requests: 0, statements: 0, bytesRead: 0, bytesWritten: 0 };
  const originalFetch = neonConfig.fetchFunction;
  let serialized: Promise<unknown> = Promise.resolve();
  const execute = async (init: { body: string }) => {
    const body = JSON.parse(init.body) as Partial<Statement> & { queries?: Statement[] };
    const statements = body.queries ?? [{ query: body.query!, params: body.params! }];
    transfer.requests++;
    transfer.statements += statements.length;
    transfer.bytesWritten += Buffer.byteLength(init.body);
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
    return new Response(encoded, { status: 200, headers: { "content-type": "application/json" } });
  };
  neonConfig.fetchFunction = (async (_endpoint: unknown, init: { body: string }) => {
    const result = serialized.then(() => execute(init));
    serialized = result.catch(() => {});
    return result;
  }) as typeof neonConfig.fetchFunction;
  try {
    const postgres = new PostgresRoutineDataStore();
    Object.assign(postgres, { readCache: null, writeAuthority: {
      repo: root, sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), capability: "ROUTINE_CONTRACT", contract: CENSUS_GEO_CONTRACT_ID,
      parentPid: process.ppid, nonce: "2".repeat(64),
    } });
    const store = Object.fromEntries(Object.getOwnPropertyNames(PostgresRoutineDataStore.prototype)
      .filter(name => name !== "constructor" && typeof (postgres as unknown as Record<string, unknown>)[name] === "function")
      .map(name => [name, ((postgres as unknown as Record<string, (...args: unknown[]) => unknown>)[name]).bind(postgres)])) as unknown as RoutineDataStore;
    const candidate = censusGeographyCandidate(index);
    assert.deepEqual(candidate.semantics.violations, []);
    const started = performance.now();
    const outcome = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate);
    assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
    assert.equal(outcome.readerReadback?.status, "PASS");
    await flushDatabaseTransfer();
    const firstRun = { ...transfer, runtimeMs: performance.now() - started };
    const recheck = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate);
    assert.ok(recheck.promoted && recheck.confirmed);
    await flushDatabaseTransfer();
    const unchangedRun = { requests: transfer.requests - firstRun.requests, statements: transfer.statements - firstRun.statements,
      bytesRead: transfer.bytesRead - firstRun.bytesRead, bytesWritten: transfer.bytesWritten - firstRun.bytesWritten };
    return { firstRun, unchangedRun, candidateBytes: Buffer.byteLength(JSON.stringify(candidate)), readModelBytes: Buffer.byteLength(JSON.stringify(index)),
      method: "Real Neon driver HTTP JSON request/response bodies, with every production promotion SQL statement executed by local PostgreSQL; no external database writes." };
  } finally {
    await flushDatabaseTransfer();
    await serialized;
    neonConfig.fetchFunction = originalFetch;
    await pg.close();
  }
}
