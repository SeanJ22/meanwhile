import { contentHash } from "../ids.ts";
import { requireCapability } from "../capability.ts";
import { validateKnowledge, type MethodKnowledge } from "../../method/knowledge.ts";
import type { WorkerEvidence } from "./types.ts";
import type { EngineeringCandidateFile, EngineeringResult, EngineeringWorkerInput } from "./engineering-types.ts";
import { STREAMLINE_BOUNDARY_TEST_SOURCE, STREAMLINE_INVENTORY_SOURCE } from "./engineering-candidate.ts";
import { runIsolatedSource } from "./isolation.ts";

export type { EngineeringResult, EngineeringTaskSpec, EngineeringWorkerInput } from "./engineering-types.ts";
export const ENGINEERING_METHOD_ID = "streamline-sitemap-is-a-dated-meeting-inventory";

const procedure = [
  "Read the already-vaulted publisher sitemap; never fetch inside Engineering.",
  "Require a complete urlset shape and one loc per URL; reject unsupported XML rather than silently returning zero.",
  "Select same-publisher URL paths carrying a valid calendar date and preserve the exact locator spans.",
  "Deduplicate identical URLs, retaining every evidence span, and sort by exact URL for deterministic replay.",
  "Emit page-investigation candidates with caller-supplied canonical subject and an explicit page-verification requirement.",
  "Replay in two fresh restricted processes and compare exact hashes and independently specified expected entries.",
];
const risks = [
  "A dated URL is a page candidate; its content must independently verify the subject, meeting date, and document links.",
  "A captured sitemap is not a source-universe denominator; sitemap indexes, extensions, and changed publisher templates require a new proof.",
  "This method has measured evidence on two Streamline tenants; portability to other publishers is not proved.",
];

function verifyEvidence(evidence: WorkerEvidence): void {
  if (!evidence.artifactId || !evidence.acquiredByAttemptId || contentHash(evidence.text) !== evidence.contentHash) {
    throw new Error("ENGINEERING_EVIDENCE_HASH_OR_PROVENANCE_INVALID");
  }
}

/** No write, fetch, shell, deployment, promotion, or integration callback is exposed. */
export async function runEngineeringWorker(input: EngineeringWorkerInput): Promise<EngineeringResult> {
  const { spec } = input;
  const base: EngineeringResult = {
    role: "ENGINEERING", attemptId: input.attemptId, schemaVersion: 1,
    implementation: "review-only-method-engineering", version: "1.0.0", verdict: "REFUSED", findings: [],
    artifactIds: [spec.methodArtifactId, ...spec.supportingArtifactIds], methodRouteId: spec.methodRouteId,
    methodVersion: spec.methodVersion, methodContentHash: input.methodEvidence.contentHash,
    validationResultId: spec.validation.resultId, affectedPaths: [], proposedFiles: [], learnedProcedure: procedure,
    reproducibility: { verdict: "NOT_RUN", isolatedExecutions: 0, cases: [], replayCommand: null },
    unresolvedRisks: risks, adoption: "INTEGRATION_REVIEW_REQUIRED",
  };
  try {
    if (input.worker.role !== "ENGINEERING" || input.grant.role !== "ENGINEERING") throw new Error("ENGINEERING_ROLE_MISMATCH");
    requireCapability(input.grant, "VAULT_READ_SANITIZED");
    if (input.grant.capabilities.some(c => !["VAULT_READ_SANITIZED", "CODE_BRANCH_WRITE"].includes(c))) throw new Error("ENGINEERING_GRANT_EXCEEDS_RESEARCH_CONTRACT");
    if (spec.schemaVersion !== 1 || spec.methodRouteId !== ENGINEERING_METHOD_ID || spec.existingInterface.id !== "streamline-sitemap-inventory" ||
        spec.existingInterface.version !== 1 || !["PASS", "INCONCLUSIVE"].includes(spec.validation.verdict) || spec.validation.validatedAspect !== "SOURCE_EXTRACTION" || !spec.validation.resultId || !spec.validation.attemptId ||
        spec.validation.attemptId === input.attemptId || spec.expectedBehavior.length === 0) throw new Error("ENGINEERING_METHOD_CONTRACT_UNVALIDATED");
    verifyEvidence(input.methodEvidence);
    if (input.methodEvidence.artifactId !== spec.methodArtifactId) throw new Error("ENGINEERING_METHOD_ARTIFACT_MISMATCH");
    const store = JSON.parse(input.methodEvidence.text) as MethodKnowledge;
    const method = store.routes.find(route => route.id === spec.methodRouteId);
    if (store.version !== spec.methodVersion || !method || method.retiredOn || method.kind !== "RETRIEVAL" || method.effort?.execution !== "MACHINE" ||
        !method.outcomes.some(outcome => outcome.outcome === "YIELDED" && outcome.rows > 0) ||
        !method.claims?.some(claim => claim.class === "ROUTE_OUTCOME")) throw new Error("ENGINEERING_METHOD_NOT_PROVEN_REPEATABLE");
    if (validateKnowledge(store).some(issue => issue.id === spec.methodRouteId)) throw new Error("ENGINEERING_CANONICAL_METHOD_VALIDATION_FAILED");
    if (spec.proof.cases.length < 1 || spec.proof.cases.length > 4 || spec.proof.timeoutMs < 100 || spec.proof.timeoutMs > 5000) throw new Error("ENGINEERING_PROOF_BOUND_INVALID");
    if (new Set(spec.supportingArtifactIds).size !== spec.supportingArtifactIds.length) throw new Error("ENGINEERING_DUPLICATE_EVIDENCE");
    const evidenceById = new Map(input.supportingEvidence.map(evidence => { verifyEvidence(evidence); return [evidence.artifactId, evidence] as const; }));
    if (evidenceById.size !== input.supportingEvidence.length || spec.supportingArtifactIds.some(id => !evidenceById.has(id)) ||
        [...evidenceById.keys()].some(id => !spec.supportingArtifactIds.includes(id))) throw new Error("ENGINEERING_SUPPORTING_EVIDENCE_MISMATCH");
    const cases = spec.proof.cases.map(item => {
      const evidence = evidenceById.get(item.artifactId);
      if (!evidence || !Number.isSafeInteger(item.minimumRows) || item.minimumRows < 1 || item.expectedEntries.length < 1 ||
          !item.subjectId || !method.applicability.publishers.includes(new URL(item.publisherOrigin).hostname) ||
          new URL(evidence.canonicalUrl).origin !== item.publisherOrigin) throw new Error("ENGINEERING_PROOF_CASE_UNGROUNDED");
      return { ...item, input: { xml: evidence.text, subjectId: item.subjectId, publisherOrigin: item.publisherOrigin } };
    });
    const source = STREAMLINE_INVENTORY_SOURCE.replace("export function", "function") + "\nJSON.stringify(inventoryStreamlineSitemap(JSON.parse(INPUT_JSON)));";
    const proofs: EngineeringResult["reproducibility"]["cases"][number][] = [];
    for (const item of cases) {
      const first = await runIsolatedSource(source, item.input, spec.proof.timeoutMs) as { datedPageCount: number; entries: { sourceUrl: string; dateFromPath: string }[] };
      const second = await runIsolatedSource(source, item.input, spec.proof.timeoutMs);
      const firstOutputHash = contentHash(JSON.stringify(first));
      const replayOutputHash = contentHash(JSON.stringify(second));
      const expectedEntriesMatched = item.expectedEntries.filter(expected => first.entries.some(entry =>
        entry.sourceUrl === expected.sourceUrl && entry.dateFromPath === expected.dateFromPath)).length;
      proofs.push({ artifactId: item.artifactId, contentHash: evidenceById.get(item.artifactId)!.contentHash,
        publisherOrigin: item.publisherOrigin, returnedCount: first.datedPageCount, firstOutputHash, replayOutputHash, expectedEntriesMatched });
      if (firstOutputHash !== replayOutputHash || first.datedPageCount < item.minimumRows || expectedEntriesMatched !== item.expectedEntries.length) {
        return { ...base, verdict: "PROOF_FAILED", findings: [{ code: "ENGINEERING_DETERMINISTIC_PROOF_FAILED", detail: "Replay or independently specified output expectation failed.", severity: "BLOCKING" }],
          reproducibility: { verdict: "FAIL", isolatedExecutions: proofs.length * 2, cases: proofs, replayCommand: null } };
      }
    }
    const prefix = "review-candidates/streamline-sitemap-inventory/";
    const candidateFile = (path: string, kind: EngineeringCandidateFile["kind"], content: string): EngineeringCandidateFile => ({ path: prefix + path, kind, content, contentHash: contentHash(content) });
    const tests = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { inventoryStreamlineSitemap } from "./inventory.mjs";\n' +
      'const cases = JSON.parse(readFileSync(new URL("./proof-inputs.json", import.meta.url), "utf8"));\n' +
      'for (const item of cases) test(item.artifactId, () => { const actual = inventoryStreamlineSitemap(item.input); assert.ok(actual.datedPageCount >= item.minimumRows); for (const expected of item.expectedEntries) assert.ok(actual.entries.some(row => row.sourceUrl === expected.sourceUrl && row.dateFromPath === expected.dateFromPath)); assert.deepEqual(actual, inventoryStreamlineSitemap(item.input)); for (const row of actual.entries) for (const span of row.spans) assert.equal(item.input.xml.slice(span.start, span.end), span.quote); });\n' + STREAMLINE_BOUNDARY_TEST_SOURCE;
    const proposedFiles = [candidateFile("inventory.mjs", "IMPLEMENTATION", STREAMLINE_INVENTORY_SOURCE), candidateFile("inventory.test.mjs", "TEST", tests),
      candidateFile("proof-inputs.json", "PROOF_INPUT", JSON.stringify(cases, null, 2) + "\n")];
    return { ...base, verdict: "CANDIDATE_PROVED", affectedPaths: proposedFiles.map(file => file.path), proposedFiles,
      reproducibility: { verdict: "PASS", isolatedExecutions: proofs.length * 2, cases: proofs, replayCommand: "node --test review-candidates/streamline-sitemap-inventory/inventory.test.mjs" } };
  } catch (error) {
    return { ...base, findings: [{ code: "ENGINEERING_CANDIDATE_REFUSED", detail: error instanceof Error ? error.message : "Unknown engineering refusal", severity: "BLOCKING" }] };
  }
}
