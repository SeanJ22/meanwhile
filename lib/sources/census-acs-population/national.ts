/** @freshness-reads-here: dates belong to the catalog and table captures, never a replay clock. */
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { stateBase } from "../../ocd/divisions.ts";
import { readPublisherBody, sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";
import { censusRequest, fetch as fetchTable, normalize, ACS_GEOGRAPHIES, type AcsScope, type AcsFetch, type AcsPopulationRow } from "./index.ts";

const ACS_CATALOG = "https://api.census.gov/data.json";
interface AcsRelease { readonly vintage: number; readonly publishedAt: string | null; readonly publicationUrl?: string }
export interface AcsJoinTarget { readonly geography: AcsScope; readonly geoid: string; readonly divisionId: string }
export interface AcsLoadCounts { readonly state: string; readonly loaded: number; readonly joined: number; readonly unjoined: number }
export interface AcsNationalLoad {
  readonly release: AcsRelease;
  readonly captures: readonly AcsFetch[];
  readonly rows: readonly AcsPopulationRow[];
  readonly counts: readonly AcsLoadCounts[];
}

/** Match the exact detailed five-year product, excluding profiles, one-year and supplemental datasets. */
export function latestAcsRelease(value: unknown): AcsRelease {
  const datasets = (value as { dataset?: unknown })?.dataset;
  if (!Array.isArray(datasets)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The Census catalog has no dataset list.");
  const releases = datasets.flatMap(row => {
    if (JSON.stringify(row.c_dataset) !== '["acs","acs5"]' || !Number.isInteger(row.c_vintage)) return [];
    // Catalog modified dates describe catalog editing, often before release.
    const raw = row.issued;
    const date = typeof raw === "string" ? Date.parse(raw) : NaN;
    return [{ vintage: row.c_vintage as number, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null }];
  }).sort((a, b) => b.vintage - a.vintage);
  if (!releases.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The Census catalog has no ACS five-year detailed release.");
  return releases[0];
}

async function discoverAcsRelease(fetcher: typeof globalThis.fetch = globalThis.fetch, signal?: AbortSignal): Promise<AcsRelease> {
  const response = await censusRequest("Census ACS catalog", ACS_CATALOG, fetcher, signal);
  if (response.status !== 200) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `The Census catalog answered HTTP ${response.status}.`);
  const text = await readPublisherBody("Census ACS catalog", () => response.text());
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The Census catalog is not JSON."); }
  const release = latestAcsRelease(value);
  const publicationUrl = `https://www.census.gov/programs-surveys/acs/news/data-releases/${release.vintage}/release-schedule.html`;
  const schedule = await censusRequest("Census ACS release schedule", publicationUrl, fetcher, signal);
  if (schedule.status !== 200) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `The ACS release schedule answered HTTP ${schedule.status}.`);
  const html = await readPublisherBody("Census ACS release schedule", () => schedule.text());
  return { vintage: release.vintage, publishedAt: acsPublicationDate(html), publicationUrl };
}

/** The dated table row for the five-year data release, excluding the later PUMS release. */
export function acsPublicationDate(html: string): string {
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const text = match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    if (!/5-Year Data Release/i.test(text)) continue;
    const date = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/)?.[0];
    if (date && Number.isFinite(Date.parse(`${date} UTC`))) return new Date(Date.parse(`${date} UTC`)).toISOString();
  }
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The ACS release schedule has no dated five-year data release row.");
}

/** A Census GEOID is unique only within its geography. Names never participate in this join. */
export function joinAcsRows(rows: readonly AcsPopulationRow[], targets: readonly AcsJoinTarget[]): AcsPopulationRow[] {
  const byKey = new Map<string, Set<string>>();
  for (const target of targets) {
    const key = `${target.geography}:${target.geoid}`;
    const ids = byKey.get(key) ?? new Set<string>();
    ids.add(target.divisionId); byKey.set(key, ids);
  }
  return rows.map(row => ({ ...row, divisionIds: [...(byKey.get(`${row.geography}:${row.code}`) ?? [])].sort() }));
}

export function acsLoadCounts(rows: readonly AcsPopulationRow[]): AcsLoadCounts[] {
  const byState = new Map<string, { state: string; loaded: number; joined: number; unjoined: number }>();
  for (const row of rows) {
    const state = row.stateFips ? FIPS_TO_STATE[row.stateFips]?.postal ?? row.stateFips : row.geography === "nation" ? "US" : "Unassigned ZCTAs";
    const count = byState.get(state) ?? { state, loaded: 0, joined: 0, unjoined: 0 };
    count.loaded++; if (row.divisionIds?.length) count.joined++; else count.unjoined++;
    byState.set(state, count);
  }
  return [...byState.values()].sort((a, b) => a.state.localeCompare(b.state));
}

/** Bulk wildcard tables, never one request per government. Concurrency bounds memory;
 * provider Retry-After is the only request pacing. A failed table refuses replacement of the LKG. */
export async function acquireNationalAcs(input: {
  readonly key: string | undefined;
  readonly fetcher?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly targets: (stateFips: string, rows: readonly AcsPopulationRow[]) => Promise<readonly AcsJoinTarget[]>;
}): Promise<AcsNationalLoad> {
  const fetcher = input.fetcher ?? globalThis.fetch;
  const release = await discoverAcsRelease(fetcher, input.signal);
  const read = (scope: AcsScope, stateFips?: string) => fetchTable(scope, input.key, fetcher, input.signal, { ...release, stateFips });
  const initial = await Promise.allSettled([read("zcta"), read("state"), read("nation")]);
  const captures: AcsFetch[] = initial.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
  const stateRows = normalize(captures[1]);
  const rows: AcsPopulationRow[] = [];
  const zipTargets: AcsJoinTarget[] = [];
  const queue = [...stateRows];
  const worker = async () => {
    for (let state = queue.pop(); state; state = queue.pop()) {
      const scopes = (Object.keys(ACS_GEOGRAPHIES) as AcsScope[]).filter(scope => !["zcta", "state", "nation"].includes(scope));
      const settled = await Promise.allSettled(scopes.map(scope => read(scope, state.code)));
      const tables = settled.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
      const normalized = tables.flatMap(normalize);
      const held = await input.targets(state.code, normalized);
      zipTargets.push(...held.filter(target => target.geography === "zcta"));
      const base = stateBase(state.code)?.base;
      const targets = [...held, ...(base ? [{ geography: "state" as const, geoid: state.code, divisionId: base }] : [])];
      rows.push(...joinAcsRows([state, ...normalized], targets));
      captures.push(...tables);
    }
  };
  const workers = await Promise.allSettled(Array.from({ length: Math.min(4, queue.length) }, worker));
  for (const result of workers) if (result.status === "rejected") throw result.reason;
  rows.push(...joinAcsRows(normalize(captures[0]), zipTargets), ...joinAcsRows(normalize(captures[2]), [{ geography: "nation", geoid: "1", divisionId: "ocd-division/country:us" }]));
  rows.sort((a, b) => `${a.geography}:${a.code}`.localeCompare(`${b.geography}:${b.code}`));
  captures.sort((a, b) => a.url.localeCompare(b.url));
  return { release, captures, rows, counts: acsLoadCounts(rows) };
}
