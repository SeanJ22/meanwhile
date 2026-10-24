import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { GeographyType, GeographyVersion } from "./contract.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import { ScopeAccumulator, parseTab20Header, resolveTab20Columns, type Tab20Spec } from "./build.ts";
import { buildCbsaScope, parseCbsaDelineation } from "./cbsa.ts";
import { acquireGrfScopes, congressionalTarget, discoverGrfReleases, GRF_CD120, GRF_SLDU2026, GRF_SLDL2026, legislativeTarget, planApplicability, type GrfTarget } from "./grf.ts";
import { CENSUS_ACQUISITION_PARSER, censusDirectoryFiles, censusSourceRelease, heldSourcesUnchanged, sourceValidator, type CensusSourceOptions } from "./source-release.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { acquireTigerScopes, discoverTigerDistrictFiles } from "./tiger-acquire.ts";

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

export const DEFAULT_SCOPES: readonly string[] = ["cd119", "county", "cbsa", "sldu", "sldl", "cd120", "sldu2026", "sldl2026"];
const GRF_SCOPES: Readonly<Record<string, GrfTarget>> = { cd120: GRF_CD120, sldu2026: GRF_SLDU2026, sldl2026: GRF_SLDL2026 };

export interface AcquireOptions extends CensusSourceOptions {
  readonly only?: readonly string[];
  readonly states?: ReadonlySet<string>;
  /** The last promoted dataset supplies validated parsed rows when source files are unchanged. */
  readonly previousDataset?: BuiltDataset;
  /** Routine refresh discovers newly published plans; explicit --only builds can keep their requested scopes. */
  readonly discoverPlans?: boolean;
}

async function buildScope(src: Source, options: AcquireOptions): Promise<BuiltScope> {
  const held = options.previousDataset?.coverage.startsWith("national") ? options.previousDataset.scopes.find(scope =>
    scope.version === src.version && scope.type === src.type && scope.versionMeta.retrievalComplete !== false &&
    scope.versionMeta.provenance.sourceDataset === "CENSUS_TAB20_REL2020" && scope.versionMeta.provenance.sourceUrls.includes(src.url)) : undefined;
  if (held && await heldSourcesUnchanged(held.versionMeta.provenance, [src.url], options)) return held;
  const filename = src.url.split("/").pop() ?? src.url;
  const parse = (bytes: Uint8Array): ScopeAccumulator => {
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    const header = parseTab20Header(lines.shift() ?? "");
    const columns = resolveTab20Columns(header, src.geoTag);
    const acc = new ScopeAccumulator(src, columns);
    for (const line of lines) {
      if (line.trim() === "") continue;
      const fields = line.split("|");
      if (fields.length !== header.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `tab20 malformed row in ${src.url}`);
      if (options.states && !options.states.has(fields[columns.geoGeoid]?.slice(0, 2))) continue;
      acc.add(fields);
    }
    if (acc.stats().rows === 0) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `tab20 returned no rows from ${src.url}`);
    return acc;
  };
  let parsed: ScopeAccumulator | undefined;
  const source = await censusSourceRelease(src.url, options, bytes => { parsed = parse(bytes); });
  const versionMeta: GeographyVersion = {
    key: src.version, type: src.type as GeographyType, plan: src.plan, zctaTabulation: "2020", effectiveFor: src.effectiveFor,
    applicability: planApplicability(src.version), retrievalComplete: true,
    provenance: {
      sourceUrls: [src.url], sourceDataset: "CENSUS_TAB20_REL2020", sourceFiles: [filename], sourceChecksums: [source.sha256],
      sourceValidators: [sourceValidator(source)], parserVersion: CENSUS_ACQUISITION_PARSER,
      method: `Census 2020-tabulation ZCTA↔${src.geoTag.replace(/_20$/, "")} relationship file (${filename}); ` +
        `a ZCTA is an edge if it shares any land; area share = AREALAND_PART / AREALAND_ZCTA5_20 (no population weight).`,
      computedAt: new Date().toISOString(),
    },
  };
  return (parsed ?? parse(source.bytes)).finish(versionMeta);
}

/** Discover the exact ZCTA relationship publication for new TIGER district plans. */
export async function discoverDistrictSources(options: CensusSourceOptions): Promise<readonly Source[]> {
  const directory = `${REL}/cd-sld/`;
  return (await censusDirectoryFiles(directory, options)).flatMap(url => {
    const match = /^tab20_(cd|sldu|sldl)(\d+)20_zcta520_natl\.txt$/.exec(url.slice(directory.length));
    if (!match) return [];
    const [family, number] = [match[1], Number(match[2])];
    if (number < (family === "cd" ? 119 : 2024)) return [];
    const target = family === "cd" ? congressionalTarget(number) : legislativeTarget(family === "sldu" ? "SLDUST" : "SLDLST", number);
    return [{ type: target.type, version: target.version, geoTag: `${family.toUpperCase()}${number}_20`,
      labelSuffix: target.labelSuffix, plan: target.plan, effectiveFor: target.effectiveFor, url }];
  });
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
  const discover = options.discoverPlans ?? options.only === undefined;
  const sources = new Map<string, Source>();
  for (const key of keys) {
    if (key === "cbsa" || key in GRF_SCOPES) continue;
    const source = CENSUS_GEO_SOURCES[key];
    if (!source) throw new Error(`unknown census-geography source "${key}"; known: ${Object.keys(CENSUS_GEO_SOURCES).join(", ")}, cbsa, ${Object.keys(GRF_SCOPES).join(", ")}`);
    sources.set(source.version, source);
  }
  const tigerFiles = discover ? await discoverTigerDistrictFiles(options, options.states) : [];
  if (discover) for (const source of await discoverDistrictSources(options)) sources.set(source.version, source);

  // Each routine publication retains established older plans while adding their successors.
  const scopes = new Map<string, BuiltScope>();
  if (discover) for (const scope of options.previousDataset?.scopes ?? []) scopes.set(scope.version, scope);
  for (const source of sources.values()) scopes.set(source.version, await buildScope(source, options));

  if (keys.includes("cbsa")) {
    const countyFull = scopes.get("county:2020") ?? await buildScope(CENSUS_GEO_SOURCES.county, options);
    const source = await censusSourceRelease(CBSA_DELINEATION.url, options, bytes => { parseCbsaDelineation(Buffer.from(bytes)); });
    const metadata = cbsaVersionMeta(countyFull, CBSA_DELINEATION.url, source.sha256);
    const cbsa = buildCbsaScope(countyFull, parseCbsaDelineation(Buffer.from(source.bytes)), {
      ...metadata, provenance: { ...metadata.provenance, parserVersion: CENSUS_ACQUISITION_PARSER,
        sourceValidators: [sourceValidator(source), ...countyFull.versionMeta.provenance.sourceValidators ?? []] },
    });
    scopes.set(cbsa.version, cbsa);
  }

  const targets = keys.flatMap(key => GRF_SCOPES[key] ? [GRF_SCOPES[key]] : []);
  if (targets.length > 0 || discover) {
    const release = discover ? (await discoverGrfReleases(options))[0] : undefined;
    const built = await acquireGrfScopes(discover ? [GRF_CD120, GRF_SLDU2026, GRF_SLDL2026] : targets, {
      ...options, release, previousScopes: options.previousDataset?.scopes,
    });
    for (const scope of built) scopes.set(scope.version, scope);
  }
  if (tigerFiles.length) {
    let countyScope: Promise<BuiltScope> | undefined;
    const tigerScopes = await acquireTigerScopes(tigerFiles, { ...options, heldScopes: [...scopes.values()],
      stateZctas: async stateFips => {
        countyScope ??= Promise.resolve(scopes.get("county:2020") ?? buildScope(CENSUS_GEO_SOURCES.county, options));
        const county = await countyScope;
        return new Set(county.groupings.filter(group => group.stateFips === stateFips).flatMap(group => group.overlaps.map(overlap => overlap.zcta5)));
      },
    });
    for (const scope of tigerScopes) scopes.set(scope.version, scope);
  }

  const selected = [...scopes.values()].map(scope => options.states
    ? scope.type === "cbsa" ? filterCbsaByStates(scope, options.states) : filterScopeByStates(scope, options.states)
    : scope);
  const zctaUniverse = new Set<string>();
  for (const scope of selected) for (const grouping of scope.groupings) for (const overlap of grouping.overlaps) zctaUniverse.add(overlap.zcta5);
  const coverage = options.states
    ? `priority batch: ${options.states.size} state(s) [${[...options.states].sort().join(",")}]; ${selected.length} type(s): ${selected.map(scope => scope.version).join(", ")}`
    : `national; ${selected.length} geography type(s): ${selected.map(scope => scope.version).join(", ")}`;
  return { formatVersion: 1, builtAt: new Date().toISOString(), coverage, scopes: selected, zctaUniverse: [...zctaUniverse].sort() };
}
