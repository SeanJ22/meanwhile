/**
 * @freshness-reads-here
 *
 * One source-isolated pass of the permanent routine civic-data data plane.
 * The standing local pilot calls this after its own cycle; this process owns
 * only data cadence and can neither commit nor invoke a software release.
 * `lastAttemptedAt` and `lastSucceededAt` are execution receipts minted by the
 * runner that invokes acquisition; they never replace a candidate's own
 * source-through or retrieved-at evidence.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

interface RunnerState {
  readonly formatVersion: 1;
  readonly sources: Readonly<Record<string, RoutineTaskClock & { readonly lastState?: string; readonly lastFailure?: string }>>;
}

const ROOT = process.cwd();
const STATE_PATH = join(ROOT, ".mirror", "routine-civic-data-runner.json");
const FORCE = process.argv.includes("--force");
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;
const TIMEOUT_MS = 30 * 60_000;

function readState(): RunnerState {
  if (!existsSync(STATE_PATH)) return { formatVersion: 1, sources: {} };
  try {
    const value = JSON.parse(readFileSync(STATE_PATH, "utf8")) as RunnerState;
    return value.formatVersion === 1 && value.sources ? value : { formatVersion: 1, sources: {} };
  } catch {
    return { formatVersion: 1, sources: {} };
  }
}

function writeState(state: RunnerState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function safeFailure(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credentials-redacted]@")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ")
    .slice(0, 4_000) || "The source process exited without a diagnostic.";
}

function emittedReceipt(output: string): boolean {
  return output.split(/\r?\n/).some((line) => line.startsWith("RCD_RECEIPT="));
}

async function persistPreCandidateFailure(task: (typeof ROUTINE_SOURCE_TASKS)[number], attemptedAt: string, detail: string): Promise<string> {
  const handle = resolveProductionWriteHandle();
  process.env.DATABASE_URL = handle.connection;
  process.env.WTP_DB_ROLE = "production";
  process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
  assertWriteAllowed("a routine civic data candidate/version promotion");
  const candidate = failedAcquisitionCandidate({
    sourceId: task.sourceId,
    recordClass: task.recordClass,
    scope: task.scope,
    requestedUrl: task.requestedUrl,
    attemptedAt,
    failureDetail: detail,
    parserVersion: task.parserVersion,
  });
  const outcome = await processRoutineCandidate(new PostgresRoutineDataStore(), candidate, attemptedAt);
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: task.id,
    candidateId: candidate.id,
    acquisitionSucceeded: false,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    releaseEvents: ZERO_RELEASE_EVENTS,
  }));
  return outcome.candidate.state;
}

const before = readState();
const sources: Record<string, RoutineTaskClock & { lastState?: string; lastFailure?: string }> = { ...before.sources };
let attempted = 0;
let failed = 0;

for (const task of ROUTINE_SOURCE_TASKS) {
  if (ONLY && !ONLY.has(task.id)) continue;
  const now = Date.now();
  if (!FORCE && !routineTaskDue(task, sources[task.id], now)) {
    console.log(`RCD_SKIP ${task.id}: cadence not due`);
    continue;
  }
  attempted += 1;
  const attemptedAt = new Date(now).toISOString();
  const run = spawnSync(process.execPath, ["--experimental-strip-types", ...task.command], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  for (const line of output.split(/\r?\n/).filter((line) => line.startsWith("RCD_RECEIPT="))) console.log(line);
  let state = run.status === 0 ? "PROMOTED" : "SOURCE_BLOCKED";
  let failure: string | undefined;
  if (run.status !== 0) {
    failed += 1;
    failure = safeFailure(run.error?.message ?? output);
    if (!emittedReceipt(output)) {
      try {
        state = await persistPreCandidateFailure(task, attemptedAt, failure);
      } catch (error) {
        failure = `${failure} | DURABILITY_FAILURE: ${safeFailure(error instanceof Error ? error.message : String(error))}`;
      }
    }
  }
  sources[task.id] = {
    lastAttemptedAt: attemptedAt,
    ...(run.status === 0 ? { lastSucceededAt: attemptedAt } : sources[task.id]?.lastSucceededAt ? { lastSucceededAt: sources[task.id].lastSucceededAt } : {}),
    lastState: state,
    ...(failure ? { lastFailure: failure } : {}),
  };
  writeState({ formatVersion: 1, sources });
  console.log(`RCD_TASK ${task.id}: ${run.status === 0 ? "GOOD" : "HELD_LKG"} (${state})`);
}

const attemptedCount = floored(
  "attempted routine source tasks",
  "the configured routine source-task registry",
  ROUTINE_SOURCE_TASKS.length,
  attempted,
);
console.log("RCD_RUN=" + JSON.stringify({
  attempted: attemptedCount.matched,
  denominator: attemptedCount.denominator,
  failed,
  skipped: attemptedCount.denominator - attemptedCount.matched,
  releaseEvents: ZERO_RELEASE_EVENTS,
}));
if (failed > 0) process.exitCode = 2;
