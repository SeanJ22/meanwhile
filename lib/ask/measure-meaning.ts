import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/** Read the stored vote meaning verbatim; no model has to reconstruct it from a summary. */
export function composeMeasureMeaningAnswer(input: {
  subject: EvidenceSubject | null; question: string; records: readonly EvidenceRecord[];
}): { answer: string; citedUrls: string[] } | null {
  if (input.subject?.kind !== "MEASURE") return null;
  const requested = [...input.question.matchAll(/\b(yes|no)\s+(?:vote|means?)\b|\b(?:vote|voting|voted)\s+(yes|no)\b|\bwhat\s+(?:does|would)\s+(?:a\s+)?(yes|no)\b/gi)]
    .map(match => (match[1] ?? match[2] ?? match[3]).toUpperCase());
  const votes = new Set(requested);
  if (!votes.size) return null;
  const held = input.records.filter(record => record.kind === "MEASURE_SUMMARY" && record.measureMeaning &&
    votes.has(record.measureMeaning.vote) && record.subjectIds?.includes(input.subject!.id) && record.sourceUrl);
  if (held.length !== votes.size || new Set(held.map(record => record.measureMeaning!.vote)).size !== votes.size) return null;
  return { answer: held.map(record => `${record.measureMeaning!.vote}: ${record.measureMeaning!.meaning}`).join("\n\n"),
    citedUrls: [...new Set(held.map(record => record.sourceUrl!))] };
}
