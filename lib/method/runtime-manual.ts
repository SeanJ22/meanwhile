/** Live method reads keep the shared catalog on temporary disk. Workers receive their own floor, never the country's manual. */
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import type { FieldManualRepos } from "../control-plane/field-manual.ts";
import { createPlannerSpool } from "../control-plane/scheduler/planner-spool.ts";
import { DiskRows } from "../control-plane/scheduler/disk-rows.ts";
import { openHistoryIndex, closeHistoryIndex } from "../control-plane/workers/streamed-history.ts";
import { computeAuditRouteFloor, type AuditRouteFloor, type FloorMethodRoute, type RouteFloorInput } from "../control-plane/preflight.ts";
import { KNOWLEDGE_SOURCE, METHOD_VERSION_KIND, ROUTE_ENTRY_KIND } from "./manual-bridge.ts";
import type { MethodRoute } from "./knowledge.ts";

const UNSEEDED = "the field manual holds no method version; it has not been seeded (scripts/field-manual-seed.mts). An empty store would send every route to the bounded worker.";
type CatalogMode = "IDENTITIES" | "FLOOR";
export type MethodFloorRequest = Omit<RouteFloorInput, "knowledge">;
export interface RuntimeMethod {
  readonly version: number;
  floorFor(input: MethodFloorRequest): Promise<AuditRouteFloor>;
  close(): Promise<void>;
}
export interface ProgressionMethodSnapshot {
  readonly version: number;
  readonly routes: { find(predicate: (route: Pick<MethodRoute, "id" | "applicability">) => unknown): Pick<MethodRoute, "id" | "applicability"> | undefined };
}
interface CatalogState { readonly version: number | null; readonly learnedRoutes: number; readonly updatedOn: string | null }

/** Only the route definition determines a floor. Outcomes, sub-branches and claim text are not floor authority. */
async function openCatalog(repos: FieldManualRepos, mode: CatalogMode) {
  const index = await openHistoryIndex(), db = index.db;
  let closed = false;
  const clean = () => { if (closed) return; closed = true; db.close(); rmSync(temporaryPath(index.directory), { recursive: true, force: true }); };
  process.once("exit", clean);
  const close = async () => { if (closed) return; closed = true; process.removeListener("exit", clean); await closeHistoryIndex(index); };
  try {
    db.exec("CREATE TABLE identities(id TEXT PRIMARY KEY,frozen INTEGER NOT NULL); CREATE TABLE routes(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,first_entry TEXT NOT NULL,frozen INTEGER NOT NULL,body TEXT NOT NULL)");
    const identity = db.prepare("INSERT INTO identities VALUES(?,?) ON CONFLICT(id) DO UPDATE SET frozen=MAX(identities.frozen,excluded.frozen)");
    const read = db.prepare("SELECT entry_id,first_entry,frozen FROM routes WHERE id=?"), put = db.prepare("INSERT OR REPLACE INTO routes VALUES(?,?,?,?,?)");
    const fingerprint = createHash("sha256").update(mode);
    let baseId: string | undefined, baseVersion: number | null = null, updatedOn: string | null = null;
    await repos.fieldManual.visitSlice({ kinds: [ROUTE_ENTRY_KIND, METHOD_VERSION_KIND], everywhere: true, ...(mode === "FLOOR" ? { methodRouteShape: true } : {}) }, async row => {
      fingerprint.update(JSON.stringify([row.id, row.revision]));
      const entry = row.value, payload = entry.payload as Record<string, unknown> | null;
      if (entry.kind === METHOD_VERSION_KIND && entry.source === KNOWLEDGE_SOURCE && (baseId === undefined || row.id.localeCompare(baseId) < 0)) {
        baseId = row.id;
        const version = payload?.version;
        baseVersion = typeof version === "number" && Number.isInteger(version) && version >= 0 ? version : null;
        updatedOn = typeof payload?.updatedOn === "string" ? payload.updatedOn : null;
      }
      if (entry.kind !== ROUTE_ENTRY_KIND) return;
      const id = typeof payload?.id === "string" ? payload.id : typeof payload?.routeId === "string" ? payload.routeId : null;
      if (!id) return;
      const frozen = Number(entry.source === KNOWLEDGE_SOURCE);
      identity.run(id, frozen);
      if (mode !== "FLOOR" || typeof payload?.id !== "string" || typeof payload.title !== "string" || !Array.isArray(payload.fields) ||
        !payload.applicability || typeof payload.applicability !== "object") return;
      if (!entry.methodRouteShape) throw new Error("METHOD_ROUTE_SHAPE_NOT_PROJECTED");
      if (!entry.methodRouteShape.outcomesArray) return;
      const prior = read.get(id);
      const replaces = !prior || frozen > Number(prior.frozen) || frozen === Number(prior.frozen) &&
        (frozen ? row.id.localeCompare(prior.entry_id) > 0 : row.id.localeCompare(prior.entry_id) < 0);
      let first = row.id;
      if (prior && frozen === Number(prior.frozen) && prior.first_entry.localeCompare(first) < 0) first = prior.first_entry;
      if (replaces) {
        put.run(id, row.id, first, frozen, JSON.stringify(payload));
      } else if (prior && first !== prior.first_entry) db.prepare("UPDATE routes SET first_entry=? WHERE id=?").run(first, id);
    }, { kind: true, source: true, payload: mode === "IDENTITIES" ? ["id", "routeId", "version", "updatedOn"] :
      ["id", "routeId", "version", "updatedOn", "title", "fields", "applicability", "retiredOn"] });
    const learnedRoutes = Number(db.prepare("SELECT count(*) AS n FROM identities").get()!.n);
    const learned = Number(db.prepare("SELECT count(*) AS n FROM identities WHERE frozen=0").get()!.n);
    const state: CatalogState = { version: baseVersion === null ? null : baseVersion + learned, learnedRoutes, updatedOn };
    const routes = new DiskRows<FloorMethodRoute>(function* () {
      for (const row of db.prepare("SELECT body FROM routes ORDER BY frozen DESC,first_entry,id").iterate()) yield JSON.parse(row.body) as FloorMethodRoute;
    });
    return { fingerprint: fingerprint.digest("hex"), state, close,
      has: (id: string) => db.prepare("SELECT id FROM identities WHERE id=?").get(id) !== undefined,
      floorFor: (input: MethodFloorRequest) => {
        if (mode !== "FLOOR") throw new Error("METHOD_CATALOG_FLOOR_NOT_LOADED");
        if (state.version === null) throw new Error(UNSEEDED);
        return computeAuditRouteFloor({ ...input, knowledge: { version: state.version, routes } });
      },
      routeRefs: (ids: readonly string[]) => ids.flatMap(id => {
        const row = db.prepare("SELECT body FROM routes WHERE id=?").get(id);
        if (!row) return [];
        const route = JSON.parse(row.body) as FloorMethodRoute;
        return [{ id: route.id, applicability: route.applicability }];
      }),
    };
  } catch (error) { await close(); throw error; }
}
type Catalog = Awaited<ReturnType<typeof openCatalog>>;
interface HeldCatalog { readonly catalog: Catalog; references: number }
interface CatalogHost { readonly snapshots: Map<string, HeldCatalog>; readonly tokens: Map<string, HeldCatalog>; readonly owners: Map<string, number>; pending: Promise<unknown> }
const hosts = new WeakMap<FieldManualRepos["fieldManual"], CatalogHost>();
function hostFor(repos: FieldManualRepos): CatalogHost {
  let host = hosts.get(repos.fieldManual);
  if (!host) { host = { snapshots: new Map(), tokens: new Map(), owners: new Map(), pending: Promise.resolve() }; hosts.set(repos.fieldManual, host); }
  return host;
}
interface OpenedCatalog extends CatalogState { readonly token: string }
export type MethodCatalogRequest = { readonly operation: "open"; readonly mode: CatalogMode; readonly ownerPid?: number } |
  { readonly operation: "release-process"; readonly ownerPid: number } |
  { readonly operation: "close"; readonly token: string } |
  { readonly operation: "floor"; readonly token: string; readonly input: MethodFloorRequest } |
  { readonly operation: "routes"; readonly token: string; readonly ids: readonly string[] };

/** Authenticated worker-tools RPC; snapshots are shared by content identity and released by their consumers. */
export async function methodCatalogRequest(repos: FieldManualRepos, request: MethodCatalogRequest): Promise<unknown> {
  const host = hostFor(repos);
  const run = async () => {
    if (request.operation === "release-process") {
      for (const [token, pid] of host.owners) if (pid === request.ownerPid) await releaseCatalogToken(host, token);
      return { closed: true };
    }
    if (request.operation === "open") {
      if (request.mode !== "IDENTITIES" && request.mode !== "FLOOR") throw new Error("METHOD_CATALOG_MODE_INVALID");
      if (request.ownerPid !== undefined && (!Number.isSafeInteger(request.ownerPid) || request.ownerPid <= 0)) throw new Error("METHOD_CATALOG_OWNER_INVALID");
      const fresh = await openCatalog(repos, request.mode), prior = host.snapshots.get(fresh.fingerprint);
      const held = prior ?? { catalog: fresh, references: 0 };
      if (prior) await fresh.close();
      else host.snapshots.set(fresh.fingerprint, held);
      held.references++;
      const ownerPid = request.ownerPid ?? process.pid;
      try { process.kill(ownerPid, 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        if (--held.references === 0) { host.snapshots.delete(held.catalog.fingerprint); await held.catalog.close(); }
        throw new Error("METHOD_CATALOG_OWNER_EXITED");
      }
      const token = randomUUID(); host.tokens.set(token, held); host.owners.set(token, ownerPid);
      return { ...held.catalog.state, token } satisfies OpenedCatalog;
    }
    const held = host.tokens.get(request.token);
    if (!held) throw new Error("METHOD_CATALOG_SNAPSHOT_NOT_HELD");
    if (request.operation === "close") {
      await releaseCatalogToken(host, request.token);
      return { closed: true };
    }
    if (request.operation === "floor") return held.catalog.floorFor(request.input);
    if (request.ids.length > 32) throw new Error("METHOD_CATALOG_ROUTE_PAGE_EXCEEDED");
    return held.catalog.routeRefs(request.ids);
  };
  const result = host.pending.then(run, run); host.pending = result.then(() => undefined, () => undefined);
  return result;
}
async function releaseCatalogToken(host: CatalogHost, token: string): Promise<void> {
  const held = host.tokens.get(token); if (!held) return;
  host.tokens.delete(token); host.owners.delete(token);
  if (--held.references === 0) { host.snapshots.delete(held.catalog.fingerprint); await held.catalog.close(); }
}
/** The existing child-exit path releases snapshots even when a killed child could not send its own close. */
export async function releaseRuntimeMethodProcess(ownerPid: number): Promise<void> {
  if (!process.env.WTP_WORKER_TOOLS_URL) return;
  const response = await fetch(process.env.WTP_WORKER_TOOLS_URL, { method: "POST", headers: {
    "content-type": "application/json", authorization: process.env.WTP_WORKER_TOOLS_TOKEN ?? "" },
    body: JSON.stringify({ kind: "method", body: { operation: "release-process", ownerPid } }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SHARED_METHOD_FAILED:${response.status}`);
}
export async function closeMethodCatalogHost(repos: FieldManualRepos): Promise<void> {
  const host = hosts.get(repos.fieldManual); if (!host) return;
  await host.pending;
  for (const held of host.snapshots.values()) await held.catalog.close();
  host.tokens.clear(); host.owners.clear(); host.snapshots.clear(); hosts.delete(repos.fieldManual);
}
async function requestCatalog<T>(repos: FieldManualRepos, body: MethodCatalogRequest): Promise<T> {
  const url = process.env.WTP_WORKER_TOOLS_URL;
  if (!url) return await methodCatalogRequest(repos, body) as T;
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: process.env.WTP_WORKER_TOOLS_TOKEN ?? "" },
    body: JSON.stringify({ kind: "method", body }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SHARED_METHOD_FAILED:${response.status}`);
  return await response.json() as T;
}
export async function openRuntimeMethod(repos: FieldManualRepos): Promise<RuntimeMethod> {
  const opened = await requestCatalog<OpenedCatalog>(repos, { operation: "open", mode: "FLOOR", ownerPid: process.pid });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await requestCatalog(repos, { operation: "close", token: opened.token }); };
  if (opened.version === null) { await close(); throw new Error(UNSEEDED); }
  return { version: opened.version, close, floorFor: input => requestCatalog<AuditRouteFloor>(repos, { operation: "floor", token: opened.token, input }) };
}
export async function readRuntimeMethodVersion(repos: FieldManualRepos): Promise<number | null> {
  const opened = await requestCatalog<OpenedCatalog>(repos, { operation: "open", mode: "IDENTITIES", ownerPid: process.pid });
  try { return opened.version; } finally { await requestCatalog(repos, { operation: "close", token: opened.token }); }
}
export async function requireRuntimeMethodVersion(repos: FieldManualRepos): Promise<number> {
  const version = await readRuntimeMethodVersion(repos);
  if (version === null) throw new Error(UNSEEDED);
  return version;
}
/** The synchronous dispatcher consults only the disk identity index; it never holds every route in a Set. */
export async function readRuntimeMaturity(repos: FieldManualRepos) {
  let catalog: Catalog;
  try { catalog = await openCatalog(repos, "IDENTITIES"); }
  catch (error) { throw new Error(`the field manual could not be read (${error instanceof Error ? error.message : String(error)}). This is a FAILED read, never an empty manual.`); }
  if (catalog.state.learnedRoutes === 0) { await catalog.close(); throw new Error("the field manual holds no learned routes. An empty manual would send every route to the bounded worker."); }
  return Object.assign((id: string | null): "GRADUATED" | "UNGRADUATED" => id !== null && catalog.has(id) ? "GRADUATED" : "UNGRADUATED", { close: catalog.close });
}
/** Reporting joins only admitted method identities/applicability; neither route histories nor a country array enter the parent. */
export async function readMethodProgressionSnapshot(repos: FieldManualRepos, ids: Iterable<string>) {
  const opened = await requestCatalog<OpenedCatalog>(repos, { operation: "open", mode: "FLOOR", ownerPid: process.pid });
  const planner = await createPlannerSpool();
  try {
    if (opened.version === null) throw new Error(UNSEEDED);
    const table = planner.table<Pick<MethodRoute, "id" | "applicability">>("method-progression", row => row.id);
    let page: string[] = [];
    const flush = async () => { if (!page.length) return; for (const row of await requestCatalog<Pick<MethodRoute, "id" | "applicability">[]>(repos,
      { operation: "routes", token: opened.token, ids: page })) table.add(row); page = []; };
    for (const id of ids) { page.push(id); if (page.length === 32) await flush(); }
    await flush();
    return { version: opened.version, routes: table.rows, close: () => planner.close() };
  } catch (error) { await planner.close(); throw error; }
  finally {
    try { await requestCatalog(repos, { operation: "close", token: opened.token }); }
    catch (error) { await planner.close(); throw error; }
  }
}
