import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { BuiltScope, GeographySourceFailure } from "./dataset.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "./publication.ts";

/** Only the previously published supplemental scopes, cut inside the read-only store. */
export async function readPriorSupplementalScopes(query: ReadOnlyQuery | null = readerQuery(5000)): Promise<readonly BuiltScope[] | undefined> {
  if (!query) return undefined;
  try {
    const [rows] = await query([{ text: `SELECT COALESCE((SELECT jsonb_agg(s) FROM civic_data_promotions p
      CROSS JOIN LATERAL jsonb_array_elements(p.payload->'scopes') s
      WHERE p.record_class=$1 AND p.scope=$2 AND s->>'type' IN ('overlay_district','aiannh')), '[]'::jsonb) AS scopes`,
      params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE] }]);
    return Array.isArray(rows?.[0]?.scopes) ? rows[0].scopes as unknown as readonly BuiltScope[] : undefined;
  } catch { return undefined; }
}

/** A source failure retains that exact published scope, including its original check date. */
export function retainFailedSupplementalScopes(previous: readonly BuiltScope[], built: readonly BuiltScope[], failures: readonly GeographySourceFailure[]): BuiltScope[] {
  const scopes = new Map(built.map(scope => [`${scope.type}|${scope.version}`, scope]));
  for (const failure of failures) {
    const prior = previous.find(scope => scope.type === failure.type && scope.version === failure.version);
    if (prior && !scopes.has(`${prior.type}|${prior.version}`)) scopes.set(`${prior.type}|${prior.version}`, prior);
  }
  return [...scopes.values()];
}
