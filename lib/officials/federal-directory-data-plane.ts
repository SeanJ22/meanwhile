import { createHash } from "node:crypto";

import { canonicalCivicDataJson, civicRecordsFor } from "../civic-data/changes.ts";
import { authorityFor } from "../civic-data/source-authority.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import type { OfficeholderSet } from "./types.ts";
import type { DirectoryFile } from "./directory.ts";

export const FEDERAL_DIRECTORY_SOURCE_ID = "congress-directory-project" as const;
export const FEDERAL_DIRECTORY_SCOPE = "US:current-congress-directory" as const;
export const FEDERAL_DIRECTORY_PARSER_VERSION = "congress-directory/4" as const;

export interface FederalDirectoryAcquisition {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly body: string;
  readonly retrievedAt?: string;
  readonly vaultKey?:string;
  readonly sourceCheck?: NonNullable<import("../civic-data/types.ts").RetrievalEvidence["sourceCheck"]>;
}

export interface FederalDirectoryReadModel {
  readonly partyLabels?: Readonly<Record<string, string | null>>;
  readonly formatVersion: 1;
  readonly currentMembershipComplete?: boolean;
  readonly sourceSha: string;
  readonly roster: OfficeholderSet;
  readonly directory: DirectoryFile;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rawSetHash(acquisitions: readonly FederalDirectoryAcquisition[]): string {
  return sha256(canonicalCivicDataJson(acquisitions.map(({ requestedUrl, finalUrl, httpStatus, body }) => ({
    requestedUrl,
    finalUrl,
    httpStatus,
    rawHash: sha256(body),
    byteCount: Buffer.byteLength(body),
  })).sort((left, right) => left.finalUrl.localeCompare(right.finalUrl))));
}

export function federalDirectoryProjectionIssues(value: FederalDirectoryReadModel): string[] {
  const issues: string[] = [];
  const holders = value.roster?.officeholders ?? [];
  const divisions = value.roster?.divisions ?? [];
  const byMember = value.directory?.byMember ?? {};
  const committees = value.directory?.committees ?? {};
  const holderIds = holders.map((holder) => holder.id);
  const holderSet = new Set(holderIds);
  const bioguides = holders.map((holder) => holder.id.replace(/^congress:/, ""));
  if (value.formatVersion !== 1) issues.push("FORMAT_VERSION_UNSUPPORTED");
  if (!/^[a-f0-9]{40}$/.test(value.sourceSha)) issues.push("SOURCE_SHA_INVALID");
  if (holders.length === 0) issues.push("FEDERAL_ROSTER_EMPTY");
  if (new Set(holderIds).size !== holderIds.length || holderIds.some((id) => !/^congress:[A-Z]\d{6}$/.test(id))) issues.push("OFFICEHOLDER_ID_INVALID_OR_DUPLICATED");
  if (bioguides.some((id) => !byMember[id])) issues.push("OFFICEHOLDER_DIRECTORY_JOIN_MISSING");
  if (divisions.some((link) => !holderSet.has(link.officeholderId) || !link.ocdId)) issues.push("DIVISION_LINK_UNRESOLVED");
  if (holders.some((holder) => !holder.name || !holder.officeTitle || !holder.provenance?.sourceUrl)) issues.push("OFFICEHOLDER_REQUIRED_FACT_MISSING");
  const committeeIds = new Set(Object.keys(committees));
  if (Object.values(byMember).some((entry) => entry.committees.some((seat) => !committeeIds.has(seat.committeeId)))) issues.push("COMMITTEE_MEMBERSHIP_UNRESOLVED");
  if (value.directory.source.sha !== value.sourceSha) issues.push("DIRECTORY_SOURCE_SHA_MISMATCH");
  return issues;
}

export function federalDirectoryCandidate(input: {
  readonly acquisitions: readonly FederalDirectoryAcquisition[];
  readonly retrievedAt: string;
  readonly projection: FederalDirectoryReadModel;
  readonly excludedFacts?: RoutineCandidate["excludedFacts"];
}): RoutineCandidate {
  const issues = federalDirectoryProjectionIssues(input.projection);
  for (const acquisition of input.acquisitions) {
    const authority = authorityFor(FEDERAL_DIRECTORY_SOURCE_ID, "FEDERAL_DIRECTORY", acquisition.finalUrl);
    if (!authority.ok) issues.push(`${authority.code}:${acquisition.finalUrl}`);
    if (acquisition.httpStatus < 200 || acquisition.httpStatus >= 300) issues.push(`HTTP_${acquisition.httpStatus}:${acquisition.finalUrl}`);
    if (!acquisition.body.length) issues.push(`EMPTY_BODY:${acquisition.finalUrl}`);
    if (!acquisition.finalUrl.includes(`/${input.projection.sourceSha}/`)) issues.push(`ACQUISITION_NOT_PINNED_TO_SOURCE_SHA:${acquisition.finalUrl}`);
  }
  const acquiredFiles = input.acquisitions.map((row) => {
    try { return new URL(row.finalUrl).pathname.split("/").at(-1) ?? ""; }
    catch { return ""; }
  }).sort();
  if (!acquiredFiles.includes("legislators-current.yaml")) issues.push("CORE_SOURCE_MISSING");
  if (new Set(acquiredFiles).size !== acquiredFiles.length) issues.push("DUPLICATE_SOURCE_FILE");
  const rawHash = rawSetHash(input.acquisitions);
  const sourceCheck = input.acquisitions.flatMap(row=>row.sourceCheck ? [row.sourceCheck] : []).sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0];
  const normalizedPayload = {
    sourceSha: input.projection.sourceSha,
    ...(input.excludedFacts?.length ? { excludedFacts: input.excludedFacts } : {}),
    acquisitions: input.acquisitions.map(({ requestedUrl, finalUrl, httpStatus, body, retrievedAt, vaultKey, sourceCheck }) => ({ requestedUrl, finalUrl, httpStatus, body, rawHash: sha256(body), byteCount: Buffer.byteLength(body), ...(retrievedAt ? {retrievedAt} : {}),...(vaultKey ? {vaultKey} : {}),...(sourceCheck ? {sourceCheck} : {}) })),
  };
  const normalizedHash = sha256(canonicalCivicDataJson(input.projection));
  const normalizedPayloadHash = sha256(canonicalCivicDataJson(normalizedPayload));
  const records = civicRecordsFor("FEDERAL_DIRECTORY", input.projection);
  const acquisitionProblems = issues.filter((issue) => /^(?:FINAL_|SOURCE_|HTTP_|EMPTY_BODY|ACQUISITION_|CORE_SOURCE|DUPLICATE_SOURCE)/.test(issue));
  return {
    id: `cv-${sha256(`${FEDERAL_DIRECTORY_SOURCE_ID}\u001f${FEDERAL_DIRECTORY_SCOPE}\u001f${FEDERAL_DIRECTORY_PARSER_VERSION}\u001f${rawHash}\u001f${normalizedHash}\u001f${normalizedPayloadHash}\u001f${input.projection.sourceSha}\u001f${input.retrievedAt}\u001f${canonicalCivicDataJson(sourceCheck ?? null)}`).slice(0, 32)}`,
    sourceId: FEDERAL_DIRECTORY_SOURCE_ID,
    recordClass: "FEDERAL_DIRECTORY",
    scope: FEDERAL_DIRECTORY_SCOPE,
    retrieval: {
      succeeded: acquiredFiles.includes("legislators-current.yaml") && acquisitionProblems.length === 0,
      requestedUrl: input.acquisitions[0]?.requestedUrl ?? "",
      finalUrl: input.acquisitions[0]?.finalUrl ?? null,
      httpStatus: input.acquisitions[0]?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash: input.acquisitions.length ? rawHash : null,
      ...(sourceCheck ? {sourceCheck} : {}),
      failureDetail: acquiredFiles.includes("legislators-current.yaml") ? undefined : "The current membership source was unavailable.",
    },
    normalization: {
      succeeded: true,
      parserVersion: FEDERAL_DIRECTORY_PARSER_VERSION,
      schemaVersion: `congress-directory:${input.projection.sourceSha}`,
      normalizedHash,
      normalizedPayloadHash,
      inputRecords: records.length,
      outputRecords: records.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: input.projection.roster.officeholders.map((holder) => ({
      subjectId: holder.id,
      jurisdiction: "US",
      identifiers: { bioguide_id: holder.id.slice("congress:".length) },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: holder.chamber,
      term: `${holder.termStart}/${holder.termEnd}`,
    })),
    temporal: {
      version: input.projection.sourceSha,
      expectedVersion: input.projection.sourceSha,
      sourceThrough: input.projection.directory.source.collectedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "attributed current federal membership, contact, district-office, social, and committee directory facts", violations: issues },
    horizon: {
      kind: input.projection.currentMembershipComplete ? "BOUNDED" : "OPEN_FACT_SET",
      query: `independently acquired congress-legislators files at ${input.projection.sourceSha}`,
      returnedRecords: records.length,
      declaredTotal: records.length,
      paginationComplete: true,
      claimsComplete: input.projection.currentMembershipComplete === true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(FEDERAL_DIRECTORY_SOURCE_ID, "FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE),
    dependentChecks: [
      { consumer: "registry/representation/map/ballot", passed: input.projection.roster.officeholders.length > 0 && input.projection.roster.divisions.every(row => input.projection.roster.officeholders.some(holder => holder.id === row.officeholderId)), detail: `${input.projection.roster.officeholders.length} federal holders and ${input.projection.roster.divisions.length} exact division links.` },
      { consumer: "/api/directory and Ask", passed: input.projection.roster.officeholders.every(holder => Boolean(input.projection.directory.byMember[holder.id.slice(9)])), detail: `${Object.keys(input.projection.directory.byMember).length} bioguide-keyed directory entries.` },
    ],
    normalizedPayload,
    readModel: input.projection,
    civicRecords: records,
    ...(input.excludedFacts?.length ? { excludedFacts: input.excludedFacts } : {}),
  };
}

/** Durable failed-attempt shape used when acquisition cannot produce a source set. */
export function failedFederalDirectoryCandidate(attemptedAt: string, detail: string): RoutineCandidate {
  const sourceSha = "0".repeat(40);
  const projection: FederalDirectoryReadModel = {
    formatVersion: 1,
    sourceSha,
    roster: { scope: "us", generatedAt: attemptedAt, officeholders: [], divisions: [], unmatched: [] },
    directory: {
      source: { project: "unitedstates/congress-legislators", repoUrl: "https://github.com/unitedstates/congress-legislators", sha: sourceSha, licence: "CC0 1.0 Universal", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sourceOrg: "unitedstates/congress-legislators (community project)", collectedAt: attemptedAt },
      counts: {},
      committees: {},
      byMember: {},
    },
  };
  const candidate = federalDirectoryCandidate({ acquisitions: [], retrievedAt: attemptedAt, projection });
  return {
    ...candidate,
    retrieval: { ...candidate.retrieval, succeeded: false, failureDetail: detail },
  };
}
