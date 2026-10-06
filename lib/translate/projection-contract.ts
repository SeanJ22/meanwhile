import { translationRecordIssue, type TranslationRecord } from "./records.ts";

export interface TranslationProjection { readonly kind: "plain-english-translations"; readonly records: readonly TranslationRecord[] }

export function translationProjectionProblems(payload: TranslationProjection): string[] {
  if (!payload || payload.kind !== "plain-english-translations" || !Array.isArray(payload.records)) return ["Translation records are missing."];
  const problems = payload.records.flatMap(record => { const issue = translationRecordIssue(record); return issue ? [issue] : []; });
  if (new Set(payload.records.map(record => record.id)).size !== payload.records.length) problems.push("Translation repeats a subject identity.");
  if (new Set(payload.records.map(record => record.ocdId)).size > 1) problems.push("Translation batch must belong to one exact place or district.");
  return problems;
}

