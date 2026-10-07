/** The `ask-gaps` provider's I/O, read once a cycle. Read-only; a reading that cannot be taken whole is named, never shrunk. */

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
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../../outcomes/store.ts";
import type { PersistedSittingOutcomes } from "../../outcomes/types.ts";
import type { AgendaDocumentLike } from "../../routing/agenda-search.ts";
import { readAskGapObservations, type AskGapObservation } from "../ask-gap-observations.ts";
import type { AggregateRepository } from "../repository/types.ts";
import type { AskGapHoldingsReading, AskGapMeeting, AskGapsInput, CarrierClock } from "./providers/ask-gaps.ts";

export const ASK_GAP_CARRIER_TASKS: readonly RoutineSourceTask[] = ROUTINE_SOURCE_TASKS.filter(
  (task) => task.recordClass === "MEETING" || task.recordClass === "MEETING_OUTCOME",
);

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The meetings Ask reads: the edge when it answers whole, otherwise the prepared reader row. */
async function readHeldMeetings(now: string): Promise<MeetingsProjectionReadResult> {
  const prepared = () => readPreparedMeetingsProjection({ now });
  let fellBack = false;
  const edge = await readReaderEdgeMeetings({
    now,
    window: "HELD",
    store: resolveReaderArtifactWriteStore(),
    fallback: () => {
      fellBack = true;
      return prepared();
    },
  });
  // An edge read that fetched only some of its scopes would drop bodies, and a dropped body's gaps would retire.
  if (!fellBack && edge.kind === "PROMOTED" && edge.metadata.stale !== "CURRENT") return prepared();
  return edge;
}

/** The recorded outcomes Ask reads, and whether they could be read (Ask's own test: an empty store is unreadable). */
async function readHeldOutcomes(): Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }> {
  try {
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

/** The whole reading's bound: a hung read is named and the cycle continues without Ask gaps. */
export const ASK_GAP_READING_BOUND_MS = 90_000;

interface ReadingOptions {
  readonly now: string;
  readonly readMeetings?: (now: string) => Promise<MeetingsProjectionReadResult>;
  readonly readOutcomes?: () => Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }>;
  readonly readClock?: (task: RoutineSourceTask) => Promise<RoutineTaskClock | undefined>;
  readonly boundMs?: number;
}

/** Never throws and never outlasts its bound; a failure is the reading's `unreadable`. */
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
    meetings = await (options.readMeetings ?? readHeldMeetings)(options.now);
  } catch (error) {
    return { unreadable: `the meetings projection read threw (${message(error)})` };
  }
  if (meetings.kind !== "PROMOTED" && meetings.kind !== "BOOTSTRAP") {
    return { unreadable: `the meetings projection is ${meetings.kind}: ${meetings.detail}` };
  }
  const outcomes = await (options.readOutcomes ?? readHeldOutcomes)().catch((error: unknown) => ({ sittings: [], unreadable: message(error) }));

  let clocks: ReadonlyMap<string, CarrierClock>;
  try {
    const readClock = options.readClock ?? (() => {
      // Constructed here: the store binds its connection on construction, which throws when none is configured.
      const store = new PostgresRoutineDataStore();
      return (task: RoutineSourceTask) => store.clock(task.sourceId, task.recordClass, task.scope);
    })();
    clocks = carrierClocks(await readRoutineTaskClocks(ASK_GAP_CARRIER_TASKS, readClock), nowMs);
  } catch (error) {
    const why = `the routine clocks could not be read (${message(error)})`;
    clocks = new Map(ASK_GAP_CARRIER_TASKS.map((task) => [task.id, { kind: "UNREAD", why } as const]));
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
