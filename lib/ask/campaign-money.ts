import { campaignMoneyForTarget, type CampaignMoney } from "../funding/campaign-money.ts";
import { formatDateLong } from "../text/format-date.ts";
import type { StateMoneyRecord } from "../funding/state-money.ts";
import { stateMoneyRecordsForDisplay } from "../funding/state-money-reader.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";
import { filedOrganizations, stateSmallDonorSentence } from "../funding/state-money-funding.ts";

const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function stateText(record: StateMoneyRecord): string {
  const asOf = formatDateLong(record.checkedAt) ?? "the recorded read date";
  if (record.filingState === "OURS_GAP") return record.ourGap?.whatIsMissing ?? "We have not resolved this campaign-finance identity.";
  if (record.filingState === "NO_REPORTS_ON_FILE") return `No reports on file with the ${record.agency} as of ${asOf}.`;
  if (record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") return `${record.registeredName} is registered. No money raised or spent has been reported to the ${record.agency} as of ${asOf}; registration does not establish that no money was raised.`;
  const facts = [
    record.totals.receipts === null ? null : `raised ${dollars(record.totals.receipts)}`,
    record.totals.expenditures === null ? null : `spent ${dollars(record.totals.expenditures)}`,
    record.totals.cashOnHand === null ? null : `cash on hand ${dollars(record.totals.cashOnHand)}`,
    ...filedOrganizations(record.funding).map(org => `${org.filedName}${org.filedType ? ` (${org.filedType})` : ""}: ${dollars(org.amount)}`),
    record.funding?.individualTotal === null || record.funding?.individualTotal === undefined ? null : `individual giving ${dollars(record.funding.individualTotal)}`,
    stateSmallDonorSentence(record.funding),
  ].filter(Boolean);
  return `${record.registeredName}, ${record.electionYear} election cycle: ${facts.join("; ")}. Filed with the ${record.agency}; read ${asOf}.`;
}

/** Ballot, official funding API, and Ask ask this one selector the same question. */
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
  for (const [index, record] of stateMoneyRecordsForDisplay(money.state.records).entries()) {
    if (record.filingState === "OURS_GAP") {
      gaps.push({ whose: "OURS", statement: stateText(record) });
      denominators.financeIdentityUnresolved += 1;
      continue;
    }
    records.push({
      kind: "FINANCE_SUMMARY", id: `state-money:${money.state.resolvedTargetKey}:${record.committeeId ?? record.filingState}:${index}`,
      subjectId: subject.id, canonicalSubjectId: money.state.resolvedTargetKey ?? targetKey,
      text: stateText(record), sourceUrl: record.filingsUrl ?? record.provenance.sourceUrl,
      sourceOrg: record.provenance.sourceOrg, retrievedAt: record.checkedAt,
      ...(record.detailSource ? { stateDetailSource: record.detailSource } : {}),
      finance: {
        jurisdiction: record.jurisdiction, filingState: record.filingState, totals: record.totals,
        registeredName: record.registeredName.trim(), agency: record.agency, electionYear: record.electionYear, checkedAt: record.checkedAt,
        ...(record.funding ? { funding: record.funding } : {}),
      },
    });
  }
  denominators.stateFinanceRecordsReturned = records.length;
  if (money.federal.kind === "funding") {
    const record = money.federal.data;
    records.push({ kind: "FINANCE_SUMMARY", id: `fec:${record.fecCandidateId}`, subjectId: subject.id,
      canonicalSubjectId: record.fecCandidateId, text: record.sentences.join(" "),
      sourceUrl: record.sourceUrl, sourceOrg: record.sourceOrg, retrievedAt: record.collectedAt,
      ...(record.detailSource ? { fecDetailSource: record.detailSource } : {}) });
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
