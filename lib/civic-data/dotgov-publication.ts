import { createHash } from "node:crypto";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { DOTGOV_SCOPE, DOTGOV_PARSER_VERSION, dotGovSnapshotIssues, dotGovStateScope, type DotGovSnapshot } from "./dotgov.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function dotGovCandidate(input: {
  readonly snapshot: DotGovSnapshot;
  readonly rawHash?: string;
  readonly rawText?: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
}): RoutineCandidate {
  const snapshot = input.snapshot, rows = snapshot.domains;
  if (!snapshot.state && (!snapshot.release || rows.length)) throw new Error("CISA publication requires an exact state partition or source release.");
  const scope = snapshot.state ? dotGovStateScope(snapshot.state) : DOTGOV_SCOPE;
  const rawHash = input.rawHash ?? sha256(input.rawText ?? "");
  const registry = snapshot.registryCounts ?? snapshot.counts;
  const hash = canonicalCivicDataHash(snapshot);
  const violations = [...dotGovSnapshotIssues(snapshot)];
  const sourceId = "cisa-dotgov-registry";
  const records = snapshot.state ? rows.length : 1;
  return {
    id: `cv-${sha256(`${sourceId}\u001f${scope}\u001f${rawHash}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId, recordClass: "DOTGOV_REFERENCE", scope,
    sourceProjectionEvidence: sourceProjectionEvidence(sourceId, "DOTGOV_REFERENCE", scope),
    retrieval: { succeeded: /^[a-f0-9]{64}$/.test(rawHash),
      requestedUrl: "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1",
      finalUrl: input.finalUrl, httpStatus: 200, retrievedAt: input.retrievedAt, rawHash },
    normalization: { succeeded: !violations.length, parserVersion: DOTGOV_PARSER_VERSION, schemaVersion: `current-full.csv:${snapshot.source.sha}`,
      normalizedHash: hash, normalizedPayloadHash: hash, inputRecords: records, outputRecords: records, droppedRecords: 0, missingRequiredFields: [] },
    identities: snapshot.state ? rows.map(row => ({ subjectId: row.domain, jurisdiction: "US",
      identifiers: { domain: row.domain, source_sha: snapshot.source.sha }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })) :
      [{ subjectId: `${sourceId}:${snapshot.source.sha}`, jurisdiction: "US", identifiers: { source_sha: snapshot.source.sha }, matchBasis: "OFFICIAL_ID", ambiguous: false }],
    temporal: { version: snapshot.source.sha, expectedVersion: snapshot.source.sha, sourceThrough: input.retrievedAt, staleAtRetrieval: false },
    semantics: { factKind: "CISA registered .gov domain and registrant contact reference; never a government denominator", violations },
    horizon: { kind: "BOUNDED", query: snapshot.state ? `Every ${snapshot.state} registrant in the SHA-pinned CISA current-full.csv` : "Counts of the complete source; domain records are published by state",
      returnedRecords: records, declaredTotal: records, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "government domain Reader and registered dotgov discovery operation",
      passed: registry.domains >= 15000 && registry.electionDomains >= 500,
      detail: `${registry.domains} total domains and ${registry.electionDomains} election-typed domains reconciled before state publication.` }],
    normalizedPayload: snapshot, readModel: snapshot,
  };
}
