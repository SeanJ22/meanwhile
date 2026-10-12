/**
 * The frozen method store as a test fixture (`tests/fixtures/method-knowledge.json`), and the manual entries it
 * folds into. Production code never reads it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fieldManualEntryId, foldEntries, type FieldManualEntry, type FieldManualOutcome, type FieldManualStore } from "../lib/control-plane/field-manual.ts";
import { KNOWLEDGE_SOURCE, METHOD_VERSION_KIND, ROUTE_ENTRY_KIND } from "../lib/method/manual-bridge.ts";
import type { MethodKnowledge } from "../lib/method/knowledge.ts";

export const METHOD_FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "method-knowledge.json");

/** The frozen store, parsed. */
export function methodFixture(): MethodKnowledge {
  return JSON.parse(readFileSync(METHOD_FIXTURE_PATH, "utf8")) as MethodKnowledge;
}

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


/** A manual seeded with the frozen store: every route whole, plus the version entry. */
export function seededFieldManual(store: MethodKnowledge = methodFixture()): FieldManualStore {
  return ({ entries: foldEntries([...knowledgeEntries(store), methodVersionEntry(store)]) });
}
