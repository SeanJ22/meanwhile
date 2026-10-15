import { cadenceMsAt, sittingWindowRereadMs } from "../../civic-data/contracts.ts";
import { routineScopeState } from "../../civic-data/state-scope.ts";
import { readPromotedCivicData } from "../../civic-data/read-model.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionOfId } from "../../civic-data/meeting-partitions.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import {
  ROUTINE_SOURCE_TASKS,
  readRoutineTaskClocks,
  routineTaskDeadlineMs,
  sittingWindowSignals,
  type RoutineSourceTask,
  type RoutineTaskClock,
} from "../../civic-data/runner.ts";
import { readPreparedMeetingPublication } from "../../meetings/prepared-snapshot.ts";
import { applyMeetingFreshChecks } from "../../meetings/fresh-checks.ts";
import type { MeetingsProjectionReadResult } from "../../meetings/snapshot.ts";
import { outcomePointers } from "../../outcomes/store.ts";
import { doorOutcomeScopeIssue } from "../../outcomes/door-outcome-pointers.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../../outcomes/types.ts";
import type { AgendaDocumentLike } from "../../routing/agenda-search.ts";
import { readAskGapObservations, type AskGapObservation, type AskGapObservationReading } from "../ask-gap-observations.ts";
import type { AggregateRepository } from "../repository/types.ts";
import { askGapsProvider, type AskGapHoldingsReading, type AskGapMeeting, type CarrierClock } from "./providers/ask-gaps.ts";

/** The meeting and outcome tasks whose clocks Ask reads, from the doors installed now. */
export function askGapCarrierTasks(state?: string): readonly RoutineSourceTask[] {
  return ROUTINE_SOURCE_TASKS.filter(task => (task.recordClass === "MEETING" || task.recordClass === "MEETING_OUTCOME") &&
    (!state || routineScopeState(task.scope, task.command) === routineScopeState(state) ||
      task.contract.schedule?.follows?.some(body => routineScopeState(body.bodyId) === routineScopeState(state))));
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function readHeldOutcomes(bodyIds: readonly string[]): Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }> {
  const wanted = new Set(bodyIds);
  const carriers = new Set(askGapCarrierTasks().filter(task => task.recordClass === "MEETING_OUTCOME" &&
    task.contract.schedule?.follows?.some(body => wanted.has(body.bodyId))).map(task => task.id));
  const pointers = outcomePointers().filter(pointer => carriers.has(pointer.contractId));
  if (pointers.length !== carriers.size) return { sittings: [], unreadable: "an outcome carrier has no registered read pointer" };
  const sittings: PersistedSittingOutcomes[] = [];
  const failures: string[] = [];
  if (!pointers.length) return { sittings, unreadable: null };
  const store = new PostgresRoutineDataStore();
  for (const pointer of pointers) {
    const read = await readPromotedCivicData<OutcomeSnapshot>(pointer.recordClass, pointer.scope, { store, bypassCache: true });
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") { failures.push(`${pointer.contractId}: ${read.kind}: ${read.detail}`); continue; }
    const issue = doorOutcomeScopeIssue(pointer, read.value);
    if (issue) { failures.push(issue); continue; }
    sittings.push(...read.value.sittings.filter(sitting => sitting.bodyId !== null && wanted.has(sitting.bodyId)));
  }
  return { sittings, unreadable: failures.length ? failures.join("; ") : null };
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
  readonly state: string;
  readonly bodyIds?: readonly string[];
  readonly readMeetings: (now: string) => Promise<MeetingsProjectionReadResult>;
  readonly readOutcomes?: (bodyIds: readonly string[]) => Promise<{ readonly sittings: readonly PersistedSittingOutcomes[]; readonly unreadable: string | null }>;
  readonly readClocks?: Parameters<typeof readRoutineTaskClocks>[1];
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
    meetings = await options.readMeetings(options.now);
  } catch (error) {
    return { unreadable: `the meetings projection read threw (${message(error)})` };
  }
  if (meetings.kind !== "PROMOTED" && meetings.kind !== "BOOTSTRAP") {
    return { unreadable: `the meetings projection is ${meetings.kind}: ${meetings.detail}` };
  }
  const bodyIds = [...new Set([...(options.bodyIds ?? []), ...meetings.value.meetings.flatMap(meeting => meeting.bodyId ?? [])])];
  const wanted = new Set(bodyIds);
  const tasks = askGapCarrierTasks(options.state).filter(task => wanted.has(meetingPartitionOfId(task.id)?.bodyId ?? "") ||
    task.contract.schedule?.follows?.some(body => wanted.has(body.bodyId)));
  const outcomes = await (options.readOutcomes ?? readHeldOutcomes)(bodyIds).catch((error: unknown) => ({ sittings: [], unreadable: message(error) }));

  let clocks: ReadonlyMap<string, CarrierClock>;
  try {
    const readClocks = options.readClocks ?? (() => {
      // Constructed here: the store binds its connection on construction, which throws when none is configured.
      const store = new PostgresRoutineDataStore();
      return (tasks: readonly RoutineSourceTask[]) => store.clocks(tasks.map(task => ({ sourceId: task.sourceId, recordClass: task.recordClass, scope: task.scope })));
    })();
    clocks = carrierClocks(await readRoutineTaskClocks(tasks, readClocks), nowMs);
  } catch (error) {
    const why = `the routine clocks could not be read (${message(error)})`;
    clocks = new Map(tasks.map((task) => [task.id, { kind: "UNREAD", why } as const]));
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

async function boundedReading<T>(work: Promise<T>, boundMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the held reading did not finish within ${Math.round(boundMs / 1000)} s`)), boundMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function askGapsProviderFromHeld(options: {
  readonly now: string;
  readonly states: readonly string[];
  readonly observations?: Pick<AggregateRepository<AskGapObservation>, "list">;
  readonly readPrepared?: typeof readPreparedMeetingPublication;
  readonly readOutcomes?: ReadingOptions["readOutcomes"];
  readonly readClocks?: ReadingOptions["readClocks"];
  readonly boundMs?: number;
}): Promise<ReturnType<typeof askGapsProvider>> {
  const observed = options.observations ? await readAskGapObservations(options.observations) : null;
  const rows = observed && "rows" in observed ? observed.rows : [];
  const states = [...new Set([...options.states.map(state => routineScopeState(state)), ...rows.map(row => routineScopeState(row.bodyId))])].sort();
  const partitions = [...MEETING_PARTITION_CONTRACTS];
  const obligations: import("./registry.ts").ProvidedObligation[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  const add = (reading: AskGapHoldingsReading, observations: AskGapObservationReading | null) => {
    const result = askGapsProvider({ holdings: () => reading, registered: { partitions },
      ...(observations ? { observations: () => observations } : {}) }).enumerate({ root: ".", nowIso: options.now });
    obligations.push(...result.obligations);
    if (result.readFailure) failures.push(result.readFailure);
  };
  for (const state of states) {
    try {
      const prepared = await boundedReading((options.readPrepared ?? readPreparedMeetingPublication)({ now: options.now, state, partitions }), options.boundMs ?? ASK_GAP_READING_BOUND_MS);
      if (!prepared) { failures.push(`${state}: no prepared meeting reading is available`); continue; }
      const iterator = prepared.value.chunks[Symbol.asyncIterator]();
      let complete = true;
      while (true) {
        const next = await boundedReading(iterator.next(), options.boundMs ?? ASK_GAP_READING_BOUND_MS);
        if (next.done) break;
        const chunk = await boundedReading(next.value.read(), options.boundMs ?? ASK_GAP_READING_BOUND_MS);
        const bodyIds = [...new Set(chunk.snapshot.meetings.flatMap(meeting => meeting.bodyId ?? []))];
        bodyIds.forEach(id => seen.add(id));
        const bodySet = new Set(bodyIds);
        const reading = await readAskGapHoldings({ ...options, state, bodyIds,
          readMeetings: async () => ({ ...prepared, value: applyMeetingFreshChecks(chunk.snapshot, prepared.checks) }) });
        add(reading, observed && "rows" in observed ? { ...observed, rows: rows.filter(row => bodySet.has(row.bodyId)) } : observed);
        if ("unreadable" in reading) { complete = false; await iterator.return?.(); break; }
      }
      if (!complete) continue;
      const absent = rows.filter(row => routineScopeState(row.bodyId) === state && !seen.has(row.bodyId));
      if (absent.length) {
        const reading = await readAskGapHoldings({ ...options, state, bodyIds: absent.map(row => row.bodyId),
          readMeetings: async () => ({ ...prepared, value: { formatVersion: 1, generatedAt: prepared.value.generatedAt,
            counts: { fresh: 0, carried: 0, total: 0 }, sources: [], meetings: [], agendaDocuments: [] } }) });
        add(reading, { source: observed && "source" in observed ? observed.source : "Ask observations", rows: absent });
      }
    } catch (error) { failures.push(`${state}: the held meetings could not be read (${message(error)})`); }
  }
  if (!states.length) failures.push("no state was supplied for the held meeting reading");
  if (observed && "unreadable" in observed) failures.push(`the Ask-gap observations could not be read (${observed.unreadable})`);
  const provider = askGapsProvider();
  const result = { obligations, readFailure: failures.length ? [...new Set(failures)].join("; ") : null,
    emptyReason: !obligations.length && !failures.length ? `Held meetings in ${states.join(", ")} contain no Ask gap.` : null };
  return { ...provider, enumerate: () => result };
}
