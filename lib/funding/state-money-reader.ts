/** Reader eligibility and answer selection, separate from acquisition normalization. */
import { isRenderable as allowedFilingState, type StateMoneyRecord } from "./state-money.ts";
import { filedOrganizations, stateMoneyFundingIssue } from "./state-money-funding.ts";
import { validFinanceDoorDetailSource } from "./finance-detail-source.ts";

/** A normalized enum never substitutes for civic verification or a resolved identity. */
export function isRenderable(record: StateMoneyRecord): boolean {
  if (record.dataClass !== "STATE_COMMITTEE" || !record.targetKeys?.length || !record.checkedAt ||
      !record.provenance?.sourceUrl || !record.provenance.verifiedAt) return false;
  if ((record.filingState === "FILED" || record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") && !record.match?.allThreeAgree &&
      !(record.identityBasis === "NATIVE_FILER" && record.committeeId && record.targetKeys.every(key => key === `state-finance:${record.jurisdiction}:${record.committeeId}:${record.electionYear}`))) return false;
  if (record.filingState === "OURS_GAP" && (!record.ourGap?.whatIsMissing || record.committeeId !== null ||
      record.totals.receipts !== null || record.totals.expenditures !== null || record.totals.cashOnHand !== null)) return false;
  return allowedFilingState(record);
}

/** The public shape is explicit, so saved evidence cannot leak through extra JSON fields. */
export function publicStateMoneyRecord(record: StateMoneyRecord): StateMoneyRecord {
  const totals = record.totals, match = record.match, source = record.detailSource;
  return {
    dataClass: "STATE_COMMITTEE", identityBasis: record.identityBasis, jurisdiction: record.jurisdiction,
    agency: record.agency, filingsUrl: record.filingsUrl, committeeId: record.committeeId,
    registeredName: record.registeredName, candidateNameAsFiled: record.candidateNameAsFiled,
    officeSought: record.officeSought, electionYear: record.electionYear, filingState: record.filingState,
    targetKeys: [...record.targetKeys], checkedAt: record.checkedAt,
    totals: { receipts: totals.receipts, expenditures: totals.expenditures, cashOnHand: totals.cashOnHand,
      reportCount: totals.reportCount, coveringPeriod: totals.coveringPeriod },
    match: { registeredName: match.registeredName, officeAsFiled: match.officeAsFiled, officeOnBallot: match.officeOnBallot,
      electionYearAsFiled: match.electionYearAsFiled, electionYearOnBallot: match.electionYearOnBallot,
      allThreeAgree: match.allThreeAgree, note: match.note },
    provenance: { sourceUrl: record.provenance.sourceUrl, sourceOrg: record.provenance.sourceOrg,
      collectedAt: record.provenance.collectedAt, verifiedAt: record.provenance.verifiedAt },
    ...(record.funding && !stateMoneyFundingIssue(record.funding) ? { funding: {
      organizations: filedOrganizations(record.funding), individualItemized: record.funding.individualItemized,
      individualUnitemized: record.funding.individualUnitemized, individualTotal: record.funding.individualTotal, scope: record.funding.scope,
    } } : {}),
    ...(record.ourGap ? { ourGap: { whatIsMissing: record.ourGap.whatIsMissing, nextDue: record.ourGap.nextDue, nextDueName: record.ourGap.nextDueName } } : {}),
    ...(source && validFinanceDoorDetailSource(source) ? { detailSource: { doorId: source.doorId, kind: source.kind, ocdId: source.ocdId,
      hosts: [...source.hosts], config: { ...source.config }, committeeId: source.committeeId,
      candidateName: source.candidateName, office: source.office, electionYear: source.electionYear } } : {}),
  };
}

/**
 * One candidate's answer. A sourced filing/activity record outranks a search
 * absence for the same candidate; all held filings remain. This is semantic
 * contradiction resolution, never a completeness threshold.
 */
export function stateMoneyRecordsForDisplay(records: readonly StateMoneyRecord[]): StateMoneyRecord[] {
  const eligible = records.filter(isRenderable).map(publicStateMoneyRecord);
  const filed = eligible.filter(r => r.filingState === "FILED");
  if (filed.length) return filed;
  const registered = eligible.filter(r => r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED");
  if (registered.length) return registered;
  const absent = eligible.filter(r => r.filingState === "NO_REPORTS_ON_FILE");
  if (absent.length) return absent.slice(0, 1);
  return eligible.filter(r => r.filingState === "OURS_GAP").slice(0, 1);
}
