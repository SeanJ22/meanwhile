import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import type { GeographyType } from "./contract.ts";
import type { CodeSlice, ContainerSlice, GeographySlice, ScopeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { ReaderArtifactReadStore } from "../meetings/edge-store.ts";

export const REPRESENTATION_GEOGRAPHY_TYPES: readonly GeographyType[] = ["congressional_district", "state_leg_upper", "state_leg_lower", "overlay_district", "aiannh"];
export const censusDistrictEdgeVersion = (sourceVersion: string): string => `census-districts/v5:${sourceVersion}`;

export interface CensusDistrictArtifactRef {
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface CensusDistrictEdge {
  readonly formatVersion: 2;
  readonly versionId: string;
  readonly builtAt: string;
  readonly coverage: string;
  readonly scopes: readonly Omit<BuiltScope, "groupings">[];
  readonly zctaCount: number;
  readonly sourceFailureCount: number;
  readonly sourceDiscrepancyCount: number;
  readonly states: Readonly<Record<string, CensusDistrictArtifactRef>>;
  readonly zipPrefixes: Readonly<Record<string, CensusDistrictArtifactRef>>;
}

export interface CensusDistrictStateArtifact {
  readonly formatVersion: 2;
  readonly versionId: string;
  readonly state: string;
  readonly builtAt: string;
  readonly coverage: string;
  readonly sourceFailures?: BuiltDataset["sourceFailures"];
  readonly sourceDiscrepancies?: BuiltDataset["sourceDiscrepancies"];
  readonly scopeDetails: readonly Omit<BuiltScope, "groupings">[];
  readonly zctaUniverse: readonly string[];
  readonly scopes: readonly ScopeSlice[];
  readonly containers: readonly Omit<ContainerSlice, "overlaps">[];
  readonly codes: Readonly<Record<string, readonly (readonly [number, boolean, number | null])[]>>;
}

export interface CensusZipPrefixArtifact {
  readonly formatVersion: 2;
  readonly versionId: string;
  readonly prefix: string;
  readonly statesByZip: Readonly<Record<string, readonly string[]>>;
}

export interface CensusDistrictReaderEdge {
  readonly versionId: string;
  readonly loadState: (state: string) => Promise<Slice<GeographySlice>>;
  readonly loadZip: (zip: string) => Promise<Slice<CodeSlice>>;
}

export interface CensusDistrictStateInput {
  readonly state: string;
  readonly dataset: BuiltDataset;
}

export function censusStateDataset(value: CensusDistrictStateArtifact): BuiltDataset {
  const overlaps = value.containers.map(() => [] as { zcta5: string; whole: boolean; fraction: number | null }[]);
  for (const [zip, rows] of Object.entries(value.codes)) for (const [index, whole, fraction] of rows) {
    if (!overlaps[index]) throw new Error("Census state district membership is invalid");
    overlaps[index].push({ zcta5: zip, whole, fraction });
  }
  for (const rows of overlaps) rows.sort((a, b) => a.zcta5.localeCompare(b.zcta5));
  return { formatVersion: 1, builtAt: value.builtAt, coverage: value.coverage,
    ...(value.sourceFailures ? { sourceFailures: value.sourceFailures } : {}),
    ...(value.sourceDiscrepancies ? { sourceDiscrepancies: value.sourceDiscrepancies } : {}),
    zctaUniverse: value.zctaUniverse,
    scopes: value.scopeDetails.map(scope => ({ ...scope, groupings: value.containers.flatMap((container, index) => {
      if (container.ref.type !== scope.type || container.ref.version !== scope.version) return [];
      const { type: _type, version: _version, ...group } = container.ref;
      return [{ ...group, overlaps: overlaps[index] }];
    }) })),
  };
}

function unread(detail: string): Slice<never> { return { kind: "UNREAD", detail }; }

export function censusDistrictEdgeSlice(value: CensusDistrictStateArtifact, versionId: string, zip: string): Slice<CodeSlice> {
  if (value?.formatVersion !== 2 || value.versionId !== versionId || !Array.isArray(value.scopes) || !Array.isArray(value.containers) || !value.codes) {
    return unread("Census state district artifact version or shape is invalid");
  }
  const rows = Object.hasOwn(value.codes, zip) ? value.codes[zip] : undefined;
  if (rows !== undefined && (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== 3 || !Number.isInteger(row[0]) ||
    !value.containers[row[0]]?.ref || typeof row[1] !== "boolean" || (row[2] !== null && (typeof row[2] !== "number" || !Number.isFinite(row[2]) || row[2] < 0 || row[2] > 1))))) {
    return unread("Census state district membership is invalid");
  }
  return { kind: "HELD", versionId, value: { known: rows !== undefined, scopes: value.scopes,
    containers: (rows ?? []).map(([index, whole, fraction]) => ({ ...value.containers[index], overlaps: [{ zcta5: zip, whole, fraction }] })) } };
}

async function readArtifact<T>(ref: CensusDistrictArtifactRef | undefined, store: ReaderArtifactReadStore): Promise<T | null> {
  if (!ref || typeof ref.key !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) return null;
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes || bytes.byteLength !== ref.bytes || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) return null;
    return JSON.parse(gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8")) as T;
  } catch { return null; }
}

export async function readCensusDistrictState(index: CensusDistrictEdge, state: string, store: ReaderArtifactReadStore): Promise<CensusDistrictStateArtifact | null> {
  const value = await readArtifact<CensusDistrictStateArtifact>(index.states[state], store);
  if (!value || value.formatVersion !== 2 || value.versionId !== index.versionId || value.state !== state || !Array.isArray(value.scopes) ||
    !Array.isArray(value.containers) || !value.codes || !Array.isArray(value.scopeDetails) || !Array.isArray(value.zctaUniverse) ||
    value.containers.some(row => !row.ref || row.ref.stateAbbr !== state && (!Array.isArray(row.ref.memberStates) || !row.ref.memberStates.includes(state)) || row.ref.geometry)) return null;
  return value;
}

export function createCensusDistrictReaderEdge(index: CensusDistrictEdge, store: ReaderArtifactReadStore, versionId = index.versionId): CensusDistrictReaderEdge {
  const artifactVersion = index.versionId;
  const stateReads = new Map<string, Promise<CensusDistrictStateArtifact | null>>();
  const prefixReads = new Map<string, Promise<CensusZipPrefixArtifact | null>>();
  const valid = index.formatVersion === 2 && typeof versionId === "string" && index.states && Object.keys(index.states).length === 1 && index.zipPrefixes;
  function stateRead(state: string): Promise<CensusDistrictStateArtifact | null> {
    let read = stateReads.get(state);
    if (!read) {
      read = readCensusDistrictState(index, state, store);
      stateReads.set(state, read);
    }
    return read;
  }
  async function loadState(input: string): Promise<Slice<GeographySlice>> {
    const state = input.toUpperCase();
    if (!valid || !/^[A-Z]{2}$/.test(state)) return unread("Census district index is invalid");
    if (!Object.hasOwn(index.states, state)) return { kind: "NOT_PUBLISHED" };
    const value = await stateRead(state);
    return value ? { kind: "HELD", versionId, value: { scopes: value.scopes, containers: value.containers.map(row => ({ ...row, overlaps: null })) } }
      : unread("Census state district artifact is unavailable");
  }
  async function loadZip(zip: string): Promise<Slice<CodeSlice>> {
    if (!valid || !/^\d{5}$/.test(zip)) return unread("Census district index or ZIP is invalid");
    const prefix = zip.slice(0, 3);
    if (!Object.hasOwn(index.zipPrefixes, prefix)) return { kind: "HELD", versionId, value: { known: false, scopes: [], containers: [] } };
    let read = prefixReads.get(prefix);
    if (!read) { read = readArtifact<CensusZipPrefixArtifact>(index.zipPrefixes[prefix], store); prefixReads.set(prefix, read); }
    const shard = await read;
    if (!shard || shard.formatVersion !== 2 || shard.versionId !== artifactVersion || shard.prefix !== prefix || !shard.statesByZip) return unread("Census ZIP lookup artifact is unavailable");
    if (!Object.hasOwn(shard.statesByZip, zip)) return { kind: "HELD", versionId, value: { known: false, scopes: [], containers: [] } };
    const touching = shard.statesByZip[zip];
    if (!Array.isArray(touching) || touching.length > 1 || touching.some(state => typeof state !== "string" || !Object.hasOwn(index.states, state))) return unread("Census ZIP lookup membership is invalid");
    if (!touching.length) return { kind: "HELD", versionId, value: { known: true, scopes: [], containers: [] } };
    const value = await stateRead(touching[0]);
    if (!value) return unread("Census ZIP district state is unavailable");
    const slice = censusDistrictEdgeSlice(value, artifactVersion, zip);
    if (slice.kind !== "HELD" || !slice.value.known) return unread("Census ZIP district membership is unavailable");
    return { ...slice, versionId };
  }
  return { versionId, loadState, loadZip };
}
