import { campaignMoneyForTarget, type CampaignMoney } from "../funding/campaign-money.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

export function campaignMoneyEvidenceFor(
  subject: EvidenceSubject,
  targetKey: string,
  contestId?: string,
  select: (key: string, contest?: string) => CampaignMoney = campaignMoneyForTarget,
): { records: EvidenceRecord[]; gaps: EvidenceGap[]; denominators: Record<string, number> } {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = { stateFinanceRecordsReturned: 0, federalFinanceRecordsReturned: 0, financeIdentityUnresolved: 0 };
  if (subject.kind !== "PERSON") return { records, gaps, denominators };
  let money: CampaignMoney;
  try { money = select(targetKey, contestId); }
  catch {
    gaps.push({ whose: "OURS", statement: `The campaign-finance records for ${subject.name} could not be read for this answer.` });
    denominators.financeLoaderFailures = 1;
    return { records, gaps, denominators };
  }
  if (money.officialIdentity === "IDENTITY_UNRESOLVED") {
    denominators.financeIdentityUnresolved = 1;
    gaps.push({ whose: "OURS", statement: `We have not established which campaign-finance candidacy belongs to ${subject.name}, so no other candidate's money has been attached.` });
  }
  if (money.federal.kind === "funding") {
    const record = money.federal.data;
    records.push({ kind: "FINANCE_SUMMARY", id: `fec:${record.fecCandidateId}`, subjectId: subject.id,
      canonicalSubjectId: record.fecCandidateId, text: [...record.sentences, ...(record.registrationLabel ? [`${subject.name} is ${record.registrationLabel}.`] : [])].join(" "),
      sourceUrl: record.sourceUrl, sourceOrg: record.sourceOrg, retrievedAt: record.collectedAt,
      ...(record.totals ? { fecTotals: { receipts: record.totals.receipts, disbursements: record.totals.disbursements,
        cashOnHand: record.totals.cashOnHand, cycle: record.cycleLabel, through: record.totals.coverageEndDate ?? null } } : {}),
      ...(record.detailSource ? { fecDetailSource: record.detailSource } : {}),
      fecProfile: { candidateId: record.fecCandidateId, name: subject.name, personId: subject.id } });
    denominators.federalFinanceRecordsReturned = 1;
  } else if (money.federal.kind === "absence") {
    const absence = money.federal.data;
    records.push({ kind: "FINANCE_SUMMARY", id: `fec-absence:${targetKey}`, subjectId: subject.id,
      canonicalSubjectId: targetKey, text: absence.statement, sourceUrl: absence.searchUrl,
      sourceOrg: "Federal Election Commission", retrievedAt: absence.checkedAt });
    denominators.federalFinanceRecordsReturned = 1;
  }
  return { records, gaps, denominators };
}
