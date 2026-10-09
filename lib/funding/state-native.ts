import { computeSplit, type StateMoneyRecord, type StateMoneySnapshot } from "./state-money.ts";
import type { StateCampaignFinanceJurisdiction } from "./data-plane.ts";

export const stateFinanceTarget = (state: string, committeeId: string, year: number) => `state-finance:${state}:${committeeId}:${year}`;
export function financeYear(value?: string, date = new Date()): number {
  const year = value === undefined ? date.getUTCFullYear() : Number(value);
  if (!Number.isSafeInteger(year) || year < 1900 || year > 9999) throw new Error("STATE_FINANCE_PERIOD_INVALID");
  return year;
}

/** A source-native committee, amount and period are sufficient to publish a filing. */
export function nativeStateMoneyRecord(input: {
  state: StateCampaignFinanceJurisdiction; committeeId: string; name: string; candidateName: string;
  office: string | null; year: number; receipts: number | null; spent: number | null;
  reportCount?: number | null; period: string; sourceUrl: string; agency: string; observedAt: string;
  filingState?: StateMoneyRecord["filingState"];
}): StateMoneyRecord {
  if (!input.committeeId.trim() || !input.name.trim() || !Number.isSafeInteger(input.year) || input.year < 1900 ||
      !input.period.trim() || !Number.isFinite(Date.parse(input.observedAt)) ||
      [input.receipts, input.spent].some(value => value !== null && !Number.isFinite(value))) throw new Error("STATE_FINANCE_NATIVE_RECORD_INVALID");
  return {
    dataClass: "STATE_COMMITTEE", identityBasis: "NATIVE_FILER", jurisdiction: input.state,
    agency: input.agency, filingsUrl: input.sourceUrl, committeeId: input.committeeId,
    registeredName: input.name, candidateNameAsFiled: input.candidateName, officeSought: input.office,
    electionYear: input.year, filingState: input.filingState ?? (input.receipts !== null || input.spent !== null ? "FILED" : "ROUTE_UNREAD"),
    totals: { receipts: input.receipts, expenditures: input.spent, cashOnHand: null,
      reportCount: input.reportCount ?? null, coveringPeriod: input.period },
    targetKeys: [stateFinanceTarget(input.state, input.committeeId, input.year)],
    match: { registeredName: input.name, officeAsFiled: input.office, officeOnBallot: null,
      electionYearAsFiled: input.year, electionYearOnBallot: input.year, allThreeAgree: false,
      note: "Source-native committee identity; no cross-source person or ballot relationship is inferred." },
    checkedAt: input.observedAt.slice(0, 10), provenance: { sourceUrl: input.sourceUrl, sourceOrg: input.agency,
      collectedAt: input.observedAt, verifiedAt: input.observedAt },
  };
}

/** Native updates preserve source-proven aliases and failed records, never guessed name joins. */
export function upsertStateMoney(prior: StateMoneySnapshot | null, incoming: readonly StateMoneyRecord[], input: {
  state: StateCampaignFinanceJurisdiction; year: number; observedAt: string; refreshAttempts?: Record<string, string>; acquisitionCursors?: Record<string, number>;
}): StateMoneySnapshot {
  const identity = (row: StateMoneyRecord) => row.committeeId
    ? `${row.jurisdiction}:${row.committeeId}:${row.electionYear}` : `${row.jurisdiction}:target:${row.targetKeys.toSorted().join("|")}:${row.electionYear}`;
  const records = new Map((prior?.records ?? []).map(row => [identity(row), row]));
  for (const record of incoming) {
    const key = identity(record), held = records.get(key);
    if (record.filingState === "ROUTE_UNREAD" && held) continue;
    const sameSubject = held?.candidateNameAsFiled === record.candidateNameAsFiled && held.officeSought === record.officeSought;
    const verifiedAlias = held?.match.allThreeAgree && sameSubject;
    // A summary read cannot erase independently held optional source facts. A
    // changed person/office keeps its new native facts without the old alias.
    const merged = sameSubject ? { ...record,
      ...(record.funding ?? held?.funding ? { funding: record.funding ?? held?.funding } : {}),
      ...(record.detailSource ?? held?.detailSource ? { detailSource: record.detailSource ?? held?.detailSource } : {}),
    } : record;
    records.set(key, verifiedAlias ? { ...merged, identityBasis: "CANDIDACY", match: held.match,
      targetKeys: [...new Set([...record.targetKeys, ...held.targetKeys])] } : merged);
  }
  const rows = [...records.values()];
  const inScope = new Set(rows.flatMap(row => row.targetKeys)).size;
  const split = computeSplit(rows, inScope);
  return { formatVersion: 1, collectedAt: input.observedAt, cycle: input.year, records: rows, split,
    byJurisdiction: { [input.state]: { inScope, filed: split.filed, noReports: split.noReportsOnFile,
      lead: split.lead, routeUnread: split.routeUnread, registeredNoActivityReported: split.registeredNoActivityReported } },
    refreshAttempts: input.refreshAttempts ?? prior?.refreshAttempts, acquisitionCursors: input.acquisitionCursors ?? prior?.acquisitionCursors };
}
