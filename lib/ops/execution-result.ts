/**
 * THE CANONICAL DAILY-REFRESH EXECUTION RESULT, BOUND TO THE EXACT GITHUB
 * ACTIONS EXECUTION THAT PRODUCED IT. (2026-09-03, R1/R2 — Daily Refresh
 * truth & reliability.)
 *
 * ## Why this exists beside `docs/refresh-run.json`
 *
 * `docs/refresh-run.json` (`lib/ops/refresh-report.ts`) is the run's account of
 * its own WORK — which source was due, which landed, what the gate did. It is
 * keyed by the America/Phoenix document day and it is OVERWRITTEN every run. It
 * says nothing about WHICH GitHub execution produced it, and two attempts of one
 * scheduled run leave it looking identical.
 *
 * A diagnosis, though, is a claim about a specific execution: "run 33761722124,
 * attempt 1, starting at d88356aa, failed at the FEC fetch." The CORE INVARIANT
 * of this work is that such a claim may be emitted only from the exact execution
 * it names — repository, run id, run attempt, starting head SHA, the due-source
 * set, the per-source outcomes, the validation outcome and any survivor commit
 * must all reconcile against that one run, or the system refuses to diagnose
 * rather than guess.
 *
 * So every execution emits ONE record keyed to `(repository, run_id,
 * run_attempt)`. The key is a filename, and the file is APPEND-ONLY: a second
 * write for the same `(run, attempt)` whose content differs is a bug — the run
 * happened once — and `writeExecutionResult` refuses it rather than clobbering
 * the first. It lives under `data/ops/`, which `lib/ops/deploy-paths.ts`
 * classifies as non-shipping, so recording an execution costs no build.
 *
 * ## The three phases are kept apart on purpose (R2)
 *
 * An overall-red workflow must never collapse into one ambiguous `FAILED`. A
 * failed FEC fetch is not a failed meetings fetch; a refused validator does not
 * rewrite a healthy acquisition as failed; a survivor commit does not make a
 * failed source succeed. The record carries three independent phase truths —
 * acquisition, validation, commit — and the single `finalStatus` is DERIVED
 * from them by `deriveFinalStatus`, never parsed from a log line.
 *
 * ## Provenance is machine-owned (RULING 243)
 *
 * Every identity field here comes from the runner's own environment or from git,
 * never from a model's statement. `readGithubIdentity` reads `GITHUB_*`; the
 * timestamps come from the run record the machine wrote; the survivor SHA is
 * `git rev-parse`. A model summary is downstream of this record, never its
 * source.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { GateVerdict, RefreshRun, SourceOutcome } from "./refresh-report.ts";

export const EXECUTION_DIR = "data/ops/refresh-executions";

/**
 * The identity of one GitHub Actions execution. Every field is machine-owned:
 * `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`,
 * `GITHUB_SHA`, `GITHUB_REF`. The run id and attempt TOGETHER are the key — a
 * re-run of the same run keeps the id and increments the attempt, and the two
 * are different executions with different results.
 */
export interface GithubExecutionIdentity {
  repository: string;
  workflowName: string;
  workflowRunId: number;
  workflowRunAttempt: number;
  /** The commit the workflow started from — its own checked-out head. */
  headSha: string;
  ref: string | null;
}

/** What `readGithubIdentity` could not read, so a caller can fail loudly. */
export interface IdentityGap {
  ok: false;
  missing: string[];
}

export type IdentityResult = { ok: true; identity: GithubExecutionIdentity } | IdentityGap;

/**
 * Read the execution identity from the runner environment. Returns the missing
 * variable names rather than a half-populated identity — a record keyed to a
 * blank run id would attribute every local run to the same non-execution.
 */
export function readGithubIdentity(
  env: Record<string, string | undefined> = process.env,
): IdentityResult {
  const missing: string[] = [];
  const req = (name: string): string => {
    const v = (env[name] ?? "").trim();
    if (!v) missing.push(name);
    return v;
  };
  const repository = req("GITHUB_REPOSITORY");
  const workflowName = req("GITHUB_WORKFLOW");
  const runIdRaw = req("GITHUB_RUN_ID");
  const attemptRaw = req("GITHUB_RUN_ATTEMPT");
  const headSha = req("GITHUB_SHA");
  const ref = (env["GITHUB_REF"] ?? "").trim() || null;

  const workflowRunId = Number(runIdRaw);
  const workflowRunAttempt = Number(attemptRaw);
  if (runIdRaw && !Number.isInteger(workflowRunId)) missing.push("GITHUB_RUN_ID (not an integer)");
  if (attemptRaw && !Number.isInteger(workflowRunAttempt)) missing.push("GITHUB_RUN_ATTEMPT (not an integer)");

  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    identity: { repository, workflowName, workflowRunId, workflowRunAttempt, headSha, ref },
  };
}

/* -------------------------------------------------------------------------- */
/* THE THREE TYPED PHASES (R2)                                                 */
/* -------------------------------------------------------------------------- */

/** Acquisition truth: one row per source, the outcome exactly as the run typed it. */
export interface AcquisitionPhase {
  dueSources: string[];
  sources: { id: string; due: boolean; attempted: boolean; outcome: SourceOutcome; reason: string }[];
}

/** Validation truth: did the candidate tree pass, and if not, exactly which files refused it. */
export interface ValidationPhase {
  verdict: GateVerdict;
  ranAt: string | null;
  failingTests: { file: string; attributedTo: string | null }[];
}

/** Commit/publication truth: which survivors, if any, became a commit, and its exact SHA. */
export interface CommitPhase {
  /** The commit this execution produced, or null when it committed nothing. */
  survivorCommitSha: string | null;
  /** The sources whose changed bytes the commit carried. */
  committedSources: string[];
  /** True when a commit was deliberately withheld (a red the data did not cause, or nothing usable). */
  withheld: boolean;
}

export interface ExecutionPhases {
  acquisition: AcquisitionPhase;
  validation: ValidationPhase;
  commit: CommitPhase;
}

/**
 * The final typed status of the whole execution, DERIVED from the three phases.
 *
 *   GREEN     nothing failed and the tree passed (or there was nothing to gate).
 *   DEGRADED  a survivor landed, but a source failed or the validator refused
 *             part of the data — partial progress, red workflow.
 *   REFUSED   the validator refused and nothing usable landed.
 *   FAILED    the gate could not even run, or acquisition wrote nothing usable.
 */
export type ExecutionStatus = "GREEN" | "DEGRADED" | "REFUSED" | "FAILED";
export const EXECUTION_STATUSES: readonly ExecutionStatus[] = ["GREEN", "DEGRADED", "REFUSED", "FAILED"];

/**
 * Derive the final status from typed phase state alone. No log line, no prose,
 * no exit code is read here — the exit code is a CONSEQUENCE of this, not its
 * source, so a workflow that miswired its exit code cannot lie about what
 * happened.
 */
export function deriveFinalStatus(phases: ExecutionPhases): ExecutionStatus {
  const anyFailedSource = phases.acquisition.sources.some((s) => s.outcome === "ROUTE_UNREAD");
  const committed = phases.commit.survivorCommitSha !== null;
  const v = phases.validation.verdict;

  // The gate could not tell us anything — an unreadable answer is never a pass.
  if (v === "CANNOT_RUN") return "FAILED";

  // Nothing failed and nothing was refused: healthy, whether the gate ran (GREEN)
  // or there was nothing to gate (NOT_RUN, a quiet clean day).
  if (!anyFailedSource && (v === "GREEN" || v === "NOT_RUN")) return "GREEN";

  // Something failed or was refused. If a survivor still landed, that is partial
  // progress; if nothing landed, the execution refused to advance.
  return committed ? "DEGRADED" : "REFUSED";
}

/* -------------------------------------------------------------------------- */
/* THE RECORD                                                                  */
/* -------------------------------------------------------------------------- */

export interface RefreshExecutionResult {
  formatVersion: 1;
  kind: "REFRESH_EXECUTION_RESULT";
  repository: string;
  workflowName: string;
  workflowRunId: number;
  workflowRunAttempt: number;
  headSha: string;
  ref: string | null;
  /** The document day the run computed (America/Phoenix), for cross-reference. */
  runDate: string;
  /** Machine-owned, copied from the run record the runner wrote. */
  startedAt: string;
  finishedAt: string;
  phases: ExecutionPhases;
  finalStatus: ExecutionStatus;
  /** Machine-owned provenance marker (RULING 243). */
  provenance: { emittedBy: "machine"; emittedAt: string };
}

/** Derive the typed phases from a finalised run record and the survivor SHA. */
export function phasesFromRun(run: RefreshRun, survivorCommitSha: string | null): ExecutionPhases {
  const acquisition: AcquisitionPhase = {
    dueSources: run.sources.filter((s) => s.due).map((s) => s.id),
    sources: run.sources.map((s) => ({
      id: s.id,
      due: s.due,
      attempted: s.ran,
      outcome: s.outcome,
      reason: s.reason,
    })),
  };
  const validation: ValidationPhase = {
    verdict: run.gate.verdict,
    ranAt: run.gate.ranAt,
    failingTests: run.gate.attribution.map((a) => ({ file: a.file, attributedTo: a.sourceId })),
  };
  const committedSources = run.sources
    .filter((s) => s.outcome === "INGESTED" && s.changedPaths.length > 0)
    .map((s) => s.id);
  const commit: CommitPhase = {
    survivorCommitSha,
    committedSources,
    // Withheld when a source failed or the gate refused yet no commit was made.
    withheld:
      survivorCommitSha === null &&
      (run.sources.some((s) => s.outcome === "ROUTE_UNREAD") ||
        run.gate.verdict === "REFUSED" ||
        run.gate.verdict === "CANNOT_RUN"),
  };
  return { acquisition, validation, commit };
}

/**
 * Build the canonical execution record. PURE: every value comes from the
 * identity (env), the run record (machine-written) or the survivor SHA (git).
 * `now` is the machine clock at emit time; a model-supplied timestamp has no
 * way in.
 */
export function buildExecutionResult(input: {
  identity: GithubExecutionIdentity;
  run: RefreshRun;
  survivorCommitSha: string | null;
  now: Date;
}): RefreshExecutionResult {
  const phases = phasesFromRun(input.run, input.survivorCommitSha);
  return {
    formatVersion: 1,
    kind: "REFRESH_EXECUTION_RESULT",
    repository: input.identity.repository,
    workflowName: input.identity.workflowName,
    workflowRunId: input.identity.workflowRunId,
    workflowRunAttempt: input.identity.workflowRunAttempt,
    headSha: input.identity.headSha,
    ref: input.identity.ref,
    runDate: input.run.runDate,
    startedAt: input.run.startedAt,
    finishedAt: input.run.finishedAt,
    phases,
    finalStatus: deriveFinalStatus(phases),
    provenance: { emittedBy: "machine", emittedAt: input.now.toISOString() },
  };
}

/* -------------------------------------------------------------------------- */
/* THE APPEND-ONLY STORE, KEYED TO (repository, run_id, run_attempt)           */
/* -------------------------------------------------------------------------- */

/** A filesystem-safe slug for a `owner/repo` string. */
export function repoSlug(repository: string): string {
  return repository.replace(/[^A-Za-z0-9._-]+/g, "__");
}

/**
 * The path of the record for one execution, relative to the repo root. It is
 * POSIX-separated on every platform: this string is matched against `git`
 * output and the push allowlist, both of which speak forward slashes.
 */
export function executionResultRelPath(id: {
  repository: string;
  workflowRunId: number;
  workflowRunAttempt: number;
}): string {
  return `${EXECUTION_DIR}/${repoSlug(id.repository)}__run-${id.workflowRunId}__attempt-${id.workflowRunAttempt}.json`;
}

/**
 * Write the record for this execution. APPEND-ONLY / IMMUTABLE: a record for a
 * `(run, attempt)` that already exists on disk with DIFFERENT content is
 * refused — the execution happened once and its result cannot be rewritten. An
 * identical re-write is a no-op and returns `false` (nothing changed).
 */
export function writeExecutionResult(root: string, record: RefreshExecutionResult): boolean {
  const rel = executionResultRelPath(record);
  const abs = join(root, rel);
  const next = `${JSON.stringify(record, null, 2)}\n`;
  if (existsSync(abs)) {
    const current = readFileSync(abs, "utf8");
    if (current === next) return false;
    throw new Error(
      `execution result for ${record.repository} run ${record.workflowRunId} attempt ` +
        `${record.workflowRunAttempt} already exists with different content at ${rel}; ` +
        "an execution result is immutable — a run happened once and cannot be rewritten.",
    );
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next, "utf8");
  return true;
}

export function readExecutionResult(
  root: string,
  id: { repository: string; workflowRunId: number; workflowRunAttempt: number },
): RefreshExecutionResult | null {
  const abs = join(root, executionResultRelPath(id));
  if (!existsSync(abs)) return null;
  const parsed = JSON.parse(readFileSync(abs, "utf8")) as RefreshExecutionResult;
  if (parsed.formatVersion !== 1 || parsed.kind !== "REFRESH_EXECUTION_RESULT") {
    throw new Error(`${executionResultRelPath(id)}: not a formatVersion 1 execution result`);
  }
  return parsed;
}

/** Every execution record on disk, newest run first. For the standing watch. */
export function listExecutionResults(root: string): RefreshExecutionResult[] {
  const dir = join(root, EXECUTION_DIR);
  if (!existsSync(dir)) return [];
  const out: RefreshExecutionResult[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as RefreshExecutionResult;
    if (parsed.formatVersion === 1 && parsed.kind === "REFRESH_EXECUTION_RESULT") out.push(parsed);
  }
  return out.sort(
    (a, b) => b.workflowRunId - a.workflowRunId || b.workflowRunAttempt - a.workflowRunAttempt,
  );
}
