/**
 * Acquire + build the ZCTA↔geography overlap dataset from Census tab20
 * relationship files, entirely in memory. No filesystem writes: this module is
 * on the standing runner's routine acquisition path, where the civic-data
 * firewall forbids a reachable filesystem writer. The routine refresh command
 * and the local build script both call `acquireDataset`.
 */
import { createHash } from "node:crypto";

import type { GeographyType, GeographyVersion } from "./contract.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import { ScopeAccumulator, parseTab20Header, resolveTab20Columns, type Tab20Spec } from "./build.ts";

const REL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020";

function userAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  return `we-the-people census-geography importer (${contact ? `contact: ${contact}` : "https://github.com/SeanJ22/we-the-people"})`;
}

interface Source extends Tab20Spec {
  readonly url: string;
  readonly plan: string;
  readonly effectiveFor: string;
}

/** The direct national ZCTA relationship files, one per geography type. */
export const CENSUS_GEO_SOURCES: Record<string, Source> = {
  cd119: {
    type: "congressional_district", version: "cd:119", geoTag: "CD119_20", labelSuffix: "(119th Congress)",
    url: `${REL}/cd-sld/tab20_cd11920_zcta520_natl.txt`,
    plan: "119th Congress", effectiveFor: "current representation (119th Congress, 2025–2027)",
  },
  sldu: {
    type: "state_leg_upper", version: "sldu:2024", geoTag: "SLDU2024_20", labelSuffix: "(2024 plan)",
    url: `${REL}/cd-sld/tab20_sldu202420_zcta520_natl.txt`,
    plan: "2024 state upper-chamber plan", effectiveFor: "current state upper-chamber districts (2024 plan)",
  },
  sldl: {
    type: "state_leg_lower", version: "sldl:2024", geoTag: "SLDL2024_20", labelSuffix: "(2024 plan)",
    url: `${REL}/cd-sld/tab20_sldl202420_zcta520_natl.txt`,
    plan: "2024 state lower-chamber plan", effectiveFor: "current state lower-chamber districts (2024 plan)",
  },
  county: {
    type: "county", version: "county:2020", geoTag: "COUNTY_20",
    url: `${REL}/zcta520/tab20_zcta520_county20_natl.txt`,
    plan: "2020 counties / county-equivalents", effectiveFor: "2020-vintage counties",
  },
  place: {
    type: "place", version: "place:2020", geoTag: "PLACE_20",
    url: `${REL}/zcta520/tab20_zcta520_place20_natl.txt`,
    plan: "2020 places", effectiveFor: "2020-vintage places",
  },
  cousub: {
    type: "county_subdivision", version: "cousub:2020", geoTag: "COUSUB_20",
    url: `${REL}/zcta520/tab20_zcta520_cousub20_natl.txt`,
    plan: "2020 county subdivisions", effectiveFor: "2020-vintage county subdivisions",
  },
};

/** The default published coverage: Admin's four available primary groupings. */
export const DEFAULT_SCOPES: readonly string[] = ["cd119", "county", "sldu", "sldl"];

export interface AcquireOptions {
  /** Which source keys to build (default DEFAULT_SCOPES). */
  readonly only?: readonly string[];
  /** Restrict groupings to these 2-digit state FIPS (a priority batch). */
  readonly states?: ReadonlySet<string>;
  /** Overridable for tests so the suite never touches the network. */
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

async function streamLines(
  url: string,
  onLine: (line: string) => void,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ bytes: number; sha256: string; lastModified: string | null }> {
  const hash = createHash("sha256");
  let bytes = 0;
  const res = await fetchImpl(url, { headers: { "user-agent": userAgent() }, signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const lastModified = res.headers.get("last-modified");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      hash.update(value);
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, nl).replace(/\r$/, ""));
        buf = buf.slice(nl + 1);
      }
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) onLine(buf.replace(/\r$/, ""));
  return { bytes, sha256: hash.digest("hex"), lastModified };
}

async function buildScope(src: Source, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<BuiltScope> {
  const filename = src.url.split("/").pop() ?? src.url;
  const state: { acc: ScopeAccumulator | null } = { acc: null };
  const { sha256 } = await streamLines(src.url, (line) => {
    if (state.acc === null) {
      state.acc = new ScopeAccumulator(src, resolveTab20Columns(parseTab20Header(line), src.geoTag));
      return;
    }
    if (line.trim() === "") return;
    state.acc.add(line.split("|"));
  }, fetchImpl, signal);
  if (state.acc === null) throw new Error(`no header line read from ${src.url}`);
  const versionMeta: GeographyVersion = {
    key: src.version,
    type: src.type as GeographyType,
    plan: src.plan,
    zctaTabulation: "2020",
    effectiveFor: src.effectiveFor,
    provenance: {
      sourceUrls: [src.url],
      sourceDataset: "CENSUS_TAB20_REL2020",
      sourceFiles: [filename],
      sourceChecksums: [sha256],
      method:
        `Census 2020-tabulation ZCTA↔${src.geoTag.replace(/_20$/, "")} relationship file (${filename}); ` +
        `a ZCTA is an edge if it shares any land; area share = AREALAND_PART / AREALAND_ZCTA5_20 (no population weight).`,
      computedAt: new Date().toISOString(),
    },
  };
  return state.acc.finish(versionMeta);
}

function filterScopeByStates(scope: BuiltScope, states: ReadonlySet<string>): BuiltScope {
  const groupings = scope.groupings.filter((g) => states.has(g.stateFips));
  return {
    ...scope,
    groupings,
    instanceCount: groupings.length,
    zctaEdgeCount: groupings.reduce((n, g) => n + g.overlaps.length, 0),
  };
}

/** Fetch + build the dataset in memory. Never writes a file. */
export async function acquireDataset(options: AcquireOptions = {}): Promise<BuiltDataset> {
  const keys = options.only ?? DEFAULT_SCOPES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const scopes: BuiltScope[] = [];
  for (const key of keys) {
    const src = CENSUS_GEO_SOURCES[key];
    if (!src) throw new Error(`unknown census-geography source "${key}"; known: ${Object.keys(CENSUS_GEO_SOURCES).join(", ")}`);
    let scope = await buildScope(src, fetchImpl, options.signal);
    if (options.states) scope = filterScopeByStates(scope, options.states);
    scopes.push(scope);
  }
  const zctaUniverse = new Set<string>();
  for (const s of scopes) for (const g of s.groupings) for (const o of g.overlaps) zctaUniverse.add(o.zcta5);
  const coverage = options.states
    ? `priority batch: ${options.states.size} state(s) [${[...options.states].sort().join(",")}]; ${scopes.length} type(s): ${scopes.map((s) => s.version).join(", ")}`
    : `national; ${scopes.length} geography type(s): ${scopes.map((s) => s.version).join(", ")}`;
  return {
    formatVersion: 1,
    builtAt: new Date().toISOString(),
    coverage,
    scopes,
    zctaUniverse: [...zctaUniverse].sort(),
  };
}
