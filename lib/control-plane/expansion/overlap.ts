/**
 * The certain-overlap rule alone, so Admin's Send preview can apply it without
 * the runner's modules. `membership.ts` re-exports everything here. Pure.
 */

/** A scope's geometry: its ZCTAs, those wholly inside it, and each partial one's area share inside it. */
export interface ScopeGeometry {
  readonly zctas: ReadonlySet<string>;
  readonly whole: ReadonlySet<string>;
  readonly fractions: ReadonlyMap<string, number>;
}

/** A government's territory: its ZCTAs, with its sampled share (0..1) of each where one is known. */
export interface DivisionTerritory {
  readonly zctas: ReadonlySet<string>;
  readonly shares: ReadonlyMap<string, number>;
}

/**
 * The margin a partial-ZCTA overlap must clear to count as certain: the
 * government's sampled share plus the scope's exact area share must exceed the
 * whole ZCTA by this much. Sampled and exact areas differ by a few percent at
 * a border; 5% keeps neighbours that merely share a border ZCTA out.
 */
export const OVERLAP_CERTAINTY_MARGIN = 0.05;

/**
 * Whether a government CERTAINLY overlaps the scope inside some ZCTA: it
 * touches a ZCTA wholly inside the scope, or inside one shared ZCTA its share
 * and the scope's share sum past the whole by the margin.
 */
export function certainlyOverlaps(territory: DivisionTerritory, scope: ScopeGeometry): boolean {
  for (const z of territory.zctas) {
    if (!scope.zctas.has(z)) continue;
    if (scope.whole.has(z)) return true;
    const mine = territory.shares.get(z);
    const theirs = scope.fractions.get(z);
    if (mine !== undefined && theirs !== undefined && mine + theirs > 1 + OVERLAP_CERTAINTY_MARGIN) return true;
  }
  return false;
}
