import observations from "./reference/census-school-intersections.json" with { type: "json" };
import type { CensusUnitTerritory } from "./membership.ts";
import type { ZipDivisionEntry } from "../../geo/zip-division-index.ts";

/** Complete Census polygon observations supplement the old sample lattice.
 * These are possible ZIP coverage, never an individual address assignment.
 * The same government IDs and positive-area evidence feed preview and dispatch. */
export const CENSUS_SCHOOL_INTERSECTIONS = observations.records;

export function withCensusSchoolTerritories(units: readonly CensusUnitTerritory[]): readonly CensusUnitTerritory[] {
  return units.map(unit => {
    const held = CENSUS_SCHOOL_INTERSECTIONS.filter(row => row.pid6 === unit.pid6);
    if (!held.length) return unit;
    return { ...unit, zips: [...new Set([...unit.zips, ...held.map(row => row.zcta)])].sort() };
  });
}

export function addCensusSchoolShares(shares: Map<string, Map<string, number>>): void {
  for (const row of CENSUS_SCHOOL_INTERSECTIONS) {
    const key = `${row.layer}:${row.geoid}`;
    const entries = shares.get(key) ?? new Map<string, number>();
    entries.set(row.zcta, row.overlapSquareMetres / row.zctaAreaSquareMetres);
    shares.set(key, entries);
  }
}

export function withCensusSchoolDivisions(entry: ZipDivisionEntry, zcta?: string): ZipDivisionEntry {
  const held = CENSUS_SCHOOL_INTERSECTIONS.filter(row => row.zcta === zcta);
  if (!held.length) return entry;
  return { ...entry,
    ids: [...new Set([...entry.ids, ...held.map(row => row.ocdId)])],
    partial: [...new Set([...entry.partial, ...held.filter(row => row.overlapSquareMetres < row.zctaAreaSquareMetres).map(row => row.ocdId)])],
  };
}
