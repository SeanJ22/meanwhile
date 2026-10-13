import { FEDERAL_MONEY_RECORD_CLASS, FEDERAL_MONEY_SOURCES, federalMoneyScope } from "./model.ts";
import { FEDERAL_MONEY_STATES } from "./sources.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { PromotedFamilyArtifactValue } from "../meetings/edge-artifacts.ts";

/** National markers track acquisition; only state pointers serve reader requests. */
export const FEDERAL_MONEY_EDGE_SCOPES = FEDERAL_MONEY_STATES.flatMap(state =>
  FEDERAL_MONEY_SOURCES.map(source => federalMoneyScope(source, state)));

export function absentFederalMoneyStateEntries(state: string): Extract<PromotedEdgeEntry, { kind: "NOT_RECORDED" }>[] {
  return FEDERAL_MONEY_SOURCES.map(source => ({
    kind: "NOT_RECORDED", recordClass: FEDERAL_MONEY_RECORD_CLASS, scope: federalMoneyScope(source, state),
  }));
}

/** One state's artifact answers each source exactly once, including sources not yet recorded. */
export function isFederalMoneyStateArtifact(value: unknown, state: string): value is PromotedFamilyArtifactValue {
  const artifact = value as Partial<PromotedFamilyArtifactValue> | null;
  if (artifact?.kind !== "PROMOTED_POINTERS" || !Array.isArray(artifact.entries) ||
      artifact.entries.length !== FEDERAL_MONEY_SOURCES.length) return false;
  const expected = new Set(FEDERAL_MONEY_SOURCES.map(source => federalMoneyScope(source, state)));
  for (const entry of artifact.entries) {
    const pointer = entry?.kind === "PROMOTED" ? entry.projection : entry?.kind === "NOT_RECORDED" ? entry : null;
    if (!pointer || pointer.recordClass !== FEDERAL_MONEY_RECORD_CLASS || !expected.delete(pointer.scope)) return false;
    if (entry.kind === "PROMOTED") {
      const payload = entry.projection.payload as { readonly state?: unknown; readonly source?: unknown } | null;
      if (!payload || payload.state !== state.toUpperCase() ||
          federalMoneyScope(payload.source as typeof FEDERAL_MONEY_SOURCES[number], state) !== pointer.scope) return false;
    }
  }
  return expected.size === 0;
}
