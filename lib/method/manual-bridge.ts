/**
 * The one mapping between the frozen method store and the live field manual: the seed folds every frozen route into the
 * manual, and routing asks the manual which routes are learned. Pure except `readMethodVersion`.
 */

import { sharedManualRequest, type FieldManualEntry, type FieldManualStore } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories, Persisted } from "../control-plane/repository/types.ts";
import type { MethodKnowledge, MethodRoute } from "./knowledge.ts";

/** The source label the frozen store's routes carry in the manual. It is an identity, not a path: entry ids derive from it, so it never changes. */
export const KNOWLEDGE_SOURCE = "data/method/knowledge.json";
/** The kind of a manual entry that is a learned route (a fetchable surface or a reasoning discipline). */
export const ROUTE_ENTRY_KIND = "ROUTE";

/**
 * Every route id the manual holds as a learned route: the ids folded from the
 * method store plus any an agent has written since as a `ROUTE` entry. The
 * dispatcher reads this to decide GRADUATED, so an agent's write-back changes
 * the next dispatch with no human step between.
 */
export function learnedRouteIds(store: FieldManualStore): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of store.entries) {
    if (entry.kind !== ROUTE_ENTRY_KIND) continue;
    const payload = entry.payload as { id?: unknown; routeId?: unknown } | null | undefined;
    const id = typeof payload?.id === "string" ? payload.id : typeof payload?.routeId === "string" ? payload.routeId : null;
    if (id) ids.add(id);
  }
  return ids;
}

/** The kind of the one manual entry that carries the method version the frozen store ended at. */
export const METHOD_VERSION_KIND = "METHOD_VERSION";

/**
 * The method version, from the manual alone: the version the frozen store ended
 * at, plus one for every route an agent has learned since (a `ROUTE` entry whose
 * id the frozen store did not hold). The manual only grows, so the number only
 * rises, and a conclusion earned under a lower number reopens when a new route
 * arrives, with no counter for two writers to race on and no human step.
 * Null when the manual has not been seeded with the base yet.
 */
export function methodVersionFromManual(store: { entries: readonly Pick<FieldManualEntry, "kind" | "source" | "payload">[] }): number | null {
  const base = store.entries.find((entry) => entry.kind === METHOD_VERSION_KIND && entry.source === KNOWLEDGE_SOURCE);
  const version = (base?.payload as { version?: unknown } | null | undefined)?.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
  const frozen = new Set<string>();
  const learned = new Set<string>();
  for (const entry of store.entries) {
    if (entry.kind !== ROUTE_ENTRY_KIND) continue;
    const payload = entry.payload as { id?: unknown; routeId?: unknown } | null | undefined;
    const id = typeof payload?.id === "string" ? payload.id : typeof payload?.routeId === "string" ? payload.routeId : null;
    if (!id) continue;
    (entry.source === KNOWLEDGE_SOURCE ? frozen : learned).add(id);
  }
  return version + [...learned].filter((id) => !frozen.has(id)).length;
}

/** The current method version, read from the live manual. Null when the manual is unreadable or not seeded: the caller says so rather than guessing. */
export async function readMethodVersion(repos: Pick<ControlPlaneRepositories, "fieldManual">): Promise<number | null> {
  if (process.env.WTP_WORKER_TOOLS_URL) {
    try { return (await readMethodKnowledge(repos)).version; } catch { return null; }
  }
  try {
    const rows = (await Promise.all([ROUTE_ENTRY_KIND, METHOD_VERSION_KIND].map(kind =>
      repos.fieldManual.listWhereNarrowed(["kind"], kind, { kind: true, source: true, payload: ["id", "routeId", "version"] })))).flat();
    return methodVersionFromManual({ entries: rows.map(row => row.value as Pick<FieldManualEntry, "kind" | "source" | "payload">) });
  } catch { return null; }
}

/** Shared route rows, refreshed by revision; page captures never enter this cache. */
const methodRows = new WeakMap<ControlPlaneRepositories["fieldManual"], Map<string, Persisted<FieldManualEntry>>>();

/** A manual `ROUTE` payload that is a whole route record, not just a pointer an agent wrote. */
function isRouteRecord(payload: unknown): payload is MethodRoute {
  const r = payload as Record<string, unknown> | null | undefined;
  return !!r && typeof r === "object" && typeof r.id === "string" && typeof r.title === "string" &&
    Array.isArray(r.fields) && Array.isArray(r.outcomes) && !!r.applicability && typeof r.applicability === "object";
}

/**
 * The method knowledge the floor and the proposal check read, built from the
 * manual alone: every route record the manual holds (the frozen store's routes,
 * kept whole in `payload`, plus any whole route record an agent wrote), at the
 * manual's method version. Null when the manual has not been seeded.
 */
export function methodKnowledgeFromManual(store: FieldManualStore): MethodKnowledge | null {
  const version = methodVersionFromManual(store);
  if (version === null) return null;
  const routes = new Map<string, MethodRoute>();
  for (const entry of store.entries) {
    if (entry.kind === ROUTE_ENTRY_KIND && entry.source === KNOWLEDGE_SOURCE && isRouteRecord(entry.payload)) routes.set(entry.payload.id, entry.payload);
  }
  for (const entry of store.entries) {
    if (entry.kind === ROUTE_ENTRY_KIND && entry.source !== KNOWLEDGE_SOURCE && isRouteRecord(entry.payload) && !routes.has(entry.payload.id)) routes.set(entry.payload.id, entry.payload);
  }
  const base = store.entries.find((entry) => entry.kind === METHOD_VERSION_KIND && entry.source === KNOWLEDGE_SOURCE);
  return { version, updatedOn: (base?.payload as { updatedOn?: string | null } | undefined)?.updatedOn ?? null, routes: [...routes.values()] };
}

async function readMethodEntries(repos: Pick<ControlPlaneRepositories, "fieldManual">): Promise<readonly FieldManualEntry[]> {
  const versions = (await Promise.all([ROUTE_ENTRY_KIND, METHOD_VERSION_KIND].map(kind =>
    repos.fieldManual.listWhereNarrowed(["kind"], kind, {})))).flat().sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const held = methodRows.get(repos.fieldManual) ?? new Map<string, Persisted<FieldManualEntry>>();
  const changed = versions.filter(row => held.get(row.id)?.revision !== row.revision);
  const loaded = new Map((changed.length ? await repos.fieldManual.readMany(changed.map(row => row.id)) : []).map(row => [row.id, row]));
  const current = new Map(versions.flatMap(row => {
    const value = loaded.get(row.id) ?? held.get(row.id);
    return value ? [[row.id, value] as const] : [];
  }));
  methodRows.set(repos.fieldManual, current);
  return [...current.values()].map(row => row.value);
}

/** The shared-tools host reads its own repository, never its own HTTP endpoint. */
export async function readMethodKnowledgeRows(repos: Pick<ControlPlaneRepositories, "fieldManual">): Promise<{ knowledge: MethodKnowledge } | { error: string }> {
  try {
    const knowledge = methodKnowledgeFromManual({ entries: await readMethodEntries(repos) });
    if (!knowledge) throw new Error("the field manual holds no method version; it has not been seeded (scripts/field-manual-seed.mts). An empty store would send every route to the bounded worker.");
    return { knowledge: structuredClone(knowledge) };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

/** The method knowledge from the live manual. An unreadable or unseeded manual THROWS: an empty store would read as "we know nothing" and send every route to the bounded worker. */
export async function readMethodKnowledge(repos: Pick<ControlPlaneRepositories, "fieldManual">): Promise<MethodKnowledge> {
  const read = await sharedManualRequest("methodKnowledge", null, () => readMethodKnowledgeRows(repos));
  if ("error" in read) throw new Error(read.error);
  return read.knowledge;
}
