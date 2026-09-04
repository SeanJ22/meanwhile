/** Reader eligibility and answer selection, separate from acquisition normalization. */
import { isRenderable as allowedFilingState, type StateMoneyRecord } from "./state-money.ts";

/** A normalized enum never substitutes for civic verification or a resolved identity. */
export function isRenderable(record: StateMoneyRecord): boolean {
  if (record.dataClass !== "STATE_COMMITTEE" || !record.targetKeys?.length || !record.checkedAt ||
      !record.provenance?.sourceUrl || !record.provenance.verifiedAt) return false;
  if ((record.filingState === "FILED" || record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") && !record.match?.allThreeAgree) return false;
  if (record.filingState === "OURS_GAP" && (!record.ourGap?.whatIsMissing || record.committeeId !== null ||
      record.totals.receipts !== null || record.totals.expenditures !== null || record.totals.cashOnHand !== null)) return false;
  return allowedFilingState(record);
}

/**
 * One candidate's answer. A sourced filing/activity record outranks a search
 * absence for the same candidate; all held filings remain. This is semantic
 * contradiction resolution, never a completeness threshold.
 */
export function stateMoneyRecordsForDisplay(records: readonly StateMoneyRecord[]): StateMoneyRecord[] {
  const eligible = records.filter(isRenderable);
  const filed = eligible.filter(r => r.filingState === "FILED");
  if (filed.length) return filed;
  const registered = eligible.filter(r => r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED");
  if (registered.length) return registered;
  const absent = eligible.filter(r => r.filingState === "NO_REPORTS_ON_FILE");
  if (absent.length) return absent.slice(0, 1);
  return eligible.filter(r => r.filingState === "OURS_GAP").slice(0, 1);
}
