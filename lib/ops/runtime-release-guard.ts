/**
 * What keeps a release switch from stranding the server. Self-contained (Node built-ins only) so the launcher can run
 * it before loading any other code from the checkout. State lives in Git-ignored host files under `.runtime/ops`.
 *
 * - A git lock left by a cut-off git command is removed once it is old and no git process works in the checkout.
 * - A switch records {previousSha, targetSha, switchedAt}. If the target runner has not beaten locally within five
 *   minutes (crash loop or hang), the checkout goes back to previousSha and the target is never staged again.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

export const RUNTIME_RELEASE_HOLD_RELATIVE_PATH = join(".runtime", "ops", "runtime-release-hold.json");
const GUARD_PATH = join(".runtime", "ops", "runtime-release-guard.json");
const BEAT_PATH = join(".runtime", "ops", "runner-beat.json");
export const STALE_GIT_LOCK_MS = 5 * 60_000;
export const SWITCH_BEAT_DEADLINE_MS = 5 * 60_000;
const GIT_LOCKS = ["index.lock", "HEAD.lock", "packed-refs.lock", "shallow.lock"];

interface Guard {
  switch?: { previousSha: string; targetSha: string; switchedAt: string };
  failed?: string[];
  notes?: { at: string; text: string }[];
}

function read(root: string): Guard {
  try { return JSON.parse(readFileSync(join(root, GUARD_PATH), "utf8")) as Guard; } catch { return {}; }
}
function save(root: string, guard: Guard): void {
  mkdirSync(dirname(join(root, GUARD_PATH)), { recursive: true });
  writeFileSync(join(root, GUARD_PATH), `${JSON.stringify(guard)}\n`, { encoding: "utf8", mode: 0o600 });
}
/** Logged now, and kept for the runner to put on its heartbeat once it is up. */
function note(root: string, text: string, now: number): void {
  process.stderr.write(`runtime release guard: ${text}\n`);
  const guard = read(root);
  save(root, { ...guard, notes: [...(guard.notes ?? []), { at: new Date(now).toISOString(), text }].slice(-20) });
}

/** True when a git process works inside `root`. Anything unreadable counts as live: never guess a lock is free. */
export function gitProcessInRepo(root: string): boolean {
  let pids: string[];
  try { pids = readdirSync("/proc").filter(name => /^\d+$/.test(name)); } catch { return true; }
  for (const pid of pids) {
    try {
      const program = basename(readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0] ?? "");
      if (!/^git(?:-.+)?$/.test(program)) continue;
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd === root || cwd.startsWith(root + sep)) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // it ended while we looked
      return true;
    }
  }
  return false;
}

function lockFiles(git: string): string[] {
  const found = GIT_LOCKS.map(name => join(git, name)).filter(existsSync);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".lock")) found.push(path);
    }
  };
  if (existsSync(join(git, "refs"))) walk(join(git, "refs"));
  return found;
}

/** Remove git locks older than five minutes while no git process works in the checkout. Returns what it removed. */
export function clearStaleGitLocks(root: string, options: { now?: number; gitRunning?: (root: string) => boolean } = {}): string[] {
  const now = options.now ?? Date.now();
  const git = join(root, ".git");
  if (!existsSync(git) || !statSync(git).isDirectory()) return [];
  const stale = lockFiles(git).filter(path => now - statSync(path).mtimeMs > STALE_GIT_LOCK_MS);
  if (stale.length === 0 || (options.gitRunning ?? gitProcessInRepo)(root)) return [];
  return stale.map(path => {
    const age = Math.round((now - statSync(path).mtimeMs) / 60_000);
    rmSync(path, { force: true });
    note(root, `removed stale git lock ${path.slice(root.length + 1)} (${age} min old, no git process running)`, now);
    return path;
  });
}

export function recordRuntimeSwitch(root: string, previousSha: string, targetSha: string, now = Date.now()): void {
  save(root, { ...read(root), switch: { previousSha, targetSha, switchedAt: new Date(now).toISOString() } });
}

/** The runner calls this on every heartbeat, before it needs the database. */
export function recordRunnerBeat(root: string, sha: string | null, now = Date.now()): void {
  mkdirSync(dirname(join(root, BEAT_PATH)), { recursive: true });
  writeFileSync(join(root, BEAT_PATH), JSON.stringify({ sha, at: new Date(now).toISOString() }), "utf8");
}

function beatSince(root: string, switched: NonNullable<Guard["switch"]>): boolean {
  try {
    const beat = JSON.parse(readFileSync(join(root, BEAT_PATH), "utf8")) as { sha?: string; at?: string };
    return beat.sha === switched.targetSha && Date.parse(beat.at ?? "") >= Date.parse(switched.switchedAt);
  } catch { return false; }
}

/** False only while a recorded switch has had no beat from its target. Changes nothing. */
export function switchHasBeat(root: string): boolean {
  const switched = read(root).switch;
  return !switched || beatSince(root, switched);
}

/** The install finished, so the five minutes count from here, not from the git switch. */
export function restartSwitchClock(root: string, targetSha: string, now = Date.now()): void {
  const guard = read(root);
  if (guard.switch?.targetSha === targetSha) save(root, { ...guard, switch: { ...guard.switch, switchedAt: new Date(now).toISOString() } });
}

/** Targets that were switched to and never beat; the runner does not stage them again. */
export function failedRuntimeReleases(root: string): readonly string[] { return read(root).failed ?? []; }

/** Notes written by the launcher or a switch, handed over once. */
export function takeRuntimeGuardNotes(root: string): { at: string; text: string }[] {
  const { notes = [], ...rest } = read(root);
  if (notes.length > 0) save(root, rest);
  return notes;
}

export type SwitchSettlement =
  | { readonly state: "none" | "healthy" | "rolledBack" | "rollbackFailed" }
  | { readonly state: "pending"; readonly dueInMs: number };

/**
 * Decide the last switch. Healthy once the target beat; still pending inside five minutes; otherwise the checkout
 * goes back to previousSha, the hold asks the launcher's normal install path to reinstall it, and the target is failed.
 */
export function settleSwitch(root: string, now = Date.now()): SwitchSettlement {
  const guard = read(root);
  const switched = guard.switch;
  if (!switched) return { state: "none" };
  if (beatSince(root, switched)) {
    const { switch: _done, ...rest } = guard;
    save(root, rest);
    return { state: "healthy" };
  }
  const dueInMs = Date.parse(switched.switchedAt) + SWITCH_BEAT_DEADLINE_MS - now;
  if (dueInMs > 0) return { state: "pending", dueInMs };
  const back = spawnSync("git", ["switch", "--detach", "--force", switched.previousSha], { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (back.status !== 0) {
    note(root, `release ${switched.targetSha.slice(0, 8)} sent no heartbeat in 5 minutes but ${switched.previousSha.slice(0, 8)} could not be restored (${(back.stderr || "git failed").trim().split("\n")[0]}); will try again`, now);
    return { state: "rollbackFailed" };
  }
  mkdirSync(dirname(join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH)), { recursive: true });
  writeFileSync(join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH), `${JSON.stringify({ formatVersion: 1, state: "HELD",
    code: "FROZEN_INSTALL_PENDING", targetSha: switched.previousSha, switched: true, observedAt: new Date(now).toISOString() })}\n`, { mode: 0o600 });
  const { switch: _gone, ...rest } = guard;
  save(root, { ...rest, failed: [...(rest.failed ?? []), switched.targetSha] });
  note(root, `release ${switched.targetSha.slice(0, 8)} sent no heartbeat within 5 minutes of the switch; back on ${switched.previousSha.slice(0, 8)}, and the failed release will not be staged again`, now);
  return { state: "rolledBack" };
}
