/**
 * The hang watchdog's Worker body (see scripts/runner-hang-watchdog.mts).
 *
 * A separate ESM module rather than an eval string so it carries no CommonJS
 * `require` (RULING 46) and type-checks like any other source. It runs in its
 * own thread, so it stays responsive when the MAIN thread's event loop is
 * blocked — the only situation the watchdog exists for. It mirrors
 * hangShouldTerminate() from lib/control-plane/runner-liveness.ts: if the main
 * thread has not refreshed the shared ping past the threshold, force-terminate
 * the whole process so the Scheduled Task relaunch trigger restarts it.
 */
import { workerData } from "node:worker_threads";

interface WatchdogData {
  readonly sab: SharedArrayBuffer;
  readonly killAfterMs: number;
  readonly pingMs: number;
}

const data = workerData as WatchdogData;
const view = new BigInt64Array(data.sab);
const killAfterMs = data.killAfterMs;
const checkMs = Math.max(1_000, Math.floor(data.pingMs));

if (Number.isFinite(killAfterMs) && killAfterMs > 0) {
  // The interval is deliberately NOT unref'd: it is the only thing keeping this
  // worker's event loop alive, and it must keep running to guard. The main side
  // calls worker.unref(), so a live watchdog never holds the runner process open.
  setInterval(() => {
    const last = Number(Atomics.load(view, 0));
    if (Number.isFinite(last) && last > 0 && Date.now() - last > killAfterMs) {
      const staleS = Math.round((Date.now() - last) / 1000);
      try {
        console.error(
          `[hang-watchdog] pilot-runner main thread unresponsive for ${staleS}s ` +
            `(threshold ${Math.round(killAfterMs / 1000)}s); terminating pid ${process.pid} ` +
            "so the relaunch trigger restarts it",
        );
      } catch {
        /* logging must never stop the kill */
      }
      try {
        process.kill(process.pid, "SIGKILL");
      } catch {
        try {
          process.exit(137);
        } catch {
          /* nothing left to try */
        }
      }
    }
  }, checkMs);
}
