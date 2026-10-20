import { normalizedHash, sha256 } from "../../civic-data/candidate-builders.ts";
import type { CivicRecordMember, RoutineCandidate } from "../../civic-data/types.ts";
import { sourceProjectionEvidence } from "../../civic-data/types.ts";
import { PRL_CATEGORIES, PRL_FORBIDDEN_COLUMN_PATTERN, PRL_RHETORIC_ATTRIBUTION, type PrlSnapshot } from "./types.ts";

export const PRL_CONTRACT = {
  id: "prl",
  sourceId: "prl",
  recordClass: "PRL_PROFILE",
  scope: "US:prl:profiles-release",
  parserVersion: "prl-rhetoric/3",
} as const;

export function prlMembers(snapshot: PrlSnapshot): readonly CivicRecordMember[] {
  if (snapshot.releases) return snapshot.releases.map(record => ({ key: "profile-release", record }));
  return snapshot.profiles
    .map((profile) => ({ key: `profile:${profile.bioguideId}`, record: profile }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function violations(snapshot: PrlSnapshot): string[] {
  const problems: string[] = [];
  if (snapshot.formatVersion !== 1) problems.push("PRL projection format version is invalid.");
  if (!snapshot.sourceUrl.startsWith("https://americaspoliticalpulse.com/data/elite/")) problems.push("PRL projection cites an unregistered dataset route.");
  if (snapshot.attribution.citation !== PRL_RHETORIC_ATTRIBUTION.citation || snapshot.attribution.licence !== PRL_RHETORIC_ATTRIBUTION.licence || snapshot.attribution.licenceUrl !== PRL_RHETORIC_ATTRIBUTION.licenceUrl) {
    problems.push("PRL rhetoric attribution or CC BY licence condition is missing or altered.");
  }
  if (snapshot.releases) {
    const release = snapshot.releases[0];
    if (snapshot.releases.length !== 1 || release?.kind !== "prl-profiles" || !Number.isSafeInteger(release.subjectCount) || release.subjectCount <= 0 ||
      !/^[a-f0-9]{64}$/.test(release.sourceSha256) || release.objectRoot !== `profiles-national/${release.sourceSha256}/prl-ingest-3` ||
      snapshot.profiles.length || snapshot.rosterMisses.length || snapshot.rowsWithStatements !== release.subjectCount) problems.push("PRL profile release does not identify completed native-person profiles.");
  } else if (snapshot.profiles.length === 0) problems.push("PRL projection contains no attributed profiles.");
  if (snapshot.rowsInFile < snapshot.profiles.length || snapshot.rowsWithStatements < snapshot.profiles.length) problems.push("PRL source denominators are smaller than the retained profile set.");
  const ids = snapshot.profiles.map((profile) => profile.bioguideId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !/^[A-Z]\d{6}$/.test(id))) problems.push("PRL profiles lack unique exact Bioguide identities.");
  const allowedProfileKeys = new Set(["bioguideId", "prlName", "statementCount", "shares", "sources", "measuredAt"]);
  const allowedShares = new Set<string>(PRL_CATEGORIES.map((category) => category.key));
  for (const profile of snapshot.profiles) {
    if (Object.keys(profile).some((key) => !allowedProfileKeys.has(key) || PRL_FORBIDDEN_COLUMN_PATTERN.test(key))) problems.push(`${profile.bioguideId} carries a field outside the PRL rhetoric allowlist.`);
    if (Object.keys(profile.shares).some((key) => !allowedShares.has(key) || PRL_FORBIDDEN_COLUMN_PATTERN.test(key))) problems.push(`${profile.bioguideId} carries a non-allowlisted PRL measure.`);
    if (!Number.isInteger(profile.statementCount) || profile.statementCount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(profile.measuredAt)) problems.push(`${profile.bioguideId} lacks its measurement count or source date.`);
    if (Object.values(profile.shares).some((share) => share !== null && (!Number.isFinite(share) || share < 0 || share > 100))) problems.push(`${profile.bioguideId} carries a PRL share outside 0-100.`);
  }
  if (snapshot.rosterMisses.some((id) => ids.includes(id))) problems.push("A PRL identity is both retained and named as unmeasured.");
  return [...new Set(problems)];
}

export function prlCandidate(input: {
  readonly snapshot: PrlSnapshot;
  readonly rawZip?: Uint8Array;
  readonly sourceEvidence?: { readonly sha256: string; readonly bytes: number };
  readonly finalUrl: string;
  readonly retrievedAt: string;
}): RoutineCandidate {
  const semanticViolations = violations(input.snapshot);
  const civicRecords = prlMembers(input.snapshot);
  const rawHash = input.sourceEvidence?.sha256 ?? sha256(input.rawZip ?? new Uint8Array());
  const acquired = (input.sourceEvidence?.bytes ?? input.rawZip?.byteLength ?? 0) > 0 && /^[a-f0-9]{64}$/.test(rawHash);
  const dropped = Math.max(0, input.snapshot.rowsInFile - civicRecords.length);
  const sourceThrough = input.snapshot.profiles.map((profile) => profile.measuredAt).sort().at(-1) ?? input.snapshot.fetchedAt;
  return {
    id: `cv-${sha256(`${PRL_CONTRACT.sourceId}\u001f${PRL_CONTRACT.scope}\u001f${rawHash}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: PRL_CONTRACT.sourceId,
    recordClass: PRL_CONTRACT.recordClass,
    scope: PRL_CONTRACT.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(PRL_CONTRACT.sourceId, PRL_CONTRACT.recordClass, PRL_CONTRACT.scope),
    retrieval: { succeeded: acquired, requestedUrl: input.snapshot.sourceUrl, finalUrl: input.finalUrl, httpStatus: acquired ? 200 : null, retrievedAt: input.retrievedAt, rawHash: acquired ? rawHash : null, failureDetail: acquired ? undefined : "No PRL profile archive bytes were acquired." },
    normalization: {
      succeeded: semanticViolations.length === 0,
      parserVersion: PRL_CONTRACT.parserVersion,
      schemaVersion: "prl-attributed-profile/1",
      normalizedHash: normalizedHash(input.snapshot),
      normalizedPayloadHash: normalizedHash(input.snapshot),
      inputRecords: input.snapshot.rowsInFile,
      outputRecords: civicRecords.length,
      droppedRecords: dropped,
      missingRequiredFields: [],
      failureDetail: semanticViolations.length ? semanticViolations.join("; ") : undefined,
    },
    identities: input.snapshot.releases
      ? [{ subjectId: "prl:profiles-national", jurisdiction: "US", identifiers: { dataset_id: "profiles-national" }, matchBasis: "OFFICIAL_ID_CROSSWALK" as const, ambiguous: false }]
      : input.snapshot.profiles.map((profile) => ({ subjectId: `congress:${profile.bioguideId}`, jurisdiction: "US", identifiers: { bioguide_id: profile.bioguideId }, matchBasis: "OFFICIAL_ID_CROSSWALK" as const, ambiguous: false })),
    temporal: { version: sourceThrough, expectedVersion: sourceThrough, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "PRL's attributed congressional-rhetoric aggregate measurement", violations: semanticViolations },
    horizon: { kind: "BOUNDED", query: input.snapshot.releases ? "one completed source release of native-person profiles" : "every profile row in profiles-all-national.zip with a positive PRL communication count", returnedRecords: civicRecords.length, declaredTotal: input.snapshot.releases ? 1 : input.snapshot.rowsWithStatements, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "/api/profile/[subject]", passed: semanticViolations.length === 0, detail: input.snapshot.releases
        ? `${input.snapshot.releases[0]?.subjectCount ?? 0} source-normalized profiles are held by exact native person beneath the completed release root.`
        : `${input.snapshot.profiles.length} exact Bioguide profiles retain the required PRL attribution.` },
      { consumer: "ballot and map public-statements profile", passed: input.snapshot.profiles.every((profile) => Object.keys(profile.shares).every((key) => PRL_CATEGORIES.some((category) => category.key === key))), detail: "Only the five allowlisted attributed rhetoric shares may reach the Reader." },
    ],
    normalizedPayload: input.snapshot,
    readModel: input.snapshot,
    civicRecords,
    excludedFacts: input.snapshot.rosterMisses.map((bioguideId) => ({ key: `profile:${bioguideId}`, code: "PRL_PROFILE_UNMEASURED", detail: `${bioguideId} has no positive classified-statement measurement in this source version.` })),
  };
}
