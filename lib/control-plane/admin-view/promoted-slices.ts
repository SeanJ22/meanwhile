/**
 * **THE SLICE A PAGE NEEDS, NOT THE WHOLE PAYLOAD.** (Admin, 2026-09-24.)
 *
 * Sean (2026-09-24): a load over three seconds, or a success only on a second
 * attempt, is not a win. Two promoted reader payloads kept Admin's first loads
 * over that line, because a cold server read each one whole and proved it:
 * the Census geography lookup (13.7 MB, 7.5 s) and the registry (6.1 s, the
 * 3.6 MB pointer plus the candidate it is proved against). A page needs a
 * sliver of either: one state's containers, one container's codes, the six
 * fields of each registry body. So Postgres cuts the sliver out of the
 * promoted pointer row and only that crosses the wire. Measured on production
 * 2026-09-24: Arizona's 95 containers with their codes in 48 ms, Pima County
 * in 239 ms. Registration (2026-09-25) is fifty-odd pointers of 1-5 MB each:
 * which states have one is read from the pointer columns alone, and a state's
 * counts from inside its own row.
 *
 * ```
 *   the row     civic_data_promotions, the promoted pointer itself: its current
 *               version is its last known good one (a table constraint), so its
 *               payload is the version the reader serves
 *   read only   every statement runs in one READ ONLY transaction, so Postgres
 *               itself refuses a write
 *   absent      no pointer row means not published to this store yet, which is
 *               never an empty list
 * ```
 *
 * Pure over an injected query (`ReadOnlyQuery`): the Admin data layer passes
 * the reader store's (`app/(admin)/_mw/data/reader-query.ts`), tests pass rows.
 */
import type { CbsaClass, GeographyRef, GeographyType } from "../../census-geography/contract.ts";
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

/* ------------------------------------------------------------------ geography */

export interface OverlapSlice {
  readonly zcta5: string;
  readonly whole: boolean;
  readonly fraction: number | null;
}

export interface ContainerSlice {
  readonly ref: GeographyRef;
  /** The plan the container's version is drawn to, e.g. "119th Congress". */
  readonly plan: string;
  /** Its ZCTAs, when the read asked for them. */
  readonly overlaps: readonly OverlapSlice[] | null;
}

const GEO_TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];

/**
 * One statement answers two things: which scopes are published (a `scope` row
 * each, so a type the pointer does not carry is never read as "none there"),
 * and the groupings the filter selects. The payload is decoded once, in the
 * materialized `scopes` CTE, however many rows come back.
 */
function groupingsQuery(withOverlaps: boolean, where: string): string {
  const grouping =
    "g->>'geoid', g->>'ocdId', g->>'label', g->>'stateFips', g->>'stateAbbr', g->>'cbsaClass', g->'memberStates'" +
    (withOverlaps ? ", g->'overlaps'" : ", NULL::jsonb");
  return (
    "WITH scopes AS MATERIALIZED (SELECT x AS scope FROM civic_data_promotions p" +
    " CROSS JOIN LATERAL jsonb_array_elements(p.payload->'scopes') x WHERE p.record_class = $1 AND p.scope = $2)" +
    " SELECT 'scope' AS row_kind, scope->>'type' AS type, scope->>'version' AS version, scope->'versionMeta'->>'plan' AS plan," +
    " NULL::text AS geoid, NULL::text AS ocd_id, NULL::text AS label, NULL::text AS state_fips, NULL::text AS state_abbr," +
    " NULL::text AS cbsa_class, NULL::jsonb AS member_states, NULL::jsonb AS overlaps FROM scopes" +
    " UNION ALL SELECT 'grouping', scope->>'type', scope->>'version', scope->'versionMeta'->>'plan', " +
    grouping +
    ` FROM scopes CROSS JOIN LATERAL jsonb_array_elements(scope->'groupings') g WHERE scope->>'type' = ANY($3::text[]) AND ${where}`
  );
}

/** A published scope: its type, version and plan. */
export interface ScopeSlice {
  readonly type: GeographyType;
  readonly version: string;
  readonly plan: string;
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

/** A grouping row as the lookup's own ref: the same fields `createLookup` returns. */
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

/** The rows of one `groupingsQuery` as published scopes and containers. */
export function geographyOfRows(rows: readonly Row[], withOverlaps: boolean): GeographySlice {
  const scopes: ScopeSlice[] = [];
  const containers: ContainerSlice[] = [];
  for (const row of rows) {
    if (row.row_kind === "scope") {
      const version = text(row.version);
      if (isGeographyType(row.type) && version !== null) scopes.push({ type: row.type, version, plan: text(row.plan) ?? "" });
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

/** Every container of these types that lies in, or reaches into, the state. */
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

/** One container, with its ZCTAs. */
export async function oneContainer(type: GeographyType, geoid: string, query: ReadOnlyQuery | null): Promise<Slice<GeographySlice>> {
  const statement = { text: groupingsQuery(true, "g->>'geoid' = $4"), params: [CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, [type], geoid] };
  return (await geography(query, `The Census geography for ${type.replace(/_/g, " ")} ${geoid}`, [statement], true)).slice;
}

export interface CodeSlice extends GeographySlice {
  readonly zctaTabulations?: readonly string[];
  /** Whether the ZCTA is in the published universe at all. */
  readonly known: boolean;
}

/** Every container of these types whose ZCTAs include this one, each with that ZCTA's overlap alone. */
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

/* ------------------------------------------------------------------ registration */

/** A government a state's promoted registration minted a body for, on its Census division. */
export interface RegisteredGovernmentSlice {
  readonly jurisdictionId: string;
  readonly ocdId: string;
  readonly bodyId: string;
}

const REGISTRATION_GOVERNMENTS =
  "SELECT b->>'jurisdictionId' AS jurisdiction_id, b->>'ocdId' AS ocd_id, b->>'id' AS body_id" +
  " FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'bodies') b" +
  " WHERE p.record_class = $1 AND p.scope = $2 AND b->>'jurisdictionId' IS NOT NULL AND b->>'ocdId' = ANY($3::text[])";

/**
 * The governments one state's promoted registration (`REGISTRATION`, `US-<ST>:registration:v1`) holds a body for
 * on any of these divisions: the sliver the Send preview needs (2026-09-25), never the whole version.
 */
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
      return jurisdictionId === null || ocdId === null || bodyId === null ? [] : [{ jurisdictionId, ocdId, bodyId }];
    });
    return { kind: "HELD", versionId, value };
  } catch (error) {
    return { kind: "UNREAD", detail: `${st}'s registration could not be read (${error instanceof Error ? error.name : "error"}).` };
  }
}

/* ------------------------------------------------------------------ registry */

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

/** The six fields of every body the promoted registry holds. */
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

/* ------------------------------------------------------------------ registration */

/**
 * One state's promoted REGISTRATION pointer, as its metadata alone: which
 * version is live and when it was promoted. The registration itself (1-5 MB a
 * state) is never read for this.
 */
export interface RegistrationPointer {
  /** Lower-case USPS code: "oh". */
  readonly state: string;
  readonly versionId: string;
  /** ISO instant the pointer was promoted. */
  readonly promotedAt: string;
}

export type RegistrationPointers =
  | { readonly kind: "HELD"; readonly pointers: readonly RegistrationPointer[] }
  | { readonly kind: "UNREAD"; readonly detail: string };

/**
 * Every state's registration pointer in one indexed read of three small
 * columns. Measured against production 2026-09-25: 51 rows, 6.8 KB, 0.13 ms
 * in Postgres (42 buffers, none of them the payload).
 */
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

/** What one state's promoted registration holds, counted by Postgres inside the row. */
export interface RegistrationCounts {
  readonly promotedAt: string;
  /** Governments the Census of Governments lists in the state (the state government itself excluded). */
  readonly governments: number;
  /** Of those, the ones placed on a Census division. */
  readonly pairedGovernments: number;
  /** Bodies the registration holds (a government's, or a school district's board). */
  readonly bodies: number;
  /** Census divisions the registration holds. */
  readonly divisions: number;
}

/**
 * One state's counts: the counts object and two array lengths, cut out of the
 * pointer row so ~300 bytes cross the wire. Measured against production
 * 2026-09-25 on the largest state, Pennsylvania: 9.7 ms in Postgres.
 */
const REGISTRATION_COUNTS =
  "SELECT current_version_id AS version_id, promoted_at, (payload->'counts'->>'governments')::int AS governments," +
  " (payload->'counts'->>'pairedGovernments')::int AS paired, jsonb_array_length(payload->'bodies') AS bodies," +
  " jsonb_array_length(payload->'divisions') AS divisions FROM civic_data_promotions WHERE record_class = $1 AND scope = $2";

function count(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** One state's registration counts, or NOT_PUBLISHED when no registration is promoted for it. */
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
