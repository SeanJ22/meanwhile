import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { GeographyType, GeographyVersion } from "./contract.ts";
import type { BuiltDataset, BuiltGrouping, BuiltScope, GeographySourceFailure } from "./dataset.ts";
import { WHOLE_THRESHOLD, ScopeAccumulator, parseTab20Header, resolveTab20Columns, type Tab20Spec } from "./build.ts";
import { parseCbsaDelineation, type CbsaDelineation } from "./cbsa.ts";
import { acquireGrfScopes, congressionalTarget, discoverGrfReleases, GRF_CD120, GRF_SLDU2026, GRF_SLDL2026, legislativeTarget, planApplicability, type GrfTarget, type GrfRelease } from "./grf.ts";
import { CENSUS_ACQUISITION_PARSER, censusDirectoryFiles, censusSourceRelease, heldSourcesUnchanged, sourceValidator, type CensusSourceOptions } from "./source-release.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { acquireTigerScopes, discoverTigerDistrictFiles, type TigerDistrictFile } from "./tiger-acquire.ts";

import type { CensusDistrictStateInput } from "./district-edge.ts";
import { acquireAiannhScope, CENSUS_AIANNH } from "./aiannh.ts";
import { acquireOverlayScopes } from "../overlay-geography/acquire.ts";
import { retainFailedSupplementalScopes } from "./supplemental-refresh.ts";

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

export const CBSA_DELINEATION = {
  version: "cbsa:2023",
  plan: "2023 OMB CBSA delineation",
  effectiveFor: "current metropolitan/micropolitan statistical areas (2023 OMB delineation)",
  url: "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx",
} as const;

export const DEFAULT_SCOPES: readonly string[] = ["cd119", "county", "cbsa", "sldu", "sldl", "cd120", "sldu2026", "sldl2026", "aiannh", "overlays"];
const GRF_SCOPES: Readonly<Record<string, GrfTarget>> = { cd120: GRF_CD120, sldu2026: GRF_SLDU2026, sldl2026: GRF_SLDL2026 };

export interface AcquireOptions extends CensusSourceOptions {
  readonly only?: readonly string[];
  readonly states?: ReadonlySet<string>;
  readonly previousDataset?: BuiltDataset;
  readonly discoverPlans?: boolean;
}

export interface AcquireStatesOptions extends Omit<AcquireOptions, "previousDataset"> {
  readonly previousStateDataset?: (state: string) => Promise<BuiltDataset | undefined>;
}

interface PartitionedSource {
  readonly source: Source;
  readonly paths: ReadonlyMap<string, string>;
  readonly allPath: string;
  readonly versionMeta: GeographyVersion;
}
interface AcquisitionContext {
  readonly sources: ReadonlyMap<string, Source>;
  readonly tigerFiles: readonly TigerDistrictFile[];
  readonly grfRelease?: GrfRelease;
  readonly partition: (source: Source) => Promise<PartitionedSource>;
  readonly unchanged: ReadonlySet<string>;
  readonly sourceChecks: Map<string, Promise<boolean>>;
  readonly cbsa?: { readonly read: (state: string) => Promise<CbsaDelineation>; readonly url: string; readonly sha256: string; readonly validator: ReturnType<typeof sourceValidator> };
}

function sourceMetadata(src: Source, source: Parameters<typeof sourceValidator>[0]): GeographyVersion {
  const filename = src.url.split("/").pop() ?? src.url;
  return {
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
}

function* byteLines(bytes: Uint8Array): Generator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    pending += decoder.decode(bytes.subarray(offset, offset + 65536), { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      yield pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
    }
  }
  pending += decoder.decode();
  if (pending) yield pending.replace(/\r$/, "");
}

function validateSource(bytes: Uint8Array, src: Source): void {
  const lines = byteLines(bytes);
  const header = parseTab20Header(lines.next().value ?? "");
  resolveTab20Columns(header, src.geoTag);
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.split("|").length !== header.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `tab20 malformed row in ${src.url}`);
    count++;
  }
  if (!count) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `tab20 returned no rows from ${src.url}`);
}

interface TemporarySourceFile {
  readonly path: string;
  append(bytes: string | Uint8Array): Promise<void>;
  finish(): Promise<void>;
  dispose(): Promise<void>;
}

async function temporarySourceFile(files: TemporarySourceFile[]): Promise<TemporarySourceFile> {
  const stagingRoot = await mkdtemp(join(tmpdir(), "meanwhile-census-source-"));
  const stagingPath = join(stagingRoot, "source.data");
  const output = createWriteStream(stagingPath, { flags: "wx" });
  const completion = finished(output);
  void completion.catch(() => {});
  const file: TemporarySourceFile = {
    path: stagingPath,
    async append(bytes) {
      if (output.errored) throw output.errored;
      if (!output.write(bytes)) await once(output, "drain");
    },
    async finish() { output.end(); await completion; },
    async dispose() { output.destroy(); await completion.catch(() => {}); await rm(stagingRoot, { recursive: true, force: true }); },
  };
  files.push(file);
  return file;
}

async function partitionSource(src: Source, files: TemporarySourceFile[], options: CensusSourceOptions): Promise<PartitionedSource> {
  const source = await censusSourceRelease(src.url, options, bytes => validateSource(bytes, src));
  const national = await temporarySourceFile(files);
  await national.append(source.bytes);
  await national.finish();
  const lines = byteLines(source.bytes);
  const rawHeader = lines.next().value ?? "";
  const header = parseTab20Header(rawHeader), columns = resolveTab20Columns(header, src.geoTag);
  const writers = new Map<string, TemporarySourceFile>(), paths = new Map<string, string>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split("|"), geoid = fields[columns.geoGeoid]?.trim() ?? "";
    if (!geoid) continue;
    const state = geoid.slice(0, 2);
    if (!FIPS_TO_STATE[state]) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `tab20 geography has unknown state ${geoid}`);
    let writer = writers.get(state);
    if (!writer) {
      writer = await temporarySourceFile(files); writers.set(state, writer); paths.set(state, writer.path);
      await writer.append(`${rawHeader}\n`);
    }
    await writer.append(`${line}\n`);
  }
  for (const writer of writers.values()) await writer.finish();
  return { source: src, paths, allPath: national.path, versionMeta: sourceMetadata(src, source) };
}

async function parsePartition(partition: PartitionedSource, state: string): Promise<BuiltScope> {
  const path = partition.paths.get(state);
  const meta = { ...partition.versionMeta, states: [FIPS_TO_STATE[state].postal] };
  if (!path) return { type: partition.source.type, version: partition.source.version, versionMeta: meta,
    fractionBasis: "area", groupings: [], instanceCount: 0, zctaEdgeCount: 0 };
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let acc: ScopeAccumulator | undefined;
  for await (const line of lines) {
    if (!acc) { acc = new ScopeAccumulator(partition.source, resolveTab20Columns(parseTab20Header(line), partition.source.geoTag)); continue; }
    if (line.trim()) acc.add(line.split("|"));
  }
  if (!acc) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `tab20 partition has no header: ${state}`);
  return acc.finish(meta);
}

async function buildScope(src: Source, options: AcquireOptions, context: AcquisitionContext): Promise<BuiltScope> {
  const held = options.previousDataset?.scopes.find(scope => scope.version === src.version && scope.type === src.type &&
    scope.versionMeta.retrievalComplete !== false && scope.versionMeta.provenance.sourceDataset === "CENSUS_TAB20_REL2020" &&
    scope.versionMeta.provenance.sourceUrls.includes(src.url));
  if (held && context.unchanged.has(src.version)) return held;
  return parsePartition(await context.partition(src), [...options.states!][0]);
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

async function acquisitionContext(options: AcquireStatesOptions, files: TemporarySourceFile[]): Promise<AcquisitionContext> {
  const keys = options.only ?? DEFAULT_SCOPES, discover = options.discoverPlans ?? options.only === undefined;
  const sources = new Map<string, Source>();
  for (const key of keys) {
    if (key === "cbsa" || key === "aiannh" || key === "overlays" || key in GRF_SCOPES) continue;
    const source = CENSUS_GEO_SOURCES[key];
    if (!source) throw new Error(`unknown census-geography source "${key}"`);
    sources.set(source.version, source);
  }
  if (keys.includes("cbsa")) sources.set(CENSUS_GEO_SOURCES.county.version, CENSUS_GEO_SOURCES.county);
  const tigerFiles = discover ? await discoverTigerDistrictFiles(options, options.states) : [];
  if (discover) for (const source of await discoverDistrictSources(options)) sources.set(source.version, source);
  const partitions = new Map<string, Promise<PartitionedSource>>();
  const partition = (src: Source): Promise<PartitionedSource> => {
    let found = partitions.get(src.version);
    if (!found) { found = partitionSource(src, files, options); partitions.set(src.version, found); }
    return found;
  };
  let cbsa: AcquisitionContext["cbsa"];
  if (keys.includes("cbsa")) {
    let parsed: CbsaDelineation | undefined;
    const source = await censusSourceRelease(CBSA_DELINEATION.url, options, bytes => { parsed = parseCbsaDelineation(Buffer.from(bytes)); });
    const delineation = parsed ?? parseCbsaDelineation(Buffer.from(source.bytes));
    const paths = new Map<string, string>();
    for (const state of Object.keys(FIPS_TO_STATE)) {
      const file = await temporarySourceFile(files);
      const areas = [...delineation.cbsa].filter(([, info]) => info.stateFips.has(state));
      await file.append(JSON.stringify(areas.map(([code, info]) => [code, { ...info, stateFips: [...info.stateFips] }])));
      await file.finish();
      paths.set(state, file.path);
    }
    cbsa = { read: async state => {
      const areas = JSON.parse(await readFile(paths.get(state)!, "utf8")) as [string, { title: string; cbsaClass: "metropolitan" | "micropolitan"; counties: string[]; stateFips: string[] }][];
      const cbsa = new Map(areas.map(([code, info]) => [code, { ...info, stateFips: new Set(info.stateFips) }]));
      return { cbsa, cbsaByCounty: new Map(areas.flatMap(([code, info]) => info.counties.map(county => [county, code] as const))) };
    }, url: CBSA_DELINEATION.url, sha256: source.sha256, validator: sourceValidator(source) };
  }
  const wantsGrf = keys.some(key => key in GRF_SCOPES) || discover;
  const grfRelease = wantsGrf ? (await discoverGrfReleases(options))[0] : undefined;
  return { sources, tigerFiles, partition, unchanged: new Set(), sourceChecks: new Map(), cbsa, grfRelease };
}

async function stateCbsa(county: BuiltScope, state: string, context: AcquisitionContext): Promise<BuiltScope> {
  const source = context.cbsa!;
  const delineation = await source.read(state);
  const cbsaCodes = new Set(delineation.cbsa.keys());
  const zips = new Set(county.groupings.flatMap(group => group.overlaps.map(overlap => overlap.zcta5)));
  const sums = new Map<string, Map<string, { part: number; total: number }>>();
  const partition = await context.partition(CENSUS_GEO_SOURCES.county);
  const lines = createInterface({ input: createReadStream(partition.allPath), crlfDelay: Infinity });
  let columns: ReturnType<typeof resolveTab20Columns> | undefined;
  for await (const line of lines) {
    if (!columns) { columns = resolveTab20Columns(parseTab20Header(line), CENSUS_GEO_SOURCES.county.geoTag); continue; }
    const fields = line.split("|"), zip = fields[columns.zctaGeoid]?.trim() ?? "", code = delineation.cbsaByCounty.get(fields[columns.geoGeoid]?.trim() ?? "");
    if (!code || !cbsaCodes.has(code) || !zips.has(zip)) continue;
    let overlaps = sums.get(code);
    if (!overlaps) { overlaps = new Map(); sums.set(code, overlaps); }
    const previous = overlaps.get(zip), total = Number(fields[columns.zctaAreaLand]), part = Number(fields[columns.areaLandPart]);
    if (!Number.isFinite(part) || part < 0 || !Number.isFinite(total) || total < 0 || previous && previous.total !== total) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "CBSA county relationship has invalid land measures");
    overlaps.set(zip, { part: (previous?.part ?? 0) + part, total });
  }
  const groupings: BuiltGrouping[] = [...cbsaCodes].sort().map(code => {
    const info = delineation.cbsa.get(code)!, memberFips = [...info.stateFips].sort(), primary = memberFips[0];
    return { geoid: code, ocdId: null, label: info.title, stateFips: primary, stateAbbr: FIPS_TO_STATE[primary].postal,
      memberStates: memberFips.map(fips => FIPS_TO_STATE[fips].postal), cbsaClass: info.cbsaClass,
      overlaps: [...sums.get(code) ?? []].sort(([a], [b]) => a.localeCompare(b)).map(([zcta5, { part, total }]) => {
        const fraction = total > 0 ? Math.min(1, part / total) : null;
        return { zcta5, fraction, whole: fraction !== null && fraction >= WHOLE_THRESHOLD };
      }) };
  });
  const metadata = cbsaVersionMeta(county, source.url, source.sha256);
  return { type: "cbsa", version: CBSA_DELINEATION.version, fractionBasis: "area", groupings,
    instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((sum, grouping) => sum + grouping.overlaps.length, 0),
    versionMeta: { ...metadata, states: [FIPS_TO_STATE[state].postal], provenance: { ...metadata.provenance,
      parserVersion: CENSUS_ACQUISITION_PARSER, sourceValidators: [source.validator, ...county.versionMeta.provenance.sourceValidators ?? []] } } };
}

async function acquireStateDataset(options: AcquireOptions, context: AcquisitionContext): Promise<BuiltDataset> {
  const keys = options.only ?? DEFAULT_SCOPES, discover = options.discoverPlans ?? options.only === undefined;
  const sources = context.sources;
  const scopes = new Map<string, BuiltScope>();
  if (discover) for (const scope of options.previousDataset?.scopes ?? []) scopes.set(scope.version, scope);
  for (const source of sources.values()) scopes.set(source.version, await buildScope(source, options, context));

  if (keys.includes("cbsa")) {
    const county = scopes.get("county:2020") ?? await buildScope(CENSUS_GEO_SOURCES.county, options, context);
    const held = options.previousDataset?.scopes.find(scope => scope.type === "cbsa" && scope.version === CBSA_DELINEATION.version &&
      scope.versionMeta.provenance.sourceChecksums.includes(context.cbsa!.sha256));
    scopes.set(CBSA_DELINEATION.version, held && context.unchanged.has("county:2020") ? held : await stateCbsa(county, [...options.states!][0], context));
  }

  const targets = keys.flatMap(key => GRF_SCOPES[key] ? [GRF_SCOPES[key]] : []);
  if (targets.length > 0 || discover && context.grfRelease) {
    const built = await acquireGrfScopes(discover ? [GRF_CD120, GRF_SLDU2026, GRF_SLDL2026] : targets, {
      ...options, release: context.grfRelease, previousScopes: options.previousDataset?.scopes,
    });
    for (const scope of built) scopes.set(scope.version, scope);
  }
  const tigerFiles = context.tigerFiles.filter(file => options.states!.has(file.stateFips));
  if (tigerFiles.length) {
    let countyScope: Promise<BuiltScope> | undefined;
    const tigerScopes = await acquireTigerScopes(tigerFiles, { ...options, heldScopes: [...scopes.values()],
      stateZctas: async stateFips => {
        countyScope ??= Promise.resolve(scopes.get("county:2020") ?? buildScope(CENSUS_GEO_SOURCES.county, options, context));
        const county = await countyScope;
        return new Set(county.groupings.filter(group => group.stateFips === stateFips).flatMap(group => group.overlaps.map(overlap => overlap.zcta5)));
      },
    });
    for (const scope of tigerScopes) scopes.set(scope.version, scope);
  }

  const sourceFailures: GeographySourceFailure[] = [];
  if (keys.includes("aiannh")) {
    try {
      const built = await acquireAiannhScope(options);
      if (built && built.instanceCount > 0) scopes.set(built.version, built);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      sourceFailures.push({type:"aiannh",sourceId:"census-aiannh",version:CENSUS_AIANNH.version,
        sourceUrls:[CENSUS_AIANNH.url,CENSUS_AIANNH.zctaBlockUrl,CENSUS_AIANNH.blockAssignmentBase],reason:error instanceof Error ? error.message : String(error)});
    }
  }
  const overlays = keys.includes("overlays") ? await acquireOverlayScopes(options) : undefined;
  for (const scope of overlays?.scopes ?? []) scopes.set(scope.version, scope);
  sourceFailures.push(...overlays?.failures ?? []);
  const retained = retainFailedSupplementalScopes(options.previousDataset?.scopes ?? [], [...scopes.values()], sourceFailures);
  const selected = retained;
  const zctaUniverse = new Set<string>();
  for (const scope of selected) if (scope.type !== "cbsa") for (const grouping of scope.groupings) for (const overlap of grouping.overlaps) zctaUniverse.add(overlap.zcta5);
  const coverage = `state ${[...options.states!][0]}; ${selected.length} geography types: ${selected.map(scope => scope.version).join(", ")}`;
  return { formatVersion: 1, builtAt: new Date().toISOString(), coverage, scopes: selected, ...(overlays ? {sourceDiscrepancies:overlays.reports} : {}), ...(sourceFailures.length ? {sourceFailures} : {}), zctaUniverse: [...zctaUniverse].sort() };
}

async function previousSourceContext(options: AcquireOptions, context: AcquisitionContext): Promise<AcquisitionContext> {
  const unchanged = new Set<string>();
  for (const src of context.sources.values()) {
    const held = options.previousDataset?.scopes.find(scope => scope.version === src.version && scope.type === src.type &&
      scope.versionMeta.retrievalComplete !== false && scope.versionMeta.provenance.sourceDataset === "CENSUS_TAB20_REL2020" &&
      scope.versionMeta.provenance.sourceUrls.includes(src.url));
    if (!held) continue;
    const provenance = held.versionMeta.provenance;
    const key = JSON.stringify([src.url, provenance.parserVersion, provenance.sourceValidators?.find(row => row.url === src.url)]);
    let check = context.sourceChecks.get(key);
    if (!check) {
      check = heldSourcesUnchanged(provenance, [src.url], options);
      context.sourceChecks.set(key, check);
    }
    if (await check) unchanged.add(src.version);
  }
  return { ...context, unchanged };
}

export async function acquireDataset(options: AcquireOptions = {}): Promise<BuiltDataset> {
  if (options.states?.size !== 1) throw new Error("Census geography acquisition requires exactly one state");
  const files: TemporarySourceFile[] = [];
  try {
    const context = await acquisitionContext(options, files);
    return await acquireStateDataset(options, await previousSourceContext(options, context));
  } finally { for (const file of files) await file.dispose(); }
}

async function acquirePublicationDataset(stateFips: string, options: AcquireStatesOptions, context: AcquisitionContext): Promise<BuiltDataset> {
  const state = FIPS_TO_STATE[stateFips].postal;
  const previousDataset = await options.previousStateDataset?.(state);
  const hasGrf = context.grfRelease?.files.some(url => new RegExp(`public_grfc_cur\\d{2}_${stateFips}\\.txt$`).test(url));
  const only = options.only ?? DEFAULT_SCOPES;
  const stateOptions: AcquireOptions = { ...options, states: new Set([stateFips]), previousDataset,
    ...(!hasGrf && FIPS_TO_STATE[stateFips].prefix === "territory" ? { only: only.filter(key => !(key in GRF_SCOPES)) } : {}) };
  const sourceContext = await previousSourceContext(stateOptions, context);
  return acquireStateDataset(stateOptions, !hasGrf && FIPS_TO_STATE[stateFips].prefix === "territory"
    ? { ...sourceContext, grfRelease: undefined } : sourceContext);
}

async function publishAcquiredState(stateFips: string, options: AcquireStatesOptions, context: AcquisitionContext,
  publishState: (input: CensusDistrictStateInput) => Promise<void>): Promise<void> {
  await publishState({ state: FIPS_TO_STATE[stateFips].postal, dataset: await acquirePublicationDataset(stateFips, options, context) });
}

export async function acquireStatePublications(options: AcquireStatesOptions,
  publishState: (input: CensusDistrictStateInput) => Promise<void>,
  reportStateFailure: (state: string, error: unknown) => Promise<void>): Promise<void> {
  const files: TemporarySourceFile[] = [];
  try {
    const context = await acquisitionContext(options, files);
    for (const stateFips of [...options.states ?? Object.keys(FIPS_TO_STATE)].sort()) {
      options.signal?.throwIfAborted();
      if (!FIPS_TO_STATE[stateFips]) throw new Error(`Unknown Census state ${stateFips}`);
      try {
        await publishAcquiredState(stateFips, options, context, publishState);
        options.signal?.throwIfAborted();
      } catch (error) {
        options.signal?.throwIfAborted();
        await reportStateFailure(FIPS_TO_STATE[stateFips].postal, error);
        options.signal?.throwIfAborted();
      }
    }
  } finally { for (const file of files) await file.dispose(); }
}
