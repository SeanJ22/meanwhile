/**
 * **CENSUS ACS 5-YEAR TOTAL POPULATION (B01003), BY ZIP CODE TABULATION AREA
 * AND BY STATE.** (ADM-23, the 9.4.26 evening admin feedback.)
 *
 * The owner's words: *"We have census data. We have a census API so
 * population on file, we should absolutely be ingesting that."* The readiness
 * panel read "population not on file — Census ACS (B01003) not yet ingested"
 * on every card and every ZIP row. This adapter is the ingest.
 *
 * ## The source, and its permission
 *
 * `api.census.gov`, the Census Bureau's own Data API — Tier A under RULING 84
 * (`docs/sources.md`, "census-acs-api"), a work of the United States
 * government, public domain. The API requires a key for anything beyond a
 * handful of daily calls; the key is `CENSUS_API_KEY` in the environment and
 * is never printed. `docs/sources.md` recorded the key INVALID on 2026-08-22;
 * re-measured 2026-09-05 it answers 200 with real data (ZCTA 85701: 5,169),
 * and that reading supersedes the old row.
 *
 * ## What is fetched
 *
 *   ZCTA    `get=NAME,B01003_001E&for=zip code tabulation area:*`  — every
 *           ZIP Code Tabulation Area in the country, ~33,772 rows, one call
 *   STATE   `get=NAME,B01003_001E&for=state:*` — the 50 states, DC and
 *           Puerto Rico, one call
 *
 * A ZCTA is the Census's generalisation of a ZIP code: most ZIPs map to a
 * ZCTA of the same five digits; a post-office-box ZIP or a single-building
 * ZIP has none, and a ZIP with no ZCTA is a NAMED GAP downstream, never a
 * zero (RULING 159).
 *
 * ## Shape
 *
 * `fetch()` reads the API, `normalize()` turns rows into typed records and
 * refuses a non-numeric or negative population, `upsert()` writes the two
 * committed reference tables `data/reference/acs5_2023_b01003_zcta.csv` and
 * `…_state.csv` (the repository's reference-data convention: a CSV plus a
 * source note, inventoried by `lib/reference/index.ts`). The readiness
 * publisher reads those tables; nothing at request time touches the API.
 *
 * @freshness-reads-here — `fetchedAt` is stamped by the call that reads the
 * source, and never restamped from a clock afterwards (RULING 107).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const AGENCY = "U.S. Census Bureau — American Community Survey";
export const DATASET = "ACS 5-Year Detailed Tables, 2023 vintage (ACSDT5Y2023)";
export const DATASET_IDENTIFIER = "https://api.census.gov/data/id/ACSDT5Y2023";
export const DOCUMENTATION = "https://www.census.gov/developer/";
export const BASE = "https://api.census.gov/data/2023/acs/acs5";
export const VARIABLE = "B01003_001E";
export const KEY_VAR = "CENSUS_API_KEY";

export type AcsScope = "zcta" | "state";

export interface AcsPopulationRow {
  /** Five-digit ZCTA, or the two-digit state FIPS code. */
  readonly code: string;
  readonly name: string;
  readonly population: number;
}

export interface AcsFetch {
  readonly scope: AcsScope;
  readonly url: string;
  readonly status: number;
  readonly fetchedAt: string;
  /** The API's own header row followed by data rows, exactly as returned. */
  readonly rows: readonly (readonly (string | null)[])[];
}

function geography(scope: AcsScope): string {
  return scope === "zcta" ? "zip code tabulation area:*" : "state:*";
}

/** The request URL with the key REDACTED, for logs and notes. */
export function describeUrl(scope: AcsScope): string {
  return `${BASE}?get=NAME,${VARIABLE}&for=${encodeURIComponent(geography(scope))}&key=<${KEY_VAR}>`;
}

/**
 * One call per scope. A missing key is refused up front (the API answers a
 * keyless call with a 302 to `missing_key.html`, which would otherwise read as
 * an empty dataset); a non-200 is thrown with the status and the first bytes
 * of the body, never swallowed.
 */
export async function fetch(scope: AcsScope, key: string | undefined, fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<AcsFetch> {
  const trimmed = (key ?? "").trim();
  if (trimmed === "") throw new Error(`${KEY_VAR} is not set; the Census Data API redirects a keyless call to missing_key.html, so nothing can be acquired without it`);
  const url = `${BASE}?get=NAME,${VARIABLE}&for=${encodeURIComponent(geography(scope))}&key=${encodeURIComponent(trimmed)}`;
  const fetchedAt = new Date().toISOString();
  const response = await fetcher(url, { redirect: "manual", headers: { accept: "application/json" } });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`Census ACS ${scope} answered HTTP ${response.status} (${describeUrl(scope)}): ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[0])) {
    throw new Error(`Census ACS ${scope} answered 200 with a body that is not the API's row array: ${text.slice(0, 200)}`);
  }
  return { scope, url: describeUrl(scope), status: response.status, fetchedAt, rows: parsed as (string | null)[][] };
}

/** Typed rows, refusing what a population cannot be. Sorted by code. */
export function normalize(fetched: AcsFetch): AcsPopulationRow[] {
  const header = fetched.rows[0] as readonly (string | null)[];
  const nameAt = header.indexOf("NAME");
  const popAt = header.indexOf(VARIABLE);
  const codeAt = header.length - 1;
  if (nameAt < 0 || popAt < 0) {
    throw new Error(`Census ACS ${fetched.scope}: the header row ${JSON.stringify(header)} does not carry NAME and ${VARIABLE}`);
  }
  const out: AcsPopulationRow[] = [];
  for (const row of fetched.rows.slice(1)) {
    const code = String(row[codeAt] ?? "").trim();
    const raw = row[popAt];
    const population = raw === null || raw === undefined || String(raw).trim() === "" ? Number.NaN : Number(raw);
    if (code === "") throw new Error(`Census ACS ${fetched.scope}: a row carries no geography code: ${JSON.stringify(row)}`);
    if (!Number.isInteger(population) || population < 0) {
      throw new Error(`Census ACS ${fetched.scope}: ${code} carries a population of ${JSON.stringify(raw)}, which is not a count`);
    }
    out.push({ code, name: String(row[nameAt] ?? "").trim(), population });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The committed CSV text for a scope: one header, one row per geography. */
export function toCsv(rows: readonly AcsPopulationRow[], scope: AcsScope): string {
  const codeHeader = scope === "zcta" ? "zcta" : "state_fips";
  const lines = [`${codeHeader},name,population`];
  for (const r of rows) lines.push(`${csvCell(r.code)},${csvCell(r.name)},${r.population}`);
  return `${lines.join("\n")}\n`;
}

/** Write the table. Returns the byte count written. The caller commits it. */
export function upsert(rows: readonly AcsPopulationRow[], scope: AcsScope, path: string): number {
  const text = toCsv(rows, scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return Buffer.byteLength(text, "utf8");
}
