import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { readAdminRunnerProgress, RUNNER_PROGRESS_HEARTBEAT_FIELDS,
  RUNNER_PROGRESS_RESEARCH_FIELDS } from "../lib/control-plane/admin-view/runner-progress-read.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, type OwnerDigestRecord, type RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { RESEARCH_STATE_ID, type ResearchState } from "../lib/control-plane/scheduler/research-policy.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { liveCycleHeartbeat } from "../lib/control-plane/runner-standing.ts";
import { ADMIN_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const NOW = "2026-09-28T17:00:00.000Z";
const AT = "2026-09-28T16:59:00.000Z";

test("bounded cycle reading preserves actual exit, withholds malformed metadata and hides credential URLs", async () => {
  const repos = createMemoryRepositories();
  const beat = liveCycleHeartbeat(null, { at: AT, startedAt: "2026-09-28T16:30:00.000Z",
    finishedAt: AT, exitCode: 2, signal: null, lastError: "failure at postgresql://private:pass@host/db",
    testedSha: "a".repeat(40), host: "runner" });
  await repos.runnerHeartbeat.put(RUNNER_ID, beat, AT);
  const read = await readAdminRunnerProgress(repos, NOW);
  assert.equal(read.heartbeat.cycle?.exitCode, 2);
  assert.equal(read.heartbeat.cycle?.finishedAt, AT);
  assert.equal(read.heartbeat.cycle?.lastError, "failure at [redacted URL]");
  assert.doesNotMatch(JSON.stringify(read), /private|pass@/);
  const held = await repos.runnerHeartbeat.mustRead(RUNNER_ID);
  const malformed = { ...beat, cycle: { ...beat.cycle, finishedAt: null } };
  await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, held.revision, malformed, AT);
  assert.equal((await readAdminRunnerProgress(repos, NOW)).heartbeat.cycle, null);
});

test("runner progress keeps unpublished and unread distinct, with no false zero-progress assertion", async () => {
  const repos = createMemoryRepositories();
  const empty = await readAdminRunnerProgress(repos, NOW);
  assert.equal(empty.heartbeat.state, "NOT_RECORDED");
  assert.equal(empty.research.state, "NOT_RECORDED");
  assert.equal(empty.latestSourceEvent.state, "NOT_RECORDED");
  assert.equal(empty.lastConfirmedSourceProgressAt, null);

  const failed = await readAdminRunnerProgress({ ...repos,
    runnerHeartbeat: { ...repos.runnerHeartbeat, readNarrowed: async () => { throw Error("postgresql://private:pass@host"); } },
    researchState: { ...repos.researchState, readNarrowed: async () => { throw Error("private"); } },
    ownerDigests: { ...repos.ownerDigests, readRecent: async () => { throw Error("private"); } },
  }, NOW);
  assert.equal(failed.heartbeat.state, "UNREAD");
  assert.equal(failed.research.state, "UNREAD");
  assert.equal(failed.latestSourceEvent.state, "UNREAD");
  assert.doesNotMatch(JSON.stringify(failed), /private|postgresql/i);
});

test("bounded read separates live beat, current starts, completed publication window and source receipt", async () => {
  const repos = createMemoryRepositories();
  await repos.runnerHeartbeat.put(RUNNER_ID, { beatAt: AT, lastCycleStartedAt: AT, lastCycleFinishedAt: null,
    lastCycleOk: null, nextCycleDueAt: null, testedSha: "a".repeat(40),
    host: "runner", formatVersion: 1, privateData: "MUST_NOT_LEAVE_STORE" } as RunnerHeartbeat, AT);
  await repos.researchState.put(RESEARCH_STATE_ID, { beatAt: AT, cycleStartedAt: AT,
    cycleFinishedAt: null, testedSha: "a".repeat(40), pausedByOwner: false,
    modelLaneEnabled: true, modelLaneDisabledReason: null,
    queue: { modelClassDue: 2, deterministicDue: 1, modelClassDispatchedThisCycle: 1,
      deterministicDispatchedThisCycle: 0, autonomousDispatchedThisCycle: 1, lanes: null },
    running: [{ attemptId: "at-1", obligationId: "ob-1", startedAt: AT, assignmentKeys: ["receipt-1"] }],
    spend: { windowUsd: null, measuredAttempts: 2, unmeasuredAttempts: 1, asOf: AT },
    researchProgression: { windowId: "window-1", since: "2026-09-28T15:00:00.000Z", through: AT,
      promoted: { count: 2, unit: "RECORDS", reason: "recorded" },
      readerVisible: { count: null, unit: "RECORDS", reason: "No reader check recorded" },
      hugeDroppedEvidence: "MUST_NOT_LEAVE_STORE" },
    privateData: "MUST_NOT_LEAVE_STORE" } as unknown as ResearchState, AT);
  const source: OwnerDigestRecord = { formatVersion: 1, digestId: "source-1", writtenAt: AT,
    headline: "source", lines: ["MUST_NOT_LEAVE_STORE"], cycleOk: null, testedSha: null,
    huntSourceProgress: { at: AT, stage: "PUBLISHED", taskId: "task-1", sourceId: "source-1",
      scope: "az", instructionIds: ["receipt-1"], detail: "MUST_NOT_LEAVE_STORE",
      candidateId: null, readerPaths: ["/ballot"] } };
  await repos.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, "source-1", source, AT);
  const reads: string[] = [];
  const narrowed: ControlPlaneRepositories = { ...repos,
    runnerHeartbeat: { ...repos.runnerHeartbeat, readNarrowed: async (id, projection) => {
      assert.equal(id, RUNNER_ID); assert.deepEqual(projection, RUNNER_PROGRESS_HEARTBEAT_FIELDS);
      reads.push("heartbeat"); return repos.runnerHeartbeat.readNarrowed(id, projection);
    }, read: async () => { throw Error("whole heartbeat read"); } },
    researchState: { ...repos.researchState, readNarrowed: async (id, projection) => {
      assert.equal(id, RESEARCH_STATE_ID); assert.deepEqual(projection, RUNNER_PROGRESS_RESEARCH_FIELDS);
      reads.push("research"); return repos.researchState.readNarrowed(id, projection);
    }, read: async () => { throw Error("whole research read"); } },
    ownerDigests: { ...repos.ownerDigests, readRecent: async (key, limit) => {
      assert.equal(key, HUNT_SOURCE_PROGRESS_LOG_KEY); assert.equal(limit, 1);
      reads.push("source"); return repos.ownerDigests.readRecent(key, limit);
    }, readAll: async () => { throw Error("full digest scan"); } },
  };
  const result = await readAdminRunnerProgress(narrowed, NOW);
  assert.deepEqual(reads.sort(), ["heartbeat", "research", "source"]);
  assert.equal(result.heartbeat.liveness, "ALIVE");
  assert.equal(result.heartbeat.lastCycleOk, null);
  assert.equal(result.research.recordedRunningScouts?.[0]?.attemptId, "at-1");
  assert.equal(result.research.completedWindow?.promotedRecords, 2);
  assert.equal(result.research.completedWindow?.readerVisibleRecords, null);
  assert.equal(result.research.spend?.measuredUsd, null);
  assert.equal(result.research.spend?.unmeasuredAttempts, 1);
  assert.equal(result.latestSourceEvent.stage, "PUBLISHED");
  assert.equal(result.lastConfirmedSourceProgressAt, AT);
  assert.equal(result.limits.workerStages, "NOT_CONNECTED");
  assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_LEAVE_STORE/);
});

test("a queued source event is not confirmed delivery and oversized active state is withheld", async () => {
  const repos = createMemoryRepositories();
  await repos.researchState.put(RESEARCH_STATE_ID, { beatAt: AT,
    running: Array.from({ length: 17 }, (_, i) => ({ attemptId: `at-${i}`, obligationId: `ob-${i}`, startedAt: AT }))
  } as unknown as ResearchState, AT);
  await repos.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, "queued", { formatVersion: 1,
    digestId: "queued", writtenAt: AT, headline: "queued", lines: [], cycleOk: null, testedSha: null,
    huntSourceProgress: { at: AT, stage: "QUEUED", taskId: "task", sourceId: "source", scope: "az",
      instructionIds: [], detail: "queued", candidateId: null, readerPaths: [] } }, AT);
  const result = await readAdminRunnerProgress(repos, NOW);
  assert.equal(result.research.state, "UNREAD");
  assert.equal(result.research.recordedRunningScouts, null);
  assert.equal(result.latestSourceEvent.stage, "QUEUED");
  assert.equal(result.lastConfirmedSourceProgressAt, null);
});
