import { normalizedHash, sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import type { CensusDistrictEdge } from "./district-edge.ts";
import {
  CENSUS_GEO_PARSER_VERSION,
  CENSUS_GEO_RECORD_CLASS,
  CENSUS_GEO_SCHEMA_VERSION,
  CENSUS_GEO_SCOPE,
  CENSUS_GEO_SOURCE_ID,
  CENSUS_GEO_SOURCE_ROUTE,
} from "./publication.ts";

export function censusGeographyCandidate(input: CensusDistrictEdge): RoutineCandidate {
  const dataset = JSON.parse(JSON.stringify(input)) as CensusDistrictEdge;
  const edges = dataset.scopes.reduce((n, s) => n + s.zctaEdgeCount, 0);
  const groupings = dataset.scopes.reduce((n, s) => n + s.instanceCount, 0);

  const checksums = dataset.scopes.flatMap((s) => s.versionMeta.provenance.sourceChecksums).sort();
  const rawHash = sha256(checksums.length > 0 ? checksums.join("\n") : normalizedHash(dataset));
  const retrievedAt = dataset.builtAt;
  const version = dataset.scopes.map((s) => s.version).sort().join("+") || "empty";

  const violations: string[] = [];
  if (dataset.scopes.length === 0) violations.push("The census-geography dataset has no scopes.");
  for (const s of dataset.scopes) {
    if (s.instanceCount === 0) violations.push(`Scope ${s.version} has no groupings.`);
    if (s.zctaEdgeCount === 0) violations.push(`Scope ${s.version} has no ZCTA overlaps.`);
  }

  const identities = Object.keys(dataset.states).sort().map(state => ({
    subjectId: `census-state:${state}:${dataset.versionId}`,
    jurisdiction: "US",
    identifiers: { type: "state", geoid: state, version: dataset.versionId },
    matchBasis: "OFFICIAL_ID" as const,
    ambiguous: false,
  }));

  const id = `cv-${sha256(`${CENSUS_GEO_SOURCE_ID}${CENSUS_GEO_SCOPE}${rawHash}${retrievedAt}`).slice(0, 32)}`;

  const readModelHash = sha256(canonicalCivicDataJson(dataset));
  const normalizedPayload = {
    formatVersion: dataset.formatVersion,
    builtAt: dataset.builtAt,
    readModelHash,
    zctaUniverseCount: dataset.zctaCount,
    sourceFailureCount: dataset.sourceFailureCount,
    sourceDiscrepancyCount: dataset.sourceDiscrepancyCount,
    scopes: dataset.scopes.map((s) => ({
      type: s.type,
      version: s.version,
      fractionBasis: s.fractionBasis,
      instanceCount: s.instanceCount,
      zctaEdgeCount: s.zctaEdgeCount,
      sourceChecksums: [...s.versionMeta.provenance.sourceChecksums].sort(),
    })),
  };

  return {
    id,
    sourceId: CENSUS_GEO_SOURCE_ID,
    recordClass: CENSUS_GEO_RECORD_CLASS,
    scope: CENSUS_GEO_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(CENSUS_GEO_SOURCE_ID, CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE),
    retrieval: {
      succeeded: true,
      requestedUrl: CENSUS_GEO_SOURCE_ROUTE,
      finalUrl: CENSUS_GEO_SOURCE_ROUTE,
      httpStatus: 200,
      retrievedAt,
      rawHash,
    },
    normalization: {
      succeeded: true,
      parserVersion: CENSUS_GEO_PARSER_VERSION,
      schemaVersion: CENSUS_GEO_SCHEMA_VERSION,
      normalizedHash: readModelHash,
      normalizedPayloadHash: sha256(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: groupings,
      outputRecords: groupings,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities,
    temporal: { version, expectedVersion: version, sourceThrough: "2020", staleAtRetrieval: false },
    semantics: {
      factKind: "ZCTA-to-geography overlaps and official representation boundary references for the exact built scopes (tabulated area shares where supplied; polygon-derived memberships carry unknown shares)",
      violations,
    },
    horizon: {
      kind: "BOUNDED",
      query: `every ZCTA overlapping each geography in scopes: ${dataset.scopes.map((s) => s.version).join(", ")}`,
      returnedRecords: groupings,
      declaredTotal: groupings,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/census-geography/district-edge.ts",
        passed: edges > 0 && groupings > 0 && identities.length > 0,
        detail: `${groupings} groupings, ${edges} ZCTA edges across ${dataset.scopes.length} scope(s).`,
      },
    ],
    normalizedPayload,
    readModel: dataset,
  };
}
