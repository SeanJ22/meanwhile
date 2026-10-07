/**
 * Which meeting partitions are hot right now: a sitting in the next seven days
 * or held in the last seven, by the publisher's stated end where one exists.
 * A partition whose sittings cannot be read counts as hot.
 */
import { readRoutineTaskClocks, routineTaskFromContract, sittingWindowSignals, type RoutineTaskClock, type RoutineSourceTask } from "../civic-data/runner.ts";
import { statedSittingEndsByScope, statedSittingEndsRead } from "../civic-data/sitting-window-admission.ts";
import { MEETING_PARTITION_CONTRACTS } from "../civic-data/meeting-partitions.ts";

export interface HotPartitionReads {
  readonly readClock: (task: RoutineSourceTask) => Promise<RoutineTaskClock | undefined>;
  /** Where the publisher-stated sitting ends are read from; a failed read leaves the day bound to decide. */
  readonly db: Parameters<typeof statedSittingEndsRead>[0];
}

export async function hotMeetingPartitions(reads: HotPartitionReads, nowMs: number): Promise<ReadonlySet<string>> {
  const tasks = MEETING_PARTITION_CONTRACTS.map(routineTaskFromContract);
  const clocks = await readRoutineTaskClocks(tasks, reads.readClock);
  let ends: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();
  try {
    const byScope = statedSittingEndsByScope(await statedSittingEndsRead(reads.db));
    ends = new Map(tasks.flatMap((task) => byScope.has(task.scope) ? [[task.id, byScope.get(task.scope)!] as const] : []));
  } catch {
    // The day bound decides, as in the routine pass.
  }
  return new Set([...sittingWindowSignals(clocks, nowMs, ends)].filter(([, hot]) => hot !== false).map(([id]) => id));
}
