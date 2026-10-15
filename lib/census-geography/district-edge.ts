import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import type { GeographyType } from "./contract.ts";
import { publishScopeBoundaries } from "./boundary-artifacts.ts";
import type { CodeSlice, ContainerSlice, GeographySlice, ScopeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";

export const REPRESENTATION_GEOGRAPHY_TYPES: readonly GeographyType[] = ["congressional_district", "state_leg_upper", "state_leg_lower", "overlay_district", "aiannh"];
export const censusDistrictEdgeVersion = (sourceVersion: string): string => `census-districts/v4:${sourceVersion}`;

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

interface CensusZipPrefixArtifact {
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

async function putArtifact(value: CensusDistrictStateArtifact | CensusZipPrefixArtifact, store: ReaderArtifactStore): Promise<CensusDistrictArtifactRef> {
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)));
  return { key: await store.putImmutable(bytes, "json.gz"), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}

function stateArtifact(dataset: BuiltDataset, state: string, versionId: string): CensusDistrictStateArtifact {
  const containers: Omit<ContainerSlice, "overlaps">[] = [];
  const codes: Record<string, [number, boolean, number | null][]> = {};
  const scopes: ScopeSlice[] = [];
  const scopeDetails: Omit<BuiltScope, "groupings">[] = [];
  for (const scope of dataset.scopes) {
    const groups = scope.groupings.filter(group => group.stateAbbr === state || group.memberStates.includes(state));
    if (groups.length === 0) continue;
    const { groupings: _groupings, ...details } = scope;
    scopeDetails.push({ ...details, instanceCount: groups.length, zctaEdgeCount: groups.reduce((sum, group) => sum + group.overlaps.length, 0) });
    scopes.push({ type: scope.type, version: scope.version, plan: scope.versionMeta.plan,
      stateFips: scope.versionMeta.stateFips, chamber: scope.versionMeta.chamber,
      applicability: scope.versionMeta.applicability, retrievalComplete: scope.versionMeta.retrievalComplete,
      ...(scope.versionMeta.states ? { states: scope.versionMeta.states } : {}),
      sourceUrls: scope.versionMeta.provenance.sourceUrls, observedAt: scope.versionMeta.provenance.computedAt });
    for (const group of groups) {
      const { overlaps, ...identity } = group;
      if (identity.geometry) throw new Error("Census state artifacts require published boundary references");
      const index = containers.length;
      containers.push({ ref: { ...identity, type: scope.type, version: scope.version }, plan: scope.versionMeta.plan });
      for (const overlap of overlaps) (codes[overlap.zcta5] ??= []).push([index, overlap.whole, overlap.fraction]);
    }
  }
  return { formatVersion: 2, versionId, state, builtAt: dataset.builtAt, coverage: dataset.coverage,
    ...(dataset.sourceFailures ? { sourceFailures: dataset.sourceFailures } : {}),
    ...(dataset.sourceDiscrepancies ? { sourceDiscrepancies: dataset.sourceDiscrepancies } : {}),
    scopeDetails, zctaUniverse: dataset.zctaUniverse, scopes, containers, codes };
}

function mergeSummary(prior: Omit<BuiltScope, "groupings"> | undefined, scope: BuiltScope, state: string): Omit<BuiltScope, "groupings"> {
  const { groupings, ...metadata } = scope;
  const owned = groupings.filter(group => group.stateAbbr === state);
  const inputs = [prior?.versionMeta.provenance, scope.versionMeta.provenance].filter(input => input !== undefined);
  const files = new Map<string, readonly [string, string]>();
  const unhashedFiles = new Set<string>();
  for (const input of inputs) for (const [index, file] of input.sourceFiles.entries()) {
    const checksum = input.sourceChecksums[index];
    if (checksum === undefined) unhashedFiles.add(file);
    else files.set(`${file}\0${checksum}`, [file, checksum]);
  }
  const pairs = [...files.values()].sort(([fileA, hashA], [fileB, hashB]) => fileA.localeCompare(fileB) || hashA.localeCompare(hashB));
  const validators = new Map(inputs.flatMap(input => input.sourceValidators ?? []).map(validator => [JSON.stringify(validator), validator]));
  const states = [...new Set([...(prior?.versionMeta.states ?? []), ...(scope.versionMeta.states ?? [])])].sort();
  return { ...metadata, instanceCount: (prior?.instanceCount ?? 0) + owned.length,
    zctaEdgeCount: (prior?.zctaEdgeCount ?? 0) + owned.reduce((sum, group) => sum + group.overlaps.length, 0),
    versionMeta: { ...scope.versionMeta,
      ...(states.length ? { states } : {}),
      retrievalComplete: prior?.versionMeta.retrievalComplete === false || scope.versionMeta.retrievalComplete === false ? false : scope.versionMeta.retrievalComplete ?? prior?.versionMeta.retrievalComplete,
      provenance: { ...scope.versionMeta.provenance,
        sourceUrls: [...new Set(inputs.flatMap(input => input.sourceUrls))].sort(),
        sourceFiles: [...pairs.map(([file]) => file), ...[...unhashedFiles].filter(file => !pairs.some(([name]) => name === file)).sort()],
        sourceChecksums: pairs.map(([, checksum]) => checksum),
        ...(validators.size ? { sourceValidators: [...validators.values()] } : {}),
        computedAt: inputs.map(input => input.computedAt).sort().at(-1)!,
      },
    },
  };
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

export async function publishCensusDistrictStates(
  inputs: AsyncIterable<CensusDistrictStateInput>, sourceVersion: string, store: ReaderArtifactStore,
): Promise<CensusDistrictEdge> {
  const versionId = censusDistrictEdgeVersion(sourceVersion);
  const states: Record<string, CensusDistrictArtifactRef> = {};
  const summaries = new Map<string, Omit<BuiltScope, "groupings">>();
  const cbsaGroups = new Map<string, Set<string>>(), cbsaEdges = new Map<string, Set<string>>();
  let builtAt = "", sourceFailureCount = 0, sourceDiscrepancyCount = 0;
  const coverages = new Set<string>();
  const prefixes = new Map<string, Map<string, Set<string>>>();
  const zipStates = (zip: string): Set<string> => {
    if (!/^\d{5}$/.test(zip)) throw new Error(`Invalid Census ZIP ${zip}`);
    const prefix = zip.slice(0, 3);
    let shard = prefixes.get(prefix);
    if (!shard) { shard = new Map(); prefixes.set(prefix, shard); }
    let touching = shard.get(zip);
    if (!touching) { touching = new Set(); shard.set(zip, touching); }
    return touching;
  };
  for await (const { state, dataset } of inputs) {
    if (!/^[A-Z]{2}$/.test(state) || Object.hasOwn(states, state)) throw new Error(`Invalid or duplicate Census state ${state}`);
    const stateScopes: BuiltScope[] = [];
    const stateZips = new Set(dataset.zctaUniverse);
    for (const scope of dataset.scopes) stateScopes.push(await publishScopeBoundaries({ ...scope,
      groupings: scope.groupings.filter(group => group.stateAbbr === state || group.memberStates.includes(state)).map(group => scope.type === "cbsa"
        ? { ...group, overlaps: group.overlaps.filter(overlap => stateZips.has(overlap.zcta5)) } : group) }, store));
    const value = stateArtifact({ ...dataset, scopes: stateScopes }, state, versionId);
    states[state] = await putArtifact(value, store);
    builtAt = builtAt > dataset.builtAt ? builtAt : dataset.builtAt;
    coverages.add(dataset.coverage);
    sourceFailureCount += dataset.sourceFailures?.length ?? 0;
    sourceDiscrepancyCount += dataset.sourceDiscrepancies?.length ?? 0;
    for (const scope of stateScopes) {
      const key = `${scope.type}|${scope.version}|${scope.versionMeta.stateFips ?? ""}|${scope.versionMeta.chamber ?? ""}`;
      let summary = mergeSummary(summaries.get(key), scope, state);
      if (scope.type === "cbsa") {
        const groups = cbsaGroups.get(key) ?? new Set<string>(), edges = cbsaEdges.get(key) ?? new Set<string>();
        for (const group of scope.groupings) {
          groups.add(group.geoid);
          for (const overlap of group.overlaps) edges.add(`${group.geoid}|${overlap.zcta5}`);
        }
        cbsaGroups.set(key, groups); cbsaEdges.set(key, edges);
        summary = { ...summary, instanceCount: groups.size, zctaEdgeCount: edges.size };
      }
      summaries.set(key, summary);
    }
    for (const zip of dataset.zctaUniverse) zipStates(zip);
    for (const [zip, rows] of Object.entries(value.codes)) if (rows.some(([index]) => value.containers[index].ref.type !== "cbsa" && value.containers[index].ref.stateAbbr === state)) zipStates(zip).add(state);
  }
  const zipPrefixes: Record<string, CensusDistrictArtifactRef> = {};
  const zctaCount = [...prefixes.values()].reduce((sum, shard) => sum + shard.size, 0);
  for (const [prefix, shard] of [...prefixes].sort(([a], [b]) => a.localeCompare(b))) {
    prefixes.delete(prefix);
    zipPrefixes[prefix] = await putArtifact({ formatVersion: 2, versionId, prefix,
      statesByZip: Object.fromEntries([...shard].sort(([a], [b]) => a.localeCompare(b)).map(([zip, touching]) => [zip, [...touching].sort()])) }, store);
  }
  return { formatVersion: 2, versionId, builtAt, coverage: coverages.size === 1 ? [...coverages][0] : `${Object.keys(states).length} state and territory partitions`,
    scopes: [...summaries.values()].filter(scope => scope.instanceCount > 0), zctaCount, sourceFailureCount, sourceDiscrepancyCount, states, zipPrefixes };
}

export async function buildCensusDistrictEdge(dataset: BuiltDataset, sourceVersion: string, store: ReaderArtifactStore): Promise<CensusDistrictEdge> {
  const states = [...new Set(dataset.scopes.flatMap(scope => scope.groupings.flatMap(group => [group.stateAbbr, ...group.memberStates])).filter(state => /^[A-Z]{2}$/.test(state)))].sort();
  async function* inputs(): AsyncGenerator<CensusDistrictStateInput> {
    for (const state of states) {
      const scopes = dataset.scopes.map(scope => ({ ...scope, groupings: scope.groupings.filter(group => group.stateAbbr === state || group.memberStates.includes(state)) }));
      const zctaUniverse = states.length === 1 ? dataset.zctaUniverse : [...new Set(scopes.filter(scope => scope.type !== "cbsa")
        .flatMap(scope => scope.groupings.filter(group => group.stateAbbr === state).flatMap(group => group.overlaps.map(overlap => overlap.zcta5))))].sort();
      yield { state, dataset: { ...dataset, scopes, zctaUniverse } };
    }
  }
  const index = await publishCensusDistrictStates(inputs(), sourceVersion, store);
  return { ...index, builtAt: dataset.builtAt, coverage: dataset.coverage,
    sourceFailureCount: dataset.sourceFailures?.length ?? 0, sourceDiscrepancyCount: dataset.sourceDiscrepancies?.length ?? 0 };
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

async function readArtifact<T>(ref: CensusDistrictArtifactRef | undefined, store: ReaderArtifactStore): Promise<T | null> {
  if (!ref || typeof ref.key !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) return null;
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes || bytes.byteLength !== ref.bytes || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) return null;
    return JSON.parse(gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8")) as T;
  } catch { return null; }
}

export async function readCensusDistrictState(index: CensusDistrictEdge, state: string, store: ReaderArtifactStore): Promise<CensusDistrictStateArtifact | null> {
  const value = await readArtifact<CensusDistrictStateArtifact>(index.states[state], store);
  if (!value || value.formatVersion !== 2 || value.versionId !== index.versionId || value.state !== state || !Array.isArray(value.scopes) ||
    !Array.isArray(value.containers) || !value.codes || !Array.isArray(value.scopeDetails) || !Array.isArray(value.zctaUniverse) ||
    value.containers.some(row => !row.ref || row.ref.stateAbbr !== state && (!Array.isArray(row.ref.memberStates) || !row.ref.memberStates.includes(state)) || row.ref.geometry)) return null;
  return value;
}

export function createCensusDistrictReaderEdge(index: CensusDistrictEdge, store: ReaderArtifactStore, versionId = index.versionId): CensusDistrictReaderEdge {
  const artifactVersion = index.versionId;
  const stateReads = new Map<string, Promise<CensusDistrictStateArtifact | null>>();
  const prefixReads = new Map<string, Promise<CensusZipPrefixArtifact | null>>();
  const valid = index.formatVersion === 2 && typeof versionId === "string" && index.states && index.zipPrefixes;
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
    if (!Array.isArray(touching) || touching.some(state => typeof state !== "string" || !Object.hasOwn(index.states, state))) return unread("Census ZIP lookup membership is invalid");
    const values = await Promise.all(touching.map(stateRead));
    const scopes = new Map<string, ScopeSlice>();
    const containers: ContainerSlice[] = [];
    const identities = new Map<string, ContainerSlice>();
    for (const value of values) {
      if (!value) return unread("Census ZIP district state is unavailable");
      const slice = censusDistrictEdgeSlice(value, artifactVersion, zip);
      if (slice.kind !== "HELD" || !slice.value.known) return unread("Census ZIP district membership is unavailable");
      for (const scope of slice.value.scopes) scopes.set(`${scope.type}|${scope.version}|${scope.stateFips ?? ""}|${scope.chamber ?? ""}`, scope);
      for (const container of slice.value.containers) {
        const key = `${container.ref.type}|${container.ref.version}|${container.ref.geoid}`;
        const prior = identities.get(key);
        if (prior && (prior.overlaps?.[0].fraction !== container.overlaps?.[0].fraction || prior.overlaps?.[0].whole !== container.overlaps?.[0].whole)) return unread("Census ZIP district sources disagree");
        if (!prior) { identities.set(key, container); containers.push(container); }
      }
    }
    return { kind: "HELD", versionId, value: { known: true, scopes: [...scopes.values()], containers } };
  }
  return { versionId, loadState, loadZip };
}
