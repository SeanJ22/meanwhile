/**
 * **WHAT THE RUNNER IS DOING, IN ONE SENTENCE THE OWNER CAN ACT ON.**
 * (ADM-5, 9.4.26 admin feedback.)
 *
 * The owner turned the runner off on purpose and the page showed him a red
 * "SILENT — last beat 542 minutes ago" with nothing to say whether that was
 * his doing or a failure. Liveness alone cannot answer that: a beat is a fact
 * about the process, and "I stopped it" is a fact about the owner. So this
 * projection reads BOTH — the heartbeat and the owner's standing
 * PAUSE_RUNNER / RESUME_RUNNER intent — and says which one it is:
 *
 *   PAUSED      the owner's latest runner intent is a pause; amber, never red.
 *               The detail says since when, why (his note), and whether the
 *               runner acknowledged it (a HONORED record or a pause-carrying
 *               beat) — an unacknowledged pause is still his pause.
 *   ALIVE       beating within tolerance and not paused.
 *   LATE        past the late threshold, no pause recorded.
 *   SILENT      past the silent threshold, no pause recorded — this is the
 *               state that used to swallow a deliberate stop; it now says
 *               "no pause is recorded" so the owner knows what to do.
 *   NEVER_BEAT  no heartbeat record at all.
 *
 * PURE: heartbeat + intent log + clock in, sentences out. No store, no env.
 */
import { livenessOf, type HealthLevel, type RunnerHeartbeat, type RunnerLiveness } from "./owner-surface.ts";
import { readIntents, type ResearchIntent } from "./scheduler/research-policy.ts";

export type RunnerStandingState = RunnerLiveness | "PAUSED";

export interface RunnerStanding {
  readonly state: RunnerStandingState;
  readonly level: HealthLevel;
  /** Two or three words: "Paused by you", "Running", "Silent — no pause recorded". */
  readonly headline: string;
  /** One plain sentence with the facts (since when, why, last beat). */
  readonly detail: string;
  /** Minutes since the last beat, or null with no beat. */
  readonly sinceBeatMinutes: number | null;
  readonly pause: {
    readonly intentId: string;
    readonly since: string;
    readonly note: string | null;
    readonly by: string;
    /** The runner wrote an acknowledgement (HONORED record or a pause-carrying beat). */
    readonly acknowledged: boolean;
  } | null;
  /** The one control that applies now: record a pause, or resume. */
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
): RunnerStanding {
  const liveness = livenessOf(heartbeat, nowIso);
  const { runnerPause } = readIntents(intentLog);
  const beatSentence =
    heartbeat === null
      ? "No heartbeat has ever been recorded."
      : `Last beat ${ago(heartbeat.beatAt, nowIso)}.`;

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
        state: "ALIVE",
        level: "GREEN",
        headline: "Running",
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
