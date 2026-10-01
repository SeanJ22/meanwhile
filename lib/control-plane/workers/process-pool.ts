import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteDescriptor } from "../scheduler/registry.ts";
import type { WorkerProcessSlots } from "./worker-slots.ts";
import { workerProcessSlots } from "./worker-slots.ts";
export { workerProcessSlots, type WorkerProcessSlots } from "./worker-slots.ts";
const processMemorySlots = workerProcessSlots(() => Number.MAX_SAFE_INTEGER);
import type { DeclaredExecutor, DispatchResult } from "../scheduler/dispatch.ts";
import type { ModelRequest, ModelTransport, ScoutExecutorDeps } from "../scheduler/scout-executor.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
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
  readonly routeDispatch?: { readonly input: ScoutProcessDispatch; readonly route: RouteDescriptor | null };
  readonly scoutDispatch?: {
    readonly input: ScoutProcessDispatch;
    readonly context?: Omit<ScoutContext, "tools">;
    readonly contextError?: string;
    readonly toolNames: readonly string[];
    readonly toolTimeoutMs?: number;
    readonly options: Pick<ScoutExecutorDeps, "model" | "bound" | "minRungs" | "role">;
  };
}

export async function runNationalPlaceWorkerProcesses(input: {
  readonly root: string;
  readonly zips: readonly string[];
  readonly capacity: () => number;
  readonly onStarted?: (pid: number) => void;
  readonly slots?: WorkerProcessSlots;
  readonly orderPending?: (zips: readonly string[]) => Promise<readonly string[]>;
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
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/national-worker.ts", config: { root: input.root, postgres: true,
    taskIds: [...new Set(input.zips)], nationalZips: [...new Set(input.zips)], modelEnabled: false,
    searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: input.capacity,
    transportFor: () => async () => { throw new Error("NATIONAL_SOURCE_MODEL_CALL_REFUSED"); },
    onStarted: input.onStarted, slots: input.slots, orderPending: input.orderPending,
    national: {
      publish: request => serialize(() => input.publish({ ...request, store: input.store })),
      publishElection: (fields, now) => serialize(() => input.publishElection(fields, now)),
      onResult: async report => { reports.push(report); await input.onResult?.(report); },
    } });
  return reports;
}

/** IPC carries transient provider requests; work, leases and costs stay in the existing repositories. */
export async function runLeaseWorkerProcesses(input: {
  readonly entry: string;
  readonly config: LeaseWorkerConfig;
  readonly slots?: WorkerProcessSlots;
  readonly capacity: () => number;
  readonly transportFor: (jurisdiction: AutonomousJurisdiction, taskId: string) => ModelTransport;
  readonly searchFor?: (subjectId: string) => ScoutToolContext["search"];
  readonly reserveEscalation?: ScoutExecutorDeps["reserveEscalation"];
  readonly onStarted?: (pid: number) => void;
  /** Read current place priority before the next existing lease is claimed. */
  readonly orderPending?: (ids: readonly string[]) => Promise<readonly string[]>;
  readonly onDispatched?: (result: DispatchResult) => void | Promise<void>;
  readonly route?: { readonly tool: (name: string, args: readonly unknown[]) => Promise<unknown> };
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
  const launch = async (): Promise<void> => {
    const release = await (input.slots ?? (input.config.postgres ? processMemorySlots : undefined))?.acquire(input.entry);
    try {
    const ready = [...pending].filter(id => !assigned.has(id));
    const ordered = input.config.nationalZips && input.orderPending ? await input.orderPending(ready) : ready;
    // Memory admission can queue several launches. Re-check after the asynchronous ranking read.
    const nextId = ordered.find(id => pending.has(id) && !assigned.has(id));
    if (input.config.nationalZips && nextId === undefined) return;
    await new Promise<void>((resolve, reject) => {
    const ids = input.config.nationalZips ? [nextId!]
      : input.config.taskIds;
    for (const id of ids) assigned.add(id);
    const child = fork(join(input.config.root, input.entry), [], {
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
        await input.onDispatched?.(result);
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
        if (message.kind === "pending-order") {
          const requested = (message.body as readonly string[]).filter(id => pending.has(id));
          body = input.orderPending ? await input.orderPending(requested) : requested;
        } else if (message.kind === "route-tool") {
          if (!input.route) throw new Error("ROUTE_PROCESS_BROKER_UNAVAILABLE");
          const request = message.body as { name: string; args: readonly unknown[] };
          body = await input.route.tool(request.name, request.args);
        } else if (message.kind === "scout-tool") {
          if (!input.scout) throw new Error("SCOUT_PROCESS_BROKER_UNAVAILABLE");
          const request = message.body as { name: string; args: readonly unknown[] };
          body = await input.scout.tool(request.name, request.args);
        } else if (message.kind === "scout-start") {
          await input.scout?.onStart?.(message.body as Parameters<NonNullable<ScoutExecutorDeps["onStart"]>>[0]);
          body = null;
        } else if (message.kind === "scout-result") {
          const request = message.body as { result: Parameters<NonNullable<ScoutExecutorDeps["onResult"]>>[0]; artifacts: Parameters<NonNullable<ScoutExecutorDeps["onResult"]>>[1] };
          body = await input.scout?.onResult?.(request.result, request.artifacts);
        } else if (message.kind === "scout-dispatch-result" || message.kind === "route-dispatch-result") {
          const result = message.body as DispatchResult;
          results.push(result);
          for (const id of ids) pending.delete(id);
          body = null;
        } else if (message.kind === "national-publication") {
          if (!input.national) throw new Error("NATIONAL_PUBLICATION_BROKER_UNAVAILABLE");
          const request = message.body as NationalPublication;
          body = await input.national.publish(request);
          const publication = body as { promotedVersionId?: string | null; divisions?: readonly unknown[];
            bodies?: readonly unknown[]; members?: readonly { bodyId: string; discoveryIds: readonly string[] }[] } | null;
          const records = (publication?.divisions?.length ?? 0) + (publication?.bodies?.length ?? 0) + (publication?.members?.length ?? 0);
          if (publication?.promotedVersionId && records) {
            const accepted = new Set(publication.members?.flatMap(member => member.discoveryIds));
            const facts = { divisions: publication.divisions?.map(String).sort(), bodies: publication.bodies?.map(String).sort(),
              members: publication.members?.map(member => ({ bodyId: member.bodyId, discoveryIds: [...member.discoveryIds].sort() }))
                .sort((a, b) => a.bodyId.localeCompare(b.bodyId)),
              officials: request.sources.officials.filter(official => accepted.has(official.discoveryId))
                .map(official => ({ id: official.discoveryId, name: official.name, office: official.officeTitle, url: official.officialUrl }))
                .sort((a, b) => a.id.localeCompare(b.id)) };
            const key = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
            console.log("RCD_PROGRESS=" + JSON.stringify({ key, records }));
          }
        } else if (message.kind === "election-publication") {
          if (!input.national) throw new Error("NATIONAL_PUBLICATION_BROKER_UNAVAILABLE");
          const request = message.body as { fields: Parameters<ElectionPublisher>[0]; now: string };
          body = await input.national.publishElection(request.fields, request.now);
          const publication = body as Awaited<ReturnType<ElectionPublisher>>;
          if (publication.promotedVersionId && publication.fields.length) {
            const facts = { ids: [...publication.fields].sort(), fields: request.fields
              .filter(field => !publication.gaps.some(gap => gap.divisionId === field.divisionId && gap.kind === field.kind))
              .map(field => ({ division: field.divisionId, kind: field.kind, text: field.value, dates: field.dates, phone: "phone" in field ? field.phone : null,
                url: field.sourceUrl })).sort((a, b) => a.division.localeCompare(b.division) || a.kind.localeCompare(b.kind)) };
            const key = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
            console.log("RCD_PROGRESS=" + JSON.stringify({ key, records: publication.fields.length }));
          }
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
    }); } finally { release?.(); }
  };
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
