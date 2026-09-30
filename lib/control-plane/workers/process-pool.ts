import { fork } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DispatchResult } from "../scheduler/dispatch.ts";
import type { ModelRequest, ModelTransport, ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import type { AutonomousJurisdiction } from "../expansion/spend-holds.ts";

export interface LeaseWorkerConfig {
  readonly root: string;
  readonly fileStoreRoot?: string;
  readonly postgres: boolean;
  readonly taskIds: readonly string[];
  readonly modelEnabled: boolean;
  readonly searchEnabled: boolean;
  readonly ceilingUsd: number;
  readonly fundedSubjects: readonly string[];
}

/** IPC carries transient provider requests; work, leases and costs stay in the existing repositories. */
export async function runLeaseWorkerProcesses(input: {
  readonly config: LeaseWorkerConfig;
  readonly capacity: () => number;
  readonly transportFor: (jurisdiction: AutonomousJurisdiction, taskId: string) => ModelTransport;
  readonly searchFor?: (subjectId: string) => ScoutToolContext["search"];
  readonly reserveEscalation?: ScoutExecutorDeps["reserveEscalation"];
  readonly onStarted?: (pid: number) => void;
}): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const pending = new Set(input.config.taskIds);
  const active = new Set<Promise<void>>();
  let failure: unknown = null;
  const launch = (): Promise<void> => new Promise((resolve, reject) => {
    const child = fork(join(input.config.root, "lib/control-plane/workers/lease-worker.ts"), [], {
      cwd: input.config.root, env: { ...process.env },
      execArgv: ["--experimental-strip-types", "--import", pathToFileURL(join(input.config.root, "scripts/register-test-loader.mjs")).href],
      stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "advanced",
    });
    const reservations = new Map<string, Awaited<ReturnType<NonNullable<ScoutExecutorDeps["reserveEscalation"]>>>>();
    child.once("spawn", () => { input.onStarted?.(child.pid!); child.send(input.config); });
    child.on("error", reject);
    child.on("message", async (raw: unknown) => {
      const message = raw as { kind: string; id: string; taskId: string; jurisdiction: AutonomousJurisdiction; body: unknown };
      if (message.kind === "result") {
        const result = message.body as DispatchResult;
        results.push(result);
        if (result.routeTaskId) pending.delete(result.routeTaskId);
        return;
      }
      if (message.kind === "finished") { for (const id of message.body as string[]) pending.delete(id); return; }
      if (message.kind === "draw" || message.kind === "release") {
        const reservation = reservations.get(message.id);
        if (reservation?.admit) {
          if (message.kind === "draw") reservation.draw(message.body as number);
          else { reservation.release(); reservations.delete(message.id); }
        }
        return;
      }
      try {
        let body: unknown;
        if (message.kind === "model") body = await input.transportFor(message.jurisdiction, message.taskId)(message.body as ModelRequest);
        else if (message.kind === "search") {
          const search = input.searchFor?.(message.jurisdiction.subjectId);
          if (!search) throw new Error("PAID_SEARCH_DISABLED");
          body = await search(message.body as Parameters<NonNullable<ScoutToolContext["search"]>>[0]);
        } else if (message.kind === "escalation") {
          const reserve = input.reserveEscalation;
          if (!reserve) throw new Error("SCOUT_ESCALATION_RESERVATION_UNAVAILABLE");
          const reserved = await reserve(message.body as Parameters<typeof reserve>[0]);
          reservations.set(message.id, reserved);
          body = reserved.admit ? { admit: true, reservedUsd: reserved.reservedUsd } : reserved;
        } else throw new Error("WORKER_IPC_OPERATION_UNKNOWN");
        if (child.connected) child.send({ id: message.id, body });
      } catch (error) {
        const e = error as Error & { status?: number; retryAfterMs?: number; code?: string; why?: string };
        if (child.connected) child.send({ id: message.id, error: { name: e.name, message: e.message,
          status: e.status, retryAfterMs: e.retryAfterMs, code: e.code, why: e.why } });
      }
    });
    child.once("exit", code => {
      for (const reserved of reservations.values()) if (reserved.admit) reserved.release();
      if (code === 0) resolve(); else reject(new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`));
    });
  });
  while (pending.size && failure === null) {
    const capacity = Math.min(pending.size, input.capacity());
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");
    while (active.size < capacity) {
      const worker = launch().catch(error => { failure ??= error; }).finally(() => { active.delete(worker); });
      active.add(worker);
    }
    if (!active.size) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([...active, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
    clearTimeout(timer);
  }
  await Promise.all(active);
  if (failure !== null) throw failure;
  return results;
}
