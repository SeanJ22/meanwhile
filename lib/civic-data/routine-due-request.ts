import { randomUUID } from "node:crypto";

import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { refreshDoorsForPass } from "../doors/install.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";

/**
 * **BRING ONE MEETING PARTITION'S NEXT READ FORWARD; THE NORMAL SCHEDULER READS IT
 * (owner instruction, 2026-09-25).**
 *
 * Sean: "bring a small test case's next due time forward and let the normal
 * scheduler—not a manual 'run now' shortcut—process it ... Keep temporary test
 * changes isolated and restore any adjusted state."
 *
 * The owner refresh (owner-refresh.ts) is the run-now shortcut: its pass runs
 * `--force --only=<id>`, skipping the due check, the frontier and every other
 * task. A due request changes one instant and nothing else: when one registered
 * meeting partition falls due. The standing runner's ordinary pass reads it
 * from the owner's config row, and from there everything is the normal path:
 * the due check, the earliest-deadline frontier with its lane slots and the
 * same-host gap, the ordinary child and its receipt, Reader repair, and the
 * supervisor outcome, which records that the request was honoured. A request
 * never writes a source clock, a candidate or an event.
 *
 * Bounded, so it cannot become a second schedule:
 *  - one registered MEETING partition with a sitting window, and one open
 *    request at a time;
 *  - due no earlier than it was requested, and expired at most two hours after;
 *  - spent by the partition's first durable attempt after it was requested (the
 *    store's own clock), so the next due after that read is the normal rule's;
 *  - it only brings a read forward: a task already due stays due, and its
 *    deadline is the earlier of the two;
 *  - withdrawable. Spent, expired and withdrawn requests are inert history on
 *    the config row, the last 20 kept.
 *
 * An engineering control for verification, not an owner policy: it records who
 * asked through the owner door (installed-runtime-dispatch.mts, mode
 * `routine-due`) and why, and changes no standing decision.
 */
export interface RoutineDueRequest {
  readonly id: string;
  readonly contractId: string;
  readonly requestedAt: string;
  readonly dueAt: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly withdrawnAt: string | null;
}

export const ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS = 2 * 60 * 60_000;
export const ROUTINE_DUE_REQUEST_DEFAULT_LIFETIME_MS = 90 * 60_000;
export const ROUTINE_DUE_REQUEST_MAX_DELAY_MS = 60 * 60_000;
export const ROUTINE_DUE_REQUEST_HISTORY = 20;
const REASON_MAX = 200;
const DEFAULT_REASON = "controlled refresh verification (owner instruction 2026-09-25)";

/** The partitions a request may name: registered MEETING partitions with a sitting window. */
function requestablePartition(contractId: string): boolean {
  return MEETING_PARTITION_CONTRACTS.some((contract) =>
    contract.id === contractId && contract.recordClass === "MEETING" && contract.schedule?.kind === "SITTING_WINDOW");
}

export function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** A whole number of minutes in [min, max], as milliseconds; `fallbackMinutes` when absent. */
function minutesArg(args: readonly string[], name: string, fallbackMinutes: number, min: number, max: number): number {
  const values = args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
  if (values.length > 1) throw new Error(`ROUTINE_DUE_REQUEST_ARGUMENT_REPEATED:${name}`);
  if (values.length === 0) return fallbackMinutes * 60_000;
  const minutes = Number(values[0]);
  if (!/^\d+$/.test(values[0]!) || !Number.isSafeInteger(minutes) || minutes < min || minutes > max) {
    throw new Error(`ROUTINE_DUE_REQUEST_ARGUMENT_OUT_OF_RANGE:${name}`);
  }
  return minutes * 60_000;
}

export type RoutineDueCommand =
  | { readonly kind: "REQUEST"; readonly contractId: string; readonly dueInMs: number; readonly expiresInMs: number; readonly reason: string }
  | { readonly kind: "WITHDRAW"; readonly requestId: string };

/**
 * `--contract=<partition> [--due-in-minutes=0..60] [--expires-in-minutes=1..120] [--reason=<text>]`,
 * or `--withdraw=<request id>`. Anything else refuses.
 */
export function routineDueCommand(args: readonly string[]): RoutineDueCommand {
  const known = ["--contract=", "--due-in-minutes=", "--expires-in-minutes=", "--reason=", "--withdraw="];
  if (args.length === 0 || args.some((arg) => !known.some((prefix) => arg.startsWith(prefix)))) {
    throw new Error("ROUTINE_DUE_REQUEST_EXACT_ARGUMENTS_REQUIRED");
  }
  const withdraw = args.filter((arg) => arg.startsWith("--withdraw="));
  if (withdraw.length > 0) {
    const requestId = withdraw[0]!.slice("--withdraw=".length);
    if (withdraw.length !== 1 || args.length !== 1 || !/^routine-due:[0-9a-f-]{36}$/.test(requestId)) {
      throw new Error("ROUTINE_DUE_REQUEST_WITHDRAW_EXACT_ID_REQUIRED");
    }
    return { kind: "WITHDRAW", requestId };
  }
  const contracts = args.filter((arg) => arg.startsWith("--contract="));
  if (contracts.length !== 1) throw new Error("ROUTINE_DUE_REQUEST_ONE_CONTRACT_REQUIRED");
  const contractId = contracts[0]!.slice("--contract=".length);
  if (!requestablePartition(contractId)) throw new Error("ROUTINE_DUE_REQUEST_MEETING_PARTITION_REQUIRED");
  const dueInMs = minutesArg(args, "due-in-minutes", 0, 0, ROUTINE_DUE_REQUEST_MAX_DELAY_MS / 60_000);
  const expiresInMs = minutesArg(args, "expires-in-minutes", ROUTINE_DUE_REQUEST_DEFAULT_LIFETIME_MS / 60_000, 1, ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS / 60_000);
  if (dueInMs >= expiresInMs) throw new Error("ROUTINE_DUE_REQUEST_EXPIRES_BEFORE_DUE");
  const reasons = args.filter((arg) => arg.startsWith("--reason="));
  if (reasons.length > 1) throw new Error("ROUTINE_DUE_REQUEST_ARGUMENT_REPEATED:reason");
  const reason = reasons.length === 1 ? reasons[0]!.slice("--reason=".length).trim() : DEFAULT_REASON;
  if (!reason || reason.length > REASON_MAX || /[\r\n\0]/.test(reason)) throw new Error("ROUTINE_DUE_REQUEST_REASON_INVALID");
  return { kind: "REQUEST", contractId, dueInMs, expiresInMs, reason };
}

/** Why a stored value is not a well-formed request, or null. The row is durable input, not trusted memory. */
export function routineDueRequestIssue(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "not an object";
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^routine-due:[0-9a-f-]{36}$/.test(row.id)) return "id is malformed";
  // Registration is checked when a request is made and again when a pass reads it
  // (only a registered sitting-window MEETING task can match), so a partition
  // retired later leaves an inert row, not a refusal of every later request.
  if (typeof row.contractId !== "string" || !row.contractId.trim()) return "contractId is missing";
  for (const field of ["requestedAt", "dueAt", "expiresAt"] as const) {
    if (!canonicalInstant(row[field])) return `${field} is not a canonical instant`;
  }
  const requested = Date.parse(row.requestedAt as string);
  const due = Date.parse(row.dueAt as string);
  const expires = Date.parse(row.expiresAt as string);
  if (due < requested || due >= expires) return "dueAt is outside [requestedAt, expiresAt)";
  if (expires - requested > ROUTINE_DUE_REQUEST_MAX_LIFETIME_MS) return "the request outlives two hours";
  if (typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > REASON_MAX) return "reason is malformed";
  if (row.withdrawnAt !== null && !canonicalInstant(row.withdrawnAt)) return "withdrawnAt is malformed";
  return null;
}

/** The well-formed requests on the config row, and a named issue for each one that is not. */
export function parseRoutineDueRequests(value: unknown): { readonly requests: readonly RoutineDueRequest[]; readonly issues: readonly string[] } {
  if (value === undefined || value === null) return { requests: [], issues: [] };
  if (!Array.isArray(value)) return { requests: [], issues: ["routineDueRequests is not a list"] };
  const requests: RoutineDueRequest[] = [];
  const issues: string[] = [];
  value.forEach((row, index) => {
    const issue = routineDueRequestIssue(row);
    if (issue === null) requests.push(row as RoutineDueRequest);
    else issues.push(`routineDueRequests[${index}]: ${issue}`);
  });
  return { requests, issues };
}

export type RoutineDueRequestState = "WAITING" | "DUE" | "SPENT" | "EXPIRED" | "WITHDRAWN";

/**
 * Where a request stands at `nowMs`, from the partition's durable clock: SPENT
 * once the store holds an attempt made at or after the request, which is the
 * normal pass's read of it (a candidate's first event or an unchanged
 * confirmation).
 */
export function routineDueRequestState(
  request: RoutineDueRequest,
  clock: { readonly lastAttemptedAt?: string } | undefined,
  nowMs: number,
): RoutineDueRequestState {
  const attempted = clock?.lastAttemptedAt ? Date.parse(clock.lastAttemptedAt) : Number.NaN;
  if (Number.isFinite(attempted) && attempted >= Date.parse(request.requestedAt)) return "SPENT";
  if (request.withdrawnAt !== null && Date.parse(request.withdrawnAt) <= nowMs) return "WITHDRAWN";
  if (nowMs >= Date.parse(request.expiresAt)) return "EXPIRED";
  return nowMs >= Date.parse(request.dueAt) ? "DUE" : "WAITING";
}

/** The request that makes `task` due at `nowMs`, if one does. */
export function routineDueRequestFor(
  task: { readonly id: string; readonly recordClass: string; readonly contract: { readonly schedule?: { readonly kind: string } } },
  clock: { readonly lastAttemptedAt?: string } | undefined,
  nowMs: number,
  requests: readonly RoutineDueRequest[],
): RoutineDueRequest | null {
  if (task.recordClass !== "MEETING" || task.contract.schedule?.kind !== "SITTING_WINDOW") return null;
  return requests.find((request) => request.contractId === task.id && routineDueRequestState(request, clock, nowMs) === "DUE") ?? null;
}

/** A requested task's deadline for the frontier: the earlier of its own and the request's. */
export function routineDueRequestDeadlineMs(deadlineMs: number | undefined, request: RoutineDueRequest | null): number | undefined {
  if (request === null) return deadlineMs;
  const dueMs = Date.parse(request.dueAt);
  return deadlineMs === undefined || Number.isNaN(deadlineMs) ? dueMs : Math.min(deadlineMs, dueMs);
}

/** An open request: neither withdrawn nor expired. Whether it is spent needs the clock, so it stays open until then. */
function openAt(request: RoutineDueRequest, nowMs: number): boolean {
  return request.withdrawnAt === null && nowMs < Date.parse(request.expiresAt);
}

/** Record a request on the owner's config row (compare-and-set). One open request at a time. */
export async function requestRoutineDue(repos: ControlPlaneRepositories, args: readonly string[], now: string): Promise<RoutineDueRequest> {
  // DB-14: a door added as data is a partition this request may name.
  await refreshDoorsForPass(repos.doors);
  const command = routineDueCommand(args);
  if (command.kind !== "REQUEST") throw new Error("ROUTINE_DUE_REQUEST_EXPECTED_REQUEST");
  const nowMs = Date.parse(now);
  if (!canonicalInstant(now)) throw new Error("ROUTINE_DUE_REQUEST_CLOCK_INVALID");
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = row?.value ?? defaultAdminConfig();
  const prior = parseRoutineDueRequests(config.routineDueRequests);
  if (prior.issues.length > 0) throw new Error(`ROUTINE_DUE_REQUEST_HISTORY_INVALID:${prior.issues.join("; ")}`);
  const open = prior.requests.find((request) => openAt(request, nowMs));
  if (open) throw new Error(`ROUTINE_DUE_REQUEST_ALREADY_OPEN:${open.id}`);
  const request: RoutineDueRequest = {
    id: `routine-due:${randomUUID()}`,
    contractId: command.contractId,
    requestedAt: now,
    dueAt: new Date(nowMs + command.dueInMs).toISOString(),
    expiresAt: new Date(nowMs + command.expiresInMs).toISOString(),
    reason: command.reason,
    withdrawnAt: null,
  };
  const next = { ...config, updatedAt: now, routineDueRequests: [...prior.requests, request].slice(-ROUTINE_DUE_REQUEST_HISTORY) };
  if (row) await repos.adminConfig.compareAndSet(row.id, row.revision, next, now);
  else await repos.adminConfig.put(ADMIN_CONFIG_ID, next, now);
  return request;
}

/** Withdraw a request: it stays on the row as history and no pass honours it again. Idempotent. */
export async function withdrawRoutineDue(repos: ControlPlaneRepositories, args: readonly string[], now: string): Promise<RoutineDueRequest> {
  const command = routineDueCommand(args);
  if (command.kind !== "WITHDRAW") throw new Error("ROUTINE_DUE_REQUEST_EXPECTED_WITHDRAW");
  if (!canonicalInstant(now)) throw new Error("ROUTINE_DUE_REQUEST_CLOCK_INVALID");
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const prior = parseRoutineDueRequests(row?.value.routineDueRequests);
  const index = prior.requests.findIndex((request) => request.id === command.requestId);
  if (!row || index < 0) throw new Error(`ROUTINE_DUE_REQUEST_UNKNOWN:${command.requestId}`);
  const found = prior.requests[index]!;
  if (found.withdrawnAt !== null) return found;
  const withdrawn = { ...found, withdrawnAt: now };
  const requests = prior.requests.map((request, at) => (at === index ? withdrawn : request));
  await repos.adminConfig.compareAndSet(row.id, row.revision, { ...row.value, updatedAt: now, routineDueRequests: requests }, now);
  return withdrawn;
}
