import type { CensusGeographyLookup, GeographyRef } from "../../census-geography/contract.ts";
import { districtIdentity } from "../../ocd/fips.ts";
import { legislativeIdentity } from "../../ocd/divisions.ts";
import type { ResolvedScope } from "./membership.ts";
import { certainlyOverlaps, type DivisionTerritory } from "./overlap.ts";

export interface ScopedStandingWork {
  readonly id: string;
  readonly subjectId: string;
  readonly scopeDivisions?: readonly string[];
}

/** Place shared standing work by the divisions its own provider declares.
 * Candidate and finance IDs are not government registry IDs. A geography-only
 * registry join silently omitted them from both Send priority and its budget.
 * The published Census lookup supplies sub-state overlap; state-wide source
 * records are reused in each applicable scope without duplicating their work.
 */
export function censusWorkDivision(g: GeographyRef): string | null {
  if (g.ocdId) return g.ocdId;
  if (g.type === "congressional_district" && /^\d{4}$/.test(g.geoid)) return districtIdentity(g.geoid.slice(0, 2), g.geoid.slice(2))?.ocdId ?? null;
  if ((g.type === "state_leg_upper" || g.type === "state_leg_lower") && /^\d{5}$/.test(g.geoid)) return legislativeIdentity(g.geoid.slice(0, 2), g.type === "state_leg_upper" ? "sldu" : "sldl", g.geoid.slice(2), g.label)?.ocdId ?? null;
  // Named local divisions require the registry's held identity bridge. Never
  // turn a geographic label (including a CDP) into a government identity.
  return null;
}

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
      const state = /^ocd-division\/country:us\/state:([a-z]{2})$/.exec(id)?.[1];
      if (state) return scope.states.includes(state.toUpperCase());
      const territory: DivisionTerritory | undefined = territories.get(id) ?? localDivisions.get(id);
      return territory !== undefined && certainlyOverlaps(territory, scope);
    };
    out.set(scope.decision.key, new Set(work.filter(row => row.scopeDivisions?.some(inside)).map(row => row.subjectId)));
  }
  return out;
}
