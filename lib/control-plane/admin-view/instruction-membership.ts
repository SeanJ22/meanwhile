import type { AssignmentIndexRow, AssignmentListRow, AssignmentState, AssignmentView, BodyPublicationAttempt } from "../assignment-view.ts";
import { ASSIGNMENT_STATES } from "../assignment-view.ts";
import { instructionReceiptKey } from "../scheduler/obligation.ts";

/** An active instruction is its immutable receipt, never its geography key
 * alone. A prior snapshot without receipt fields cannot establish zero. */
export function exactInstructionMembership(view: AssignmentView | null, key: string, receiptId: string): {
  readonly index: readonly AssignmentIndexRow[] | null;
  readonly rows: readonly AssignmentListRow[];
  readonly counts: Readonly<Record<AssignmentState, number>> | null;
  readonly bodyAttempts: readonly BodyPublicationAttempt[] | null;
} {
  const identity=instructionReceiptKey(key,receiptId);
  const indexed=view?.allRowsIndex;
  const currentIndex=indexed && indexed.every(row=>row.assignmentRefs!==undefined && row.instructionStates!==undefined)
    ? indexed.filter(row=>row.assignmentRefs?.some(mark=>mark.key===key&&mark.ref===receiptId))
      .map(row=>({...row,state:row.instructionStates?.[identity]??"UNKNOWN"})) : null;
  const stateById=new Map((currentIndex??[]).map(row=>[row.id,row.state] as const));
  const rows=currentIndex===null?[]:(view?.rows??[]).filter(row=>stateById.has(row.id))
    .map(row=>({...row,state:stateById.get(row.id)!}));
  const allCounts=view?.instructionCountsByReceipt;
  const counts=currentIndex===null || allCounts===undefined ? null : allCounts[identity] ??
    Object.fromEntries(ASSIGNMENT_STATES.map(state=>[state,0])) as Record<AssignmentState,number>;
  const attempts=view?.bodyAttempts;
  const bodyAttempts=attempts===undefined || attempts.some(row=>row.assignmentRefs===undefined)
    ? null : attempts.filter(row=>row.assignmentRefs?.some(mark=>mark.key===key&&mark.ref===receiptId));
  return {index:currentIndex,rows,counts,bodyAttempts};
}
