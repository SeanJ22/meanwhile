/** Publisher size is a sourced state holding, never the size of the hunt's place. */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import type { WebsiteSize, WebsiteSizeForUrl } from "../control-plane/scheduler/host-supervision.ts";

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
  const censusId = row.census_id_gidid?.trim() || row.census_id_pid6?.trim();
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

/** Read fixed-size chunks; keep one line and the requested publisher, never the state inventory. */
function* lines(path: string): Generator<string> {
  const fd = openSync(path, "r"), bytes = Buffer.alloc(64 * 1024), decoder = new StringDecoder("utf8");
  let rest = "";
  try {
    for (let length; (length = readSync(fd, bytes, 0, bytes.length, null)) > 0;) {
      rest += decoder.write(bytes.subarray(0, length));
      let end: number;
      while ((end = rest.indexOf("\n")) >= 0) {
        yield rest.slice(0, end).replace(/\r$/, "");
        rest = rest.slice(end + 1);
      }
    }
    rest += decoder.end();
    if (rest) yield rest;
  } finally { closeSync(fd); }
}

/** Exact requested host in one state's holding. Shared hosts and unread holdings stay unknown. */
export function heldPublisherSize(state: string, url: string, root = process.cwd()): HeldPublisherSize | null {
  const key = state.toLowerCase(), host = publisherHostname(url);
  if (!host || !US_JURISDICTIONS.some(j => j.slug === key)) return null;
  let found: HeldPublisherSize | null = null;
  try {
    const path = join(/* turbopackIgnore: true */ root, "data", "states", key, "reference", "publisher-sizes.jsonl");
    for (const line of lines(path)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as PublisherSizeHolding;
      if (row.state !== key || row.host !== host) continue;
      if (!found) { const { source, ...size } = row; found = { ...size, sources: [source] }; continue; }
      if (row.censusId !== found.censusId || row.kind !== found.kind) return null;
      for (const field of ["population", "students", "populationYear", "studentsYear"] as const) {
        if (found[field] != null && row[field] != null && found[field] !== row[field]) return null;
      }
      // A parent row supplies population; its dependent-school row supplies enrollment.
      const prior: PublisherSizeSource | undefined = found.sources.find(s => s.dataset === row.source.dataset);
      if (prior && prior.sha256 !== row.source.sha256) return null;
      found = { ...found, population: found.population ?? row.population, students: found.students ?? row.students,
        populationYear: found.populationYear ?? row.populationYear, studentsYear: found.studentsYear ?? row.studentsYear,
        sources: prior ? found.sources : [...found.sources, row.source] };
    }
  } catch { return null; }
  return found;
}

/** Fits S8's synchronous callback; cache only the last requested hostname. */
export function publisherSizeForState(state: string, root = process.cwd()): WebsiteSizeForUrl {
  const key = state.toLowerCase();
  if (!US_JURISDICTIONS.some(j => j.slug === key)) return () => null;
  const path = join(/* turbopackIgnore: true */ root, "data", "states", key, "reference", "publisher-sizes.jsonl");
  let lastHost: string | null = null, lastVersion = "", lastSize: HeldPublisherSize | null = null;
  return url => {
    const host = publisherHostname(url);
    if (!host) return null;
    let version: string;
    try { const stat = statSync(path); version = `${stat.ino}:${stat.mtimeMs}:${stat.size}`; }
    catch { return null; }
    if (host !== lastHost || version !== lastVersion) {
      lastHost = host; lastVersion = version; lastSize = heldPublisherSize(key, url, root);
    }
    return lastSize;
  };
}
