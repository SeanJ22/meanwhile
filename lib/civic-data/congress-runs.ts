import type { BoundedChildResult } from "./bounded-child-pass.ts";
import type { StateCalendarGroup } from "./state-calendars.ts";

export interface CongressRunGroup<T> { readonly kind: "CONGRESS_DIRECTORY"; readonly id: "congress-bulk-roster"; readonly members: readonly T[] }

/** All due place projections take one memory turn and one national source acquisition. */
export function groupCongressReads<T extends { readonly id: string; readonly kind: string }>(runs: readonly (T | StateCalendarGroup<T>)[]): (T | StateCalendarGroup<T> | CongressRunGroup<T>)[] {
  const members = runs.filter((run): run is T => run.kind !== "STATE_CALENDARS" && /^congress-bulk-roster:[A-Z]{2}$/.test(run.id));
  if (!members.length) return [...runs];
  return runs.flatMap((run): (T | StateCalendarGroup<T> | CongressRunGroup<T>)[] => run === members[0]
    ? [{ kind: "CONGRESS_DIRECTORY", id: "congress-bulk-roster", members }]
    : members.some(member => member === run) ? [] : [run]);
}

/** The child prints one final receipt per place; an unreached place retains its due turn. */
export function congressMemberResults(run: BoundedChildResult, ids: readonly string[], started: boolean): readonly { readonly id: string; readonly run?: BoundedChildResult; readonly owed?: string }[] {
  const receipts = new Map<string, { line: string; status: number }>();
  for (const line of run.stdout.split(/\r?\n/)) {
    if (!line.startsWith("RCD_RECEIPT=")) continue;
    try {
      const receipt = JSON.parse(line.slice("RCD_RECEIPT=".length));
      if (typeof receipt.source === "string") receipts.set(receipt.source, { line,
        status: receipt.acquisitionSucceeded === true && receipt.state === "PROMOTED" && receipt.decision === "GOOD" ? 0 : 1 });
    }
    catch { /* A missing valid receipt leaves that place owed. */ }
  }
  return ids.map(id => receipts.has(id) ? { id, run: { ...run, id, stdout: receipts.get(id)!.line, stderr: "", status: receipts.get(id)!.status,
    signal: null, termination: "EXITED", errorMessage: null } }
    : { id, owed: started ? `National Congress read ended before ${id} produced its receipt: ${run.errorMessage ?? run.termination}` : run.errorMessage ?? "National Congress read did not start" });
}
