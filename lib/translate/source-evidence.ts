import { join } from "node:path";
import type { WorkerEvidence } from "../control-plane/workers/types.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { holdRawCapture } from "../civic-data/raw-capture-vault.ts";
import { isColoradoBlueBook } from "./blue-book.ts";
import { VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import { MEASURE_WRITING_VERSION, translationHash, translationSourceContains, type MeasureTranslation } from "./records.ts";

export const translationEvidenceVault = (vault?: EvidenceStore): EvidenceStore =>
  vault ?? new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));

/** Arizona needs the shared writer; Colorado statewide measures need the Blue Book. */
export const needsMeasureRewrite = (row: MeasureTranslation) =>
  /^ocd-division\/country:us\/state:az(?:\/|$)/.test(row.ocdId) && row.writingRulesVersion !== MEASURE_WRITING_VERSION ||
  row.ocdId === "ocd-division/country:us/state:co" && !isColoradoBlueBook(row.sourceUrl);

/** One immutable original, plus only the exact passages this explanation cites. */
export async function compactMeasureSource(row: MeasureTranslation, input: {
  readonly evidence?: WorkerEvidence;
  readonly vault?: EvidenceStore;
} = {}): Promise<MeasureTranslation> {
  if (row.sourceCapture) return row;
  const original = input.evidence?.text ?? row.sourceText;
  if (translationHash(original) !== row.sourceTextHash || row.sentences.some(sentence => !translationSourceContains(original, sentence.quote))) {
    throw new Error("Translation source passages do not match the saved original.");
  }
  const ref = input.evidence?.sourceCapture ?? await holdRawCapture(translationEvidenceVault(input.vault),
    new URL(row.sourceUrl).hostname, original, "text/plain");
  if (ref.rawHash !== translationHash(original) || ref.byteLength !== Buffer.byteLength(original) || !ref.vaultKey) {
    throw new Error("Translation source vault reference does not match the original.");
  }
  const sourceText = [...new Set([...(row.subjectQuote ? [row.subjectQuote] : []), ...row.sentences.map(sentence => sentence.quote)])].join("\n");
  const compact = { ...row, sourceCapture: ref, sourceText, sourceTextHash: translationHash(sourceText) };
  if (Buffer.byteLength(JSON.stringify(compact)) >= 1_000_000) throw new Error("Cite only the passages supporting this measure; its translation must stay under 1 MB.");
  return compact;
}
