/**
 * **WHAT THE `ask-gaps` PROVIDER READS, TAKEN ONCE A CYCLE.** (2026-09-25.)
 *
 * The provider is pure and synchronous (`providers/ask-gaps.ts`); this is its
 * I/O. Three readings, each the one Ask itself reads, and nothing about any
 * reader:
 *
 * ```
 *   meetings + agenda documents   the reader edge artifacts Ask reads, when the
 *                                 edge answers whole; otherwise the prepared
 *                                 reader row they are published from
 *                                 (lib/meetings/prepared-snapshot.ts)
 *   recorded outcomes             the outcome store Ask reads (lib/outcomes/store.ts)
 *   carrying clocks               every MEETING and MEETING_OUTCOME routine
 *                                 task's durable clock, the same read the
 *                                 routine runner admits on, and its sitting
 *                                 window decided from those clocks
 * ```
 *
 * A reading that cannot be taken whole is named, never shrunk: a partial edge
 * read falls back to the prepared row, an unreadable meetings reading makes
 * the provider report a read failure (so no gap retires on it), and an
 * unreadable clock is carried as UNREAD for that one contract.
 *
 * Read-only. It never writes a store, never opens a publisher's feed, and
 * never reads Ask's question log. Beside the holdings it may read the counts
 * of gaps readers were told (`ask-gap-observations.ts`): a body, a code, a day
 * and a number each, never a question or a reader.
 */

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
import { getOutcomeSnapshot, loadedFrom, outcomeProjectionReadState, readOutcomeProjection } from "../../outcomes/store.ts";
import type { PersistedSittingOutcomes } from "../../outcomes/types.ts";
import type { AgendaDocumentLike } from "../../routing/agenda-search.ts";
import { readAskGapObservations, type AskGapObservation } from "../ask-gap-observations.ts";
import type { AggregateRepository } from "../repository/types.ts";
import type { AskGapHoldingsReading, AskGapMeeting, AskGapsInput, CarrierClock } from "./providers/ask-gaps.ts";

/** The tasks whose reads can close an Ask gap: every meeting partition and every recorded-outcome routine. */
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
    await readOutcomeProjection();
  } catch (error) {
    return { sittings: [], unreadable: message(error) };
  }
  if (loadedFrom() === "EMPTY_STORE") {
    const state = outcomeProjectionReadState();
    return { sittings: [], unreadable: `${state.kind}${"detail" in state && state.detail ? `: ${state.detail}` : ""}` };
  }
  return { sittings: getOutcomeSnapshot().sittings, unreadable: null };
}

/** Each carrying task's clock, as the provider reads it, from one pass of clock reads at `now`. */
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

/**
 * The whole reading's bound. A read that hangs is named and the cycle goes on
 * without Ask gaps, rather than holding the registry, and every other
 * provider's work, to the cycle's wall.
 */
export const ASK_GAP_READING_BOUND_MS = 90_000;

interface ReadingOptions {
  readonly now: string;
  readonly readMeetings?: (now: string) => Promise<MeetingsProjectionReadResult>;
  readonly readOutcomes?: () => Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }>;
  readonly readClock?: (task: RoutineSourceTask) => Promise<RoutineTaskClock | undefined>;
  readonly boundMs?: number;
}

/**
 * Take the provider's reading. Never throws and never outlasts its bound: a
 * failure is the reading's `unreadable`, which the provider reports as its
 * read failure.
 */
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

/**
 * The provider's input from one reading, for the runner's registry:
 * `askGapsProvider(await askGapsInputFromHeld({ now, observations }))`. With
 * `observations` (the control plane's `askGapObservations` repository), the
 * counts of what readers were told are read beside the holdings; a failed read
 * is the provider's named read failure, never an empty count.
 */
export async function askGapsInputFromHeld(
  options: ReadingOptions & { readonly observations?: Pick<AggregateRepository<AskGapObservation>, "list"> },
): Promise<AskGapsInput> {
  const [reading, observed] = await Promise.all([
    readAskGapHoldings(options),
    options.observations ? readAskGapObservations(options.observations) : Promise.resolve(null),
  ]);
  return { holdings: () => reading, ...(observed !== null ? { observations: () => observed } : {}) };
}
