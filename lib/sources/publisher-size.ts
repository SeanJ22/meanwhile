/** Publisher size is a sourced state holding, never the size of the hunt's place. */
import { US_JURISDICTIONS } from "../coverage/states.ts";
import type { WebsiteSize, WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";
import type { Query } from "../facts/publish.ts";

export interface PublisherSizeSource {
  readonly url: string;
  readonly dataset: string;
  readonly sha256: string;
  readonly archiveSha256: string;
  /** One-based data row in the held CSV, excluding its header. */
  readonly row: number;
  readonly sheet: string;
}

export interface PublisherSizeHolding extends WebsiteSize {
  readonly state: string;
  readonly host: string;
  readonly website: string;
  readonly censusId: string;
  readonly name: string;
  readonly populationYear: number | null;
  readonly studentsYear: number | null;
  readonly source: PublisherSizeSource;
}

export interface HeldPublisherSize extends Omit<PublisherSizeHolding, "source"> {
  readonly sources: readonly PublisherSizeSource[];
}

export function publisherHostname(value: string): string | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return /^(?:http|https):$/.test(url.protocol) ? url.hostname.toLowerCase() : null;
  } catch { return null; }
}

const count = (value: string | undefined): number | null => {
  const text = value?.trim().replace(/,/g, "") ?? "";
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
};

/** Both independent governments and their dependent school operations use the same source columns. */
export function censusPublisherSize(row: Readonly<Record<string, string>>, source: PublisherSizeSource): PublisherSizeHolding | null {
  const state = row.state?.trim().toLowerCase();
  const website = row.web_address?.trim();
  const host = website && publisherHostname(website);
  const censusId = row.census_id_pid6?.trim();
  if (!state || !US_JURISDICTIONS.some(j => j.slug === state) || !website || !host || !censusId || row.is_active !== "Y") return null;
  if (!["COUNTY", "MUNICIPAL", "TOWNSHIP", "SPECIAL DISTRICT", "SCHOOL DISTRICT", "DEPENDENT SCHOOL SYSTEM"].includes(row.gov_type)) return null;
  // Dependent systems are operations of the named parent government, not a second government.
  const kind = row.gov_type === "SCHOOL DISTRICT" ? "school-district"
    : row.gov_type === "DEPENDENT SCHOOL SYSTEM" && /^0\s*-\s*STATE/.test(row.unit_type_raw) ? "state"
    : "local-government";
  return { state, host, website, censusId, name: row.unit_name, kind,
    population: count(row.population), populationYear: count(row.population_year),
    students: count(row.enrollment), studentsYear: count(row.enrollment_year), source };
}

export interface PublisherSizeState {
  readonly rows: readonly PublisherSizeHolding[];
  readonly byHost: ReadonlyMap<string, readonly PublisherSizeHolding[]>;
}

const heldStates = new WeakMap<Query, Map<string, Promise<PublisherSizeState>>>();

/** One state's holdings, read once per database handle; only the states a job names are ever held. */
export function publisherSizeHoldings(query: Query, state: string): Promise<PublisherSizeState> {
  const key = state.toLowerCase();
  const states = heldStates.get(query) ?? new Map<string, Promise<PublisherSizeState>>();
  heldStates.set(query, states);
  const held = states.get(key);
  if (held) return held;
  const read = (US_JURISDICTIONS.some(j => j.slug === key)
    ? query("SELECT holding FROM publisher_size WHERE state = $1 ORDER BY dataset, source_row", [key])
    : Promise.resolve([])).then(found => {
    const rows = found.map(row => row.holding as PublisherSizeHolding);
    const byHost = new Map<string, PublisherSizeHolding[]>();
    for (const row of rows) byHost.set(row.host, [...byHost.get(row.host) ?? [], row]);
    return { rows, byHost };
  }).catch((error: unknown) => { states.delete(key); throw error; });
  states.set(key, read);
  return read;
}

/** The requested host's holdings in one state. Shared hosts and conflicting counts stay unknown. */
export function heldPublisherSize(state: PublisherSizeState, url: string): HeldPublisherSize | null {
  const host = publisherHostname(url);
  if (!host) return null;
  let found: HeldPublisherSize | null = null;
  for (const row of state.byHost.get(host) ?? []) {
    if (!found) { const { source, ...size } = row; found = { ...size, sources: [source] }; continue; }
    if (row.censusId !== found.censusId || row.kind !== found.kind) return null;
    for (const field of ["population", "students", "populationYear", "studentsYear"] as const) {
      if (found[field] != null && row[field] != null && found[field] !== row[field]) return null;
    }
    // Counts can merge only for the same Census publisher identity, never merely a shared host.
    const prior: PublisherSizeSource | undefined = found.sources.find(s => s.dataset === row.source.dataset);
    if (prior && prior.sha256 !== row.source.sha256) return null;
    found = { ...found, population: found.population ?? row.population, students: found.students ?? row.students,
      populationYear: found.populationYear ?? row.populationYear, studentsYear: found.studentsYear ?? row.studentsYear,
      sources: prior ? found.sources : [...found.sources, row.source] };
  }
  return found;
}

/** Fits the synchronous pacing callback: the state's holdings are read first, then each URL is answered from them. */
export async function publisherSizeForState(query: Query | null, state: string): Promise<WebsiteSizeForUrl> {
  if (query === null) return () => null;
  const held = await publisherSizeHoldings(query, state);
  return url => heldPublisherSize(held, url);
}
