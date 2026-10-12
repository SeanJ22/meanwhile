import { execFileSync } from "node:child_process";

/**
 * Run a command whose failure is an answer (`null`) rather than a crash.
 *
 * `maxBuffer` is a correctness setting: Node's 1 MB default makes large output
 * throw, which this would turn into `null`, a silent wrong answer about the
 * file being read. Hence 256 MB.
 *
 * @param {string} cmd
 * @param {readonly string[]} args
 * @param {Parameters<typeof execFileSync>[2] & { cwd?: string }} [opts]
 * @returns {string | null} trimmed stdout, or `null` if the command failed
 */
export function tryRun(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}
