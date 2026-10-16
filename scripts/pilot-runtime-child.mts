import { spawn, type ChildProcess } from "node:child_process";
import type { BoundedChildCommand, BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { RESEARCH_STALL_PROBE, progressLines } from "../lib/control-plane/scheduler/round-progress.ts";
import { vitalSignsLineFilter, type NeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import { PASS_DEADLINE_ENV } from "../lib/ops/independent-runtime-pass.ts";

export const RUNTIME_NO_PROGRESS_MS = 10 * 60_000;
/** How long before the no-progress limit the child is asked what it is waiting on; its answer is not progress. */
export const STALL_PROBE_LEAD_MS = 60_000;
const ownedChildren = new Set<{ lastProgressAt: number; stop: (reason: string) => Promise<void> }>();
const progressListeners = new Set<() => void>();
let vitalSignsSink: ((part: NeonBytesHour) => void) | null = null;

/**
 * Children print their hour totals as report lines
 * (lib/db/transfer-by-caller.ts). With a sink set, every child started here has
 * those lines taken out of its output (never shown, buffered or counted as
 * progress) and handed to the sink. The standing runner sets it once.
 */
export function receiveChildVitalSigns(sink: ((part: NeonBytesHour) => void) | null): void {
  vitalSignsSink = sink;
}

/** Only the process group we spawned, or that exact Windows child's tree. */
export async function endOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const deadline = setTimeout(() => { killer.kill(); reject(new Error(`OWNED_CHILD_TREE_KILL_TIMEOUT:${child.pid}`)); }, 5000);
      killer.once("error", error => { clearTimeout(deadline); reject(error); });
      killer.once("close", code => {
        clearTimeout(deadline);
        if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
        else reject(new Error(`OWNED_CHILD_TREE_KILL_FAILED:${child.pid}:${code}`));
      });
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
}

/** Cover the entire drain, including coordination awaits before waitForIdle.
 * Only changed child output renews it; parent beats and release notices cannot. */
export async function waitForRuntimeQuiescence(work: () => Promise<void>, options: {
  readonly reason: string; readonly noProgressMs?: number;
}): Promise<void> {
  const quietMs = options.noProgressMs ?? RUNTIME_NO_PROGRESS_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  let lastProgressAt = Date.now();
  let rejectDrain: (error: Error) => void = () => {};
  const renew = () => {
    if (expired) return;
    lastProgressAt = Date.now();
    clearTimeout(timer);
    const expire = () => {
      const remaining = quietMs - (Date.now() - lastProgressAt);
      if (remaining > 0) { timer = setTimeout(expire, remaining); return; }
      expired = true;
      const reason = `RUNTIME_DRAIN_NO_PROGRESS: ${options.reason}; no changed child progress for ${quietMs}ms`;
      const hung = [...ownedChildren].filter(child => Date.now() - child.lastProgressAt >= quietMs);
      void Promise.all(hung.map(child => child.stop(reason))).then(
        () => rejectDrain(new Error(reason)),
        error => rejectDrain(new Error(`${reason}; ${error instanceof Error ? error.message : String(error)}`)),
      );
    };
    timer = setTimeout(expire, quietMs);
  };
  progressListeners.add(renew);
  renew();
  try {
    await Promise.race([Promise.resolve().then(work).then(() => expired ? new Promise<void>(() => {}) : undefined),
      new Promise<never>((_resolve, reject) => { rejectDrain = reject; })]);
  } finally {
    clearTimeout(timer);
    progressListeners.delete(renew);
  }
}

/** Standing work ends by its lane deadline; research alone also opts into an idle guard. */
export async function runRuntimeChildren(
  commands: readonly BoundedChildCommand[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly maxBufferBytes: number;
    readonly onStdout?: (id: string, output: string) => void;
    readonly onStderr?: (id: string, output: string) => void;
    readonly noProgressMs?: number;
    /** The lane's deadline: the child is told it and its process tree is ended when it passes. */
    readonly deadlineMs?: number;
    readonly onStarted?: (id: string, child: ChildProcess) => void },
): Promise<readonly BoundedChildResult[]> {
  if (options.noProgressMs !== undefined && (!Number.isSafeInteger(options.noProgressMs) || options.noProgressMs <= 0)) {
    throw new Error("RUNTIME_NO_PROGRESS_INTERVAL_INVALID");
  }
  return Promise.all(commands.map(command => new Promise<BoundedChildResult>(resolve => {
    let stdout = "", stderr = "";
    const bytes = { stdout: 0, stderr: 0 };
    let errorMessage: string | null = null;
    let overflow = false;
    let stopped = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let probe: ReturnType<typeof setTimeout> | undefined;
    const progress = { stdout: progressLines(), stderr: progressLines() };
    const report = (part: NeonBytesHour) => vitalSignsSink?.(part);
    const reports = { stdout: vitalSignsLineFilter(report), stderr: vitalSignsLineFilter(report) };
    const env = command.env ?? options.env;
    const child = spawn(command.executable, [...command.args], {
      cwd: options.cwd,
      env: options.deadlineMs === undefined ? env : { ...env, [PASS_DEADLINE_ENV]: new Date(options.deadlineMs).toISOString() },
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: command.executable === process.execPath ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    const owned = { lastProgressAt: Date.now(), stop: async (reason: string) => {
      if (stopped) return;
      stopped = true;
      errorMessage = reason;
      clearTimeout(idle);
      clearTimeout(probe);
      const line = `\n${reason}; ending owned child ${command.id} process tree pid ${child.pid ?? "unstarted"}\n`;
      stderr += line;
      options.onStderr?.(command.id, line);
      await endOwnedProcessTree(child);
    } };
    ownedChildren.add(owned);
    const wall = options.deadlineMs === undefined ? undefined : setTimeout(() => {
      void owned.stop(`PASS_TIME_BUDGET: ${command.id} reached its lane deadline; its unfinished work stays owed to the next pass`)
        .catch(error => { errorMessage = `${errorMessage}; ${String(error)}`; child.kill("SIGKILL"); });
    }, Math.max(0, options.deadlineMs - Date.now()));
    const renew = () => {
      owned.lastProgressAt = Date.now();
      for (const listener of progressListeners) listener();
      clearTimeout(idle);
      clearTimeout(probe);
      if (options.noProgressMs && child.connected) {
        const noProgressMs = options.noProgressMs;
        probe = setTimeout(() => {
          if (child.connected) child.send({ kind: RESEARCH_STALL_PROBE }, () => undefined);
        }, Math.max(noProgressMs - STALL_PROBE_LEAD_MS, Math.floor(noProgressMs / 2)));
      }
      if (options.noProgressMs) idle = setTimeout(() => {
        void owned.stop(`RESEARCH_CHILD_NO_PROGRESS: no completed phase, worker admission or changed child output for ${options.noProgressMs}ms`)
          .catch(error => { errorMessage = `${errorMessage}; ${String(error)}`; child.kill("SIGKILL"); });
      }, options.noProgressMs);
    };
    const output = (stream: "stdout" | "stderr", received: string, ended = false): void => {
      const chunk = vitalSignsSink ? reports[stream].take(received) + (ended ? reports[stream].end() : "") : received;
      if (!chunk) return;
      const remaining = Math.max(0, options.maxBufferBytes - bytes[stream]);
      bytes[stream] += Buffer.byteLength(chunk);
      const saved = bytes[stream] > options.maxBufferBytes ? Buffer.from(chunk).subarray(0, remaining).toString("utf8") : chunk;
      if (stream === "stdout") { stdout += saved; options.onStdout?.(command.id, chunk); }
      else { stderr += saved; options.onStderr?.(command.id, chunk); }
      if (progress[stream](chunk) > 0) renew();
      if (bytes[stream] > options.maxBufferBytes && !overflow) {
        overflow = true;
        void owned.stop("OUTPUT_LIMIT_EXCEEDED").catch(() => child.kill("SIGKILL"));
      }
    };
    child.stdout?.setEncoding("utf8").on("data", chunk => output("stdout", String(chunk)));
    child.stderr?.setEncoding("utf8").on("data", chunk => output("stderr", String(chunk)));
    child.once("spawn", () => options.onStarted?.(command.id, child));
    child.once("error", error => { errorMessage = error.message; });
    child.once("close", (code, signal) => {
      output("stdout", "", true);
      output("stderr", "", true);
      clearTimeout(idle);
      clearTimeout(probe);
      clearTimeout(wall);
      ownedChildren.delete(owned);
      resolve({ id: command.id, status: stopped ? null : code,
        signal, stdout, stderr, termination: overflow ? "OUTPUT_LIMIT_EXCEEDED" : stopped ? "TIMED_OUT" : errorMessage ? "SPAWN_FAILED" : "EXITED",
        errorMessage });
    });
    renew();
  })));
}
