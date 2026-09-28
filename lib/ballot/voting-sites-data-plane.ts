import { normalizedHash, sha256 } from "../civic-data/candidate-builders.ts";
import type { CivicRecordMember, IdentityEvidence, RoutineCandidate } from "../civic-data/types.ts";
import { sourceProjectionEvidence } from "../civic-data/types.ts";
import { COVERED_STATES, type CoveredUsps } from "../coverage/states.ts";
import type { VotingJurisdiction, VotingSitesFile } from "./voting-sites.ts";

export const VOTING_SITES_CONTRACT = {
  id: "voting-sites",
  sourceId: "voting-sites",
  recordClass: "VOTING_SITE",
  scope: "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions",
  parserVersion: "official-voting-sites/2",
} as const;

export interface VotingSiteAcquisitionFailure {
  readonly jurisdictionId?: string;
  readonly state?: CoveredUsps;
  readonly code: string;
  readonly detail: string;
}

const OFFICIAL_SOURCE_PREFIXES = [
  "https://www.pima.gov/",
  "https://cochise.az.gov/",
  "https://www.cochise.az.gov/",
  "https://services2.arcgis.com/UTBp78iglGpbqp1B/",
  "https://www.morriscountynj.gov/",
  "https://app.sos.nh.gov/",
  "https://www.sos.nh.gov/",
  "https://newlondon.nh.gov/",
  "https://www.newbury.nh.gov/",
  "https://www.wilmotnh.org/",
] as const;

function jurisdictionMetadata(jurisdiction: VotingJurisdiction): Omit<VotingJurisdiction, "sites"> {
  const { sites: _sites, ...metadata } = jurisdiction;
  return metadata;
}

export function votingSiteMembers(file: VotingSitesFile): readonly CivicRecordMember[] {
  return file.jurisdictions.flatMap((jurisdiction) => [
    { key: `jurisdiction:${jurisdiction.ocdId}`, record: jurisdictionMetadata(jurisdiction) },
    ...jurisdiction.sites.map((site) => ({ key: `site:${jurisdiction.ocdId}:${site.id}`, record: site })),
  ]).sort((left, right) => left.key.localeCompare(right.key));
}

function affected(jurisdiction: VotingJurisdiction, failure: VotingSiteAcquisitionFailure): boolean {
  return failure.jurisdictionId === jurisdiction.ocdId || failure.state === jurisdiction.state;
}

/** Preserve only the failed authority scope; healthy authorities may still advance. */
export function retainFailedVotingSiteScopes(
  current: VotingSitesFile,
  prior: VotingSitesFile | null,
  failures: readonly VotingSiteAcquisitionFailure[],
): VotingSitesFile {
  if (!prior || failures.length === 0) return structuredClone(current);
  const retained = prior.jurisdictions.filter((jurisdiction) => failures.some((failure) => affected(jurisdiction, failure)));
  const healthy = current.jurisdictions.filter((jurisdiction) => !failures.some((failure) => affected(jurisdiction, failure)));
  const fallbackWithoutLkg = current.jurisdictions.filter((jurisdiction) =>
    failures.some((failure) => affected(jurisdiction, failure)) &&
    !retained.some((priorJurisdiction) => priorJurisdiction.ocdId === jurisdiction.ocdId)
  );
  return {
    generatedAt: current.generatedAt,
    jurisdictions: [...healthy, ...retained, ...fallbackWithoutLkg]
      .sort((left, right) => left.ocdId.localeCompare(right.ocdId)),
  };
}

/** A bounded county refresh must carry every other exact promoted jurisdiction
 * forward. It cannot bootstrap a three-state pointer from one county's PDF. */
export function votingSitesScopedSuccessor(
  prior: VotingSitesFile | null,
  current: VotingJurisdiction,
  generatedAt: string,
): VotingSitesFile {
  if (!prior || prior.jurisdictions.length === 0) throw new Error("VOTING_SITES_SCOPED_BASE_UNAVAILABLE");
  if (current.ocdId !== "ocd-division/country:us/state:az/county:cochise" ||
      current.state !== "AZ" || current.model !== "VOTE_CENTER" || current.refusal !== null || current.sites.length !== 18) {
    throw new Error("VOTING_SITES_COCHISE_SCOPE_INVALID");
  }
  return { generatedAt, jurisdictions: [...prior.jurisdictions.filter(row => row.ocdId !== current.ocdId), current]
    .sort((left, right) => left.ocdId.localeCompare(right.ocdId)) };
}

/** The standard producer refreshes Pima, Morris, and New Hampshire. Keep a
 * separately sourced county only when it was outside those exact authorities. */
export function votingSitesStandardSuccessor(current: VotingSitesFile, prior: VotingSitesFile | null): VotingSitesFile {
  if (!prior) return current;
  const refreshed = (row: VotingJurisdiction) => row.ocdId === "ocd-division/country:us/state:az/county:pima" ||
    (row.state === "NJ" && row.sourceUrl.startsWith("https://www.morriscountynj.gov/")) || row.state === "NH";
  const outside = prior.jurisdictions.filter(row => !refreshed(row));
  if (current.jurisdictions.some(row => !refreshed(row)) || outside.some(row =>
    current.jurisdictions.some(next => next.ocdId === row.ocdId))) {
    throw new Error("VOTING_SITES_STANDARD_SOURCE_SCOPE_MIXED");
  }
  return { generatedAt: current.generatedAt, jurisdictions: [...current.jurisdictions, ...outside]
    .sort((left, right) => left.ocdId.localeCompare(right.ocdId)) };
}

function identities(file: VotingSitesFile): readonly IdentityEvidence[] {
  return file.jurisdictions.flatMap((jurisdiction) => {
    const authorityJurisdiction = `US-${jurisdiction.state}`;
    return [
      {
        subjectId: jurisdiction.ocdId,
        jurisdiction: authorityJurisdiction,
        identifiers: { ocd_id: jurisdiction.ocdId },
        matchBasis: "OFFICIAL_ID" as const,
        ambiguous: false,
      },
      ...jurisdiction.sites.map((site) => ({
        subjectId: `${jurisdiction.ocdId}:${site.id}`,
        jurisdiction: authorityJurisdiction,
        identifiers: { ocd_id: jurisdiction.ocdId, voting_site_id: site.id },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
      })),
    ];
  });
}

function violations(file: VotingSitesFile): string[] {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file.generatedAt)) problems.push("Voting-site projection has no exact generated date.");
  if (file.jurisdictions.length === 0) problems.push("Voting-site projection contains no jurisdictions.");
  const jurisdictionIds = file.jurisdictions.map((jurisdiction) => jurisdiction.ocdId);
  if (new Set(jurisdictionIds).size !== jurisdictionIds.length || jurisdictionIds.some((id) => !id.startsWith("ocd-division/"))) {
    problems.push("Voting-site jurisdictions have empty, duplicate, or non-OCD identities.");
  }
  for (const { usps: state } of COVERED_STATES) {
    if (!file.jurisdictions.some((jurisdiction) => jurisdiction.state === state)) problems.push(`${state} has no explicit voting-site jurisdiction outcome.`);
  }
  if (file.jurisdictions.some((jurisdiction) => !OFFICIAL_SOURCE_PREFIXES.some((prefix) => jurisdiction.sourceUrl.startsWith(prefix)))) {
    problems.push("A voting-site jurisdiction cites a source outside the registered official election authorities.");
  }
  if (file.jurisdictions.some((jurisdiction) => !jurisdiction.sourceOrg || !/^\d{4}-\d{2}-\d{2}$/.test(jurisdiction.collectedAt))) {
    problems.push("A voting-site jurisdiction lacks its official publisher or retrieval date.");
  }
  if (file.jurisdictions.some((jurisdiction) => jurisdiction.sites.length === 0 && (!jurisdiction.refusal || jurisdiction.refusal.rungs.length === 0))) {
    problems.push("A jurisdiction with no sites lacks a fail-closed refusal and acquisition rungs.");
  }
  const siteKeys = file.jurisdictions.flatMap((jurisdiction) => jurisdiction.sites.map((site) => `${jurisdiction.ocdId}:${site.id}`));
  if (new Set(siteKeys).size !== siteKeys.length) problems.push("Voting-site identities are duplicated within the projection.");
  if (file.jurisdictions.some((jurisdiction) => jurisdiction.sites.some((site) =>
    !site.id || !site.name || !site.address ||
    ((site.lat === null) !== (site.lng === null)) ||
    (site.lat !== null && (!Number.isFinite(site.lat) || site.lat <= 24 || site.lat >= 50)) ||
    (site.lng !== null && (!Number.isFinite(site.lng) || site.lng <= -125 || site.lng >= -66))
  ))) problems.push("A voting site lacks its published identity/address or carries an invalid point.");
  if (file.jurisdictions.reduce((sum, jurisdiction) => sum + jurisdiction.sites.length, 0) === 0) {
    problems.push("No official voting site was acquired; an empty run cannot replace LKG.");
  }
  return problems;
}

export function votingSitesCandidate(input: {
  readonly current: VotingSitesFile;
  readonly prior: VotingSitesFile | null;
  readonly failures: readonly VotingSiteAcquisitionFailure[];
  readonly rawBodies: readonly string[];
  readonly successfulAuthorityReads: number;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  /** Exact prior candidate whose independently sourced jurisdictions are carried. */
  readonly carriedFromVersionId?: string | null;
  /** Retain the bounded original response frames in the candidate, never Reader. */
  readonly retainRawBodies?: boolean;
}): RoutineCandidate {
  const readModel = retainFailedVotingSiteScopes(input.current, input.prior, input.failures);
  const civicRecords = votingSiteMembers(readModel);
  const semanticViolations = violations(readModel);
  const rawHash = sha256(input.rawBodies.map((body) => sha256(body)).join("\n"));
  const carriedJurisdictionIds = input.prior?.jurisdictions.filter(row =>
    readModel.jurisdictions.some(next => next.ocdId === row.ocdId && normalizedHash(next) === normalizedHash(row)))
    .map(row => row.ocdId).sort() ?? [];
  const normalizedPayload = input.retainRawBodies || input.carriedFromVersionId
    ? { projection: readModel, acquisition: input.retainRawBodies ? input.rawBodies : [],
        carriedFromVersionId: input.carriedFromVersionId ?? null, carriedJurisdictionIds }
    : readModel;
  return {
    id: `cv-${sha256(`${VOTING_SITES_CONTRACT.sourceId}\u001f${VOTING_SITES_CONTRACT.scope}\u001f${rawHash}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: VOTING_SITES_CONTRACT.sourceId,
    recordClass: VOTING_SITES_CONTRACT.recordClass,
    scope: VOTING_SITES_CONTRACT.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(VOTING_SITES_CONTRACT.sourceId, VOTING_SITES_CONTRACT.recordClass, VOTING_SITES_CONTRACT.scope),
    retrieval: {
      succeeded: input.rawBodies.length > 0 && input.successfulAuthorityReads > 0,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.successfulAuthorityReads > 0 ? 200 : null,
      retrievedAt: input.retrievedAt,
      rawHash: input.rawBodies.length > 0 ? rawHash : null,
      failureDetail: input.successfulAuthorityReads > 0 ? undefined : "No registered election authority returned successful bytes.",
    },
    normalization: {
      succeeded: semanticViolations.length === 0,
      parserVersion: VOTING_SITES_CONTRACT.parserVersion,
      schemaVersion: "voting-sites/1",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: civicRecords.length,
      outputRecords: civicRecords.length,
      droppedRecords: 0,
      missingRequiredFields: [],
      failureDetail: semanticViolations.length ? semanticViolations.join("; ") : undefined,
    },
    identities: identities(readModel),
    temporal: { version: "2026-general", expectedVersion: "2026-general", sourceThrough: readModel.generatedAt, staleAtRetrieval: false },
    semantics: { factKind: "official election-authority voting sites and fail-closed retrieval outcomes", violations: semanticViolations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "supported official election-authority routes; each jurisdiction is independently held on acquisition failure",
      returnedRecords: civicRecords.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "/api/voting-sites", passed: semanticViolations.length === 0, detail: `${readModel.jurisdictions.length} exact jurisdiction outcomes and ${readModel.jurisdictions.reduce((sum, row) => sum + row.sites.length, 0)} official sites.` },
      { consumer: "map and ballot voting-sites panels", passed: readModel.jurisdictions.every((row) => row.sites.length > 0 || row.refusal !== null), detail: "Every empty jurisdiction renders a named refusal rather than an absence." },
    ],
    normalizedPayload,
    readModel,
    civicRecords,
    excludedFacts: input.failures.map((failure) => ({
      key: failure.jurisdictionId ?? (failure.state ? `state:${failure.state}` : null),
      code: failure.code,
      detail: failure.detail,
    })),
  };
}
