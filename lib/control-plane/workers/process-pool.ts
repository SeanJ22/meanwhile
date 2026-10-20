import { methodCatalogRequest, closeMethodCatalogHost, releaseRuntimeMethodProcess, type MethodCatalogRequest } from "../../method/runtime-manual.ts";
import { reviveVerifiedReplay } from "../../sources/verified-replay.ts";
import { taskIdentityQueue } from "./task-identity-queue.ts";
import { requireRegistryState } from "../../civic-data/state-scopes.ts";
import type { NationalPlaceTask } from "../../hunt/place-source-task.ts";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFieldManualRows, type FieldManualQuery, type FieldManualRepos } from "../field-manual.ts";
import { indexedModelAuditSample,type AuditSampleRequest } from "./audit-sampling.ts";
import { closeAuditHistoryIndex,type AuditHistoryRepositories } from "./audit-history-index.ts";
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

/** Transient tools on this host; leases, costs and publications keep their existing stores. A manual read takes only the asking job's rows. */
export async function startWorkerToolsHost(input: { repos: FieldManualRepos&Partial<AuditHistoryRepositories>; browse: BrowseFn }) {
  const token = randomUUID();
  const priorUrl = process.env.WTP_WORKER_TOOLS_URL;
  const priorToken = process.env.WTP_WORKER_TOOLS_TOKEN;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/" || request.headers.authorization !== token) {
      response.writeHead(404).end(); return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { kind: string; body: unknown };
      const result = message.kind === "manual" ? await readFieldManualRows(input.repos, message.body as FieldManualQuery)
        : message.kind === "method" ? await methodCatalogRequest(input.repos, message.body as MethodCatalogRequest)
        : message.kind === "audit-history"&&input.repos.workerResults ? await indexedModelAuditSample(input.repos as AuditHistoryRepositories,message.body as AuditSampleRequest)
        : message.kind === "browse" ? await input.browse(message.body as Parameters<BrowseFn>[0]) : null;
      if (result === null) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch { response.writeHead(503).end(); }
  });
  let url: string;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    server.unref();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("WORKER_TOOLS_ADDRESS_UNAVAILABLE");
    url = `http://127.0.0.1:${address.port}/`;
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw error;
  }
  process.env.WTP_WORKER_TOOLS_URL = url;
  process.env.WTP_WORKER_TOOLS_TOKEN = token;
  let closing: Promise<void> | null = null;
  return { close: () => closing ??= (async () => {
    if (process.env.WTP_WORKER_TOOLS_URL === url && process.env.WTP_WORKER_TOOLS_TOKEN === token) {
      if (priorUrl === undefined) delete process.env.WTP_WORKER_TOOLS_URL;
      else process.env.WTP_WORKER_TOOLS_URL = priorUrl;
      if (priorToken === undefined) delete process.env.WTP_WORKER_TOOLS_TOKEN;
      else process.env.WTP_WORKER_TOOLS_TOKEN = priorToken;
    }
    try { await new Promise<void>(resolve => server.close(() => resolve())); }
    finally {
      try { await closeMethodCatalogHost(input.repos); }
      finally { if(input.repos.workerResults)await closeAuditHistoryIndex(input.repos as AuditHistoryRepositories); }
    }
  })() };
}
import type { DeclaredExecutor, DispatchResult } from "../scheduler/dispatch.ts";
import type { ModelRequest, ModelTransport } from "../scheduler/scout-executor.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import type { SearchBudget } from "../../hunt/search.ts";
import type { AutonomousJurisdiction } from "../expansion/spend-holds.ts";
import type { runNationalPlaceTask } from "../../hunt/place-source-task.ts";
import type { NationalPlacePublicationInput } from "../../hunt/place-source.ts";

export type NationalPlaceReport = Awaited<ReturnType<typeof runNationalPlaceTask>>[number];
type NationalPublication = Omit<NationalPlacePublicationInput, "store">;
type ElectionPublisher = NonNullable<Parameters<typeof runNationalPlaceTask>[0]["publishElection"]>;
type ScoutDispatch = Parameters<NonNullable<DeclaredExecutor["dispatch"]>>[0];
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
  /** Admin's requests in flight at once to one website; absent, the default. */
  readonly hostConcurrency?: number;
  readonly fundedSubjects: readonly string[];
  /** How long the pool lets this worker process live; set by the pool, not the caller. */
  readonly wallMs?: number;
  /** Plain-code ZIP tasks use the ordinary canonical acquisition lease. */
  readonly nationalPlaces?: readonly NationalPlaceTask[];
  readonly routeDispatch?: { readonly input: ScoutProcessDispatch; readonly route: RouteDescriptor | null };
}

/** A read or process failure leaves the existing task owed; it is never a claimed success. */
export function workerDispatchFailure(taskId: string, error: unknown, obligationId = taskId, beforeClaim = false): DispatchResult {
  return { obligationId, routeTaskId: taskId, executor: null, executorChosen: null,
    decisionDisagreement: null, executorMismatch: false, claimed: false, outcome: beforeClaim ? "NOT_CLAIMED" : "FAILED",
    attemptId: null, dispositionCommitted: false, disposition: null, artifactIds: [],
    cost: beforeClaim ? { ...ZERO_COST, usd: 0, requestCount: 0, durationMs: 0 } : null, worker: null,
    detail: `Worker task deferred: ${error instanceof Error ? error.message : String(error)}; work remains owed` };
}

/** A worker the standing lane ended alone: what it held, what it was waiting on, when it last moved. */
export interface StuckWorker {
  readonly pid: number;
  /** The task it was working, or null when it was starting up or between tasks. */
  readonly taskId: string | null;
  /** In words: the lane's reply it was waiting for, or its own work. */
  readonly waitingOn: string;
  readonly startedAt: string;
  readonly lastMovedAt: string;
  readonly quietMs: number;
  /** Tasks it finished before it stopped moving. */
  readonly tasksDone: number;
}

/** The standing hunter lane's pool: each worker has its own progress clock, and a worker quiet for `quietMs` is ended alone with its state recorded. New queued tasks join the running pool. */
export interface StandingPoolOptions {
  /** Tasks queued since the pool started; each new id joins the pool. Polled about once a second. */
  readonly moreTasks?: () => Iterable<string>;
  readonly quietMs: number;
  /** A worker older than this takes no further task: it finishes the one it holds and a fresh worker takes its place. */
  readonly retireAfterMs?: number;
  readonly onStuck?: (worker: StuckWorker) => void;
  /** Any message either way: the lane's own progress signal. */
  readonly onMoved?: () => void;
}

/** Standing workers that fail this many times in a row before their first task close the pool's admission. */
export const STANDING_STARTUP_FAILURES = 3;

/** Only memory admission happens before a child can claim a lease or send a request. */
class WorkerAdmissionRefusal extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); }
}

function workerControlConfig(config: Omit<LeaseWorkerConfig, "taskIds"> & { readonly taskIds: Iterable<string> }): LeaseWorkerConfig {
  const properties: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(config);
  properties.taskIds = { value: [], enumerable: true };
  properties.fundedSubjects = { value: [], enumerable: true };
  delete properties.nationalPlaces;
  // Preserve live policy getters while releasing references to the intake queues.
  return Object.defineProperties({}, properties) as LeaseWorkerConfig;
}

export interface LeaseWorkerSummary {
  readonly dispatched: number;
  readonly attempted: number;
  readonly worked: number;
  readonly scoutsAdmitted: number;
}

export async function runNationalPlaceWorkerProcesses(input: {
  readonly root: string;
  readonly places: readonly NationalPlaceTask[];
  readonly capacity: () => number;
  readonly onStarted?: (pid: number) => void;
  readonly childTimeoutMs?: number;
  readonly slots?: WorkerProcessSlots;
  readonly orderPending?: (zips: readonly string[]) => Promise<readonly string[]>;
  readonly store: NationalPlacePublicationInput["store"];
  readonly publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  readonly publishElection: ElectionPublisher;
  readonly onResult?: (report: NationalPlaceReport) => void | Promise<void>;
}): Promise<{ readonly reported: number }> {
  if (new Set(input.places.map(place => requireRegistryState(place.state))).size > 1) throw new Error("NATIONAL_PLACE_CHILD_STATE_MISMATCH");
  let reported = 0;
  let processFailure: string | null = null;
  let publicationTail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = publicationTail.then(operation);
    publicationTail = next.catch(() => undefined);
    return next;
  };
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/national-worker.ts", config: { root: input.root, postgres: true,
    taskIds: [...new Set(input.places.map(place => place.zip))], nationalPlaces: input.places, modelEnabled: false,
    searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: input.capacity,
    transportFor: () => async () => { throw new Error("NATIONAL_SOURCE_MODEL_CALL_REFUSED"); },
    onStarted: input.onStarted, childTimeoutMs: input.childTimeoutMs, slots: input.slots, orderPending: input.orderPending,
    onDispatched: result => { if (result.outcome !== "WORKED") processFailure ??= result.detail; },
    national: {
      publish: request => serialize(() => input.publish({ ...request, store: input.store })),
      publishElection: (fields, now) => serialize(() => input.publishElection(fields, now)),
      onResult: async report => { reported++; await input.onResult?.(report); },
    } });
  if (processFailure !== null) throw new Error(processFailure);
  return { reported };
}

/** IPC carries transient provider requests; work, leases and costs stay in the existing repositories. */
export async function runLeaseWorkerProcesses(input: {
  readonly entry: string;
  readonly deadlineMs?: number;
  readonly childTimeoutMs?: number;
  readonly config: Omit<LeaseWorkerConfig, "taskIds"> & { readonly taskIds: Iterable<string> };
  readonly slots?: WorkerProcessSlots;
  readonly capacity: (pending: number) => number;
  readonly transportFor: (jurisdiction: AutonomousJurisdiction, taskId: string) => ModelTransport;
  readonly searchFor?: (subjectId: string) => ScoutToolContext["search"];
  /** Resolve only the current task's funded membership, without copying the lane's inventory. */
  readonly isFundedSubject?: (subjectId: string) => boolean;
  /** The paid-search budget the Exa agent lane takes a slot from in this process. */
  readonly searchBudget?: SearchBudget;
  readonly onStarted?: (pid: number) => void;
  /** A worker process ended: how, in a few words (its exit, or why it was ended). */
  readonly onExited?: (pid: number, why: string) => void;
  /** Read current place priority before the next existing lease is claimed. */
  readonly orderPending?: (ids: readonly string[]) => Promise<readonly string[]>;
  readonly onDispatched?: (result: DispatchResult) => void | Promise<void>;
  readonly route?: { readonly tool: (name: string, args: readonly unknown[]) => Promise<unknown> };
  readonly national?: {
    readonly publish: (input: NationalPublication) => Promise<unknown>;
    readonly publishElection: ElectionPublisher;
    readonly onResult: (report: NationalPlaceReport) => void | Promise<void>;
  };
  /** The standing lane's per-job clocks and live queue; the round's waves leave it unset. */
  readonly standing?: StandingPoolOptions;
}): Promise<LeaseWorkerSummary> {
  const timeoutMs = input.childTimeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("WORKER_CHILD_TIMEOUT_INVALID");
  const standing = input.standing ?? null;
  if (standing !== null && (!Number.isSafeInteger(standing.quietMs) || standing.quietMs <= 0)) throw new Error("WORKER_QUIET_LIMIT_INVALID");
  const summary = { dispatched: 0, attempted: 0, worked: 0, scoutsAdmitted: 0 };
  const pending = taskIdentityQueue(input.config.taskIds, input.config.fundedSubjects);
  // The queue owns identities after intake; child configs never retain a country queue or funded-subject list.
  const nationalPlaces = input.config.nationalPlaces;
  input = { ...input, config: workerControlConfig(input.config) };
  const record = async (result: DispatchResult) => {
    summary.dispatched++;
    if (result.attemptId != null) summary.attempted++;
    if (result.outcome === "WORKED") summary.worked++;
    if (result.attemptId && result.worker?.role === "SCOUT") summary.scoutsAdmitted++;
    await input.onDispatched?.(result);
  };
  const inFlight = new Map<string, number>();
  const active = new Set<Promise<void>>();
  let admissionClosed = false;
  let startupFailures = 0;
  let refusal: unknown = null;
  const launch = async (): Promise<void> => {
    if (Date.now() >= (input.deadlineMs ?? Infinity)) throw new WorkerAdmissionRefusal(new Error("WORKER_DISPATCH_SLICE: work remains owed"));
    const release = await (input.slots ?? (input.config.postgres ? processMemorySlots : undefined))?.acquire(input.entry, input.deadlineMs)
      .catch(error => { throw new WorkerAdmissionRefusal(error); });
    try {
    // Every launch owns one task; waiting launches recheck the disk queue after memory admission.
    const nextId = await pending.claim(input.orderPending);
    if (nextId === null) { if (pending.waiting()) admissionClosed = true; return; }
    if (Date.now() >= (input.deadlineMs ?? Infinity)) { pending.release(nextId); throw new WorkerAdmissionRefusal(new Error("WORKER_DISPATCH_SLICE: work remains owed")); }
    await new Promise<void>((resolve, reject) => {
    let handedOut: string | null = nextId;
    let completion = Promise.resolve();
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
    const startedAt = Date.now();
    let batchWaiting = 0;
    let batchWaitStarted = 0;
    let batchWaitedMs = 0;
    let killTimer: ReturnType<typeof setTimeout>;
    const armKill = (ms: number): void => {
      clearTimeout(killTimer);
      killTimer = setTimeout(() => terminate(new Error(`WORKER_CHILD_TIMEOUT:${child.pid}: work remains owed`)), Math.max(1, ms));
    };
    const remainingWorkMs = () => Math.min(timeoutMs - (Date.now() - startedAt - batchWaitedMs), (input.deadlineMs ?? Infinity) - Date.now() + batchWaitedMs);
    armKill(remainingWorkMs());
    /* Standing: this worker's own clock. Any message either way renews it; quiet past the limit ends this worker alone. */
    let lastMovedAt = startedAt;
    let current: string | null = null;
    let tasksDone = 0;
    const asked = new Map<string, { kind: string; taskId: string; at: number }>();
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const stuck = (): void => {
      if (standing === null || terminating) return;
      if (batchWaiting > 0) return;
      const pid = child.pid ?? 0;
      const question = [...asked.values()].sort((a, b) => a.at - b.at)[0];
      const waitingOn = question !== undefined
        ? `the lane's answer to its ${question.kind} request for task ${question.taskId || "(none)"}, asked ${Math.round((Date.now() - question.at) / 1000)} s before`
        : current !== null ? `its own work on task ${current} (no request to the lane)` : tasksDone === 0 ? "starting up (no task yet)" : "between tasks";
      const record: StuckWorker = { pid, taskId: current, waitingOn, startedAt: new Date(startedAt).toISOString(),
        lastMovedAt: new Date(lastMovedAt).toISOString(), quietMs: standing.quietMs, tasksDone };
      standing.onStuck?.(record);
      terminate(new Error(`WORKER_STUCK:${pid}: no progress for ${Math.round(standing.quietMs / 60_000)} min while waiting on ${waitingOn}; work remains owed`));
    };
    const moved = (): void => {
      if (standing === null) return;
      lastMovedAt = Date.now();
      clearTimeout(quietTimer);
      quietTimer = setTimeout(stuck, standing.quietMs);
      standing.onMoved?.();
    };
    const reply = (payload: { id: string; body?: unknown; error?: unknown }): void => {
      asked.delete(payload.id);
      /* An answer that cannot reach a worker already exiting (EPIPE) is not the worker's failure: its exit, after the
         results it sent, decides what it finished. Without the callback the send error ended it and dropped those results. */
      if (child.connected) { child.send(payload, () => {}); moved(); }
    };
    child.once("spawn", () => { release?.observe?.(child.pid!); input.onStarted?.(child.pid!); child.send({ ...input.config, wallMs: timeoutMs,
      taskIds: [nextId], ...(nationalPlaces ? { nationalPlaces: nationalPlaces.filter(place => place.zip === nextId) } : {}) }); moved(); });
    child.on("error", error => {
      clearTimeout(killTimer); clearTimeout(quietTimer);
      if (child.pid) { terminate(error); return; }
      if (handedOut !== null) {
        const failed = handedOut; handedOut = null; pending.finish(failed);
        completion = completion.then(() => record(workerDispatchFailure(failed, error)));
      }
      void completion.then(() => reject(error), reject);
    });
    child.on("message", async (raw: unknown) => {
      const message = raw as { kind: string; id: string; taskId: string; jurisdiction: AutonomousJurisdiction; body: unknown };
      if (standing !== null && terminating) return;
      moved();
      if (message.kind === "progress") return;
      if (message.kind === "task-start") {
        current = String(message.body);
        if (standing !== null) inFlight.set(current, child.pid ?? 0);
        return;
      }
      if (message.kind === "result") {
        const result = message.body as DispatchResult;
        if (result.routeTaskId !== handedOut) { terminate(new Error("WORKER_RESULT_TASK_MISMATCH")); return; }
        pending.finish(handedOut!); inFlight.delete(handedOut!);
        current = null; handedOut = null; tasksDone++;
        completion = completion.then(() => record(result));
        await completion;
        return;
      }
      if (message.kind === "task-skipped") {
        if (String(message.body) === handedOut) { pending.finish(handedOut!); inFlight.delete(handedOut!); handedOut = null; current = null; }
        return;
      }
      if (message.kind === "finished") {
        // An acknowledgement can clear only this worker's handout.
        if (handedOut !== null && (message.body as string[]).includes(handedOut)) { pending.finish(handedOut); inFlight.delete(handedOut); handedOut = null; }
        return;
      }
      if (message.id) asked.set(message.id, { kind: message.kind, taskId: message.taskId, at: Date.now() });
      try {
        let body: unknown;
        if (message.kind === "accept-task") {
          if (String(message.body) !== handedOut) throw new Error("WORKER_TASK_HANDOUT_MISMATCH");
          const retire = standing?.retireAfterMs !== undefined && Date.now() - startedAt >= standing.retireAfterMs;
          if (retire) { pending.release(handedOut!); handedOut = null; }
          body = !retire;
        } else if (message.kind === "next-task") {
          await completion;
          if (handedOut !== null) throw new Error("WORKER_TASK_STILL_HELD");
          if (standing?.retireAfterMs !== undefined && Date.now() - startedAt >= standing.retireAfterMs) { body = null; }
          else { handedOut = await pending.claim(input.orderPending); body = handedOut; }
        } else if (message.kind === "pending-order") {
          body = [];
        } else if (message.kind === "funded-subject") {
          body = input.isFundedSubject ? input.isFundedSubject(String(message.body)) : pending.isFunded(String(message.body));
        } else if (message.kind === "route-tool") {
          if (!input.route) throw new Error("ROUTE_PROCESS_BROKER_UNAVAILABLE");
          const request = message.body as { name: string; args: readonly unknown[] };
          body = await input.route.tool(request.name, request.args);
        } else if (message.kind === "route-dispatch-result") {
          const result = message.body as DispatchResult;
          if (handedOut !== null) pending.finish(handedOut);
          handedOut = null;
          await record(result);
          body = null;
        } else if (message.kind === "national-publication") {
          if (!input.national) throw new Error("NATIONAL_PUBLICATION_BROKER_UNAVAILABLE");
          const request = reviveVerifiedReplay(message.body) as NationalPublication;
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
          const request = reviveVerifiedReplay(message.body) as { fields: Parameters<ElectionPublisher>[0]; now: string };
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
          await input.national.onResult(reviveVerifiedReplay(message.body) as NationalPlaceReport);
          body = null;
        } else if (message.kind === "model") {
          const request = message.body as ModelRequest;
          let waiting = false;
          const onBatchWait = (active: boolean): void => {
            if (active === waiting) return;
            waiting = active;
            if (active) {
              if (batchWaiting++ === 0) { batchWaitStarted = Date.now(); armKill(24 * 3_600_000 + timeoutMs); }
            } else if (--batchWaiting === 0) {
              batchWaitedMs += Math.max(0, Date.now() - batchWaitStarted);
              armKill(remainingWorkMs());
            }
          };
          try {
            body = await input.transportFor(message.jurisdiction, message.taskId)({ ...request, onBatchWait });
          } finally {
            onBatchWait(false);
          }
        }
        else if (message.kind === "search") {
          const search = input.searchFor?.(message.jurisdiction.subjectId);
          if (!search) throw new Error("PAID_SEARCH_DISABLED");
          body = await search(message.body as Parameters<NonNullable<ScoutToolContext["search"]>>[0]);
        } else if (message.kind === "search-take" || message.kind === "search-done") {
          if (!input.searchBudget) throw new Error("PAID_SEARCH_DISABLED");
          body = message.kind === "search-take" ? await input.searchBudget.take(String(message.body)) : await input.searchBudget.done(String(message.body));
        } else throw new Error("WORKER_IPC_OPERATION_UNKNOWN");
        reply({ id: message.id, body });
      } catch (error) {
        const e = error as Error & { status?: number; retryAfterMs?: number; code?: string; why?: string };
        reply({ id: message.id, error: { name: e.name, message: e.message,
          status: e.status, retryAfterMs: e.retryAfterMs, code: e.code, why: e.why } });
      }
    });
    child.once("exit", code => {
      clearTimeout(killTimer);
      clearTimeout(quietTimer);
      /* Standing: workers that keep failing before their first task close admission instead of restarting every second. */
      if (standing !== null) startupFailures = code !== 0 && tasksDone === 0 && !terminationError ? startupFailures + 1 : 0;

      const failedId = handedOut;
      if (failedId !== null) {
        if (standing !== null && current === null && code !== 0 && !terminationError && startupFailures < STANDING_STARTUP_FAILURES) pending.release(failedId);
        else {
          pending.finish(failedId);
          const obligationId = input.config.routeDispatch?.input.obligation.obligation.id ?? failedId;
          completion = completion.then(() => record(workerDispatchFailure(failedId,
            terminationError ?? new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`), obligationId)));
        }
      }
      for (const [id, pid] of inFlight) if (pid === child.pid) inFlight.delete(id);
      if (child.pid) {
        input.onExited?.(child.pid, terminationError ? (terminationError as Error).message : `exit ${code}`);
        completion = completion.then(async () => {
          try { await releaseRuntimeMethodProcess(child.pid!); }
          catch (error) { console.error(`Shared method snapshot cleanup for exited worker ${child.pid} failed: ${error instanceof Error ? error.message : String(error)}`); }
        });
      }
      const finish = () => { void completion.then(() => {
        if (terminationError) reject(terminationError);
        else if (code === 0) resolve(); else reject(new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`));
      }, reject); };
      // Do not release the memory reservation while tree termination is still in flight.
      if (terminating) void terminating.then(finish, reject); else finish();
    });
    }); } finally { release?.(); }
  };
  const joinQueued = (): void => { pending.add(standing?.moreTasks?.() ?? []); };
  try {
    joinQueued();
    while (pending.count()) {
      const capacity = Math.min(pending.count(), input.capacity(pending.count()));
      if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");
      while (!admissionClosed && active.size < capacity && pending.waiting() > 0) {
        const worker = launch().catch(error => {
          const memoryWait = standing !== null && error instanceof WorkerAdmissionRefusal && /WORKER_MEMORY_DEADLINE/.test(error.message);
          if (error instanceof WorkerAdmissionRefusal && !memoryWait) { admissionClosed = true; refusal = error; }
          if (standing !== null && startupFailures >= STANDING_STARTUP_FAILURES) { admissionClosed = true; refusal = error; }
        }).finally(() => { active.delete(worker); });
        active.add(worker);
      }
      if (!active.size) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([...active, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
      clearTimeout(timer);
      joinQueued();
    }
    await Promise.all(active);
    if (refusal !== null) for (const id of pending.unfinished()) {
      const obligationId = input.config.routeDispatch?.input.obligation.obligation.id ?? id;
      await record(workerDispatchFailure(id, refusal, obligationId, refusal instanceof WorkerAdmissionRefusal));
    }
    return summary;
  } finally { pending.close(); }
}
