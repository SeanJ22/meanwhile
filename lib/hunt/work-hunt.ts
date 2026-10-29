import { createWorkItem } from "../control-plane/work-item.ts";
import { registerRouteTask, registerWorkItem } from "../control-plane/repository/coordinator.ts";
import { createRouteTask } from "../control-plane/route-task.ts";
import { HUNT_PACKET_ROUTE_ID } from "./packet.ts";
import { huntPacketPlan } from "./packet-plan.ts";
import { workCostKindOf } from "../core/work-kinds.ts";
import type { WorkList, WorkRow } from "../core/work.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { AskQuestion } from "../ask/question-work.ts";

/** The row's hunt as the hunters take it: the work item, and the plan that carries the reader's question when there is one. */
function huntOf(claim: WorkRow, now: string) {
  const workKind = workCostKindOf(claim);
  if (claim.kind === "ask") {
    const { question, place, divisions } = claim.value as AskQuestion;
    const made = createWorkItem({ project: "freshness", question: "HAVE_IT", subject: claim.subjectId!,
      obligation: `Find and publish a sourced answer${place ? ` for ZIP ${place}` : ""}: ${question}`,
      why: "A reader asked a question that Meanwhile could not answer from its data.",
      contract: { requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false }, now });
    const plan: AutonomousWorkPlan = { ...huntPacketPlan(made.subject), workKind, readerQuestion: { origin: "ASK", text: question, place, divisions } };
    return { work: { ...made, autonomousPlan: plan }, label: "Find the answer to a reader's question" };
  }
  const government = claim.subjectId!.split("#")[0]!;
  const made = createWorkItem({ project: "freshness", question: "HAVE_IT", subject: government,
    obligation: `Find and publish the facts missing for ${government}, asked for ${claim.receivedAt.slice(0, 10)}`,
    why: "A reader asked to get this sooner.",
    contract: { requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false }, now });
  return { work: { ...made, autonomousPlan: { ...huntPacketPlan(government), workKind } as AutonomousWorkPlan }, label: "Find the facts missing for this government" };
}

/**
 * The hunters work from work items and route tasks, so each waiting Ask question and each hunt on the list is handed to
 * them as the pair they work on, and its row is finished. The pair carries the row's kind, so every charge the hunt
 * makes says what it was for. Every row is taken by exactly one caller.
 */
export async function openWorkHunts(input: { readonly list: WorkList; readonly repos: ControlPlaneRepositories; readonly now: string;
  readonly limit?: number }): Promise<number> {
  const { list, repos, now } = input;
  let opened = 0;
  for (const kind of ["ask", "hunt"] as const) {
    for (const claim of await list.claim(kind, input.limit ?? 20)) {
      try {
        const { work, label } = huntOf(claim, now);
        // Only whether they are there is asked; a hunt already handed over is not handed over again.
        if (!await repos.workItems.readNarrowed(work.id, { id: true })) await registerWorkItem(repos, work, now);
        const task = createRouteTask({ workItemId: work.id, routeId: HUNT_PACKET_ROUTE_ID, routeLabel: label, target: work.subject, inherited: false, now });
        if (!await repos.routeTasks.readNarrowed(task.id, { id: true })) await registerRouteTask(repos, task, now);
        if (!await list.finish(claim)) throw new Error("WORK_LEASE_LOST");
        opened++;
      } catch (error) {
        await list.later(claim, error instanceof Error ? error.message : "The row could not be handed to the hunters");
      }
    }
  }
  return opened;
}
