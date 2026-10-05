import { createHash } from "node:crypto";
import type { MeasureRecord } from "../ballot/measure-records.ts";
import { measureRecordIssue } from "../ballot/measure-records.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";

export const TRANSLATION_SCOPE = "US:plain-english-translations";
export function translationScope(ocdId: string): string {
  if (!jurisdictionFromOcdId(ocdId)) throw new Error("Translation must name one US place or district.");
  return `${TRANSLATION_SCOPE}:${ocdId}`;
}
export function isTranslationScope(scope: string): boolean {
  const ocdId = scope.slice(TRANSLATION_SCOPE.length + 1);
  return scope.startsWith(`${TRANSLATION_SCOPE}:`) && Boolean(jurisdictionFromOcdId(ocdId));
}
export const translationHash = (text: string) => createHash("sha256").update(text).digest("hex");

export interface TranslationSentence {
  readonly field: string;
  readonly text: string;
  readonly quote: string;
}

/** The source and the two model results travel with the published text. */
export interface TranslationEvidence {
  readonly id: string;
  readonly subjectId: string;
  readonly ocdId: string;
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly sourceText: string;
  readonly sourceTextHash: string;
  readonly retrievedAt: string;
  readonly writtenAt: string;
  readonly writerModel: string;
  readonly checkerModel: string;
  readonly playbookVersion: string;
  readonly sentences: readonly TranslationSentence[];
  readonly checked: readonly { readonly field: string; readonly text: string; readonly supported: true }[];
}

export interface MeasureTranslation extends TranslationEvidence {
  readonly kind: "MEASURE";
  readonly measure: MeasureRecord;
}
export interface TextTranslation extends TranslationEvidence {
  readonly kind: "BODY_CLASS" | "BODY" | "OFFICE" | "AGENDA" | "MINUTES";
  /** BODY_CLASS names the class, BODY names one body, OFFICE names the state-defined office. */
  readonly label: string;
  readonly text: string;
}
export type TranslationRecord = MeasureTranslation | TextTranslation;

const outputFields = (measure: MeasureRecord) => [
  ["whatItDoes", measure.whatItDoes], ["yesMeans", measure.yesMeans], ["noMeans", measure.noMeans],
  ...measure.parts.flatMap(part => [[`parts.${part.id}.label`, part.label], [`parts.${part.id}.what`, part.what]]),
].filter((row): row is [string, string] => typeof row[1] === "string" && Boolean(row[1]));

/** Every written sentence has its own source passage and independent check. */
export function translationRecordIssue(row: TranslationRecord): string | null {
  if (!row || !["MEASURE", "BODY_CLASS", "BODY", "OFFICE", "AGENDA", "MINUTES"].includes(row.kind) || !row.subjectId || row.id !== `translation:${row.subjectId}` ||
      !jurisdictionFromOcdId(row.ocdId ?? "") || !/^https:\/\//.test(row.sourceUrl) ||
      !/^[a-f0-9]{64}$/.test(row.sourceHash) || !row.sourceText?.trim() || translationHash(row.sourceText) !== row.sourceTextHash ||
      !Number.isFinite(Date.parse(row.retrievedAt)) || !Number.isFinite(Date.parse(row.writtenAt)) ||
      !row.writerModel || !row.checkerModel || row.writerModel === row.checkerModel ||
      !/^[a-f0-9]{64}$/.test(row.playbookVersion) || !Array.isArray(row.sentences) || !Array.isArray(row.checked)) return "Translation lacks its exact source, subject identity or independent checker.";
  if (row.kind === "MEASURE" && (measureRecordIssue(row.measure) || row.measure.contestId !== row.subjectId || row.measure.sourceHash !== row.sourceHash ||
      row.measure.sourceUrl !== row.sourceUrl || row.measure.writtenAt !== row.writtenAt || !row.measure.yesMeans || !row.measure.noMeans)) return "Translation lacks its exact measure identity or vote meanings.";
  if (row.kind !== "MEASURE" && (typeof row.label !== "string" || !row.label.trim() || !row.sourceText.includes(row.label) ||
      typeof row.text !== "string" || !row.text.trim())) return "Translation lacks its source-named subject or text.";
  const fieldsAndValues = row.kind === "MEASURE" ? outputFields(row.measure) : [["text", row.text]];
  for (const [field, value] of fieldsAndValues) {
    const sentences = row.sentences.filter(sentence => sentence.field === field);
    if (!sentences.length || sentences.map(sentence => sentence.text).join(" ") !== value ||
        sentences.some(sentence => typeof sentence.text !== "string" || !sentence.text.trim() || /[.!?]\s+[A-Z]/.test(sentence.text) || typeof sentence.quote !== "string" || !sentence.quote.trim() || !row.sourceText.includes(sentence.quote) ||
          row.checked.filter(check => check.field === field && check.text === sentence.text && check.supported === true).length !== 1)) {
      return "A translated sentence lacks a confirmed source passage or independent support.";
    }
  }
  const fields = new Set(fieldsAndValues.map(([field]) => field));
  if (row.sentences.some(sentence => !fields.has(sentence.field)) || row.checked.length !== row.sentences.length) return "Translation contains an unaccounted sentence or check.";
  const numbers = new Set<string>();
  for (const part of row.kind === "MEASURE" ? row.measure.parts : []) {
    if (!part.number || numbers.has(part.number) || !new RegExp(`(?:^|\\n)\\s*${part.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[.)\\s]|\\b(?:section|part|paragraph)\\s+${part.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(row.sourceText)) return "A measure part lacks unique numbering in the official text.";
    numbers.add(part.number);
  }
  return null;
}

export function translationIsCurrent(row: TranslationRecord, sourceHash: string): boolean {
  return row.sourceHash === sourceHash && translationRecordIssue(row) === null;
}
