/**
 * Census ACS 5-year total population (B01003), for every supported Census geography, from
 * `api.census.gov` (public domain). The API key is `CENSUS_API_KEY` in the environment and is never
 * printed. The national acquirer discovers the newest published five-year vintage. A place or county estimate is a different
 * geography and is never substituted for a ZCTA.
 *
 *   ZCTA    `get=NAME,B01003_001E,B01003_001M&for=zip code tabulation area:*`, one call
 *   STATE   `get=NAME,B01003_001E,B01003_001M&for=state:*` (50 states, DC, Puerto Rico), one call
 *
 * `B01003_001M` is the Bureau's own 90% margin of error, the only non-arbitrary way to say whether a small
 * ZCTA number may be read as a count. The API answers a margin it cannot compute with a negative jam
 * value; those are stored as an empty cell, never as a negative number or zero. A ZIP with no ZCTA is a
 * named gap downstream, never a zero.
 *
 * `fetch()` reads the API and `normalize()` turns rows into typed records, refusing a non-numeric or
 * negative estimate. `toCsv()` is a pure serializer for evidence and tests. Production promotes the
 * normalized candidate through the data plane; this module has no filesystem writer.
 *
 * @freshness-reads-here — `fetchedAt` is stamped by the call that reads the source, and never restamped.
 */
import {
  readPublisherBody,
  requestPublisher,
  sourceAcquisitionFailure,
} from "../../civic-data/source-acquisition-error.ts";

export const AGENCY = "U.S. Census Bureau — American Community Survey";
/** Default vintage for older saved-source callers; the national acquirer supplies its discovered release. */
export const VINTAGE_YEAR = 2024;
export const BASE = `https://api.census.gov/data/${VINTAGE_YEAR}/acs/acs5`;
export const VARIABLE = "B01003_001E";
/** The Bureau's published margin of error, at 90% confidence, for VARIABLE. */
export const MARGIN_VARIABLE = "B01003_001M";
export const KEY_VAR = "CENSUS_API_KEY";

export const ACS_GEOGRAPHIES = {
  nation: "us", state: "state", zcta: "zip code tabulation area", county: "county",
  place: "place", county_subdivision: "county subdivision", congressional_district: "congressional district",
  state_leg_upper: "state legislative district (upper chamber)", state_leg_lower: "state legislative district (lower chamber)",
  school_unified: "school district (unified)", school_elementary: "school district (elementary)", school_secondary: "school district (secondary)",
} as const;
export type AcsScope = keyof typeof ACS_GEOGRAPHIES;
interface AcsAttribution {
  readonly sourceUrl: string;
  readonly citationUrl?: string;
  readonly sourceOrg: string;
  readonly sourceKind: "OFFICIAL";
  readonly publishedAt: string | null;
  readonly publicationUrl?: string;
  readonly retrievedAt: string;
  readonly vintage: number;
  readonly period: string;
}

export interface AcsPopulationRow {
  /** Exact native GEOID, including every parent FIPS component. */
  readonly code: string;
  readonly name: string;
  readonly population: number;
  /**
   * The Bureau's 90%-confidence margin of error on `population`, or null when
   * the Bureau published a jam value instead of a margin. Null means "the
   * Bureau did not state one", which is a different fact from a margin of 0.
   */
  readonly marginOfError: number | null;
  readonly geography?: AcsScope;
  readonly stateFips?: string | null;
  readonly censusGeoId?: string;
  readonly divisionIds?: readonly string[];
  readonly attribution?: AcsAttribution;
}

export interface AcsFetch {
  readonly scope: AcsScope;
  readonly url: string;
  readonly status: number;
  readonly fetchedAt: string;
  /** The API's own header row followed by data rows, exactly as returned. */
  readonly rows: readonly (readonly (string | null)[])[];
  /** Exact response bytes before parsing; persisted by the routine data ledger as a hash. */
  readonly rawText?: string;
  /** Credential-free final route used for authority-host validation. */
  readonly finalUrl?: string;
  readonly vintage?: number;
  readonly publishedAt?: string | null;
  readonly publicationUrl?: string;
}

function geography(scope: AcsScope): string {
  return `${ACS_GEOGRAPHIES[scope]}:*`;
}

/**
 * One call per scope. A missing key is refused up front (the API answers a
 * keyless call with a 302 to `missing_key.html`, which would otherwise read as
 * an empty dataset); a refused response is reported with its status and credential-free route.
 */
export async function fetch(
  scope: AcsScope,
  key: string | undefined,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
  options: { readonly vintage?: number; readonly stateFips?: string; readonly publishedAt?: string | null; readonly publicationUrl?: string } = {},
): Promise<AcsFetch> {
  const trimmed = (key ?? "").trim();
  if (trimmed === "") throw new Error(`${KEY_VAR} is not set; the Census Data API redirects a keyless call to missing_key.html, so nothing can be acquired without it`);
  const vintage = options.vintage ?? VINTAGE_YEAR;
  const route = new URL(`https://api.census.gov/data/${vintage}/acs/acs5`);
  route.searchParams.set("get", `NAME,GEO_ID,${VARIABLE},${MARGIN_VARIABLE}`);
  route.searchParams.set("for", geography(scope));
  if (options.stateFips) route.searchParams.set("in", `state:${options.stateFips}${scope === "county_subdivision" ? " county:*" : ""}`);
  const sourceUrl = route.toString();
  route.searchParams.set("key", trimmed);
  const url = route.toString();
  const fetchedAt = new Date().toISOString();
  const response = await censusRequest(`Census ACS ${scope}`, url, fetcher, signal);
  const text = await readPublisherBody(`Census ACS ${scope}`, () => response.text());
  signal?.throwIfAborted();
  if (response.status === 204 && options.stateFips) return { scope, url: sourceUrl, status: 204, fetchedAt,
    rows: [["NAME", VARIABLE, MARGIN_VARIABLE, "state", ...(scope === "county_subdivision" ? ["county"] : []), ACS_GEOGRAPHIES[scope]]],
    rawText: text, finalUrl: sourceUrl, vintage, publishedAt: options.publishedAt ?? null };
  if (response.status !== 200) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `Census ACS ${scope} answered HTTP ${response.status} (${sourceUrl}).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `Census ACS ${scope} answered 200 with invalid JSON.`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || !parsed.every(Array.isArray)) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `Census ACS ${scope} answered 200 without the API's row array.`,
    );
  }
  const final = new URL(response.url || BASE);
  final.searchParams.delete("key");
  return { scope, url: sourceUrl, status: response.status, fetchedAt, rows: parsed as (string | null)[][], rawText: text, finalUrl: final.toString(), vintage, publishedAt: options.publishedAt ?? null, publicationUrl: options.publicationUrl };
}

/** Census publishes 500 keyless queries/day; keyed bulk queries need no local-site pacing.
 * Only provider backpressure delays a request. Response text never enters errors. */
export async function censusRequest(label: string, url: string, fetcher: typeof globalThis.fetch, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await requestPublisher(label, () => fetcher(url, { redirect: "manual", headers: { accept: "application/json" }, signal }));
    if ((response.status !== 429 && response.status < 500) || attempt === 3) return response;
    const retry = response.headers.get("retry-after");
    const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : null;
    const date = retry ? Date.parse(retry) : NaN;
    const delay = seconds ?? (Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000 * 2 ** attempt);
    await response.body?.cancel();
    const { setTimeout } = await import("node:timers/promises");
    await setTimeout(delay, undefined, { signal });
  }
}

/**
 * A published margin, or null for one the Bureau did not state.
 *
 * Every ACS jam value is negative (`-555555555`, `-333333333`, `-222222222`,
 * `-999999999` …). A margin cannot be negative, so the sign is the whole test
 * and no jam-value list has to be kept current here. A blank cell is likewise
 * "not stated", never zero.
 */
export function marginOf(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Typed rows, refusing what a population cannot be. Sorted by code. */
export function normalize(fetched: AcsFetch): AcsPopulationRow[] {
  const header = fetched.rows[0] as readonly (string | null)[];
  if (!Array.isArray(header)) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `Census ACS ${fetched.scope}: the first row is not a header array`,
    );
  }
  const nameAt = header.indexOf("NAME");
  const popAt = header.indexOf(VARIABLE);
  // The margin is optional in the header so a recorded fixture from before it
  // was acquired still normalizes — it becomes "not stated", not a fake zero.
  const moeAt = header.indexOf(MARGIN_VARIABLE);
  const codeAt = header.indexOf(ACS_GEOGRAPHIES[fetched.scope]);
  const stateAt = header.indexOf("state"), countyAt = header.indexOf("county"), geoAt = header.indexOf("GEO_ID");
  if (nameAt < 0 || popAt < 0 || codeAt < 0 || new Set(header).size !== header.length) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `Census ACS ${fetched.scope}: the header does not carry unique NAME, ${VARIABLE} and geography columns.`,
    );
  }
  const out: AcsPopulationRow[] = [];
  for (const row of fetched.rows.slice(1)) {
    if (!Array.isArray(row)) {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `Census ACS ${fetched.scope}: a data row is not an array`,
      );
    }
    if (row.length !== header.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "An ACS row has incomplete columns.");
    const localCode = String(row[codeAt] ?? "").trim();
    const stateFips = stateAt < 0 ? null : String(row[stateAt] ?? "");
    const code = ["state", "zcta", "nation"].includes(fetched.scope) ? localCode
      : `${stateFips ?? ""}${fetched.scope === "county_subdivision" ? row[countyAt] ?? "" : ""}${localCode}`;
    const raw = row[popAt];
    const population = raw === null || raw === undefined || String(raw).trim() === "" ? Number.NaN : Number(raw);
    const widths: Record<AcsScope, number> = { nation: 1, state: 2, zcta: 5, county: 5, place: 7, county_subdivision: 10,
      congressional_district: 4, state_leg_upper: 5, state_leg_lower: 5, school_unified: 7, school_elementary: 7, school_secondary: 7 };
    if (!new RegExp(`^[0-9A-Za-z-]{${widths[fetched.scope]}}$`).test(code) || !String(row[nameAt] ?? "").trim()) {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `Census ACS ${fetched.scope}: a row has an invalid geography identifier or name.`,
      );
    }
    if (!Number.isSafeInteger(population) || population < 0) {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `Census ACS ${fetched.scope}: ${code} carries a population field that is not a count.`,
      );
    }
    if (geoAt >= 0 && (fetched.scope === "nation" ? row[geoAt] !== "0100000US" : !String(row[geoAt] ?? "").endsWith(code))) {
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The ACS GEO_ID disagrees with its component FIPS identifiers.");
    }
    out.push({
      code,
      name: String(row[nameAt] ?? "").trim(),
      population,
      marginOfError: moeAt < 0 ? null : marginOf(row[moeAt]),
      ...(fetched.vintage === undefined ? {} : { geography: fetched.scope, stateFips,
        censusGeoId: geoAt < 0 ? code : String(row[geoAt] ?? ""),
        attribution: { sourceUrl: fetched.url, sourceOrg: AGENCY, sourceKind: "OFFICIAL" as const,
          ...(geoAt < 0 ? {} : { citationUrl: `https://data.census.gov/table/ACSDT5Y${fetched.vintage}.B01003?g=${encodeURIComponent(`${String(row[geoAt]).slice(0, 3)}XX00US${fetched.scope === "nation" ? "" : code}`)}` }),
          publishedAt: fetched.publishedAt ?? null, retrievedAt: fetched.fetchedAt, vintage: fetched.vintage,
          ...(fetched.publicationUrl ? { publicationUrl: fetched.publicationUrl } : {}),
          period: `${fetched.vintage - 4}–${fetched.vintage}` } }),
    });
  }
  if (new Set(out.map(row => row.code)).size !== out.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "ACS geography identifiers repeat within a table.");
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Deterministic CSV evidence for a scope; this serializer performs no write. */
export function toCsv(rows: readonly AcsPopulationRow[], scope: AcsScope): string {
  const codeHeader = scope === "zcta" ? "zcta" : "state_fips";
  const lines = [`${codeHeader},name,population,margin_of_error`];
  for (const r of rows) {
    lines.push(`${csvCell(r.code)},${csvCell(r.name)},${r.population},${r.marginOfError === null ? "" : r.marginOfError}`);
  }
  return `${lines.join("\n")}\n`;
}
