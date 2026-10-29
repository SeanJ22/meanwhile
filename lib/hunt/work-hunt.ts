import { createWorkItem } from "../control-plane/work-item.ts";
import { registerRouteTask, registerWorkItem } from "../control-plane/repository/coordinator.ts";
import { createRouteTask } from "../control-plane/route-task.ts";
import { HUNT_PACKET_ROUTE_ID } from "./packet.ts";
import { huntPacketPlan } from "./packet-plan.ts";
import { workCostKindOf } from "../core/work-kinds.ts";
import type { WorkRow } from "../core/work.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { AskQuestion } from "../ask/question-work.ts";

/** What a hunt row carries when a research round planned a task the hunters already know: that task, and whether plain code can run it. */
export interface PlannedTask { readonly routeTaskId: string; readonly plain: boolean }

export function plannedTaskOf(row: Pick<WorkRow, "value">): PlannedTask | null {
  const value = row.value as Partial<PlannedTask> | null;
  return value !== null && typeof value === "object" && typeof value.routeTaskId === "string" ? { routeTaskId: value.routeTaskId, plain: value.plain === true } : null;
}

const WHY = { ask: "A reader asked a question that Meanwhile could not answer from its data.", reader: "A reader asked to get this sooner.",
  order: "Sean ordered this hunt.", planner: "Open blanks here changed since the last hunt." } as const;

/** The hunt a row stands for: the work item to run, and the plan that carries the reader's question when there is one. */
function huntOf(claim: WorkRow, now: string) {
  const workKind = workCostKindOf(claim);
  const contract = { requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false };
  const day = claim.receivedAt.slice(0, 10);
  if (claim.kind === "ask") {
    const { question, place, divisions } = claim.value as AskQuestion;
    const made = createWorkItem({ project: "freshness", question: "HAVE_IT", subject: claim.subjectId!,
      obligation: `Find and publish a sourced answer${place ? ` for ZIP ${place}` : ""}: ${question}`, why: WHY.ask, contract, now });
    const plan: AutonomousWorkPlan = { ...huntPacketPlan(made.subject), workKind, readerQuestion: { origin: "ASK", text: question, place, divisions } };
    return { work: { ...made, autonomousPlan: plan }, label: "Find the answer to a reader's question" };
  }
  const government = claim.subjectId!.split("#")[0]!;
  const made = createWorkItem({ project: "freshness", question: "HAVE_IT", subject: government,
    obligation: `Find and publish the facts missing for ${government}, asked for ${day} (${claim.id.slice(5, 13)})`, why: WHY[workKind], contract, now });
  return { work: { ...made, autonomousPlan: { ...huntPacketPlan(government), workKind } as AutonomousWorkPlan }, label: "Find the facts missing for this government" };
}

/**
 * The task a claimed row asks the hunters to run. A task a research round planned is the one it names; any other row is
 * the hunt it stands for, which the hunters' dispatcher keeps its attempts, leases and charges against, so its work item
 * and task are made here (as many times as asked, once). Null when the named task has nothing left to run.
 */
export async function taskOfRow(repos: ControlPlaneRepositories, claim: WorkRow, now: string): Promise<PlannedTask | null> {
  const planned = plannedTaskOf(claim);
  if (planned !== null) {
    const task = await repos.routeTasks.readNarrowed(planned.routeTaskId, { state: true });
    return task !== null && ["PENDING", "RECLAIMABLE"].includes(task.value.state as string) ? planned : null;
  }
  const { work, label } = huntOf(claim, now);
  if (!await repos.workItems.readNarrowed(work.id, { id: true })) await registerWorkItem(repos, work, now);
  const task = createRouteTask({ workItemId: work.id, routeId: HUNT_PACKET_ROUTE_ID, routeLabel: label, target: work.subject, inherited: false, now });
  if (!await repos.routeTasks.readNarrowed(task.id, { id: true })) await registerRouteTask(repos, task, now);
  return { routeTaskId: task.id, plain: false };
}
