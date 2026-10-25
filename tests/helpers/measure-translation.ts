import type { MeasureRecord } from "../../lib/ballot/measure-record-contract.ts";
import type { TranslationSentence } from "../../lib/translate/records.ts";
import type { ModelRequest } from "../../lib/control-plane/scheduler/scout-executor.ts";

export function measureDraft(measure: MeasureRecord, sentences: readonly Pick<TranslationSentence, "field" | "text">[], passageFrom = "p0", passageThrough = passageFrom) {
  return { measure: { whatItDoes: measure.whatItDoes, yesMeans: measure.yesMeans, noMeans: measure.noMeans, parts: measure.parts },
    sentences: sentences.map(({ field, text }) => ({ field, text, passageFrom, passageThrough })) };
}

export function measureRequestContext(request: ModelRequest) {
  const blocks = request.messages[0].content as readonly { type: string; text: string }[];
  return JSON.parse(blocks[1].text);
}
