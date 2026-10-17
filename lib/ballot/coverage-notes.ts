import type { BallotSet } from "./types.ts";

export function coverageNotesForScope(set: Pick<BallotSet, "coverageNotes" | "scopedCoverageNotes">, zip: string | null, divisions: readonly string[]): string[] {
  const ids = new Set(divisions);
  return [...new Set([...(set.coverageNotes ?? []), ...(set.scopedCoverageNotes ?? []).filter(note =>
    note.scope.kind === "ZIPS" ? zip !== null && note.scope.ids.includes(zip) : note.scope.ids.some(id => ids.has(id)),
  ).map(note => note.text)])];
}
