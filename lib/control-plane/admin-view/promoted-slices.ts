import type { CbsaClass, GeographyRef, GeographyType } from "../../census-geography/contract.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../../census-geography/publication.ts";
import { REGISTRATION_RECORD_CLASS, REGISTRATION_TARGETS } from "../../registration/publication.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";

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

const GEO_TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];

/** A `scope` row per published scope, so a type the pointer does not carry is never read as "none there". */
function groupingsQuery(withOverlaps: boolean, where: string, overlapZipParam?: number): string {
  const grouping =
    "g->>'geoid', g->>'ocdId', g->>'label', g->>'stateFips', g->>'stateAbbr', g->>'cbsaClass', g->'memberStates'" +
    (withOverlaps ? overlapZipParam
      ? `, (SELECT jsonb_agg(overlap) FROM jsonb_array_elements(g->'overlaps') overlap WHERE overlap->>'zcta5'=$${overlapZipParam}::text)`
      : ", g->'overlaps'" : ", NULL::jsonb");
  return (
    "WITH scopes AS MATERIALIZED (SELECT x AS scope FROM civic_data_promotions p" +
    " CROSS JOIN LATERAL jsonb_array_elements(p.payload->'scopes') x WHERE p.record_class = $1 AND p.scope = $2)" +
    " SELECT 'scope' AS row_kind, scope->>'type' AS type, scope->>'version' AS version, scope->'versionMeta'->>'plan' AS plan," +
    " NULL::text AS geoid, NULL::text AS ocd_id, NULL::text AS label, NULL::text AS state_fips, NULL::text AS state_abbr," +
    " NULL::text AS cbsa_class, NULL::jsonb AS member_states, NULL::jsonb AS overlaps, scope->'versionMeta' AS version_meta FROM scopes" +
    " UNION ALL SELECT 'grouping', scope->>'type', scope->>'version', scope->'versionMeta'->>'plan', " +
    grouping + ", NULL::jsonb" +
    ` FROM scopes CROSS JOIN LATERAL jsonb_array_elements(scope->'groupings') g WHERE scope->>'type' = ANY($3::text[]) AND ${where}`
  );
}

export interface ScopeSlice {
  readonly type: GeographyType;
  readonly version: string;
  readonly plan: string;
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

function isGeographyType(value: unknown): value is GeographyType {
  return typeof value === "string" && (GEO_TYPES as readonly string[]).includes(value);
}

function overlapsOf(value: unknown): OverlapSlice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((o) => {
    const r = o as Record<string, unknown>;
    if (typeof r.zcta5 !== "string") return [];
    return [{ zcta5: r.zcta5, whole: r.whole === true, fraction: typeof r.fraction === "number" ? r.fraction : null }];
  });
}

export function containerOfRow(row: Row, withOverlaps: boolean): ContainerSlice | null {
  const type = row.type;
  const geoid = text(row.geoid);
  const version = text(row.version);
  const label = text(row.label);
  const stateAbbr = text(row.state_abbr);
  if (!isGeographyType(type) || geoid === null || version === null || label === null || stateAbbr === null) return null;
  const cbsaClass = text(row.cbsa_class) as CbsaClass | null;
  const members = Array.isArray(row.member_states) ? (row.member_states as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const ref: GeographyRef = {
    type,
    geoid,
    version,
    ocdId: text(row.ocd_id),
    label,
    stateFips: text(row.state_fips) ?? geoid.slice(0, 2),
    stateAbbr,
    ...(cbsaClass ? { cbsaClass } : {}),
    memberStates: members,
  };
  return { ref, plan: text(row.plan) ?? "", overlaps: withOverlaps ? overlapsOf(row.overlaps) : null };
}

export function geographyOfRows(rows: readonly Row[], withOverlaps: boolean): GeographySlice {
  const scopes: ScopeSlice[] = [];
  const containers: ContainerSlice[] = [];
  for (const row of rows) {
    if (row.row_kind === "scope") {
      const version = text(row.version);
      const meta = row.version_meta as { applicability?: ScopeSlice["applicability"]; states?: readonly string[]; retrievalComplete?: boolean; provenance?: { sourceUrls?: readonly string[]; computedAt?: string } } | undefined;
      if (isGeographyType(row.type) && version !== null) scopes.push({ type: row.type, version, plan: text(row.plan) ?? "",
        ...(Array.isArray(meta?.applicability) ? { applicability: meta.applicability } : {}),
        ...(Array.isArray(meta?.states) ? { states: meta.states } : {}),
        ...(typeof meta?.retrievalComplete === "boolean" ? { retrievalComplete: meta.retrievalComplete } : {}),
        ...(meta?.provenance ? { sourceUrls: meta.provenance.sourceUrls, observedAt: meta.provenance.computedAt } : {}) });
    } else {
      const c = containerOfRow(row, withOverlaps);
      if (c !== null) containers.push(c);
    }
  }
  return { scopes, containers };
}

async function geography(
  query: ReadOnlyQuery | null,
  what: string,
  statements: readonly Statement[],
  withOverlaps: boolean,
): Promise<{ readonly slice: Slice<GeographySlice>; readonly rest: readonly (readonly Row[])[] }> {
  if (query === null) return { slice: { kind: "UNREAD", detail: `${what} was not read: this deployment names no reader store.` }, rest: [] };
  try {
    const [pointer, rows, ...rest] = await query([{ text: POINTER, params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE] }, ...statements]);
    const versionId = text(pointer?.[0]?.version_id);
    if (versionId === null) return { slice: { kind: "NOT_PUBLISHED" }, rest };
    return { slice: { kind: "HELD", versionId, value: geographyOfRows(rows ?? [], withOverlaps) }, rest };
  } catch (error) {
    return { slice: { kind: "UNREAD", detail: `${what} could not be read (${error instanceof Error ? error.name : "error"}).` }, rest: [] };
  }
}

export async function stateContainers(
  stateAbbr: string,
  types: readonly GeographyType[],
  withOverlaps: boolean,
  query: ReadOnlyQuery | null,
): Promise<Slice<GeographySlice>> {
  const st = stateAbbr.toUpperCase();
  const statement = {
    text: groupingsQuery(withOverlaps, "(g->>'stateAbbr' = $4 OR g->'memberStates' @> jsonb_build_array($4::text))"),
    params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, [...types], st],
  };
  return (await geography(query, `The Census geography for ${st}`, [statement], withOverlaps)).slice;
}

/** Include geography metadata in the state's single canonical read, without geometry. */
export function stateContainersStatement(state: string, divisionIds: readonly string[] = [], zip?: string): Statement & { readonly canonicalKeys?: true } {
  const place = Object.entries(FIPS_TO_STATE).find(([, entry]) => entry.postal === state);
  const districtKeys = zip && place ? `, coalesce((SELECT array_agg(DISTINCT 'CURATED_READER_RECORD:US:plain-english-translations:'||ocd_id) FROM (
      SELECT coalesce(g.ocd_id, CASE
        WHEN g.type='congressional_district' AND g.geoid ~ '^${place[0]}[0-9]{2}$' THEN $7::text||'/cd:'||
          CASE WHEN $8::boolean OR right(g.geoid,2) IN ('00','98') THEN 'at-large'
            WHEN right(g.geoid,2)::int>0 THEN (right(g.geoid,2)::int)::text END
        WHEN g.type IN ('state_leg_upper','state_leg_lower') AND g.geoid ~ '^${place[0]}[a-zA-Z0-9-]{1,8}$'
          AND substring(g.geoid FROM 3) !~ '^[zZ]+$' THEN $7::text||CASE WHEN g.type='state_leg_upper' THEN '/sldu:' ELSE '/sldl:' END||
          CASE WHEN substring(g.geoid FROM 3) ~ '^[0-9]+$' THEN
            CASE WHEN substring(g.geoid FROM 3)::int>0 THEN (substring(g.geoid FROM 3)::int)::text END
          ELSE nullif(trim(both '_' FROM regexp_replace(lower(substring(g.geoid FROM 3)),'[^a-z0-9]+','_','g')),'') END
        END) AS ocd_id FROM geography g WHERE g.row_kind='grouping'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.overlaps) overlap WHERE overlap->>'zcta5'=$6)
      ) selected WHERE ocd_id IS NOT NULL), '{}'::text[]) AS canonical_keys` : "";
  return {
    ...(districtKeys ? { canonicalKeys: true as const } : {}),
    text: `WITH geography AS MATERIALIZED (
      ${groupingsQuery(true, "(g->>'stateAbbr' = $4 OR g->'memberStates' @> jsonb_build_array($4::text))" +
        (districtKeys ? " AND g->'overlaps' @> jsonb_build_array(jsonb_build_object('zcta5',$6::text))" : ""),districtKeys ? 6 : undefined)}
    ) SELECT (SELECT pointer.current_version_id FROM civic_data_promotions pointer WHERE pointer.key=$1||':'||$2) AS version_id,
      coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM geography g),'[]'::jsonb) AS geography,
      coalesce((SELECT jsonb_agg(d) FROM civic_data_promotions registration,
        LATERAL jsonb_array_elements(registration.payload->'divisions') d
        WHERE registration.key='REGISTRATION:US-'||$4||':registration:v1' AND d->>'ocdId'=ANY($5::text[])), '[]'::jsonb) AS local_divisions
      ${districtKeys}
      `,
    params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, ["congressional_district", "state_leg_upper", "state_leg_lower"], state, divisionIds,
      ...(districtKeys ? [zip, `ocd-division/country:us/${place![1].prefix}:${state.toLowerCase()}`, place![1].prefix !== "state"] : [])],
  };
}

export async function oneContainer(type: GeographyType, geoid: string, query: ReadOnlyQuery | null): Promise<Slice<GeographySlice>> {
  const statement = { text: groupingsQuery(true, "g->>'geoid' = $4"), params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, [type], geoid] };
  return (await geography(query, `The Census geography for ${type.replace(/_/g, " ")} ${geoid}`, [statement], true)).slice;
}

export interface CodeSlice extends GeographySlice {
  readonly zctaTabulations?: readonly string[];
  readonly known: boolean;
}

export async function containersOfCode(
  zcta5: string,
  types: readonly GeographyType[],
  query: ReadOnlyQuery | null,
): Promise<Slice<CodeSlice>> {
  const { slice, rest } = await geography(
    query,
    `The Census geography for ZCTA ${zcta5}`,
    [
      {
        text: groupingsQuery(true, "g->'overlaps' @> jsonb_build_array(jsonb_build_object('zcta5', $4::text))"),
        params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, [...types], zcta5],
      },
      {
        text: "SELECT (p.payload->'zctaUniverse') @> jsonb_build_array($3::text) AS known, (SELECT jsonb_agg(DISTINCT s->'versionMeta'->>'zctaTabulation') FROM jsonb_array_elements(p.payload->'scopes') s) AS zcta_tabulations FROM civic_data_promotions p WHERE p.record_class = $1 AND p.scope = $2",
        params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, zcta5],
      },
    ],
    true,
  );
  if (slice.kind !== "HELD") return slice;
  return {
    ...slice,
    value: {
      scopes: slice.value.scopes,
      containers: slice.value.containers.map((c) => ({ ...c, overlaps: (c.overlaps ?? []).filter((o) => o.zcta5 === zcta5) })),
      known: rest[0]?.[0]?.known === true,
      zctaTabulations: Array.isArray(rest[0]?.[0]?.zcta_tabulations) ? (rest[0][0].zcta_tabulations as unknown[]).filter((v): v is string => typeof v === "string") : [],
    },
  };
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
