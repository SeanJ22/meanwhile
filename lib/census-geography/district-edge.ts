import { createHash } from "node:crypto";
import type { BuiltDataset } from "./dataset.ts";
import type { GeographyType } from "./contract.ts";
import type { CodeSlice, ContainerSlice, ScopeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";

const TYPES: readonly GeographyType[] = ["congressional_district", "state_leg_upper", "state_leg_lower"];
export const censusDistrictEdgeVersion = (sourceVersion: string): string => `census-districts/v2:${sourceVersion}`;

export interface CensusDistrictEdge {
  readonly formatVersion: 1;
  readonly versionId: string;
  readonly scopes: readonly ScopeSlice[];
  readonly containers: readonly Omit<ContainerSlice, "overlaps">[];
  readonly codes: Readonly<Record<string, readonly (readonly [number, boolean, number | null])[]>>;
}

export function buildCensusDistrictEdge(dataset: BuiltDataset, sourceVersion: string): CensusDistrictEdge {
  const containers: Omit<ContainerSlice, "overlaps">[] = [];
  const codes: Record<string, [number, boolean, number | null][]> = {};
  for (const zip of dataset.zctaUniverse) codes[zip] = [];
  const scopes = dataset.scopes.filter(scope => TYPES.includes(scope.type));
  for (const scope of scopes) {
    for (const group of scope.groupings) {
      const { overlaps, ...identity } = group;
      const index = containers.length;
      containers.push({ ref: { ...identity, type: scope.type, version: scope.version }, plan: scope.versionMeta.plan });
      for (const overlap of overlaps) (codes[overlap.zcta5] ??= []).push([index, overlap.whole, overlap.fraction]);
    }
  }
  return { formatVersion: 1, versionId: censusDistrictEdgeVersion(sourceVersion),
    scopes: scopes.map(scope => ({ type: scope.type, version: scope.version, plan: scope.versionMeta.plan,
      applicability: scope.versionMeta.applicability, retrievalComplete: scope.versionMeta.retrievalComplete,
      ...(scope.versionMeta.states ? { states: scope.versionMeta.states } : {}),
      sourceUrls: scope.versionMeta.provenance.sourceUrls, observedAt: scope.versionMeta.provenance.computedAt })), containers, codes };
}

/** A failed or malformed serving copy never establishes new certainty. */
/** One edge per state: its ZIPs and only the containers they touch, its version naming its own content. */
export function censusDistrictEdgeByState(edge: CensusDistrictEdge, stateOf: (zip: string) => string): Map<string, CensusDistrictEdge> {
  const byState = new Map<string, string[]>();
  for (const zip of Object.keys(edge.codes)) {
    const state = stateOf(zip), zips = byState.get(state);
    if (zips) zips.push(zip); else byState.set(state, [zip]);
  }
  return new Map([...byState].map(([state, zips]) => {
    const at = new Map<number, number>(), containers: CensusDistrictEdge["containers"][number][] = [];
    const codes = Object.fromEntries(zips.map(zip => [zip, edge.codes[zip]!.map(([index, whole, fraction]) => {
      if (!at.has(index)) { at.set(index, containers.length); containers.push(edge.containers[index]!); }
      return [at.get(index)!, whole, fraction] as const;
    })]));
    const body = { formatVersion: 1 as const, scopes: edge.scopes, containers, codes };
    return [state, { ...body, versionId: censusDistrictEdgeVersion(createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)) }];
  }));
}

export function censusDistrictEdgeSlice(value: CensusDistrictEdge, versionId: string, zip: string): Slice<CodeSlice> {
  if (value?.formatVersion !== 1 || value.versionId !== versionId || !Array.isArray(value.scopes) || !Array.isArray(value.containers) || !value.codes) {
    return { kind: "UNREAD", detail: "Census district edge version or shape is invalid" };
  }
  const rows = Object.hasOwn(value.codes, zip) ? value.codes[zip] : undefined;
  if (rows !== undefined && (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== 3 || !Number.isInteger(row[0]) ||
    !value.containers[row[0]]?.ref || typeof row[1] !== "boolean" || (row[2] !== null && (typeof row[2] !== "number" || !Number.isFinite(row[2]) || row[2] < 0 || row[2] > 1))))) {
    return { kind: "UNREAD", detail: "Census district edge membership is invalid" };
  }
  return { kind: "HELD", versionId, value: { known: rows !== undefined, scopes: value.scopes,
    containers: (rows ?? []).map(([index, whole, fraction]) => ({ ...value.containers[index], overlaps: [{ zcta5: zip, whole, fraction }] })) } };
}
