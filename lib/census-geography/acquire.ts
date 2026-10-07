import { createHash } from "node:crypto";

import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { GeographyType, GeographyVersion } from "./contract.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import { ScopeAccumulator, parseTab20Header, resolveTab20Columns, type Tab20Spec } from "./build.ts";
import { buildCbsaScope, parseCbsaDelineation } from "./cbsa.ts";
import { acquireGrfScope, GRF_CD120 } from "./grf.ts";
import { censusGeographyUserAgent } from "./http.ts";

const REL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020";

interface Source extends Tab20Spec {
  readonly url: string;
  readonly plan: string;
  readonly effectiveFor: string;
}

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

/**
 * The OMB metropolitan/micropolitan delineation. Census publishes it ONLY as
 * xlsx and provides no direct ZCTA↔CBSA relationship; we derive ZCTA↔CBSA from
 * this (which counties → which CBSA, metro vs micro) joined to the ZCTA↔county
 * scope. 2023 is the current delineation vintage.
 */
export const CBSA_DELINEATION = {
  version: "cbsa:2023",
  plan: "2023 OMB CBSA delineation",
  effectiveFor: "current metropolitan/micropolitan statistical areas (2023 OMB delineation)",
  url: "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx",
} as const;

export const DEFAULT_SCOPES: readonly string[] = ["cd119", "county", "cbsa", "sldu", "sldl"];

export interface AcquireOptions {
  readonly only?: readonly string[];
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
  const res = await fetchImpl(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal });
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

async function fetchBytes(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; sha256: string; lastModified: string | null }> {
  const res = await fetchImpl(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), lastModified: res.headers.get("last-modified") };
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

function filterCbsaByStates(scope: BuiltScope, states: ReadonlySet<string>): BuiltScope {
  const postals = new Set<string>();
  for (const f of states) {
    const p = FIPS_TO_STATE[f]?.postal;
    if (p) postals.add(p);
  }
  const groupings = scope.groupings.filter((g) => g.memberStates.some((p) => postals.has(p)));
  return {
    ...scope,
    groupings,
    instanceCount: groupings.length,
    zctaEdgeCount: groupings.reduce((n, g) => n + g.overlaps.length, 0),
  };
}

function cbsaVersionMeta(countyScope: BuiltScope, xlsxUrl: string, xlsxSha: string): GeographyVersion {
  const countyProv = countyScope.versionMeta.provenance;
  return {
    key: CBSA_DELINEATION.version,
    type: "cbsa",
    plan: CBSA_DELINEATION.plan,
    zctaTabulation: "2020",
    effectiveFor: CBSA_DELINEATION.effectiveFor,
    provenance: {
      sourceUrls: [xlsxUrl, ...countyProv.sourceUrls],
      sourceDataset: "OMB_CBSA_DELINEATION_2023+CENSUS_TAB20_REL2020",
      sourceFiles: [xlsxUrl.split("/").pop() ?? xlsxUrl, ...countyProv.sourceFiles],
      sourceChecksums: [xlsxSha, ...countyProv.sourceChecksums],
      method:
        "ZCTA↔CBSA derived as the whole-county union of the 2023 OMB delineation " +
        "(list1_2023.xlsx; metro=Metropolitan Statistical Area, micro=Micropolitan Statistical Area) joined " +
        "to the Census 2020 ZCTA↔county relationship (tab20). A ZCTA is an edge if it shares land with any " +
        "county of the CBSA; area share = Σ AREALAND_PART over the CBSA's counties / AREALAND_ZCTA5_20 " +
        "(no population weight).",
      computedAt: new Date().toISOString(),
    },
  };
}

export async function acquireDataset(options: AcquireOptions = {}): Promise<BuiltDataset> {
  const keys = options.only ?? DEFAULT_SCOPES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const wantCbsa = keys.includes("cbsa");

  // Build every requested tab20 scope once, UNFILTERED (the state filter is
  // applied at assembly, so a CBSA can still fold up a whole multi-state metro).
  const builtByKey = new Map<string, BuiltScope>();
  for (const key of keys) {
    if (key === "cbsa" || key === "cd120") continue;
    const src = CENSUS_GEO_SOURCES[key];
    if (!src) throw new Error(`unknown census-geography source "${key}"; known: ${Object.keys(CENSUS_GEO_SOURCES).join(", ")}, cbsa, cd120`);
    builtByKey.set(key, await buildScope(src, fetchImpl, options.signal));
  }

  // CBSA is derived from the full national ZCTA↔county scope + the OMB
  // delineation. Build county if it was not itself requested.
  let cbsaScope: BuiltScope | undefined;
  if (wantCbsa) {
    let countyFull = builtByKey.get("county");
    if (countyFull === undefined) {
      countyFull = await buildScope(CENSUS_GEO_SOURCES.county, fetchImpl, options.signal);
    }
    const { bytes, sha256 } = await fetchBytes(CBSA_DELINEATION.url, fetchImpl, options.signal);
    const delineation = parseCbsaDelineation(bytes);
    cbsaScope = buildCbsaScope(countyFull, delineation, cbsaVersionMeta(countyFull, CBSA_DELINEATION.url, sha256));
  }

  // cd:120 — the UPCOMING-ELECTION (120th Congress / 2026) congressional map,
  // sourced from the Census grf/2026 block files. Opt-in (not in DEFAULT_SCOPES):
  // the block download is large (~2.9 GB national), and the map is stable until
  // the election, so it is intended to refresh at a lower cadence than the monthly
  // tab20 refresh. State-filtered during acquisition to bound the download.
  let cd120Scope: BuiltScope | undefined;
  if (keys.includes("cd120")) {
    cd120Scope = await acquireGrfScope(GRF_CD120, { fetchImpl, states: options.states, signal: options.signal });
  }

  const scopes: BuiltScope[] = [];
  for (const key of keys) {
    let scope = key === "cbsa" ? cbsaScope : key === "cd120" ? cd120Scope : builtByKey.get(key);
    if (scope === undefined) continue;
    // cd:120 is already state-filtered during acquisition; tab20 scopes are built
    // unfiltered and filtered here.
    if (options.states && key !== "cd120") {
      scope = key === "cbsa" ? filterCbsaByStates(scope, options.states) : filterScopeByStates(scope, options.states);
    }
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
