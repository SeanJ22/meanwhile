/**
 * Exact, fail-closed software handoff for the permanent standing runtime.
 *
 * Routine data never causes this path to run.  The only target is the SHA the
 * already-deployed application reports from `/api/build`, and it is eligible
 * only after the existing post-deploy integrity receipt and every required
 * software check are green for that exact commit.  The adapter at the bottom
 * may fetch/switch/install in a dedicated clean checkout; it has no commit,
 * push, merge, deployment, or civic-data write operation.
 *
 * @freshness-reads-here — observedAt records the exact release-handoff
 * observation that produced a hold; it is not civic-data source freshness.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";

import type { ProductionIntegrityRead } from "./production-integrity-data-plane.ts";
import { REQUIRED_CONTEXTS } from "./required-contexts.ts";
import type { ServedCommit } from "../../scripts/post-deploy-observer.mts";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const COMMAND_TIMEOUT_MS = 2 * 60_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
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
  options: { readonly cwd: string; readonly timeoutMs: number },
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

/** Pure authority/certification decision. */
export function inspectRuntimeReleaseEvidence(input: {
  readonly runningSha: string | null;
  readonly served: ServedCommit;
  readonly integrity: ProductionIntegrityRead;
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
  if (input.integrity.kind !== "HELD") {
    return refused(
      `POST_DEPLOY_INTEGRITY_${input.integrity.kind}`,
      input.integrity.detail,
      runningSha,
      targetSha,
    );
  }
  const integritySha = lowerFullSha(input.integrity.record.deployedSha);
  if (
    input.integrity.record.observed !== "HELD" ||
    input.integrity.record.gateExit !== 0 ||
    input.integrity.record.moment !== "post-deploy" ||
    integritySha !== targetSha
  ) {
    return refused(
      "POST_DEPLOY_INTEGRITY_NOT_HELD_FOR_TARGET",
      `latest post-deploy integrity is ${input.integrity.record.observed} for ${integritySha ?? "no full SHA"}, not HELD for ${targetSha}`,
      runningSha,
      targetSha,
    );
  }
  if (input.checkRuns === null) {
    return refused(
      "SOFTWARE_CERTIFICATION_UNREADABLE",
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
      ? `running code equals the deployed, integrity-held, fully certified SHA ${targetSha}`
      : `running ${runningSha}; deployed, integrity-held, fully certified target is ${targetSha}`,
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

function defaultRunCommand(
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number },
): CommandResult {
  const result = spawnSync(executable, [...args], {
    cwd: options.cwd,
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
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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

  if (input.install !== false) {
    const command = runtimePackageManagerCommand();
    if (command === null) return refuse("COREPACK_ENTRY_UNAVAILABLE", "the running Node installation has no Corepack JavaScript entry; no shell fallback was attempted");
    const installed = run(command.executable, command.args, { cwd: input.root, timeoutMs: INSTALL_TIMEOUT_MS });
    if (installed.status !== 0) return refuse("FROZEN_INSTALL_FAILED", conciseFailure(installed));
  }

  const head = run("git", ["rev-parse", "HEAD"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (head.status !== 0 || lowerFullSha(head.stdout.trim()) !== targetSha) {
    return refuse("RUNTIME_CHECKOUT_EXACT_HEAD_FAILED", "checkout did not read back at the exact deployed target");
  }
  const dirtyAfter = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: input.root, timeoutMs: COMMAND_TIMEOUT_MS });
  if (dirtyAfter.status !== 0 || dirtyAfter.stdout.trim() !== "") {
    return refuse("RUNTIME_CHECKOUT_DIRTY_AFTER_INSTALL", "frozen installation did not leave the dedicated checkout clean");
  }

  const hold = join(input.root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH);
  if (existsSync(hold)) rmSync(hold, { force: true });
  return {
    state: "UPDATED",
    code: "RUNTIME_RELEASE_UPDATED",
    detail: `dedicated runtime checkout is detached, clean, installed, and exact at ${targetSha}`,
    targetSha,
    switched: true,
  };
}
