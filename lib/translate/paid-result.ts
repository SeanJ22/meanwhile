import { newFieldManualEntry, writeFieldManual, type FieldManualRepos } from "../control-plane/field-manual.ts";
import type { MeteredUsage } from "../control-plane/model-cost.ts";
import { translationHash } from "./records.ts";

export interface TranslationLearning {
  readonly stage: "WRITER" | "CHECKER" | "PUBLICATION";
  readonly reason: string;
  readonly learned: string;
  readonly calls: readonly { readonly model: string; readonly usage: MeteredUsage; readonly usd: number | null }[];
}

/** A paid response that cannot reach a reader still yields a source-scoped
 * result in the existing Bank. No extra read on successful or unpaid work. */
export async function recordTranslationHold(input: {
  repos: FieldManualRepos; subjectId: string; ocdId: string; state: string;
  sourceUrl: string; sourceHash: string; now: string;
  stage: TranslationLearning["stage"]; reason: string; calls: TranslationLearning["calls"];
}): Promise<{ learning: TranslationLearning | null; learningError: string | null }> {
  if (input.calls.length === 0) return { learning: null, learningError: null };
  const learned = `This source revision did not yield publishable text. Stopped at ${input.stage.toLowerCase()}: ${input.reason}`;
  const learning: TranslationLearning = { stage: input.stage, reason: input.reason, learned, calls: input.calls };
  const key = translationHash(JSON.stringify([input.ocdId, input.subjectId, input.sourceHash, input.now, learning]));
  const saved = await writeFieldManual(input.repos, [newFieldManualEntry("translation-result", key, {
    role: "SHARED", kind: "TRANSLATION_LESSON", title: "A paid translation was held",
    summary: learned.replace(/\s+/g, " ").slice(0, 240), states: [input.state.toLowerCase()],
    ocdIds: [input.ocdId], recordClasses: ["plain-english-translations"],
    outcome: "FAILED", url: input.sourceUrl, observedAt: input.now,
    payload: { subjectId: input.subjectId, sourceHash: input.sourceHash, ...learning },
  })], input.now);
  return { learning, learningError: saved.error ?? null };
}
