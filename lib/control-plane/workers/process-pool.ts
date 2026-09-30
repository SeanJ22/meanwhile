import { fork } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DeclaredExecutor, DispatchResult } from "../scheduler/dispatch.ts";
import { scoutExecutor, type ModelRequest, type ModelTransport, type ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import { buildScoutToolkit } from "../scheduler/scout-tools.ts";
import type { AutonomousJurisdiction } from "../expansion/spend-holds.ts";
import type { runNationalPlaceTask } from "../../hunt/place-source-task.ts";
import type { NationalPlacePublicationInput } from "../../hunt/place-source.ts";

export type NationalPlaceReport = Awaited<ReturnType<typeof runNationalPlaceTask>>[number];
type NationalPublication = Omit<NationalPlacePublicationInput, "store">;
type ElectionPublisher = NonNullable<Parameters<typeof runNationalPlaceTask>[0]["publishElection"]>;
type ScoutDispatch = Parameters<NonNullable<DeclaredExecutor["dispatch"]>>[0];
type ScoutContext = ReturnType<ScoutExecutorDeps["contextFor"]>;
type ScoutProcessDispatch = Omit<ScoutDispatch, "clock" | "maturity"> & {
  readonly liveClock: boolean;
  readonly maturity: "GRADUATED" | "UNGRADUATED";
};

export interface LeaseWorkerConfig {
  readonly root: string;
  readonly fileStoreRoot?: string;
  readonly postgres: boolean;
  readonly taskIds: readonly string[];
  readonly modelEnabled: boolean;
  readonly searchEnabled: boolean;
  readonly ceilingUsd: number;
  readonly fundedSubjects: readonly string[];
  /** Plain-code ZIP tasks use S9's ordinary canonical acquisition lease. */
  readonly nationalZips?: readonly string[];
  readonly scoutDispatch?: {
    readonly input: ScoutProcessDispatch;
    readonly context?: Omit<ScoutContext, "tools">;
    readonly contextError?: string;
    readonly toolNames: readonly string[];
    readonly toolTimeoutMs?: number;
    readonly options: Pick<ScoutExecutorDeps, "model" | "bound" | "minRungs" | "role">;
  };
}

/** Budget and publication callbacks stay in the parent; the child owns the lease and research loop. */
export function scoutProcessExecutor(input: {
  readonly root: string;
  readonly postgres: boolean;
  readonly fileStoreRoot?: string;
  readonly deps: Omit<ScoutExecutorDeps, "toolkitFor">;
  readonly search?: ScoutToolContext["search"];
  readonly onStarted?: (pid: number) => void;
}): DeclaredExecutor {
  const original = scoutExecutor({ ...input.deps, toolkitFor: buildScoutToolkit });
  return { ...original, dispatch: async request => {
    let context: Omit<ScoutContext, "tools"> | undefined;
    let contextError: string | undefined;
    let tools: ScoutContext["tools"] = { vault: async () => { throw new Error("SCOUT_CONTEXT_UNAVAILABLE"); }, spaceOut: async () => {} };
    try {
      const assembled = input.deps.contextFor(request.obligation);
      const { tools: assembledTools, ...metadata } = assembled;
      tools = assembledTools;
      context = metadata;
    } catch (error) { contextError = error instanceof Error ? error.message : String(error); }
    const { clock, maturity, ...data } = request;
    const toolsByName = new Map<string, (...args: readonly unknown[]) => unknown>();
    for (const [name, tool] of Object.entries(tools)) {
      if (typeof tool === "function") toolsByName.set(name, tool as (...args: readonly unknown[]) => unknown);
    }
    if (input.search) toolsByName.set("search", input.search as (...args: readonly unknown[]) => unknown);
    const results = await runLeaseWorkerProcesses({ config: {
      root: input.root, postgres: input.postgres, fileStoreRoot: input.fileStoreRoot,
      taskIds: [request.routeTaskId ?? request.obligation.obligation.id], modelEnabled: true,
      searchEnabled: Boolean(input.search), ceilingUsd: 0, fundedSubjects: [],
      scoutDispatch: { input: { ...data, liveClock: Boolean(clock), maturity: maturity(request.obligation.obligation.routeId) },
        context, contextError, toolNames: [...toolsByName.keys()], toolTimeoutMs: tools.timeoutMs, options: { model: input.deps.model,
          bound: input.deps.bound, minRungs: input.deps.minRungs, role: input.deps.role } },
    }, capacity: () => 1, onStarted: input.onStarted, transportFor: () => input.deps.transport,
    reserveEscalation: input.deps.reserveEscalation,
    scout: { onStart: input.deps.onStart, onResult: input.deps.onResult,
      tool: async (name, args) => {
        const tool = toolsByName.get(name);
        if (!tool) throw new Error(`SCOUT_PROCESS_TOOL_UNAVAILABLE:${name}`);
        return tool(...args);
      } },
    });
    if (results.length !== 1) throw new Error("SCOUT_PROCESS_RESULT_MISSING");
    return results[0]!;
  } };
}

export async function runNationalPlaceWorkerProcesses(input: {
  readonly root: string;
  readonly zips: readonly string[];
  readonly capacity: () => number;
  readonly onStarted?: (pid: number) => void;
  readonly store: NationalPlacePublicationInput["store"];
  readonly publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  readonly publishElection: ElectionPublisher;
  readonly onResult?: (report: NationalPlaceReport) => void | Promise<void>;
}): Promise<NationalPlaceReport[]> {
  const reports: NationalPlaceReport[] = [];
  let publicationTail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = publicationTail.then(operation);
    publicationTail = next.catch(() => undefined);
    return next;
  };
  await runLeaseWorkerProcesses({ config: { root: input.root, postgres: true,
    taskIds: [...new Set(input.zips)], nationalZips: [...new Set(input.zips)], modelEnabled: false,
    searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: input.capacity,
    transportFor: () => async () => { throw new Error("NATIONAL_SOURCE_MODEL_CALL_REFUSED"); },
    onStarted: input.onStarted,
    national: {
      publish: request => serialize(() => input.publish({ ...request, store: input.store })),
      publishElection: (fields, now) => serialize(() => input.publishElection(fields, now)),
      onResult: async report => { reports.push(report); await input.onResult?.(report); },
    } });
  return reports;
}

/** IPC carries transient provider requests; work, leases and costs stay in the existing repositories. */
export async function runLeaseWorkerProcesses(input: {
  readonly config: LeaseWorkerConfig;
  readonly capacity: () => number;
  readonly transportFor: (jurisdiction: AutonomousJurisdiction, taskId: string) => ModelTransport;
  readonly searchFor?: (subjectId: string) => ScoutToolContext["search"];
  readonly reserveEscalation?: ScoutExecutorDeps["reserveEscalation"];
  readonly onStarted?: (pid: number) => void;
  readonly scout?: {
    readonly onStart?: ScoutExecutorDeps["onStart"];
    readonly onResult?: ScoutExecutorDeps["onResult"];
    readonly tool: (name: string, args: readonly unknown[]) => Promise<unknown>;
  };
  readonly national?: {
    readonly publish: (input: NationalPublication) => Promise<unknown>;
    readonly publishElection: ElectionPublisher;
    readonly onResult: (report: NationalPlaceReport) => void | Promise<void>;
  };
}): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const pending = new Set(input.config.taskIds);
  const assigned = new Set<string>();
  const active = new Set<Promise<void>>();
  let launched = 0;
  let failure: unknown = null;
  const launch = (): Promise<void> => new Promise((resolve, reject) => {
    const ids = input.config.nationalZips ? [[...pending].find(id => !assigned.has(id))!]
      : input.config.taskIds;
    for (const id of ids) assigned.add(id);
    const child = fork(join(input.config.root, "lib/control-plane/workers/lease-worker.ts"), [], {
      cwd: input.config.root, env: { ...process.env },
      execArgv: ["--experimental-strip-types", "--import", pathToFileURL(join(input.config.root, "scripts/register-test-loader.mjs")).href],
      stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "advanced",
    });
    const reservations = new Map<string, Awaited<ReturnType<NonNullable<ScoutExecutorDeps["reserveEscalation"]>>>>();
    const offset = (launched - 1) % ids.length;
    child.once("spawn", () => { input.onStarted?.(child.pid!); child.send({ ...input.config,
      taskIds: [...ids.slice(offset), ...ids.slice(0, offset)] }); });
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
        if (message.kind === "scout-tool") {
          if (!input.scout) throw new Error("SCOUT_PROCESS_BROKER_UNAVAILABLE");
          const request = message.body as { name: string; args: readonly unknown[] };
          body = await input.scout.tool(request.name, request.args);
        } else if (message.kind === "scout-start") {
          await input.scout?.onStart?.(message.body as Parameters<NonNullable<ScoutExecutorDeps["onStart"]>>[0]);
          body = null;
        } else if (message.kind === "scout-result") {
          const request = message.body as { result: Parameters<NonNullable<ScoutExecutorDeps["onResult"]>>[0]; artifacts: Parameters<NonNullable<ScoutExecutorDeps["onResult"]>>[1] };
          body = await input.scout?.onResult?.(request.result, request.artifacts);
        } else if (message.kind === "scout-dispatch-result") {
          const result = message.body as DispatchResult;
          results.push(result);
          for (const id of ids) pending.delete(id);
          body = null;
        } else if (message.kind === "national-publication") {
          if (!input.national) throw new Error("NATIONAL_PUBLICATION_BROKER_UNAVAILABLE");
          body = await input.national.publish(message.body as NationalPublication);
        } else if (message.kind === "election-publication") {
          if (!input.national) throw new Error("NATIONAL_PUBLICATION_BROKER_UNAVAILABLE");
          const request = message.body as { fields: Parameters<ElectionPublisher>[0]; now: string };
          body = await input.national.publishElection(request.fields, request.now);
        } else if (message.kind === "national-result") {
          if (!input.national) throw new Error("NATIONAL_PUBLICATION_BROKER_UNAVAILABLE");
          await input.national.onResult(message.body as NationalPlaceReport);
          body = null;
        } else if (message.kind === "model") body = await input.transportFor(message.jurisdiction, message.taskId)(message.body as ModelRequest);
        else if (message.kind === "search") {
          const search = input.searchFor?.(message.jurisdiction.subjectId);
          if (!search) throw new Error("PAID_SEARCH_DISABLED");
          body = await search(message.body as Parameters<NonNullable<ScoutToolContext["search"]>>[0]);
        } else if (message.kind === "escalation") {
          const reserve = input.reserveEscalation;
          if (!reserve) throw new Error("SCOUT_ESCALATION_RESERVATION_UNAVAILABLE");
          const reserved = await reserve(message.body as Parameters<typeof reserve>[0]);
          if (reserved.admit) reservations.set(message.id, reserved);
          body = reserved.admit ? { admit: true, reservedUsd: reserved.reservedUsd, reservationId: message.id } : reserved;
        } else throw new Error("WORKER_IPC_OPERATION_UNKNOWN");
        if (child.connected) child.send({ id: message.id, body });
      } catch (error) {
        const e = error as Error & { status?: number; retryAfterMs?: number; code?: string; why?: string };
        if (child.connected) child.send({ id: message.id, error: { name: e.name, message: e.message,
          status: e.status, retryAfterMs: e.retryAfterMs, code: e.code, why: e.why } });
      }
    });
    child.once("exit", code => {
      if (input.config.nationalZips) for (const id of ids) { assigned.delete(id); pending.delete(id); }
      for (const reserved of reservations.values()) if (reserved.admit) reserved.release();
      if (code === 0) resolve(); else reject(new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`));
    });
  });
  while (pending.size && (failure === null || input.config.nationalZips)) {
    const capacity = Math.min(pending.size, input.capacity());
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");
    // Every child drains the shared task list. A finished child needs no replacement;
    // siblings may still own the remaining leases when their result is in transit.
    while (input.config.nationalZips
      ? active.size < capacity && [...pending].some(id => !assigned.has(id))
      : launched < capacity) {
      launched++;
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
