import { spawn, type ChildProcess } from "node:child_process";
import type { BoundedChildCommand, BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";

/** Standing work ends when its child settles, with no cycle wall or serial launch pool. */
export async function runRuntimeChildren(
  commands: readonly BoundedChildCommand[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly maxBufferBytes: number;
    readonly onStdout?: (id: string, output: string) => void;
    readonly onStderr?: (id: string, output: string) => void;
    readonly onStarted?: (id: string, child: ChildProcess) => void },
): Promise<readonly BoundedChildResult[]> {
  return Promise.all(commands.map(command => new Promise<BoundedChildResult>(resolve => {
    let stdout = "", stderr = "";
    const bytes = { stdout: 0, stderr: 0 };
    let errorMessage: string | null = null;
    let overflow = false;
    const child = spawn(command.executable, [...command.args], {
      cwd: options.cwd,
      env: command.env ?? options.env,
      windowsHide: true,
      stdio: command.executable === process.execPath ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    const output = (stream: "stdout" | "stderr", chunk: string): void => {
      const remaining = Math.max(0, options.maxBufferBytes - bytes[stream]);
      bytes[stream] += Buffer.byteLength(chunk);
      const saved = bytes[stream] > options.maxBufferBytes ? Buffer.from(chunk).subarray(0, remaining).toString("utf8") : chunk;
      if (stream === "stdout") { stdout += saved; options.onStdout?.(command.id, chunk); }
      else { stderr += saved; options.onStderr?.(command.id, chunk); }
      if (bytes[stream] > options.maxBufferBytes) { overflow = true; child.kill(); }
    };
    child.stdout?.setEncoding("utf8").on("data", chunk => output("stdout", String(chunk)));
    child.stderr?.setEncoding("utf8").on("data", chunk => output("stderr", String(chunk)));
    child.once("spawn", () => options.onStarted?.(command.id, child));
    child.once("error", error => { errorMessage = error.message; });
    child.once("close", (code, signal) => resolve({ id: command.id, status: overflow ? null : code,
      signal, stdout, stderr, termination: overflow ? "OUTPUT_LIMIT_EXCEEDED" : errorMessage ? "SPAWN_FAILED" : "EXITED",
      errorMessage }));
  })));
}
