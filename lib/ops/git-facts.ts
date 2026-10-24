/** The two git facts every run record needs; when git cannot answer, null and false, never a fabricated answer. */

import { execFileSync } from "node:child_process";

/** The commit this process runs against, or null when the tree cannot be named. */
export function headSha(cwd: string = process.cwd()): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}
