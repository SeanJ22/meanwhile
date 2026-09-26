import { bodiesAtDivisions, type BodyIndex, type CoverageStatus } from "./coverage.ts";

export interface PreviewScopeCode {
  readonly zcta5: string;
  readonly indexed: boolean;
  readonly divisions: readonly string[];
  readonly partial: readonly string[];
}

export interface PreviewScopeBody {
  readonly id: string;
  readonly name: string;
  readonly coverageStatus: CoverageStatus;
  readonly codes: readonly { readonly zcta5: string; readonly partial: boolean }[];
}

/** The same registry join as the counts, with identity and uncertainty retained.
 * These are indexed bodies, not a claim that undiscovered bodies do not exist. */
export function previewScopeBodies(codes: readonly PreviewScopeCode[], index: BodyIndex): PreviewScopeBody[] {
  const bodies = new Map<string, { id: string; name: string; coverageStatus: CoverageStatus; codes: Map<string, boolean> }>();
  for (const code of codes) {
    if (!code.indexed) continue;
    for (const body of bodiesAtDivisions(code.divisions, index)) {
      const divisions = [body.ocdId, ...body.alsoServesOcdIds].filter((id): id is string => id !== null && code.divisions.includes(id));
      const partial = divisions.every(id => code.partial.includes(id));
      const entry = bodies.get(body.id) ?? { id: body.id, name: body.name, coverageStatus: body.coverageStatus, codes: new Map<string, boolean>() };
      entry.codes.set(code.zcta5, (entry.codes.get(code.zcta5) ?? true) && partial);
      bodies.set(body.id, entry);
    }
  }
  return [...bodies.values()].map(body => ({ ...body, codes: [...body.codes].map(([zcta5, partial]) => ({ zcta5, partial })).sort((a, b) => a.zcta5.localeCompare(b.zcta5)) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
