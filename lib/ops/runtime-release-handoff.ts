/**
 * Exact, fail-closed software handoff for the standing runtime: the target is the newest published production deploy
 * with the required CI checks green, at or before the SHA `/api/build` reports. No commit, push, merge, deploy or
 * civic-data write.
 *
 * @freshness-reads-here — observedAt records the exact release-handoff
 * observation that produced a hold; it is not civic-data source freshness.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";

import { REQUIRED_CONTEXTS } from "./required-contexts.ts";
import type { ServedCommit } from "../../scripts/post-deploy-observer.mts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const COMMAND_TIMEOUT_MS = 2 * 60_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
// Nine bounded Git commands plus the frozen install can block the parent loop.
export const RUNTIME_RELEASE_MAX_BLOCKING_MS = 9 * COMMAND_TIMEOUT_MS + INSTALL_TIMEOUT_MS;
export const RUNTIME_RELEASE_HOLD_RELATIVE_PATH = join(".runtime", "ops", "runtime-release-hold.json");

export interface GithubCheckRun {
  readonly name?: unknown;
  readonly conclusion?: unknown;
  readonly completed_at?: unknown;
  readonly started_at?: unknown;
  readonly id?: unknown;
}

export interface RuntimeReleaseInspection {
  readonly state: "CURRENT" | "UPDATE_REQUIRED" | "REFUSED";
  readonly code: string;
  readonly detail: string;
  readonly runningSha: string;
  readonly targetSha: string | null;
  readonly reliedOn: readonly string[];
}

export interface RuntimeReleaseApplyResult {
  readonly state: "UPDATED" | "REFUSED";
  readonly code: string;
  readonly detail: string;
  readonly targetSha: string;
  readonly switched: boolean;
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type RunCommand = (
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv },
) => CommandResult;

function lowerFullSha(value: unknown): string | null {
  return typeof value === "string" && FULL_SHA.test(value) ? value.toLowerCase() : null;
}

function refused(
  code: string,
  detail: string,
  runningSha: string,
  targetSha: string | null = null,
): RuntimeReleaseInspection {
  return { state: "REFUSED", code, detail, runningSha, targetSha, reliedOn: [] };
}

/** Convert either supported origin URL form to the GitHub API's owner/repo key. */
export function githubRepositoryFromOrigin(origin: string): string | null {
  const value = origin.trim().replace(/\/+$/, "");
  const https = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  const match = https ?? ssh;
  return match === null ? null : `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

/**
 * Read the newest attempt for each context and require every canonical context
 * to conclude `success`. Missing, pending, cancelled, skipped and neutral all
 * refuse; an empty required set is also an instrumentation failure.
 */
export function requiredContextEvidence(
  runs: readonly GithubCheckRun[],
  required: readonly string[] = REQUIRED_CONTEXTS,
): { readonly ok: true; readonly contexts: readonly string[] } | {
  readonly ok: false;
  readonly code: "REQUIRED_CONTEXTS_EMPTY" | "REQUIRED_CONTEXT_MISSING" | "REQUIRED_CONTEXT_NOT_GREEN";
  readonly detail: string;
} {
  if (required.length === 0) {
    return { ok: false, code: "REQUIRED_CONTEXTS_EMPTY", detail: "the required software-check set is empty" };
  }
  const newest = new Map<string, { readonly at: string; readonly id: number; readonly conclusion: string | null }>();
  for (const run of runs) {
    if (typeof run.name !== "string" || run.name.trim() === "") continue;
    // Attempt order is when the attempt STARTED, not when it happened to
    // finish. An older, slow success completing after a newer failure/pending
    // run must never overwrite the newer fail-closed verdict.
    const at = typeof run.started_at === "string"
      ? run.started_at
      : typeof run.completed_at === "string" ? run.completed_at : "";
    const id = typeof run.id === "number" && Number.isFinite(run.id) ? run.id : -1;
    const prior = newest.get(run.name);
    if (prior !== undefined && (prior.at > at || (prior.at === at && prior.id > id))) continue;
    newest.set(run.name, {
      at,
      id,
      conclusion: typeof run.conclusion === "string" ? run.conclusion.toLowerCase() : null,
    });
  }
  const missing = required.filter((name) => !newest.has(name));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "REQUIRED_CONTEXT_MISSING",
      detail: `${missing.length} required context(s) are absent: ${missing.join(", ")}`,
    };
  }
  const notGreen = required.filter((name) => newest.get(name)?.conclusion !== "success");
  if (notGreen.length > 0) {
    return {
      ok: false,
      code: "REQUIRED_CONTEXT_NOT_GREEN",
      detail: notGreen.map((name) => `${name}=${newest.get(name)?.conclusion ?? "pending"}`).join(", "),
    };
  }
  return { ok: true, contexts: [...required] };
}

/** Accept the deployed release using the existing required CI checks. */
export function inspectRuntimeReleaseEvidence(input: {
  readonly runningSha: string | null;
  readonly served: ServedCommit;
  readonly checkRuns: readonly GithubCheckRun[] | null;
}): RuntimeReleaseInspection {
  const runningSha = lowerFullSha(input.runningSha);
  if (runningSha === null) {
    return refused("RUNNING_SHA_UNRESOLVED", "the running process is not bound to a full Git commit", "unknown");
  }
  const targetSha = lowerFullSha(input.served.sha);
  if (targetSha === null) {
    return refused(
      "DEPLOYED_SHA_UNRESOLVED",
      `production did not report a full 40-character commit (${input.served.how})`,
      runningSha,
    );
  }
  if (input.checkRuns === null) {
    return refused(
      "SOFTWARE_CI_UNREADABLE",
      `required software checks could not be read for ${targetSha}`,
      runningSha,
      targetSha,
    );
  }
  const checks = requiredContextEvidence(input.checkRuns);
  if (!checks.ok) return refused(checks.code, checks.detail, runningSha, targetSha);
  return {
    state: runningSha === targetSha ? "CURRENT" : "UPDATE_REQUIRED",
    code: runningSha === targetSha ? "RUNTIME_RELEASE_CURRENT" : "RUNTIME_RELEASE_UPDATE_REQUIRED",
    detail: runningSha === targetSha
      ? `running code equals the deployed, CI-passing SHA ${targetSha}`
      : `running ${runningSha}; deployed, CI-passing target is ${targetSha}`,
    runningSha,
    targetSha,
    reliedOn: checks.contexts,
  };
}

/** GitHub adapter. Authentication is optional for this public repository. */
export async function fetchGithubCheckRuns(input: {
  readonly repository: string;
  readonly sha: string;
  readonly fetchImpl?: typeof fetch;
  readonly token?: string | null;
  readonly timeoutMs?: number;
}): Promise<readonly GithubCheckRun[] | null> {
  if (!FULL_SHA.test(input.sha) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "we-the-people-permanent-runtime",
    };
    if (input.token) headers.authorization = `Bearer ${input.token}`;
    const response = await (input.fetchImpl ?? fetch)(
      `https://api.github.com/repos/${input.repository}/commits/${input.sha}/check-runs?filter=latest&per_page=100`,
      { headers, signal: controller.signal },
    );
    if (!response.ok) return null;
    const body = await response.json() as { readonly total_count?: unknown; readonly check_runs?: unknown };
    if (!Array.isArray(body.check_runs)) return null;
    const total = typeof body.total_count === "number" ? body.total_count : body.check_runs.length;
    // A truncated response can omit a required context. Refuse the instrument,
    // rather than allowing the first hundred rows to look complete by chance.
    if (total > body.check_runs.length) return null;
    return body.check_runs as readonly GithubCheckRun[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface RuntimeProductionDeploy {
  readonly commit_ref?: unknown;
  readonly context?: unknown;
  readonly branch?: unknown;
  readonly state?: unknown;
  readonly published_at?: unknown;
}

/** Reuse the configured production project's deploy history; never publish. */
export async function fetchRuntimeProductionDeploys(input: {
  readonly siteId: string | undefined;
  readonly token: string | undefined;
  readonly fetchImpl?: typeof fetch;
}): Promise<readonly RuntimeProductionDeploy[] | null> {
  if (!input.siteId?.trim() || !input.token?.trim()) return null;
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(input.siteId)}/deploys?per_page=40`,
      { headers: { authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? rows.filter((row): row is RuntimeProductionDeploy => row !== null && typeof row === "object") : null;
  } catch { return null; }
}

/** Prefer the served SHA; only consult published history when its CI is not green. */
export async function inspectNewestDeployedRuntimeRelease(input: {
  readonly runningSha: string | null;
  readonly served: ServedCommit;
  readonly checkRuns: readonly GithubCheckRun[] | null;
  readonly readDeploys: () => Promise<readonly RuntimeProductionDeploy[] | null>;
  readonly readChecks: (sha: string) => Promise<readonly GithubCheckRun[] | null>;
}): Promise<RuntimeReleaseInspection> {
  const head = inspectRuntimeReleaseEvidence(input);
  if (head.state !== "REFUSED" || lowerFullSha(input.runningSha) === null || lowerFullSha(input.served.sha) === null) return head;
  const deployments = await input.readDeploys();
  if (deployments === null) return head;
  const published = deployments.flatMap(deploy => {
    const sha = lowerFullSha(deploy.commit_ref);
    const at = typeof deploy.published_at === "string" ? Date.parse(deploy.published_at) : NaN;
    return sha !== null && Number.isFinite(at) && deploy.context === "production" && deploy.branch === "main" && deploy.state === "ready"
      ? [{ sha, at }] : [];
  }).sort((a, b) => b.at - a.at);
  // Anchor the history to the observed live release. A ready preview, unpublished
  // build, or a deploy newer than a rollback is never a runtime target.
  const anchorIndex = published.findIndex(deploy => deploy.sha === head.targetSha);
  if (anchorIndex < 0) return head;
  const seen = new Set([head.targetSha]);
  for (const deploy of published.slice(anchorIndex + 1)) {
    if (seen.has(deploy.sha)) continue;
    seen.add(deploy.sha);
    const candidate = inspectRuntimeReleaseEvidence({ runningSha: input.runningSha,
      served: { ...input.served, sha: deploy.sha }, checkRuns: await input.readChecks(deploy.sha) });
    if (candidate.state !== "REFUSED") return { ...candidate,
      detail: `${candidate.detail}; newer served ${head.targetSha} is not yet certified (${head.code})` };
  }
  return head;
}

function defaultRunCommand(
  executable: string,
  args: readonly string[],
  options: Parameters<RunCommand>[2],
): CommandResult {
  const result = spawnSync(executable, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

/** Windows cannot spawn a .cmd shim without a shell. Invoke its same-Node JS entry directly. */
export function runtimePackageManagerCommand(input: {
  readonly platform?: NodeJS.Platform;
  readonly nodeExecutable?: string;
  readonly exists?: (path: string) => boolean;
} = {}): { readonly executable: string; readonly args: readonly string[] } | null {
  const args = ["pnpm", "install", "--frozen-lockfile"];
  if ((input.platform ?? process.platform) !== "win32") return { executable: "corepack", args };
  const node = input.nodeExecutable ?? process.execPath;
  const entry = win32.join(win32.dirname(node), "node_modules", "corepack", "dist", "corepack.js");
  if (!(input.exists ?? existsSync)(entry)) return null;
  return { executable: node, args: [entry, ...args] };
}

/** Resolve the API repository from the checkout's configured origin. */
export function runtimeGithubRepository(root: string, run: RunCommand = defaultRunCommand): string | null {
  const result = run("git", ["remote", "get-url", "origin"], { cwd: root, timeoutMs: COMMAND_TIMEOUT_MS });
  return result.status === 0 ? githubRepositoryFromOrigin(result.stdout) : null;
}

/** Operational civic readers must not inherit a developer checkout's database. */
export function runtimeProductionReadEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.WTP_RUNTIME_MODE === "staging") return { ...env };
  const connection = env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!connection?.trim()) throw new Error("RUNTIME_CIVIC_READ_TARGET_UNAVAILABLE");
  let protocol: string;
  try { protocol = new URL(connection).protocol; }
  catch { throw new Error("RUNTIME_CIVIC_READ_TARGET_INVALID"); }
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error("RUNTIME_CIVIC_READ_TARGET_INVALID");
  }
  return { ...env, DATABASE_URL: connection };
}

/** Reuse the host's authenticated CLI without copying its credential to disk. */
export function runtimeGithubCredential(input: {
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runCommand?: RunCommand;
}): string | null {
  const configured = input.env.GH_TOKEN ?? input.env.GITHUB_TOKEN;
  if (configured !== undefined) return configured;
  try {
    const result = (input.runCommand ?? defaultRunCommand)(
      "gh", ["auth", "token", "--hostname", "github.com"],
      { cwd: input.root, timeoutMs: 15_000 },
    );
    // Never include stdout/stderr in a diagnostic: either may contain secrets.
    const token = result.stdout.trim();
    return result.status === 0 && /^[A-Za-z0-9_]+$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function conciseFailure(result: CommandResult): string {
  const first = `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first?.slice(0, 300) ?? `exit ${result.status ?? "unresolved"}`;
}

export function writeRuntimeReleaseHold(root: string, value: object): void {
  const path = join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const prior = readRuntimeReleaseHold(root);
  // An Admin failure report must not erase an unfinished checkout installation.
  const recovery = prior?.switched === true ? { switched: true, targetSha: prior.targetSha } : {};
  writeFileSync(path, `${JSON.stringify({ ...value, ...recovery }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readRuntimeReleaseHold(root: string): { readonly switched?: unknown; readonly targetSha?: unknown } | null {
  const path = join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH);
  if (!existsSync(path)) return null;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  return value !== null && typeof value === "object" ? value : null;
}

/** A switched checkout is not ready until its frozen install finishes, even when CI says CURRENT. */
export function resumeRuntimeReleaseInstall(input: {
  readonly root: string;
  readonly runCommand?: RunCommand;
}): RuntimeReleaseApplyResult | null {
  const hold = readRuntimeReleaseHold(input.root);
  if (hold?.switched !== true) return null;
  const targetSha = lowerFullSha(hold.targetSha);
  if (targetSha === null) throw new Error("RUNTIME_INSTALL_TARGET_INVALID");
  return finishRuntimeReleaseInstall({ ...input, targetSha });
}

function finishRuntimeReleaseInstall(input: {
  readonly root: string;
  readonly targetSha: string;
  readonly runCommand?: RunCommand;
  readonly install?: boolean;
}): RuntimeReleaseApplyResult {
  const { targetSha } = input;
  const run = input.runCommand ?? defaultRunCommand;
  const refuse = (code: string, detail: string): RuntimeReleaseApplyResult => {
    writeRuntimeReleaseHold(input.root, { formatVersion: 1, state: "HELD", code, detail,
      targetSha, switched: true, observedAt: new Date().toISOString() });
    return { state: "REFUSED", code, detail, targetSha, switched: true };
  };
  const head = run("git", ["rev-parse", "HEAD"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (head.status !== 0 || lowerFullSha(head.stdout.trim()) !== targetSha) {
    return refuse("RUNTIME_CHECKOUT_EXACT_HEAD_FAILED", "checkout did not read back at the exact deployed target");
  }
  if (input.install !== false) {
    const command = runtimePackageManagerCommand();
    if (command === null) return refuse("COREPACK_ENTRY_UNAVAILABLE", "the running Node installation has no Corepack JavaScript entry; no shell fallback was attempted");
    const installed = run(command.executable, command.args, {
      cwd: input.root, timeoutMs: INSTALL_TIMEOUT_MS,
      env: { ...process.env, CI: "true" },
    });
    if (installed.status !== 0) return refuse("FROZEN_INSTALL_FAILED", conciseFailure(installed));
  }
  const dirtyAfter = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (dirtyAfter.status !== 0 || dirtyAfter.stdout.trim() !== "") {
    return refuse("RUNTIME_CHECKOUT_DIRTY_AFTER_INSTALL", "frozen installation did not leave the dedicated checkout clean");
  }
  const installedHead = run("git", ["rev-parse", "HEAD"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (installedHead.status !== 0 || lowerFullSha(installedHead.stdout.trim()) !== targetSha) {
    return refuse("RUNTIME_CHECKOUT_EXACT_HEAD_FAILED", "installation did not retain the exact deployed target");
  }
  const hold = join(input.root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH);
  if (existsSync(hold)) rmSync(hold, { force: true });
  return { state: "UPDATED", code: "RUNTIME_RELEASE_UPDATED",
    detail: `dedicated runtime checkout is detached, clean, installed, and exact at ${targetSha}`,
    targetSha, switched: true };
}

/**
 * Apply an already-inspected target at a quiescent boundary. Every predicate
 * is re-established locally after a bounded fetch. Failure leaves an ignored
 * host diagnostic for the stable launcher and returns to the caller, which
 * persists the canonical Admin outcome and terminates without reopening work.
 */
export function applyRuntimeRelease(input: {
  readonly root: string;
  readonly targetSha: string;
  readonly runCommand?: RunCommand;
  readonly install?: boolean;
}): RuntimeReleaseApplyResult {
  const targetSha = lowerFullSha(input.targetSha);
  if (targetSha === null) {
    return { state: "REFUSED", code: "TARGET_SHA_INVALID", detail: "handoff target is not a full Git commit", targetSha: input.targetSha, switched: false };
  }
  const run = input.runCommand ?? defaultRunCommand;
  let switched = false;
  const refuse = (code: string, detail: string): RuntimeReleaseApplyResult => {
    writeRuntimeReleaseHold(input.root, {
      formatVersion: 1,
      state: "HELD",
      code,
      detail,
      targetSha,
      switched,
      observedAt: new Date().toISOString(),
    });
    return { state: "REFUSED", code, detail, targetSha, switched };
  };

  const status = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (status.status !== 0) return refuse("RUNTIME_CHECKOUT_UNREADABLE", conciseFailure(status));
  if (status.stdout.trim() !== "") return refuse("RUNTIME_CHECKOUT_DIRTY", "dedicated runtime checkout contains changed or untracked paths");

  const detached = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (detached.status === 0) return refuse("RUNTIME_CHECKOUT_ATTACHED", `runtime checkout is attached to ${detached.stdout.trim() || "a branch"}`);
  if (detached.status !== 1) return refuse("RUNTIME_CHECKOUT_UNREADABLE", conciseFailure(detached));

  const fetched = run("git", ["fetch", "--quiet", "--no-tags", "origin", "main"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (fetched.status !== 0) return refuse("ORIGIN_MAIN_FETCH_FAILED", conciseFailure(fetched));
  const object = run("git", ["cat-file", "-e", `${targetSha}^{commit}`], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (object.status !== 0) return refuse("DEPLOYED_COMMIT_MISSING", `origin fetch did not provide deployed commit ${targetSha}`);
  const ancestor = run("git", ["merge-base", "--is-ancestor", targetSha, "origin/main"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (ancestor.status !== 0) return refuse("DEPLOYED_COMMIT_NOT_ON_MAIN", `${targetSha} is not proven to be an ancestor of origin/main`);

  const switchedResult = run("git", ["switch", "--detach", targetSha], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (switchedResult.status !== 0) return refuse("RUNTIME_CHECKOUT_SWITCH_FAILED", conciseFailure(switchedResult));
  switched = true;
  // Persist before the blocking install so a watchdog kill retains recovery state.
  writeRuntimeReleaseHold(input.root, { formatVersion: 1, state: "HELD", code: "FROZEN_INSTALL_PENDING",
    targetSha, switched, observedAt: new Date().toISOString() });
  return finishRuntimeReleaseInstall({ ...input, targetSha });
}
