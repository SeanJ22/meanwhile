import { createHash } from "node:crypto";
import type { BallotSet, ScopedBallotCoverageNote } from "./types.ts";

/** Keyed by exact content hash, so a changed note never inherits a retained note's scope. */
const LEGACY_PIMA_SCOPES: Readonly<Record<string, ScopedBallotCoverageNote["scope"]>> = {
  dc2d9402ab30720f3e5c26c4dfe3ea00ff51fa4774d73500b7be87da6a0adf00: { kind: "ZIPS", ids: ["85641"] },
  bf4c0c3025abb742da0e56c191100e1df7c32ed8f9eb379582f667d12c2750e8: { kind: "ZIPS", ids: ["85641"] },
  fb89ccf5500826896d56cef53b8296e2260e3a9f25f95046386470063a2bd8eb: { kind: "DIVISIONS", ids: ["ocd-division/country:us/state:az/county:pima"] },
};

export function curatedCoverageNotes(source: string, raw: { coverageNotes?: unknown; scopedCoverageNotes?: unknown }): Pick<BallotSet, "coverageNotes" | "scopedCoverageNotes"> {
  const global: string[] = [];
  const scoped: ScopedBallotCoverageNote[] = [];
  const invalid = "Some source coverage notes could not be verified and are withheld. Independently verified ballot information remains available.";
  if (raw.coverageNotes !== undefined && !Array.isArray(raw.coverageNotes)) global.push(invalid);
  for (const text of Array.isArray(raw.coverageNotes) ? raw.coverageNotes : []) {
    if (typeof text !== "string") { global.push(invalid); continue; }
    const scope = source === "ballot-az-pima" ? LEGACY_PIMA_SCOPES[createHash("sha256").update(text).digest("hex")] : undefined;
    if (scope) scoped.push({ text, scope });
    else if (source === "ballot-az-pima") {
      global.push("Some source coverage notes do not yet have a verified geographic scope. They do not establish that information is absent from this area's ballot.");
    } else global.push(text);
  }
  if (raw.scopedCoverageNotes !== undefined) {
    if (!Array.isArray(raw.scopedCoverageNotes)) global.push(invalid);
    for (const note of Array.isArray(raw.scopedCoverageNotes) ? raw.scopedCoverageNotes : []) {
      if (!note || typeof note.text !== "string" || !note.text.trim() || !note.scope || !["DIVISIONS", "ZIPS"].includes(note.scope.kind)
        || !Array.isArray(note.scope.ids) || !note.scope.ids.length || note.scope.ids.some((id: unknown) => typeof id !== "string"
          || !(note.scope.kind === "ZIPS" ? /^\d{5}$/ : /^ocd-division\/country:[a-z]{2}(?:\/[^\s]+)*$/).test(id))) { global.push(invalid); continue; }
      scoped.push(note);
    }
  }
  return { coverageNotes: [...new Set(global)], scopedCoverageNotes: scoped };
}

export function coverageNotesForScope(set: Pick<BallotSet, "coverageNotes" | "scopedCoverageNotes">, zip: string | null, divisions: readonly string[]): string[] {
  const ids = new Set(divisions);
  return [...new Set([...(set.coverageNotes ?? []), ...(set.scopedCoverageNotes ?? []).filter(note =>
    note.scope.kind === "ZIPS" ? zip !== null && note.scope.ids.includes(zip) : note.scope.ids.some(id => ids.has(id)),
  ).map(note => note.text)])];
}
