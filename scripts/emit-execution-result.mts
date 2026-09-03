#!/usr/bin/env tsx
/**
 * EMIT THE CANONICAL EXECUTION RESULT FOR THIS GITHUB ACTIONS RUN. (2026-09-03,
 * R1 — Daily Refresh truth & reliability.)
 *
 *   corepack pnpm exec tsx scripts/emit-execution-result.mts [--out <dir>]
 *
 * Runs at the END of the refresh workflow, on the green path and the red one
 * (`always()`), after the commit step. It binds the run record the machine just
 * wrote (`docs/refresh-run.json`) to THIS execution's identity — repository, run
 * id, run attempt, starting head SHA, all read from `GITHUB_*` — and to the
 * survivor commit this run actually landed on `main`, and writes one immutable
 * record keyed to `(repository, run_id, run_attempt)`.
 *
 * The survivor SHA is derived from git reality, never asserted: it is the local
 * HEAD only when HEAD moved off the run's starting SHA AND is an ancestor of
 * `origin/main` (i.e. the commit actually landed). A commit that was made but
 * whose push failed is NOT a survivor — nothing landed — and the record says
 * null, which is the truth the standing watch will later verify with
 * `commitExists`.
 *
 * The record is written under `--out` (default the runner temp) so the workflow
 * can upload it as an artifact GitHub keys to this exact run and attempt. It is
 * NOT committed: the artifact is the durable, immutable, per-run store, and a
 * per-run commit would be the ceremonial commit RULING 124 ended.
 *
 * A local invocation with no `GITHUB_*` identity prints what is missing and
 * exits 0 — this is a workflow instrument, and a developer running it by hand
 * is not a failure.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { readRefreshRun } from "../lib/ops/refresh-report.ts";
import {
  buildExecutionResult,
  executionResultRelPath,
  readGithubIdentity,
  writeExecutionResult,
} from "../lib/ops/execution-result.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const outDir = argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  ?? (argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined)
  ?? process.env.RUNNER_TEMP
  ?? ROOT;

function git(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/**
 * The commit this run landed on `main`, or null. HEAD is the survivor only when
 * it moved off the starting SHA and is reachable from `origin/main`.
 */
function survivorSha(startingSha: string): string | null {
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok || !head.out || head.out === startingSha) return null;
  // Refresh the remote-tracking ref cheaply; a failure here just means we cannot
  // confirm the landing, so we fall back to "did not land".
  git(["fetch", "origin", "main", "--quiet"]);
  const landed = spawnSync("git", ["merge-base", "--is-ancestor", head.out, "origin/main"], { cwd: ROOT });
  return landed.status === 0 ? head.out : null;
}

const identity = readGithubIdentity();
if (!identity.ok) {
  console.log(
    `emit-execution-result: no GitHub execution identity (missing ${identity.missing.join(", ")}). ` +
      "This is a workflow instrument; a local run has nothing to bind. Nothing written.",
  );
  process.exit(0);
}

const run = readRefreshRun(ROOT);
if (!run) {
  console.error("emit-execution-result: docs/refresh-run.json does not exist — no run to bind. Nothing written.");
  process.exit(0);
}

const survivor = survivorSha(identity.identity.headSha);
const record = buildExecutionResult({
  identity: identity.identity,
  run,
  survivorCommitSha: survivor,
  now: new Date(),
});

// Write under `outDir` using the canonical relative key, so the artifact carries
// the immutable-store layout and `writeExecutionResult`'s append-only guarantee.
mkdirSync(outDir, { recursive: true });
try {
  const wrote = writeExecutionResult(outDir, record);
  const rel = executionResultRelPath(record);
  console.log(
    `emit-execution-result: ${wrote ? "wrote" : "already present (identical)"} ${join(outDir, rel)}`,
  );
} catch (e) {
  // An immutability refusal here means this (run, attempt) already emitted a
  // DIFFERENT record — a real bug worth failing on, but not one that should turn
  // a green refresh red at its very last step, so it is loud and exit 0.
  console.error(`emit-execution-result: ${String(e instanceof Error ? e.message : e)}`);
}

console.log(
  `emit-execution-result: ${record.repository} run ${record.workflowRunId} attempt ${record.workflowRunAttempt} ` +
    `— finalStatus ${record.finalStatus}, survivor ${record.phases.commit.survivorCommitSha ?? "none"}`,
);
