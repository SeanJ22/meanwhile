/**
 * R1/R2/R3 — the canonical Daily Refresh execution result, its typed phases,
 * and standing-watch provenance. (2026-09-03, Daily Refresh truth &
 * reliability.)
 *
 * These are the permanent regression controls the brief requires: a future
 * change that lets one run's result be attributed to another, mixes run
 * attempts, accepts a nonexistent commit SHA, lets a local checkout override
 * the canonical run, rewrites a successful acquisition as failed because
 * validation failed, or rewrites a failed source as successful because a
 * survivor commit exists, must go red here.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { RefreshRun } from "../lib/ops/refresh-report.ts";
import {
  buildExecutionResult,
  deriveFinalStatus,
  executionResultRelPath,
  phasesFromRun,
  readExecutionResult,
  readGithubIdentity,
  writeExecutionResult,
  type GithubExecutionIdentity,
  type RefreshExecutionResult,
} from "../lib/ops/execution-result.ts";
import {
  reconcileProvenance,
  type ObservedExecutionFacts,
} from "../lib/ops/execution-provenance.ts";

/* --------------------------------------------------------------- fixtures */

const IDENTITY: GithubExecutionIdentity = {
  repository: "SeanJ22/meanwhile",
  workflowName: "Refresh (daily, all sources)",
  workflowRunId: 33761722124,
  workflowRunAttempt: 1,
  headSha: "d88356aacc076b07f5bb2e27de164b3cc95f9098",
  ref: "refs/heads/main",
};

function makeRun(over: Partial<RefreshRun> = {}): RefreshRun {
  return {
    formatVersion: 1,
    runDate: "2026-09-03",
    startedAt: "2026-09-03T13:33:10.442Z",
    finishedAt: "2026-09-03T13:48:56.108Z",
    mode: "CADENCE",
    exitCode: 2,
    sources: [
      {
        id: "meetings",
        due: true,
        ran: true,
        outcome: "INGESTED",
        reason: "ran clean and its bytes moved",
        commands: ["ingest"],
        failedCommand: null,
        exitCode: 0,
        governs: ["data/meetings-snapshot.json"],
        changedPaths: ["data/meetings-snapshot.json"],
        recoveredFrom: [],
        nextDueAt: "2026-09-04",
      },
      {
        id: "fec",
        due: true,
        ran: true,
        outcome: "ROUTE_UNREAD",
        reason: "failed at `pnpm fec:fetch` (exit 1)",
        commands: ["fec:fetch"],
        failedCommand: "fec:fetch",
        exitCode: 1,
        governs: ["data/fec/fec-2026.json"],
        changedPaths: [],
        recoveredFrom: [],
        nextDueAt: "2026-09-04",
      },
      {
        id: "legiscan",
        due: false,
        ran: false,
        outcome: "NOT_DUE",
        reason: "weekly, not due today",
        commands: ["legiscan:fetch"],
        failedCommand: null,
        exitCode: null,
        governs: ["data/votes/state-votes-snapshot.json"],
        changedPaths: [],
        recoveredFrom: [],
        nextDueAt: "2026-09-07",
      },
    ],
    catchUp: { lastLanded: "2026-09-02", days: ["2026-09-03"], cap: 14, off: false },
    gate: { verdict: "GREEN", ranAt: "2026-09-03T13:47:00Z", failingFiles: [], attribution: [], note: "" },
    ...over,
  };
}

function withTmp(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "wtp-exec-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* =========================================================== R1: identity */

test("R1: two attempts of the same run are distinct records with distinct keys", () => {
  withTmp((root) => {
    const a1 = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "aaa111", now: new Date() });
    const a2 = buildExecutionResult({
      identity: { ...IDENTITY, workflowRunAttempt: 2 },
      run: makeRun(),
      survivorCommitSha: "bbb222",
      now: new Date(),
    });
    assert.notEqual(executionResultRelPath(a1), executionResultRelPath(a2));
    assert.equal(writeExecutionResult(root, a1), true);
    assert.equal(writeExecutionResult(root, a2), true);
    // Both survive; attempt 1 is not overwritten by attempt 2.
    assert.equal(readExecutionResult(root, IDENTITY)!.phases.commit.survivorCommitSha, "aaa111");
    assert.equal(
      readExecutionResult(root, { ...IDENTITY, workflowRunAttempt: 2 })!.phases.commit.survivorCommitSha,
      "bbb222",
    );
  });
});

test("R1: a result from run A cannot be read back under run B's key", () => {
  withTmp((root) => {
    const a = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "aaa111", now: new Date() });
    writeExecutionResult(root, a);
    // A different run id has no record; nothing from run A leaks to it.
    assert.equal(readExecutionResult(root, { ...IDENTITY, workflowRunId: 999 }), null);
  });
});

test("R1: the store is immutable — a differing rewrite for the same (run, attempt) is refused", () => {
  withTmp((root) => {
    const first = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "aaa111", now: new Date() });
    writeExecutionResult(root, first);
    // Identical content is a no-op.
    assert.equal(writeExecutionResult(root, first), false);
    // Different content for the same key is refused.
    const rewritten = { ...first, phases: { ...first.phases, commit: { ...first.phases.commit, survivorCommitSha: "zzz999" } } } as RefreshExecutionResult;
    assert.throws(() => writeExecutionResult(root, rewritten), /immutable|already exists/i);
  });
});

test("R1: timestamps are machine-owned — taken from the run record, not an argument", () => {
  const run = makeRun({ startedAt: "2026-09-03T13:33:10.442Z", finishedAt: "2026-09-03T13:48:56.108Z" });
  const record = buildExecutionResult({ identity: IDENTITY, run, survivorCommitSha: null, now: new Date("2020-01-01T00:00:00Z") });
  // startedAt/finishedAt come from the machine-written run record verbatim.
  assert.equal(record.startedAt, "2026-09-03T13:33:10.442Z");
  assert.equal(record.finishedAt, "2026-09-03T13:48:56.108Z");
  // emittedAt is the machine clock passed as `now`; there is no model-supplied slot.
  assert.equal(record.provenance.emittedBy, "machine");
  assert.equal(record.provenance.emittedAt, "2020-01-01T00:00:00.000Z");
});

test("R1: readGithubIdentity names the missing variables rather than inventing a blank identity", () => {
  const gap = readGithubIdentity({ GITHUB_REPOSITORY: "SeanJ22/meanwhile" } as NodeJS.ProcessEnv);
  assert.equal(gap.ok, false);
  if (!gap.ok) {
    assert.ok(gap.missing.includes("GITHUB_RUN_ID"));
    assert.ok(gap.missing.includes("GITHUB_RUN_ATTEMPT"));
    assert.ok(gap.missing.includes("GITHUB_SHA"));
  }
  const ok = readGithubIdentity({
    GITHUB_REPOSITORY: "SeanJ22/meanwhile",
    GITHUB_WORKFLOW: "Refresh (daily, all sources)",
    GITHUB_RUN_ID: "33761722124",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: "d88356aa",
    GITHUB_REF: "refs/heads/main",
  } as NodeJS.ProcessEnv);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.identity.workflowRunId, 33761722124);
});

/* ============================================================ R2: phases */

test("R2: one source fails while another succeeds — the outcomes stay apart", () => {
  const phases = phasesFromRun(makeRun(), "aaa111");
  const meetings = phases.acquisition.sources.find((s) => s.id === "meetings")!;
  const fec = phases.acquisition.sources.find((s) => s.id === "fec")!;
  assert.equal(meetings.outcome, "INGESTED");
  assert.equal(fec.outcome, "ROUTE_UNREAD");
});

test("R2: a not-due source is distinguishable from a failed source", () => {
  const phases = phasesFromRun(makeRun(), "aaa111");
  const legiscan = phases.acquisition.sources.find((s) => s.id === "legiscan")!;
  assert.equal(legiscan.outcome, "NOT_DUE");
  assert.equal(legiscan.due, false);
  assert.ok(!phases.acquisition.dueSources.includes("legiscan"));
  assert.ok(phases.acquisition.dueSources.includes("fec"));
});

test("R2: validation can fail independently of a successful source", () => {
  // meetings SUCCEEDED at acquisition, yet the gate REFUSED the tree.
  const run = makeRun({
    gate: {
      verdict: "REFUSED",
      ranAt: "2026-09-03T13:47:00Z",
      failingFiles: ["tests/coverage-matrix.test.ts"],
      attribution: [{ file: "tests/coverage-matrix.test.ts", sourceId: null, basis: "the tree's" }],
      note: "",
    },
  });
  const phases = phasesFromRun(run, null);
  assert.equal(phases.acquisition.sources.find((s) => s.id === "meetings")!.outcome, "INGESTED");
  assert.equal(phases.validation.verdict, "REFUSED");
  assert.deepEqual(phases.validation.failingTests, [{ file: "tests/coverage-matrix.test.ts", attributedTo: null }]);
});

test("R2: a healthy survivor can be committed while the overall status stays red", () => {
  // fec failed, meetings survived and was committed. Overall DEGRADED, not FAILED,
  // and the failed source is NOT rewritten as successful because a commit exists.
  const phases = phasesFromRun(makeRun(), "surv123");
  assert.equal(phases.commit.survivorCommitSha, "surv123");
  assert.deepEqual(phases.commit.committedSources, ["meetings"]);
  assert.equal(deriveFinalStatus(phases), "DEGRADED");
  assert.equal(phases.acquisition.sources.find((s) => s.id === "fec")!.outcome, "ROUTE_UNREAD");
});

test("R2: the final status is derived from typed phase state, not a prose or exit code", () => {
  // Clean day: all green, gate GREEN, a survivor committed.
  const clean = phasesFromRun(
    makeRun({
      sources: makeRun().sources.map((s) => (s.id === "fec" ? { ...s, outcome: "INGESTED", reason: "clean", changedPaths: ["data/fec/fec-2026.json"], failedCommand: null, exitCode: 0 } : s)),
      gate: { verdict: "GREEN", ranAt: "x", failingFiles: [], attribution: [], note: "" },
    }),
    "surv",
  );
  assert.equal(deriveFinalStatus(clean), "GREEN");

  // Nothing failed, nothing to gate (quiet day): still GREEN.
  const quiet = phasesFromRun(
    makeRun({
      sources: makeRun().sources.map((s) => (s.id === "fec" ? { ...s, outcome: "UNCHANGED", reason: "byte-identical", failedCommand: null, exitCode: 0 } : { ...s, outcome: s.outcome === "INGESTED" ? "UNCHANGED" : s.outcome })),
      gate: { verdict: "NOT_RUN", ranAt: null, failingFiles: [], attribution: [], note: "" },
    }),
    null,
  );
  assert.equal(deriveFinalStatus(quiet), "GREEN");

  // A source failed and nothing landed: REFUSED.
  const refused = phasesFromRun(
    makeRun({ sources: makeRun().sources.map((s) => (s.id === "meetings" ? { ...s, outcome: "ROUTE_UNREAD", changedPaths: [] } : s)), gate: { verdict: "REFUSED", ranAt: "x", failingFiles: ["t"], attribution: [], note: "" } }),
    null,
  );
  assert.equal(deriveFinalStatus(refused), "REFUSED");

  // The gate could not run at all: FAILED.
  const cannot = phasesFromRun(makeRun({ gate: { verdict: "CANNOT_RUN", ranAt: null, failingFiles: [], attribution: [], note: "" } }), null);
  assert.equal(deriveFinalStatus(cannot), "FAILED");
});

/* ======================================================= R3: provenance */

function observed(over: Partial<ObservedExecutionFacts> = {}): ObservedExecutionFacts {
  return {
    repository: IDENTITY.repository,
    workflowRunId: IDENTITY.workflowRunId,
    workflowRunAttempt: IDENTITY.workflowRunAttempt,
    headSha: IDENTITY.headSha,
    commitExists: () => true,
    ...over,
  };
}

test("R3: a correctly bound run reconciles", () => {
  const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "surv123", now: new Date() });
  const verdict = reconcileProvenance(record, observed());
  assert.equal(verdict.status, "RECONCILED");
});

test("R3: a nonexistent survivor SHA yields PROVENANCE_MISMATCH", () => {
  const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "ghost999", now: new Date() });
  const verdict = reconcileProvenance(record, observed({ commitExists: (sha) => sha !== "ghost999" }));
  assert.equal(verdict.status, "PROVENANCE_MISMATCH");
  if (verdict.status === "PROVENANCE_MISMATCH") {
    assert.ok(verdict.mismatches.some((m) => m.field === "survivorCommitSha"));
  }
});

test("R3: the wrong workflow run id yields PROVENANCE_MISMATCH", () => {
  const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: null, now: new Date() });
  const verdict = reconcileProvenance(record, observed({ workflowRunId: 111 }));
  assert.equal(verdict.status, "PROVENANCE_MISMATCH");
  if (verdict.status === "PROVENANCE_MISMATCH") assert.ok(verdict.mismatches.some((m) => m.field === "workflowRunId"));
});

test("R3: the correct run id but wrong run attempt yields PROVENANCE_MISMATCH", () => {
  const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: null, now: new Date() });
  const verdict = reconcileProvenance(record, observed({ workflowRunAttempt: 2 }));
  assert.equal(verdict.status, "PROVENANCE_MISMATCH");
  if (verdict.status === "PROVENANCE_MISMATCH") assert.ok(verdict.mismatches.some((m) => m.field === "workflowRunAttempt"));
});

test("R3: a later main SHA cannot silently replace the run's starting SHA", () => {
  const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: null, now: new Date() });
  // The observed run's head SHA differs (e.g. main advanced): the record's own
  // starting SHA is authoritative and the mismatch is surfaced, not accepted.
  const verdict = reconcileProvenance(record, observed({ headSha: "f00dbabe-later-main" }));
  assert.equal(verdict.status, "PROVENANCE_MISMATCH");
  if (verdict.status === "PROVENANCE_MISMATCH") assert.ok(verdict.mismatches.some((m) => m.field === "headSha"));
});

test("R3: a stale local checkout cannot override the canonical run", () => {
  // The reconciler never reads a local git HEAD; it compares the record's fields
  // to the run's own GitHub facts. So whatever a local checkout is sitting on,
  // a correctly bound record still reconciles.
  const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "surv123", now: new Date() });
  // `commitExists` here answers from the repository, not from a checked-out HEAD.
  const verdict = reconcileProvenance(record, observed({ commitExists: (sha) => sha === "surv123" }));
  assert.equal(verdict.status, "RECONCILED");
});

/* ===================================================== the on-disk key */

test("R1: the on-disk key contains the repository, run id and run attempt", () => {
  const rel = executionResultRelPath(IDENTITY);
  assert.match(rel, /SeanJ22__meanwhile/);
  assert.match(rel, /run-33761722124/);
  assert.match(rel, /attempt-1/);
  assert.ok(rel.startsWith("data/ops/refresh-executions/"));
});

test("R1: a written record round-trips through the durable store", () => {
  withTmp((root) => {
    const record = buildExecutionResult({ identity: IDENTITY, run: makeRun(), survivorCommitSha: "surv123", now: new Date() });
    writeExecutionResult(root, record);
    const abs = join(root, executionResultRelPath(IDENTITY));
    const onDisk = JSON.parse(readFileSync(abs, "utf8")) as RefreshExecutionResult;
    assert.deepEqual(onDisk, record);
    // and the parent directory is the one the deploy-path classifier treats as non-shipping.
    assert.ok(dirname(abs).replace(/\\/g, "/").endsWith("data/ops/refresh-executions"));
    void writeFileSync;
    void mkdirSync;
  });
});
