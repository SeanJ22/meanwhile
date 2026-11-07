/**
 * A last-resort watchdog for a HUNG (but still alive) standing runner.
 *
 * A relaunch only happens after the old process ends, so a blocked event loop
 * is never recovered by it. This runs the check in a worker thread, which stays
 * responsive when the main thread is blocked. The main thread pings a shared
 * timestamp on a timer (async awaits leave the loop free, so only a blocked loop
 * lets it go stale); past the threshold the worker force-terminates the process.
 *
 * Tunable/disable via env: `WTP_RUNNER_HANG_KILL_MS` (default 34 min; <= 0
 * disables) and `WTP_RUNNER_HANG_PING_MS` (default 30 s).
 */
import { Worker } from "node:worker_threads";
import { RUNTIME_RELEASE_MAX_BLOCKING_MS } from "../lib/ops/runtime-release-handoff.ts";

export const DEFAULT_HANG_KILL_MS = RUNTIME_RELEASE_MAX_BLOCKING_MS + 60_000;
export const DEFAULT_HANG_PING_MS = 30_000;

export interface HangWatchdog {
  /** Refresh the liveness ping now (the internal timer also does this every pingMs). */
  readonly beat: () => void;
  /** Stop pinging and terminate the watchdog worker. */
  readonly stop: () => Promise<void>;
}

/** True when the env explicitly disables the watchdog (kill threshold <= 0). */
export function hangWatchdogDisabled(): boolean {
  const raw = process.env.WTP_RUNNER_HANG_KILL_MS;
  if (raw === undefined) return false;
  const v = Number(raw);
  return !Number.isFinite(v) || v <= 0;
}

export function startHangWatchdog(options: { readonly killAfterMs?: number; readonly pingMs?: number } = {}): HangWatchdog {
  const killAfterMs = options.killAfterMs ?? Number(process.env.WTP_RUNNER_HANG_KILL_MS ?? DEFAULT_HANG_KILL_MS);
  const pingMs = Math.max(1_000, options.pingMs ?? Number(process.env.WTP_RUNNER_HANG_PING_MS ?? DEFAULT_HANG_PING_MS));

  // 8 bytes = one BigInt64 slot holding the last-ping epoch ms, shared with the worker.
  const sab = new SharedArrayBuffer(8);
  const view = new BigInt64Array(sab);
  const beat = (): void => {
    try {
      Atomics.store(view, 0, BigInt(Date.now()));
    } catch {
      /* a failed ping is harmless; the next one supersedes it */
    }
  };
  beat();
  const pinger = setInterval(beat, pingMs);
  pinger.unref();

  // The check runs in a separate ESM module loaded by URL beside this file, mirroring hangShouldTerminate()
  // from lib/control-plane/runner-liveness.ts. execArgv is pinned to the one flag it needs to load a .mts.
  const worker = new Worker(new URL("./runner-hang-watchdog-worker.mts", import.meta.url), {
    execArgv: ["--experimental-strip-types"],
    workerData: { sab, killAfterMs, pingMs },
  });
  // The watchdog must never keep the runner alive on its own, nor crash it if it dies.
  worker.unref();
  worker.on("error", () => {
    /* a dead watchdog stops guarding; it does not take down the runner it guards */
  });

  return {
    beat,
    stop: async (): Promise<void> => {
      clearInterval(pinger);
      try {
        await worker.terminate();
      } catch {
        /* already gone */
      }
    },
  };
}
