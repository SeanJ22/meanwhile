import { sourceContentHash, type SourceHashConfirmation, confirmSourceHashUnchanged } from "../civic-data/source-hash.ts";
import type { UnchangedConfirmationRetrieval } from "../civic-data/unchanged-confirmation.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { CENSUS_GEO_PARSER_VERSION, CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_REQUIRED_VERSIONS, CENSUS_GEO_SOURCE_ID, CENSUS_GEO_SOURCE_ROUTE } from "./publication.ts";
import { CENSUS_ACQUISITION_PARSER, censusSourceRelease, type CensusSourceCapture, type CensusSourceOptions } from "./source-release.ts";
import { TIGER_OVERLAP_PARSER } from "./tiger-acquire.ts";
import type { BuiltScope } from "./dataset.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { censusTigerArchive } from "./tiger-source.ts";

export interface CensusSourceProbe {
  readonly formatVersion: 1;
  readonly dependencies: string;
  readonly sources: readonly CensusSourceCapture[];
  readonly complete: boolean;
}

/** Plan/parser/selection inputs have the same identity before any held geography row is read. */
export function censusSourceDependencies(selection: unknown): string {
  return sourceContentHash([], { parser: CENSUS_GEO_PARSER_VERSION, acquisition: CENSUS_ACQUISITION_PARSER,
    tiger: TIGER_OVERLAP_PARSER, required: CENSUS_GEO_REQUIRED_VERSIONS, selection });
}
export function censusProbeHash(probe: CensusSourceProbe): string {
  return sourceContentHash(probe.sources.map(source => ({ ...source, capture: { rawHash: source.rawHash } })), probe.dependencies);
}
export function censusSourceProbe(options: CensusSourceOptions, dependencies: string, complete: boolean): CensusSourceProbe {
  return { formatVersion: 1, dependencies, sources: [...options.sourceCaptures?.values() ?? []]
    .sort((a, b) => a.requestedUrl.localeCompare(b.requestedUrl)), complete };
}
export function validCensusSourceProbe(value: unknown): value is CensusSourceProbe {
  const probe = value as CensusSourceProbe | null;
  return probe?.formatVersion === 1 && typeof probe.dependencies === "string" && /^[a-f0-9]{64}$/.test(probe.dependencies) &&
    typeof probe.complete === "boolean" && Array.isArray(probe.sources) && probe.sources.length > 0 &&
    probe.sources.every(source => typeof source?.requestedUrl === "string" && typeof source.finalUrl === "string" &&
      /^[a-f0-9]{64}$/.test(source.rawHash) && Number.isFinite(Date.parse(source.checkedAt)) &&
      (source.httpStatus === 200 || source.httpStatus === 304) &&
      [source.requestedUrl, source.finalUrl].every(address => { try { const url = new URL(address); return url.protocol === "https:" &&
        url.hostname === "www2.census.gov" && !url.username && !url.password; } catch { return false; } }));
}

/** Conditional source reads retain the already validated exact bytes; no parsed payload or event history is needed. */
export async function recheckCensusProbe(probe: CensusSourceProbe, options: CensusSourceOptions): Promise<void> {
  for (const source of probe.sources) {
    options.signal?.throwIfAborted();
    if (new URL(source.requestedUrl).pathname.endsWith(".zip")) {
      const archive = await censusTigerArchive(source.requestedUrl, options, async () => {});
      await archive.dispose();
    } else await censusSourceRelease(source.requestedUrl, options);
  }
}
export function censusProbeRetrieval(probe: CensusSourceProbe): UnchangedConfirmationRetrieval {
  const source = [...probe.sources].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0];
  if (!source) throw new Error("CENSUS_SOURCE_CHECK_MISSING");
  return { requestedUrl: CENSUS_GEO_SOURCE_ROUTE, finalUrl: CENSUS_GEO_SOURCE_ROUTE, httpStatus: 200,
    rawHash: censusProbeHash(probe), retrievedAt: source.checkedAt,
    sourceCheck: { requestedUrl: source.requestedUrl, finalUrl: source.finalUrl, rawHash: source.rawHash,
      httpStatus: source.httpStatus, checkedAt: source.checkedAt } };
}
export async function confirmCensusProbe(store: RoutineDataStore, scope: string, probe: CensusSourceProbe,
  now: string): Promise<SourceHashConfirmation | null> {
  if (!probe.sources.length) return null;
  return confirmSourceHashUnchanged({ store, sourceId: CENSUS_GEO_SOURCE_ID, recordClass: CENSUS_GEO_RECORD_CLASS, scope,
    parserVersion: CENSUS_GEO_PARSER_VERSION, rawHash: censusProbeHash(probe), complete: probe.complete, now,
    retrieval: censusProbeRetrieval(probe) });
}

/** Retained historical/state rows remain bound to the exact source bytes they were parsed from. */
export async function verifyCensusScopeSources(scopes: readonly BuiltScope[], options: CensusSourceOptions): Promise<void> {
  for (const scope of scopes) for (const [index, url] of scope.versionMeta.provenance.sourceUrls.entries()) {
    if (!options.sourceCaptures?.has(url)) {
      if (new URL(url).pathname.endsWith(".zip")) {
        const archive = await censusTigerArchive(url, options, async () => {}); await archive.dispose();
      } else await censusSourceRelease(url, options);
    }
    if (options.sourceCaptures?.get(url)?.rawHash !== scope.versionMeta.provenance.sourceChecksums[index])
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Retained Census plan source changed before its rows were rebuilt: ${scope.version} ${url}`);
  }
}
