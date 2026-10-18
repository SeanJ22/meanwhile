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
        const source = row.provenance;
        records.set(row.id, { id: row.id, kind: row.amounts.length ? "FINANCE_TRANSACTION" : "FINANCE_COMMITTEE", subjectId: subjectId ?? division,
          text: campaignFinanceRecordText({ ...row, amounts: row.amounts.filter(amount => !amount.provenance) }), sourceUrl: row.filingUrl, sourceOrg: source.publisher,
          retrievedAt: source.retrievedAt, publicationDate: source.publicationDate, official: true });
        for (const amount of row.amounts) if (amount.provenance) {
          const own = amount.provenance;
          records.set(`${row.id}:${amount.label}`, { id: `${row.id}:${amount.label}`, kind: "FINANCE_TRANSACTION", subjectId: subjectId ?? division,
            text: `${row.filerName ?? "Filed committee"} · ${row.period ?? row.transactionDate ?? "Filed period not stated"} · ${amount.label}: ${amount.amount}`,
            sourceUrl: own.url, sourceOrg: own.publisher, retrievedAt: own.retrievedAt, publicationDate: own.publicationDate, official: true });
        }
      }
    } catch { unavailable++; }
  }
  if (unavailable) gaps.push({ whose: "OURS", statement: "We're working on getting this info about campaign money for this place." });
  if (more) gaps.push({ whose: "OURS", statement: "More campaign filings are available on this place's card. These records are part of the held filings." });
  return { records: [...records.values()], gaps, denominators: { stateCampaignRecordsReturned: records.size, stateCampaignMorePages: more, stateCampaignUnavailablePlaces: unavailable } };
}
