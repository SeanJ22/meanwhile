/** @freshness-reads-here: dates belong to the catalog and table captures, never a replay clock. */
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { stateBase } from "../../ocd/divisions.ts";
import { readPublisherBody, sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";
import { censusRequest, fetch as fetchTable, normalize, ACS_GEOGRAPHIES, type AcsScope, type AcsFetch, type AcsPopulationRow } from "./index.ts";

const ACS_CATALOG = "https://api.census.gov/data.json";
interface AcsRelease { readonly vintage: number; readonly publishedAt: string | null; readonly publicationUrl?: string }
export interface AcsJoinTarget { readonly geography: AcsScope; readonly geoid: string; readonly divisionId: string }
export interface AcsLoadCounts { readonly state: string; readonly loaded: number; readonly joined: number; readonly unjoined: number }
export interface AcsStateLoad {
  readonly state: string;
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

/** One state's wildcard tables and exactly its touching ZCTAs. National source
 * calls are still used, but no other state's civic records enter this job. */
export async function acquireStateAcs(input: {
  readonly state: string;
  readonly key: string | undefined;
  readonly fetcher?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly targets: (stateFips: string, rows: readonly AcsPopulationRow[]) => Promise<readonly AcsJoinTarget[]>;
}): Promise<AcsStateLoad> {
  const { acsState } = await import("./publication.ts");
  const selected = acsState(input.state), fetcher = input.fetcher ?? globalThis.fetch;
  const release = await discoverAcsRelease(fetcher, input.signal);
  const read = (scope: AcsScope, codes?: readonly string[]) => fetchTable(scope, input.key, fetcher, input.signal,
    { ...release, stateFips: selected.fips, ...(codes ? { codes } : {}) });
  const base = await input.targets(selected.fips, []);
  const zipCodes = [...new Set(base.filter(target => target.geography === "zcta").map(target => target.geoid))].sort();
  if (!zipCodes.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `The held Census geography has no ZCTAs for ${selected.state}.`);
  const captures: AcsFetch[] = [];
  const normalized: AcsPopulationRow[] = [];
  const capture = async (scope: AcsScope, codes?: readonly string[]): Promise<void> => {
    const fetched = await read(scope, codes), rows = normalize(fetched);
    const expected = codes ?? (scope === "state" ? [selected.fips] : scope === "nation" ? ["1"] : undefined);
    if (expected) {
      const keys = new Set(expected);
      if (rows.length !== keys.size || rows.some(row => !keys.has(row.code))) {
        throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID",
          `Census ACS ${scope} returned ${rows.length} row(s), expected exactly the ${keys.size} requested geography identifier(s) for ${selected.state}.`);
      }
    }
    captures.push(fetched); normalized.push(...rows);
  };
  // The API's nonhierarchical ZCTA geography accepts explicit native codes.
  // Every requested native code must arrive once, including a batch's last row.
  for (let offset = 0; offset < zipCodes.length; offset += 100) await capture("zcta", zipCodes.slice(offset,offset + 100));
  for (const scope of Object.keys(ACS_GEOGRAPHIES) as AcsScope[]) if (scope !== "zcta") await capture(scope);
  const state = normalized.filter(row => row.geography === "state");
  if (state.length !== 1 || state[0].code !== selected.fips || normalized.some(row => row.stateFips && row.stateFips !== selected.fips)) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `The ACS response contains an unrelated state for ${selected.state}.`);
  }
  const held = await input.targets(selected.fips, normalized);
  const stateRoot = stateBase(selected.fips)?.base;
  const targets = [...base, ...held, ...(stateRoot ? [{ geography: "state" as const, geoid: selected.fips, divisionId: stateRoot }] : []),
    { geography: "nation" as const, geoid: "1", divisionId: "ocd-division/country:us" }];
  const rows = joinAcsRows(normalized, targets).map(row => row.geography === "nation" ? row : { ...row, stateFips: selected.fips });
  rows.sort((a,b) => `${a.geography}:${a.code}`.localeCompare(`${b.geography}:${b.code}`));
  return { state: selected.state, release, captures, rows, counts: acsLoadCounts(rows) };
}
