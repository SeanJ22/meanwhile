import { PGlite, type Results, type Transaction } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const directory = process.argv[2];
if (!directory) throw new Error("A benchmark database directory is required.");
const db = new PGlite(directory);
const exists = await db.query<{ relation: string | null }>("SELECT to_regclass('public.civic_data_candidates')::text AS relation");
if (!exists.rows[0]?.relation) for (const migration of ["0025_typical_fixer", "0026_lame_sunset_bain", "0027_pdc_candidate_history_shape", "0028_wise_ikaris", "0029_unchanged_confirmation_receipts", "0031_civic_payload_parts", "SRC-MN_federal_money_lookup"]) {
  await db.exec(readFileSync(join(process.cwd(), "lib", "db", "migrations", `${migration}.sql`), "utf8"));
}
const serializers = Object.fromEntries(Object.entries(db.serializers).map(([oid, serialize]) => [oid, (value: unknown) => typeof value === "string" ? value : serialize(value)]));
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
send({ type: "ready" });
interface Statement { query: string; params?: unknown[] }
function neonResult(result: Results<unknown[]>, query: string) {
  const raw = (value: unknown): string | null => value === null || value === undefined ? null
    : value instanceof Date ? value.toISOString() : typeof value === "boolean" ? value ? "t" : "f"
      : typeof value === "object" ? JSON.stringify(value) : String(value);
  return { command: /^\s*(\w+)/.exec(query)?.[1]?.toUpperCase() ?? "SELECT", rowCount: result.affectedRows ?? result.rows.length,
    rowAsArray: true, fields: result.fields, rows: result.rows.map(row => row.map(raw)) };
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line) as { id: number; type?: string; body?: string };
  if (message.type === "close") {
    await db.close();
    send({ id: message.id, type: "closed", databasePeakRssBytes: process.resourceUsage().maxRSS * 1024 });
    break;
  }
  try {
    const request = JSON.parse(message.body!) as Statement & { queries?: Statement[] };
    const execute = async (connection: PGlite | Transaction, statement: Statement) => neonResult(await connection.query<unknown[]>(statement.query, statement.params ?? [], { rowMode: "array", serializers }), statement.query);
    const result = request.queries ? { results: await db.transaction(async tx => {
      const values = [];
      for (const statement of request.queries!) values.push(await execute(tx, statement));
      return values;
    }) } : await execute(db, request);
    send({ id: message.id, status: 200, body: JSON.stringify(result) });
  } catch (error) {
    send({ id: message.id, status: 400, body: JSON.stringify({ message: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code }) });
  }
}
lines.close();
