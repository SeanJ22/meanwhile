import { randomUUID } from "node:crypto";
import { refreshDoorsForPass } from "../doors/install.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

export interface RoutineRefreshRequest {
  readonly id: string;
  readonly contractId: string;
  readonly requestedAt: string;
  readonly maximumAttempts: number;
  readonly attempts: readonly { readonly startedAt: string; readonly finishedAt: string | null; readonly exitCode: number | null }[];
}

export function routineRefreshSelection(args: readonly string[]): { contractId: string; maximumAttempts: number } {
  const contracts = args.filter(arg => arg.startsWith("--contract="));
  const attempts = args.filter(arg => arg.startsWith("--attempts="));
  if (contracts.length !== 1 || attempts.length > 1 || args.length !== contracts.length + attempts.length) throw new Error("OWNER_REFRESH_EXACT_SELECTION_REQUIRED");
  const contractId = contracts[0].slice("--contract=".length);
  const maximumAttempts = attempts.length ? Number(attempts[0].slice("--attempts=".length)) : 1;
  const registered = [...MEETING_PARTITION_CONTRACTS, ...ROUTINE_SOURCE_CONTRACTS, ...RUNTIME_ROUTINE_CONTRACTS].some(contract => contract.id === contractId);
  if (!registered) throw new Error("OWNER_REFRESH_REGISTERED_CONTRACT_REQUIRED");
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 2) throw new Error("OWNER_REFRESH_ATTEMPT_BOUND");
  return { contractId, maximumAttempts };
}

export async function requestRoutineRefresh(repos: ControlPlaneRepositories, args: readonly string[], now: string) {
  await refreshDoorsForPass(repos.doors);
  const selection = routineRefreshSelection(args);
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID, { routineRefreshRequests: { pending: true } });
  const config = row?.value ?? defaultAdminConfig();
  const prior = config.routineRefreshRequests ?? [];
  if (prior.some(request => request.attempts.length < request.maximumAttempts || request.attempts.some(attempt => attempt.finishedAt === null))) throw new Error("OWNER_REFRESH_REQUEST_ALREADY_PENDING");
  const request: RoutineRefreshRequest = { id: `routine-refresh:${randomUUID()}`, ...selection, requestedAt: now, attempts: [] };
  const next = { ...config, updatedAt: now, routineRefreshRequests: [...prior, request] };
  await repos.adminConfig.save(row, next, now);
  return request;
}

/** Reserve before launch: a parent crash cannot turn two requested attempts into an unbounded retry loop. */
export async function reserveRoutineRefresh(repos: ControlPlaneRepositories, now: string) {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID, { routineRefreshRequests: { pending: true } });
  if (!row) return null;
  const requests = [...row.value.routineRefreshRequests ?? []];
  const index = requests.findIndex(request => request.attempts.length < request.maximumAttempts);
  if (index < 0) return null;
  const request = requests[index];
  routineRefreshSelection([`--contract=${request.contractId}`, `--attempts=${request.maximumAttempts}`]);
  const ordinal = request.attempts.length;
  requests[index] = { ...request, attempts: [...request.attempts, { startedAt: now, finishedAt: null, exitCode: null }] };
  await repos.adminConfig.save(row, { ...row.value, routineRefreshRequests: requests, updatedAt: now }, now);
  return { requestId: request.id, ordinal, contractId: request.contractId,
    args: ["--force", `--only=${request.contractId}`] };
}

export async function finishRoutineRefresh(repos: ControlPlaneRepositories, claim: { requestId: string; ordinal: number }, now: string, exitCode: number | null) {
  const row = await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { routineRefreshRequests: { ids: [claim.requestId] } });
  const requests = [...row.value.routineRefreshRequests ?? []];
  const index = requests.findIndex(request => request.id === claim.requestId);
  const request = requests[index];
  if (!request || !request.attempts[claim.ordinal]) throw new Error("OWNER_REFRESH_ATTEMPT_MISSING");
  const attempts = [...request.attempts];
  if (attempts[claim.ordinal].finishedAt !== null) return;
  attempts[claim.ordinal] = { ...attempts[claim.ordinal], finishedAt: now, exitCode };
  requests[index] = { ...request, attempts };
  await repos.adminConfig.save(row, { ...row.value, routineRefreshRequests: requests, updatedAt: now }, now);
}
