/**
 * **CENSUS ACS 5-YEAR TOTAL POPULATION (B01003), BY ZIP CODE TABULATION AREA
 * AND BY STATE.** (ADM-23, the 9.4.26 evening admin feedback; re-pointed at the
 * 2024 vintage and extended with the published margin of error for ADM-41 /
 * §9A.19, the 9.6.26 feedback.)
 *
 * The owner's words in September: *"32 people"* on ZIP 85633 and *"0 people"*
 * on 85654, presented as facts. Neither number was wrong as arithmetic — both
 * were faithful ACS values — but two things about them were wrong as a
 * rendering. The vintage was a year behind what the Bureau publishes, and an
 * estimate with a margin of error wider than itself was printed as a count.
 * This adapter fixes the first and acquires the instrument that fixes the
 * second.
 *
 * ## The source, and its permission
 *
 * `api.census.gov`, the Census Bureau's own Data API — Tier A under RULING 84
 * (`docs/sources.md`, "census-acs-api"), a work of the United States
 * government, public domain. The API requires a key for anything beyond a
 * handful of daily calls; the key is `CENSUS_API_KEY` in the environment and
 * is never printed.
 *
 * ## The vintage, and why this one
 *
 * ACS 5-Year is released one vintage at a time and the newest is the only
 * honest one to render. Measured directly on 2026-09-06 with this repository's
 * key: `/data/2024/acs/acs5` answers 200 (ZCTA 85633 = 48, 85654 = 0, Arizona
 * = 7,378,838) and `/data/2025/acs/acs5` answers **404** — 2025 is not
 * published. So 2024 is the newest available for this geography and is what is
 * acquired here. There is no Population Estimates Program product for a ZCTA,
 * and a place/city or county estimate is a DIFFERENT GEOGRAPHY and is never
 * substituted for one (§9A.19).
 *
 * ## What is fetched
 *
 *   ZCTA    `get=NAME,B01003_001E,B01003_001M&for=zip code tabulation area:*`
 *           — every ZIP Code Tabulation Area the release tabulates, one call
 *   STATE   `get=NAME,B01003_001E,B01003_001M&for=state:*` — the 50 states, DC
 *           and Puerto Rico, one call
 *
 * `B01003_001M` is the Bureau's own published **margin of error at 90%
 * confidence** for the same estimate. It is acquired because it is the only
 * non-arbitrary way to say whether a small ZCTA number may be read as a count:
 * an estimate whose margin of error reaches zero is not distinguishable from
 * zero, and the panel must say so rather than print the number as a fact. A
 * threshold invented here would be a fabrication; the Bureau's own interval is
 * not.
 *
 * The API answers a margin it cannot compute with a NEGATIVE jam value
 * (`-555555555` "the estimate is controlled, a statistical test is not
 * appropriate", `-222222222` "could not be computed", and siblings). Those are
 * NOT margins and are stored as an empty cell, never as a negative number and
 * never as zero — a jam value read as `0` would claim perfect precision.
 *
 * A ZCTA is the Census's generalisation of a ZIP code: most ZIPs map to a ZCTA
 * of the same five digits; a post-office-box ZIP or a single-building ZIP has
 * none, and a ZIP with no ZCTA is a NAMED GAP downstream, never a zero
 * (RULING 159).
 *
 * ## Shape
 *
 * `fetch()` reads the API, `normalize()` turns rows into typed records and
 * refuses a non-numeric or negative ESTIMATE, `upsert()` writes the two
 * committed reference tables `data/reference/acs5_2024_b01003_zcta.csv` and
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
export async function fetch(scope: AcsScope, key: string | undefined, fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<AcsFetch> {
  const trimmed = (key ?? "").trim();
  if (trimmed === "") throw new Error(`${KEY_VAR} is not set; the Census Data API redirects a keyless call to missing_key.html, so nothing can be acquired without it`);
  const url = `${BASE}?get=NAME,${VARIABLE},${MARGIN_VARIABLE}&for=${encodeURIComponent(geography(scope))}&key=${encodeURIComponent(trimmed)}`;
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
  const nameAt = header.indexOf("NAME");
  const popAt = header.indexOf(VARIABLE);
  // The margin is optional in the header so a recorded fixture from before it
  // was acquired still normalizes — it becomes "not stated", not a fake zero.
  const moeAt = header.indexOf(MARGIN_VARIABLE);
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

/** The committed CSV text for a scope: one header, one row per geography. */
export function toCsv(rows: readonly AcsPopulationRow[], scope: AcsScope): string {
  const codeHeader = scope === "zcta" ? "zcta" : "state_fips";
  const lines = [`${codeHeader},name,population,margin_of_error`];
  for (const r of rows) {
    lines.push(`${csvCell(r.code)},${csvCell(r.name)},${r.population},${r.marginOfError === null ? "" : r.marginOfError}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Write the table. Returns the byte count written. The caller commits it. */
export function upsert(rows: readonly AcsPopulationRow[], scope: AcsScope, path: string): number {
  const text = toCsv(rows, scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return Buffer.byteLength(text, "utf8");
}
