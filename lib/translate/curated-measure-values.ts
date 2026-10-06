import { measureRecordIssue, type MeasureRecord } from "../ballot/measure-record-contract.ts";
import { translationRecordIssue, type TextTranslation, type TranslationRecord } from "./records.ts";
import { curatedMeasureFieldKey } from "./curated-measure-contract.ts";

/** A complete independently checked text set can replace the old static
 * record. Partial sets continue to publish, but do not drop any old group. */
export function curatedMeasureRecordFor(records: readonly TranslationRecord[], contestId: string, ocdId: string): MeasureRecord | null {
  const rows = records.filter((row): row is TextTranslation => row.kind === "MEASURE_TEXT" && row.measureField?.contestId === contestId && row.ocdId === ocdId);
  if (!rows.length || rows.some(row => translationRecordIssue(row))) return null;
  const first = rows[0], base = first.measureField!;
  const signature = (row: TextTranslation) => JSON.stringify([row.measureField!.original, row.measureField!.expectedFields, row.measureField!.partOrder, row.curatedOrigin!.fileHash]);
  if (rows.some(row => signature(row) !== signature(first)) || rows.length !== base.expectedFields.length) return null;
  const fields = new Map(rows.map(row => [curatedMeasureFieldKey(row.measureField!), row]));
  if (fields.size !== rows.length || base.expectedFields.some(key => !fields.has(key))) return null;
  const parts = base.partOrder.map(id => {
    const label = fields.get(`${id}.label`)!, what = fields.get(`${id}.what`)!;
    if (JSON.stringify(label.measureField!.reaction) !== JSON.stringify(what.measureField!.reaction)) return null;
    return { ...label.measureField!.reaction!, label: label.text, what: what.text };
  });
  if (parts.some(row => row === null)) return null;
  const record = { contestId, ...base.original, whatItDoes: fields.get("whatItDoes")!.text,
    yesMeans: fields.get("yesMeans")?.text ?? null, noMeans: fields.get("noMeans")?.text ?? null,
    parts: parts.filter((row): row is NonNullable<typeof row> => row !== null) };
  return measureRecordIssue(record) ? null : record;
}
