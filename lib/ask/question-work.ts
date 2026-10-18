import { scrubFreeText } from "../log/scrub.ts";
import { redactSelfDisclosure } from "../speak/self-disclosure.ts";
import { createWorkItem } from "../control-plane/work-item.ts";
import { registerWorkItem } from "../control-plane/repository/coordinator.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

/** An unanswered question is ordinary open acquisition work in the existing queue. */
export async function recordQuestionWork(input: {
  question: string; divisions: readonly string[]; place: string | null; subjectId?: string | null;
  runClass: string; now: string;
}, repos?: ControlPlaneRepositories): Promise<void> {
  if (input.runClass !== "ORGANIC") return;
  const question = scrubFreeText(redactSelfDisclosure(input.question).text).trim().slice(0, 400);
  if (!question) return;
  const place = input.place && /^\d{5}$/.test(input.place) ? input.place : null;
  const work = createWorkItem({ project: "freshness", question: "HAVE_IT",
    subject: input.subjectId ?? input.divisions.find(id => id.startsWith("ocd-division/")) ?? (place ? `zip:${place}` : "country:us"),
    obligation: `Find and publish a sourced answer${place ? ` for ZIP ${place}` : ""}: ${question}`,
    why: "A reader asked a question that Meanwhile could not answer from its data.",
    contract: { requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false }, now: input.now });
  if (!repos) {
    if (process.env.NODE_ENV !== "production") return;
    const url = controlPlaneUrlFromEnv();
    if (!url) throw new Error("Ask acquisition queue is unavailable");
    repos = await createPgRepositories(url, input.now, { skipBootstrap: true });
  }
  if (!await repos.workItems.read(work.id)) await registerWorkItem(repos, work, input.now);
}
