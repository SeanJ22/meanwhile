import type { MeasureRecord } from "../ballot/measure-record-contract.ts";
import { measureRecordIssue } from "../ballot/measure-record-contract.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { translationHash, type PreservedCuratedText } from "./records.ts";
import { curatedMeasureFieldKey, type CuratedMeasureField } from "./curated-measure-contract.ts";
import { runHeldTextTranslations } from "./standing.ts";
import { captureIntact } from "../civic-data/worker-publication-evidence.ts";

export interface CuratedMeasureTextEntry {
  readonly subject: Parameters<typeof runHeldTextTranslations>[0]["subjects"][number]["subject"];
  readonly sourceUrl: string;
  readonly preservedText: PreservedCuratedText;
}

/** The caller selects original holdings and their exact contest divisions.
 * Labels come from the saved source; this starts no hunt or model call. */
export function curatedMeasureTextEntries(input: {
  readonly records: readonly MeasureRecord[];
  readonly file: string; readonly fileHash: string;
  readonly bindings: readonly { contestId: string; ocdId: string; label: string }[];
}): CuratedMeasureTextEntry[] {
  if (!input.file || !/^[a-f0-9]{64}$/.test(input.fileHash)) throw new Error("Curated measures require their original holding hash.");
  return input.records.flatMap(record => {
    const bindings = input.bindings.filter(row => row.contestId === record.contestId);
    if (measureRecordIssue(record) || record.parts.some(part => part.number !== null) || bindings.length !== 1) return [];
    const binding = bindings[0], state = jurisdictionFromOcdId(binding.ocdId)?.usps;
    if (!state || !binding.label.trim()) return [];
    const fields: { field: CuratedMeasureField["field"]; text: string; reaction: CuratedMeasureField["reaction"] }[] = [
      { field: "whatItDoes", text: record.whatItDoes, reaction: null },
      ...(["yesMeans", "noMeans"] as const).flatMap(field => record[field] ? [{ field, text: record[field]!, reaction: null }] : []),
      ...record.parts.flatMap(part => (["label", "what"] as const).map(field => ({ field, text: part[field], reaction: { id: part.id, kind: part.kind, number: null } }))),
    ];
    const expectedFields = fields.map(field => curatedMeasureFieldKey({ ...field, contestId: record.contestId } as CuratedMeasureField));
    const partOrder = record.parts.map(part => part.id);
    const original = { sourceUrl: record.sourceUrl, sourceHash: record.sourceHash, ...(record.sourceHashKind ? { sourceHashKind: record.sourceHashKind } : {}), writtenAt: record.writtenAt, ...(record.citation ? { citation: record.citation } : {}) };
    return fields.map(({ field, text, reaction }) => {
      const measureField: CuratedMeasureField = { contestId: record.contestId, field, reaction, expectedFields, partOrder, original };
      const subjectId = `measure_text:${record.contestId}:${curatedMeasureFieldKey(measureField)}`;
      return { subject: { kind: "MEASURE_TEXT" as const, subjectId, ocdId: binding.ocdId, state, label: binding.label, measureField }, sourceUrl: record.sourceUrl,
        preservedText: { text, origin: { kind: "CURATED_MIGRATION" as const, file: input.file, fileHash: input.fileHash, recordKey: subjectId, textHash: translationHash(text),
          citation: { basis: record.citation ?? "measure-source", url: record.sourceUrl, readOn: null } } } };
    });
  });
}

/** Existing durable attempts, guarded writer/checker, scoped Slide and Reader.
 * A different source revision is refused before any paid call. */
export function runCuratedMeasureMigrations(input: Omit<Parameters<typeof runHeldTextTranslations>[0], "subjects"> & {
  readonly entries: readonly CuratedMeasureTextEntry[];
}) {
  const subjects = input.entries.filter(entry => input.captures.some(capture => captureIntact(capture) && capture.evidence.canonicalUrl === entry.sourceUrl &&
    (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash) === `sha256-${entry.subject.measureField?.original.sourceHash}`));
  return runHeldTextTranslations({ ...input, subjects });
}
