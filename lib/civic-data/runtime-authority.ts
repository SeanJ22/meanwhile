import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const RUNTIME_AUTHORITY_ENV = Object.freeze({
  repo: "WTP_RUNTIME_AUTHORITY_REPO",
  sha: "WTP_RUNTIME_AUTHORITY_SHA",
  capability: "WTP_RUNTIME_AUTHORITY_CAPABILITY",
  contract: "WTP_RUNTIME_AUTHORITY_CONTRACT",
  parentPid: "WTP_RUNTIME_AUTHORITY_PARENT_PID",
  nonce: "WTP_RUNTIME_AUTHORITY_NONCE",
});

export const RUNTIME_AUTHORITY_CAPABILITIES = [
  "STANDING_PARENT",
  "ROUTINE_SUPERVISOR",
  "ROUTINE_CONTRACT",
  "INTAKE_RUNTIME",
  "RESEARCH_CYCLE",
  "CONSOLE_PUBLISHER",
  "NIGHTLY_RESEARCH",
  "OWNER_DISPATCH",
  "MANUAL_CONTRACT",
  "AGENT_BRIDGE",
] as const;
export type RuntimeAuthorityCapability = (typeof RUNTIME_AUTHORITY_CAPABILITIES)[number];

const FULL_SHA = /^[0-9a-f]{40}$/i;
const NONCE = /^[0-9a-f]{32,128}$/i;

export interface RuntimeAuthorityEnvelope {
  readonly repo: string;
  readonly sha: string;
  readonly capability: RuntimeAuthorityCapability;
  readonly contract: string | null;
  readonly parentPid: number;
  readonly nonce: string;
}

export interface RuntimeCheckoutFacts {
  readonly repositoryRoot: string;
  readonly headSha: string | null;
  readonly clean: boolean;
  readonly detached: boolean;
  readonly headOnOriginMain: boolean;
  readonly readable: boolean;
  /** Which read failed and how, when `readable` is false. Optional so recorded facts still load. */
  readonly unreadable?: string | null;
  /** Reads that failed and then answered on a bounded re-read. The admission stands; the failure is kept. */
  readonly recoveredReads?: readonly string[];
}

export interface RuntimeAuthorityExpectation {
  readonly capabilities: readonly RuntimeAuthorityCapability[];
  readonly contract?: string | null;
  /** Ordinary child admission proves the OS-observed immediate parent. */
  readonly immediateParentPid: number;
}

export class RuntimeAuthorityRefused extends Error {
  constructor(detail: string) {
    super(`PERMANENT_RUNTIME_AUTHORITY_REFUSED:${detail}`);
    this.name = "RuntimeAuthorityRefused";
  }
}

function samePath(left: string, right: string): boolean {
  try {
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    return normalize(realpathSync(resolve(left))) === normalize(realpathSync(resolve(right)));
  } catch {
    return false;
  }
}

/**
 * **A READ THAT DID NOT ANSWER IS READ AGAIN, BRIEFLY, AND ITS FAILURE IS KEPT** (2026-09-25).
 *
 * The runtime checkout is a Git worktree of the development repository, so
 * every read here also reads that repository's shared `.git/config`, and
 * every branch an agent creates, tracks or pushes rewrites that file. On
 * Windows a read that opens it during the rewrite fails:
 * `warning: unable to access '.git/config': Permission denied` and
 * `fatal: unknown error occurred while reading the configuration files`,
 * exit 128. Reproduced on the runner host with a controlled writer: 4 of 950
 * reads failed. In production it refused 15 admitted children on
 * 2026-09-23..25 as "runtime checkout facts are unreadable", among them the
 * registration-nc, -nd and -oh Reader repairs of the 2026-09-25T23:01Z pass,
 * which passed the pass before and the pass after on the same code.
 *
 * A read that exits with an ANSWER is a fact and is never re-read: a dirty
 * tree, a branch, another HEAD or an ancestry of 1 refuse at once. Only a
 * read that failed to answer (Git's fatal exit, a timeout, a failed spawn) is
 * re-read, at most `GIT_READ_ATTEMPTS` times, and its failure travels with the
 * facts either way: in the refusal when it never answered, and as a recovered
 * read when it did.
 */
export const GIT_READ_ATTEMPTS = 3;
const GIT_READ_PAUSES_MS = [50, 200] as const;

type GitReadResult = {
  readonly status: number | null;
  readonly stdout: string;
  /** The last failure, when the read never answered. */
  readonly failure: string | null;
  /** Failures before an answer. */
  readonly recovered: readonly string[];
};

export type GitRun = () => string;

function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function describeGitFailure(label: string, error: unknown): { readonly status: number | null; readonly text: string } {
  const field = (key: string): unknown => error !== null && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
  const status = typeof field("status") === "number" ? field("status") as number : null;
  const signal = typeof field("signal") === "string" ? field("signal") as string : null;
  const code = typeof field("code") === "string" ? field("code") as string : null;
  const stderr = typeof field("stderr") === "string" ? field("stderr") as string : "";
  const said = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-2).join(" / ").slice(0, 240);
  const how = status !== null ? `exited ${status}` : signal !== null ? `was stopped by ${signal}` : `did not run (${code ?? "unknown error"})`;
  return { status, text: `git ${label} ${how}${said ? ` (${said})` : ""}` };
}

/** One read, re-read only while it fails to answer. `answers` are the non-zero exits that ARE facts. */
export function gitReadWithRetry(
  label: string,
  run: GitRun,
  answers: readonly number[] = [],
  pause: (ms: number) => void = pauseSync,
): GitReadResult {
  const recovered: string[] = [];
  for (let attempt = 1; ; attempt += 1) {
    try {
      return { status: 0, stdout: run().trim(), failure: null, recovered };
    } catch (error) {
      const failed = describeGitFailure(label, error);
      if (failed.status !== null && answers.includes(failed.status)) {
        return { status: failed.status, stdout: "", failure: null, recovered };
      }
      if (attempt >= GIT_READ_ATTEMPTS) {
        return { status: failed.status, stdout: "", failure: `${failed.text} on ${attempt} of ${attempt} attempts`, recovered };
      }
      recovered.push(`${failed.text} on attempt ${attempt}`);
      pause(GIT_READ_PAUSES_MS[attempt - 1] ?? GIT_READ_PAUSES_MS[GIT_READ_PAUSES_MS.length - 1]);
    }
  }
}

function gitOptions(root: string): ExecFileSyncOptionsWithStringEncoding {
  return {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    // stderr is read only to name a failed read; Git's read-only verbs print no secrets.
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  };
}

// Each subprocess call carries a literal read-only verb. The authority gate
// cannot accept a caller-supplied Git argv: that would be a latent mutation
// door and would also make the executable firewall unable to prove the call
// is code-identity inspection only.
export interface RuntimeCheckoutReads {
  readonly repositoryRoot: GitRun;
  readonly head: GitRun;
  readonly status: GitRun;
  readonly branch: GitRun;
  readonly isAncestorOfOriginMain: (head: string) => GitRun;
}

function gitCheckoutReads(root: string): RuntimeCheckoutReads {
  return {
    repositoryRoot: () => execFileSync("git", ["rev-parse", "--show-toplevel"], gitOptions(root)),
    head: () => execFileSync("git", ["rev-parse", "HEAD"], gitOptions(root)),
    status: () => execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], gitOptions(root)),
    branch: () => execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], gitOptions(root)),
    isAncestorOfOriginMain: (head) => () => execFileSync("git", ["merge-base", "--is-ancestor", head, "origin/main"], gitOptions(root)),
  };
}

const UNREADABLE = (root: string, why: string): RuntimeCheckoutFacts =>
  ({ repositoryRoot: root, headSha: null, clean: false, detached: false, headOnOriginMain: false, readable: false, unreadable: why });

/** Read-only facts. Unknown/unreadable values all settle in the refusing direction. */
export function inspectRuntimeCheckout(
  root: string,
  options: { readonly reads?: RuntimeCheckoutReads; readonly pause?: (ms: number) => void } = {},
): RuntimeCheckoutFacts {
  if (!isAbsolute(root)) return UNREADABLE(root, "the checkout path is not absolute");
  try {
    const reads = options.reads ?? gitCheckoutReads(root);
    const read = (label: string, run: GitRun, answers: readonly number[] = []) => gitReadWithRetry(label, run, answers, options.pause);
    const repository = read("rev-parse --show-toplevel", reads.repositoryRoot);
    const head = read("rev-parse HEAD", reads.head);
    const dirty = read("status", reads.status);
    // symbolic-ref exits 1 on a detached HEAD, and merge-base --is-ancestor exits 1 when it is not one: both are answers.
    const branch = read("symbolic-ref HEAD", reads.branch, [1]);
    const headSha = head.status === 0 && FULL_SHA.test(head.stdout) ? head.stdout.toLowerCase() : null;
    const ancestor = headSha !== null
      ? read("merge-base --is-ancestor HEAD origin/main", reads.isAncestorOfOriginMain(head.stdout), [1])
      : null;
    const all = [repository, head, dirty, branch, ...(ancestor ? [ancestor] : [])];
    const failures = all.flatMap((result) => result.failure === null ? [] : [result.failure]);
    return {
      repositoryRoot: repository.stdout,
      headSha,
      clean: dirty.status === 0 && dirty.stdout === "",
      detached: branch.status === 1,
      headOnOriginMain: ancestor?.status === 0,
      readable: repository.status === 0 && head.status === 0 && dirty.status === 0 &&
        (branch.status === 0 || branch.status === 1) && (ancestor === null || ancestor.status === 0 || ancestor.status === 1),
      unreadable: failures.length > 0 ? failures.join("; ") : null,
      recoveredReads: all.flatMap((result) => result.recovered),
    };
  } catch (error) {
    return UNREADABLE(root, error instanceof Error ? error.message.slice(0, 240) : String(error));
  }
}

export function runtimeAuthorityEnvelope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeAuthorityEnvelope | null {
  const repo = env[RUNTIME_AUTHORITY_ENV.repo] ?? "";
  const sha = (env[RUNTIME_AUTHORITY_ENV.sha] ?? "").toLowerCase();
  const capability = env[RUNTIME_AUTHORITY_ENV.capability] ?? "";
  const contract = env[RUNTIME_AUTHORITY_ENV.contract]?.trim() || null;
  const parentPid = Number(env[RUNTIME_AUTHORITY_ENV.parentPid]);
  const nonce = env[RUNTIME_AUTHORITY_ENV.nonce] ?? "";
  if (
    !isAbsolute(repo) ||
    !FULL_SHA.test(sha) ||
    !(RUNTIME_AUTHORITY_CAPABILITIES as readonly string[]).includes(capability) ||
    !Number.isSafeInteger(parentPid) || parentPid <= 0 ||
    !NONCE.test(nonce)
  ) return null;
  return { repo, sha, capability: capability as RuntimeAuthorityCapability, contract, parentPid, nonce };
}

/** Pure verdict used by the executable check and mutation/positive-control tests. */
export function runtimeAuthorityIssue(input: {
  readonly envelope: RuntimeAuthorityEnvelope | null;
  readonly expectation: RuntimeAuthorityExpectation;
  readonly checkout: RuntimeCheckoutFacts;
  readonly cwd: string;
}): string | null {
  const { envelope, expectation, checkout } = input;
  if (envelope === null) return "authority envelope is absent or malformed";
  if (!expectation.capabilities.includes(envelope.capability)) {
    return `capability ${envelope.capability} is not one of ${expectation.capabilities.join(",")}`;
  }
  if (envelope.parentPid !== expectation.immediateParentPid) {
    return `admitted parent pid ${envelope.parentPid} is not immediate parent ${expectation.immediateParentPid}`;
  }
  if (!samePath(envelope.repo, input.cwd) || !samePath(envelope.repo, checkout.repositoryRoot)) {
    return "authority repository, cwd, and Git root are not the same path";
  }
  if (!checkout.readable || checkout.headSha === null) {
    return `runtime checkout facts are unreadable${checkout.unreadable ? `: ${checkout.unreadable}` : ""}`;
  }
  if (checkout.headSha !== envelope.sha) return `runtime HEAD ${checkout.headSha} is not admitted SHA ${envelope.sha}`;
  if (!checkout.clean) return "runtime checkout is not clean";

  if (!checkout.detached) return "runtime checkout is attached to a branch";
  if (!checkout.headOnOriginMain) return "runtime HEAD is not proven on origin/main";

  if (expectation.contract !== undefined && envelope.contract !== expectation.contract) {
    return `admitted contract ${envelope.contract ?? "none"} is not ${expectation.contract ?? "none"}`;
  }
  if ((envelope.capability === "ROUTINE_CONTRACT" || envelope.capability === "MANUAL_CONTRACT") && envelope.contract === null) {
    return `${envelope.capability} lacks its exact source contract`;
  }
  if (envelope.capability !== "ROUTINE_CONTRACT" && envelope.capability !== "MANUAL_CONTRACT" && envelope.contract !== null) {
    return `${envelope.capability} may not carry a source contract`;
  }
  return null;
}

export function assertRuntimeAuthority(
  expectation: Omit<RuntimeAuthorityExpectation, "immediateParentPid"> & { readonly immediateParentPid?: number },
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    readonly cwd?: string;
    readonly checkout?: RuntimeCheckoutFacts;
    readonly immediateParentPid?: number;
  } = {},
): RuntimeAuthorityEnvelope {
  // This checkout inspection runs only when a sanctioned non-Next writer asks
  // for authority. It is deliberately runtime-dynamic; it is not a request for
  // Turbopack to trace the entire repository (including tests and credentials)
  // into every Reader bundle.
  const cwd = resolve(/* turbopackIgnore: true */ options.cwd ?? process.cwd());
  const envelope = runtimeAuthorityEnvelope(env);
  const fullExpectation: RuntimeAuthorityExpectation = {
    ...expectation,
    immediateParentPid: options.immediateParentPid ?? expectation.immediateParentPid ?? process.ppid,
  };
  const checkout = options.checkout ?? inspectRuntimeCheckout(envelope?.repo ?? cwd);
  const issue = runtimeAuthorityIssue({
    envelope,
    expectation: fullExpectation,
    checkout,
    cwd,
  });
  if (issue !== null) throw new RuntimeAuthorityRefused(issue);
  // Admitted on facts that answered; a read that failed first is still said, not swallowed.
  if (checkout.recoveredReads?.length) {
    process.stderr.write(`RUNTIME_AUTHORITY_READ_RECOVERED ${checkout.recoveredReads.join("; ")}\n`);
  }
  return envelope!;
}

/** Rotate the parent nonce and bind one child to this exact PID and capability. */
export function admittedRuntimeChildEnvironment(input: {
  readonly parentEnv?: NodeJS.ProcessEnv;
  readonly capability: RuntimeAuthorityCapability;
  readonly contract?: string | null;
  readonly parentPid?: number;
  readonly nonce?: string;
}): NodeJS.ProcessEnv {
  const env = input.parentEnv ?? process.env;
  const repo = env[RUNTIME_AUTHORITY_ENV.repo];
  const sha = env[RUNTIME_AUTHORITY_ENV.sha];
  if (!repo || !sha || !FULL_SHA.test(sha)) {
    throw new RuntimeAuthorityRefused("an admitted parent lacks exact repository/SHA facts");
  }
  return {
    ...env,
    [RUNTIME_AUTHORITY_ENV.repo]: repo,
    [RUNTIME_AUTHORITY_ENV.sha]: sha.toLowerCase(),
    [RUNTIME_AUTHORITY_ENV.capability]: input.capability,
    [RUNTIME_AUTHORITY_ENV.contract]: input.contract?.trim() || undefined,
    [RUNTIME_AUTHORITY_ENV.parentPid]: String(input.parentPid ?? process.pid),
    [RUNTIME_AUTHORITY_ENV.nonce]: input.nonce ?? randomBytes(32).toString("hex"),
  };
}

export function assertRegisteredRuntimeContract(
  contractId: string,
  kind: "routine" | "manual",
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  assertRuntimeAuthority({
    capabilities: [kind === "routine" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT"],
    contract: contractId,
  }, env);
}

/** Every named non-Next production sanction converges on this authority check. */
export function assertSanctionedRuntimeAuthority(
  operation: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (operation === "an intake limiter purge") {
    assertRuntimeAuthority({ capabilities: ["INTAKE_RUNTIME"] }, env);
    return;
  }
  if (operation === "a routine civic data candidate/version promotion") {
    assertRuntimeAuthority({
      capabilities: ["ROUTINE_SUPERVISOR", "ROUTINE_CONTRACT", "MANUAL_CONTRACT"],
    }, env);
    return;
  }
  throw new RuntimeAuthorityRefused(`sanctioned operation ${JSON.stringify(operation)} has no permanent runtime capability`);
}
