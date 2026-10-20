/**
 * The one mapping between the frozen method store and the live field manual: the seed folds every frozen route into the
 * manual, and routing asks the manual which routes are learned. Pure except `readMethodVersion`.
 */

import { readFieldManual, type FieldManualQuery, type FieldManualStore } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
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
export function methodVersionFromManual(store: FieldManualStore): number | null {
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
  try { const { readRuntimeMethodVersion } = await import("./runtime-manual.ts"); return await readRuntimeMethodVersion(repos); }
  catch { return null; }
}

/** Complete method rows for explicit authoring/claim analysis; live workers use runtime-manual projections. */
const METHOD_ROWS: FieldManualQuery = { kinds: [ROUTE_ENTRY_KIND, METHOD_VERSION_KIND], everywhere: true };

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

/** Complete method knowledge for explicit whole-store analysis. Runners use the shared runtime catalog instead. An unreadable or unseeded manual throws. */
export async function readMethodKnowledge(repos: Pick<ControlPlaneRepositories, "fieldManual">): Promise<MethodKnowledge> {
  const read = await readFieldManual(repos, METHOD_ROWS);
  if (read.error) throw new Error(read.error);
  const knowledge = methodKnowledgeFromManual(read.store);
  if (!knowledge) throw new Error("the field manual holds no method version; it has not been seeded (scripts/field-manual-seed.mts). An empty store would send every route to the bounded worker.");
  return knowledge;
}
