import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { narrowFieldManual, type FieldManualQuery, type FieldManualRead } from "../field-manual.ts";
import type { BrowseFn } from "../scheduler/scout-contract.ts";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteDescriptor } from "../scheduler/registry.ts";
import type { WorkerProcessSlots } from "./worker-slots.ts";
import { workerProcessSlots } from "./worker-slots.ts";
import { ZERO_COST } from "../attempt.ts";
import { endOwnedProcessTree } from "../../../scripts/pilot-runtime-child.mts";
export { workerProcessSlots, type WorkerProcessSlots } from "./worker-slots.ts";
const processMemorySlots = workerProcessSlots(() => Number.MAX_SAFE_INTEGER);

/** Transient tools on this host; leases, costs and publications keep their existing stores. */
export async function startWorkerToolsHost(input: { knowledge: FieldManualRead; browse: BrowseFn }) {
  const token = randomUUID();
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/" || request.headers.authorization !== token) {
      response.writeHead(404).end(); return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { kind: string; body: unknown };
      const result = message.kind === "manual" ? narrowFieldManual(input.knowledge, message.body as FieldManualQuery)
        : message.kind === "browse" ? await input.browse(message.body as Parameters<BrowseFn>[0]) : null;
      if (result === null) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch { response.writeHead(503).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("WORKER_TOOLS_ADDRESS_UNAVAILABLE");
  process.env.WTP_WORKER_TOOLS_URL = `http://127.0.0.1:${address.port}/`;
  process.env.WTP_WORKER_TOOLS_TOKEN = token;
  return { close: async () => {
    delete process.env.WTP_WORKER_TOOLS_URL; delete process.env.WTP_WORKER_TOOLS_TOKEN;
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
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

/** A read or process failure leaves the existing task owed; it is never a claimed success. */
export function workerDispatchFailure(taskId: string, error: unknown, obligationId = taskId, beforeClaim = false): DispatchResult {
  return { obligationId, routeTaskId: taskId, executor: null, executorChosen: null,
    decisionDisagreement: null, executorMismatch: false, claimed: false, outcome: beforeClaim ? "NOT_CLAIMED" : "FAILED",
    attemptId: null, dispositionCommitted: false, disposition: null, artifactIds: [],
    cost: beforeClaim ? { ...ZERO_COST, usd: 0, requestCount: 0, durationMs: 0 } : null, worker: null,
    detail: `Worker task deferred: ${error instanceof Error ? error.message : String(error)}; work remains owed` };
}

/** Only memory admission happens before a child can claim a lease or send a request. */
class WorkerAdmissionRefusal extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); }
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
  readonly deadlineMs?: number;
  readonly childTimeoutMs?: number;
  readonly config: LeaseWorkerConfig;
  readonly slots?: WorkerProcessSlots;
  readonly capacity: () => number;
  readonly transportFor: (jurisdiction: AutonomousJurisdiction, taskId: string) => ModelTransport;
  readonly searchFor?: (subjectId: string) => ScoutToolContext["search"];
  readonly reserveEscalation?: ScoutExecutorDeps["reserveEscalation"];
  readonly onStarted?: (pid: number) => void;
  /** A worker process ended: how, in a few words (its exit, or why it was ended). */
  readonly onExited?: (pid: number, why: string) => void;
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
  const timeoutMs = input.childTimeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("WORKER_CHILD_TIMEOUT_INVALID");
  const results: DispatchResult[] = [];
  const pending = new Set(input.config.taskIds);
  const assigned = new Set<string>();
  const active = new Set<Promise<void>>();
  let launched = 0;
  let admissionClosed = false;
  const failures: { ids: readonly string[]; error: unknown }[] = [];
  const launch = async (): Promise<void> => {
    if (Date.now() >= (input.deadlineMs ?? Infinity)) throw new WorkerAdmissionRefusal(new Error("WORKER_DISPATCH_SLICE: work remains owed"));
    const release = await (input.slots ?? (input.config.postgres ? processMemorySlots : undefined))?.acquire(input.entry, input.deadlineMs)
      .catch(error => { throw new WorkerAdmissionRefusal(error); });
    try {
    // Acquiring host memory can wait until a sibling has drained this wave.
    if (!pending.size) return;
    const ready = [...pending].filter(id => !assigned.has(id));
    const ordered = input.config.nationalZips && input.orderPending ? await input.orderPending(ready) : ready;
    // Memory admission can queue several launches. Re-check after the asynchronous ranking read.
    const nextId = ordered.find(id => pending.has(id) && !assigned.has(id));
    if (!pending.size || (input.config.nationalZips && nextId === undefined)) return;
    if (Date.now() >= (input.deadlineMs ?? Infinity)) throw new WorkerAdmissionRefusal(new Error("WORKER_DISPATCH_SLICE: work remains owed"));
    await new Promise<void>((resolve, reject) => {
    const ids = input.config.nationalZips ? [nextId!]
      : [...pending];
    for (const id of ids) assigned.add(id);
    const child = fork(join(input.config.root, input.entry), [], {
      cwd: input.config.root, env: { ...process.env },
      execArgv: ["--experimental-strip-types", "--import", pathToFileURL(join(input.config.root, "scripts/register-test-loader.mjs")).href],
      stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "advanced",
      detached: process.platform !== "win32",
    });
    let terminationError: Error | null = null;
    let terminating: Promise<void> | null = null;
    const terminate = (error: Error) => {
      if (terminating) return;
      terminationError = error;
      terminating = endOwnedProcessTree(child);
      void terminating.catch(reject);
    };
    const killTimer = setTimeout(() => terminate(new Error(`WORKER_CHILD_TIMEOUT:${child.pid}: work remains owed`)),
      Math.max(1, Math.min(timeoutMs, (input.deadlineMs ?? Infinity) - Date.now())));
    const reservations = new Map<string, Awaited<ReturnType<NonNullable<ScoutExecutorDeps["reserveEscalation"]>>>>();
    const offset = (launched - 1) % ids.length;
    child.once("spawn", () => { release?.observe?.(child.pid!); input.onStarted?.(child.pid!); child.send({ ...input.config,
      taskIds: [...ids.slice(offset), ...ids.slice(0, offset)] }); });
    child.on("error", error => { clearTimeout(killTimer); terminate(error); if (!child.pid) reject(error); });
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
      clearTimeout(killTimer);
      if (child.pid) input.onExited?.(child.pid, terminationError ? (terminationError as Error).message : `exit ${code}`);
      const finish = () => {
        if (input.config.nationalZips) for (const id of ids) { assigned.delete(id); pending.delete(id); }
        for (const reserved of reservations.values()) if (reserved.admit) reserved.release();
        if (terminationError) reject(terminationError);
        else if (code === 0) resolve(); else reject(new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`));
      };
      // Do not release the memory reservation while tree termination is still in flight.
      if (terminating) void terminating.then(finish, reject); else finish();
    });
    }); } finally { release?.(); }
  };
  while (pending.size) {
    const capacity = Math.min(pending.size, input.capacity());
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");
    // Every child drains the shared task list. A finished child needs no replacement;
    // siblings may still own the remaining leases when their result is in transit.
    while (!admissionClosed && (input.config.nationalZips
      ? active.size < capacity && [...pending].some(id => !assigned.has(id))
      : launched < capacity)) {
      launched++;
      const ids = [...pending];
      const worker = launch().catch(error => {
        if (error instanceof WorkerAdmissionRefusal) admissionClosed = true;
        failures.push({ ids, error });
      }).finally(() => { active.delete(worker); });
      active.add(worker);
    }
    if (!active.size) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([...active, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
    clearTimeout(timer);
  }
  await Promise.all(active);
  for (const { ids, error } of failures) {
    for (const id of ids) {
      if (!pending.delete(id)) continue;
      const obligationId = input.config.scoutDispatch?.input.obligation.obligation.id ??
        input.config.routeDispatch?.input.obligation.obligation.id ?? id;
      const result = workerDispatchFailure(id, error, obligationId, error instanceof WorkerAdmissionRefusal);
      results.push(result);
      await input.onDispatched?.(result);
    }
  }
  return results;
}
