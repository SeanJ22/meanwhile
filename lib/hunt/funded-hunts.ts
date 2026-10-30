import type { OrderMark, WorkList } from "../core/work.ts";
import { workStateOf } from "../core/work-kinds.ts";
import { assignmentEntry, type DispatchWorkTarget } from "../control-plane/expansion/dispatch-work.ts";
import { huntPacketObligationId } from "./packet.ts";

/** A place Sean's money was pointed at, with the Sends that pointed it. */
export interface FundedHunt { readonly placeId: string; readonly state: string; readonly priority: number; readonly marks: readonly OrderMark[] }

/**
 * Every government a funded Send reaches gets a hunt that paid workers may take. The Send's mark carries its own start time, so the
 * same Send read again next round is the same mark. A place Sean ordered higher is served first.
 */
export function fundedHunts(input: {
  readonly targets: readonly DispatchWorkTarget[];
  readonly divisions: ReadonlyMap<string, readonly string[]>;
  readonly state: string;
  /** Where Sean's order puts a government among the places he reordered; null when he did not. */
  readonly rank: (governmentId: string) => number | null;
  /** The Sends a stop already ended at each government: the same Send never restarts what it stopped. */
  readonly ended: ReadonlyMap<string, readonly OrderMark[]>;
}): FundedHunt[] {
  const hunts: FundedHunt[] = [];
  for (const target of input.targets) {
    const mark = assignmentEntry(target, "CREATED", target.requestedAt);
    for (const placeId of input.divisions.get(target.key) ?? []) {
      if (input.ended.get(placeId)?.some(done => done.assignmentKey === mark.assignmentKey && done.ref === mark.ref)) continue;
      const rank = input.rank(placeId);
      hunts.push({ placeId, state: workStateOf(input.state), priority: rank === null ? 0 : 1_000_000 - rank, marks: [mark] });
    }
  }
  return hunts;
}

/** The hunts as the obligations their money is counted under: what a Send's budget and its members are measured by, funded now or not. */
export async function fundedMembers(list: WorkList, planningState: string): Promise<readonly { readonly id: string; readonly subjectId: string; readonly assignments: readonly OrderMark[] }[]> {
  return (await list.orderHunts(workStateOf(planningState))).map(hunt => ({ id: huntPacketObligationId(hunt.placeId), subjectId: hunt.placeId, assignments: [...hunt.marks, ...hunt.ended] }));
}

/** A place whose money is gone goes back to free work. Its Sends stay on it, so funding them again brings the hunt back. */
export async function demoteUnfunded(list: WorkList, planningState: string, fundedRefs: readonly string[]): Promise<number> {
  return list.demote((await list.orderHunts(workStateOf(planningState))).filter(hunt => hunt.funded && !hunt.marks.some(mark => fundedRefs.includes(mark.ref))));
}

/** The Sends a stop order has reached at each government. */
export async function endedHunts(list: WorkList, planningState: string): Promise<ReadonlyMap<string, readonly OrderMark[]>> {
  return new Map((await list.orderHunts(workStateOf(planningState))).filter(hunt => hunt.ended.length > 0).map(hunt => [hunt.placeId, hunt.ended] as const));
}
