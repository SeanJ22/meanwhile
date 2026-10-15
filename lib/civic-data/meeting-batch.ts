import { meetingPartitionOfId } from "./meeting-partitions.ts";
import { withRoutineContract } from "./runtime-authority.ts";
import type { BoundedChildResult } from "./bounded-child-pass.ts";
import type { MeetingPartitionRunOptions } from "../../scripts/ingest.ts";
import { routineScopeState } from "./state-scope.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

export const MEETING_STATE_TURN_MS = 2 * 60_000;
export const MEETING_STATE_CONCURRENCY = 12;
export const MEETING_STATE_BUCKETS = 4;
export const MEETING_PREFETCH_CONCURRENCY = 64;
export const MEETING_PREFETCH_BYTES = 32 * 1024 * 1024;
export function meetingTaskBucket(task: { readonly id: string; readonly scope: string }): number {
  const body = meetingPartitionOfId(task.id)?.bodyId ?? task.scope;
  let hash = 2166136261;
  for (const character of body) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % MEETING_STATE_BUCKETS;
}
export interface MeetingBatchMember {
  readonly id: string;
  readonly dueAt: string;
  readonly nextDueAt: string;
}
export interface MeetingBatchOptions {
  readonly onMemberStarted: (id: string) => Promise<void> | void;
  readonly onSettled: (member: MeetingBatchMember, result: BoundedChildResult) => Promise<void> | void;
  readonly now?: () => number;
  readonly prefetch?: (member: MeetingBatchMember, signal: AbortSignal, acquire: MeetingPrefetchAcquire) => Promise<void>;
}
type MeetingPrefetchAcquire = (bytes: number, signal?: AbortSignal) => Promise<() => void>;
export type MeetingMemberRunner = (id: string, options: MeetingPartitionRunOptions) => Promise<void>;
let activeTurn: Promise<unknown> = Promise.resolve();

function prefetchBudget(): MeetingPrefetchAcquire {
  let used = 0;
  const waiting: (() => void)[] = [];
  return (bytes, signal) => new Promise((resolve, reject) => {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > MEETING_PREFETCH_BYTES) { reject(new Error("PREFETCH_BYTE_BUDGET")); return; }
    const remove = () => { const index = waiting.indexOf(admit); if (index >= 0) waiting.splice(index, 1); };
    const abort = () => { remove(); reject(signal?.reason ?? new Error("Prefetch stopped")); waiting[0]?.(); };
    const admit = () => {
      if (signal?.aborted) { abort(); return; }
      if (waiting[0] !== admit || used + bytes > MEETING_PREFETCH_BYTES) return;
      remove(); signal?.removeEventListener("abort", abort); used += bytes;
      let released = false;
      resolve(() => { if (released) return; released = true; used -= bytes; waiting[0]?.(); });
      waiting[0]?.();
    };
    waiting.push(admit); signal?.addEventListener("abort", abort, { once: true }); admit();
  });
}

async function prefetchMeetingMember(member: MeetingBatchMember, signal: AbortSignal, acquire: MeetingPrefetchAcquire): Promise<void> {
  const partition = meetingPartitionOfId(member.id);
  if (!partition) return;
  const { prefetchSourceRequests } = await import("../sources/fetch-source.ts");
  await prefetchSourceRequests({ sourceId: member.id, state: routineScopeState(partition.bodyId), dueAt: member.dueAt, signal, acquire });
}

export function runMeetingBatchPass(
  members: readonly MeetingBatchMember[], options: MeetingBatchOptions, run?: MeetingMemberRunner,
): Promise<readonly BoundedChildResult[]> {
  const turn = activeTurn.then(async () => {
    if (!members.length) return [];
    if (new Set(members.map(member => member.id)).size !== members.length) throw new Error("MEETING_BATCH_DUPLICATE_MEMBER");
    const execute = run ?? (await import("../../scripts/ingest.ts")).runMeetingPartition;
    const now = options.now ?? Date.now;
    const until = now() + MEETING_STATE_TURN_MS;
    const results: BoundedChildResult[] = [];
    const stop = new AbortController(), prepared = new Map<string, Promise<void>>();
    const acquire = prefetchBudget();
    const timer = setTimeout(() => stop.abort(), MEETING_STATE_TURN_MS);
    timer.unref();
    let next = 0;
    const fill = (index: number) => {
      while (next < Math.min(members.length, index + MEETING_PREFETCH_CONCURRENCY) && now() < until && !stop.signal.aborted) {
        const member = members[next++]!;
        prepared.set(member.id, Promise.resolve().then(() => (options.prefetch ?? prefetchMeetingMember)(member, stop.signal, acquire)).catch(error => {
          if (!stop.signal.aborted) console.warn(`RCD_PREFETCH ${member.id}: ${sanitizedErrorDiagnostic(error)}`);
        }));
      }
    };
    try {
      fill(0);
      for (let index = 0; index < members.length; index++) {
        const member = members[index]!;
        if (now() >= until) stop.abort();
        await prepared.get(member.id);
        prepared.delete(member.id);
        let receipt = "";
        let errorMessage: string | null = null;
        let result: BoundedChildResult;
        if (now() >= until) {
          result = { id: member.id, status: null, signal: null, stdout: "", stderr: "", termination: "SPAWN_FAILED",
            errorMessage: "PASS_TIME_BUDGET: state turn ended before this member started", settlementErrorMessage: null };
        } else {
          await options.onMemberStarted(member.id);
          try { await withRoutineContract(member.id, () => execute(member.id, { dueAt: member.dueAt, nextDueAt: member.nextDueAt, onReceipt: line => { receipt = line; } })); }
          catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
          result = { id: member.id, status: receipt ? 0 : 1, signal: null, stdout: receipt, stderr: "", termination: "EXITED",
            errorMessage: errorMessage ?? (receipt ? null : "Meeting member returned without its source receipt"),
            settlementErrorMessage: receipt ? errorMessage : null };
        }
        try { await options.onSettled(member, result); }
        catch (error) { result = { ...result, settlementErrorMessage: error instanceof Error ? error.message : String(error) }; }
        results.push({ ...result, stdout: "", stderr: "" });
        fill(index + 1);
      }
      return results;
    } finally {
      clearTimeout(timer);
      stop.abort();
      await Promise.allSettled(prepared.values());
    }
  });
  activeTurn = turn.catch(() => undefined);
  return turn;
}
