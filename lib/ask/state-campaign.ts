import { readCampaignFinanceForPlace } from "../funding/state-reader.ts";
import { campaignFinanceRecordText } from "../funding/state-view.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";

export function stateCampaignQuestion(question: string): boolean {
  return /\bcampaign(?:s| finance)?\b|\bdonors?\b|\bpolitical (?:money|contributions?|funding)\b|\bPACs?\b/i.test(question);
}
export async function stateCampaignEvidence(divisions: readonly string[], subjectId?: string, options: Parameters<typeof readCampaignFinanceForPlace>[1] = {}) {
  const records = new Map<string, EvidenceRecord>(), gaps: EvidenceGap[] = [];
  let more = 0, unavailable = 0;
  for (const division of new Set(divisions)) {
    try {
      const read = await readCampaignFinanceForPlace(division, options);
      if (read.nextCursor) more++;
      if (read.status !== "HELD") { unavailable++; continue; }
      for (const row of read.records) {
        for (const [index, source] of row.sources.entries()) records.set(`${row.id}:${index}`, {
          id: `${row.id}:${index}`, kind: "FINANCE_COMMITTEE", subjectId: row.person.id,
          text: campaignFinanceRecordText(row), sourceUrl: source.filingUrl, sourceOrg: source.publisher,
          retrievedAt: source.retrievedAt, publicationDate: source.publicationDate, official: true,
        });
      }
    } catch { unavailable++; }
  }
  if (unavailable) gaps.push({ whose: "OURS", statement: "We're working on getting this info about campaign money for this place." });
  if (more) gaps.push({ whose: "OURS", statement: "More campaign totals are available on this place's card." });
  return { records: [...records.values()], gaps, denominators: { stateCampaignRecordsReturned: records.size, stateCampaignMorePages: more, stateCampaignUnavailablePlaces: unavailable } };
}
