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
import { heldBodyGaps, type HeldAskGap } from "../../ask/held-gaps.ts";
import { readMeetingBodies, type StateMeetingBody } from "../../meetings/edge-serving.ts";
import type { MeetingsSnapshot } from "../../meetings/snapshot.ts";
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted, outcomePointers, readDoorOutcomeProjection } from "../../outcomes/store.ts";
import type { PersistedSittingOutcomes } from "../../outcomes/types.ts";
import { foldAskGapObservations, readAskGapObservations, type AskGapObservation } from "../ask-gap-observations.ts";
import type { AggregateRepository } from "../repository/types.ts";
import type { AskGapHoldingsReading, AskGapsInput, CarrierClock } from "./providers/ask-gaps.ts";

export function askGapCarrierTasks(): readonly RoutineSourceTask[] {
  return ROUTINE_SOURCE_TASKS.filter((task) => task.recordClass === "MEETING" || task.recordClass === "MEETING_OUTCOME");
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function readHeldBodies(state?: string): AsyncGenerator<StateMeetingBody> {
  return readMeetingBodies({ window: "HELD", ...(state ? { states: [state.toUpperCase()] } : {}) });
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
  readonly readBodies?: () => AsyncIterable<{ readonly bodyId: string; readonly load: () => Promise<{ readonly snapshot: MeetingsSnapshot } | null> }>;
  /** Bodies readers were told we hold no meeting of; their meeting counts are kept. */
  readonly toldNoMeetings?: ReadonlySet<string>;
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
  const outcomes = await (options.readOutcomes ?? (() => readHeldOutcomes(options.state)))().catch((error: unknown) => ({ sittings: [], unreadable: message(error) }));
  const sittingsByBody = new Map<string, PersistedSittingOutcomes[]>();
  for (const sitting of outcomes.sittings) if (sitting.bodyId) sittingsByBody.set(sitting.bodyId, [...sittingsByBody.get(sitting.bodyId) ?? [], sitting]);

  const bodies: { readonly bodyId: string; readonly gaps: readonly HeldAskGap[] }[] = [];
  const counts = new Map<string, number>();
  try {
    for await (const body of (options.readBodies ?? (() => readHeldBodies(options.state)))()) {
      const read = await body.load();
      if (read === null) return { unreadable: `the meetings of ${body.bodyId} could not be read, so no gap is decided on this cycle` };
      const { meetings, agendaDocuments } = read.snapshot;
      if (options.toldNoMeetings?.has(body.bodyId)) counts.set(body.bodyId, meetings.length);
      const held = heldBodyGaps({ bodyId: body.bodyId, meetings, documents: agendaDocuments, sittings: sittingsByBody.get(body.bodyId) ?? [], now: nowMs, outcomesUnavailable: outcomes.unreadable !== null });
      if (held.gaps.length > 0) bodies.push({ bodyId: body.bodyId, gaps: held.gaps });
    }
  } catch (error) {
    return { unreadable: `the meetings projection read threw (${message(error)})` };
  }

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
    source: "the held meetings of every state and the recorded outcomes Ask reads",
    bodies,
    meetingCountOf: (bodyId) => counts.get(bodyId) ?? 0,
    outcomesUnreadable: outcomes.unreadable,
    clockOf: (contractId) => clocks.get(contractId) ?? { kind: "UNREAD", why: `no routine task ${contractId} is registered, so no clock was read for it` },
  };
}

export async function askGapsInputFromHeld(
  options: ReadingOptions & { readonly observations?: Pick<AggregateRepository<AskGapObservation>, "list"> },
): Promise<AskGapsInput> {
  const observed = options.observations ? await readAskGapObservations(options.observations) : null;
  const told = observed !== null && !("unreadable" in observed)
    ? new Set([...foldAskGapObservations(observed.rows, options.now).asked.values()].filter((gap) => gap.code === "MEETINGS_NOT_HELD").map((gap) => gap.bodyId))
    : new Set<string>();
  const reading = await readAskGapHoldings({ ...options, toldNoMeetings: told });
  return { holdings: () => reading, ...(observed !== null ? { observations: () => observed } : {}) };
}
