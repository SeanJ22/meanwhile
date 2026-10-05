import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import type { StateMoneyRecord } from "./state-money.ts";

export const CAMPAIGN_FINANCE_SCOPE = "US:campaign-finance";
export const campaignFinanceScope = (ocdId: string) => {
  if (!jurisdictionFromOcdId(ocdId)) throw new Error("Campaign finance requires an exact state/local jurisdiction.");
  return `${CAMPAIGN_FINANCE_SCOPE}:${ocdId}`;
};
export interface CampaignFinanceRecord extends Readonly<Record<string, unknown>> {
  readonly kind: "CAMPAIGN_FINANCE_FILING" | "CAMPAIGN_FINANCE_DOCUMENT";
  readonly id: string;
  readonly ocdId: string;
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly collectedAt: string;
  readonly reportId: string | null;
  readonly record: StateMoneyRecord;
}
export interface CampaignFinanceProjection { readonly kind: "campaign-finance"; readonly records: readonly CampaignFinanceRecord[] }

/** CP-09: unknown amounts or filing periods leave a source document, never a Money figure. */
export function campaignFinanceRecordKind(record: StateMoneyRecord): CampaignFinanceRecord["kind"] {
  return typeof record.totals.coveringPeriod === "string" && Boolean(record.totals.coveringPeriod.trim()) &&
    [record.totals.receipts, record.totals.expenditures, record.totals.cashOnHand].some(amount => typeof amount === "number" && Number.isFinite(amount))
    ? "CAMPAIGN_FINANCE_FILING" : "CAMPAIGN_FINANCE_DOCUMENT";
}

export function campaignFinanceRecordIssue(value: unknown): string | null {
  const row = value as CampaignFinanceRecord;
  const record = row?.record, jurisdiction = jurisdictionFromOcdId(typeof row?.ocdId === "string" ? row.ocdId : "");
  if (!row || typeof row.id !== "string" || !/^finance-filing:[a-f0-9]{64}$/.test(row.id) || !jurisdiction || !/^https:\/\//.test(row.sourceUrl ?? "") ||
      !/^[a-f0-9]{64}$/.test(row.sourceHash ?? "") || !Number.isFinite(Date.parse(row.collectedAt)) ||
      !record || record.dataClass !== "STATE_COMMITTEE" || record.jurisdiction !== jurisdiction.usps || record.filingState !== "FILED" ||
      typeof record.agency !== "string" || !record.agency.trim() ||
      [record.committeeId, record.registeredName, record.candidateNameAsFiled, record.officeSought].some(value => typeof value !== "string" || !value.trim()) ||
      !Number.isSafeInteger(record.electionYear) || record.electionYear < 1900 ||
      !Array.isArray(record.targetKeys) || record.targetKeys.length !== 1 || typeof record.targetKeys[0] !== "string" || !record.targetKeys[0] || !record.match?.allThreeAgree ||
      record.match.officeAsFiled !== record.officeSought || record.match.electionYearAsFiled !== record.electionYear ||
      record.match.electionYearOnBallot !== record.electionYear || !record.match.officeOnBallot ||
      record.provenance?.sourceUrl !== row.sourceUrl || record.provenance.collectedAt !== row.collectedAt ||
      !Number.isFinite(Date.parse(record.provenance.verifiedAt ?? "")) || record.filingsUrl !== row.sourceUrl ||
      record.checkedAt !== row.collectedAt.slice(0, 10) || !record.totals ||
      [record.totals.receipts, record.totals.expenditures, record.totals.cashOnHand].some(amount => amount !== null &&
        (typeof amount !== "number" || !Number.isFinite(amount)))) return "Campaign filing lacks exact source, report totals or verified candidate/office/cycle/jurisdiction binding.";
  return row.kind !== campaignFinanceRecordKind(record) ? "Campaign source document does not meet the Money amount and filing-period minimum." : null;
}

export async function readCampaignFinance(ocdId: string, options: PromotedCivicDataReadOptions = {}) {
  const scope = campaignFinanceScope(ocdId);
  const result = await readPromotedCivicData<CampaignFinanceProjection>("CURATED_READER_RECORD", scope, options);
  if (result.kind === "PROMOTED" && (result.value.kind !== "campaign-finance" || !Array.isArray(result.value.records) ||
      result.value.records.some(row => row.ocdId !== ocdId || campaignFinanceRecordIssue(row)) ||
      new Set(result.value.records.map(row => row.id)).size !== result.value.records.length)) throw new Error("Campaign finance projection is invalid or crosses its jurisdiction.");
  return result;
}

/** Existing card/Ask readers use only this request's already loaded scoped edge entries; no optional database wake. */
const checkedEntries = new WeakMap<object, readonly CampaignFinanceRecord[]>();
export async function settleCampaignFinanceReads(): Promise<string[]> {
  const entries = [...currentReaderAuthorityEdge()?.promoted ?? []].filter(([key]) =>
    key.startsWith(`CURATED_READER_RECORD:${CAMPAIGN_FINANCE_SCOPE}:`));
  const read = await Promise.allSettled(entries.map(async ([key, entry]) => {
    checkedEntries.delete(entry);
    const division = key.slice(`CURATED_READER_RECORD:${CAMPAIGN_FINANCE_SCOPE}:`.length);
    const result = await readCampaignFinance(division, { edge: entry });
    if (result.kind !== "PROMOTED") return null;
    checkedEntries.set(entry, result.value.records);
    return `${key}:${result.metadata.versionId}`;
  }));
  return read.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}
export function campaignFinanceForTarget(targetKey: string): StateMoneyRecord[] {
  const records: StateMoneyRecord[] = [];
  for (const [key, entry] of currentReaderAuthorityEdge()?.promoted ?? []) {
    if (!key.startsWith(`CURATED_READER_RECORD:${CAMPAIGN_FINANCE_SCOPE}:`) || entry.kind !== "PROMOTED") continue;
    const scope = key.slice("CURATED_READER_RECORD:".length);
    for (const row of checkedEntries.get(entry) ?? []) if (campaignFinanceScope(row.ocdId) === scope && row.record.targetKeys.includes(targetKey)) {
      // Preserve all source cells in the typed holding; summary consumers show
      // only the document name/link while incomplete Money facts remain owed.
      records.push(row.kind === "CAMPAIGN_FINANCE_DOCUMENT" ? { ...row.record,
        totals: { ...row.record.totals, receipts: null, expenditures: null, cashOnHand: null } } : row.record);
    }
  }
  return records;
}
