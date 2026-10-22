/**
 * One calendar program per state: the runner groups each state's due board reads into one child, which loads the
 * state's data and door list once and reads each board in turn. Each board still gets its own receipt, clock and LKG.
 */
import type { BoundedChildResult } from "./bounded-child-pass.ts";
import { meetingPartitionContract, type MeetingPartitionContract } from "./meeting-partitions.ts";
import { RuntimeAuthorityRefused, assertRegisteredRuntimeContract, assertRuntimeAuthority, runtimeAuthorityEnvelope } from "./runtime-authority.ts";
import { statesForRegistryDivisions } from "./state-scopes.ts";

export const STATE_CALENDARS_PREFIX = "meetings-state:";
export const stateCalendarsId = (state: string): string => `${STATE_CALENDARS_PREFIX}${state}`;

/** The one state a board belongs to; null when its identity names none or several. */
export function meetingPartitionState(partition: Pick<MeetingPartitionContract, "derivedFamily" | "ocdId" | "bodyId">): string | null {
  const states = statesForRegistryDivisions([partition.derivedFamily ?? "", partition.ocdId ?? "", partition.bodyId]);
  return states.length === 1 ? states[0]! : null;
}

/** A state calendar program's authority covers exactly the registered boards of its own state. */
export function stateCalendarsCovers(authorityContract: string | null, partitionId: string): boolean {
  const partition = meetingPartitionContract(partitionId);
  const state = partition === null ? null : meetingPartitionState(partition);
  return state !== null && authorityContract === stateCalendarsId(state);
}

export function assertMeetingPartitionAuthority(partitionId: string, env: Readonly<Record<string, string | undefined>> = process.env): void {
  const envelope = runtimeAuthorityEnvelope(env);
  if (envelope?.capability !== "STATE_CALENDARS") return assertRegisteredRuntimeContract(partitionId, "routine", env);
  assertRuntimeAuthority({ capabilities: ["STATE_CALENDARS"] }, env);
  if (!stateCalendarsCovers(envelope.contract, partitionId)) {
    throw new RuntimeAuthorityRefused(`admitted ${envelope.contract ?? "no state"} does not cover ${partitionId}`);
  }
}

/** Boards of one upstream are spread through a state's list, so each waits as little as possible for its host's gap. */
export function calendarReadOrder<T extends { readonly acquisitionFailureDomain: string }>(reads: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return reads.map((read, index) => {
    const turn = seen.get(read.acquisitionFailureDomain) ?? 0;
    seen.set(read.acquisitionFailureDomain, turn + 1);
    return { read, index, turn };
  }).sort((a, b) => a.turn - b.turn || a.index - b.index).map(({ read }) => read);
}

export interface StateCalendarGroup<T> {
  readonly kind: "STATE_CALENDARS";
  readonly id: string;
  readonly state: string;
  /** In the order the program reads them. */
  readonly members: readonly T[];
  readonly command: readonly string[];
}

/**
 * Due board reads become one program per state, placed where the state's first read stood in the launch order.
 * Derived families keep their place in the discovery chain, and a board whose state cannot be told runs alone.
 */
export function groupCalendarReadsByState<T extends { readonly id: string; readonly kind: string; readonly task: { readonly acquisitionFailureDomain: string } }>(
  runs: readonly T[],
): (T | StateCalendarGroup<T>)[] {
  const byState = new Map<string, T[]>();
  const units: (T | string)[] = [];
  for (const run of runs) {
    const partition = run.kind === "MEETING_PARTITION" ? meetingPartitionContract(run.id) : null;
    const state = partition === null || partition.derivedFamily !== null ? null : meetingPartitionState(partition);
    if (state === null) { units.push(run); continue; }
    if (!byState.has(state)) { byState.set(state, []); units.push(state); }
    byState.get(state)!.push(run);
  }
  return units.map((unit) => {
    if (typeof unit !== "string") return unit;
    const members = calendarReadOrder(byState.get(unit)!.map((run) => ({ run, acquisitionFailureDomain: run.task.acquisitionFailureDomain }))).map(({ run }) => run);
    return { kind: "STATE_CALENDARS" as const, id: stateCalendarsId(unit), state: unit, members,
      command: ["scripts/ingest.ts", "composite", "--promote", ...members.map((member) => `--only-partition=${member.id}`)] };
  });
}

export type StateCalendarMemberResult =
  | { readonly id: string; readonly run: BoundedChildResult }
  | { readonly id: string; readonly owed: string };

function namedLines(output: string, prefix: string): Map<string, string> {
  const named = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(line.slice(prefix.length)) as { source?: unknown; partitionId?: unknown; detail?: unknown };
      const id = typeof value.source === "string" ? value.source : typeof value.partitionId === "string" ? value.partitionId : null;
      if (id !== null) named.set(id, prefix === "RCD_MEETING_PARTITION_UNREAD=" ? String(value.detail ?? "") : line);
    } catch { /* A malformed line names no board; the board is settled from what else the program said. */ }
  }
  return named;
}

/**
 * Each board's own result out of its state program's run, as if it had run alone: its receipt, the error that stopped
 * its read, or still owed (never started, or not reached before the pass deadline). A board the program was reading
 * when it ended any other way takes the program's own ending.
 */
export function stateCalendarMemberResults(run: BoundedChildResult, memberIds: readonly string[], started: boolean): StateCalendarMemberResult[] {
  if (!started) return memberIds.map((id) => ({ id, owed: run.errorMessage ?? "the state's calendar program did not start" }));
  const output = `${run.stdout}\n${run.stderr}`;
  const receipts = namedLines(output, "RCD_MEETING_PARTITION_RECEIPT=");
  const unread = namedLines(output, "RCD_MEETING_PARTITION_UNREAD=");
  const deferred = namedLines(output, "RCD_MEETING_PARTITION_DEFERRED=");
  const cutAtDeadline = run.termination === "TIMED_OUT" && /^PASS_TIME_BUDGET:/.test(run.errorMessage ?? "");
  let ending: string | null = null;
  return memberIds.map((id): StateCalendarMemberResult => {
    const ok = { id, signal: null, termination: "EXITED" as const, errorMessage: null, settlementErrorMessage: null };
    if (receipts.has(id)) return { id, run: { ...ok, status: 0, stdout: receipts.get(id)!, stderr: "" } };
    if (unread.has(id)) return { id, run: { ...ok, status: 1, stdout: "", stderr: unread.get(id)!, errorMessage: `the read of ${id} stopped with an error` } };
    if (deferred.has(id)) return { id, owed: "not started before the pass deadline" };
    if (cutAtDeadline) return { id, owed: run.errorMessage! };
    if (ending !== null) return { id, owed: `the state's calendar program ended while reading ${ending}` };
    ending = id;
    const stdout = run.stdout.split(/\r?\n/).filter((line) => !line.startsWith("RCD_MEETING_PARTITION_RECEIPT=")).join("\n");
    return { id, run: { ...run, id, stdout } };
  });
}
