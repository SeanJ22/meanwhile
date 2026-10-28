import { PGlite, type Results } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { localPostgresReplay } from "./local-postgres-replay.mts";

const directory = process.argv[2];
if (!directory) throw new Error("A benchmark database directory is required.");
let fixtureStart = Number(process.argv[3]), elapsedStart = performance.now();
if (!Number.isFinite(fixtureStart)) throw new Error("The benchmark database must share its worker clock.");
globalThis.Date = new Proxy(Date, {
  construct(target, args) { return Reflect.construct(target, args.length ? args : [fixtureStart + performance.now() - elapsedStart]); },
  get(target, name, receiver) { return name === "now" ? () => Math.floor(fixtureStart + performance.now() - elapsedStart) : Reflect.get(target, name, receiver); },
});
const nativeFlag=process.argv.indexOf("--native-connection-file");
const native=nativeFlag>=0?await localPostgresReplay(directory,process.argv[nativeFlag+1],fixtureStart):null;
const db = native?.db ?? new PGlite(directory);
const exists = await db.query<{ relation: string | null }>("SELECT to_regclass('public.civic_data_candidates')::text AS relation");
if (!exists.rows[0]?.relation) {
  const journal = JSON.parse(readFileSync(join(process.cwd(), "lib/db/migrations/meta/_journal.json"), "utf8"));
  for (const migration of journal.entries) await db.exec(readFileSync(join(process.cwd(), "lib/db/migrations", `${migration.tag}.sql`), "utf8"));
}
const payloadReaders=await db.query<{reader:string|null}>("SELECT to_regprocedure('public.reader_payload_node(jsonb)')::text AS reader");
if(!payloadReaders.rows[0]?.reader){
  const readerFunctions=readFileSync(join(process.cwd(),"lib/db/migrations/0036_ne01.sql"),"utf8").split("--> statement-breakpoint")
    .filter(statement=>/^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(statement));
  for(const statement of readerFunctions)await db.exec(statement);
}
if (!(await db.query<{relation:string|null}>("SELECT to_regclass('public.civic_data_rows')::text AS relation")).rows[0]?.relation) {
  for(const migration of ["DB-05_keyed_rows","DB-05_federal_money_rows"])
    await db.exec(readFileSync(join(process.cwd(),"lib/db/migrations",`${migration}.sql`),"utf8").replaceAll("--> statement-breakpoint",""));
}
if (!(await db.query<{relation:string|null}>("SELECT to_regclass('public.civic_data_clock_versions')::text AS relation")).rows[0]?.relation) {
  await db.exec(readFileSync(join(process.cwd(), "lib/db/migrations/DB-01_read_versions.sql"), "utf8"));
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
  const message = JSON.parse(line) as { id: number; type?: string; body?: string; replayAt?: number; dropNativeDatabase?:boolean };
  if (message.type === "replay-clock") {
    if (!Number.isFinite(message.replayAt)) throw new Error("The local replay clock must be a finite instant.");
    fixtureStart = message.replayAt!; elapsedStart = performance.now();
    if(native)await native.clock(fixtureStart);
    send({ id: message.id, type: "replay-clock-set" });
    continue;
  }
  if (message.type === "close") {
    await db.close();
    if(native&&message.dropNativeDatabase)await native.drop();
    send({ id: message.id, type: "closed", databasePeakRssBytes: native?native.peakRssBytes():process.resourceUsage().maxRSS * 1024,
      databaseProxyPeakRssBytes:native?process.resourceUsage().maxRSS*1024:0 });
    break;
  }
  try {
    const request = JSON.parse(message.body!) as Statement & { queries?: Statement[] };
    const execute = async (connection:{query:PGlite["query"]}, statement: Statement) => neonResult(await connection.query<unknown[]>(statement.query, statement.params ?? [], { rowMode: "array", serializers }), statement.query);
    const result = request.queries ? { results: await db.transaction(async(tx:{query:PGlite["query"]}) => {
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
