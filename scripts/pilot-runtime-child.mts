import { execFile } from "node:child_process";
import type { BoundedChildCommand, BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";

/** Standing work ends when its child settles, with no cycle wall or serial launch pool. */
export async function runRuntimeChildren(
  commands: readonly BoundedChildCommand[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly maxBufferBytes: number;
    readonly onStdout?: (id: string, output: string) => void;
    readonly onStderr?: (id: string, output: string) => void },
): Promise<readonly BoundedChildResult[]> {
  return Promise.all(commands.map(command => new Promise<BoundedChildResult>(resolve => {
    const child = execFile(command.executable, [...command.args], {
      cwd: options.cwd,
      env: command.env ?? options.env,
      encoding: "utf8",
      maxBuffer: options.maxBufferBytes,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const code = error && "code" in error ? error.code : null;
      const signal = error && "signal" in error ? error.signal as NodeJS.Signals | null : null;
      resolve({ id: command.id, status: error === null ? 0 : typeof code === "number" ? code : null,
        signal, stdout, stderr, termination: error === null || typeof code === "number" ? "EXITED"
          : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "OUTPUT_LIMIT_EXCEEDED" : "SPAWN_FAILED",
        errorMessage: error?.message ?? null });
    });
    child.stdout?.on("data", output => options.onStdout?.(command.id, String(output)));
    child.stderr?.on("data", output => options.onStderr?.(command.id, String(output)));
  })));
}
