import { readPopulationFacts, populationSentence, type PopulationFact } from "../reference/population-facts.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { EvidenceRecord } from "./evidence.ts";

export const populationQuestion = (question: string): boolean => /\b(?:population|per capita|people live|people living|how many (?:people|residents))\b/i.test(question);
export function populationEvidenceIds(subjectKind: string | null, division: string | null | undefined, zip: string | undefined, divisionIds: readonly string[]): readonly string[] {
  if (subjectKind === "BODY" || subjectKind === "PERSON") return division ? [division] : [];
  return zip ? [`zcta:${zip}`] : divisionIds;
}
export function populationEvidence(rows: readonly PopulationFact[], subjectId?: string): EvidenceRecord[] {
  return rows.map(row => ({ kind: "POPULATION", id: `acs:${row.attribution.vintage}:${row.geography}:${row.code}`,
    ...(subjectId ? { subjectId, bodyId: subjectId } : {}), population: row, text: populationSentence(row),
    sourceUrl: row.attribution.citationUrl ?? row.attribution.sourceUrl, sourceOrg: row.attribution.sourceOrg, retrievedAt: row.attribution.retrievedAt,
    occurredAt: row.attribution.publishedAt }));
}
export async function readPopulationEvidence(ids: readonly string[], subjectId?: string, query?: ReadOnlyQuery | null): Promise<EvidenceRecord[]> {
  const read = await readPopulationFacts(ids, query);
  return read.kind === "HELD" ? populationEvidence(read.rows, subjectId) : [];
}
export function composePopulationAnswer(question: string, records: readonly EvidenceRecord[]) {
  if (!populationQuestion(question)) return null;
  if (/\b(?:per capita|density|eligible|voters?|voting|income|poverty|growth|changed|percentage|percent|enrollment)\b/i.test(question)) return null;
  const rows = records.filter(row => row.kind === "POPULATION");
  if (!rows.length) return null;
  return { answer: rows.map(row => row.text).join(" "), citedUrls: [...new Set(rows.map(row => row.sourceUrl!).filter(Boolean))] };
}
