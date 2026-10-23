import type { FreshnessObligation } from "../scheduler/obligation.ts";
import type { PreviewCode } from "../expansion/send-preview.ts";
import { stateOfSubject } from "../expansion/subjects.ts";

export type ScopeWorkObligation = Pick<FreshnessObligation, "id" | "subjectId" | "recordClass" | "routeId" | "lastWorkedAt" | "active" | "scopeDivisions">;

export interface ScopeWorkRow {
  readonly id: string;
  readonly subjectId: string;
  readonly recordClass: string;
  readonly routeId: string | null;
  readonly lastWorkedAt: string | null;
  readonly applicability: "DECLARED_SHARED" | "EXACT_BODY" | "PARTIAL_UNRESOLVED";
  readonly divisions: readonly string[];
}

export interface ScopeWorkPreview {
  readonly readAt: string;
  readonly rows: readonly ScopeWorkRow[];
  readonly unplaced: number;
  readonly totalActiveInStates: number;
}

/** Absence here never excludes an obligation from the full scope. */
export function scopeWorkPreview(input: {
  readonly codes: readonly PreviewCode[];
  readonly states: readonly string[];
  readonly bodyIds: readonly string[];
  readonly obligations: readonly ScopeWorkObligation[];
  readonly readAt: string;
}): ScopeWorkPreview {
  const states = new Set(input.states.map(state => state.toLowerCase()));
  const bodies = new Set(input.bodyIds);
  const rows: ScopeWorkRow[] = [];
  let unplaced = 0;
  let totalActiveInStates = 0;
  for (const obligation of new Map(input.obligations.map(row => [row.id, row])).values()) {
    if (!obligation.active) continue;
    const declared = obligation.scopeDivisions ?? [];
    const state = stateOfSubject(obligation.subjectId);
    if (state !== null && !states.has(state.toLowerCase()) && !declared.includes("ocd-division/country:us")) continue;
    totalActiveInStates++;
    const matching = declared.filter(id => id === "ocd-division/country:us" ||
      [...states].some(st => id === `ocd-division/country:us/state:${st}`) ||
      input.codes.some(code => code.divisions.includes(id)));
    const certain = matching.some(id => id === "ocd-division/country:us" ||
      [...states].some(st => id === `ocd-division/country:us/state:${st}`) ||
      input.codes.some(code => code.divisions.includes(id) && (code.whole || !code.partial.includes(id))));
    const exactBody = bodies.has(obligation.subjectId);
    if (!matching.length && !exactBody) {
      if (!declared.length) unplaced++;
      continue;
    }
    rows.push({ id: obligation.id, subjectId: obligation.subjectId, recordClass: obligation.recordClass,
      routeId: obligation.routeId, lastWorkedAt: obligation.lastWorkedAt,
      applicability: certain ? "DECLARED_SHARED" : exactBody ? "EXACT_BODY" : "PARTIAL_UNRESOLVED",
      divisions: matching });
  }
  rows.sort((a,b) => a.recordClass.localeCompare(b.recordClass) || a.subjectId.localeCompare(b.subjectId) || a.id.localeCompare(b.id));
  return { readAt: input.readAt, rows, unplaced, totalActiveInStates };
}
