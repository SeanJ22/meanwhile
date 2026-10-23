import { requireRegistryState } from "../../civic-data/state-scopes.ts";
import type { NationalPlaceTask } from "../../hunt/place-source-task.ts";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFieldManualRows, type FieldManualQuery, type FieldManualRepos } from "../field-manual.ts";
import type { FieldManualSourceScope } from "../field-manual-sources.ts";
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

export async function startWorkerToolsHost(input: { repos: FieldManualRepos; browse: BrowseFn }) {
  const token = randomUUID();
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/" || request.headers.authorization !== token) {
      response.writeHead(404).end(); return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { kind: string; body: unknown };
      const result = message.kind === "manual" ? await readFieldManualRows(input.repos, message.body as FieldManualQuery)
        : message.kind === "manualSources" ? await (()=>{
          const {scope,url}=message.body as {scope:FieldManualSourceScope;url:string};
          return input.repos.fieldManual.sourceHints(scope,url);
        })()
        : message.kind === "manualRoutes" ? await input.repos.fieldManual.learnedRoutes(message.body as string[])
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

  readonly hostConcurrency?: number;
  readonly fundedSubjects: readonly string[];

  readonly wallMs?: number;

  readonly nationalPlaces?: readonly NationalPlaceTask[];
  readonly routeDispatch?: { readonly input: ScoutProcessDispatch; readonly route: RouteDescriptor | null; readonly deadlineMs?: number };
}

export function workerDispatchFailure(taskId: string, error: unknown, obligationId = taskId, beforeClaim = false): DispatchResult {
  return { obligationId, routeTaskId: taskId, executor: null, executorChosen: null,
    decisionDisagreement: null, executorMismatch: false, claimed: false, outcome: beforeClaim ? "NOT_CLAIMED" : "FAILED",
    attemptId: null, dispositionCommitted: false, disposition: null, artifactIds: [],
    cost: beforeClaim ? { ...ZERO_COST, usd: 0, requestCount: 0, durationMs: 0 } : null, worker: null,
    detail: `Worker task deferred: ${error instanceof Error ? error.message : String(error)}; work remains owed` };
}

export interface StuckWorker {
  readonly pid: number;

  readonly taskId: string | null;

  readonly waitingOn: string;
  readonly startedAt: string;
  readonly lastMovedAt: string;
  readonly quietMs: number;

  readonly tasksDone: number;
}

export interface StandingPoolOptions {

  readonly moreTasks?: () => readonly string[];
  readonly quietMs: number;

  readonly retireAfterMs?: number;
  readonly onStuck?: (worker: StuckWorker) => void;

  readonly onMoved?: () => void;
}

export const STANDING_STARTUP_FAILURES = 3;

class WorkerAdmissionRefusal extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); }
}

export async function runNationalPlaceWorkerProcesses(input: {
  readonly root: string;
  readonly places: readonly NationalPlaceTask[];
  readonly capacity: () => number;
  readonly onStarted?: (pid: number) => void;
  readonly slots?: WorkerProcessSlots;
  readonly orderPending?: (zips: readonly string[]) => Promise<readonly string[]>;
  readonly store: NationalPlacePublicationInput["store"];
  readonly publish: (input: NationalPlacePublicationInput) => Promise<unknown>;
  readonly publishElection: ElectionPublisher;
  readonly onResult?: (report: NationalPlaceReport) => void | Promise<void>;
}): Promise<NationalPlaceReport[]> {
  if (new Set(input.places.map(place => requireRegistryState(place.state))).size > 1) throw new Error("NATIONAL_PLACE_CHILD_STATE_MISMATCH");
  const reports: NationalPlaceReport[] = [];
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
    onStarted: input.onStarted, slots: input.slots, orderPending: input.orderPending,
    national: {
      publish: request => serialize(() => input.publish({ ...request, store: input.store })),
      publishElection: (fields, now) => serialize(() => input.publishElection(fields, now)),
      onResult: async report => { reports.push(report); await input.onResult?.(report); },
    } });
  return reports;
}

export async function runLeaseWorkerProcesses(input: {
  readonly entry: string;
  readonly deadlineMs?: number;
  readonly childTimeoutMs?: number;
  readonly config: LeaseWorkerConfig;
  readonly slots?: WorkerProcessSlots;
  readonly capacity: () => number;
  readonly transportFor: (jurisdiction: AutonomousJurisdiction, taskId: string) => ModelTransport;
  readonly searchFor?: (subjectId: string) => ScoutToolContext["search"];

  readonly searchBudget?: SearchBudget;
  readonly onStarted?: (pid: number) => void;

  readonly onExited?: (pid: number, why: string) => void;

  readonly orderPending?: (ids: readonly string[]) => Promise<readonly string[]>;
  readonly onDispatched?: (result: DispatchResult) => void | Promise<void>;
  readonly route?: { readonly tool: (name: string, args: readonly unknown[]) => Promise<unknown> };
  readonly national?: {
    readonly publish: (input: NationalPublication) => Promise<unknown>;
    readonly publishElection: ElectionPublisher;
    readonly onResult: (report: NationalPlaceReport) => void | Promise<void>;
  };

  readonly standing?: StandingPoolOptions;
}): Promise<DispatchResult[]> {
  const timeoutMs = input.childTimeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("WORKER_CHILD_TIMEOUT_INVALID");
  const standing = input.standing ?? null;
  if (standing !== null && (!Number.isSafeInteger(standing.quietMs) || standing.quietMs <= 0)) throw new Error("WORKER_QUIET_LIMIT_INVALID");
  const results: DispatchResult[] = [];
  const pending = new Set(input.config.taskIds);

  const seen = new Set(input.config.taskIds);
  const inFlight = new Map<string, number>();
  const assigned = new Set<string>();
  const active = new Set<Promise<void>>();
  let launched = 0;
  let admissionClosed = false;
  let startupFailures = 0;
  const failures: { ids: readonly string[]; error: unknown }[] = [];
  const launch = async (): Promise<void> => {
    if (Date.now() >= (input.deadlineMs ?? Infinity)) throw new WorkerAdmissionRefusal(new Error("WORKER_DISPATCH_SLICE: work remains owed"));
    const release = await (input.slots ?? (input.config.postgres ? processMemorySlots : undefined))?.acquire(input.entry, input.deadlineMs)
      .catch(error => { throw new WorkerAdmissionRefusal(error); });
    try {

    if (!pending.size) return;
    const ready = [...pending].filter(id => !assigned.has(id));
    const ordered = input.config.nationalPlaces && input.orderPending ? await input.orderPending(ready) : ready;

    const nextId = ordered.find(id => pending.has(id) && !assigned.has(id));
    if (!pending.size || (input.config.nationalPlaces && nextId === undefined)) return;
    if (Date.now() >= (input.deadlineMs ?? Infinity)) throw new WorkerAdmissionRefusal(new Error("WORKER_DISPATCH_SLICE: work remains owed"));
    await new Promise<void>((resolve, reject) => {
    const ids = input.config.nationalPlaces ? [nextId!]
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

    let lastMovedAt = startedAt;
    let current: string | null = null;
    let tasksDone = 0;
    let retired = false;
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

      if (child.connected) { child.send(payload, () => {}); moved(); }
    };
    const offset = (launched - 1) % ids.length;
    child.once("spawn", () => { release?.observe?.(child.pid!); input.onStarted?.(child.pid!); child.send({ ...input.config, wallMs: timeoutMs,
      taskIds: [...ids.slice(offset), ...ids.slice(0, offset)] }); moved(); });
    child.on("error", error => { clearTimeout(killTimer); clearTimeout(quietTimer); terminate(error); if (!child.pid) reject(error); });
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
        results.push(result);
        if (result.routeTaskId) { pending.delete(result.routeTaskId); inFlight.delete(result.routeTaskId); }
        if (current !== null && current === result.routeTaskId) { current = null; tasksDone += 1; }
        await input.onDispatched?.(result);
        return;
      }
      if (message.kind === "finished") {

        if (!retired) for (const id of message.body as string[]) if (!inFlight.has(id)) pending.delete(id);
        return;
      }
      if (message.id) asked.set(message.id, { kind: message.kind, taskId: message.taskId, at: Date.now() });
      try {
        let body: unknown;
        if (message.kind === "pending-order") {
          const requested = (message.body as readonly string[]).filter(id => pending.has(id) && !inFlight.has(id));
          if (standing?.retireAfterMs !== undefined && Date.now() - startedAt >= standing.retireAfterMs) { retired = true; body = []; }
          else body = input.orderPending ? await input.orderPending(requested) : requested;
        } else if (message.kind === "route-tool") {
          if (!input.route) throw new Error("ROUTE_PROCESS_BROKER_UNAVAILABLE");
          const request = message.body as { name: string; args: readonly unknown[] };
          body = await input.route.tool(request.name, request.args);
        } else if (message.kind === "route-dispatch-result") {
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

      if (standing !== null) startupFailures = code !== 0 && tasksDone === 0 && !terminationError ? startupFailures + 1 : 0;

      if (standing !== null && current !== null && (terminationError || code !== 0)) {
        pending.delete(current);
        const failed = workerDispatchFailure(current, terminationError ?? new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`));
        results.push(failed);
        void input.onDispatched?.(failed);
      }
      for (const [id, pid] of inFlight) if (pid === child.pid) inFlight.delete(id);
      if (child.pid) input.onExited?.(child.pid, terminationError ? (terminationError as Error).message : `exit ${code}`);
      const finish = () => {
        if (input.config.nationalPlaces) for (const id of ids) { assigned.delete(id); pending.delete(id); }
        if (terminationError) reject(terminationError);
        else if (code === 0) resolve(); else reject(new Error(`LEASE_WORKER_EXIT:${child.pid}:${code}`));
      };

      if (terminating) void terminating.then(finish, reject); else finish();
    });
    }); } finally { release?.(); }
  };
  const joinQueued = (): void => {
    for (const id of standing?.moreTasks?.() ?? []) if (!seen.has(id)) { seen.add(id); pending.add(id); }
  };

  const standingWants = (capacity: number): boolean => {
    const waiting = [...pending].filter(id => !inFlight.has(id)).length;
    return active.size < capacity && waiting > active.size - inFlight.size;
  };
  joinQueued();
  while (pending.size) {
    const capacity = Math.min(pending.size, input.capacity());
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");

    while (!admissionClosed && (input.config.nationalPlaces
      ? active.size < capacity && [...pending].some(id => !assigned.has(id))
      : standing !== null ? standingWants(capacity) : launched < capacity)) {
      launched++;
      const ids = [...pending];
      const worker = launch().catch(error => {

        const memoryWait = standing !== null && error instanceof WorkerAdmissionRefusal && /WORKER_MEMORY_DEADLINE/.test(error.message);
        if (error instanceof WorkerAdmissionRefusal && !memoryWait) admissionClosed = true;
        if (standing !== null && startupFailures >= STANDING_STARTUP_FAILURES) admissionClosed = true;
        if (standing === null || error instanceof WorkerAdmissionRefusal || admissionClosed) { if (!memoryWait) failures.push({ ids, error }); }
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
  for (const { ids, error } of failures) {
    for (const id of ids) {
      if (!pending.delete(id)) continue;
      const obligationId = input.config.routeDispatch?.input.obligation.obligation.id ?? id;
      const result = workerDispatchFailure(id, error, obligationId, error instanceof WorkerAdmissionRefusal);
      results.push(result);
      await input.onDispatched?.(result);
    }
  }
  return results;
}
