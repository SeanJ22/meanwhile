import { fork } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, totalmem } from "node:os";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseCsv } from "../lib/reference/csv.ts";
import { assignment } from "./cli-args.mts";
import type { Query } from "../lib/facts/publish.ts";

const root = process.cwd();
const argument = (name: string, defaultValue: number) => Number(assignment(process.argv, name) ?? defaultValue);
const directory = assignment(process.argv, "directory") ?? join(tmpdir(), `legistar-scale-${process.pid}`);

if (process.argv.includes("--worker")) {
  const { refreshLegistarMembers } = await import("../lib/sources/legistar/members-refresh.ts");
  const { factClocks } = await import("../lib/facts/clocks.ts");
  const { DurableEvidenceStore } = await import("../lib/control-plane/evidence/durable-store.ts");
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  process.on("message", (message: { id: number; result?: unknown; error?: string }) => {
    const promise = pending.get(message.id); if (!promise) return;
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error)); else promise.resolve(message.result);
  });
  const request = (kind: string, payload: unknown) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); process.send!({ id, kind, payload });
  });
  let stage = "startup";
  const stages: Record<string, { rssBytes: number; heapBytes: number }> = {};
  const sample = () => {
    const memory = process.memoryUsage(), prior = stages[stage];
    stages[stage] = { rssBytes: Math.max(prior?.rssBytes ?? 0, memory.rss), heapBytes: Math.max(prior?.heapBytes ?? 0, memory.heapUsed) };
  };
  const query: Query = async (text, params = []) => {
    sample();
    stage = text.startsWith("SELECT value FROM cp_doors") ? "tenant-doors" : text.startsWith("SELECT sha256 FROM fact_store_load") ? "roster-signature"
      : text.startsWith("INSERT INTO fact_store_load") ? "checkpoint" : "fact-publication";
    return await request("sql", { text, params }) as Record<string, unknown>[];
  };
  const fetchImpl = (async (url: string | URL | Request) => {
    sample(); stage = new URL(String(url)).searchParams.has("$select") ? "source-probe" : "source-read-and-save";
    return Response.json(await request("source", String(url)));
  }) as typeof fetch;
  const timer = setInterval(sample, 20);
  const start = performance.now();
  const result = await refreshLegistarMembers({ facts: { query, transaction: async work => {
    await query("BEGIN");
    try { const result = await work(query); await query("COMMIT"); return result; }
    catch (error) { await query("ROLLBACK"); throw error; }
  } }, doors: query, clocks: factClocks(null), vault: new DurableEvidenceStore(join(directory, "vault"), { remote: null }),
    now: new Date().toISOString(), slug: "pima", fetchImpl });
  clearInterval(timer); sample();
  process.send!({ kind: "done", result, stages, peakMemoryBytes: process.resourceUsage().maxRSS * 1024, runMs: performance.now() - start });
  process.disconnect();
} else {
  const { default: postgres } = await import("postgres");
  const { LEGISTAR_TENANT_SQL } = await import("../lib/doors/legistar-tenant.ts");
  const { rawFor } = await import("../tests/helpers/legistar-member-fixtures.ts");
  const bodies = argument("bodies", 1000), members = argument("members", 10000), history = argument("history", 1000000);
  const backgroundFacts = argument("facts", 5000000), boards = argument("boards", 10);
  mkdirSync(directory, { recursive: true });
  const connection = assignment(process.argv, "database");
  if (!connection || new URL(connection).hostname !== "127.0.0.1") throw new Error("SCALE_REQUIRES_ISOLATED_LOCAL_POSTGRES");
  const json = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
  const sql = postgres(connection, { max: 1, types: {
    json: { to: 114, from: [114], serialize: json, parse: JSON.parse },
    jsonb: { to: 3802, from: [3802], serialize: json, parse: JSON.parse },
  } });
  const pg = { query: async <T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
    ({ rows: await sql.unsafe(text, params as never[]) as unknown as T[] }), exec: (text: string) => sql.unsafe(text), close: () => sql.end() };
  for (const migration of ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql", "R3-LEGISTAR-MEMBERS.sql"]) {
    for (const statement of readFileSync(join(root, "lib/db/migrations", migration), "utf8").split("--> statement-breakpoint")) await pg.exec(statement);
  }
  await pg.exec(`CREATE TABLE cp_doors (id text PRIMARY KEY, value jsonb NOT NULL);
    CREATE INDEX tenant_idx ON cp_doors ((${LEGISTAR_TENANT_SQL}));
    CREATE TABLE source_rows (collection text, id int, person_id int, end_date text, data jsonb, PRIMARY KEY (collection, id));
    CREATE INDEX source_end_idx ON source_rows (collection, end_date, id);
    CREATE TABLE governments (id text PRIMARY KEY, state text);`);
  const raw = rawFor("pima"), now = new Date().toISOString();
  for (const [collection, rows] of [["bodies", Array.from({ length: bodies }, (_, i) => ({ ...raw.bodies[0], BodyId: i + 1, BodyName: `Generated Board ${i + 1}` }))],
    ["persons", Array.from({ length: (Math.ceil(members / 2) + 1) }, (_, i) => ({ ...raw.persons[0], PersonId: i + 1, PersonFullName: `Generated Member ${i + 1}` }))],
    ["officerecords", Array.from({ length: members }, (_, i) => ({ ...raw.offices[0], OfficeRecordId: i + 1, OfficeRecordBodyId: i % bodies + 1,
      OfficeRecordPersonId: i % (Math.ceil(members / 2) + 1) + 1, OfficeRecordFullName: `Generated Member ${i % (Math.ceil(members / 2) + 1) + 1}` }))]] as const) {
    await pg.query(`INSERT INTO source_rows SELECT $1, (data->>$2)::int, (data->>'OfficeRecordPersonId')::int,
      data->>'OfficeRecordEndDate', data FROM jsonb_array_elements($3::jsonb) data`, [collection, collection === "bodies" ? "BodyId" : collection === "persons" ? "PersonId" : "OfficeRecordId", JSON.stringify(rows)]);
  }
  await pg.query(`INSERT INTO source_rows SELECT 'officerecords', 1000000+i, 1000000+i, '2000-01-01T00:00:00',
    jsonb_build_object('OfficeRecordId',1000000+i,'OfficeRecordPersonId',1000000+i,'OfficeRecordEndDate','2000-01-01T00:00:00','OfficeRecordRowVersion','historic') FROM generate_series(1,$1::int) i`, [history]);
  await pg.query(`INSERT INTO source_rows SELECT 'persons', 1000000+i, NULL, NULL,
    jsonb_build_object('PersonId',1000000+i,'PersonFullName','Historic Person','PersonRowVersion','historic') FROM generate_series(1,$1::int) i`, [history]);
  const own = { formatVersion: 1, doorId: "pima", kind: "legistar", ocdId: "ocd-division/country:us/state:az/county:pima", bodyIds: ["ocd-division/country:us/state:az/county:pima#governing"],
    hosts: ["webapi.legistar.com"], config: { slug: "pima", eventBodyId: "1", sourceRoutes: "legistar" }, status: "OPEN",
    meeting: { agendaSourceType: "LEGISTAR", jurisdiction: "Pima", publishingOrg: "Pima", timeZone: "America/Phoenix", verifiedAt: now, family: null } };
  await pg.query("INSERT INTO cp_doors VALUES ('pima', $1)", [JSON.stringify(own)]);
  const run = async (label: string) => {
    const [start] = (await pg.query("SELECT pg_current_wal_lsn() AS lsn")).rows;
    const measured = await new Promise<Record<string, unknown>>((resolve, reject) => {
    let readBytes = 0, writtenBytes = 0, queries = 0, sourceReads = 0, sourceBytes = 0;
    const child = fork(fileURLToPath(import.meta.url), ["--worker", `--directory=${directory}`], {
      execArgv: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"], stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, DATABASE_URL: "", WTP_CONTROL_PLANE_DATABASE_URL: "" } });
    let done = false;
    child.on("message", async (message: { id: number; kind: string; payload: { text: string; params: unknown[] } | string; result?: unknown; peakMemoryBytes?: number; runMs?: number; stages?: unknown }) => {
      if (message.kind === "done") {
        done = true;
        console.log(JSON.stringify({ phase: label, runMs: message.runMs, peakMemoryBytes: message.peakMemoryBytes, queries, readBytes, writtenBytes }));
        resolve({ label, ...message.result as object, peakMemoryBytes: message.peakMemoryBytes, runMs: message.runMs,
          databaseReadBytes: readBytes, databaseRequestBytes: writtenBytes, queries, sourceReads, sourceBytes, stages: message.stages }); return;
      }
      try {
        let result;
        if (message.kind === "sql") {
          const { text, params } = message.payload as { text: string; params: unknown[] };
          writtenBytes += Buffer.byteLength(JSON.stringify({ query: text, params })); queries++;
          result = (await pg.query(text, params)).rows;
          readBytes += Buffer.byteLength(JSON.stringify(result));
        } else {
          sourceReads++;
          const url = new URL(message.payload as string), collection = url.pathname.split("/").at(-1)!;
          if (url.hostname !== "webapi.legistar.com" || !url.pathname.startsWith("/v1/pima/")) throw new Error("SOURCE_TENANT_ESCAPED");
          const filter = url.searchParams.get("$filter") ?? "", idField = collection === "bodies" ? "BodyId" : collection === "persons" ? "PersonId" : "OfficeRecordId";
          const cursor = Number(new RegExp(`${idField} gt (\\d+)`).exec(filter)?.[1] ?? 0);
          const ids = [...filter.matchAll(/PersonId eq (\d+)/g)].map(match => Number(match[1]));
          const end = /OfficeRecordEndDate ge datetime'([^']+)'/.exec(filter)?.[1] ?? null;
          if (collection === "officerecords" && !end || collection === "persons" && !ids.length) throw new Error("UNBOUNDED_SOURCE_READ");
          const clauses = ["collection=$1", "id>$2"], params: unknown[] = [collection, cursor];
          if (end) { params.push(end); clauses.push(`(end_date IS NULL OR end_date >= $${params.length})`); }
          if (collection === "persons") { params.push(ids); clauses.push(`id=ANY($${params.length}::int[])`); }
          const rows = (await pg.query<{ data: Record<string, unknown> }>(`SELECT data FROM source_rows WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT 1000`, params)).rows;
          const selected = url.searchParams.get("$select")?.split(",");
          result = rows.map(row => selected ? Object.fromEntries(selected.map(key => [key, row.data[key]])) : row.data);
          sourceBytes += Buffer.byteLength(JSON.stringify(result));
        }
        child.send({ id: message.id, result });
      } catch (error) { child.send({ id: message.id, error: String(error) }); }
    });
    child.on("exit", code => { if (!done) reject(new Error(`${label} worker exited ${code}`)); });
    });
    const [wal] = (await pg.query("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1) AS bytes", [start.lsn])).rows;
    const [live] = (await pg.query("SELECT count(*) AS members FROM fact WHERE produced_by='legistar-members:pima' AND field LIKE 'member:%' AND status='live'")).rows;
    if (Number(live.members) !== members) throw new Error("READER_MEMBERSHIP_COUNT_DIFFERS_FROM_SOURCE");
    return { ...measured, databaseWalBytes: Number(wal.bytes) };
  };
  const measurements: Record<string, unknown>[] = [];
  const changeOffice = () => pg.query("UPDATE source_rows SET data=jsonb_set(jsonb_set(data,'{OfficeRecordTitle}','\"Changed Office Title\"'),'{OfficeRecordRowVersion}','\"changed\"') WHERE collection='officerecords' AND id=1");
  measurements.push(await run("one-government-cold"));
  await changeOffice();
  measurements.push(await run("one-government-changed"));
  measurements.push(await run("one-government-unchanged"));
  const tables = (await pg.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('cp_doors','source_rows','governments')")).rows;
  await pg.exec(`TRUNCATE ${tables.map(row => `"${row.tablename}"`).join(",")} RESTART IDENTITY CASCADE`);
  await rm(join(directory, "vault"), { recursive: true });
  await pg.query("UPDATE source_rows SET data=jsonb_set(jsonb_set(data,'{OfficeRecordTitle}',$1::jsonb),'{OfficeRecordRowVersion}',$2::jsonb) WHERE collection='officerecords' AND id=1",
    [JSON.stringify(raw.offices[0].OfficeRecordTitle), JSON.stringify(raw.offices[0].OfficeRecordRowVersion)]);
  const csv = parseCsv(readFileSync(join(root, "data/reference/census_govt_units_2022.csv"), "utf8"));
  const columns = csv.shift()!, idAt = columns.indexOf("census_id_pid6"), stateAt = columns.indexOf("state");
  const governments = csv.filter(row => row[idAt] && row[stateAt]).map(row => ({ id: row[idAt], state: row[stateAt] }));
  for (let offset = 0; offset < governments.length; offset += 1000) {
    await pg.query("INSERT INTO governments SELECT id,state FROM jsonb_to_recordset($1::jsonb) AS r(id text,state text) ON CONFLICT DO NOTHING", [JSON.stringify(governments.slice(offset, offset + 1000))]);
  }
  await pg.query(`INSERT INTO cp_doors SELECT g.id || ':' || n,
    jsonb_build_object('meeting', jsonb_build_object('agendaSourceType','LEGISTAR','timeZone','America/New_York','publishingOrg','Generated government'),
      'config',jsonb_build_object('slug',lower(g.state)||'-'||g.id),'status','OPEN','bodyIds',jsonb_build_array(g.id||':'||n),
      'ocdId','ocd-division/country:us/state:'||lower(g.state)||'/government:'||g.id,'notes',repeat('Generated production-volume door ',20))
    FROM governments g CROSS JOIN generate_series(1,$1::int) n`, [boards]);
  await pg.query("INSERT INTO entity (id,kind,name,state) SELECT 'background:'||id,'body','Generated background body',state FROM governments");
  await pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,quote,checked_at,produced_by)
    SELECT e.id,'field:'||n,'"background"','background','superseded','OWNER','background',now(),'scale'
    FROM (SELECT id,row_number() OVER (ORDER BY id) AS rn FROM entity WHERE starts_with(id,'background:')) e
    CROSS JOIN generate_series(1,ceil($1::numeric/(SELECT count(*) FROM governments))::int) n
    WHERE (n-1)*(SELECT count(*) FROM governments)+e.rn <= $1`, [backgroundFacts]);
  await pg.query("INSERT INTO fact_store_load (source,sha256) SELECT 'legistar-members:'||lower(state)||'-'||id,repeat('a',64) FROM governments");
  await pg.exec("ANALYZE");
  const sizes = (await pg.query("SELECT (SELECT count(*) FROM cp_doors) AS doors,(SELECT count(*) FROM fact) AS facts,(SELECT count(*) FROM governments) AS governments")).rows[0];
  console.log(JSON.stringify({ seeded: sizes, states: [...new Set(governments.map(row => row.state))].sort() }));
  measurements.push(await run("national-cold"));
  await changeOffice();
  measurements.push(await run("national-changed"));
  measurements.push(await run("national-unchanged"));
  const margin = 0.75 * 2**30;
  let runnerBytes = totalmem();
  try { const limit = Number(readFileSync('/sys/fs/cgroup/memory.max', 'utf8')); if (Number.isFinite(limit)) runnerBytes = Math.min(runnerBytes, limit); } catch {}
  const peak = Math.max(...measurements.map(row => Number(row.peakMemoryBytes)));
  const before = measurements.find(row => row.label === "one-government-unchanged")!;
  const after = measurements.find(row => row.label === "national-unchanged")!;
  if (before.databaseReadBytes !== after.databaseReadBytes || before.databaseRequestBytes !== after.databaseRequestBytes || after.records !== 0) throw new Error("COUNTRY_SIZE_CHANGED_TENANT_IO");
  const report = { sizes, bodies, members, historyPersons: history, historyOffices: history, states: [...new Set(governments.map(row => row.state))].sort(),
    runnerBytes, marginBytes: margin, copies: Math.floor((runnerBytes-margin)/peak), measurements,
    byteDefinition: "UTF-8 SQL request JSON and result-row JSON excluding protocol/TLS; native PostgreSQL WAL bytes and source API bytes reported separately",
    limits: "Generated national database and Legistar responses; no live nationwide tenant run, remote database round-trip or production runner baseline measured" };
  writeFileSync(join(directory, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await pg.close();
}
