import { RUNNER_ID } from "../admin-data.ts";
import { runnerCycleOf, type CycleHeartbeat, type RunnerCycle } from "../runner-standing.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, livenessOf, type RunnerHeartbeat } from "../owner-surface.ts";
import { RESEARCH_STATE_ID, type ResearchState, type RunningScout } from "../scheduler/research-policy.ts";
import { pulseLanesOf } from "../scheduler/lane-reading.ts";
import type { ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";

export const RUNNER_PROGRESS_HEARTBEAT_FIELDS = {
  beatAt: true, lastCycleStartedAt: true, lastCycleFinishedAt: true,
  lastCycleOk: true, nextCycleDueAt: true, testedSha: true,
  cycle: ["startedAt", "finishedAt", "exitCode", "signal", "lastError"],
} as const satisfies RecordProjection;
export const RUNNER_PROGRESS_RESEARCH_FIELDS = {
  beatAt: true, cycleStartedAt: true, cycleFinishedAt: true, testedSha: true,
  pausedByOwner: true, modelLaneEnabled: true, modelLaneDisabledReason: true,
  queue: ["modelClassDue", "deterministicDue", "modelClassDispatchedThisCycle",
    "deterministicDispatchedThisCycle", "autonomousDispatchedThisCycle", "lanes"],
  running: true,
  spend: ["windowUsd", "measuredAttempts", "unmeasuredAttempts", "asOf"],
  researchProgression: ["windowId", "since", "through", "promoted", "readerVisible"],
} as const satisfies RecordProjection;

type ReadingState = "RECORDED" | "NOT_RECORDED" | "UNREAD";
type ProgressResearch = Pick<ResearchState, "beatAt" | "cycleStartedAt" | "cycleFinishedAt" | "testedSha" |
  "pausedByOwner" | "modelLaneEnabled" | "modelLaneDisabledReason" | "queue" | "running" | "spend" | "researchProgression">;

export interface RunnerProgressRead {
  readonly observedAt: string;
  readonly heartbeat: {
    readonly state: ReadingState;
    readonly liveness: ReturnType<typeof livenessOf>["state"] | null;
    readonly beatAt: string | null;
    readonly cycleStartedAt: string | null;
    readonly cycleFinishedAt: string | null;
    readonly lastCycleOk: boolean | null;
    readonly nextCycleDueAt: string | null;
    readonly testedSha: string | null;
    readonly cycle: RunnerCycle | null;
    readonly says: string;
  };
  readonly research: {
    readonly state: ReadingState;
    readonly observedAt: string | null;
    readonly cycleStartedAt: string | null;
    readonly cycleFinishedAt: string | null;
    readonly testedSha: string | null;
    readonly pausedByOwner: boolean | null;
    /** In-flight at observedAt, not a claim that an old row remains active now. */
    readonly recordedRunningScouts: readonly RunningScout[] | null;
    readonly lanes: ReturnType<typeof pulseLanesOf>;
    readonly spend: { readonly measuredUsd: number | null; readonly unmeasuredAttempts: number; readonly asOf: string } | null;
    readonly completedWindow: {
      readonly windowId: string; readonly since: string; readonly through: string;
      readonly promotedRecords: number | null; readonly readerVisibleRecords: number | null;
      readonly readerReason: string;
    } | null;
    readonly says: string;
  };
  readonly latestSourceEvent: {
    readonly state: ReadingState;
    readonly at: string | null;
    readonly stage: string | null;
    readonly taskId: string | null;
    readonly sourceId: string | null;
    readonly scope: string | null;
    readonly instructionIds: readonly string[];
    readonly says: string;
  };
  /** This is only an event time when the newest source receipt itself records delivery/reuse. */
  readonly lastConfirmedSourceProgressAt: string | null;
  readonly limits: {
    readonly workerStages: "NOT_CONNECTED";
    readonly lastWorkerProgressAt: null;
    readonly currentPublicReadback: "NOT_READ_BY_THIS_ENDPOINT";
  };
}

const missingHeartbeat = (state: "NOT_RECORDED" | "UNREAD", says: string): RunnerProgressRead["heartbeat"] => ({
  state, liveness: null, beatAt: null, cycleStartedAt: null, cycleFinishedAt: null,
  lastCycleOk: null, nextCycleDueAt: null, testedSha: null, cycle: null, says,
});
const missingResearch = (state: "NOT_RECORDED" | "UNREAD", says: string): RunnerProgressRead["research"] => ({
  state, observedAt: null, cycleStartedAt: null, cycleFinishedAt: null, testedSha: null,
  pausedByOwner: null, recordedRunningScouts: null, lanes: null, spend: null, completedWindow: null, says,
});
const missingSource = (state: "NOT_RECORDED" | "UNREAD", says: string): RunnerProgressRead["latestSourceEvent"] => ({
  state, at: null, stage: null, taskId: null, sourceId: null, scope: null, instructionIds: [], says,
});
const clock = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const sourceStages = new Set(["QUEUED", "COLLECTING_AND_VERIFYING", "PUBLISHED", "REUSED", "HELD", "FAILED"]);

export async function readAdminRunnerProgress(repos: ControlPlaneRepositories, observedAt: string): Promise<RunnerProgressRead> {
  if (!clock(observedAt)) throw new Error("RUNNER_PROGRESS_CLOCK_INVALID");
  const [beatRead, researchRead, sourceRead] = await Promise.allSettled([
    repos.runnerHeartbeat.readNarrowed(RUNNER_ID, RUNNER_PROGRESS_HEARTBEAT_FIELDS),
    repos.researchState.readNarrowed(RESEARCH_STATE_ID, RUNNER_PROGRESS_RESEARCH_FIELDS),
    repos.ownerDigests.readRecent(HUNT_SOURCE_PROGRESS_LOG_KEY, 1),
  ]);
  let heartbeat: RunnerProgressRead["heartbeat"] = missingHeartbeat("NOT_RECORDED", "No runner heartbeat has been recorded yet.");
  if (beatRead.status === "rejected") heartbeat = missingHeartbeat("UNREAD", "The runner heartbeat could not be read just now.");
  else if (beatRead.value !== null) {
    const beat = beatRead.value.value as Partial<CycleHeartbeat>;
    if (!clock(beat.beatAt)) heartbeat = missingHeartbeat("UNREAD", "The recorded heartbeat clock is invalid; liveness is unknown.");
    else {
      const live = livenessOf(beat as RunnerHeartbeat, observedAt);
      heartbeat = { state: "RECORDED", liveness: live.state, beatAt: beat.beatAt,
        cycleStartedAt: clock(beat.lastCycleStartedAt) ? beat.lastCycleStartedAt : null,
        cycleFinishedAt: clock(beat.lastCycleFinishedAt) ? beat.lastCycleFinishedAt : null,
        lastCycleOk: typeof beat.lastCycleOk === "boolean" ? beat.lastCycleOk : null,
        nextCycleDueAt: clock(beat.nextCycleDueAt) ? beat.nextCycleDueAt : null,
        testedSha: typeof beat.testedSha === "string" ? beat.testedSha : null,
        cycle: runnerCycleOf(beat.cycle),
        says: `The runner's last heartbeat is ${live.state.toLowerCase()}; a heartbeat does not prove that civic work advanced.` };
    }
  }
  let research: RunnerProgressRead["research"] = missingResearch("NOT_RECORDED", "No research-cycle reading has been recorded yet.");
  if (researchRead.status === "rejected") research = missingResearch("UNREAD", "The research-cycle reading could not be read just now.");
  else if (researchRead.value !== null) {
    const row = researchRead.value.value as Partial<ProgressResearch>;
    if (!clock(row.beatAt) || !Array.isArray(row.running) || row.running.length > 16 ||
        row.running.some((worker: unknown) => !worker || typeof worker !== "object" ||
          !clock((worker as RunningScout).startedAt) || typeof (worker as RunningScout).attemptId !== "string" ||
          typeof (worker as RunningScout).obligationId !== "string")) {
      research = missingResearch("UNREAD", "The saved active-work reading is invalid or exceeds its bounded worker contract.");
    } else {
      const progression = row.researchProgression;
      const window = progression && clock(progression.since) && clock(progression.through) &&
        typeof progression.windowId === "string" && progression.readerVisible && progression.promoted &&
        (progression.readerVisible.count === null || count(progression.readerVisible.count)) &&
        (progression.promoted.count === null || count(progression.promoted.count)) &&
        typeof progression.readerVisible.reason === "string"
        ? { windowId: progression.windowId, since: progression.since, through: progression.through,
          promotedRecords: progression.promoted.count, readerVisibleRecords: progression.readerVisible.count,
          readerReason: progression.readerVisible.reason.slice(0, 240) } : null;
      const spend = row.spend && clock(row.spend.asOf) && count(row.spend.unmeasuredAttempts) &&
        (row.spend.windowUsd === null || typeof row.spend.windowUsd === "number" && Number.isFinite(row.spend.windowUsd) && row.spend.windowUsd >= 0)
        ? { measuredUsd: row.spend.windowUsd, unmeasuredAttempts: row.spend.unmeasuredAttempts, asOf: row.spend.asOf } : null;
      research = { state: "RECORDED", observedAt: row.beatAt,
        cycleStartedAt: clock(row.cycleStartedAt) ? row.cycleStartedAt : null,
        cycleFinishedAt: clock(row.cycleFinishedAt) ? row.cycleFinishedAt : null,
        testedSha: typeof row.testedSha === "string" ? row.testedSha : null,
        pausedByOwner: typeof row.pausedByOwner === "boolean" ? row.pausedByOwner : null,
        recordedRunningScouts: row.running.map((worker: RunningScout) => ({ attemptId: worker.attemptId,
          obligationId: worker.obligationId, startedAt: worker.startedAt,
          ...(Array.isArray(worker.assignmentKeys) && worker.assignmentKeys.length <= 16 &&
            worker.assignmentKeys.every(key => typeof key === "string") ? { assignmentKeys: worker.assignmentKeys } : {}) })),
        lanes: pulseLanesOf({ queue: row.queue }), spend, completedWindow: window,
        says: window ? "The completed-window counts are recorded progress; current worker stages and public readback require separate evidence."
          : "Scouts were recorded as running at the research observation, but no bounded completed-window publication reading is available." };
    }
  }
  let latestSourceEvent: RunnerProgressRead["latestSourceEvent"] = missingSource("NOT_RECORDED", "No routine source event has been recorded yet.");
  if (sourceRead.status === "rejected") latestSourceEvent = missingSource("UNREAD", "The routine source event could not be read just now.");
  else if (sourceRead.value.length) {
    const event = sourceRead.value[0]?.huntSourceProgress;
    if (!event || !clock(event.at) || !sourceStages.has(event.stage) ||
      [event.taskId, event.sourceId, event.scope].some(value => typeof value !== "string" || value.length > 200) ||
      !Array.isArray(event.instructionIds) || event.instructionIds.length > 16 ||
      event.instructionIds.some(value => typeof value !== "string" || value.length > 200)) {
      latestSourceEvent = missingSource("UNREAD", "The newest routine source event has an invalid shape.");
    } else latestSourceEvent = { state: "RECORDED", at: event.at, stage: event.stage, taskId: event.taskId,
      sourceId: event.sourceId, scope: event.scope, instructionIds: event.instructionIds,
      says: `The most recent recorded routine source event is ${event.stage.toLowerCase().replaceAll("_", " ")}; its receipt is not a public-page check.` };
  }
  return { observedAt, heartbeat, research, latestSourceEvent,
    lastConfirmedSourceProgressAt: latestSourceEvent.state === "RECORDED" &&
      (latestSourceEvent.stage === "PUBLISHED" || latestSourceEvent.stage === "REUSED") ? latestSourceEvent.at : null,
    limits: { workerStages: "NOT_CONNECTED", lastWorkerProgressAt: null, currentPublicReadback: "NOT_READ_BY_THIS_ENDPOINT" } };
}
