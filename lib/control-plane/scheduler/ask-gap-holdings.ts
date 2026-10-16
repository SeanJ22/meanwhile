import { cadenceMsAt, sittingWindowRereadMs } from "../../civic-data/contracts.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import {
  ROUTINE_SOURCE_TASKS,
  readRoutineTaskClocks,
  routineTaskDeadlineMs,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../../civic-data/runner.ts";
import { readReaderEdgeMeetings } from "../../meetings/edge-serving.ts";
import { resolveReaderArtifactWriteStore } from "../../meetings/edge-store.ts";
import { readPreparedMeetingsProjection } from "../../meetings/prepared-snapshot.ts";
import type { MeetingsProjectionReadResult } from "../../meetings/snapshot.ts";
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted, outcomePointers, readDoorOutcomeProjection } from "../../outcomes/store.ts";
import type { PersistedSittingOutcomes } from "../../outcomes/types.ts";
import type { AgendaDocumentLike } from "../../routing/agenda-search.ts";
import { readAskGapObservations, type AskGapObservation } from "../ask-gap-observations.ts";
import type { AggregateRepository } from "../repository/types.ts";
import type { AskGapHoldingsReading, AskGapMeeting, AskGapsInput, CarrierClock } from "./providers/ask-gaps.ts";

export function askGapCarrierTasks(): readonly RoutineSourceTask[] {
  return ROUTINE_SOURCE_TASKS.filter((task) => task.recordClass === "MEETING" || task.recordClass === "MEETING_OUTCOME");
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function readHeldMeetings(now: string, state?: string): Promise<MeetingsProjectionReadResult> {
  const prepared = () => readPreparedMeetingsProjection({ now });
  let fellBack = false;
  const edge = await readReaderEdgeMeetings({
    now,
    window: "HELD",
    ...(state ? {states:[state]} : {}),
    store: resolveReaderArtifactWriteStore(),
    fallback: () => {
      fellBack = true;
      return prepared();
    },
  });

  if (!fellBack && edge.kind === "PROMOTED" && edge.metadata.stale !== "CURRENT") return prepared();
  return edge;
}

async function readHeldOutcomes(state?: string): Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }> {
  try {
    if (state) {
      const sittings: PersistedSittingOutcomes[] = [];
      const failures:string[] = [];
      for (const pointer of outcomePointers().filter(pointer=>pointer.scope.startsWith(`US-${state.toUpperCase()}:`))) {
        const result=await readDoorOutcomeProjection(pointer.scope);
        if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") sittings.push(...result.value.sittings);
        else if (result.kind === "STORE_UNREACHABLE") failures.push(result.detail);
      }
      return {sittings,unreadable:failures.length?failures.join("; "):null};
    }
    await refreshOutcomeSnapshotFromPromoted();
  } catch (error) {
    return { sittings: [], unreadable: message(error) };
  }
  if (loadedFrom() === "EMPTY_STORE") {
    const state = outcomeProjectionReadState();
    return { sittings: [], unreadable: `${state.kind}${state.detail ? `: ${state.detail}` : ""}` };
  }
  return { sittings: getOutcomeSnapshot().sittings, unreadable: null };
}

export function carrierClocks(
  reads: readonly { readonly task: RoutineSourceTask; readonly ok: boolean; readonly clock?: RoutineTaskClock; readonly error?: string | null }[],
  nowMs: number,
): ReadonlyMap<string, CarrierClock> {
  const signals = sittingWindowSignals(reads, nowMs);
  const out = new Map<string, CarrierClock>();
  for (const read of reads) {
    if (!read.ok) {
      out.set(read.task.id, { kind: "UNREAD", why: read.error ?? "the clock read failed" });
      continue;
    }
    const clock = read.clock;
    const schedule = read.task.contract.schedule;
    const hot = signals.get(read.task.id);
    const deadline = routineTaskDeadlineMs(read.task, clock, hot);
    out.set(read.task.id, {
      kind: "READ",
      lastSucceededAt: clock?.lastSucceededObservedAt ?? clock?.lastSucceededAt ?? null,
      lastAttemptedAt: clock?.lastAttemptedAt ?? null,
      requiredEveryMs: schedule?.kind === "SITTING_WINDOW" ? sittingWindowRereadMs(schedule, hot) : cadenceMsAt(read.task.contract, nowMs),
      nextReadDueAt: deadline !== undefined && Number.isFinite(deadline) ? new Date(deadline).toISOString() : null,
    });
  }
  return out;
}

export const ASK_GAP_READING_BOUND_MS = 90_000;

interface ReadingOptions {
  readonly now: string;
  readonly state?: string;
  readonly readMeetings?: (now: string) => Promise<MeetingsProjectionReadResult>;
  readonly readOutcomes?: () => Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }>;
  readonly readClock?: (task: RoutineSourceTask) => Promise<RoutineTaskClock | undefined>;
  readonly boundMs?: number;
}

export async function readAskGapHoldings(options: ReadingOptions): Promise<AskGapHoldingsReading> {
  const boundMs = options.boundMs ?? ASK_GAP_READING_BOUND_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<AskGapHoldingsReading>((resolve) => {
    timer = setTimeout(
      () => resolve({ unreadable: `the held reading did not finish within ${Math.round(boundMs / 1000)} s, so no gap is decided on it this cycle` }),
      boundMs,
    );
  });
  try {
    return await Promise.race([takeReading(options), bound]);
  } finally {
    clearTimeout(timer);
  }
}

async function takeReading(options: ReadingOptions): Promise<AskGapHoldingsReading> {
  const nowMs = Date.parse(options.now);
  let meetings: MeetingsProjectionReadResult;
  try {
    meetings = await (options.readMeetings ?? (now=>readHeldMeetings(now,options.state)))(options.now);
  } catch (error) {
    return { unreadable: `the meetings projection read threw (${message(error)})` };
  }
  if (meetings.kind !== "PROMOTED" && meetings.kind !== "BOOTSTRAP") {
    return { unreadable: `the meetings projection is ${meetings.kind}: ${meetings.detail}` };
  }
  const outcomes = await (options.readOutcomes ?? (()=>readHeldOutcomes(options.state)))().catch((error: unknown) => ({ sittings: [], unreadable: message(error) }));

  let clocks: ReadonlyMap<string, CarrierClock>;
  try {
    const readClock = options.readClock ?? (() => {

      const store = new PostgresRoutineDataStore();
      return (task: RoutineSourceTask) => store.clock(task.sourceId, task.recordClass, task.scope);
    })();
    clocks = carrierClocks(await readRoutineTaskClocks(askGapCarrierTasks().filter(task=>!options.state || task.scope.startsWith(`US-${options.state.toUpperCase()}:`)), readClock), nowMs);
  } catch (error) {
    const why = `the routine clocks could not be read (${message(error)})`;
    clocks = new Map(askGapCarrierTasks().map((task) => [task.id, { kind: "UNREAD", why } as const]));
  }

  return {
    source: `the held meetings (${meetings.kind === "PROMOTED" ? meetings.detail : `${meetings.kind}: ${meetings.detail}`}) and the recorded outcomes Ask reads`,
    meetings: meetings.value.meetings as readonly AskGapMeeting[],
    documents: meetings.value.agendaDocuments as readonly AgendaDocumentLike[],
    sittings: outcomes.sittings,
    outcomesUnreadable: outcomes.unreadable,
    clockOf: (contractId) => clocks.get(contractId) ?? { kind: "UNREAD", why: `no routine task ${contractId} is registered, so no clock was read for it` },
  };
}

export async function askGapsInputFromHeld(
  options: ReadingOptions & { readonly observations?: Pick<AggregateRepository<AskGapObservation>, "list"> },
): Promise<AskGapsInput> {
  const [reading, observed] = await Promise.all([
    readAskGapHoldings(options),
    options.observations ? readAskGapObservations(options.observations) : Promise.resolve(null),
  ]);
  return { holdings: () => reading, ...(observed !== null ? { observations: () => observed } : {}) };
}
