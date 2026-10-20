/** Storage doubles used only by the RH-01 production read-only measurement loader.
 * Production reads retain their real credentials; publication writes go to temporary local storage.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import type { RoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineRecordClass } from "../lib/civic-data/types.ts";
import type { ConfirmUnchangedInput } from "../lib/civic-data/unchanged-confirmation.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

const root = process.env.WTP_RH01_DIRECTORY;
if (!root) throw Error("RH01 measurement directory is required");
const sharedRoot = process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? root;
mkdirSync(sharedRoot, { recursive: true });
/** Observe the actual child, preserving its normal launch, callbacks and result. */
export function observeChildStart(id: string, command: readonly string[], pid: number, env: NodeJS.ProcessEnv): string {
  const directory = join(sharedRoot, "observed-children"); mkdirSync(directory, { recursive: true });
  const key = `${pid}-${Date.now()}`, file = join(directory, key);
  writeFileSync(`${file}.json`, JSON.stringify({ id, command, pid, parentPid: process.pid, startedAt: new Date().toISOString(), settled: false,
    authority: { capability: env.WTP_RUNTIME_AUTHORITY_CAPABILITY ?? null, contract: env.WTP_RUNTIME_AUTHORITY_CONTRACT || null } }));
  return file;
}
export function observeChildEnd(file: string | undefined, result: { readonly status: number | null; readonly signal: unknown;
  readonly stdout: string; readonly stderr: string; readonly termination: string; readonly errorMessage?: string | null }): void {
  if (!file) return;
  const prior = JSON.parse(readFileSync(`${file}.json`, "utf8"));
  writeFileSync(`${file}.stdout.log`, result.stdout); writeFileSync(`${file}.stderr.log`, result.stderr);
  writeFileSync(`${file}.json`, JSON.stringify({ ...prior, settled: true, finishedAt: new Date().toISOString(), status: result.status,
    signal: result.signal, termination: result.termination, errorMessage: result.errorMessage ?? null,
    refusedOperation: /RH01_(?:UNSUPPORTED|REMOTE_.*_BLOCKED)|WRITE_HANDLE_REFUSED|RuntimeAuthorityRefused/.test(result.stdout + result.stderr) }));
}
export function observeVitalPart(part: { readonly pid?: number; readonly startedMs?: number; readonly hour: string }): void {
  if (!part.pid || !part.startedMs) return;
  const directory = join(sharedRoot, "observed-byte-parts"); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${part.pid}-${part.startedMs}-${Date.parse(part.hour)}.json`), JSON.stringify(part));
}
const sqlite = new DatabaseSync(join(sharedRoot, "routine.sqlite"));
sqlite.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE IF NOT EXISTS held (kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS routine_locks (name TEXT PRIMARY KEY,pid INTEGER NOT NULL,token TEXT NOT NULL)");
sqlite.exec("CREATE INDEX IF NOT EXISTS held_scope ON held(kind,json_extract(value,'$.candidate.recordClass'),json_extract(value,'$.candidate.scope'),json_extract(value,'$.candidate.sourceId'))");
interface LocalStatement {
  get(...parameters: readonly (string | number)[]): Record<string, unknown> | undefined;
  run(...parameters: readonly (string | number)[]): unknown;
  all(...parameters: readonly (string | number)[]): Record<string, unknown>[];
}
const statement = (sql: string) => sqlite.prepare(sql) as unknown as LocalStatement;
const get = statement("SELECT value FROM held WHERE kind=? AND id=?");
const put = statement("INSERT INTO held VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value");
const saved = <T = unknown,>(kind: string, id: string): T | null => {
  const row = get.get(kind, id);
  return row ? JSON.parse(String(row.value)) : null;
};
const save = (kind: string, id: string, value: unknown) => {
  put.run(kind, id, JSON.stringify(value));
  if (kind === "candidates") {
    const row = value as CandidateVersionRecord, candidate = row.candidate;
    put.run("candidate-clocks", id, JSON.stringify({ ...row, candidate: {
      id: candidate.id, sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope,
      ...(candidate.bootstrapImport ? { bootstrapImport: candidate.bootstrapImport } : {}),
      retrieval: { retrievedAt: candidate.retrieval.retrievedAt, sourceCheck: candidate.retrieval.sourceCheck },
      normalization: { parserVersion: candidate.normalization.parserVersion },
    } }));
  } else if (kind === "promotions") {
    const pointer = value as PromotedProjection, payload = pointer.payload as { meetings?: readonly { startsAt?: unknown }[] } | null;
    put.run("promotion-clocks", id, JSON.stringify({ ...pointer, payload: pointer.recordClass === "MEETING" && Array.isArray(payload?.meetings)
      ? { meetings: payload.meetings.map(meeting => ({ startsAt: meeting.startsAt })) } : null }));
  }
};
async function withRoutineLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const token = randomUUID(), until = Date.now() + 600_000;
  const take = statement("INSERT OR IGNORE INTO routine_locks VALUES (?,?,?)"), holder = statement("SELECT pid,token FROM routine_locks WHERE name=?");
  const drop = statement("DELETE FROM routine_locks WHERE name=? AND token=?");
  for (;;) {
    take.run(name, process.pid, token);
    const row = holder.get(name);
    if (row?.token === token) break;
    if (row) {
      let live = true;
      try { live = !/[)] [ZX] /.test(readFileSync(`/proc/${Number(row.pid)}/stat`, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") live = false; }
      if (!live) drop.run(name, String(row.token));
    }
    if (Date.now() >= until) throw Error("RH01 local candidate serialization deadline ended");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  try { return await work(); } finally { drop.run(name, token); }
}

export function assertReadonlyTargets(): { connection: string; variable: string; role: string; host: string; database: string } {
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!connection || process.env.DATABASE_URL !== connection) throw Error("RH01 requires the explicit production read-only connection");
  const target = new URL(connection);
  if (decodeURIComponent(target.username) !== "readonly" || !target.hostname.replace("-pooler.", ".").startsWith("ep-dry-river-axwtolzc.")) throw Error("RH01 production read-only target mismatch");
  return { connection, variable: "WTP_PRODUCTION_DATABASE_URL_READONLY", role: "readonly", host: target.hostname, database: target.pathname.slice(1) };
}

/** Checks grants without attempting a write, including roles inherited through membership. */
export async function verifyReadonly(): Promise<void> {
  assertReadonlyTargets();
  for (const [connection, role] of [[process.env.DATABASE_URL, "readonly"], [process.env.WTP_CONTROL_PLANE_DATABASE_URL, "wtp_cp_release_readonly"]]) {
    if (!connection) continue;
    const sql = neon(connection);
    const [row] = await sql.query(`SELECT current_user AS role,
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'SELECT')) AS can_read,
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND (has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'INSERT') OR has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'UPDATE') OR has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'DELETE'))) AS can_write`);
    if (row?.role !== role || !row.can_read || row.can_write) throw Error(`RH01 database did not prove read-only grants for ${role}`);
  }
}

const mutations = new Set(["create", "transition", "recordRecheck", "promote", "appendEvidence", "confirmUnchanged"]);
const routineOverlays = new WeakSet<object>();
const routineIdentities = new WeakMap<object, object>();
export const isRoutineOverlay = (value: unknown): boolean => typeof value === "object" && value !== null && routineOverlays.has(value);
export const routineStoreIdentity = (value: object): object => routineIdentities.get(value) ?? value;

/** The real PG repositories keep their SQL, projections, CAS and log allocation behavior. */
export function controlSql<T extends { query: (...args: never[]) => unknown }>(production: T): T {
  const endpoint = process.env.WTP_RH01_FACTS_URL?.replace(/\/query$/, "/control-sql");
  if (!endpoint) return production;
  return new Proxy(production, { get(target, name) {
    if (name !== "query") return Reflect.get(target, name);
    return async (text: string, params: readonly unknown[] = []) => {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, params }) });
      const result = await response.json() as { rows?: unknown[]; error?: string };
      if (!response.ok) throw Error(result.error ?? "RH01 local control SQL failed");
      return result.rows ?? [];
    };
  } });
}

export const controlLocks = () => ({ withLock: <T,>(name: string, work: () => Promise<T>): Promise<T> => withRoutineLock(`control:${name}`, work) });

export function readonlyReaderQuery(): ((statements: readonly { text: string; params: readonly unknown[] }[]) => Promise<readonly (readonly Record<string, unknown>[])[]>) | null {
  const endpoint = process.env.WTP_RH01_FACTS_URL?.replace(/\/query$/, "/reader-select");
  if (!endpoint) return null;
  return async statements => {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statements }) });
    const body = await response.json() as { results?: Record<string, unknown>[][]; error?: string };
    if (!response.ok) throw Error(body.error ?? "RH01 canonical read SQL failed");
    return body.results ?? [];
  };
}

/** The existing in-memory store's validation/transition implementation, with its maps spilled after each call.
 * Reads not written in this run come from the real production store. Keeping one candidate operation in
 * memory avoids turning a many-page source run into a benchmark-only memory leak.
 */
export function routineOverlay(production: RoutineDataStore, memory: RoutineDataStore): RoutineDataStore {
  const kinds = ["candidates", "history", "promotions"];
  const mapOf = <T = unknown,>(kind: string) => Reflect.get(memory, kind) as Map<string, T>;
  const call = <T = unknown,>(store: object, name: string, args: readonly unknown[]): T => Reflect.apply(Reflect.get(store, name), store, args) as T;
  const hydrate = (kind: string, id: string) => {
    const value = saved(kind, id);
    if (value !== null) mapOf(kind).set(id, value);
  };
  const hydrateScope = (recordClass: string, scope: string, sourceId?: string): number => {
    const ids = statement(`SELECT id FROM held WHERE kind='candidate-clocks' AND json_extract(value,'$.candidate.recordClass')=?
      AND json_extract(value,'$.candidate.scope')=?${sourceId === undefined ? "" : " AND json_extract(value,'$.candidate.sourceId')=?"}`)
      .all(recordClass, scope, ...(sourceId === undefined ? [] : [sourceId]));
    for (const { id } of ids) {
      mapOf("candidates").set(String(id), saved("candidate-clocks", String(id)));
      hydrate("history", String(id));
    }
    return ids.length;
  };
  const seedCandidate = async (id: string) => {
    if (!id || saved("candidates", id)) return;
    const row = await production.readCandidate(id);
    if (!row) return;
    const history = await production.events(id);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (!saved("candidates", id)) { save("candidates", id, row); save("history", id, history); }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  };
  const seedPointer = async (recordClass: RoutineRecordClass, scope: string) => {
    const key = `${recordClass}:${scope}`;
    const local = saved("promotions", key);
    if (local) { mapOf("promotions").set(key, local); return; }
    // The mutation's pointer fence needs identity only; fetching its read model would inflate a metadata write.
    const pointer = await production.readPromotionIdentity?.(recordClass, scope);
    if (pointer) mapOf("promotions").set(key, { ...pointer, payload: null, receipt: null });
  };
  const flush = (method: string) => {
    if (!mutations.has(method)) { for (const kind of kinds) mapOf(kind).clear(); return; }
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const kind of kinds) {
        for (const [id, value] of mapOf(kind)) {
          if (kind !== "promotions" || method === "promote" || saved("promotions", id)) save(kind, id, value);
        }
        mapOf(kind).clear();
      }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  };
  let serial: Promise<unknown> = Promise.resolve();
  const overlay = new Proxy(production, { get(_target, name) {
    if (name === "readFederalRollCallPublicationBase") return async () => {
      const pointer = saved<PromotedProjection>("promotions", "FEDERAL_ROLL_CALL:US:recent-federal-rollcalls");
      if (!pointer) return call(production, name, []);
      const lkg = saved<CandidateVersionRecord>("candidates", pointer.lastKnownGoodVersionId);
      if (!lkg) throw Error("RH01 local shared roll-call pointer has no committed candidate");
      return { current: pointer, lkg };
    };
    if (name === "readStatePublicationBase") return async (recordClass: RoutineRecordClass, scope: string) => {
      const pointer = saved<PromotedProjection>("promotions", `${recordClass}:${scope}`);
      if (!pointer) return call(production, name, [recordClass, scope]);
      const lkg = saved<CandidateVersionRecord>("candidates", pointer.lastKnownGoodVersionId);
      if (!lkg) throw Error("RH01 local state pointer has no matching committed candidate");
      const statePublication = await import(pathToFileURL(join(process.env.WTP_RH01_CODE_ROOT ?? process.cwd(), "lib/civic-data/state-publication.ts")).href);
      const prior = statePublication.takeStatePublicationPrior(overlay, recordClass, scope);
      if (prior) {
        if (prior.versionId !== pointer.versionId || prior.payloadHash !== lkg.candidate.normalization.normalizedHash)
          throw Error(`STATE_PUBLICATION_BASE_CHANGED:${pointer.key}`);
        if (JSON.stringify(pointer.receipt) !== JSON.stringify(lkg.receipt)) throw Error(`STATE_PUBLICATION_POINTER_RECEIPT_MISMATCH:${pointer.key}`);
        const candidate = { ...lkg.candidate, readModel: null, normalizedPayload: null, civicRecords: [], identities: [],
          normalization: { ...lkg.candidate.normalization, stateRecordHashes: prior.recordHashes } };
        statePublication.bindStatePublicationPrior(candidate, prior);
        return { current: { ...pointer, payload: null }, lkg: { ...lkg, candidate } };
      }
      return { current: pointer, lkg };
    };
    const operation = Reflect.get(memory, name);
    if (typeof name !== "string" || typeof operation !== "function") {
      const fallback = Reflect.get(production, name);
      return typeof fallback === "function" ? fallback.bind(production) : fallback;
    }
    return (...args: unknown[]) => {
      const run = async () => {
        try {
          if (name === "create") {
            // Memory.create validates and stores the supplied record; it does not read the prior publication.
          } else if (mutations.has(name)) {
            const id = name === "confirmUnchanged" ? (args[0] as ConfirmUnchangedInput).pointerVersionId : String(args[0]);
            await seedCandidate(id);
            hydrate("candidates", id); hydrate("history", id);
            const candidate = mapOf<CandidateVersionRecord>("candidates").get(id)?.candidate;
            if (candidate) {
              await seedPointer(candidate.recordClass, candidate.scope);
            }
          } else if (name === "readRegistryDivisions") {
            const key = `REGISTRY_RUNTIME_BINDING:US-${String(args[0]).toUpperCase()}:reader-registry-runtime`;
            if (!saved("promotions", key)) return call(production, name, args);
            hydrate("promotions", key);
          } else if (name === "listPromotionScopes") {
            const classes = args[0] as RoutineRecordClass[];
            const remote = await call<Promise<{ recordClass: RoutineRecordClass; scope: string }[]>>(production, name, args);
            const combined = new Map(remote.map(row => [`${row.recordClass}:${row.scope}`, row]));
            for (const row of statement("SELECT id,value FROM held WHERE kind='promotion-clocks'").all()) {
              const pointer = JSON.parse(String(row.value)) as PromotedProjection;
              if (classes.includes(pointer.recordClass)) combined.set(String(row.id), { recordClass: pointer.recordClass, scope: pointer.scope });
            }
            return [...combined.values()];
          } else if (name === "readStateRetirementOrigin") {
            const key = `${args[0]}:${args[1]}`, pointer = saved<PromotedProjection>("promotions", key);
            if (!pointer) return call(production, name, args);
            hydrate("promotions", key); hydrate("candidates", pointer.versionId);
          } else if (["readPromotion", "readPromotionIdentity"].includes(name)) {
            const key = `${args[0]}:${args[1]}`, pointer = saved<PromotedProjection>("promotions", key);
            if (!pointer) return await call(production, name, args);
            hydrate("promotions", key); hydrate("history", pointer.versionId);
          } else if (["readCandidate", "readCandidateSummary", "readPublishedCandidateMetadata", "readCandidateProof", "events", "pointerMoveEvents"].includes(name)) {
            const id = String(args[0]);
            if (!saved("candidates", id)) return await call(production, name, args);
            hydrate("candidates", id); hydrate("history", id);
          } else if (["readPromotions", "readPromotionIdentities"].includes(name)) {
            const scopes = args[1] as string[], local = scopes.filter(scope => saved("promotions", `${args[0]}:${scope}`));
            if (!local.length) return await call(production, name, args);
            for (const scope of local) hydrate("promotions", `${args[0]}:${scope}`);
            const remote = scopes.filter(scope => !local.includes(scope));
            return [...await call<Promise<{ scope: string }[]>>(production, name, [args[0], remote]), ...await call<Promise<{ scope: string }[]>>(memory, name, [args[0], local])]
              .sort((left, right) => scopes.indexOf(left.scope) - scopes.indexOf(right.scope));
          } else if (["readCandidates", "readCandidateProofs", "latestReaderReadbacks"].includes(name)) {
            const ids = args[0] as string[], local = ids.filter(id => saved("candidates", id));
            if (!local.length) return await call(production, name, args);
            for (const id of local) { hydrate("candidates", id); hydrate("history", id); }
            const remote = ids.filter(id => !local.includes(id));
            return [...await call<Promise<unknown[]>>(production, name, [remote]), ...await call<Promise<unknown[]>>(memory, name, [local])];
          } else if (["clock", "latestCandidate"].includes(name)) {
            const [sourceId, recordClass, scope] = args as [string, RoutineRecordClass, string];
            if (!hydrateScope(recordClass, scope, sourceId)) return call(production, name, args);
            const pointer = saved<PromotedProjection>("promotion-clocks", `${recordClass}:${scope}`);
            if (pointer) mapOf("promotions").set(`${recordClass}:${scope}`, pointer);
            const local = await call<Promise<Record<string, unknown>>>(memory, name, args);
            if (name !== "clock" || pointer) return local;
            const remote = await call<Promise<Record<string, unknown>>>(production, name, args);
            const attempted = [local.lastAttemptedAt, remote.lastAttemptedAt].filter(value => typeof value === "string").sort();
            return { ...remote, ...(attempted.length ? { lastAttemptedAt: attempted.at(-1) } : {}) };
          } else if (name === "eventObservedAt") {
            const [recordClass, scope] = args as [RoutineRecordClass, string];
            const observed = await call(production, name, args);
            if (!hydrateScope(recordClass, scope)) return observed;
            return call(memory, name, [recordClass, scope, observed]);
          } else return await call(production, name, args);
          return await call(memory, name, args);
        } finally { flush(name); }
      };
      const scoped = async () => {
        if (!mutations.has(name)) return run();
        const candidate = name === "create" ? (args[0] as CandidateVersionRecord).candidate : undefined;
        const id = name === "confirmUnchanged" ? (args[0] as ConfirmUnchangedInput).pointerVersionId : String(args[0]);
        if (!candidate) await seedCandidate(id);
        const identity = candidate ?? saved<CandidateVersionRecord>("candidates", id)?.candidate;
        if (identity && typeof Reflect.get(production, "assertCandidateMutationAuthority") === "function")
          call(production, "assertCandidateMutationAuthority", [identity, name === "appendEvidence" ? "reader-evidence" : "candidate"]);
        return withRoutineLock(identity ? `${identity.recordClass}:${identity.scope}` : id, run);
      };
      const next = serial.then(scoped, scoped);
      serial = next.catch(() => undefined);
      return next;
    };
  } });
  routineOverlays.add(overlay);
  routineIdentities.set(production, overlay);
  return overlay;
}

/** Fact writes are served by the separate temporary PostgreSQL process. */
export function readonlyFactDb(): FactDb & { readonly query: Query } {
  const endpoint = process.env.WTP_RH01_FACTS_URL;
  if (!endpoint) throw Error("RH01 local fact PostgreSQL endpoint is missing");
  const request = async (path: string, body: unknown) => {
    const response = await fetch(endpoint.replace(/\/query$/, path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { rows?: Record<string, unknown>[]; error?: string };
    if (!response.ok) throw Error(result.error ?? `RH01 local fact query HTTP ${response.status}`);
    return result;
  };
  const query: Query = async (text, params = []) => (await request("/query", { text, params })).rows ?? [];
  return { query, transaction: async work => {
    const { token } = await request("/begin", {}) as { token: string };
    try {
      const result = await work(async (text, params = []) => (await request("/query", { text, params, token })).rows ?? []);
      await request("/commit", { token }); return result;
    } catch (error) { await request("/rollback", { token }).catch(() => undefined); throw error; }
  } };
}

/** Actual PG repositories share the coordinator SQL; website pacing keeps its version-specific implementation. */
export function controlOverlay(production: ControlPlaneRepositories): ControlPlaneRepositories {
  const endpoint = process.env.WTP_RH01_FACTS_URL?.replace(/\/query$/, "/pacing");
  if (!endpoint) return production;
  const pacing = new Proxy(production.websitePacing, { get(target, method) {
    if (typeof method !== "string" || typeof Reflect.get(target, method) !== "function") return Reflect.get(target, method);
    return async (...args: unknown[]) => {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, args }) });
      const body = await response.json() as { result?: unknown; map?: readonly (readonly [string, number])[]; error?: string };
      if (!response.ok) throw Error(body.error ?? "RH01 local pacing operation failed");
      return body.map ? new Map(body.map) : body.result;
    };
  } });
  return new Proxy(production, { get(target, name) {
    if (name === "locks") return controlLocks();
    if (name === "websitePacing") return pacing;
    return Reflect.get(target, name);
  } });
}
