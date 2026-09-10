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
  // Temporary one-time cutover capability. The importer that mints it and
  // this member are deleted together after the production seed readback.
  "TRUSTED_LKG_IMPORT",
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
}

export interface RuntimeAuthorityExpectation {
  readonly capabilities: readonly RuntimeAuthorityCapability[];
  readonly contract?: string | null;
  /** Ordinary child admission proves the OS-observed immediate parent. */
  readonly immediateParentPid: number;
  /** The one-time importer has its own stronger frozen-tree attestation. */
  readonly allowTemporaryImporterCheckout?: boolean;
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

type GitReadResult = { readonly status: number | null; readonly stdout: string };

function gitRead(run: () => string): GitReadResult {
  try {
    const stdout = run().trim();
    return { status: 0, stdout };
  } catch (error) {
    const status = error !== null && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : null;
    return { status, stdout: "" };
  }
}

function gitOptions(root: string): ExecFileSyncOptionsWithStringEncoding {
  return {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 20_000,
  };
}

// Each subprocess call carries a literal read-only verb. The authority gate
// cannot accept a caller-supplied Git argv: that would be a latent mutation
// door and would also make the executable firewall unable to prove the call
// is code-identity inspection only.
const gitRepositoryRoot = (root: string): GitReadResult =>
  gitRead(() => execFileSync("git", ["rev-parse", "--show-toplevel"], gitOptions(root)));
const gitHead = (root: string): GitReadResult =>
  gitRead(() => execFileSync("git", ["rev-parse", "HEAD"], gitOptions(root)));
const gitStatus = (root: string): GitReadResult =>
  gitRead(() => execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], gitOptions(root)));
const gitBranch = (root: string): GitReadResult =>
  gitRead(() => execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], gitOptions(root)));
const gitIsAncestorOfOriginMain = (root: string, head: string): GitReadResult =>
  gitRead(() => execFileSync("git", ["merge-base", "--is-ancestor", head, "origin/main"], gitOptions(root)));

/** Read-only facts. Unknown/unreadable values all settle in the refusing direction. */
export function inspectRuntimeCheckout(root: string): RuntimeCheckoutFacts {
  if (!isAbsolute(root)) {
    return { repositoryRoot: root, headSha: null, clean: false, detached: false, headOnOriginMain: false, readable: false };
  }
  try {
    const repository = gitRepositoryRoot(root);
    const head = gitHead(root);
    const dirty = gitStatus(root);
    const branch = gitBranch(root);
    const ancestor = head.status === 0 && FULL_SHA.test(head.stdout)
      ? gitIsAncestorOfOriginMain(root, head.stdout)
      : { status: null, stdout: "" };
    return {
      repositoryRoot: repository.stdout,
      headSha: head.status === 0 && FULL_SHA.test(head.stdout) ? head.stdout.toLowerCase() : null,
      clean: dirty.status === 0 && dirty.stdout === "",
      detached: branch.status === 1,
      headOnOriginMain: ancestor.status === 0,
      readable: repository.status === 0 && head.status === 0 && dirty.status === 0 && (branch.status === 0 || branch.status === 1),
    };
  } catch {
    return { repositoryRoot: root, headSha: null, clean: false, detached: false, headOnOriginMain: false, readable: false };
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
  if (!checkout.readable || checkout.headSha === null) return "runtime checkout facts are unreadable";
  if (checkout.headSha !== envelope.sha) return `runtime HEAD ${checkout.headSha} is not admitted SHA ${envelope.sha}`;
  if (!checkout.clean) return "runtime checkout is not clean";

  const temporaryImporter = envelope.capability === "TRUSTED_LKG_IMPORT" && expectation.allowTemporaryImporterCheckout === true;
  if (!temporaryImporter && !checkout.detached) return "runtime checkout is attached to a branch";
  if (!temporaryImporter && !checkout.headOnOriginMain) return "runtime HEAD is not proven on origin/main";

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
  const issue = runtimeAuthorityIssue({
    envelope,
    expectation: fullExpectation,
    checkout: options.checkout ?? inspectRuntimeCheckout(envelope?.repo ?? cwd),
    cwd,
  });
  if (issue !== null) throw new RuntimeAuthorityRefused(issue);
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

/**
 * Mint the separately self-attested one-time importer envelope in its own
 * process. This helper and capability are temporary cutover scaffolding and
 * must be deleted with `pdc-v2-trusted-lkg-import.mts` after seed readback.
 */
export function temporaryTrustedLkgImportEnvironment(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly repositoryRoot: string;
  readonly headSha: string;
  readonly processPid?: number;
  readonly nonce?: string;
}): NodeJS.ProcessEnv {
  if (!isAbsolute(input.repositoryRoot) || !FULL_SHA.test(input.headSha)) {
    throw new RuntimeAuthorityRefused("temporary trusted-LKG importer lacks exact repository/SHA attestation");
  }
  return {
    ...(input.env ?? process.env),
    [RUNTIME_AUTHORITY_ENV.repo]: resolve(input.repositoryRoot),
    [RUNTIME_AUTHORITY_ENV.sha]: input.headSha.toLowerCase(),
    [RUNTIME_AUTHORITY_ENV.capability]: "TRUSTED_LKG_IMPORT",
    [RUNTIME_AUTHORITY_ENV.contract]: undefined,
    [RUNTIME_AUTHORITY_ENV.parentPid]: String(input.processPid ?? process.pid),
    [RUNTIME_AUTHORITY_ENV.nonce]: input.nonce ?? randomBytes(32).toString("hex"),
  };
}

export function assertRegisteredRuntimeContract(
  contractId: string,
  kind: "routine" | "manual",
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const envelope = runtimeAuthorityEnvelope(env);
  if (envelope?.capability === "TRUSTED_LKG_IMPORT") return;
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
    const envelope = runtimeAuthorityEnvelope(env);
    assertRuntimeAuthority({
      capabilities: ["ROUTINE_SUPERVISOR", "ROUTINE_CONTRACT", "MANUAL_CONTRACT", "TRUSTED_LKG_IMPORT"],
      allowTemporaryImporterCheckout: envelope?.capability === "TRUSTED_LKG_IMPORT",
    }, env, {
      // The temporary importer mints its envelope only after its own final
      // frozen-code attestation, inside the same process. Ordinary authority
      // always proves the actual immediate parent.
      immediateParentPid: envelope?.capability === "TRUSTED_LKG_IMPORT" ? process.pid : process.ppid,
    });
    return;
  }
  throw new RuntimeAuthorityRefused(`sanctioned operation ${JSON.stringify(operation)} has no permanent runtime capability`);
}
