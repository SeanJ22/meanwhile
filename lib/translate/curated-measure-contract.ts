import type { MeasureRecord } from "../ballot/measure-record-contract.ts";
import type { TextTranslation } from "./records.ts";

/** Original reaction groups are curated reader text, not newly numbered
 * official provisions. Their IDs and unknown numbers remain unchanged. */
export interface CuratedMeasureField {
  readonly contestId: string;
  readonly field: "whatItDoes" | "yesMeans" | "noMeans" | "label" | "what";
  readonly reaction: { readonly id: string; readonly kind: string; readonly number: null } | null;
  readonly expectedFields: readonly string[];
  readonly partOrder: readonly string[];
  readonly original: Pick<MeasureRecord, "sourceUrl" | "sourceHash" | "sourceHashKind" | "writtenAt" | "citation">;
}
export const curatedMeasureFieldKey = (field: CuratedMeasureField) => field.reaction ? `${field.reaction.id}.${field.field}` : field.field;

export function curatedMeasureFieldIssue(row: TextTranslation): string | null {
  const f = row.measureField;
  if (!f || !row.curatedOrigin || !f.contestId || row.subjectId !== `measure_text:${f.contestId}:${curatedMeasureFieldKey(f)}` ||
      row.curatedOrigin.recordKey !== row.subjectId || row.sourceUrl !== f.original?.sourceUrl || row.sourceHash !== f.original?.sourceHash ||
      !Number.isFinite(Date.parse(f.original?.writtenAt)) || !Array.isArray(f.expectedFields) || !Array.isArray(f.partOrder) ||
      new Set(f.expectedFields).size !== f.expectedFields.length || new Set(f.partOrder).size !== f.partOrder.length ||
      !f.expectedFields.includes("whatItDoes") || !f.expectedFields.includes(curatedMeasureFieldKey(f)) ||
      f.partOrder.some(id => !id.startsWith(`${f.contestId}#`) || !f.expectedFields.includes(`${id}.label`) || !f.expectedFields.includes(`${id}.what`))) return "Curated measure text lost its original subject, source or reaction inventory.";
  const allowed = new Set(["whatItDoes", "yesMeans", "noMeans", ...f.partOrder.flatMap(id => [`${id}.label`, `${id}.what`])]);
  if (f.expectedFields.some(key => !allowed.has(key)) || (f.reaction
    ? !f.partOrder.includes(f.reaction.id) || !["label", "what"].includes(f.field) || f.reaction.number !== null || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(f.reaction.kind)
    : !["whatItDoes", "yesMeans", "noMeans"].includes(f.field))) return "Curated reaction text cannot introduce official numbering or change its identity.";
  return null;
}

