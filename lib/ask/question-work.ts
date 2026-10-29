import { createHash } from "node:crypto";
import { scrubFreeText } from "../log/scrub.ts";
import { redactSelfDisclosure } from "../speak/self-disclosure.ts";
import { controlPlaneQuery, workList, type WorkList } from "../core/work.ts";

/** What a claimed Ask row carries in its value. */
export interface AskQuestion { readonly question: string; readonly place: string | null; readonly divisions: readonly string[] }

/** An unanswered question is a row in the reader tier of the one work list, at once. */
export async function recordQuestionWork(input: {
  question: string; divisions: readonly string[]; place: string | null; subjectId?: string | null;
  runClass: string; now: string;
}, list?: WorkList): Promise<void> {
  if (input.runClass !== "ORGANIC") return;
  const question = scrubFreeText(redactSelfDisclosure(input.question).text).trim().slice(0, 400);
  if (!question) return;
  const place = input.place && /^\d{5}$/.test(input.place) ? input.place : null;
  const divisions = [...new Set(input.divisions.filter(id => id.startsWith("ocd-division/")))];
  if (!divisions.length) divisions.push(input.subjectId?.startsWith("ocd-division/")
    ? input.subjectId.split("#")[0]! : "ocd-division/country:us");
  const subjectId = input.subjectId ?? input.divisions.find(id => id.startsWith("ocd-division/")) ?? (place ? `zip:${place}` : "country:us");
  if (!list) {
    if (process.env.NODE_ENV !== "production") return;
    list = workList(controlPlaneQuery(), { owner: "ask" });
  }
  const questionId = `ask-${createHash("sha256").update(JSON.stringify([question, place, subjectId])).digest("hex").slice(0, 24)}`;
  const value: AskQuestion = { question, place, divisions };
  // The same question asked again while its row is live is one row; once it is done, asking again is a new reason.
  await list.ensure([{ kind: "ask", tier: "reader", placeId: divisions[0]!, subjectId, claimKey: input.now, series: questionId, value,
    origin: { from: "ask", questionId }, source: { source: "Ask" } }]);
}
