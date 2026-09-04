import type { WorkerRef } from "../attempt.ts";
import type { CapabilityGrant } from "../capability.ts";
import type { WorkerEvidence, WorkerFinding } from "./types.ts";

/** Review-only engineering input. Evidence bytes remain in the existing vault. */
export interface EngineeringTaskSpec {
  readonly schemaVersion: 1;
  readonly methodRouteId: string;
  readonly methodVersion: number;
  readonly methodArtifactId: string;
  readonly validation: {
    readonly resultId: string;
    readonly attemptId: string;
    /** Overall civic verdict is preserved; extraction proof does not imply external verification. */
    readonly verdict: "PASS" | "INCONCLUSIVE";
    readonly validatedAspect: "SOURCE_EXTRACTION";
  };
  readonly supportingArtifactIds: readonly string[];
  readonly existingInterface: { readonly id: "streamline-sitemap-inventory"; readonly version: 1 };
  readonly expectedBehavior: readonly string[];
  readonly proof: {
    readonly timeoutMs: number;
    readonly cases: readonly {
      readonly artifactId: string;
      readonly subjectId: string;
      readonly publisherOrigin: string;
      readonly minimumRows: number;
      readonly expectedEntries: readonly { readonly sourceUrl: string; readonly dateFromPath: string }[];
    }[];
  };
}

export interface EngineeringWorkerInput {
  readonly spec: EngineeringTaskSpec;
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly grant: CapabilityGrant;
  readonly methodEvidence: WorkerEvidence;
  readonly supportingEvidence: readonly WorkerEvidence[];
}

export interface EngineeringCandidateFile {
  readonly path: string;
  readonly kind: "IMPLEMENTATION" | "TEST" | "PROOF_INPUT";
  readonly content: string;
  readonly contentHash: string;
}

export interface EngineeringResult {
  readonly role: "ENGINEERING";
  readonly attemptId: string;
  readonly schemaVersion: 1;
  readonly implementation: "review-only-method-engineering";
  readonly version: "1.0.0";
  readonly verdict: "CANDIDATE_PROVED" | "REFUSED" | "PROOF_FAILED";
  readonly findings: readonly WorkerFinding[];
  readonly artifactIds: readonly string[];
  readonly methodRouteId: string;
  readonly methodVersion: number;
  readonly methodContentHash: string;
  readonly validationResultId: string;
  readonly affectedPaths: readonly string[];
  readonly proposedFiles: readonly EngineeringCandidateFile[];
  readonly learnedProcedure: readonly string[];
  readonly reproducibility: {
    readonly verdict: "PASS" | "FAIL" | "NOT_RUN";
    readonly isolatedExecutions: number;
    readonly cases: readonly {
      readonly artifactId: string;
      readonly contentHash: string;
      readonly publisherOrigin: string;
      readonly returnedCount: number;
      readonly firstOutputHash: string;
      readonly replayOutputHash: string;
      readonly expectedEntriesMatched: number;
    }[];
    readonly replayCommand: string | null;
  };
  readonly unresolvedRisks: readonly string[];
  readonly adoption: "INTEGRATION_REVIEW_REQUIRED";
}
