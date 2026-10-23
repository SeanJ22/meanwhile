import type { CensusGeographyLookup } from "../../census-geography/contract.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
;
import type { ResolvedScope } from "./membership.ts";
import { certainlyOverlaps, type DivisionTerritory } from "./overlap.ts";

export interface ScopedStandingWork {
  readonly id: string;
  readonly subjectId: string;
  readonly scopeDivisions?: readonly string[];
}

/** Place shared standing work by the divisions its own provider declares.
 * Candidate and finance IDs are not government registry IDs. The published
 * Census lookup supplies sub-state overlap; state-wide source records are
 * reused in each applicable scope without duplicating their work.
 */
export async function declaredWorkMembers(scopes: readonly ResolvedScope[], work: readonly ScopedStandingWork[], lookup: CensusGeographyLookup, localDivisions: ReadonlyMap<string, DivisionTerritory> = new Map()): Promise<Map<string, ReadonlySet<string>>> {
  const out = new Map<string, ReadonlySet<string>>();
  const wanted = new Set(work.flatMap(w => w.scopeDivisions ?? []));
  if (wanted.size === 0) return out;
  const cache = new Map<string, Awaited<ReturnType<CensusGeographyLookup["groupingsForZcta"]>>>();
  for (const scope of scopes) {
    if (scope.kind !== "RESOLVED") continue;
    const territories = new Map<string, { zctas: Set<string>; shares: Map<string, number> }>();
    for (const zcta of scope.zctas) {
      let found = cache.get(zcta);
      if (!found) { found = await lookup.groupingsForZcta(zcta); cache.set(zcta, found); }
      if (found.status.kind !== "OK") throw new Error(`Shared-work membership cannot read Census ZCTA ${zcta}: ${found.status.note}`);
      for (const membership of found.memberships) {
        const id = censusWorkDivision(membership.geography);
        if (!id || !wanted.has(id)) continue;
        const territory = territories.get(id) ?? { zctas: new Set<string>(), shares: new Map<string, number>() };
        territory.zctas.add(zcta);
        if (membership.whole || membership.fraction !== null) territory.shares.set(zcta, membership.whole ? 1 : membership.fraction!);
        territories.set(id, territory);
      }
    }
    const inside = (id: string): boolean => {
      if (id === "ocd-division/country:us") return true;
      const state = /^ocd-division\/country:us\/state:([a-z]{2})$/.exec(id)?.[1];
      if (state) return scope.states.includes(state.toUpperCase());
      const territory: DivisionTerritory | undefined = territories.get(id) ?? localDivisions.get(id);
      return territory !== undefined && certainlyOverlaps(territory, scope);
    };
    out.set(scope.decision.key, new Set(work.filter(row => row.scopeDivisions?.some(inside)).map(row => row.subjectId)));
  }
  return out;
}
