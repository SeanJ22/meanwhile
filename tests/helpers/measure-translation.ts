import assert from "node:assert/strict";
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
export function decodedMeasurePassages(prompt: string) {
  const decoded = new Map<string, string>();
  return (JSON.parse(prompt).sourcePassages as { id: string; text?: string; sameAs?: string }[]).map(row => {
    const text = row.text ?? decoded.get(row.sameAs!);
    assert.equal(typeof text, "string", "a copy must refer to an earlier complete passage");
    decoded.set(row.id, text!);
    return { id: row.id, text: text! };
  });
}
