/**
 * Exact installed-runtime dispatcher for owner-triggered production work.
 * It accepts a closed operation set, proves this checkout is the currently
 * deployed, post-deploy-held, fully certified SHA, and delegates one narrower
 * child capability. It has no arbitrary command or shell door.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  admittedRuntimeChildEnvironment,
  assertRuntimeAuthority,
  type RuntimeAuthorityCapability,
} from "../lib/civic-data/runtime-authority.ts";
import { readLatestProductionIntegrity } from "../lib/ops/production-integrity-data-plane.ts";
import {
  fetchGithubCheckRuns,
  inspectRuntimeReleaseEvidence,
  runtimeGithubRepository,
  runtimeGithubCredential,
} from "../lib/ops/runtime-release-handoff.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { isDirectModuleExecution } from "../lib/ops/main-module.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { fetchServedCommit } from "./post-deploy-observer.mts";
import { requestRoutineRefresh } from "../lib/civic-data/owner-refresh.ts";
import { requestRoutineDue, routineDueCommand, withdrawRoutineDue } from "../lib/civic-data/routine-due-request.ts";

export type InstalledRuntimeMode = "manual-promote" | "window" | "agent-bridge-job" | "agent-bridge-review" | "routine-refresh" | "routine-due";
export interface InstalledRuntimePayload {
  readonly mode: InstalledRuntimeMode;
  readonly args: readonly string[];
}

const MODES: readonly InstalledRuntimeMode[] = ["manual-promote", "window", "agent-bridge-job", "agent-bridge-review", "routine-refresh", "routine-due"];

export function parseInstalledRuntimePayload(encoded: string | null): InstalledRuntimePayload {
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("OWNER_COMMAND_PAYLOAD_INVALID");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("OWNER_COMMAND_PAYLOAD_INVALID");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("OWNER_COMMAND_PAYLOAD_INVALID");
  const record = raw as Record<string, unknown>;
  if (!MODES.includes(record.mode as InstalledRuntimeMode) || !Array.isArray(record.args) ||
      record.args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg))) {
    throw new Error("OWNER_COMMAND_PAYLOAD_INVALID");
  }
  return { mode: record.mode as InstalledRuntimeMode, args: record.args as string[] };
}

export interface InstalledRuntimeChildPlan {
  readonly scriptArgs: readonly string[];
  readonly capability: RuntimeAuthorityCapability;
  readonly contract: string | null;
}

function assigned(args: readonly string[], name: string): readonly string[] {
  return args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
}

/** Closed source-contract plan; extra flags go only to the registered adapter. */
export function installedRuntimeChildPlan(payload: InstalledRuntimePayload): InstalledRuntimeChildPlan {
  if (payload.mode === "routine-refresh") throw new Error("OWNER_REFRESH_HAS_NO_CHILD_COMMAND");
  if (payload.mode === "routine-due") throw new Error("ROUTINE_DUE_REQUEST_HAS_NO_CHILD_COMMAND");
  if (payload.mode === "manual-promote") {
    const contracts = assigned(payload.args, "contract");
    if (contracts.length !== 1) throw new Error("OWNER_MANUAL_CONTRACT_REQUIRED_ONCE");
    const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(({ id }) => id === contracts[0]);
    if (!contract) throw new Error(`OWNER_MANUAL_CONTRACT_UNKNOWN:${contracts[0]}`);
    const extra = payload.args.filter((arg) => !arg.startsWith("--contract="));
    return {
      scriptArgs: ["--experimental-strip-types", ...contract.command, ...extra],
      capability: "MANUAL_CONTRACT",
      contract: contract.id,
    };
  }
  if (payload.mode === "window") {
    if (!payload.args.includes("--shadow") && !payload.args.includes("--wakeup")) {
      throw new Error("OWNER_WINDOW_REQUIRES_SHADOW_OR_WAKEUP");
    }
    if (payload.args.some((arg) => /^--trigger=(?:RUNNER_CLOCK|CATCH_UP)$/.test(arg))) {
      throw new Error("OWNER_WINDOW_CANNOT_IMPERSONATE_CLOCK");
    }
    return {
      scriptArgs: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/nightly-window.mts", ...payload.args],
      capability: "NIGHTLY_RESEARCH",
      contract: null,
    };
  }
  const action = payload.mode === "agent-bridge-job" ? "--job" : "--review";
  return {
    scriptArgs: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/agent-bridge-run.mts", action, ...payload.args],
    capability: "AGENT_BRIDGE",
    contract: null,
  };
}

async function assertCurrentCertifiedRuntime(root: string): Promise<void> {
  const runningSha = headSha(root);
  const served = await fetchServedCommit(PUBLIC_SITE_ORIGIN, {
    runId: `owner-installed-runtime:${process.pid}`,
    timeoutMs: 15_000,
  });
  const connection = controlPlaneUrlFromEnv();
  if (connection === null) throw new Error("OWNER_RUNTIME_CONTROL_PLANE_UNCONFIGURED");
  const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
  const integrity = await readLatestProductionIntegrity(repos.softwareReleaseReviews);
  const repository = runtimeGithubRepository(root);
  if (repository === null || served.sha === null) throw new Error("OWNER_RUNTIME_CODE_IDENTITY_UNRESOLVED");
  const checks = await fetchGithubCheckRuns({
    repository,
    sha: served.sha,
    token: runtimeGithubCredential({ root, env: process.env }),
  });
  const verdict = inspectRuntimeReleaseEvidence({ runningSha, served, integrity, checkRuns: checks });
  if (verdict.state !== "CURRENT") {
    throw new Error(`OWNER_RUNTIME_NOT_CURRENT_CERTIFIED:${verdict.code}:${verdict.detail}`);
  }
}

async function run(): Promise<void> {
  const root = resolve(process.cwd());
  assertRuntimeAuthority({ capabilities: ["OWNER_DISPATCH"] });
  const encoded = process.argv.find((arg) => arg.startsWith("--payload="))?.slice("--payload=".length) ?? null;
  const payload = parseInstalledRuntimePayload(encoded);
  await assertCurrentCertifiedRuntime(root);
  if (payload.mode === "routine-refresh") {
    const repos = await createPgRepositories(controlPlaneUrlFromEnv()!, new Date().toISOString(), { skipBootstrap: true });
    const request = await requestRoutineRefresh(repos, payload.args, new Date().toISOString());
    console.log(JSON.stringify({ requestId: request.id, contractId: request.contractId, maximumAttempts: request.maximumAttempts,
      state: "QUEUED_FOR_STANDING_PARENT", requestedAt: request.requestedAt }));
    return;
  }
  if (payload.mode === "routine-due") {
    // Brings one partition's next read forward for the ordinary pass; runs nothing itself.
    const command = routineDueCommand(payload.args);
    const repos = await createPgRepositories(controlPlaneUrlFromEnv()!, new Date().toISOString(), { skipBootstrap: true });
    const request = command.kind === "WITHDRAW"
      ? await withdrawRoutineDue(repos, payload.args, new Date().toISOString())
      : await requestRoutineDue(repos, payload.args, new Date().toISOString());
    console.log(JSON.stringify({ ...request, state: command.kind === "WITHDRAW" ? "WITHDRAWN" : "OFFERED_TO_THE_NORMAL_SCHEDULER" }));
    return;
  }
  const plan = installedRuntimeChildPlan(payload);
  const env = admittedRuntimeChildEnvironment({
    parentEnv: process.env,
    capability: plan.capability,
    contract: plan.contract,
    parentPid: process.pid,
  });
  const status = await new Promise<number>((complete, reject) => {
    const child = spawn(process.execPath, [...plan.scriptArgs], {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => complete(code ?? (signal ? 2 : 0)));
  });
  process.exitCode = status;
}

if (isDirectModuleExecution(import.meta.url)) {
  void run().catch((error: unknown) => {
    console.error(`INSTALLED_RUNTIME_DISPATCH_REFUSED:${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
