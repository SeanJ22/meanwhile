import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { websiteOf } from "../control-plane/website-pacing.ts";
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
function publisherWebsite(value: string): string | null {
  const host = publisherHostname(value);
  return host ? websiteOf(`https://${host}`) : null;
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

function mergePublisherSize(found: HeldPublisherSize | null | undefined, row: PublisherSizeHolding): HeldPublisherSize | null {
  if (found === null) return null;
  if (!found) { const { source, ...size } = row; return { ...size, sources: [source] }; }
  if (row.censusId !== found.censusId || row.kind !== found.kind) return null;
  for (const field of ["population", "students", "populationYear", "studentsYear"] as const) {
    if (found[field] != null && row[field] != null && found[field] !== row[field]) return null;
  }
  const prior = found.sources.find(source => source.dataset === row.source.dataset);
  if (prior && prior.sha256 !== row.source.sha256) return null;
  return { ...found, population: found.population ?? row.population, students: found.students ?? row.students,
    populationYear: found.populationYear ?? row.populationYear, studentsYear: found.studentsYear ?? row.studentsYear,
    sources: prior ? found.sources : [...found.sources, row.source] };
}

let heldStateIndex: { path: string; version: string; hosts: Map<string, HeldPublisherSize | null> } | undefined;
function publisherStateIndex(state: string, root: string): ReadonlyMap<string, HeldPublisherSize | null> | null {
  const path = join(/* turbopackIgnore: true */ root, "data", "states", state, "reference", "publisher-sizes.jsonl");
  try {
    const stat = statSync(path), version = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
    if (heldStateIndex?.path === path && heldStateIndex.version === version) return heldStateIndex.hosts;
    heldStateIndex = undefined;
    const hosts = new Map<string, HeldPublisherSize | null>();
    for (const line of lines(path)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as PublisherSizeHolding;
      const host = publisherWebsite(row.host);
      if (row.state === state && host) hosts.set(host, mergePublisherSize(hosts.get(host), { ...row, host }));
    }
    heldStateIndex = { path, version, hosts };
    return hosts;
  } catch { heldStateIndex = undefined; return null; }
}

export function heldPublisherSize(state: string, url: string, root = process.cwd()): HeldPublisherSize | null {
  const key = state.toLowerCase(), host = publisherWebsite(url);
  if (!host || !US_JURISDICTIONS.some(j => j.slug === key)) return null;
  return publisherStateIndex(key, root)?.get(host) ?? null;
}

export function publisherSizeForState(state: string, root = process.cwd()): WebsiteSizeForUrl {
  const key = state.toLowerCase();
  if (!US_JURISDICTIONS.some(j => j.slug === key)) return () => null;
  return url => heldPublisherSize(key, url, root);
}
