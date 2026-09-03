/**
 * STANDING-WATCH PROVENANCE (2026-09-03, R3 — Daily Refresh truth &
 * reliability).
 *
 * The standing watch (`scripts/watch-workflows.mts`) and the failure diagnoser
 * (`scripts/diagnose-failure.mts`) may say, truthfully and from GitHub, THAT a
 * refresh workflow is red. They may not say WHY unless the causal evidence is
 * bound to the same execution. This module is the gate between the two.
 *
 * Before any causal narrative is emitted, the canonical execution result
 * (`lib/ops/execution-result.ts`) for the exact run being reported must
 * reconcile against independently observed facts:
 *
 *   - the repository,
 *   - the workflow run id,
 *   - the workflow run attempt,
 *   - the starting head SHA,
 *   - and, IF the record names a survivor commit, that commit must actually
 *     exist in the repository.
 *
 * If any of these fails to reconcile, the only allowed outcome is
 * `PROVENANCE_MISMATCH`: the causal diagnosis is suppressed, the mismatched
 * fields are named, and the watch does NOT guess which run, commit or test was
 * "probably intended".
 *
 * The observed facts come from GitHub and from git — never from a local
 * checkout's mutable state standing in for the run. A stale working tree cannot
 * override the canonical record, because this reconciler reads the record's own
 * fields and the run's own GitHub facts; it never reads `git HEAD` and treats it
 * as the run's starting SHA.
 */

import type { RefreshExecutionResult } from "./execution-result.ts";

/**
 * Facts observed about the run INDEPENDENTLY of the execution record — from the
 * GitHub Actions API (repository, run id, run attempt, the run's head SHA) and
 * from git (does a named commit exist). `commitExists` answers for the survivor
 * SHA the record claims; a reconciler with no way to check it fails safe.
 */
export interface ObservedExecutionFacts {
  repository: string;
  workflowRunId: number;
  workflowRunAttempt: number;
  /** The head SHA GitHub reports for this run. */
  headSha: string;
  /** Does this commit exist in the repository? Supplied by the caller from git. */
  commitExists: (sha: string) => boolean;
}

export interface ProvenanceMismatchField {
  field: "repository" | "workflowRunId" | "workflowRunAttempt" | "headSha" | "survivorCommitSha";
  recorded: string;
  observed: string;
}

export type ProvenanceVerdict =
  | { status: "RECONCILED" }
  | { status: "PROVENANCE_MISMATCH"; mismatches: ProvenanceMismatchField[] };

/**
 * Reconcile the canonical record against the observed facts. Returns
 * `RECONCILED` only when every bound field agrees AND any claimed survivor
 * commit exists.
 */
export function reconcileProvenance(
  record: RefreshExecutionResult,
  observed: ObservedExecutionFacts,
): ProvenanceVerdict {
  const mismatches: ProvenanceMismatchField[] = [];

  if (record.repository !== observed.repository) {
    mismatches.push({
      field: "repository",
      recorded: record.repository,
      observed: observed.repository,
    });
  }
  if (record.workflowRunId !== observed.workflowRunId) {
    mismatches.push({
      field: "workflowRunId",
      recorded: String(record.workflowRunId),
      observed: String(observed.workflowRunId),
    });
  }
  if (record.workflowRunAttempt !== observed.workflowRunAttempt) {
    mismatches.push({
      field: "workflowRunAttempt",
      recorded: String(record.workflowRunAttempt),
      observed: String(observed.workflowRunAttempt),
    });
  }
  if (record.headSha !== observed.headSha) {
    mismatches.push({ field: "headSha", recorded: record.headSha, observed: observed.headSha });
  }

  // A survivor commit that does not exist in the repository cannot be this run's
  // output — a nonexistent SHA is never accepted as a produced commit.
  const survivor = record.phases.commit.survivorCommitSha;
  if (survivor !== null && !observed.commitExists(survivor)) {
    mismatches.push({
      field: "survivorCommitSha",
      recorded: survivor,
      observed: "no such commit in the repository",
    });
  }

  if (mismatches.length > 0) return { status: "PROVENANCE_MISMATCH", mismatches };
  return { status: "RECONCILED" };
}

/**
 * A one-line, human-readable account of a mismatch, for the watch/diagnoser to
 * print INSTEAD of a causal narrative. It states what failed to reconcile and
 * never speculates about the intended run.
 */
export function renderProvenanceMismatch(
  record: RefreshExecutionResult,
  verdict: Extract<ProvenanceVerdict, { status: "PROVENANCE_MISMATCH" }>,
): string {
  const lines = [
    "PROVENANCE_MISMATCH — causal diagnosis suppressed.",
    `  execution record: ${record.repository} run ${record.workflowRunId} attempt ${record.workflowRunAttempt}`,
    "  the following provenance fields did not reconcile with the observed run:",
  ];
  for (const m of verdict.mismatches) {
    lines.push(`    - ${m.field}: record says "${m.recorded}", observed "${m.observed}"`);
  }
  lines.push(
    "  The workflow may still be reported red from GitHub, but WHY it failed is not " +
      "explained from evidence bound to a different execution.",
  );
  return lines.join("\n");
}
