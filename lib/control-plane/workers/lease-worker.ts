import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { RepositoryLockHeld } from "../repository/types.ts";
import { ModelTransportError, type ModelResponse, type ScoutEscalationAdmission } from "../scheduler/scout-executor.ts";
import { FleetSafetyController, FleetSafetyRefusal, FleetPreSendRefusal, type FleetStopCode } from "../fleet-safety.ts";
import { SendBudgetRefusal, type AutonomousJurisdiction } from "../expansion/spend-holds.ts";
import { autonomousStandingRuntime } from "./standing-runtime.ts";
import { dispatchAutonomousTask } from "./coordinator.ts";
import { browseWithPlaywright } from "../../../scripts/scout-browse.mts";
import type { LeaseWorkerConfig } from "./process-pool.ts";
import { join } from "node:path";

const replies = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
let sequence = 0;
let taskId = "";
let jurisdiction: AutonomousJurisdiction = { subjectId: "", state: null };
function send(kind: string, id: string, body: unknown): void {
  if (!process.connected || !process.send) throw new Error("LEASE_WORKER_BROKER_DISCONNECTED");
  process.send({ kind, id, body, taskId, jurisdiction });
}
function call<T>(kind: string, body: unknown): Promise<T> {
  const id = `${process.pid}:${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    replies.set(id, { resolve: value => resolve(value as T), reject });
    try { send(kind, id, body); } catch (error) { replies.delete(id); reject(error); }
  });
}
process.on("disconnect", () => {
  for (const reply of replies.values()) reply.reject(new Error("LEASE_WORKER_BROKER_DISCONNECTED"));
  replies.clear();
});

async function work(config: LeaseWorkerConfig): Promise<void> {
  const url = config.postgres ? controlPlaneUrlFromEnv() : null;
  if (config.postgres && !url) throw new Error("CONTROL_PLANE_DATABASE_UNCONFIGURED");
  const repos = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })
    : await createFileRepositories(config.fileStoreRoot ?? join(config.root, ".runtime/control-plane/freshness-shadow"));
  if (config.nationalZips) {
    const [{ runNationalPlaceTask }, { PostgresRoutineDataStore },
      { DurableEvidenceStore }, { VAULT_DIR }, { hostSpacer }, { serializeHostSpacing }] = await Promise.all([
      import("../../hunt/place-source-task.ts"), import("../../civic-data/store.ts"),
      import("../evidence/durable-store.ts"),
      import("../scheduler/vault.ts"), import("../scheduler/http-executor.ts"), import("./host-spacing.ts")]);
    const tools = { repos, store: new DurableEvidenceStore(join(config.root, ...VAULT_DIR)),
      spaceOut: serializeHostSpacing(hostSpacer()), browse: browseWithPlaywright, now: () => new Date().toISOString() };
    for (const zip of config.taskIds) {
      taskId = `national-place:${zip}`;
      const reports = await runNationalPlaceTask({ tools, store: new PostgresRoutineDataStore(), zips: [zip],
        publish: ({ store: _store, ...input }) => call("national-publication", input),
        publishElection: (fields, now) => call("election-publication", { fields, now }) });
      for (const report of reports) await call("national-result", report);
    }
    send("finished", "", config.taskIds);
    process.disconnect();
    return;
  }
  const safety = new FleetSafetyController({ now: new Date().toISOString(), costs: [], rollingCeilingUsd: config.ceilingUsd });
  const pending = new Set(config.taskIds);
  // Each process runs one live lease at a time, always pulling current task state.
  // The first process to claim wins in the existing repository dispatcher.
  while (pending.size) {
    let ran = false;
    for (const id of pending) {
      pending.delete(id);
      const task = (await repos.routeTasks.read(id))?.value;
      if (!task || !["PENDING", "RECLAIMABLE"].includes(task.state)) continue;
      taskId = id;
      const item = (await repos.workItems.mustRead(task.workItemId)).value;
      jurisdiction = { subjectId: item.subject, state: item.autonomousPlan?.jurisdiction ?? null };
      const runtime = await autonomousStandingRuntime({ root: config.root, repos, environment: process.env,
        browse: browseWithPlaywright, openBytes: safety.guardedOpenBytes("public-web", item.subject),
        ...(config.modelEnabled ? { transport: request => call<ModelResponse>("model", request),
          transportFor: current => { jurisdiction = current; return request => call<ModelResponse>("model", request); },
          reserveScoutEscalation: async request => {
            const response = await call<(Omit<Extract<ScoutEscalationAdmission, { admit: true }>, "draw" | "release"> & { reservationId: string }) |
              Extract<ScoutEscalationAdmission, { admit: false }>>("escalation", request);
            return response.admit ? { ...response, draw: usd => send("draw", response.reservationId, usd), release: () => send("release", response.reservationId, null) } : response;
          } } : {}),
        ...(config.searchEnabled ? { search: request => call("search", request) } : {}),
        auditCeilingUsd: config.ceilingUsd, lifetimeHuntSubject: subject => config.fundedSubjects.includes(subject) });
      try {
        const result = await dispatchAutonomousTask(runtime, task);
        send("result", "", result);
        ran = true;
      } catch (error) {
        if (!(error instanceof RepositoryLockHeld) && !(error instanceof Error && error.message === "WORKER_TASK_NOT_DISPATCHABLE")) throw error;
      }
      if (ran) break;
    }
  }
  send("finished", "", config.taskIds);
  process.disconnect();
}

process.on("message", (raw: unknown) => {
  const message = raw as { id?: string; body?: unknown; error?: { name: string; message: string; status?: number; retryAfterMs?: number; code?: string; why?: string } };
  if (!message.id) {
    void work(raw as LeaseWorkerConfig).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; process.disconnect(); });
    return;
  }
  const reply = replies.get(message.id);
  if (!reply) return;
  replies.delete(message.id);
  if (!message.error) { reply.resolve(message.body); return; }
  const e = message.error;
  const error = e.name === "ModelTransportError" ? new ModelTransportError(e.message, e.status ?? null, e.retryAfterMs ?? null)
    : e.name === "SendBudgetRefusal" ? new SendBudgetRefusal(e.code ?? "ASSIGNMENT_BUDGET", e.why ?? e.message)
    : e.name === "FleetPreSendRefusal" ? new FleetPreSendRefusal(new FleetSafetyRefusal(e.code as FleetStopCode, e.message))
    : e.name === "FleetSafetyRefusal" ? new FleetSafetyRefusal(e.code as FleetStopCode, e.message) : new Error(e.message);
  reply.reject(error);
});
