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
 * Pure: no db, fs, clock.
 */

import { fieldManualEntryId, type FieldManualEntry, type FieldManualOutcome, type FieldManualStore } from "../control-plane/field-manual.ts";
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
