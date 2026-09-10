/**
 * TEMPORARY PDC-v2 one-time trusted-LKG importer.
 *
 * This executable exists only for the clean intermediate seed. Delete it and
 * its plan helper/tests immediately after the production readback is proved.
 * It never writes Git, invokes a deploy, or acquires publisher data.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPdcV2TrustedLkgImportPlan,
  executePdcV2PermanentCutoverImportPlan,
  inspectTrustedLkgRepository,
  trustedLkgImporterRepositoryIssue,
  type PdcV2PermanentCutoverImportResult,
} from "../lib/civic-data/trusted-lkg-import-plan.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import {
  RUNTIME_AUTHORITY_ENV,
  temporaryTrustedLkgImportEnvironment,
} from "../lib/civic-data/runtime-authority.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { isDirectModuleExecution } from "../lib/ops/main-module.ts";

export interface PdcV2TrustedLkgImporterArguments {
  readonly frozenRoot: string;
  readonly admissionIpc: true;
}

const PDC_V2_ADMISSION_ENV = {
  protocol: "WTP_PDC_V2_ADMISSION_PROTOCOL",
  nonce: "WTP_PDC_V2_ADMISSION_NONCE",
  parentPid: "WTP_PDC_V2_ADMISSION_PARENT_PID",
} as const;
const PDC_V2_ADMISSION_TIMEOUT_MS = 60_000;
const PDC_V2_ADMISSION_MAX_TTL_MS = 30_000;
const SHA1_HEX = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface PdcV2PrewriteAdmissionExpected {
  readonly importSha: string;
  readonly frozenBaseSha: string;
  readonly migrationBlobSha1: string;
  readonly parentPid: number;
  readonly childPid: number;
}

export interface PdcV2PrewriteAdmissionRequest extends PdcV2PrewriteAdmissionExpected {
  readonly schemaVersion: 1;
  readonly type: "PDC_V2_IMPORT_PREWRITE_READY";
  readonly nonceSha256: string;
}

interface PdcV2AdmissionIpcPort {
  readonly connected?: boolean;
  readonly send?: (message: unknown) => boolean;
  readonly on: (event: "message" | "disconnect" | "error", listener: (...args: unknown[]) => void) => unknown;
  readonly off: (event: "message" | "disconnect" | "error", listener: (...args: unknown[]) => void) => unknown;
}

const DATABASE_SECRET_VARIABLES = [
  "DATABASE_URL",
  "WTP_PRODUCTION_DATABASE_URL_WRITE",
  "WTP_PRODUCTION_DATABASE_URL_READONLY",
] as const;

function sameFilesystemPath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(realpathSync(left)) === normalize(realpathSync(right));
}

function gitBlobId(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

/**
 * Bind the code being executed to the repository whose clean HEAD is attested.
 * Without this check an absolute script path from checkout A could be launched
 * with cwd in clean checkout B, causing B's commit to be recorded while A's
 * importer and relative helper modules actually perform the import.
 */
export function pdcV2TrustedLkgExecutingImporterIssue(
  repositoryRoot: string,
  executingImporterPath: string = fileURLToPath(import.meta.url),
): string | null {
  try {
    const root = realpathSync(resolve(repositoryRoot));
    const executingPath = realpathSync(resolve(executingImporterPath));
    const executingRoot = realpathSync(resolve(dirname(executingPath), ".."));
    if (!sameFilesystemPath(executingRoot, root)) {
      return `the executing importer belongs to ${executingRoot}, not the attested repository ${root}`;
    }
    const expectedPath = resolve(root, "scripts", "pdc-v2-trusted-lkg-import.mts");
    if (!sameFilesystemPath(executingPath, expectedPath)) {
      return `the executing module is not the exact committed importer path ${expectedPath}`;
    }
    return null;
  } catch (error) {
    return `the executing importer path could not be resolved (${error instanceof Error ? error.name : "unknown error"})`;
  }
}

/** A database/client exception must never echo a credential into a shell log. */
export function redactPdcV2TrustedLkgImporterError(
  error: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = DATABASE_SECRET_VARIABLES
    .map((name) => env[name])
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) message = message.replaceAll(secret, "[REDACTED_DATABASE_URL]");
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(
      /\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[^\s,"'`;}]+/gi,
      "authorization: Bearer [REDACTED]",
    )
    .replace(
      /(["']?(?:password|passwd|token|api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      "$1[REDACTED]",
    );
}

export function parsePdcV2TrustedLkgImporterArguments(
  argv: readonly string[],
): PdcV2TrustedLkgImporterArguments {
  const args = argv.slice(2);
  const frozenArguments = args.filter((value) => value.startsWith("--frozen-root="));
  const promoteCount = args.filter((value) => value === "--promote").length;
  const admissionCount = args.filter((value) => value === "--admission-ipc").length;
  const unknown = args.filter((value) =>
    value !== "--promote" && value !== "--admission-ipc" && !value.startsWith("--frozen-root=")
  );
  if (
    promoteCount !== 1 || admissionCount !== 1 ||
    frozenArguments.length !== 1 || unknown.length > 0
  ) {
    throw new Error(
      "usage: node --env-file=.env.local --experimental-strip-types " +
      "scripts/pdc-v2-trusted-lkg-import.mts --promote --admission-ipc " +
      "--frozen-root=<absolute-clean-detached-fc67-worktree>",
    );
  }
  const frozenRoot = frozenArguments[0]!.slice("--frozen-root=".length);
  if (!frozenRoot || !isAbsolute(frozenRoot)) {
    throw new Error("TRUSTED_LKG_FROZEN_ROOT_MUST_BE_ABSOLUTE");
  }
  return { frozenRoot: resolve(frozenRoot), admissionIpc: true };
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}

export function pdcV2PrewriteAdmissionReceiptIssue(
  value: unknown,
  expected: PdcV2PrewriteAdmissionExpected & { readonly nonceSha256: string },
  nowMs: number = Date.now(),
): string | null {
  const receipt = plainObject(value);
  if (!receipt || !exactKeys(receipt, [
    "schemaVersion", "type", "result", "nonceSha256", "parentPid", "childPid",
    "importSha", "frozenBaseSha", "migrationBlobSha1", "githubProofSha256",
    "narrowRoleProofSha256", "issuedAt", "expiresAt", "gates",
  ])) return "admission receipt shape is not exact";
  const gates = plainObject(receipt.gates);
  if (!gates || !exactKeys(gates, [
    "legacyWorkflowDefinitionsDisabled", "nonterminalLegacyRuns", "obsoleteScheduledTasks",
    "startupLaunchers", "oldProcessTreeMembers", "localImportCommitCleanExactHead",
  ])) return "admission gate shape is not exact";
  if (
    receipt.schemaVersion !== 1 ||
    receipt.type !== "PDC_V2_IMPORT_PREWRITE_ADMISSION" ||
    receipt.result !== "QUIESCENCE_REPROVED" ||
    receipt.nonceSha256 !== expected.nonceSha256 ||
    receipt.parentPid !== expected.parentPid ||
    receipt.childPid !== expected.childPid ||
    receipt.importSha !== expected.importSha ||
    receipt.frozenBaseSha !== expected.frozenBaseSha ||
    receipt.migrationBlobSha1 !== expected.migrationBlobSha1 ||
    typeof receipt.githubProofSha256 !== "string" || !SHA256_HEX.test(receipt.githubProofSha256) ||
    typeof receipt.narrowRoleProofSha256 !== "string" || !SHA256_HEX.test(receipt.narrowRoleProofSha256) ||
    gates.legacyWorkflowDefinitionsDisabled !== 8 ||
    gates.nonterminalLegacyRuns !== 0 ||
    gates.obsoleteScheduledTasks !== 0 ||
    gates.startupLaunchers !== 0 ||
    gates.oldProcessTreeMembers !== 0 ||
    gates.localImportCommitCleanExactHead !== true
  ) return "admission receipt is not bound to exact terminal quiescence";
  if (typeof receipt.issuedAt !== "string" || typeof receipt.expiresAt !== "string") {
    return "admission receipt clocks are absent";
  }
  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (
    !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
    new Date(issuedAt).toISOString() !== receipt.issuedAt ||
    new Date(expiresAt).toISOString() !== receipt.expiresAt ||
    issuedAt > nowMs || expiresAt <= nowMs || expiresAt <= issuedAt ||
    expiresAt - issuedAt > PDC_V2_ADMISSION_MAX_TTL_MS
  ) return "admission receipt clock is future, expired, noncanonical, or overlong";
  return null;
}

/**
 * Consume the ignored host orchestrator's one-use IPC lease at the last
 * read-only edge. No reusable proof is accepted on argv or disk, and failure
 * or parent disconnect leaves every production mutation door unopened.
 */
export async function consumePdcV2PrewriteAdmission(input: {
  readonly expected: PdcV2PrewriteAdmissionExpected;
  readonly env?: NodeJS.ProcessEnv;
  readonly ipc?: PdcV2AdmissionIpcPort;
  readonly timeoutMs?: number;
}): Promise<string> {
  const env = input.env ?? process.env;
  const ipc = input.ipc ?? process;
  const rawNonce = env[PDC_V2_ADMISSION_ENV.nonce] ?? "";
  const parentPidText = env[PDC_V2_ADMISSION_ENV.parentPid] ?? "";
  const parentPid = Number(parentPidText);
  if (
    env[PDC_V2_ADMISSION_ENV.protocol] !== "1" ||
    !SHA256_HEX.test(rawNonce) ||
    !Number.isSafeInteger(parentPid) || parentPid <= 0 || String(parentPid) !== parentPidText ||
    parentPid !== input.expected.parentPid ||
    input.expected.childPid !== process.pid ||
    !SHA1_HEX.test(input.expected.importSha) ||
    !SHA1_HEX.test(input.expected.frozenBaseSha) ||
    !SHA1_HEX.test(input.expected.migrationBlobSha1) ||
    ipc.connected !== true || typeof ipc.send !== "function"
  ) throw new Error("PDC_V2_PREWRITE_ADMISSION_CHANNEL_REFUSED");

  const nonceSha256 = createHash("sha256").update(rawNonce).digest("hex");
  const request: PdcV2PrewriteAdmissionRequest = {
    schemaVersion: 1,
    type: "PDC_V2_IMPORT_PREWRITE_READY",
    nonceSha256,
    ...input.expected,
  };
  return new Promise<string>((resolveAdmission, rejectAdmission) => {
    let settled = false;
    let received = 0;
    let acceptance: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timeout);
      if (acceptance) clearTimeout(acceptance);
      ipc.off("message", onMessage);
      ipc.off("disconnect", onDisconnect);
      ipc.off("error", onError);
    };
    const refuse = (code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectAdmission(new Error(code));
    };
    const onMessage = (message: unknown) => {
      received += 1;
      if (received !== 1) {
        refuse("PDC_V2_PREWRITE_ADMISSION_MULTIPLE_RECEIPTS_REFUSED");
        return;
      }
      const issue = pdcV2PrewriteAdmissionReceiptIssue(message, {
        ...input.expected,
        nonceSha256,
      });
      if (issue !== null) {
        refuse(`PDC_V2_PREWRITE_ADMISSION_RECEIPT_REFUSED:${issue}`);
        return;
      }
      // Keep the listener through the current event turn so two queued
      // receipts cannot be mistaken for one lease.
      acceptance = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        for (const name of Object.values(PDC_V2_ADMISSION_ENV)) delete env[name];
        resolveAdmission(rawNonce);
      }, 0);
    };
    const onDisconnect = () => refuse("PDC_V2_PREWRITE_ADMISSION_PARENT_DISCONNECTED");
    const onError = () => refuse("PDC_V2_PREWRITE_ADMISSION_CHANNEL_ERROR");
    const timeout = setTimeout(
      () => refuse("PDC_V2_PREWRITE_ADMISSION_TIMEOUT"),
      input.timeoutMs ?? PDC_V2_ADMISSION_TIMEOUT_MS,
    );
    ipc.on("message", onMessage);
    ipc.on("disconnect", onDisconnect);
    ipc.on("error", onError);
    if (ipc.send!(request) === false) refuse("PDC_V2_PREWRITE_ADMISSION_READY_NOT_SENT");
  });
}

async function runPdcV2TrustedLkgImporter(
  argv: readonly string[] = process.argv,
  cwd: string = process.cwd(),
): Promise<PdcV2PermanentCutoverImportResult> {
  const args = parsePdcV2TrustedLkgImporterArguments(argv);
  const importerFacts = inspectTrustedLkgRepository(resolve(cwd));
  const importerIssue = trustedLkgImporterRepositoryIssue(importerFacts);
  const executingImporterIssue = pdcV2TrustedLkgExecutingImporterIssue(importerFacts.repositoryRoot);
  if (importerIssue !== null || executingImporterIssue !== null) {
    throw new Error(
      `TRUSTED_LKG_IMPORTER_REPOSITORY_REFUSED:${importerIssue ?? executingImporterIssue}`,
    );
  }

  // Finish every frozen-byte read, denominator assertion, builder check, and
  // candidate validation before opening the sanctioned production door.
  const importedAt = new Date().toISOString();
  const plan = await buildPdcV2TrustedLkgImportPlan({
    frozenRoot: args.frozenRoot,
    importerCodeSha: importerFacts.headSha,
    importedAt,
    importerRepositoryFacts: importerFacts,
  });

  // Capture the migration bytes before the final clean-HEAD inspection, then
  // bind them to HEAD's exact Git blob. The SQL defining the prospective
  // exception/global preflight cannot change in the inspection/read seam.
  const contractMigrationPath = "lib/db/migrations/0026_lame_sunset_bain.sql";
  const contractMigrationBytes = readFileSync(
    resolve(importerFacts.repositoryRoot, ...contractMigrationPath.split("/")),
  );
  const prewriteImporterFacts = inspectTrustedLkgRepository(resolve(cwd));
  const prewriteImporterIssue = trustedLkgImporterRepositoryIssue(prewriteImporterFacts);
  const prewriteExecutingImporterIssue = pdcV2TrustedLkgExecutingImporterIssue(
    prewriteImporterFacts.repositoryRoot,
  );
  const migrationMatchesHead = gitBlobId(contractMigrationBytes) ===
    prewriteImporterFacts.trackedBlobIds[contractMigrationPath];
  if (
    prewriteImporterIssue !== null ||
    prewriteExecutingImporterIssue !== null ||
    prewriteImporterFacts.headSha !== importerFacts.headSha ||
    !migrationMatchesHead
  ) {
    throw new Error(
      `TRUSTED_LKG_IMPORTER_REPOSITORY_CHANGED_DURING_PLAN:` +
      `${prewriteImporterIssue ?? prewriteExecutingImporterIssue ?? (
        prewriteImporterFacts.headSha !== importerFacts.headSha
          ? `${importerFacts.headSha} became ${prewriteImporterFacts.headSha}`
          : "contract migration bytes do not equal the attested HEAD blob"
      )}`,
    );
  }
  const contractMigrationSql = contractMigrationBytes.toString("utf8");

  const admissionNonce = await consumePdcV2PrewriteAdmission({
    expected: {
      importSha: prewriteImporterFacts.headSha,
      frozenBaseSha: plan.frozenBaseSha,
      migrationBlobSha1: gitBlobId(contractMigrationBytes),
      parentPid: process.ppid,
      childPid: process.pid,
    },
  });

  // Mint the temporary self-process capability only after the final exact
  // repository/script/HEAD attestation and fresh parent quiescence admission.
  // Copy only the authority namespace:
  // database credentials and all unrelated process state remain untouched.
  const trustedImportAuthority = temporaryTrustedLkgImportEnvironment({
    repositoryRoot: prewriteImporterFacts.repositoryRoot,
    headSha: prewriteImporterFacts.headSha,
    processPid: process.pid,
    nonce: admissionNonce,
  });
  for (const key of Object.values(RUNTIME_AUTHORITY_ENV)) {
    const value = trustedImportAuthority[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  // The production write guard must precede store construction. The executor
  // then proves all present authorities before its first write, uses only the
  // registered promotion doors, and requires canonical plus typed readback.
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  const result = await executePdcV2PermanentCutoverImportPlan(
    store,
    plan,
    contractMigrationSql,
  );
  console.log(`PDC_V2_TRUSTED_LKG_IMPORT_RECEIPT=${JSON.stringify(result)}`);
  return result;
}

if (isDirectModuleExecution(import.meta.url)) {
  void runPdcV2TrustedLkgImporter().catch((error: unknown) => {
    console.error(redactPdcV2TrustedLkgImporterError(error));
    process.exitCode = 1;
  });
}
