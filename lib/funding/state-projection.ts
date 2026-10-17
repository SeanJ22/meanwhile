import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { federalMoneyArtifactKey } from "../federal-money/edge.ts";
import { campaignFinanceNativeScope, campaignFinanceSource, campaignFinanceSourceId } from "./state-sources.ts";
import { campaignFinanceStateScope } from "./campaign-scopes.ts";

export interface CampaignFinanceFiler {
  readonly id: string;
  readonly state: string;
  readonly resource: string;
  readonly committeeId: string | null;
  readonly committeeName: string | null;
  readonly nativeGovernmentId: string | null;
  readonly governmentOcdId: string | null;
  readonly pages: string | null;
  readonly count: number;
  readonly unjoined: number;
  readonly pageCount: number;
  readonly evidenceHash: string;
  readonly contentHash: string;
}
export interface CampaignFinanceState {
  readonly id: string;
  readonly state: string;
  readonly groups: string | null;
  readonly places: string | null;
  readonly filers: string | null;
  readonly count: number;
  readonly unjoined: number;
  readonly resources: Readonly<Record<string, { readonly checkedAt: string; readonly complete: boolean; readonly publicationId: string }>>;
}
export interface CampaignFinanceGovernment {
  readonly id: string;
  readonly state: string;
  readonly filers: string | null;
  readonly count: number;
  readonly unjoined: number;
}
export type CampaignFinancePublication = {
  readonly kind: "campaign-finance-source-state";
  readonly state: string;
  readonly records: readonly CampaignFinanceState[];
} | {
  readonly kind: "campaign-finance-source-filer";
  readonly state: string;
  readonly records: readonly CampaignFinanceFiler[];
};

export const campaignFinanceDirectoryKey = (state: string) => `reader/campaign-finance/${campaignFinanceSource(state).state.toLowerCase()}/state.json`;
export function campaignFinanceGovernmentIssue(row: CampaignFinanceGovernment, state: string): string | null {
  if (campaignFinanceStateScope(row.id) !== `US-${state}:campaign-finance` || row.state !== state ||
      row.filers !== null && !federalMoneyArtifactKey(row.filers) || !Number.isSafeInteger(row.count) || row.count < 0 ||
      !Number.isSafeInteger(row.unjoined) || row.unjoined < 0 || row.unjoined > row.count) return "Campaign government crosses its state, counts or filer index.";
  return null;
}

export function campaignFinancePublicationIssue(value: CampaignFinancePublication, state: string): string | null {
  if (value?.state !== state || !Array.isArray(value.records) || value.records.length !== 1) return "Campaign publication has no single state-bound unit.";
  for (const record of value.records) {
    if (record.state !== state || typeof record.id !== "string" || !record.id || !Number.isSafeInteger(record.count) || record.count < 0 ||
      !Number.isSafeInteger(record.unjoined) || record.unjoined < 0 || record.unjoined > record.count) return "Campaign publication counts or state identity are invalid.";
    if (value.kind === "campaign-finance-source-state") {
      const row = record as CampaignFinanceState;
      if ([row.groups, row.places, row.filers].some(key => key !== null && !federalMoneyArtifactKey(key)) || !row.resources ||
          Object.values(row.resources).some(check => !Number.isFinite(Date.parse(check.checkedAt)) || typeof check.complete !== "boolean" || typeof check.publicationId !== "string" || !check.publicationId)) return "Campaign state indexes or source checks are invalid.";
    } else if (value.kind === "campaign-finance-source-filer") {
      const row = record as CampaignFinanceFiler;
      if (row.pages !== null && !federalMoneyArtifactKey(row.pages) || !Number.isSafeInteger(row.pageCount) || row.pageCount < 0 || !/^[a-f0-9]{64}$/.test(row.evidenceHash) || !/^[a-f0-9]{64}$/.test(row.contentHash)) return "Campaign government publication has an invalid bounded page index.";
    } else return "Campaign publication kind is invalid.";
  }
  return null;
}

export async function readCampaignFinancePublication(state: string, scope = campaignFinanceNativeScope(state), options: PromotedCivicDataReadOptions = {}) {
  if (scope !== campaignFinanceNativeScope(state) && !scope.startsWith(`${campaignFinanceSourceId(state)}:filer:`)) throw new Error("Campaign finance cannot read another state's records.");
  const result = await readPromotedCivicData<CampaignFinancePublication>("CURATED_READER_RECORD", scope, options);
  if (result.kind === "PROMOTED" && (result.metadata.sourceId !== campaignFinanceSourceId(state) || campaignFinancePublicationIssue(result.value, state))) throw new Error("Campaign source publication crosses its registered state or schema.");
  return result;
}
