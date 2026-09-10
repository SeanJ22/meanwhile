/**
 * Materialize a Reader closure's execution-authority evidence from an exact
 * Neon provider readback, a completed PDC import receipt, and fresh SELECT-only
 * database observations.
 *
 * The database handle is accepted only through the fixed environment variable
 * below. It is never accepted on argv, written into an artifact, or printed.
 * Runtime controller inputs may be Git-ignored; after semantic validation their
 * exact bytes are copied into immutable `docs/evidence` support files and bound
 * by SHA-256 from the sanitized authority artifact.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import {
  buildReaderExecutionAuthorityEvidence,
  canonicalReaderAuthorityJson,
  type ReaderAuthoritySql,
} from "../lib/holdings/reader-execution-authority.ts";
import {
  readerClosureExecutionAuthorityPaths,
  type ReaderClosureExecutionPhase,
} from "../lib/holdings/reader-census.ts";

export const READER_AUTHORITY_DATABASE_ENV =
  "WTP_READER_EXECUTION_AUTHORITY_DATABASE_URL_READONLY";

const SCRIPT_PATH = "scripts/reader-execution-authority-evidence.mts";
const CORE_PATH = "lib/holdings/reader-execution-authority.ts";
const GIT_SHA = /^[0-9a-f]{40}$/;
const SAFE_INPUT = /^docs\/evidence\/reader-last-mile-[a-z0-9-]+\.json$/;
const SECRET_URL = /\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi;
const FORBIDDEN_CAPABILITY_ENV = [
  "DATABASE_URL",
  "WTP_DB_ROLE",
  "WTP_SANCTIONED_WRITE",
  "WTP_PRODUCTION_DATABASE_URL_WRITE",
  "WTP_PRODUCTION_DATABASE_URL_READONLY",
  "WTP_CONTROL_PLANE_DATABASE_URL",
  "WTP_CONTROL_PLANE_DATABASE_URL_READONLY",
  "WTP_RUNTIME_AUTHORITY_REPO",
  "WTP_RUNTIME_AUTHORITY_SHA",
  "WTP_RUNTIME_AUTHORITY_CAPABILITY",
  "WTP_RUNTIME_AUTHORITY_CONTRACT",
  "WTP_RUNTIME_AUTHORITY_PARENT_PID",
  "WTP_RUNTIME_AUTHORITY_NONCE",
  "NEON_API_KEY",
  "NEON_API_TOKEN",
] as const;

type Row = Record<string, unknown>;

export interface ReaderAuthorityGeneratorArguments {
  readonly phase: ReaderClosureExecutionPhase;
  readonly providerMetadataInput: string;
  readonly importReceiptInput: string;
}

export interface ReaderAuthorityEvidencePaths {
  readonly authority: string;
  readonly providerMetadata: string;
  readonly importReceipt: string;
}

export function readerAuthorityEvidencePaths(
  phase: ReaderClosureExecutionPhase,
): ReaderAuthorityEvidencePaths {
  return readerClosureExecutionAuthorityPaths(phase);
}

export function parseReaderAuthorityGeneratorArguments(
  argv: readonly string[],
): ReaderAuthorityGeneratorArguments {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--(phase|provider-metadata|import-receipt)=(.+)$/.exec(argument);
    if (!match || values.has(match[1]!)) {
      throw new Error(
        "usage: reader-execution-authority-evidence.mts " +
        "--phase=REHEARSAL|PRODUCTION --provider-metadata=<path> " +
        "--import-receipt=<path>",
      );
    }
    values.set(match[1]!, match[2]!);
  }
  if (values.size !== 3) {
    throw new Error(
      "usage: reader-execution-authority-evidence.mts " +
      "--phase=REHEARSAL|PRODUCTION --provider-metadata=<path> " +
      "--import-receipt=<path>",
    );
  }
  const phase = values.get("phase");
  if (phase !== "REHEARSAL" && phase !== "PRODUCTION") {
    throw new Error("Reader authority phase must be exactly REHEARSAL or PRODUCTION");
  }
  return {
    phase,
    providerMetadataInput: values.get("provider-metadata")!,
    importReceiptInput: values.get("import-receipt")!,
  };
}

export function readerAuthorityNodeAdmissionIssue(
  execArgv: readonly string[] = process.execArgv,
): string | null {
  let stripTypes = 0;
  let envFiles = 0;
  for (const argument of execArgv) {
    if (argument === "--experimental-strip-types") {
      stripTypes += 1;
      continue;
    }
    if (/^--env-file=[^\r\n\0]+$/.test(argument)) {
      envFiles += 1;
      continue;
    }
    return "Reader authority executable has an unexpected Node preload or execution flag";
  }
  if (stripTypes !== 1) return "Reader authority executable requires --experimental-strip-types exactly once";
  if (envFiles > 1) return "Reader authority executable accepts at most one exact environment file";
  return null;
}

export function readerAuthorityAmbientCapabilityIssue(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  if (environment.NODE_OPTIONS?.trim()) return "Reader authority executable refuses NODE_OPTIONS";
  if (environment.NODE_PATH?.trim()) return "Reader authority executable refuses NODE_PATH";
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return "Reader authority executable refuses disabled TLS verification";
  }
  for (const name of FORBIDDEN_CAPABILITY_ENV) {
    if (environment[name]?.trim()) return `Reader authority executable refuses ambient capability ${name}`;
  }
  for (const [name, value] of Object.entries(environment)) {
    if (
      name !== READER_AUTHORITY_DATABASE_ENV &&
      typeof value === "string" &&
      /\bpostgres(?:ql)?:\/\//i.test(value)
    ) return `Reader authority executable refuses an ambient database handle in ${name}`;
  }
  return null;
}

function comparable(path: string): string {
  const value = realpathSync(resolve(path));
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Reader authority Git proof failed (${args[0] ?? "unknown command"})`);
  }
  return String(result.stdout ?? "").trim();
}

function gitSucceeded(root: string, args: readonly string[]): boolean {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  return !result.error && result.status === 0;
}

export interface ReaderAuthorityRepositoryProof {
  readonly root: string;
  readonly exactHead: string;
}

function proveRepository(cwd: string, allowedUntracked: readonly string[]): ReaderAuthorityRepositoryProof {
  const root = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
  if (comparable(root) !== comparable(cwd)) {
    throw new Error("Reader authority generator must run at the exact Git root");
  }
  const exactHead = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).toLowerCase();
  if (!GIT_SHA.test(exactHead)) throw new Error("Reader authority Git head is not exact");

  const allowed = new Set(allowedUntracked.map((path) => `?? ${path}`));
  const dirty = git(root, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !allowed.has(line));
  if (dirty.length > 0) {
    throw new Error("Reader authority proof tree contains changes outside its exact support outputs");
  }
  for (const path of [SCRIPT_PATH, CORE_PATH]) {
    if (!gitSucceeded(root, ["cat-file", "-e", `${exactHead}:${path}`])) {
      throw new Error(`Reader authority implementation is not tracked at exact head (${path})`);
    }
    if (!gitSucceeded(root, ["diff", "--quiet", exactHead, "--", path])) {
      throw new Error(`Reader authority implementation bytes differ from exact head (${path})`);
    }
  }
  return { root, exactHead };
}

/**
 * Repeat the complete Git census at the publication boundary. A HEAD-only
 * comparison is insufficient: a tracked or unapproved untracked file can
 * change while the live database readback is in flight without moving HEAD.
 */
export function proveReaderAuthorityRepositoryBeforePublish(
  cwd: string,
  allowedUntracked: readonly string[],
  expected: ReaderAuthorityRepositoryProof,
): ReaderAuthorityRepositoryProof {
  const observed = proveRepository(cwd, allowedUntracked);
  if (
    comparable(observed.root) !== comparable(expected.root) ||
    observed.exactHead !== expected.exactHead
  ) {
    throw new Error("Reader authority Git repository or head changed during live readback");
  }
  return observed;
}

function repositoryPath(root: string, input: string): { absolute: string; relative: string } {
  const absolute = resolve(root, input);
  if (!inside(root, absolute)) throw new Error("Reader authority input escapes the exact Git root");
  const facts = lstatSync(absolute);
  if (!facts.isFile() || facts.isSymbolicLink()) {
    throw new Error("Reader authority input is not an exact regular file");
  }
  const real = realpathSync(absolute);
  if (!inside(root, real)) throw new Error("Reader authority input resolves outside the exact Git root");
  return {
    absolute: real,
    relative: relative(root, real).replaceAll("\\", "/"),
  };
}

function readAdmissibleInput(root: string, input: string): Buffer {
  const path = repositoryPath(root, input);
  if (!SAFE_INPUT.test(path.relative) && !gitSucceeded(root, ["check-ignore", "--quiet", "--", path.relative])) {
    throw new Error("Reader authority input must be immutable last-mile evidence or Git-ignored runtime evidence");
  }
  return readFileSync(path.absolute);
}

/**
 * Create an immutable file without ever exposing partial bytes at the target.
 * The completed temporary inode is hard-linked into place, which is both
 * atomic and exclusive. Existing support evidence is reusable only when its
 * bytes are identical; authority output itself is never overwritten.
 */
export function createImmutableEvidenceFile(
  target: string,
  bytes: Buffer,
  options: { readonly allowIdenticalExisting: boolean },
): boolean {
  if (existsSync(target)) {
    let facts;
    let observed: Buffer;
    let after;
    try {
      facts = lstatSync(target);
      observed = readFileSync(target);
      after = lstatSync(target);
    } catch {
      throw new Error("Reader authority evidence target changed during reuse admission");
    }
    if (
      options.allowIdenticalExisting &&
      facts.isFile() &&
      !facts.isSymbolicLink() &&
      facts.nlink === 1 &&
      after.isFile() &&
      !after.isSymbolicLink() &&
      after.nlink === 1 &&
      facts.dev === after.dev &&
      facts.ino === after.ino &&
      facts.size === after.size &&
      observed.equals(bytes)
    ) return false;
    throw new Error("Reader authority evidence target already exists with non-reusable bytes");
  }
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  let handle: number | null = null;
  try {
    handle = openSync(temporary, "wx", 0o600);
    writeFileSync(handle, bytes);
    fsyncSync(handle);
    const written = fstatSync(handle);
    closeSync(handle);
    handle = null;
    try {
      linkSync(temporary, target);
      const linked = lstatSync(target);
      if (
        !linked.isFile() ||
        linked.isSymbolicLink() ||
        linked.dev !== written.dev ||
        linked.ino !== written.ino
      ) {
        throw new Error("Reader authority evidence target changed during exclusive publication");
      }
    } catch (error) {
      if (options.allowIdenticalExisting && existsSync(target)) {
        try {
          const facts = lstatSync(target);
          const observed = readFileSync(target);
          const after = lstatSync(target);
          if (
            facts.isFile() &&
            !facts.isSymbolicLink() &&
            facts.nlink === 1 &&
            after.isFile() &&
            !after.isSymbolicLink() &&
            after.nlink === 1 &&
            facts.dev === after.dev &&
            facts.ino === after.ino &&
            facts.size === after.size &&
            observed.equals(bytes)
          ) return false;
        } catch {
          // Preserve the exclusive publication error below.
        }
      }
      throw error;
    }
    return true;
  } finally {
    if (handle !== null) closeSync(handle);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export interface NeonReaderAuthorityTransport {
  query(statement: string): Promise<Row[]>;
  transaction(
    build: (transaction: { query(statement: string): unknown }) => readonly unknown[],
    options: { readonly readOnly: true },
  ): Promise<readonly Row[][]>;
}

export function readerAuthoritySqlFromNeon(
  sql: NeonReaderAuthorityTransport,
): ReaderAuthoritySql {
  return {
    query: async (statement) => await sql.query(statement),
    readOnlyTransaction: async (statements) => {
      const results = await sql.transaction(
        (transaction) => statements.map((statement) => transaction.query(statement)),
        { readOnly: true },
      );
      return results;
    },
  };
}

export function readerAuthorityImporterHistoryIssue(
  root: string,
  phase: ReaderClosureExecutionPhase,
  importerCodeSha: string,
  exactProofHead: string,
): string | null {
  if (phase === "PRODUCTION" && importerCodeSha === exactProofHead) {
    return "Reader production authority requires importer commit A to be a strict ancestor of deleted-importer commit B";
  }
  if (!gitSucceeded(root, ["cat-file", "-e", `${importerCodeSha}^{commit}`]) ||
      !gitSucceeded(root, ["merge-base", "--is-ancestor", importerCodeSha, exactProofHead])) {
    return "Reader authority importer commit is not an ancestor of the exact proof head";
  }
  return null;
}

export function createNeonReaderAuthoritySql(connection: string): ReaderAuthoritySql {
  return readerAuthoritySqlFromNeon(
    neon(connection) as unknown as NeonReaderAuthorityTransport,
  );
}

export function redactReaderAuthorityError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error ?? "unknown error");
  for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message
    .replace(SECRET_URL, "[REDACTED_DATABASE_URL]")
    .replace(
      /(["']?(?:password|passwd|token|api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      "$1[REDACTED]",
    );
}

function authorityContainsSecret(serialized: string, connection: string): boolean {
  const parsed = new URL(connection);
  const secrets = [connection, parsed.password, decodeURIComponent(parsed.password), parsed.hostname]
    .filter((value) => value.length >= 6);
  return /\bpostgres(?:ql)?:\/\//i.test(serialized) ||
    secrets.some((secret) => serialized.includes(secret));
}

export async function generateReaderExecutionAuthorityEvidence(
  args: ReaderAuthorityGeneratorArguments,
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<{ readonly exactHead: string; readonly paths: ReaderAuthorityEvidencePaths }> {
  const paths = readerAuthorityEvidencePaths(args.phase);
  const initial = proveRepository(cwd, [paths.providerMetadata, paths.importReceipt]);
  if (gitSucceeded(initial.root, ["cat-file", "-e", `${initial.exactHead}:${paths.authority}`]) ||
      existsSync(resolve(initial.root, paths.authority))) {
    throw new Error("Reader authority output already exists; immutable evidence is never replaced");
  }

  const connection = environment[READER_AUTHORITY_DATABASE_ENV]?.trim();
  if (!connection) {
    throw new Error(`${READER_AUTHORITY_DATABASE_ENV} is absent; refusing to guess a database`);
  }
  const providerSource = repositoryPath(initial.root, args.providerMetadataInput);
  const receiptSource = repositoryPath(initial.root, args.importReceiptInput);
  const providerBytes = readAdmissibleInput(initial.root, providerSource.relative);
  const receiptBytes = readAdmissibleInput(initial.root, receiptSource.relative);
  const sql = createNeonReaderAuthoritySql(connection);
  const evidence = await buildReaderExecutionAuthorityEvidence({
    phase: args.phase,
    exactHead: initial.exactHead,
    connection,
    providerMetadataPath: paths.providerMetadata,
    providerMetadataBytes: providerBytes,
    importReceiptPath: paths.importReceipt,
    importReceiptBytes: receiptBytes,
    sql,
  });

  const importerHistoryIssue = readerAuthorityImporterHistoryIssue(
    initial.root, evidence.phase, evidence.import.importerCodeSha, initial.exactHead,
  );
  if (importerHistoryIssue) throw new Error(importerHistoryIssue);
  if (!readFileSync(providerSource.absolute).equals(providerBytes) ||
      !readFileSync(receiptSource.absolute).equals(receiptBytes)) {
    throw new Error("Reader authority support input changed during live readback");
  }
  const serialized = `${canonicalReaderAuthorityJson(evidence)}\n`;
  if (authorityContainsSecret(serialized, connection)) {
    throw new Error("Reader authority artifact is not sanitized");
  }
  const destinations = {
    providerMetadata: resolve(initial.root, paths.providerMetadata),
    importReceipt: resolve(initial.root, paths.importReceipt),
    authority: resolve(initial.root, paths.authority),
  };
  const evidenceRoot = realpathSync(resolve(initial.root, "docs", "evidence"));
  if (Object.values(destinations).some((path) => !inside(evidenceRoot, path))) {
    throw new Error("Reader authority output escapes the immutable evidence directory");
  }

  const created: string[] = [];
  if (!readFileSync(providerSource.absolute).equals(providerBytes) ||
      !readFileSync(receiptSource.absolute).equals(receiptBytes)) {
    throw new Error("Reader authority support input changed before publication");
  }
  proveReaderAuthorityRepositoryBeforePublish(
    initial.root,
    [paths.providerMetadata, paths.importReceipt],
    initial,
  );
  try {
    if (createImmutableEvidenceFile(destinations.providerMetadata, providerBytes, {
      allowIdenticalExisting: true,
    })) created.push(destinations.providerMetadata);
    if (createImmutableEvidenceFile(destinations.importReceipt, receiptBytes, {
      allowIdenticalExisting: true,
    })) created.push(destinations.importReceipt);
    if (createImmutableEvidenceFile(destinations.authority, Buffer.from(serialized), {
      allowIdenticalExisting: false,
    })) created.push(destinations.authority);
  } catch (error) {
    for (const path of created.reverse()) {
      if (existsSync(path)) unlinkSync(path);
    }
    throw error;
  }
  return { exactHead: initial.exactHead, paths };
}

const main = typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (main) {
  const connection = process.env[READER_AUTHORITY_DATABASE_ENV] ?? "";
  void (async () => {
    const nodeIssue = readerAuthorityNodeAdmissionIssue();
    if (nodeIssue) throw new Error(nodeIssue);
    const ambientIssue = readerAuthorityAmbientCapabilityIssue(process.env);
    if (ambientIssue) throw new Error(ambientIssue);
    return generateReaderExecutionAuthorityEvidence(
      parseReaderAuthorityGeneratorArguments(process.argv.slice(2)),
    );
  })().then(({ exactHead, paths }) => {
    console.log(
      `Reader execution authority: PASS (${exactHead}; ${paths.authority}; ` +
      `${paths.providerMetadata}; ${paths.importReceipt})`,
    );
  }).catch((error) => {
    console.error(`Reader execution authority: REFUSED — ${redactReaderAuthorityError(error, [connection])}`);
    process.exitCode = 1;
  });
}
