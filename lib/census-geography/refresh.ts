import { acquireDataset, type AcquireOptions } from "./acquire.ts";
import { censusGeographyCandidate } from "./candidate.ts";
import { CENSUS_GEO_CONTRACT_ID, CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_REQUIRED_VERSIONS, CENSUS_GEO_SCOPE, CENSUS_GEO_PARSER_VERSION } from "./publication.ts";
import type { BuiltDataset, BuiltScope } from "./dataset.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../civic-data/promotion.ts";
import { sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../civic-data/source-acquisition-failure.ts";
import { censusSourceDependencies, censusSourceProbe, validCensusSourceProbe, recheckCensusProbe, confirmCensusProbe, verifyCensusScopeSources } from "./source-probe.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../sources/acquisition-deadline.ts";

/** Acquire and publish through the standing door; a replay can supply an isolated store and vault. */
export async function refreshCensusGeography(store: RoutineDataStore, options: AcquireOptions = {}) {
  options = { ...options, releases: new Map(), sourceCaptures: new Map() };
  const head = await store.readSourceHead(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE);
  const dependencies = censusSourceDependencies({ only: options.only ?? null, states: options.states ? [...options.states].sort() : null, discoverPlans: true });
  const saved = head?.rawHashBasis === "SOURCE_CONTENT_V1" && head.parserVersion === CENSUS_GEO_PARSER_VERSION
    ? await store.readCandidatePath(head.versionId, ["normalizedPayload", "sourceProbe"]) : null;
  const acquired = await withPublisherAcquisitionDeadline("Census geography relationships", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, async signal => {
    options = { ...options, signal };
    if (validCensusSourceProbe(saved)) {
      await recheckCensusProbe(saved, options);
      const probe = censusSourceProbe(options, dependencies, saved.complete);
      const confirmed = await confirmCensusProbe(store, CENSUS_GEO_SCOPE, probe, new Date().toISOString());
      if (confirmed) return { confirmed, dataset: null, probe };
    }
    // A legacy head needs a complete new acquisition before any retained parsed rows can be opened.
    const fresh = validCensusSourceProbe(saved) ? null : await acquireDataset({ ...options, previousDataset: undefined, discoverPlans: true });
    let previousDataset: BuiltDataset | undefined;
    if (head) {
      const scopes = await store.readCandidatePath<readonly BuiltScope[]>(head.versionId, ["readModel", "scopes"]);
      const coverage = await store.readCandidatePath<string>(head.versionId, ["readModel", "coverage"]);
      if (scopes && coverage) previousDataset = { formatVersion: 1, builtAt: head.promotedAt, coverage, scopes, zctaUniverse: [] };
    }
    const built = previousDataset ? await acquireDataset({ ...options, previousDataset, discoverPlans: true })
      : fresh ?? await acquireDataset({ ...options, previousDataset: undefined, discoverPlans: true });
    if (!built.scopes.length || built.scopes.some(scope => !scope.zctaEdgeCount || scope.versionMeta.retrievalComplete === false))
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A census-geography scope returned zero overlaps.");
    const missing = CENSUS_GEO_REQUIRED_VERSIONS.filter(version => !built.scopes.some(scope => scope.version === version));
    if (missing.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census geography is missing required election plans: ${missing.join(", ")}`);
    await verifyCensusScopeSources(built.scopes, options);
    return { confirmed: null, dataset: { ...built, builtAt: new Date().toISOString() }, probe: censusSourceProbe(options, dependencies, true) };
  });
  if (acquired.confirmed) return { candidate: null, outcome: null, confirmed: acquired.confirmed };
  const candidate = censusGeographyCandidate(acquired.dataset!, CENSUS_GEO_SCOPE, acquired.probe);
  const outcome = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate, candidate.retrieval.retrievedAt,
    head?.versionId ?? null, { confirmUnchanged: false });
  return { candidate, outcome, confirmed: null };
}
