/**
 * A last-resort watchdog for a HUNG (but still alive) standing runner.
 *
 * The Scheduled Task relaunch trigger (`scripts/pilot-task.ps1`) only starts a
 * new instance AFTER the old one ENDS: with `MultipleInstances IgnoreNew` and
 * `ExecutionTimeLimit 0`, it cannot recover a process whose event loop is
 * blocked (an unbounded wait, a deadlock, a huge synchronous op). That is why
 * the real 2026-09 multi-hour outages were recovered only by a human noticing —
 * "there is no automatic watchdog for a hang."
 *
 * This runs the check in a WORKER THREAD — its own event loop — so it stays
 * responsive even when the MAIN thread is fully blocked, which is the only
 * situation it exists for. The main thread pings a shared timestamp on a timer
 * that keeps firing while it awaits a bounded cycle child or sleeps between
 * cycles (async awaits leave the event loop free); only a blocked event loop
 * lets the ping go stale. Past the threshold the worker force-terminates the
 * whole process, and the 5-minute relaunch trigger brings a fresh instance back
 * within minutes instead of hours.
 *
 * Tunable/disable via env: `WTP_RUNNER_HANG_KILL_MS` (default 15 min; <= 0
 * disables) and `WTP_RUNNER_HANG_PING_MS` (default 30 s).
 */
import { Worker } from "node:worker_threads";

export const DEFAULT_HANG_KILL_MS = 15 * 60_000;
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

  // The worker mirrors hangShouldTerminate() from lib/control-plane/runner-liveness.ts.
  // It must be self-contained (eval worker: no imports), so the one-line rule is inline.
  const source = `
    const { workerData } = require('node:worker_threads');
    const view = new BigInt64Array(workerData.sab);
    const killAfterMs = workerData.killAfterMs;
    const checkMs = Math.max(1000, Math.floor(workerData.pingMs));
    if (Number.isFinite(killAfterMs) && killAfterMs > 0) {
      const timer = setInterval(() => {
        const last = Number(Atomics.load(view, 0));
        if (Number.isFinite(last) && last > 0 && Date.now() - last > killAfterMs) {
          const staleS = Math.round((Date.now() - last) / 1000);
          try { console.error('[hang-watchdog] pilot-runner main thread unresponsive for ' + staleS + 's (threshold ' + Math.round(killAfterMs / 1000) + 's); terminating pid ' + process.pid + ' so the relaunch trigger restarts it'); } catch (e) {}
          try { process.kill(process.pid, 'SIGKILL'); } catch (e) { try { process.exit(137); } catch (e2) {} }
        }
      }, checkMs);
      timer.unref?.();
    }
  `;
  const worker = new Worker(source, { eval: true, execArgv: [], workerData: { sab, killAfterMs, pingMs } });
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
