import type { CensusGeographyLookup } from "../../census-geography/contract.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
export { censusWorkDivision } from "../../census-geography/division-id.ts";
import type { ResolvedScope } from "./membership.ts";
import { certainlyOverlaps, type DivisionTerritory } from "./overlap.ts";
import { plannerMap, plannerSet, type PlannerSpool } from "../scheduler/planner-spool.ts";

let nextMembership = 0;

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
export async function declaredWorkMembers(scopes: readonly ResolvedScope[], work: Iterable<ScopedStandingWork>, lookup: Pick<CensusGeographyLookup, "groupingsForZcta">, localDivisions: ReadonlyMap<string, DivisionTerritory> = new Map(), planner?: PlannerSpool): Promise<Map<string, ReadonlySet<string>>> {
  const prefix = `declared-members-${nextMembership++}`;
  const out = new Map<string, ReadonlySet<string>>();
  const wanted = planner ? plannerSet(planner, `${prefix}-wanted`) : new Set<string>();
  for (const row of work) for (const id of row.scopeDivisions ?? []) wanted.add(id);
  if (wanted.size === 0) return out;
  // The published lookup is shared between overlapping Sends. Its memo lives
  // on disk; only this ZCTA's memberships are decoded at a time.
  const cache = planner ? plannerMap<Awaited<ReturnType<CensusGeographyLookup["groupingsForZcta"]>>>(planner, `${prefix}-lookup`) : null;
  for (const scope of scopes) {
    if (scope.kind !== "RESOLVED") continue;
    const overlapping = planner ? plannerSet(planner, `${prefix}-overlap-${scope.decision.key}`) : new Set<string>();
    const observed = planner ? plannerSet(planner, `${prefix}-observed-${scope.decision.key}`) : new Set<string>();
    for (const zcta of scope.zctas) {
      let found = cache?.get(zcta);
      if (!found) { found = await lookup.groupingsForZcta(zcta); cache?.set(zcta, found); }
      if (found.status.kind !== "OK") throw new Error(`Shared-work membership cannot read Census ZCTA ${zcta}: ${found.status.note}`);
      for (const membership of found.memberships) {
        const id = censusWorkDivision(membership.geography);
        if (!id || !wanted.has(id)) continue;
        observed.add(id);
        const shares = membership.whole ? new Map([[zcta, 1]]) : membership.fraction === null ? new Map<string, number>() : new Map([[zcta, membership.fraction]]);
        if (certainlyOverlaps({ zctas: new Set([zcta]), shares }, scope)) overlapping.add(id);
      }
    }
    const inside = (id: string): boolean => {
      if (id === "ocd-division/country:us") return true;
      const state = /^ocd-division\/country:us\/state:([a-z]{2})$/.exec(id)?.[1];
      if (state) return scope.states.includes(state.toUpperCase());
      if (overlapping.has(id)) return true;
      if (observed.has(id)) return false;
      const territory = localDivisions.get(id);
      return territory !== undefined && certainlyOverlaps(territory, scope);
    };
    const members = planner ? plannerSet(planner, `${prefix}-members-${scope.decision.key}`) : new Set<string>();
    for (const row of work) if (row.scopeDivisions?.some(inside)) members.add(row.subjectId);
    out.set(scope.decision.key, members);
  }
  return out;
}
