/** A separate disposable PostgreSQL for RH-01 publication writes; empty reads consult production read-only. */
import { createServer } from "node:http";
import { withProductionReadOwner } from "./rh01-network.mjs";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import { AGGREGATE_KINDS, APPEND_ONLY_LOGS } from "../lib/control-plane/repository/pg-schema.ts";
import { projectedRead, updateRead, shadowRead, type SqlShadow } from "./rh01-sql.mts";
import { installMeasurementNetworkBoundary } from "./rh01-network.mjs";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";

installMeasurementNetworkBoundary();

const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection || decodeURIComponent(new URL(connection).username) !== "readonly") throw Error("RH01 facts require production readonly");
const remote = neon(connection), pg = new PGlite(join(process.env.WTP_RH01_DIRECTORY!, "facts"));
const trace = (stage: string) => { if (process.env.WTP_RH01_TRACE) process.stderr.write(`RH01_DATABASE_STAGE ${stage}\n`); };
trace("created");
for (const migration of ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql"]) {
  const source = await readFile(join(process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), "lib/db/migrations", migration), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) if (statement.trim()) await pg.exec(statement);
  trace(migration);
}
let serial: Promise<unknown> = Promise.resolve();
let remoteBytes = 0;
const shutdown = new AbortController();
let remoteControlBytes = 0;
let controlPg: PGlite | null = null;
let canonicalPg: PGlite | null = null;
let routineSqlite: DatabaseSync | null = null;
const canonicalVersions = new Set<string>();
let controlQueue: Promise<unknown> = Promise.resolve();
let readerQueue: Promise<unknown> = Promise.resolve();
const seededControl = new Set<string>();
const seededSites = new Set<string>();
const controlTables = new Map<string, readonly string[]>();
const aggregateTables = new Set(AGGREGATE_KINDS.map(kind => `cp_${kind}`));
const logTables = new Set(APPEND_ONLY_LOGS.map(kind => `cp_log_${kind}`));
async function controlDatabase(): Promise<PGlite> {
  if (!controlPg) {
    controlPg = new PGlite(join(process.env.WTP_RH01_DIRECTORY!, "control"));
    await controlPg.exec(`CREATE FUNCTION rh01_touch_changed_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.changed_at=now(); RETURN NEW; END $$`);
  }
  return controlPg;
}
async function ensureControlTable(table: string): Promise<readonly string[]> {
  if (controlTables.has(table)) return controlTables.get(table)!;
  const db = await controlDatabase();
  let keys: readonly string[];
  if (aggregateTables.has(table)) {
    keys = ["id"];
    await db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())`);
  } else if (logTables.has(table)) {
    keys = ["log_key", "record_id"];
    await db.exec(`CREATE TABLE IF NOT EXISTS ${table} (log_key text NOT NULL,record_id text NOT NULL,position bigint NOT NULL,recorded_at timestamptz NOT NULL,record jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(log_key,record_id),UNIQUE(log_key,position))`);
  } else if (table === "cp_log_heads") {
    keys = ["log_table", "log_key"];
    await db.exec("CREATE TABLE IF NOT EXISTS cp_log_heads (log_table text NOT NULL,log_key text NOT NULL,next_position bigint NOT NULL,PRIMARY KEY(log_table,log_key))");
  } else throw Error(`RH01_UNSUPPORTED_CONTROL_TABLE:${table}`);
  if (table !== "cp_log_heads") await db.exec(`CREATE TRIGGER ${table}_changed_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION rh01_touch_changed_at()`);
  controlTables.set(table, keys); return keys;
}
async function controlRemoteRead(text: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
  if (!/^\s*(?:SELECT|WITH)\b/i.test(text) || /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|cp_admit_spend_hold|pg_notify|nextval|setval|pg_advisory_lock|pg_try_advisory_lock)\b/i.test(text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "")))
    throw Error("RH01_REMOTE_CONTROL_MUTATION_REFUSED");
  const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!connection || decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") throw Error("RH01 control SQL requires the read-only role");
  const rows = await neon(connection).query(text, [...params], { fetchOptions: { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]) } });
  remoteControlBytes += Buffer.byteLength(JSON.stringify(rows)); return rows;
}
async function executeControlSql(text: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
  const db = await controlDatabase();
  const mutation = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(cp_[a-z_0-9]+)\b/i.exec(text);
  if (mutation) {
    if (/\bDELETE\s+FROM\b/i.test(text)) throw Error("RH01_UNSUPPORTED_CONTROL_DELETE");
    const table = mutation[1]!, keys = await ensureControlTable(table);
    const idParameter = /\b(?:WHERE|AND)\s+(?:[a-z_]+[.])?"?id"?\s*=\s*\$(\d+)/i.exec(text);
    const identities = keys.length === 1 ? [params[idParameter ? Number(idParameter[1]) - 1 : 0]] : params.slice(0, 2);
    if (identities.some(value => typeof value !== "string")) throw Error("RH01 control mutation requires exact row identities");
    const seed = `${table}:${JSON.stringify(identities)}`;
    if (!seededControl.has(seed)) {
      const rows = process.env.WTP_CONTROL_PLANE_DATABASE_URL ? await controlRemoteRead(`SELECT * FROM ${table} WHERE ${keys.map((key, index) => `${key}=$${index + 1}`).join(" AND ")}`, identities) : [];
      for (const row of rows) await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
      seededControl.add(seed);
    }
    return (await db.query(text, [...params])).rows as Record<string, unknown>[];
  }
  if (/\b(?:cp_admit_spend_hold|pg_notify|nextval|setval|pg_advisory_lock|pg_try_advisory_lock)\s*\(/i.test(text)) throw Error("RH01_UNSUPPORTED_CONTROL_ROUTINE");
  if (!process.env.WTP_CONTROL_PLANE_DATABASE_URL) {
    for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+"?(cp_[a-z_0-9]+)\b/gi)) await ensureControlTable(match[1]!);
    return (await db.query(text, [...params])).rows as Record<string, unknown>[];
  }
  const shadows: SqlShadow[] = [];
  for (const [table, keys] of controlTables) if (new RegExp(`\\b(?:FROM|JOIN)\\s+(?:public[.])?"?${table}"?\\b`, "i").test(text))
    shadows.push({ table, keys, rows: (await db.query(`SELECT * FROM ${table}`)).rows as Record<string, unknown>[] });
  const query = shadowRead(text, params, shadows);
  return controlRemoteRead(query.text, query.params);
}
let pacingReady = false;
const pacingCode = await import(pathToFileURL(join(process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), "lib/control-plane/website-pacing.ts")).href);
async function pacingOperation(method: string, args: unknown[]) {
  if (!["take", "hold", "heldUntil", "reserve"].includes(method)) throw Error(`RH01_UNSUPPORTED_CONTROL_MUTATION:websitePacing.${method}`);
  const local = await controlDatabase();
  if (!pacingReady) { for (const ddl of pacingCode.WEBSITE_PACING_DDL) await local.exec(ddl); pacingReady = true; }
  if (typeof args[0] !== "string") throw Error("RH01_UNSUPPORTED_PACING_READ: legacy country held-site inventory needs a previously captured read-only result; live whole-table hydration is prohibited");
  const site = args[0];
  if (!seededSites.has(site)) {
    const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    if (connection) {
      if (decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") throw Error("RH01 pacing hydration requires the read-only role");
      const rows = await neon(connection).query("SELECT * FROM cp_website_pacing WHERE site=$1", [site],
      { fetchOptions: { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]) } });
      remoteControlBytes += Buffer.byteLength(JSON.stringify(rows));
      for (const row of rows) await local.query(`INSERT INTO cp_website_pacing (site,requests,hold_until,updated_at,paced_until)
        SELECT r.site,r.requests,r.hold_until,r.updated_at,r.paced_until FROM jsonb_populate_record(NULL::cp_website_pacing,$1::jsonb) r ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
    }
    seededSites.add(site);
  }
  const repository = pacingCode.createWebsitePacing(async (text: string, params: readonly unknown[]) => (await local.query(text, [...params])).rows);
  return Reflect.apply(Reflect.get(repository, method), repository, args);
}
/** The actual PG aggregate implementation runs beside the temporary DB, so a bounded array edit
 * never reconstructs a country-sized settings document inside its worker. */
async function controlOperation(method: string, args: unknown[]) {
  if (!["read", "mustRead", "readNarrowed", "readArrayPage", "put", "compareAndSet", "compareAndSetFields", "compareAndSetArrayItem"].includes(method))
    throw Error(`RH01_UNSUPPORTED_CONTROL_MUTATION:adminConfig.${method}`);
  if (typeof args[0] !== "string") throw Error("RH01 control operation requires one exact aggregate identity");
  await ensureControlTable("cp_admin_config");
  const repository = pgAggregateRepository({ query: executeControlSql }, "AdminConfig", "cp_admin_config");
  const operation = Reflect.get(repository, method);
  if (typeof operation !== "function") throw Error(`RH01 control method unavailable: ${method}`);
  return Reflect.apply(operation, repository, args);
}
type LocalConnection = PGlite | Transaction;
interface FactSession {
  readonly token: string; readonly connection: Transaction;
  queries: Promise<unknown>; readonly end: (commit: boolean) => void; readonly closed: Promise<unknown>;
}
let current: FactSession | null = null;
const mutatedTables = new Set<string>();
const remoteRead = async (text: string, params: readonly unknown[]) => {
  if (!/^\s*(?:SELECT|WITH)\b/i.test(text) || /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|pg_notify|nextval|setval|pg_advisory_lock|pg_try_advisory_lock)\b/i.test(text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "")))
    throw Error("RH01_REMOTE_FACT_MUTATION_REFUSED");
  const result = await remote.query(text, [...params], { fetchOptions: { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]) } });
  remoteBytes += Buffer.byteLength(JSON.stringify(result));
  return result;
};
function canonicalRows(recordClass?: string, scope?: string): SqlShadow[] {
  const file = join(process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? process.env.WTP_RH01_DIRECTORY!, "routine.sqlite");
  if (!routineSqlite && existsSync(file)) { routineSqlite = new DatabaseSync(file, { readOnly: true }); routineSqlite.exec("PRAGMA busy_timeout=10000;PRAGMA cache_size=-1024;PRAGMA mmap_size=0"); }
  if (!routineSqlite) return [];
  if (!scope) {
    const estimate = routineSqlite.prepare("SELECT coalesce(sum(length(value)),0) AS bytes FROM held WHERE kind='promotions' AND (? IS NULL OR json_extract(value,'$.recordClass')=?)").get(recordClass ?? null, recordClass ?? null);
    if (Number(estimate?.bytes ?? 0) > 8 * 1024 * 1024) throw Error("RH01_UNSUPPORTED_CANONICAL_READ: the unscoped temporary bridge would materialize country publications");
  }
  const pointers = (scope && recordClass ? routineSqlite.prepare("SELECT value FROM held WHERE kind='promotions' AND id=?").all(`${recordClass}:${scope}`)
    : routineSqlite.prepare("SELECT value FROM held WHERE kind='promotions'").all()).map(row => JSON.parse(String(row.value)) as PromotedProjection);
  const promotions: Record<string, unknown>[] = [], candidates: Record<string, unknown>[] = [];
  for (const p of pointers) {
    if (recordClass && p.recordClass !== recordClass) continue;
    promotions.push({ key: p.key, source_id: p.sourceId, record_class: p.recordClass, scope: p.scope,
      current_version_id: p.versionId, last_known_good_version_id: p.lastKnownGoodVersionId, promoted_at: p.promotedAt, payload: p.payload, validation_receipt: p.receipt });
    const held = routineSqlite.prepare("SELECT value FROM held WHERE kind='candidates' AND id=?").get(p.versionId);
    if (!held) throw Error("RH01 local canonical pointer has no committed candidate");
    const row = JSON.parse(String(held.value)) as CandidateVersionRecord, c = row.candidate;
    candidates.push({ id: c.id, source_id: c.sourceId, record_class: c.recordClass, scope: c.scope, state: row.state,
      acquisition_succeeded: row.acquisitionSucceeded, raw_hash: c.retrieval.rawHash, normalized_hash: c.normalization.normalizedHash,
      retrieved_at: c.retrieval.retrievedAt, source_through: c.temporal.sourceThrough, parser_version: c.normalization.parserVersion,
      identity: c.identities, candidate: c, validation_receipt: row.receipt, promoted_version_id: row.promotedVersion,
      last_known_good_version_id: row.lastKnownGoodVersion, failure_code: row.failureCode, failure_detail: row.failureDetail });
  }
  return [{ table: "civic_data_promotions", keys: ["key"], rows: promotions }, { table: "civic_data_candidates", keys: ["id"], rows: candidates }];
}
async function canonicalDatabase(): Promise<PGlite> {
  if (!canonicalPg) {
    canonicalPg = new PGlite(join(process.env.WTP_RH01_DIRECTORY!, "canonical"));
    await canonicalPg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,record_class text,scope text,current_version_id text,last_known_good_version_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,acquisition_succeeded boolean,raw_hash text,normalized_hash text,retrieved_at timestamptz,source_through text,parser_version text,identity jsonb,candidate jsonb,validation_receipt jsonb,promoted_version_id text,last_known_good_version_id text,failure_code text,failure_detail text);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
  }
  return canonicalPg;
}
async function readerSelect(text: string, params: readonly unknown[]) {
  // Apply the same SELECT-only guard before either the local or remote engine.
  shadowRead(text, params, []);
  const exactSlice = /^\s*WITH\s+RECURSIVE\s+publication\s+AS\s+MATERIALIZED\b/i.test(text);
  const recordClass = typeof params[0] === "string" && /^[A-Z][A-Z_]+$/.test(params[0]) ? params[0] : undefined;
  const scope = exactSlice && typeof params[1] === "string" ? params[1] : undefined;
  if (exactSlice && Array.isArray(params[1]) && /SELECT DISTINCT value->>'state' AS state FROM state_records/.test(text)) {
    const states = new Set<string>(), untouched = [];
    for (const selected of params[1]) {
      if (typeof selected !== "string") throw Error("RH01 native-state scope is invalid");
      const own = canonicalRows(recordClass, selected);
      if (!own.some(shadow => shadow.rows.length)) { untouched.push(selected); continue; }
      await syncCanonical(own);
      for (const row of (await (await canonicalDatabase()).query(text, [params[0], [selected], ...params.slice(2)])).rows as { state: string }[]) states.add(row.state);
    }
    if (untouched.length) for (const row of await remoteRead(text, [params[0], untouched, ...params.slice(2)])) states.add(String(row.state));
    return [...states].sort().map(state => ({ state }));
  }
  const shadows = /\bcivic_data_(?:promotions|candidates)\b/i.test(text) ? canonicalRows(recordClass, scope) : [];
  if (!shadows.some(shadow => shadow.rows.length)) return remoteRead(text, params);
  // A single local scope replaces its production pointer completely. Multiple-scope
  // reads still need the untouched production scopes through the mixed-read path.
  if (exactSlice && scope) {
    await syncCanonical(shadows);
    return (await (await canonicalDatabase()).query(text, [...params])).rows;
  }
  const query = shadowRead(text, params, shadows);
  if (Buffer.byteLength(JSON.stringify(query.params)) > 32 * 1024 * 1024) throw Error("RH01_UNSUPPORTED_CANONICAL_READ: unscoped mixed query exceeds the bounded measurement bridge");
  return remoteRead(query.text, query.params);
}
async function syncCanonical(shadows: readonly SqlShadow[]): Promise<void> {
  const db = await canonicalDatabase();
  for (const shadow of shadows) for (const row of shadow.rows) {
      const version = `${shadow.table}:${String(row.current_version_id ?? row.id)}`;
      if (shadow.table === "civic_data_candidates" && canonicalVersions.has(version)) continue;
      await db.query(`INSERT INTO ${shadow.table} SELECT * FROM jsonb_populate_record(NULL::${shadow.table},$1::jsonb)
        ON CONFLICT (${shadow.keys.join(",")}) DO UPDATE SET ${Object.keys(row).filter(key => !shadow.keys.includes(key)).map(key => `"${key}"=EXCLUDED."${key}"`).join(",")}`, [JSON.stringify(row)]);
      canonicalVersions.add(version);
  }
}
async function insertRows(connection: LocalConnection, table: string, rows: readonly Record<string, unknown>[]) {
  if (!rows.length) return;
  if (!["entity", "entity_host", "entity_external_id", "entity_place", "source_copy", "fact", "pass_cursor"].includes(table)) throw Error("RH01 hydration table refused");
  // Deferring references allows parent/child places to enter together; exact production rows are used.
  for (const row of rows) {
    const columns = Object.keys(row);
    await connection.query(`INSERT INTO ${table} (${columns.map(name => `"${name}"`).join(",")})
      SELECT ${columns.map(name => `r."${name}"`).join(",")} FROM jsonb_populate_record(NULL::${table},$1::jsonb) r ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
  }
}
async function hydrateEntities(connection: LocalConnection, entityIds: readonly string[]) {
  if (!entityIds.length) return;
  const entities = await remoteRead(`WITH RECURSIVE parents AS (
    SELECT * FROM entity WHERE id=ANY($1::text[]) UNION SELECT e.* FROM entity e JOIN parents p ON p.parent_id=e.id
  ) SELECT * FROM parents ORDER BY parent_id NULLS FIRST,id`, [entityIds]);
  // Parent places precede children. Recurse in JS only across these requested facts' ancestors.
  const remaining = new Map(entities.map(row => [String(row.id), row]));
  while (remaining.size) {
    const ready = [...remaining.values()].filter(row => !row.parent_id || !remaining.has(String(row.parent_id)));
    if (!ready.length) throw Error("RH01 entity parent cycle");
    await insertRows(connection, "entity", ready);
    ready.forEach(row => remaining.delete(String(row.id)));
  }
}
async function hydrateFactRows(connection: LocalConnection, heldFacts: readonly Record<string, unknown>[]) {
  const facts = heldFacts.filter(row => row.id !== null && row.id !== undefined);
  if (!facts.length) return;
  const entityIds = [...new Set(facts.map(row => String(row.entity_id)))];
  await hydrateEntities(connection, entityIds);
  const copyIds = [...new Set(facts.flatMap(row => [row.source_copy_id, row.second_copy_id].filter(value => value !== null && value !== undefined)))];
  if (copyIds.length) await insertRows(connection, "source_copy", await remoteRead("SELECT * FROM source_copy WHERE id=ANY($1::bigint[])", [copyIds]));
  await insertRows(connection, "fact", facts);
  await insertRows(connection, "entity_external_id", await remoteRead("SELECT * FROM entity_external_id WHERE entity_id=ANY($1::text[])", [entityIds]));
}
async function hydrateFacts(connection: LocalConnection, text: string, params: readonly unknown[]): Promise<boolean> {
  if (!/\bfact\s+f\b/i.test(text)) return false;
  const projected = projectedRead(text, "f.*");
  if (!projected) return false;
  await hydrateFactRows(connection, await remoteRead(projected, params));
  return true;
}
/** Hydrate the exact production matches before applying a mixed read to local changes. */
async function hydrateSimpleRead(connection: LocalConnection, text: string, params: readonly unknown[]): Promise<boolean> {
  if (!/^\s*SELECT\b/i.test(text) || /\b(?:UNION|GROUP\s+BY|HAVING)\b/i.test(text)) return false;
  const from = /\bFROM\s+(entity|entity_host|entity_external_id|entity_place|source_copy)\b(?:\s+(?:AS\s+)?([a-z][a-z0-9_]*))?/i.exec(text);
  if (!from) return false;
  if (/\bSELECT\b/i.test(text.slice(0, from.index).replace(/^\s*SELECT\b/i, ""))) return false;
  const table = from[1]!, alias = from[2] && !/^(?:where|left|right|inner|join|order|limit|for|offset)$/i.test(from[2]) ? from[2] : table;
  const projected = projectedRead(text, `${alias}.*`);
  if (!projected) return false;
  const rows = await remoteRead(projected, params);
  const entities = table === "entity" ? rows.map(row => String(row.id))
    : rows.flatMap(row => [row.entity_id, row.place_id].filter(value => value !== undefined && value !== null).map(String));
  await hydrateEntities(connection, [...new Set(entities)]);
  if (table !== "entity") await insertRows(connection, table, rows);
  return true;
}
async function execute(connection: LocalConnection, text: string, params: readonly unknown[]) {
  const read = /^\s*(SELECT|WITH)\b/i.test(text) && !/\b(INSERT|UPDATE|DELETE|MERGE|CALL)\b/i.test(text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, ""));
  if (!read) {
    const update = updateRead(text);
    if (update) {
      const rows = await remoteRead(update.text, params);
      if (update.table === "fact") await hydrateFactRows(connection, rows);
      else {
        await hydrateEntities(connection, update.table === "entity" ? rows.map(row => String(row.id))
          : rows.flatMap(row => [row.entity_id, row.place_id].filter(Boolean).map(String)));
        await insertRows(connection, update.table, rows);
      }
    }
    const mutation = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-z_]+)/i.exec(text)?.[1];
    if (mutation) mutatedTables.add(mutation);
    return (await connection.query(text, [...params])).rows;
  }
  if (await hydrateFacts(connection, text, params)) return (await connection.query(text, [...params])).rows;
  if (await hydrateSimpleRead(connection, text, params)) return (await connection.query(text, [...params])).rows;
  if (/\bFROM\s+pass_cursor\b/i.test(text)) {
    const rows = (await connection.query(text, [...params])).rows;
    if (rows.length || mutatedTables.has("pass_cursor")) return rows;
  }
  const tables = [...text.matchAll(/\b(?:FROM|JOIN)\s+"?([a-z_]+)/gi)].map(match => match[1]!);
  if (tables.some(table => mutatedTables.has(table))) {
    const identities: Record<string, readonly string[]> = { entity: ["id"], entity_host: ["entity_id", "host"], entity_external_id: ["scheme", "value"],
      entity_place: ["entity_id", "place_id"], source_copy: ["id"], fact: ["id"], pass_cursor: ["name"] };
    const shadows: SqlShadow[] = [];
    for (const table of new Set(tables)) if (identities[table]) shadows.push({ table, keys: identities[table]!,
      rows: (await connection.query(`SELECT * FROM ${table}`)).rows as Record<string, unknown>[] });
    const query = shadowRead(text, params, shadows);
    return remoteRead(query.text, query.params);
  }
  return remoteRead(text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, ""), params);
}
// Local publication IDs must never collide with later hydrated production IDs.
await pg.exec("SELECT setval(pg_get_serial_sequence('fact','id'),1000000000000,true); SELECT setval(pg_get_serial_sequence('source_copy','id'),1000000000000,true)");
trace("sequences");
const server = createServer((request, response) => withProductionReadOwner({
  ownerPid: Number(request.headers["x-rh01-owner-pid"]) || process.pid,
  jobId: String(request.headers["x-rh01-owner-job"] ?? ""), taskId: String(request.headers["x-rh01-owner-task"] ?? ""),
}, async () => {
  if (request.method !== "POST" || !["/query", "/begin", "/commit", "/rollback", "/control", "/control-sql", "/reader-select", "/pacing"].includes(request.url ?? "")) { response.writeHead(404).end(); return; }
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const decoded = JSON.parse(body || "{}");
    const { text, params = [], token } = decoded as { text: string; params: unknown[]; token?: string };
    if (request.url === "/reader-select") {
      const statements = decoded.statements as readonly { text: string; params: readonly unknown[] }[];
      if (!Array.isArray(statements) || statements.some(statement => typeof statement?.text !== "string" || !Array.isArray(statement.params))) throw Error("RH01 reader statements are invalid");
      const pending = readerQueue.then(async () => {
        const results = [];
        for (const statement of statements) results.push(await readerSelect(statement.text, statement.params));
        return results;
      });
      readerQueue = pending.catch(() => undefined);
      const results = await pending;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results })); return;
    }
    if (request.url === "/control" || request.url === "/control-sql" || request.url === "/pacing") {
      const sqlRequest = request.url === "/control-sql";
      const operation = request.url === "/pacing" ? pacingOperation : controlOperation;
      const pending = controlQueue.then(() => sqlRequest ? executeControlSql(text, params) : operation(decoded.method, decoded.args));
      controlQueue = pending.catch(() => undefined);
      const result = await pending;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sqlRequest ? { rows: result } : result instanceof Map ? { map: [...result] } : { result })); return;
    }
    if (request.url === "/begin") {
      const ready = new Promise<FactSession>((accept, reject) => {
        const start = async () => {
          let end!: (commit: boolean) => void;
          const ending = new Promise<boolean>(resolve => { end = resolve; });
          let session!: FactSession;
          const closed = pg.transaction(async connection => {
            session = { token: randomUUID(), connection, queries: Promise.resolve(), end, closed: Promise.resolve().then(() => closed) };
            current = session; accept(session);
            const commit = await ending;
            await session.queries;
            if (!commit) throw Error("RH01_TRANSACTION_ROLLBACK");
          }).finally(() => { if (current === session) current = null; });
          closed.catch(() => undefined);
          return closed;
        };
        const pending = serial.then(start, start);
        serial = pending.catch(() => undefined);
        pending.catch(reject);
      });
      const session = await ready;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token: session.token })); return;
    }
    if (request.url === "/commit" || request.url === "/rollback") {
      const session = current;
      if (!session || session.token !== token) throw Error("RH01 transaction token mismatch");
      session.end(request.url === "/commit");
      try { await session.closed; } catch (error) { if (request.url !== "/rollback") throw error; }
      response.writeHead(200, { "content-type": "application/json" }).end("{}"); return;
    }
    const session = current?.token === token ? current : null;
    if (token && !session) throw Error("RH01 transaction token mismatch");
    const pending = session ? session.queries.then(() => execute(session.connection, text, params)) : serial.then(() => execute(pg, text, params));
    if (session) session.queries = pending;
    else serial = pending.catch(() => undefined);
    const rows = await pending;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ rows }));
  } catch (error) { response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
}));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw Error("RH01 facts server address missing");
  process.stdout.write(`RH01_FACTS_READY ${JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${address.port}/query` })}\n`);
});
process.once("SIGTERM", () => {
  shutdown.abort(Error("RH01 local database is stopping"));
  current?.end(false);
  process.stdout.write(`RH01_FACTS_END ${JSON.stringify({ remoteBytes, remoteControlBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024 })}\n`);
  server.close(() => { routineSqlite?.close(); void Promise.all([pg.close(), controlPg?.close(), canonicalPg?.close()]).then(() => process.exit(0)); });
});
