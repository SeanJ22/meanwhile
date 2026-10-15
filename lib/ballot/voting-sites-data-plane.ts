import { normalizedHash, sha256 } from "../civic-data/candidate-builders.ts";
import type { CivicRecordMember, IdentityEvidence, RoutineCandidate } from "../civic-data/types.ts";
import { sourceProjectionEvidence } from "../civic-data/types.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import type { RawCaptureRef } from "../civic-data/raw-capture-vault.ts";
import type { VotingJurisdiction, VotingSitesFile } from "./voting-sites.ts";

export const VOTING_SITES_CONTRACT = {
  id: "voting-sites",
  sourceId: "voting-sites",
  recordClass: "VOTING_SITE",
  scope: "US:voting-sites",
  parserVersion: "official-voting-sites/4",
} as const;

/** One acquired source response; its bytes stay in the raw-capture vault. */
export interface VotingRawCapture extends RawCaptureRef {
  readonly url: string;
  readonly contentType: string;
}

export interface VotingSiteAcquisitionFailure {
  readonly jurisdictionId?: string;
  readonly state?: string;
  readonly code: string;
  readonly detail: string;
}

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

export function votingSitesScopedSuccessor(
  prior: VotingSitesFile | null,
  current: VotingJurisdiction,
  generatedAt: string,
): VotingSitesFile {
  return votingSitesStandardSuccessor({ generatedAt, jurisdictions: [current] }, prior);
}

/** Acquired scopes replace themselves. An explicitly refreshed scope may remove
 * an old row; a jurisdiction absent from the acquisition remains held. */
export function votingSitesStandardSuccessor(
  current: VotingSitesFile,
  prior: VotingSitesFile | null,
  refreshedJurisdictionIds: readonly string[] = current.jurisdictions.map(row => row.ocdId),
): VotingSitesFile {
  if (!prior) return current;
  const refreshed = new Set([...refreshedJurisdictionIds, ...current.jurisdictions.map(row => row.ocdId)]);
  const outside = prior.jurisdictions.filter(row => !refreshed.has(row.ocdId));
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
  if (file.jurisdictions.some((jurisdiction) => jurisdiction.sites.length > 0 &&
      !isOfficialSource(jurisdiction.sourceUrl, jurisdiction.sourceLinkingPage))) {
    problems.push("A voting-site source is not .gov and has no saved official page linking it.");
  }
  if (file.jurisdictions.some((jurisdiction) => !jurisdiction.sourceOrg || !/^\d{4}-\d{2}-\d{2}$/.test(jurisdiction.collectedAt))) {
    problems.push("A voting-site jurisdiction lacks its official publisher or retrieval date.");
  }
  if (file.jurisdictions.some((jurisdiction) => jurisdiction.sites.length === 0 && !jurisdiction.publication && !jurisdiction.office && !jurisdiction.rules?.length && !jurisdiction.addressLookups?.length && (!jurisdiction.refusal || jurisdiction.refusal.rungs.length === 0))) {
    problems.push("A jurisdiction with no sites lacks a fail-closed refusal and acquisition rungs.");
  }
  const siteKeys = file.jurisdictions.flatMap((jurisdiction) => jurisdiction.sites.map((site) => `${jurisdiction.ocdId}:${site.id}`));
  if (new Set(siteKeys).size !== siteKeys.length) problems.push("Voting-site identities are duplicated within the projection.");
  if (file.jurisdictions.some((jurisdiction) => jurisdiction.sites.some((site) =>
    !site.id || !site.name || !site.address ||
    ((site.lat === null) !== (site.lng === null)) ||
    (site.lat !== null && (!Number.isFinite(site.lat) || site.lat < -90 || site.lat > 90)) ||
    (site.lng !== null && (!Number.isFinite(site.lng) || site.lng < -180 || site.lng > 180))
  ))) problems.push("A voting site lacks its published identity/address or carries an invalid point.");
  if (!file.jurisdictions.some(jurisdiction => jurisdiction.sites.length > 0 || jurisdiction.publication || jurisdiction.office || jurisdiction.rules?.length || jurisdiction.addressLookups?.length)) {
    problems.push("No official voting site was acquired; an empty run cannot replace LKG.");
  }
  return problems;
}

export function votingSitesCandidate(input: {
  readonly current: VotingSitesFile;
  readonly prior: VotingSitesFile | null;
  readonly failures: readonly VotingSiteAcquisitionFailure[];
  readonly acquisition: readonly VotingRawCapture[];
  readonly successfulAuthorityReads: number;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly carriedFromVersionId?: string | null;
}): RoutineCandidate {
  const readModel = retainFailedVotingSiteScopes(input.current, input.prior, input.failures);
  const civicRecords = votingSiteMembers(readModel);
  const semanticViolations = violations(readModel);
  const rawHash = sha256(input.acquisition.map((capture) => capture.rawHash).join("\n"));
  const carriedJurisdictionIds = input.prior?.jurisdictions.filter(row =>
    readModel.jurisdictions.some(next => next.ocdId === row.ocdId && normalizedHash(next) === normalizedHash(row)))
    .map(row => row.ocdId).sort() ?? [];
  const normalizedPayload = { projection: readModel, acquisition: input.acquisition,
    carriedFromVersionId: input.carriedFromVersionId ?? null, carriedJurisdictionIds };
  return {
    id: `cv-${sha256(`${VOTING_SITES_CONTRACT.sourceId}\u001f${VOTING_SITES_CONTRACT.scope}\u001f${rawHash}\u001f${input.retrievedAt}\u001f${input.finalUrl}\u001f${normalizedHash(readModel)}`).slice(0, 32)}`,
    sourceId: VOTING_SITES_CONTRACT.sourceId,
    recordClass: VOTING_SITES_CONTRACT.recordClass,
    scope: VOTING_SITES_CONTRACT.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(VOTING_SITES_CONTRACT.sourceId, VOTING_SITES_CONTRACT.recordClass, VOTING_SITES_CONTRACT.scope),
    retrieval: {
      succeeded: input.acquisition.length > 0 && input.successfulAuthorityReads > 0,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.successfulAuthorityReads > 0 ? 200 : null,
      retrievedAt: input.retrievedAt,
      rawHash: input.acquisition.length > 0 ? rawHash : null,
      failureDetail: input.successfulAuthorityReads > 0 ? undefined : "No registered election authority returned successful bytes.",
    },
    normalization: {
      succeeded: semanticViolations.length === 0,
      parserVersion: VOTING_SITES_CONTRACT.parserVersion,
      schemaVersion: "voting-sites/2",
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
      { consumer: "map and ballot voting-sites panels", passed: readModel.jurisdictions.every((row) => row.sites.length > 0 || row.refusal !== null || Boolean(row.publication || row.office || row.rules?.length || row.addressLookups?.length)), detail: "Every empty jurisdiction retains its publication notice, office contact, rules, or open acquisition gap." },
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
