import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neonConfig } from "@neondatabase/serverless";
import { execFileSync } from "node:child_process";

interface PgResult { fields: { name: string; dataTypeID: number }[]; rows: unknown[][]; rowCount: number | null; command: string }
interface PgClient { query(input: string | { text: string; values?: unknown[]; rowMode?: string; types?: unknown }): Promise<PgResult>; end(): Promise<void>; connect(): Promise<void> }

export async function scaleDatabase(driverPath: string) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "The benchmark requires an isolated loopback database.");
  const driver = await import(resolve(driverPath)) as { default: { Client: new (options: { connectionString: string }) => PgClient } };
  const client = new driver.default.Client({ connectionString: url.toString() }); await client.connect();
  Object.assign(process.env, { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_CONTROL_PLANE_DATABASE_URL: url.toString(),
    WTP_RUNTIME_AUTHORITY_CAPABILITY: "MANUAL_CONTRACT", WTP_RUNTIME_AUTHORITY_CONTRACT: "plain-english-translations",
    WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    WTP_RUNTIME_AUTHORITY_PARENT_PID: String(process.ppid), WTP_RUNTIME_AUTHORITY_NONCE: "a".repeat(64), WTP_VITAL_SIGNS_REPORT: "1" });
  const bytes = { requests: 0, requestBytes: 0, responseBytes: 0, mutationRequests: 0 };
  const execute = async (_input: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? ""), request = JSON.parse(body) as { query?: string; params?: unknown[]; queries?: { query: string; params: unknown[] }[] };
    const queries = request.queries ?? [{ query: request.query!, params: request.params ?? [] }];
    bytes.requests++; bytes.requestBytes += Buffer.byteLength(body);
    bytes.mutationRequests += Number(queries.some(row => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(row.query)));
    const results: PgResult[] = [];
    try {
      if (request.queries) await client.query("BEGIN");
      for (const query of queries) {
        const result = await client.query({ text: query.query, values: query.params, rowMode: "array", types: { getTypeParser: () => (value: string) => value } });
        results.push({ fields: result.fields, rows: result.rows, rowCount: result.rowCount, command: result.command });
      }
      if (request.queries) await client.query("COMMIT");
      const text = JSON.stringify(request.queries ? { results } : results[0]);
      bytes.responseBytes += Buffer.byteLength(text);
      return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
    } catch (error) {
      if (request.queries) await client.query("ROLLBACK");
      throw error;
    }
  };
  let pending: Promise<unknown> = Promise.resolve();
  neonConfig.fetchFunction = (input: unknown, init?: RequestInit) => {
    const result = pending.then(() => execute(input, init));
    pending = result.catch(() => undefined);
    return result;
  };
  return { bytes, client, async schema() {
    for (const file of ["0025_typical_fixer.sql", "0026_lame_sunset_bain.sql", "0027_pdc_candidate_history_shape.sql", "0028_wise_ikaris.sql", "0029_unchanged_confirmation_receipts.sql", "0030_database_transfer_daily.sql", "0031_civic_payload_parts.sql", "MS-01_measure_place_cursor.sql"]) {
      await client.query(await readFile(resolve("lib/db/migrations", file), "utf8"));
    }
    const { BOOTSTRAP_DDL } = await import("../lib/control-plane/repository/pg-schema.ts");
    for (const statement of BOOTSTRAP_DDL) await client.query(statement);
  }, reset() { Object.assign(bytes, { requests: 0, requestBytes: 0, responseBytes: 0, mutationRequests: 0 }); },
  async close() { await client.end(); } };
}
