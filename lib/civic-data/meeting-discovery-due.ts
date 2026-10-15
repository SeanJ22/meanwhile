import type { RoutineTaskClock } from "./runner.ts";

export type MeetingDiscoveryInputs = ReadonlyMap<string, string>;
/** Only timestamps are read; national discovery payloads stay in their state jobs. */
export async function readMeetingDiscoveryInputs(query: (sql: string, params: unknown[]) => Promise<unknown>): Promise<MeetingDiscoveryInputs> {
  const rows = await query(`SELECT upper(record->>'stateCode') AS state, max(record->>'finishedAt') AS found_at
    FROM cp_log_discovery_attempts WHERE record->>'outcome' = 'FOUND'
    AND jsonb_array_length(coalesce(record->'found', '[]'::jsonb)) > 0
    GROUP BY upper(record->>'stateCode')`, []);
  if (!Array.isArray(rows)) throw new Error("Meeting discovery inputs could not be read");
  const result = new Map<string, string>();
  for (const row of rows) {
    if (!/^[A-Z]{2}$/.test(row.state ?? "") || !Number.isFinite(Date.parse(row.found_at))) throw new Error("Meeting discovery inputs have an invalid state or date");
    result.set(row.state, row.found_at);
  }
  return result;
}
export function meetingDiscoveryInputsDue(taskId: string, clock: RoutineTaskClock | undefined, inputs: MeetingDiscoveryInputs | null, nowMs: number): boolean {
  if (!inputs) return false;
  const global = taskId === "meeting-body-crosswalk-derived" || taskId === "meeting-source-wiring";
  const state = /^meetings:derived:US-([A-Z]{2})$/.exec(taskId)?.[1];
  if (!global && !state) return false;
  const last = Date.parse(clock?.lastAttemptedAt ?? "");
  const found = global ? [...inputs.values()] : [inputs.get(state!) ?? ""];
  return found.some(at => Number.isFinite(Date.parse(at)) && Date.parse(at) <= nowMs && (!Number.isFinite(last) || Date.parse(at) > last));
}
/** Crosswalk then wiring settle before families read the newly promoted routes. */
export async function runMeetingDiscoveryChain<T extends { id: string }, R>(tasks: readonly T[], run: (tasks: readonly T[]) => Promise<readonly R[]>): Promise<readonly R[]> {
  const derives = ["meeting-body-crosswalk-derived", "meeting-source-wiring"];
  const independent = tasks.filter(task => !derives.includes(task.id) && !task.id.startsWith("meetings:derived:"));
  const independentRun = independent.length ? run(independent) : Promise.resolve([]);
  const chainRun = (async () => {
    const results: R[] = [];
    for (const id of derives) {
      const task = tasks.find(task => task.id === id);
      if (task) results.push(...await run([task]));
    }
    const families = tasks.filter(task => task.id.startsWith("meetings:derived:"));
    if (families.length) results.push(...await run(families));
    return results;
  })();
  const [other, chain] = await Promise.all([independentRun, chainRun]);
  return [...other, ...chain];
}
