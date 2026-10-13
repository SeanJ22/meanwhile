import { ModelRequestNotSent, ModelTransportError } from "../scheduler/scout-executor.ts";
import { FleetSafetyRefusal, FleetPreSendRefusal, type FleetStopCode } from "../fleet-safety.ts";
import { SendBudgetRefusal, type AutonomousJurisdiction } from "../expansion/spend-holds.ts";

type ReplyError = { name: string; message: string; status?: number; retryAfterMs?: number; code?: string; why?: string };

/** Transient provider requests use IPC; claims and results remain in the existing repositories. */
export function workerBroker<T>(work: (config: T) => Promise<void>) {
  const replies = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  let sequence = 0;
  let taskId = "";
  let jurisdiction: AutonomousJurisdiction = { subjectId: "", state: null };
  const send = (kind: string, id: string, body: unknown): void => {
    if (!process.connected || !process.send) throw new Error("LEASE_WORKER_BROKER_DISCONNECTED");
    process.send({ kind, id, body, taskId, jurisdiction });
  };
  const call = <R>(kind: string, body: unknown): Promise<R> => {
    const id = `${process.pid}:${++sequence}`;
    return new Promise<R>((resolve, reject) => {
      replies.set(id, { resolve: value => resolve(value as R), reject });
      try { send(kind, id, body); }
      catch (error) { replies.delete(id); reject(kind === "model" ? new ModelRequestNotSent(error instanceof Error ? error.message : String(error)) : error); }
    });
  };
  process.on("disconnect", () => {
    for (const reply of replies.values()) reply.reject(new Error("LEASE_WORKER_BROKER_DISCONNECTED"));
    replies.clear();
  });
  process.on("message", (raw: unknown) => {
    const message = raw as { id?: string; body?: unknown; error?: ReplyError };
    if (!message.id) {
      void work(raw as T).catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        if (process.connected) process.disconnect();
      });
      return;
    }
    const reply = replies.get(message.id);
    if (!reply) return;
    replies.delete(message.id);
    if (!message.error) { reply.resolve(message.body); return; }
    const e = message.error;
    reply.reject(e.name === "ModelTransportError" ? new ModelTransportError(e.message, e.status ?? null, e.retryAfterMs ?? null)
      : e.name === "ModelRequestNotSent" ? new ModelRequestNotSent(e.message)
      : e.name === "SendBudgetRefusal" ? new SendBudgetRefusal(e.code ?? "ASSIGNMENT_BUDGET", e.why ?? e.message)
      : e.name === "FleetPreSendRefusal" ? new FleetPreSendRefusal(new FleetSafetyRefusal(e.code as FleetStopCode, e.message))
      : e.name === "FleetSafetyRefusal" ? new FleetSafetyRefusal(e.code as FleetStopCode, e.message) : new Error(e.message));
  });
  return { call, send, assignment: (id: string, current: AutonomousJurisdiction): void => {
    taskId = id; jurisdiction = current;
  } };
}
