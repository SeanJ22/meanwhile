/**
 * The two Git moves the refresh gate and the Reader proof renewal share: which
 * governed files differ from HEAD, and putting a source's files back at HEAD
 * (tracked files checked out, untracked ones removed). One implementation, so
 * the renewal's refusal and the gate's refusal revert the same way.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

export type GitRunner = (args: string[]) => string;

export interface ChangedFile {
  path: string;
  untracked: boolean;
}

export function changedFilesUnder(git: GitRunner, paths: readonly string[]): ChangedFile[] {
  if (paths.length === 0) return [];
  return git(["status", "--porcelain", "-z", "--untracked-files=all", "--", ...paths])
    .split("\0")
    .filter((line) => line.length > 3)
    .map((line) => ({ path: line.slice(3).replace(/\\/g, "/"), untracked: line.startsWith("??") }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Put files at HEAD: tracked files checked out, untracked ones removed. */
export function revertFilesToHead(git: GitRunner, root: string, files: readonly ChangedFile[]): void {
  const tracked = files.filter((f) => !f.untracked).map((f) => f.path);
  if (tracked.length > 0) git(["checkout", "HEAD", "--", ...tracked]);
  for (const f of files.filter((f) => f.untracked)) rmSync(join(root, f.path), { force: true });
}
