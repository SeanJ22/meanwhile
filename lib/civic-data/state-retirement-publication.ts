import { createHash } from "node:crypto";
import { genericBallotProblems, type GenericBallotProjection } from "../ballot/generic-projection.ts";
import { votingSitesProjectionIssues } from "../ballot/voting-sites-data-plane.ts";
import type { VotingSitesFile } from "../ballot/voting-sites.ts";
import { registryRuntimeProjectionIssues, type RegistryRuntimeCarton } from "../registry/runtime-data-plane.ts";
import { derivedCampaignSitesProjectionIssue } from "./derived-campaign-sites.ts";
import { requiredRoutineContract } from "./contracts.ts";
import { manualProductionContract } from "./manual-contracts.ts";
import type { PublishedCandidateMetadata } from "./store.ts";
import { parseStateBallotContractId, registryJurisdictions, stateFromRegistryRuntimeContractId } from "./state-scopes.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { sourceProjectionEvidence, type PromotedProjection, type RoutineCandidate, type StateRetirementEvidence, type ValidationReceipt } from "./types.ts";
import { civicRecordsFor } from "./changes.ts";

type Row = Record<string, unknown>;
const retirementObject = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(retirementObject) : [];


function projectionIssues(contractId: string, state: string, payload: unknown): string[] {
  const family = parseStateBallotContractId(contractId), registryState = stateFromRegistryRuntimeContractId(contractId);
  if ((family?.state ?? registryState) !== state) return ["STATE_RETIREMENT_STATE_CONTRACT_MISMATCH"];
  const value = retirementObject(payload), issues: string[] = [];
  const foreign = (...ids: unknown[]) => {
    const states = ids.flatMap(registryJurisdictions);
    return states.length > 0 && !states.includes(state);
  };
  if (family?.family === "ballot-contests") return genericBallotProblems(payload as GenericBallotProjection, state);
  if (family?.family === "voting-sites") {
    if (!Array.isArray(value.jurisdictions)) return ["Voting-site jurisdictions are missing."];
    if (!value.jurisdictions.length) return /^\d{4}-\d{2}-\d{2}$/.test(String(value.generatedAt))
      ? [] : ["Voting-site projection has no exact generated date."];
    issues.push(...votingSitesProjectionIssues(payload as VotingSitesFile));
    if (rows(value.jurisdictions).some(row => row.state !== state || foreign(row.ocdId))) issues.push("Voting-site jurisdiction belongs to another state.");
  } else if (family?.family === "candidate-campaign-sites-derived") {
    const issue = derivedCampaignSitesProjectionIssue(payload);
    if (issue) issues.push(issue);
    if ([...rows(value.records), ...rows(value.portraits)].some(row => foreign(row.id) || foreign(row.candidacyId))) issues.push("Derived candidate belongs to another state.");
  } else if (family?.family === "candidate-profiles") {
    for (const field of ["cards", "links"]) {
      const members = retirementObject(value[field])[field];
      if (!members || typeof members !== "object" || Array.isArray(members)) issues.push(`Candidate profile ${field} are missing.`);
      for (const [key, member] of Object.entries(retirementObject(members))) {
        if (!member || typeof member !== "object" || Array.isArray(member) || foreign(key)) issues.push(`Candidate profile ${key} lacks its state-bound object.`);
      }
    }
  } else if (family?.family === "candidate-corpus") {
    if (!Array.isArray(value.documents)) return ["Candidate publication documents are missing."];
    const ids = new Set<unknown>();
    for (const row of rows(value.documents)) {
      if (typeof row.id !== "string" || !row.id || ids.has(row.id) || typeof row.candidateKey !== "string" || !row.candidateKey || foreign(row.candidateKey) ||
          typeof row.documentUrl !== "string" || !/^https:\/\//.test(row.documentUrl) || typeof row.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(row.contentHash) ||
          typeof row.retrievedAt !== "string" || !Number.isFinite(Date.parse(row.retrievedAt)) || typeof row.extraction !== "string")
        issues.push("Candidate publication lacks its exact identity, source, hash, retrieval time or extraction outcome.");
      if (row.extraction === "html" && (typeof row.text !== "string" || createHash("sha256").update(row.text).digest("hex") !== row.contentHash))
        issues.push("Candidate publication text differs from its content hash.");
      ids.add(row.id);
    }
  } else if (registryState) {
    issues.push(...registryRuntimeProjectionIssues(payload as RegistryRuntimeCarton));
    const registry = retirementObject(value.registry);
    if (rows(registry.divisions).some(row => foreign(row.ocdId)) || rows(registry.bodies).some(row => foreign(row.ocdId, row.id, ...Array.isArray(row.alsoServesOcdIds) ? row.alsoServesOcdIds : [])) ||
        rows(value.bodyRosters).some(row => foreign(row.bodyId)) || rows(value.statewideExecutives).some(row => foreign(row.stateOcdId)) ||
        rows(retirementObject(value.officialCandidacies).rows).some(row => foreign(...Array.isArray(retirementObject(row.holder).divisions) ? retirementObject(row.holder).divisions as unknown[] : [])))
      issues.push("Registry member belongs to another state.");
  } else issues.push("STATE_RETIREMENT_FAMILY_UNSUPPORTED");
  return issues;
}

export function stateRetirementCandidate(input: {
  readonly contractId: string; readonly state: string; readonly unitSha256: string;
  readonly origin: { readonly candidate: RoutineCandidate; readonly receipt: ValidationReceipt; readonly readModelHash: string };
  readonly current: PromotedProjection | null; readonly currentMetadata: PublishedCandidateMetadata["candidate"] | null;
  readonly payload: unknown; readonly normalizedMetadata: Record<string, unknown>;
}): RoutineCandidate {
  const contract = input.contractId.startsWith("candidate-campaign-sites-derived:")
    ? requiredRoutineContract(input.contractId) : manualProductionContract(input.contractId);
  if (!contract) throw new Error("STATE_RETIREMENT_CONTRACT_MISMATCH");
  if ((input.current === null) !== (input.currentMetadata === null) || input.current &&
      (contract.scope !== input.current.scope || contract.recordClass !== input.current.recordClass ||
      contract.sourceId !== input.current.sourceId || input.current.versionId !== input.current.lastKnownGoodVersionId || input.current.receipt.decision !== "GOOD"))
    throw new Error("STATE_RETIREMENT_CURRENT_PROOF_INVALID");
  const original = input.origin.candidate, receipt = input.origin.receipt;
  const sourceCheck = receipt.checks.find(row => row.check === "SOURCE_AUTHENTICITY" && row.verdict === "PASS");
  if (receipt.decision !== "GOOD" || receipt.candidateId !== original.id || receipt.sourceId !== original.sourceId ||
      receipt.recordClass !== original.recordClass || receipt.scope !== original.scope || !sourceCheck)
    throw new Error("STATE_RETIREMENT_ORIGIN_PROOF_INVALID");
  const readModel = input.payload;
  const violations = projectionIssues(input.contractId, input.state, readModel);
  if (violations.length) throw new Error(`STATE_RETIREMENT_PROJECTION_INVALID:${violations.join(";")}`);
  const readModelHash = canonicalCivicDataHash(readModel);
  const stateRetirement: StateRetirementEvidence = { kind: "STATE_AUTHORITY_RETIREMENT", contractId: contract.id, state: input.state,
    unitSha256: input.unitSha256, origin: { versionId: original.id, recordClass: original.recordClass, scope: original.scope,
      readModelHash: input.origin.readModelHash, sourceAuthenticity: sourceCheck.code }, priorVersionId: input.current?.versionId ?? null, readModelHash };
  const civicRecords = civicRecordsFor(contract.recordClass, readModel);
  const inheritedRetrieval = input.currentMetadata && canonicalCivicDataHash(original.retrieval) === canonicalCivicDataHash(input.currentMetadata.retrieval)
    ? input.currentMetadata.retrieval : original.retrieval;
  const inheritedTemporal = input.currentMetadata && canonicalCivicDataHash(original.temporal) === canonicalCivicDataHash(input.currentMetadata.temporal)
    ? input.currentMetadata.temporal : original.temporal;
  const normalizedPayload = { readModel, retainedState: input.current && input.currentMetadata
    ? { versionId: input.current.versionId, retrieval: input.currentMetadata.retrieval, temporal: input.currentMetadata.temporal } : null,
    inherited: { originId: original.id, sourceId: original.sourceId,
    retrieval: inheritedRetrieval, temporal: inheritedTemporal, sourceCheck, evidence: input.normalizedMetadata,
    ...(original.bootstrapImport ? { bootstrapImport: original.bootstrapImport } : {}) } };
  const excludedFacts = [...new Map([...(input.current?.receipt.excludedFacts ?? []), ...receipt.excludedFacts, ...(original.excludedFacts ?? [])]
    .map(row => [canonicalCivicDataHash(row), row])).values()];
  return {
    id: `cv-${canonicalCivicDataHash(stateRetirement).slice(0, 32)}`,
    sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(contract.sourceId, contract.recordClass, contract.scope),
    stateRetirement, retrieval: !input.currentMetadata || Date.parse(inheritedRetrieval.retrievedAt) >= Date.parse(input.currentMetadata.retrieval.retrievedAt)
      ? inheritedRetrieval : input.currentMetadata.retrieval,
    normalization: { succeeded: true, parserVersion: contract.parserNormalizerVersion,
      schemaVersion: original.normalization.schemaVersion, normalizedHash: readModelHash,
      normalizedPayloadHash: canonicalCivicDataHash(normalizedPayload), inputRecords: civicRecords.length,
      outputRecords: civicRecords.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: civicRecords.map(member => ({ subjectId: member.key, jurisdiction: `US-${input.state}`,
      identifiers: { state_member_key: member.key }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
    temporal: !input.currentMetadata || inheritedTemporal.sourceThrough >= input.currentMetadata.temporal.sourceThrough ? inheritedTemporal : input.currentMetadata.temporal,
    semantics: { factKind: "Existing GOOD source facts retained through exact state authority transfer", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: "Exact source members and retained state facts", returnedRecords: civicRecords.length,
      declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [], normalizedPayload, readModel, civicRecords, excludedFacts,
  };
}
