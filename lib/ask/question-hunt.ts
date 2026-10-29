import { createWorkItem } from "../control-plane/work-item.ts";
import { registerRouteTask, registerWorkItem } from "../control-plane/repository/coordinator.ts";
import { createRouteTask } from "../control-plane/route-task.ts";
import { HUNT_PACKET_ROUTE_ID } from "../hunt/packet.ts";
import { huntPacketPlan } from "../hunt/packet-plan.ts";
import type { WorkList } from "../core/work.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { AskQuestion } from "./question-work.ts";

/**
 * The hunters work from work items and route tasks, so each waiting Ask question is handed to them as the pair they work
 * on, with the reader's question in its plan, and its row is finished. Every question is taken by exactly one caller.
 */
export async function openQuestionHunts(input: { readonly list: WorkList; readonly repos: ControlPlaneRepositories; readonly now: string;
  readonly limit?: number }): Promise<number> {
  const { list, repos, now } = input;
  let opened = 0;
  for (const claim of await list.claim("ask", input.limit ?? 20)) {
    try {
      const { question, place, divisions } = claim.value as AskQuestion;
      const made = createWorkItem({ project: "freshness", question: "HAVE_IT", subject: claim.subjectId!,
        obligation: `Find and publish a sourced answer${place ? ` for ZIP ${place}` : ""}: ${question}`,
        why: "A reader asked a question that Meanwhile could not answer from its data.",
        contract: { requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false }, now });
      const work = { ...made, autonomousPlan: { ...huntPacketPlan(made.subject), readerQuestion: { origin: "ASK" as const, text: question, place, divisions } } };
      // Only whether they are there is asked; a question already handed over is not handed over again.
      if (!await repos.workItems.readNarrowed(work.id, { id: true })) await registerWorkItem(repos, work, now);
      const task = createRouteTask({ workItemId: work.id, routeId: HUNT_PACKET_ROUTE_ID, routeLabel: "Find the answer to a reader's question",
        target: work.subject, inherited: false, now });
      if (!await repos.routeTasks.readNarrowed(task.id, { id: true })) await registerRouteTask(repos, task, now);
      if (!await list.finish(claim)) throw new Error("WORK_LEASE_LOST");
      opened++;
    } catch (error) {
      await list.later(claim, error instanceof Error ? error.message : "The question could not be handed to the hunters");
    }
  }
  return opened;
}
