import type { Feature } from "../geo/shapefile.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { BuiltScope } from "./dataset.ts";
import { planApplicability } from "./grf.ts";
import { censusDirectoryFiles, heldSourcesUnchanged, type CensusSourceOptions } from "./source-release.ts";
import { buildTigerOverlapGroups, tigerDistrictPlan, type TigerDistrictPlan } from "./tiger-overlap.ts";
import { censusTigerArchive } from "./tiger-source.ts";
import { tigerFeatures } from "./tiger-shapefile.ts";

export const TIGER_ROOT = "https://www2.census.gov/geo/tiger/";
export const TIGER_ZCTA_2020 = `${TIGER_ROOT}TIGER2020/ZCTA520/tl_2020_us_zcta520.zip`;
export const TIGER_OVERLAP_PARSER = "census-tiger-overlaps/BD-02";
export interface TigerDistrictFile {
  readonly family: "cd" | "sldu" | "sldl";
  readonly stateFips: string;
  readonly url: string;
  readonly session?: number;
}
const typeOf = (family: TigerDistrictFile["family"]): BuiltScope["type"] =>
  family === "cd" ? "congressional_district" : family === "sldu" ? "state_leg_upper" : "state_leg_lower";
const invalid = (detail: string): never => { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `TIGER: ${detail}`); };

/** Publication years find files; DBF metadata establishes the actual plan.
 * Retain each state's latest file, including states absent from a new edition. */
export async function discoverTigerDistrictFiles(options: CensusSourceOptions, states?: ReadonlySet<string>): Promise<readonly TigerDistrictFile[]> {
  const directories = (await censusDirectoryFiles(TIGER_ROOT, options))
    .filter(url => /^TIGER2\d{3}\/$/.test(url.slice(TIGER_ROOT.length))).sort().reverse();
  if (!directories.length) return invalid("release listing contains no TIGER editions");
  const found = new Map<string, TigerDistrictFile>();
  for (const directory of directories) {
    // The held source register starts at these plans; earlier editions cannot
    // establish a successor to any routine district source.
    if (Number(/TIGER(\d{4})\/$/.exec(directory)![1]) < 2024) break;
    const children = await censusDirectoryFiles(directory, options);
    for (const family of ["cd", "sldu", "sldl"] as const) {
      const folder = `${directory}${family.toUpperCase()}/`;
      if (!children.includes(folder)) continue;
      for (const url of await censusDirectoryFiles(folder, options)) {
        const file = /^tl_\d{4}_(\d{2})_(cd(\d+)|sldu|sldl)\.zip$/i.exec(url.slice(folder.length));
        if (!file || !FIPS_TO_STATE[file[1]] || states && !states.has(file[1])) continue;
        const actualFamily = file[2].toLowerCase().startsWith("cd") ? "cd" : file[2].toLowerCase();
        if (actualFamily !== family) continue;
        const key = `${family}/${file[1]}`, session = file[3] ? Number(file[3]) : undefined;
        const previous = found.get(key);
        if (!previous || session !== undefined && session > (previous.session ?? 0)) {
          found.set(key, { family, stateFips: file[1], url, ...(session === undefined ? {} : { session }) });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a.stateFips.localeCompare(b.stateFips) || a.family.localeCompare(b.family));
}

function heldInState(scope: BuiltScope, stateFips: string): boolean {
  if (scope.versionMeta.retrievalComplete === false || scope.versionMeta.states && !scope.versionMeta.states.includes(FIPS_TO_STATE[stateFips].postal)) return false;
  return scope.groupings.some(group => group.stateFips === stateFips) || scope.versionMeta.provenance.sourceFiles.some(file =>
    new RegExp(`_(?:${stateFips}_(?:cd\\d+|sldu|sldl)\\.zip|${stateFips}\\.txt)$`).test(file));
}
const numberOf = (scope: Pick<BuiltScope, "version">): number => Number(scope.version.split(":")[1]) || 0;

interface TigerAcquireOptions extends CensusSourceOptions {
  readonly heldScopes: readonly BuiltScope[];
  /** Exact county relationships bound each state's ZCTA geometry read. */
  readonly stateZctas?: (stateFips: string) => Promise<ReadonlySet<string>>;
}

function joinedScope(target: TigerDistrictPlan, stateFips: string, groupings: BuiltScope["groupings"],
  district: Awaited<ReturnType<typeof censusTigerArchive>>, zctas: Awaited<ReturnType<typeof censusTigerArchive>>): BuiltScope {
  const archives = [district, zctas];
  return {
    type: target.type, version: target.version, fractionBasis: "unknown", groupings,
    instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((n, group) => n + group.overlaps.length, 0),
    versionMeta: {
      key: target.version, type: target.type, plan: target.plan, effectiveFor: target.effectiveFor, zctaTabulation: "2020",
      states: [FIPS_TO_STATE[stateFips].postal], applicability: planApplicability(target.version), retrievalComplete: true,
      provenance: {
        sourceUrls: archives.map(archive => archive.sourceValidator.url),
        sourceFiles: archives.map(archive => archive.sourceValidator.url.split("/").at(-1)!),
        sourceChecksums: archives.map(archive => archive.sha256), sourceValidators: archives.map(archive => archive.sourceValidator),
        sourceDataset: "CENSUS_TIGER_ZCTA_POLYGON", parserVersion: TIGER_OVERLAP_PARSER,
        method: "Positive surface-area polygon intersection of the source TIGER district boundaries with full-resolution 2020 ZCTA boundaries; " +
          "whole means the complete ZCTA polygon is contained in the district. Tabulated land shares are unavailable from this geometry join; fractions are unknown.",
        computedAt: new Date().toISOString(),
      },
    },
  };
}

/** Merge state files of one plan, keeping other held states and aligned source
 * evidence. A newly held state plan cannot cut off another state's old plan. */
function replaceState(previous: BuiltScope | undefined, next: BuiltScope, stateFips: string): BuiltScope {
  if (!previous) return next;
  const kept = previous.groupings.filter(group => group.stateFips !== stateFips).map(group => previous.fractionBasis === "unknown" ? group :
    { ...group, overlaps: group.overlaps.map(overlap => ({ ...overlap, fraction: null })) });
  const groupings = [...kept, ...next.groupings].sort((a, b) => a.geoid.localeCompare(b.geoid));
  const old = previous.versionMeta.provenance, fresh = next.versionMeta.provenance;
  const evidence = new Map<string, { file: string; checksum: string; validator: NonNullable<typeof fresh.sourceValidators>[number] }>();
  for (const provenance of [old, fresh]) for (const [index, url] of provenance.sourceUrls.entries()) {
    const validator = provenance.sourceValidators?.find(row => row.url === url);
    if (!validator) continue;
    if (provenance === old && new RegExp(`_${stateFips}_(?:cd\\d+|sldu|sldl)\\.zip$`).test(url)) continue;
    evidence.set(url, { file: provenance.sourceFiles[index], checksum: provenance.sourceChecksums[index], validator });
  }
  const states = new Set([...(previous.versionMeta.states ?? previous.groupings.map(group => group.stateAbbr)), ...next.versionMeta.states!]);
  return { ...next, groupings, instanceCount: groupings.length, zctaEdgeCount: groupings.reduce((n, group) => n + group.overlaps.length, 0),
    versionMeta: { ...next.versionMeta, states: [...states].sort(), provenance: { ...fresh,
      sourceDataset: old.sourceDataset === fresh.sourceDataset ? fresh.sourceDataset : "CENSUS_DISTRICT_SOURCE_FILES",
      method: `${fresh.method} Other held states retain their verified memberships from the listed state or national source files; all fractions in this combined scope are unknown.`,
      sourceUrls: [...evidence.keys()], sourceFiles: [...evidence.values()].map(row => row.file), sourceChecksums: [...evidence.values()].map(row => row.checksum),
      sourceValidators: [...evidence.values()].map(row => row.validator),
    } },
  };
}

/** Stream the national ZCTA ZIP from disk and hold only one state's district
 * polygons. The compressed ZCTA archive is opened once when a plan needs it. */
export async function acquireTigerScopes(files: readonly TigerDistrictFile[], options: TigerAcquireOptions): Promise<readonly BuiltScope[]> {
  const built = new Map<string, BuiltScope>();
  const checks = new Map<string, Promise<boolean>>();
  let zctaArchive: Awaited<ReturnType<typeof censusTigerArchive>> | undefined;
  const unchanged = (scope: BuiltScope, url: string): Promise<boolean> => {
    const validator = scope.versionMeta.provenance.sourceValidators?.find(row => row.url === url);
    const key = JSON.stringify(validator ?? { url });
    let check = checks.get(key);
    if (!check) { check = heldSourcesUnchanged(scope.versionMeta.provenance, [url], options, TIGER_OVERLAP_PARSER); checks.set(key, check); }
    return check;
  };
  try {
    for (const file of files) {
      options.signal?.throwIfAborted();
      const held = options.heldScopes.filter(scope => scope.type === typeOf(file.family) && heldInState(scope, file.stateFips));
      const latest = Math.max(0, ...held.map(numberOf));
      const previous = held.find(scope => scope.versionMeta.provenance.parserVersion === TIGER_OVERLAP_PARSER && scope.versionMeta.provenance.sourceUrls.includes(file.url));
      if (file.session !== undefined && file.session <= latest && !previous) continue;
      if (previous && await unchanged(previous, file.url) && await unchanged(previous, TIGER_ZCTA_2020)) {
        if (!built.has(previous.version)) built.set(previous.version, previous);
        continue;
      }
      const parsed: { features: Feature[]; target: TigerDistrictPlan | null } = { features: [], target: null };
      const district = await censusTigerArchive(file.url, options, async path => {
        parsed.features = [];
        for await (const feature of tigerFeatures(path, undefined, options.signal)) {
          if (feature.properties.STATEFP !== file.stateFips) return invalid("district file contains another state's record");
          parsed.features.push(feature);
        }
        parsed.target = tigerDistrictPlan(parsed.features, file.family, file.url);
      });
      try {
        const target = parsed.target;
        if (!target) continue;
        // The complete GRF/tab20 source already supplies this state's plan.
        if (Number(target.version.split(":")[1]) <= latest && !held.some(scope => scope.version === target.version && scope.versionMeta.provenance.parserVersion === TIGER_OVERLAP_PARSER)) continue;
        if (!zctaArchive) zctaArchive = await censusTigerArchive(TIGER_ZCTA_2020, options, async path => {
          let count = 0;
          for await (const feature of tigerFeatures(path, undefined, options.signal)) {
            if (!/^\d{5}$/.test(feature.properties.ZCTA5CE20 ?? "")) return invalid("2020 ZCTA file lacks its source identifiers");
            count++;
          }
          if (!count) return invalid("2020 ZCTA file contains no polygons");
        });
        const wanted = await options.stateZctas?.(file.stateFips);
        const groupings = await buildTigerOverlapGroups(parsed.features, tigerFeatures(zctaArchive.path, wanted, options.signal), target, file.stateFips, options.signal);
        if (!groupings.some(group => group.overlaps.length)) return invalid(`district file supplies no ZCTA overlaps for ${file.stateFips}`);
        const next = joinedScope(target, file.stateFips, groupings, district, zctaArchive);
        const base = built.get(next.version) ?? options.heldScopes.find(scope => scope.version === next.version);
        built.set(next.version, replaceState(base, next, file.stateFips));
      } finally { await district.dispose(); }
    }
    return [...built.values()];
  } finally { await zctaArchive?.dispose(); }
}
