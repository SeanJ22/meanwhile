/**
 * Install a deployed release into its own checkout while the running one keeps
 * admitting work (DB-48). Nothing here switches which checkout children start
 * from; that is DB-53. When the staged checkout is ready, the existing
 * boundary switch finds the package store already warm, so the drained window
 * shrinks to the switch itself.
 *
 * The old drain-first path stays behind WTP_RELEASE_DRAIN_FIRST=1 in the
 * runner's environment file until the staged path is verified live.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runtimePackageManagerCommand } from "./runtime-release-handoff.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const GIT_TIMEOUT_MS = 2 * 60_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

export const STAGED_RELEASES_RELATIVE_DIR = join(".runtime", "releases");
export const STAGED_RELEASE_RECORD_RELATIVE_PATH = join(".runtime", "ops", "staged-release.json");

export interface StagedReleaseRecord {
  readonly state: "INSTALLING" | "READY" | "FAILED";
  readonly targetSha: string;
  readonly directory: string;
  readonly code: string | null;
  readonly detail: string;
  readonly at: string;
}

export interface AsyncCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type AsyncRunCommand = (
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv },
) => Promise<AsyncCommandResult>;

/** Asynchronous so the runner's admission clocks keep ticking while Git and the install run. */
export const defaultAsyncRunCommand: AsyncRunCommand = (executable, args, options) =>
  new Promise(resolve => {
    const child = spawn(executable, [...args], { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.stdout.on("data", chunk => { stdout = (stdout + String(chunk)).slice(-64_000); });
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-64_000); });
    child.on("error", error => { clearTimeout(timer); resolve({ status: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });

export function stagedReleaseDirectory(root: string, targetSha: string): string {
  return join(root, STAGED_RELEASES_RELATIVE_DIR, targetSha.toLowerCase());
}

export function readStagedRelease(root: string): StagedReleaseRecord | null {
  const path = join(root, STAGED_RELEASE_RECORD_RELATIVE_PATH);
  if (!existsSync(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (typeof v.targetSha !== "string" || !FULL_SHA.test(v.targetSha)) return null;
    if (v.state !== "INSTALLING" && v.state !== "READY" && v.state !== "FAILED") return null;
    return {
      state: v.state, targetSha: v.targetSha.toLowerCase(),
      directory: typeof v.directory === "string" ? v.directory : "",
      code: typeof v.code === "string" ? v.code : null,
      detail: typeof v.detail === "string" ? v.detail : "", at: typeof v.at === "string" ? v.at : "",
    };
  } catch { return null; }
}

function writeRecord(root: string, record: StagedReleaseRecord): void {
  const path = join(root, STAGED_RELEASE_RECORD_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function concise(result: AsyncCommandResult): string {
  const first = `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return first?.slice(0, 300) ?? `exit ${result.status ?? "unresolved"}`;
}

/** Whether a finished staging for exactly this target is on disk and usable. */
export function stagedReleaseIsReady(root: string, targetSha: string): boolean {
  const record = readStagedRelease(root);
  return record?.state === "READY" && record.targetSha === targetSha.toLowerCase() && existsSync(record.directory);
}

/** Remove staged checkouts for any other target; each is a registered Git worktree. */
async function removeOtherStagedCheckouts(root: string, keepSha: string, run: AsyncRunCommand): Promise<void> {
  const base = join(root, STAGED_RELEASES_RELATIVE_DIR);
  if (!existsSync(base)) return;
  for (const name of readdirSync(base)) {
    if (name === keepSha) continue;
    const dir = join(base, name);
    await run("git", ["worktree", "remove", "--force", dir], { cwd: root, timeoutMs: GIT_TIMEOUT_MS });
    rmSync(dir, { recursive: true, force: true });
  }
  await run("git", ["worktree", "prune"], { cwd: root, timeoutMs: GIT_TIMEOUT_MS });
}

/**
 * Stage `targetSha` in `.runtime/releases/<sha>` and install its frozen
 * dependencies there. Never touches the running checkout's files. Safe to call
 * again for the same target: a READY staging returns at once.
 */
export async function stageRuntimeRelease(input: {
  readonly root: string;
  readonly targetSha: string;
  readonly run?: AsyncRunCommand;
  readonly now?: () => Date;
}): Promise<StagedReleaseRecord> {
  const run = input.run ?? defaultAsyncRunCommand;
  const now = input.now ?? (() => new Date());
  const targetSha = input.targetSha.toLowerCase();
  const directory = stagedReleaseDirectory(input.root, targetSha);
  const record = (state: StagedReleaseRecord["state"], code: string | null, detail: string): StagedReleaseRecord => {
    const value = { state, targetSha, directory, code, detail, at: now().toISOString() };
    writeRecord(input.root, value);
    return value;
  };
  if (!FULL_SHA.test(targetSha)) return record("FAILED", "TARGET_SHA_INVALID", "staging target is not a full Git commit");
  if (stagedReleaseIsReady(input.root, targetSha)) return readStagedRelease(input.root)!;

  record("INSTALLING", null, "installing the deployed release in its own checkout while work continues");
  await removeOtherStagedCheckouts(input.root, targetSha, run);
  const fail = (code: string, detail: string): StagedReleaseRecord => record("FAILED", code, detail);

  const fetched = await run("git", ["fetch", "--quiet", "--no-tags", "origin", "main"], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
  if (fetched.status !== 0) return fail("ORIGIN_MAIN_FETCH_FAILED", concise(fetched));
  const ancestor = await run("git", ["merge-base", "--is-ancestor", targetSha, "origin/main"], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
  if (ancestor.status !== 0) return fail("DEPLOYED_COMMIT_NOT_ON_MAIN", `${targetSha} is not proven to be an ancestor of origin/main`);

  if (existsSync(directory)) {
    await run("git", ["worktree", "remove", "--force", directory], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
    rmSync(directory, { recursive: true, force: true });
  }
  mkdirSync(dirname(directory), { recursive: true });
  const added = await run("git", ["worktree", "add", "--detach", directory, targetSha], { cwd: input.root, timeoutMs: GIT_TIMEOUT_MS });
  if (added.status !== 0) return fail("STAGED_CHECKOUT_FAILED", concise(added));

  const command = runtimePackageManagerCommand();
  if (command === null) return fail("COREPACK_ENTRY_UNAVAILABLE", "the running Node installation has no Corepack JavaScript entry");
  const installed = await run(command.executable, command.args, { cwd: directory, timeoutMs: INSTALL_TIMEOUT_MS, env: { ...process.env, CI: "true" } });
  if (installed.status !== 0) return fail("FROZEN_INSTALL_FAILED", concise(installed));

  const head = await run("git", ["rev-parse", "HEAD"], { cwd: directory, timeoutMs: GIT_TIMEOUT_MS });
  if (head.status !== 0 || head.stdout.trim().toLowerCase() !== targetSha) return fail("STAGED_CHECKOUT_EXACT_HEAD_FAILED", "staged checkout did not read back at the exact deployed target");
  const dirty = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: directory, timeoutMs: GIT_TIMEOUT_MS });
  if (dirty.status !== 0 || dirty.stdout.trim() !== "") return fail("STAGED_CHECKOUT_DIRTY_AFTER_INSTALL", "frozen installation did not leave the staged checkout clean");
  return record("READY", null, `release ${targetSha} is installed in its own checkout; the running one kept admitting work`);
}

/** The main checkout has moved to the release; the staged copy is no longer needed. */
export async function discardStagedReleases(root: string, run: AsyncRunCommand = defaultAsyncRunCommand): Promise<void> {
  await removeOtherStagedCheckouts(root, "", run);
  rmSync(join(root, STAGED_RELEASE_RECORD_RELATIVE_PATH), { force: true });
}
