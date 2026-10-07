import { livenessOf, type HealthLevel, type RunnerHeartbeat, type RunnerLiveness } from "./owner-surface.ts";
import { readIntents, type ResearchIntent } from "./scheduler/research-policy.ts";
import { type FleetSafetySnapshot } from "./fleet-safety.ts";

export interface RunnerCycle {
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly lastError: string | null;
}

export type CycleHeartbeat = RunnerHeartbeat & { readonly cycle: RunnerCycle };

/** Old runners have no cycle metadata; malformed readings never imply a live child. */
export function runnerCycleOf(value: unknown): RunnerCycle | null {
  if (!value || typeof value !== "object") return null;
  const cycle = value as Partial<RunnerCycle>;
  const clock = (at: unknown): at is string => typeof at === "string" && Number.isFinite(Date.parse(at));
  if (!clock(cycle.startedAt) || (cycle.finishedAt !== null && !clock(cycle.finishedAt)) ||
      (cycle.finishedAt !== null && Date.parse(cycle.finishedAt) < Date.parse(cycle.startedAt)) ||
      (cycle.exitCode !== null && (!Number.isSafeInteger(cycle.exitCode) || cycle.exitCode! < 0)) ||
      (cycle.signal !== null && (typeof cycle.signal !== "string" || !/^SIG[A-Z0-9]{1,20}$/.test(cycle.signal))) ||
      (cycle.lastError !== null && (typeof cycle.lastError !== "string" || cycle.lastError.length > 2000)) ||
      (cycle.finishedAt === null && (cycle.exitCode !== null || cycle.signal !== null))) return null;
  return { startedAt: cycle.startedAt, finishedAt: cycle.finishedAt,
    exitCode: cycle.exitCode as number | null, signal: cycle.signal,
    lastError: cycle.lastError?.replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[redacted URL]") ?? null };
}

/** A live process beat does not invent a finished round or any source delivery. */
export function liveCycleHeartbeat(previous: RunnerHeartbeat | null, input: {
  readonly at: string; readonly startedAt: string; readonly testedSha: string | null; readonly host: string;
  readonly finishedAt?: string; readonly exitCode?: number | null; readonly signal?: string | null;
  readonly lastError?: string | null;
  /** The host's memory at this beat; a beat that could not read it keeps the last reading, which carries its own time. */
  readonly memory?: import("./workers/worker-slots.ts").HostMemoryReading | null;
  /** Neon bytes by caller; a beat without a reading keeps the last one, which names its hour. */
  readonly neonBytes?: RunnerHeartbeat["neonBytes"];
}): CycleHeartbeat {
  return {
    ...previous,
    memory: input.memory ?? previous?.memory ?? null,
    neonBytes: input.neonBytes ?? previous?.neonBytes ?? null,
    formatVersion: previous?.formatVersion ?? 1,
    beatAt: input.at, lastCycleStartedAt: input.startedAt,
    lastCycleFinishedAt: input.finishedAt ?? previous?.lastCycleFinishedAt ?? null,
    lastCycleOk: input.finishedAt ? input.exitCode === 0 : previous?.lastCycleOk ?? null,
    nextCycleDueAt: input.finishedAt ? previous?.nextCycleDueAt ?? null : null,
    testedSha: input.testedSha, host: input.host, pause: null,
    cycle: { startedAt: input.startedAt, finishedAt: input.finishedAt ?? null,
      exitCode: input.exitCode ?? null, signal: input.signal ?? null, lastError: input.lastError ?? null },
  };
}

export type RunnerStandingState = RunnerLiveness | "ACTIVE" | "PAUSED" | "CIRCUIT BROKEN";

export interface RunnerStanding {
  readonly state: RunnerStandingState;
  readonly level: HealthLevel;
  readonly headline: string;
  readonly detail: string;
  readonly sinceBeatMinutes: number | null;
  readonly pause: {
    readonly intentId: string;
    readonly since: string;
    readonly note: string | null;
    readonly by: string;
    /** The runner wrote an acknowledgement (HONORED record or a pause-carrying beat). */
    readonly acknowledged: boolean;
  } | null;
  readonly control: "PAUSE_RUNNER" | "RESUME_RUNNER";
}

function ago(iso: string, nowIso: string): string {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "at an unreadable time";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function runnerStanding(
  heartbeat: RunnerHeartbeat | null,
  intentLog: readonly ResearchIntent[],
  nowIso: string,
  safety: FleetSafetySnapshot | null = null,
): RunnerStanding {
  const liveness = livenessOf(heartbeat, nowIso);
  const { runnerPause } = readIntents(intentLog);
  const beatSentence =
    heartbeat === null
      ? "No heartbeat has ever been recorded."
      : `Last beat ${ago(heartbeat.beatAt, nowIso)}.`;

  const activeCircuits = safety?.providerCircuits.filter((c) => Date.parse(c.eligibleAt) > Date.parse(nowIso)) ?? [];
  if (activeCircuits.length > 0) {
    const circuits = activeCircuits.map((c) => `${c.provider} until ${c.eligibleAt}: ${c.condition}`).join("; ");
    return {
      state: "CIRCUIT BROKEN",
      level: "RED",
      headline: "CIRCUIT BROKEN",
      detail: `${beatSentence} Automated affected work is deferred without retrying. ${circuits}`,
      sinceBeatMinutes: liveness.sinceMinutes,
      pause: null,
      control: "PAUSE_RUNNER",
    };
  }

  if (safety?.status === "PAUSED" && !runnerPause.paused) {
    return {
      state: "PAUSED",
      level: "AMBER",
      headline: "PAUSED",
      detail: `${beatSentence} The latest Fleet safety snapshot records the standing runner paused; its detailed owner intent was not readable here.`,
      sinceBeatMinutes: liveness.sinceMinutes,
      pause: null,
      control: "RESUME_RUNNER",
    };
  }

  if (runnerPause.paused && runnerPause.intent) {
    const intent = runnerPause.intent;
    const acknowledged =
      runnerPause.honored !== null ||
      (heartbeat?.pause?.intentId === intent.intentId);
    const why = intent.note ? ` Reason: ${intent.note}.` : " No reason was written down.";
    return {
      state: "PAUSED",
      level: "AMBER",
      headline: "Paused by you",
      detail:
        `Paused ${ago(intent.requestedAt, nowIso)} by ${intent.actor}.${why} ` +
        (acknowledged
          ? "The runner acknowledged the pause and is idling."
          : "The runner has not acknowledged it yet — it was stopped, or it has not looked. ") +
        ` ${beatSentence}`,
      sinceBeatMinutes: liveness.sinceMinutes,
      pause: {
        intentId: intent.intentId,
        since: intent.requestedAt,
        note: intent.note,
        by: intent.actor,
        acknowledged,
      },
      control: "RESUME_RUNNER",
    };
  }

  switch (liveness.state) {
    case "ALIVE":
      return {
        state: safety?.status === "ACTIVE" ? "ACTIVE" : "ALIVE",
        level: "GREEN",
        headline: safety?.status === "ACTIVE" ? "ACTIVE" : "Running",
        detail: `${beatSentence} Cycles are on schedule.`,
        sinceBeatMinutes: liveness.sinceMinutes,
        pause: null,
        control: "PAUSE_RUNNER",
      };
    case "LATE":
      return {
        state: "LATE",
        level: "AMBER",
        headline: "Late — no pause recorded",
        detail:
          `${beatSentence} That is past the late threshold and no pause is recorded, so either a cycle is overrunning or the runner stopped. ` +
          "If you stopped it on purpose, record the pause below so this reads as yours.",
        sinceBeatMinutes: liveness.sinceMinutes,
        pause: null,
        control: "PAUSE_RUNNER",
      };
    case "SILENT":
      return {
        state: "SILENT",
        level: "RED",
        headline: "Silent — no pause recorded",
        detail:
          `${beatSentence} Nothing says this was deliberate: no pause is recorded. ` +
          "If you stopped it on purpose, record the pause below and this turns amber; if you did not, the runner has failed and needs restarting.",
        sinceBeatMinutes: liveness.sinceMinutes,
        pause: null,
        control: "PAUSE_RUNNER",
      };
    default:
      return {
        state: "NEVER_BEAT",
        level: "UNKNOWN",
        headline: "No heartbeat on record",
        detail: liveness.detail,
        sinceBeatMinutes: null,
        pause: null,
        control: "PAUSE_RUNNER",
      };
  }
}
