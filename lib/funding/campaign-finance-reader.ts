import { readerCanonicalEntries, readerCanonicalEntry } from "../reader/canonical-context.ts";
import { validFinanceDoorDetailSource } from "./finance-detail-source.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge, ensurePromotedEdge } from "../registry/runtime-edge.ts";
import type { StateMoneyRecord } from "./state-money.ts";
import { stateMoneyFundingIssue } from "./state-money-funding.ts";
import { campaignFinanceStateScope, isCampaignFinanceStateScope, campaignFinanceNativeScope, campaignFinanceSourceId, campaignFinancePublicationIssue, type CampaignFinancePublication } from "./state-sources.ts";

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

export function campaignFinanceRecordKind(record: StateMoneyRecord): CampaignFinanceRecord["kind"] {
  return typeof record.totals.coveringPeriod === "string" && Boolean(record.totals.coveringPeriod.trim()) &&
    [record.totals.receipts, record.totals.expenditures, record.totals.cashOnHand, record.funding?.individualTotal,
      record.funding?.individualItemized, record.funding?.individualUnitemized, ...(record.funding?.organizations.map(row => row.amount) ?? [])]
      .some(amount => typeof amount === "number" && Number.isFinite(amount))
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
  if (record.detailSource !== undefined && (!validFinanceDoorDetailSource(record.detailSource) || record.detailSource.ocdId !== row.ocdId || record.detailSource.committeeId !== record.committeeId || record.detailSource.candidateName !== record.candidateNameAsFiled || record.detailSource.office !== record.officeSought || record.detailSource.electionYear !== record.electionYear || !record.detailSource.hosts.includes(new URL(row.sourceUrl).hostname))) return "Finance detail source crosses its held filing identity.";
  if (record.funding !== undefined && (stateMoneyFundingIssue(record.funding) || record.funding.organizations.some(org => org.sourceUrl !== row.sourceUrl))) return "Campaign contributors lack their filed entity class, amounts or exact filing source.";
  return row.kind !== campaignFinanceRecordKind(record) ? "Campaign source document does not meet the Money amount and filing-period minimum." : null;
}

export async function readCampaignFinance(ocdId: string, options: PromotedCivicDataReadOptions = {}) {
  const scope = isCampaignFinanceStateScope(ocdId) ? ocdId : campaignFinanceStateScope(ocdId);
  const result = await readPromotedCivicData<CampaignFinanceProjection>("CURATED_READER_RECORD", scope, options);
  if (result.kind === "PROMOTED" && (result.value.kind !== "campaign-finance" || !Array.isArray(result.value.records) ||
      result.value.records.some(row => campaignFinanceStateScope(row.ocdId) !== scope || campaignFinanceRecordIssue(row)) ||
      new Set(result.value.records.map(row => row.id)).size !== result.value.records.length)) throw new Error("Campaign finance projection is invalid or crosses its jurisdiction.");
  return result.kind === "PROMOTED" && !isCampaignFinanceStateScope(ocdId)
    ? { ...result, value: { ...result.value, records: result.value.records.filter(row => row.ocdId === ocdId) } } : result;
}

const checkedRequests = new WeakMap<object, Map<string, readonly CampaignFinanceRecord[]>>();
export async function settleCampaignFinanceReads(divisions?: readonly string[]): Promise<string[]> {
  const edge = currentReaderAuthorityEdge(), context = edge ?? currentReaderSelection();
  const scopes = divisions ? [...new Set(divisions.map(campaignFinanceStateScope))]
    : [...new Set([...readerCanonicalEntries().keys(), ...edge?.promoted?.keys() ?? []])]
    .filter(key => key.startsWith("CURATED_READER_RECORD:")).map(key => key.slice("CURATED_READER_RECORD:".length)).filter(isCampaignFinanceStateScope);
  const held = context ? checkedRequests.get(context) ?? new Map<string, readonly CampaignFinanceRecord[]>() : null;
  if (context && held) checkedRequests.set(context, held);
  const read = await Promise.allSettled(scopes.map(async scope => {
    held?.delete(scope);
    const canonical = edge ? undefined : readerCanonicalEntry("CURATED_READER_RECORD", scope);
    const entry = canonical ? await canonical : (await ensurePromotedEdge("CURATED_READER_RECORD", scope))?.value;
    const result = await readCampaignFinance(scope, entry ? { edge: entry } : {});
    if (result.kind === "STORE_UNREACHABLE") throw new Error(result.detail);
    if (result.kind !== "PROMOTED") return null;
    held?.set(scope, result.value.records);
    return `CURATED_READER_RECORD:${scope}:${result.metadata.versionId}`;
  }));
  const failures = read.filter(result => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Applicable campaign-finance holdings could not be read.");
  return read.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}
export function campaignFinanceForTarget(targetKey: string): StateMoneyRecord[] {
  const context = currentReaderAuthorityEdge() ?? currentReaderSelection(), records: StateMoneyRecord[] = [];
  for (const [scope, rows] of context ? checkedRequests.get(context) ?? [] : []) {
    for (const row of rows) if (campaignFinanceStateScope(row.ocdId) === scope && row.record.targetKeys.includes(targetKey)) {
      records.push(row.kind === "CAMPAIGN_FINANCE_DOCUMENT" ? { ...row.record,
        funding: undefined, totals: { ...row.record.totals, receipts: null, expenditures: null, cashOnHand: null } } : row.record);
    }
  }
  return records;
}

export async function readCampaignFinancePublication(state: string, scope = campaignFinanceNativeScope(state), options: PromotedCivicDataReadOptions = {}) {
  if (scope !== campaignFinanceNativeScope(state) && !scope.startsWith(`${campaignFinanceSourceId(state)}:resource:`)) throw new Error("Campaign finance cannot read another state's records.");
  const result = await readPromotedCivicData<CampaignFinancePublication>("CAMPAIGN_FINANCE", scope, options);
  if (result.kind === "PROMOTED" && (result.metadata.sourceId !== campaignFinanceSourceId(state) || campaignFinancePublicationIssue(result.value, state))) throw new Error("Campaign source publication crosses its registered state or schema.");
  return result;
}
