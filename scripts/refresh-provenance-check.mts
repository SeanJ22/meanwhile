#!/usr/bin/env tsx
/**
 * THE PROVENANCE GATE THE STANDING WATCH PASSES THROUGH BEFORE IT EXPLAINS A
 * REFRESH FAILURE. (2026-09-03, R3 — Daily Refresh truth & reliability.)
 *
 *   corepack pnpm exec tsx scripts/refresh-provenance-check.mts \
 *       --record <path> [--run-id <id>] [--attempt <n>] [--repo <owner/repo>] \
 *       [--observed-head <sha>] [--commit-exists true|false]
 *
 * It loads the canonical execution record and reconciles it against the facts of
 * the run the watch is REPORTING — repository, run id, run attempt, starting head
 * SHA, and whether the record's survivor commit exists. On RECONCILED it prints
 * the typed diagnosis a downstream narrator may use; on PROVENANCE_MISMATCH it
 * names the fields that did not reconcile and REFUSES to emit a causal narrative.
 *
 * The observed facts come from GitHub (`gh api …/actions/runs/<id>/attempts/<n>`)
 * and git (`git cat-file -e <sha>`), never from a local checkout standing in for
 * the run. Where a caller supplies `--observed-head` / `--commit-exists` those
 * override the lookups — used by the R6 planted-attack proofs, which need to feed
 * a deliberately wrong SHA without a network round-trip.
 *
 * Exit codes: 0 RECONCILED, 3 PROVENANCE_MISMATCH, 1 could not run (no record,
 * unreadable observed facts). 3 is kept apart from 1 so a mismatch — a real,
 * reportable finding — never reads like a broken instrument.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import type { RefreshExecutionResult } from "../lib/ops/execution-result.ts";
import {
  reconcileProvenance,
  renderProvenanceMismatch,
  type ObservedExecutionFacts,
} from "../lib/ops/execution-provenance.ts";

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function fail(why: string): never {
  console.error(`refresh-provenance-check: CANNOT RUN — ${why}`);
  process.exit(1);
}

const recordPath = opt("record");
if (!recordPath) fail("no --record <path> given");
if (!existsSync(recordPath!)) fail(`no record at ${recordPath}`);

const record = JSON.parse(readFileSync(recordPath!, "utf8")) as RefreshExecutionResult;
if (record.kind !== "REFRESH_EXECUTION_RESULT") fail(`${recordPath} is not a REFRESH_EXECUTION_RESULT`);

// The run the watch is reporting. Defaults to the record's own identity, so a
// correctly-bound record reconciles; a planted attack overrides one field.
const repo = opt("repo") ?? record.repository;
const runId = Number(opt("run-id") ?? record.workflowRunId);
const attempt = Number(opt("attempt") ?? record.workflowRunAttempt);

function gh(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}
function gitHas(sha: string): boolean {
  const r = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { encoding: "utf8" });
  return r.status === 0;
}

// Observed head SHA: an override, else GitHub for this run+attempt.
let observedHead = opt("observed-head");
if (observedHead === undefined) {
  const r = gh(["api", `repos/${repo}/actions/runs/${runId}/attempts/${attempt}`, "--jq", ".head_sha"]);
  if (!r.ok || !r.out) {
    fail(
      `could not read the observed head SHA for ${repo} run ${runId} attempt ${attempt} from GitHub ` +
        "(and no --observed-head override was given)",
    );
  }
  observedHead = r.out;
}

// commitExists: an override, else git.
const commitExistsOverride = opt("commit-exists");
const commitExists =
  commitExistsOverride === undefined
    ? (sha: string) => gitHas(sha)
    : () => commitExistsOverride === "true";

const observed: ObservedExecutionFacts = {
  repository: repo,
  workflowRunId: runId,
  workflowRunAttempt: attempt,
  headSha: observedHead!,
  commitExists,
};

const verdict = reconcileProvenance(record, observed);
if (verdict.status === "PROVENANCE_MISMATCH") {
  console.error(renderProvenanceMismatch(record, verdict));
  process.exit(3);
}

console.log(
  `refresh-provenance-check: RECONCILED — ${record.repository} run ${record.workflowRunId} attempt ` +
    `${record.workflowRunAttempt} @ ${record.headSha}`,
);
console.log(`  finalStatus (typed, derived from phases): ${record.finalStatus}`);
const acquisitionLine = record.phases.acquisition.sources.map((s) => `${s.id}=${s.outcome}`).join(", ");
console.log(`  acquisition: ${acquisitionLine}`);
const failingFiles = record.phases.validation.failingTests.map((t) => t.file).join(", ");
const validationSuffix = failingFiles ? ` (${failingFiles})` : "";
console.log(`  validation: ${record.phases.validation.verdict}${validationSuffix}`);
console.log(`  commit: survivor ${record.phases.commit.survivorCommitSha ?? "none"}`);
console.log("  Provenance reconciled — a downstream narrator may explain THIS run from THIS record.");
