/** An assignment is complete only when every member obligation passes the completion evaluator. */
import assert from "node:assert/strict";
import test from "node:test";

import { assignmentCompletionWords, evaluateAssignmentCompletion, memberObligations } from "../lib/control-plane/assignment-completion.ts";
import type { CompletionSnapshot } from "../lib/control-plane/completion.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const NOW = "2026-09-25T12:00:00.000Z";
const PAST = "2026-09-18T12:00:00.000Z";

/* ------------------------------------------------------------ visited is not finished */

function snapshotFor(state: "DONE" | "OUTSTANDING"): CompletionSnapshot {
  const item: WorkItem = {
    id: `wi-${state}`, project: "freshness", subject: "s", obligation: "o", why: "fixture", priority: "P2", state: "OPEN",
    contract: { inheritedRouteFloor: [], requiresValidation: false, requiresAudit: false, requiresCompleteDenominator: false, acceptableDispositions: null, instrumentEvidence: null },
    dependencies: [], routeTaskIds: [], escalations: [], createdAt: PAST, transitions: [],
  };
  const task = { id: `rt-${state}`, workItemId: item.id, routeId: "r", routeLabel: "r", target: "t", inherited: true, state: state === "DONE" ? "DISPOSED" : "PENDING", disposition: state === "DONE" ? { disposition: "INGESTED" } : null, attemptIds: [], createdAt: PAST } as unknown as RouteTask;
  return { item, routeTasks: [task], validations: [], audits: [], contradictions: [], upstreamStates: new Map(), denominatorComplete: null, instrumentGreens: new Set(), now: NOW };
}

test("MW-015: an assignment is COMPLETE only when no member is refused or unsettled, and lists what remains", () => {
  const key = "scope:county:04019";
  const member = (id: string, keys: readonly string[]) => ({ id, assignments: keys.map((k) => ({ assignmentKey: k, relation: "CREATED_FOR", at: PAST })) });
  const obligations = [member("ob-a", [key]), member("ob-b", [key, "scope:state:az"]), member("ob-c", ["scope:state:az"]), { id: "ob-legacy" }];
  assert.deepEqual(memberObligations(obligations, key).map((o) => o.id), ["ob-a", "ob-b"]);

  const done = evaluateAssignmentCompletion({ assignmentKey: key, obligations, snapshotFor: () => snapshotFor("DONE") });
  assert.equal(done.kind, "COMPLETE");

  const visited = evaluateAssignmentCompletion({ assignmentKey: key, obligations, snapshotFor: (id) => (id === "ob-a" ? snapshotFor("DONE") : snapshotFor("OUTSTANDING")) });
  assert.equal(visited.kind, "NOT_COMPLETE");
  if (visited.kind !== "NOT_COMPLETE") throw new Error("unreachable");
  assert.equal(visited.settled, 1);
  assert.deepEqual(visited.exceptions.map((e) => [e.obligationId, e.kind, e.codes]), [["ob-b", "REFUSED", ["ROUTE_TASK_STILL_OUTSTANDING"]]]);
  assert.match(assignmentCompletionWords(visited), /^Not complete: 1 of 2 member obligations passed the completion check; 1 refused and 0 not yet settled remain\.$/);

  const unread = evaluateAssignmentCompletion({ assignmentKey: key, obligations, snapshotFor: (id) => (id === "ob-a" ? snapshotFor("DONE") : null) });
  assert.equal(unread.kind === "NOT_COMPLETE" && unread.exceptions[0]!.kind, "UNSETTLED", "a member not read is unsettled, never assumed done");

  assert.equal(evaluateAssignmentCompletion({ assignmentKey: "scope:nowhere", obligations, snapshotFor: () => snapshotFor("DONE") }).kind, "NO_MEMBERS", "an empty set is never complete");
});
