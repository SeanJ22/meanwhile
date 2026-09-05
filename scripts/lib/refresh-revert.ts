/**
 * The Git moves the refresh gate and the Reader proof renewal share: which
 * governed files differ from HEAD, putting a source's files back at HEAD
 * (tracked files checked out, untracked ones removed), and — since RLC-2 —
 * leaving ONE coherent tree behind a refusal by regenerating the registered
 * PURE dependents from what was restored. One implementation, so the
 * renewal's refusal and the gate's refusal revert the same way.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

import { regenerateStaleDependents, type CheckRunner } from "../../lib/ops/generated-freshness.ts";
import type { GeneratedArtifact } from "../../lib/ops/generated-register.ts";
import type { RefreshRenewalRestore } from "../../lib/ops/refresh-report.ts";

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

/**
 * Put a refused change back and leave ONE coherent tree (RLC-2, 2026-09-05).
 *
 * Refresh run #25 restored two refused holdings after the orchestrator had
 * already regenerated the 56 state manifests from the CHANGED tree; the
 * manifests were then stale against the restored tree, and the suite refused
 * the surviving sources for a staleness the refusal itself had made. Every
 * group goes back to HEAD first; then every registered PURE dependent that is
 * stale against what is now on disk is regenerated from it, through the same
 * registry and runner the gate and the push door use. Restoring without
 * regenerating is the defect; this is the one shared move that does both, in
 * that order, for whichever source the renewal refuses.
 */
export function restoreRefusedChange(input: {
  git: GitRunner;
  root: string;
  /** What goes back to HEAD, each group reported by name in the record. */
  groups: readonly { id: string; paths: readonly string[] }[];
  runCheck: CheckRunner;
  runGen: (command: string) => { ok: boolean; output: string };
  generated?: readonly GeneratedArtifact[];
  log?: (line: string) => void;
}): RefreshRenewalRestore {
  const log = input.log ?? (() => {});
  const restored = input.groups.map((group) => {
    const files = changedFilesUnder(input.git, group.paths);
    revertFilesToHead(input.git, input.root, files);
    log(`${group.id}: back at HEAD (${files.length} path(s))`);
    return { id: group.id, paths: files.map((f) => f.path) };
  });
  const regen = regenerateStaleDependents({ generated: input.generated, runCheck: input.runCheck, runGen: input.runGen, log });
  log(
    `PURE dependents regenerated from the restored tree: ${regen.regenerated.length} path(s)` +
      (regen.failed.length > 0 ? `; ${regen.failed.length} generator(s) FAILED — the tree is NOT coherent` : ""),
  );
  return { restored, regenerated: regen.regenerated, regenerationFailed: regen.failed };
}
