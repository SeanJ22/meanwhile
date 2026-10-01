/**
 * **THE METHOD STORE, AS FIELD-MANUAL ENTRIES.**
 *
 * `data/method/knowledge.json` is frozen: a human had to run a `method:learn-*`
 * script to admit anything, and nothing has since (owner directive 2026-09-19).
 * The field manual is the one store agents read and write live. This module is
 * the one mapping between them, used twice:
 *
 * - the seed folds every route of the frozen store into the manual, and
 * - routing asks the manual which routes are learned, so a route an agent
 *   writes as a `ROUTE` entry graduates without a human step.
 *
 * Pure except `readMethodVersion`, which reads the one manual aggregate: no fs, no clock.
 */

import { fieldManualEntryId, type FieldManualEntry, type FieldManualOutcome, type FieldManualStore } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { MethodKnowledge } from "./knowledge.ts";

/** The source label every folded route carries, so a re-fold refreshes one row per route. */
export const KNOWLEDGE_SOURCE = "data/method/knowledge.json";
/** The kind of a manual entry that is a learned route (a fetchable surface or a reasoning discipline). */
export const ROUTE_ENTRY_KIND = "ROUTE";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function bestOutcome(outcomes: readonly { readonly outcome?: unknown }[] | undefined): FieldManualOutcome {
  if (!outcomes || outcomes.length === 0) return "REFERENCE";
  const set = new Set(outcomes.map((o) => String(o.outcome)));
  if (set.has("YIELDED")) return "YIELDED";
  if (set.has("BLOCKED")) return "BLOCKED";
  if (set.has("FAILED")) return "FAILED";
  if (set.has("ZERO")) return "ZERO";
  return "REFERENCE";
}

function latestDate(...values: (string | null | undefined)[]): string | null {
  const dates = values.filter((v): v is string => typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v));
  return dates.length === 0 ? null : dates.sort().at(-1)!;
}

/** Every route of the method store as a manual entry; the route record is kept whole in `payload`. */
export function knowledgeEntries(store: MethodKnowledge): FieldManualEntry[] {
  return store.routes.map((route) => {
    const r = route as unknown as Record<string, unknown>;
    const applicability = (r.applicability ?? {}) as Record<string, unknown>;
    const outcomes = (r.outcomes as { outcome?: unknown; walkedOn?: unknown }[] | undefined) ?? [];
    return {
      id: fieldManualEntryId(KNOWLEDGE_SOURCE, String(r.id)),
      role: "SCOUT",
      kind: ROUTE_ENTRY_KIND,
      title: String(r.title ?? r.id),
      summary: `${String(r.kind ?? "RETRIEVAL")}; ${strings(r.fields).join(", ") || "any field"}; ${String((r as { note?: unknown }).note ?? "")}`.slice(0, 300),
      states: strings(applicability.states),
      recordClasses: strings(r.fields),
      platforms: strings(applicability.platforms),
      outcome: bestOutcome(outcomes),
      url: null,
      source: KNOWLEDGE_SOURCE,
      observedAt: latestDate(store.updatedOn, ...outcomes.map((o) => String(o.walkedOn ?? ""))),
      tier: typeof r.tier === "string" ? r.tier : null,
      payload: route,
    } satisfies FieldManualEntry;
  });
}

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

/** The version the frozen method store ended at, as a manual entry; the seed folds it once and a re-fold refreshes the same row. */
export function methodVersionEntry(store: Pick<MethodKnowledge, "version" | "updatedOn" | "routes">): FieldManualEntry {
  return {
    id: fieldManualEntryId(KNOWLEDGE_SOURCE, "method-version"),
    role: "SCOUT",
    kind: METHOD_VERSION_KIND,
    title: "Method version the frozen store ended at",
    summary: `Method version ${store.version} at ${store.routes.length} routes; every route an agent learns after this raises it by one.`,
    states: [], recordClasses: [], platforms: [],
    outcome: "REFERENCE",
    url: null,
    source: KNOWLEDGE_SOURCE,
    observedAt: store.updatedOn ?? null,
    tier: null,
    payload: { version: store.version, updatedOn: store.updatedOn ?? null, routes: store.routes.length },
  };
}

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
  const read = await repos.fieldManual.read("live").catch(() => null);
  return read ? methodVersionFromManual(read.value) : null;
}
