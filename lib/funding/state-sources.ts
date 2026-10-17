import inventory from "../../data/campaign-finance/sources.json" with { type: "json" };
import { US_JURISDICTIONS } from "../coverage/states.ts";

export interface CampaignFinanceResource {
  readonly id: string;
  readonly kind: "SOCRATA" | "JSON" | "CSV" | "ZIP";
  readonly url: string;
  readonly landingUrl?: string;
  readonly method?: "POST";
  readonly body?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly rowPath?: string;
  readonly totalPath?: string;
  readonly offsetParameter?: string;
  readonly offsetUnit?: "PAGE";
  readonly limitParameter?: string;
  readonly pageSize?: number;
  readonly errorsPath?: string;
  readonly firstOffset?: number;
  readonly delimiter?: string;
  readonly quote?: string | null;
  readonly encoding?: string;
  readonly preambleRows?: number;
  readonly filePattern?: string;
  readonly index?: { readonly url: string; readonly pattern: string; readonly downloadPrefix: string; readonly postback?: string;
    readonly method?: "POST"; readonly body?: Readonly<Record<string, unknown>>;
    readonly rowPath?: string; readonly idField?: string; readonly urlTemplate?: string; readonly filter?: { readonly field: string; readonly value: string };
    readonly split?: { readonly field: string; readonly delimiter: string }; readonly parameters?: readonly { readonly parameter: string; readonly field: string }[] };
  readonly governmentOcdId?: string;
  readonly identity: readonly string[];
  readonly committee: readonly string[];
  readonly committeeName: readonly string[];
  readonly committeeNameParts?: readonly string[];
  readonly candidate: readonly string[];
  readonly candidateParts?: readonly string[];
  readonly candidateCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly office: readonly string[];
  readonly period: readonly string[];
  readonly periodParts?: readonly string[];
  readonly transactionDate: readonly string[];
  readonly publicationDate: readonly string[];
  readonly government: readonly string[];
  readonly amounts: readonly { readonly field: string; readonly label: string }[];
  readonly publisher?: string;
  readonly organization?: { readonly typeField: string; readonly types: readonly string[]; readonly nameFields: readonly string[] };
  readonly filingUrl?: { readonly field: string; readonly hosts: readonly string[] };
  readonly lookup?: { readonly entryPattern: string; readonly keys: readonly string[]; readonly filingKeys?: readonly string[]; readonly fields: readonly string[];
    readonly consistentFields?: readonly { readonly filing: string; readonly cover: string }[] };
  readonly qualifiers?: readonly { readonly field: string; readonly label: string }[];
  readonly summaryLine?: { readonly formField: string; readonly lineField: string; readonly labels: Readonly<Record<string, Readonly<Record<string, string>>>> };
}

interface CampaignFinanceSource {
  readonly state: string;
  readonly publisher: string;
  readonly officialUrl: string;
  readonly accessType: "BULK" | "API" | "BULK_API" | "WEB" | "UNCONFIRMED";
  readonly checkedAt: string;
  readonly resources: readonly CampaignFinanceResource[];
  readonly discoveryStatus: string;
  readonly accessEvidenceUrl: string;
}

export const CAMPAIGN_FINANCE_SOURCES = inventory as readonly CampaignFinanceSource[];
export const CAMPAIGN_FINANCE_PARSER = "campaign-finance-source/1";
export const campaignFinanceSourceId = (state: string): `US-${string}:campaign-finance-source` => `US-${campaignFinanceSource(state).state}:campaign-finance-source`;
export const campaignFinanceNativeScope = (state: string): string => `${campaignFinanceSourceId(state)}:state`;

export function campaignFinanceSource(state: string): CampaignFinanceSource {
  const source = CAMPAIGN_FINANCE_SOURCES.find(row => row.state === state);
  if (!source || !US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("Campaign finance requires a supported state or territory.");
  return source;
}
