/**
 * Census ACS 5-year total population (B01003), by ZIP Code Tabulation Area and by state, from
 * `api.census.gov` (public domain). The API key is `CENSUS_API_KEY` in the environment and is never
 * printed. 2024 is the newest published 5-year vintage. A place or county estimate is a different
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
/** The vintage year in the request path. Changing this is a source change. */
export const VINTAGE_YEAR = 2024;
export const DATASET = "ACS 5-Year Detailed Tables, 2024 vintage (ACSDT5Y2024)";
export const DATASET_IDENTIFIER = "https://api.census.gov/data/id/ACSDT5Y2024";
export const DOCUMENTATION = "https://www.census.gov/developer/";
export const BASE = `https://api.census.gov/data/${VINTAGE_YEAR}/acs/acs5`;
export const VARIABLE = "B01003_001E";
/** The Bureau's published margin of error, at 90% confidence, for VARIABLE. */
export const MARGIN_VARIABLE = "B01003_001M";
export const KEY_VAR = "CENSUS_API_KEY";

export type AcsScope = "zcta" | "state";

export interface AcsPopulationRow {
  /** Five-digit ZCTA, or the two-digit state FIPS code. */
  readonly code: string;
  readonly name: string;
  readonly population: number;
  /**
   * The Bureau's 90%-confidence margin of error on `population`, or null when
   * the Bureau published a jam value instead of a margin. Null means "the
   * Bureau did not state one", which is a different fact from a margin of 0.
   */
  readonly marginOfError: number | null;
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
}

function geography(scope: AcsScope): string {
  return scope === "zcta" ? "zip code tabulation area:*" : "state:*";
}

/** The human name of the geography a scope tabulates, for notes and the panel. */
export const GEOGRAPHY_LABEL: Record<AcsScope, string> = {
  zcta: "ZIP Code Tabulation Area (ZCTA5)",
  state: "state, the District of Columbia and Puerto Rico",
};

/** The request URL with the key REDACTED, for logs and notes. */
export function describeUrl(scope: AcsScope): string {
  return `${BASE}?get=NAME,${VARIABLE},${MARGIN_VARIABLE}&for=${encodeURIComponent(geography(scope))}&key=<${KEY_VAR}>`;
}

/**
 * One call per scope. A missing key is refused up front (the API answers a
 * keyless call with a 302 to `missing_key.html`, which would otherwise read as
 * an empty dataset); a non-200 is thrown with the status and the first bytes
 * of the body, never swallowed.
 */
export async function fetch(
  scope: AcsScope,
  key: string | undefined,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<AcsFetch> {
  const trimmed = (key ?? "").trim();
  if (trimmed === "") throw new Error(`${KEY_VAR} is not set; the Census Data API redirects a keyless call to missing_key.html, so nothing can be acquired without it`);
  const url = `${BASE}?get=NAME,${VARIABLE},${MARGIN_VARIABLE}&for=${encodeURIComponent(geography(scope))}&key=${encodeURIComponent(trimmed)}`;
  const fetchedAt = new Date().toISOString();
  const response = await requestPublisher(`Census ACS ${scope}`, () =>
    fetcher(url, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal,
    }));
  const text = await readPublisherBody(`Census ACS ${scope}`, () => response.text());
  signal?.throwIfAborted();
  if (response.status !== 200) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `Census ACS ${scope} answered HTTP ${response.status} (${describeUrl(scope)}): ${text.slice(0, 200)}`,
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
  if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every(Array.isArray)) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `Census ACS ${scope} answered 200 with a body that is not the API's row array: ${text.slice(0, 200)}`,
    );
  }
  const final = new URL(response.url || BASE);
  final.searchParams.delete("key");
  return { scope, url: describeUrl(scope), status: response.status, fetchedAt, rows: parsed as (string | null)[][], rawText: text, finalUrl: final.toString() };
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
  const codeAt = header.length - 1;
  if (nameAt < 0 || popAt < 0) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `Census ACS ${fetched.scope}: the header row ${JSON.stringify(header)} does not carry NAME and ${VARIABLE}`,
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
    const code = String(row[codeAt] ?? "").trim();
    const raw = row[popAt];
    const population = raw === null || raw === undefined || String(raw).trim() === "" ? Number.NaN : Number(raw);
    if (code === "") {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `Census ACS ${fetched.scope}: a row carries no geography code: ${JSON.stringify(row)}`,
      );
    }
    if (!Number.isInteger(population) || population < 0) {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `Census ACS ${fetched.scope}: ${code} carries a population of ${JSON.stringify(raw)}, which is not a count`,
      );
    }
    out.push({
      code,
      name: String(row[nameAt] ?? "").trim(),
      population,
      marginOfError: moeAt < 0 ? null : marginOf(row[moeAt]),
    });
  }
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
