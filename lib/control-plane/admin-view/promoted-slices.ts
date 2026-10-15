import type { GeographyRef, GeographyType } from "../../census-geography/contract.ts";
import { censusStateDataset, createCensusDistrictReaderEdge, readCensusDistrictState,
  type CensusDistrictEdge, type CensusDistrictStateArtifact } from "../../census-geography/district-edge.ts";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../../meetings/edge-store.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../../census-geography/publication.ts";
import { REGISTRATION_RECORD_CLASS, REGISTRATION_TARGETS } from "../../registration/publication.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../../registry/runtime-data-plane.ts";

export type Row = Readonly<Record<string, unknown>>;

export interface Statement {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Runs its statements in one READ ONLY transaction and answers each one's rows. */
export type ReadOnlyQuery = (statements: readonly Statement[]) => Promise<readonly (readonly Row[])[]>;

export type Slice<T> =
  | { readonly kind: "HELD"; readonly versionId: string; readonly value: T }
  | { readonly kind: "NOT_PUBLISHED" }
  | { readonly kind: "UNREAD"; readonly detail: string };

const POINTER = "SELECT current_version_id AS version_id FROM civic_data_promotions WHERE record_class = $1 AND scope = $2";

export interface OverlapSlice {
  readonly zcta5: string;
  readonly whole: boolean;
  readonly fraction: number | null;
}

export interface ContainerSlice {
  readonly ref: GeographyRef;
  readonly plan: string;
  readonly overlaps: readonly OverlapSlice[] | null;
}

export interface ScopeSlice {
  readonly type: GeographyType;
  readonly version: string;
  readonly plan: string;
  readonly stateFips?: string;
  readonly chamber?: "upper" | "lower";
  readonly applicability?: readonly import("../../census-geography/selection.ts").GeographyApplicability[];
  readonly states?: readonly string[];
  readonly retrievalComplete?: boolean;
  readonly sourceUrls?: readonly string[];
  readonly observedAt?: string;
}

export interface GeographySlice {
  readonly scopes: readonly ScopeSlice[];
  readonly containers: readonly ContainerSlice[];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function readCensusGeographyIndex(query: ReadOnlyQuery | null): Promise<Slice<CensusDistrictEdge>> {
  if (query === null) return { kind: "UNREAD", detail: "Census geography was not read: this deployment names no reader store." };
  try {
    const [rows] = await query([{ text: "SELECT current_version_id AS version_id, payload FROM civic_data_promotions WHERE record_class = $1 AND scope = $2 AND payload->>'formatVersion' = '2'",
      params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE] }]);
    const row = rows?.[0];
    if (typeof row?.version_id !== "string") return { kind: "NOT_PUBLISHED" };
    const index = row.payload as CensusDistrictEdge | undefined;
    if (!index || index.formatVersion !== 2 || typeof index.versionId !== "string" || !index.states || !index.zipPrefixes || !Array.isArray(index.scopes)) {
      return { kind: "UNREAD", detail: "The promoted Census geography index is invalid." };
    }
    return { kind: "HELD", versionId: row.version_id, value: index };
  } catch (error) {
    return { kind: "UNREAD", detail: `Census geography could not be read (${error instanceof Error ? error.name : "error"}).` };
  }
}

function stateGeography(value: CensusDistrictStateArtifact, types: readonly GeographyType[], withOverlaps: boolean): GeographySlice {
  const dataset = censusStateDataset(value);
  return { scopes: value.scopes.filter(scope => types.includes(scope.type)), containers: dataset.scopes.flatMap(scope =>
    types.includes(scope.type) ? scope.groupings.map(group => {
      const { overlaps, ...identity } = group;
      return { ref: { ...identity, type: scope.type, version: scope.version }, plan: scope.versionMeta.plan, overlaps: withOverlaps ? overlaps : null };
    }) : []) };
}

export async function stateContainers(
  stateAbbr: string, types: readonly GeographyType[], withOverlaps: boolean, query: ReadOnlyQuery | null,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): Promise<Slice<GeographySlice>> {
  const index = await readCensusGeographyIndex(query);
  if (index.kind !== "HELD") return index;
  const state = stateAbbr.toUpperCase();
  if (!Object.hasOwn(index.value.states, state)) return { kind: "NOT_PUBLISHED" };
  if (!store) return { kind: "UNREAD", detail: "The Census geography artifact store is unavailable." };
  const value = await readCensusDistrictState(index.value, state, store);
  if (!value) return { kind: "UNREAD", detail: `The Census geography artifact for ${state} is unavailable.` };
  return { kind: "HELD", versionId: index.versionId, value: stateGeography(value, types, withOverlaps) };
}

export async function oneContainer(
  type: GeographyType, geoid: string, query: ReadOnlyQuery | null,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(), stateAbbr?: string,
): Promise<Slice<GeographySlice>> {
  const state = stateAbbr ?? (type !== "cbsa" && type !== "aiannh" ? FIPS_TO_STATE[geoid.slice(0, 2)]?.postal : undefined);
  if (!state) return { kind: "UNREAD", detail: "A state is required to read this Census geography." };
  const slice = await stateContainers(state, [type], true, query, store);
  if (slice.kind !== "HELD") return slice;
  return { ...slice, value: { ...slice.value, containers: slice.value.containers.filter(row => row.ref.geoid === geoid) } };
}

export interface CodeSlice extends GeographySlice {
  readonly zctaTabulations?: readonly string[];
  readonly known: boolean;
}

export async function containersOfCode(
  zcta5: string, types: readonly GeographyType[], query: ReadOnlyQuery | null,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): Promise<Slice<CodeSlice>> {
  const index = await readCensusGeographyIndex(query);
  if (index.kind !== "HELD") return index;
  if (!store) return { kind: "UNREAD", detail: "The Census geography artifact store is unavailable." };
  const slice = await createCensusDistrictReaderEdge(index.value, store, index.versionId).loadZip(zcta5);
  if (slice.kind !== "HELD") return slice;
  return { ...slice, value: { ...slice.value, scopes: slice.value.scopes.filter(scope => types.includes(scope.type)),
    containers: slice.value.containers.filter(row => types.includes(row.ref.type)),
    zctaTabulations: [...new Set(index.value.scopes.filter(scope => types.includes(scope.type)).map(scope => scope.versionMeta.zctaTabulation))] } };
}

export interface RegisteredGovernmentSlice {
  readonly jurisdictionId: string;
  readonly ocdId: string;
  readonly bodyId: string | null;
}

const REGISTRATION_GOVERNMENTS =
  "SELECT COALESCE(g->>'jurisdictionId', g->>'id') AS jurisdiction_id, a->>'divisionId' AS ocd_id, g->'bodyIds'->>0 AS body_id" +
  " FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'governments') g" +
  " CROSS JOIN LATERAL jsonb_array_elements(g->'associations') a" +
  " WHERE p.record_class = $1 AND p.scope = $2 AND g->>'kind' <> 'EDUCATION_AGENCY' AND a->>'divisionId' = ANY($3::text[])";

export async function registrationGovernments(
  state: string,
  ocdIds: readonly string[],
  query: ReadOnlyQuery | null,
): Promise<Slice<readonly RegisteredGovernmentSlice[]>> {
  const st = state.toUpperCase();
  if (query === null) return { kind: "UNREAD", detail: `${st}'s registration was not read: this deployment names no reader store.` };
  const params = ["REGISTRATION", `US-${st}:registration:v1`];
  try {
    const [pointer, rows] = await query([
      { text: POINTER, params },
      { text: REGISTRATION_GOVERNMENTS, params: [...params, [...ocdIds]] },
    ]);
    const versionId = text(pointer?.[0]?.version_id);
    if (versionId === null) return { kind: "NOT_PUBLISHED" };
    const value = (rows ?? []).flatMap((row) => {
      const jurisdictionId = text(row.jurisdiction_id);
      const ocdId = text(row.ocd_id);
      const bodyId = text(row.body_id);
      return jurisdictionId === null || ocdId === null ? [] : [{ jurisdictionId, ocdId, bodyId }];
    });
    return { kind: "HELD", versionId, value };
  } catch (error) {
    return { kind: "UNREAD", detail: `${st}'s registration could not be read (${error instanceof Error ? error.name : "error"}).` };
  }
}

export interface RegistryBodyFields {
  readonly id: string;
  readonly name: string | null;
  readonly ocdId: string | null;
  readonly alsoServesOcdIds: readonly string[];
  readonly coverageStatus: unknown;
  readonly bodyClass: string | null;
}

const REGISTRY_BODIES =
  "SELECT b->>'id' AS id, b->>'name' AS name, b->>'ocdId' AS ocd_id, b->'alsoServesOcdIds' AS also_serves," +
  " b->'coverageStatus' AS coverage_status, b->>'bodyClass' AS body_class" +
  " FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'registry'->'bodies') b" +
  " WHERE p.record_class = $1 AND p.scope = $2";

export function registryBodyOfRow(row: Row): RegistryBodyFields | null {
  const id = text(row.id);
  if (id === null) return null;
  return {
    id,
    name: text(row.name),
    ocdId: text(row.ocd_id),
    alsoServesOcdIds: Array.isArray(row.also_serves) ? (row.also_serves as unknown[]).filter((s): s is string => typeof s === "string") : [],
    coverageStatus: row.coverage_status ?? null,
    bodyClass: text(row.body_class),
  };
}

export async function registryBodies(query: ReadOnlyQuery | null): Promise<Slice<readonly RegistryBodyFields[]>> {
  if (query === null) return { kind: "UNREAD", detail: "The registry was not read: this deployment names no reader store." };
  const params = ["REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE];
  try {
    const [pointer, rows] = await query([
      { text: POINTER, params },
      { text: REGISTRY_BODIES, params },
    ]);
    const versionId = text(pointer?.[0]?.version_id);
    if (versionId === null) return { kind: "NOT_PUBLISHED" };
    const value = (rows ?? []).flatMap((row) => {
      const b = registryBodyOfRow(row);
      return b === null ? [] : [b];
    });
    return { kind: "HELD", versionId, value };
  } catch (error) {
    return { kind: "UNREAD", detail: `The registry could not be read (${error instanceof Error ? error.name : "error"}).` };
  }
}

export interface RegistrationPointer {
  readonly state: string;
  readonly versionId: string;
  readonly promotedAt: string;
}

export type RegistrationPointers =
  | { readonly kind: "HELD"; readonly pointers: readonly RegistrationPointer[] }
  | { readonly kind: "UNREAD"; readonly detail: string };

const REGISTRATION_POINTERS =
  "SELECT scope, current_version_id AS version_id, promoted_at FROM civic_data_promotions WHERE record_class = $1 AND scope = ANY($2::text[])";

function instant(value: unknown): string | null {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function registrationPointers(query: ReadOnlyQuery | null): Promise<RegistrationPointers> {
  if (query === null) return { kind: "UNREAD", detail: "Registration was not read: this deployment names no reader store." };
  const stateOfScope = new Map(REGISTRATION_TARGETS.map((t) => [t.scope, t.state.toLowerCase()]));
  try {
    const [rows] = await query([{ text: REGISTRATION_POINTERS, params: [REGISTRATION_RECORD_CLASS, [...stateOfScope.keys()]] }]);
    const pointers = (rows ?? []).flatMap((row): RegistrationPointer[] => {
      const scope = text(row.scope);
      const state = scope === null ? undefined : stateOfScope.get(scope);
      const versionId = text(row.version_id);
      const promotedAt = instant(row.promoted_at);
      return state === undefined || versionId === null || promotedAt === null ? [] : [{ state, versionId, promotedAt }];
    });
    return { kind: "HELD", pointers };
  } catch (error) {
    return { kind: "UNREAD", detail: `Registration could not be read (${error instanceof Error ? error.name : "error"}).` };
  }
}

export interface RegistrationCounts {
  readonly promotedAt: string;
  readonly governments: number;
  readonly pairedGovernments: number;
  readonly bodies: number;
  readonly divisions: number;
}

const REGISTRATION_COUNTS =
  "SELECT current_version_id AS version_id, promoted_at, (payload->'counts'->>'governments')::int AS governments," +
  " (payload->'counts'->>'pairedGovernments')::int AS paired, jsonb_array_length(payload->'bodies') AS bodies," +
  " jsonb_array_length(payload->'divisions') AS divisions FROM civic_data_promotions WHERE record_class = $1 AND scope = $2";

function count(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function registrationCounts(state: string, query: ReadOnlyQuery | null): Promise<Slice<RegistrationCounts>> {
  const target = REGISTRATION_TARGETS.find((t) => t.state === state.toUpperCase());
  // A code outside the FIPS table has no registration contract, so it has nothing promoted.
  if (target === undefined) return { kind: "NOT_PUBLISHED" };
  if (query === null) return { kind: "UNREAD", detail: `${target.state}'s registration was not read: this deployment names no reader store.` };
  try {
    const [rows] = await query([{ text: REGISTRATION_COUNTS, params: [REGISTRATION_RECORD_CLASS, target.scope] }]);
    const row = rows?.[0];
    const versionId = text(row?.version_id);
    if (row === undefined || versionId === null) return { kind: "NOT_PUBLISHED" };
    const promotedAt = instant(row.promoted_at);
    const governments = count(row.governments);
    const pairedGovernments = count(row.paired);
    const bodies = count(row.bodies);
    const divisions = count(row.divisions);
    if (promotedAt === null || governments === null || pairedGovernments === null || bodies === null || divisions === null) {
      return { kind: "UNREAD", detail: `${target.state}'s registration was read, but its counts are not in the shape this page reads.` };
    }
    return { kind: "HELD", versionId, value: { promotedAt, governments, pairedGovernments, bodies, divisions } };
  } catch (error) {
    return { kind: "UNREAD", detail: `${target.state}'s registration could not be read (${error instanceof Error ? error.name : "error"}).` };
  }
}
