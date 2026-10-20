import { plannerMap, plannerSet, type PlannerSpool } from "../scheduler/planner-spool.ts";
import type { CensusUnitTerritory, Territory, TerritoryIndex } from "./membership.ts";

function mapped<V, W>(source: ReadonlyMap<string, V>, decode: (value: V) => W): ReadonlyMap<string, W> {
  const view = {
    get size() { return source.size; }, has: (key: string) => source.has(key),
    get(key: string) { const value = source.get(key); return value === undefined ? undefined : decode(value); },
    *entries(): IterableIterator<[string, W]> { for (const [key, value] of source) yield [key, decode(value)]; },
    *keys(): IterableIterator<string> { yield* source.keys(); }, *values(): IterableIterator<W> { for (const value of source.values()) yield decode(value); },
    [Symbol.iterator](): IterableIterator<[string, W]> { return view.entries(); },
    forEach(visit: (value: W, key: string, map: ReadonlyMap<string, W>) => void, receiver?: unknown) { for (const [key, value] of source) visit.call(receiver, decode(value), key, view as unknown as ReadonlyMap<string, W>); },
  };
  return view as unknown as ReadonlyMap<string, W>;
}
type StoredTerritory = Omit<Territory, "zctas" | "shares"> & { zctas: string[]; shares: [string, number][] };
type StoredDivision = { zctas: string[]; shares: [string, number][] };

/** Join one state's source facts at a time; the combined round index holds only exact disk lookups. */
export function spooledTerritoryIndex(planner: PlannerSpool, states: Iterable<string>, read: (state: string) => TerritoryIndex): TerritoryIndex {
  const bySubject = plannerMap<StoredTerritory>(planner, "territory-subjects"), byDivision = plannerMap<StoredDivision>(planner, "territory-divisions"),
    unplaced = plannerMap<string>(planner, "territory-unplaced"), statewide = plannerSet(planner, "territory-statewide"),
    unregistered = plannerMap<readonly CensusUnitTerritory[]>(planner, "territory-unregistered"), unjoined = plannerMap<readonly CensusUnitTerritory[]>(planner, "territory-unjoined"),
    shares = plannerMap<readonly [string, number][]>(planner, "territory-unit-shares");
  const store = (unit: CensusUnitTerritory, index: TerritoryIndex) => {
    const held = index.unitShares?.(unit); if (held) shares.set(`${unit.state.toUpperCase()}:${unit.pid6}`, [...held]);
  };
  for (const state of states) {
    const index = read(state);
    for (const [id, value] of index.bySubject) bySubject.set(id, { ...value, zctas: [...value.zctas], shares: [...value.shares] });
    for (const [id, value] of index.byDivision ?? []) byDivision.set(id, { zctas: [...value.zctas], shares: [...value.shares] });
    for (const [id, why] of index.unplaced) unplaced.set(id, why);
    for (const id of index.statewide) statewide.add(id);
    for (const [key, units] of index.unregisteredUnitsByState) { unregistered.set(key, units); for (const unit of units) store(unit, index); }
    for (const [key, units] of index.unjoinedUnitsByState ?? []) { unjoined.set(key, units); for (const unit of units) store(unit, index); }
  }
  return { bySubject: mapped(bySubject, value => ({ ...value, zctas: new Set(value.zctas), shares: new Map(value.shares) })),
    byDivision: mapped(byDivision, value => ({ zctas: new Set(value.zctas), shares: new Map(value.shares) })),
    unplaced, statewide, unregisteredUnitsByState: unregistered, unjoinedUnitsByState: unjoined,
    unitShares: unit => { const value = shares.get(`${unit.state.toUpperCase()}:${unit.pid6}`); return value ? new Map(value) : undefined; } };
}
