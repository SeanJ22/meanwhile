import { spawn, type ChildProcess } from "node:child_process";
import type { BoundedChildCommand, BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { RESEARCH_STALL_PROBE, progressLines } from "../lib/control-plane/scheduler/round-progress.ts";
import { vitalSignsLineFilter, type NeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import { routineProcessSlots, type WorkerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";

export const RUNTIME_NO_PROGRESS_MS = 10 * 60_000;
/** How long before the no-progress limit the child is asked what it is waiting on; its answer is not progress. */
export const STALL_PROBE_LEAD_MS = 60_000;
const ownedChildren = new Set<{ pending: boolean; lastProgressAt: number; stop: (reason: string) => Promise<void> }>();
const progressListeners = new Set<() => void>();
let vitalSignsSink: ((part: NeonBytesHour) => void) | null = null;
const runtimeMemorySlots = routineProcessSlots();

/** The executable script, after Node's loader arguments, identifies this job's measured reservation. */
function childMemoryEntry(command: BoundedChildCommand): string {
  const nodeOptionValues = new Set(["--import", "--require", "-r", "--loader", "--experimental-loader",
    "--env-file", "--env-file-if-exists", "--eval", "-e", "--print", "-p"]);
  const script = command.args.find((arg, index) => !arg.startsWith("-") && !nodeOptionValues.has(command.args[index - 1] ?? "") &&
    /[.](?:mts|ts|mjs|js)$/.test(arg));
  return `${command.id}/${script?.split(/[\\/]/).at(-1) ?? command.executable.split(/[\\/]/).at(-1)}`;
}

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
      const hung = [...ownedChildren].filter(child => child.pending || Date.now() - child.lastProgressAt >= quietMs);
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
    /** The lane's deadline: the child's process tree is ended when it passes. */
    readonly deadlineMs?: number;
    /** Shared host admission; supplied explicitly by controlled runs. */
    readonly slots?: WorkerProcessSlots;
    readonly onStarted?: (id: string, child: ChildProcess) => void },
): Promise<readonly BoundedChildResult[]> {
  if (options.noProgressMs !== undefined && (!Number.isSafeInteger(options.noProgressMs) || options.noProgressMs <= 0)) {
    throw new Error("RUNTIME_NO_PROGRESS_INTERVAL_INVALID");
  }
  return Promise.all(commands.map(async command => {
    const admission = new AbortController();
    const owned = { pending: true, lastProgressAt: Date.now(),
      stop: async (reason: string) => { admission.abort(new Error(reason)); } };
    ownedChildren.add(owned);
    let release: Awaited<ReturnType<WorkerProcessSlots["acquire"]>>;
    try {
      release = await (options.slots ?? runtimeMemorySlots).acquire(childMemoryEntry(command), options.deadlineMs, admission.signal);
      if (admission.signal.aborted) {
        release();
        admission.signal.throwIfAborted();
      }
      if (Date.now() >= (options.deadlineMs ?? Infinity)) {
        release();
        throw new Error("PASS_TIME_BUDGET: the pass reached its deadline before this child could start; its work stays owed");
      }
    } catch (error) {
      ownedChildren.delete(owned);
      return { id: command.id, status: null, signal: null, stdout: "", stderr: "", termination: "SPAWN_FAILED" as const,
        errorMessage: sanitizedErrorDiagnostic(error) };
    }
    try { return await new Promise<BoundedChildResult>(resolve => {
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
    const child = spawn(command.executable, [...command.args], {
      cwd: options.cwd,
      env: command.env ?? options.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: command.executable === process.execPath ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    owned.pending = false;
    owned.stop = async (reason: string) => {
      if (stopped) return;
      stopped = true;
      errorMessage = reason;
      clearTimeout(idle);
      clearTimeout(probe);
      const line = `\n${reason}; ending owned child ${command.id} process tree pid ${child.pid ?? "unstarted"}\n`;
      stderr += line;
      options.onStderr?.(command.id, line);
      await endOwnedProcessTree(child);
    };
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
    child.once("spawn", () => {
      release.observe?.(child.pid!);
      command.onStarted?.(child.pid!);
      options.onStarted?.(command.id, child);
    });
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
    }); } finally { ownedChildren.delete(owned); release(); }
  }));
}
