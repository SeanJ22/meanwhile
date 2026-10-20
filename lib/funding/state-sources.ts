import type { SourceAuthorityContract } from "../civic-data/types.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";
import inventory from "../../data/campaign-finance/sources.json" with { type: "json" };
import { jurisdictionFromOcdId, US_JURISDICTIONS } from "../coverage/states.ts";

interface CampaignFinanceIndex {
  readonly url: string;
  readonly pattern: string;
  readonly downloadPrefix: string;
  readonly postback?: string;
  readonly method?: "POST";
  readonly body?: Readonly<Record<string, unknown>>;
  readonly rowPath?: string;
  readonly idField?: string;
  readonly urlTemplate?: string;
  readonly filter?: { readonly field: string; readonly value: string };
  readonly split?: { readonly field: string; readonly delimiter: string };
  readonly parameters?: readonly { readonly parameter: string; readonly field: string }[];
  readonly selectParameter?: { readonly name: string; readonly parameter: string; readonly valuePattern?: string };
  readonly childPattern?: string;
  readonly child?: CampaignFinanceIndex;
  readonly expectedFields?: Readonly<Record<string, string>>;
}

export interface CampaignFinanceResource {
  readonly id: string;
  readonly kind: "SOCRATA" | "JSON" | "CSV" | "ZIP";
  readonly url: string;
  readonly landingUrl?: string;
  readonly method?: "POST";
  readonly requestEncoding?: "FORM";
  readonly jsonQuery?: { readonly parameter: string; readonly field: string };
  readonly session?: { readonly url: string; readonly tokenField?: string; readonly hiddenFields?: boolean };
  readonly body?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly rowPath?: string;
  readonly jsonStringEnvelope?: string;
  readonly rowObject?: string;
  readonly expectedFields?: Readonly<Record<string, string>>;
  readonly dateEncoding?: "EPOCH_MILLISECONDS" | "DOTNET_MILLISECONDS";
  readonly totalPath?: string;
  readonly offsetParameter?: string;
  readonly offsetUnit?: "PAGE";
  readonly limitParameter?: string;
  readonly pageSize?: number;
  readonly errorsPath?: string;
  readonly throughDateParameter?: string;
  readonly firstOffset?: number;
  readonly delimiter?: string;
  readonly csvColumns?: readonly { readonly field: string; readonly header: string; readonly occurrence?: number }[];
  readonly quote?: string | null;
  readonly encoding?: string;
  readonly preambleRows?: number;
  readonly preamblePublicationDate?: string;
  readonly emptyResponse?: string;
  readonly filePattern?: string;
  readonly index?: CampaignFinanceIndex;
  readonly governmentOcdId?: string;
  readonly identity: readonly string[];
  readonly identityScope?: "PUBLICATION";
  readonly filer: readonly string[];
  readonly filerIdentity?: readonly string[];
  readonly filerName: readonly string[];
  readonly filerNameParts?: readonly string[];
  readonly filedCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly registrationTotals?: readonly string[];
  readonly financialReportCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly filedStatementField?: string;
  readonly candidate: readonly string[];
  readonly candidateParts?: readonly string[];
  readonly candidateCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly office: readonly string[];
  readonly period: readonly string[];
  readonly periodParts?: readonly string[];
  readonly periodQueryParameter?: string;
  readonly transactionDate: readonly string[];
  readonly publicationDate: readonly string[];
  readonly sourcePublicationDate?: readonly string[];
  readonly government: readonly string[];
  readonly amounts: readonly { readonly field: string; readonly label: string }[];
  readonly publisher?: string;
  readonly organization?: { readonly typeField: string; readonly types: readonly string[]; readonly nameFields: readonly string[] };
  readonly filingUrl?: { readonly field: string; readonly hosts: readonly string[] };
  readonly lookup?: { readonly entryPattern?: string; readonly url?: string; readonly relativeUrl?: string; readonly publicationResource?: string; readonly keys: readonly string[]; readonly filingKeys?: readonly string[]; readonly fields: readonly string[];
    readonly consistentFields?: readonly { readonly filing: string; readonly cover: string }[] };
  readonly qualifiers?: readonly { readonly field: string; readonly label: string }[];
  readonly title?: readonly string[];
  readonly summaryLine?: { readonly formField: string; readonly lineField: string; readonly labels: Readonly<Record<string, Readonly<Record<string, string>>>> };
}

interface CampaignFinanceSource {
  readonly state: string;
  readonly minimumYear: number;
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

export function campaignFinanceStateScope(ocdId: string): string {
  const state = jurisdictionFromOcdId(ocdId);
  if (!state) throw new Error("Campaign finance requires one exact state or local jurisdiction.");
  return campaignFinanceScopeForState(state.usps);
}

export function campaignFinanceScopeForState(state: string): string {
  if (!US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("Campaign finance requires a supported state or territory.");
  return `US-${state}:campaign-finance`;
}

export function campaignFinanceStateFromScope(scope: string): string | null {
  const state = /^US-([A-Z]{2}):campaign-finance$/.exec(scope)?.[1];
  return US_JURISDICTIONS.some(row => row.usps === state) ? state! : null;
}

export function isCampaignFinanceStateScope(scope: string): boolean {
  return campaignFinanceStateFromScope(scope) !== null;
}

export const CAMPAIGN_FINANCE_AUTHORITIES = Object.fromEntries(CAMPAIGN_FINANCE_SOURCES.map(source => {
  const id = campaignFinanceSourceId(source.state);
  return [id, {
    id, publisher: source.publisher, trust: "T1_AUTHORITATIVE_STRUCTURED", sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: [...new Set([source.officialUrl, source.accessEvidenceUrl, ...source.resources.flatMap(resource => [resource.url.split("?")[0], ...(resource.session ? [resource.session.url] : []), ...(resource.lookup?.url ? [resource.lookup.url] : []), ...(resource.index ? [resource.index.url, resource.index.downloadPrefix] : [])])])],
    jurisdictions: [`US-${source.state}`], recordClasses: ["CAMPAIGN_FINANCE"],
    competentFacts: ["source-native campaign filings", "filed transaction amounts", "native committee and local-government identifiers"],
    expectedIdentifierKeys: ["source_record_id"], expectedTemporalFields: ["publication_date", "retrieved_at"],
    horizonSemantics: "Source bytes retain unmatched work. Only filed money from 2020 onward, bound to a published person and exact seat, reaches readers. A source failure preserves verified evidence.",
    parserVersion: CAMPAIGN_FINANCE_PARSER, freshnessExpectation: "Conditional daily reads following the publisher's updates; provider Retry-After is honored.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" }, routineAutoPromotion: true,
  }];
})) as Readonly<Record<`US-${string}:campaign-finance-source`, SourceAuthorityContract>>;

interface CampaignFinanceRows {
  readonly kind: "campaign-finance-source-rows";
  readonly state: string;
  readonly resource: string;
  readonly records: readonly CampaignSourceRecord[];
}

interface CampaignFinanceCheck {
  readonly kind: "campaign-finance-source-check";
  readonly state: string;
  readonly resource: string;
  readonly records: readonly { readonly id: string; readonly state: string; readonly checkedAt: string; readonly rawHash: string; readonly loaded: number; readonly unjoined: number }[];
}
export type CampaignFinancePublication = CampaignFinanceRows | CampaignFinanceCheck;

export function campaignFinancePublicationIssue(value: CampaignFinancePublication, state: string): string | null {
  if (value?.kind === "campaign-finance-source-check") {
    const row = value.records[0];
    return value.state !== state || value.records.length !== 1 || !row || row.state !== state || row.id !== value.resource ||
      !Number.isFinite(Date.parse(row.checkedAt)) || !/^[a-f0-9]{64}$/.test(row.rawHash) || !Number.isSafeInteger(row.loaded) || row.loaded < 0 ||
      !Number.isSafeInteger(row.unjoined) || row.unjoined < 0 || row.unjoined > row.loaded ? "Campaign source check is invalid." : null;
  }
  if (value?.kind !== "campaign-finance-source-rows" || value.state !== state || !value.resource ||
      !Array.isArray(value.records) || value.records.length > 500) return "Campaign publication requires one bounded batch from its own state.";
  for (const row of value.records as readonly CampaignSourceRecord[]) {
    if (row.state !== state || row.resource !== value.resource || typeof row.id !== "string" || !row.id.startsWith(`${state}:`) ||
        row.governmentOcdId !== null && campaignFinanceStateScope(row.governmentOcdId) !== `US-${state}:campaign-finance` ||
        !row.provenance?.official || !/^[a-f0-9]{64}$/.test(row.provenance.rawHash) || !row.provenance.vaultKey ||
        !Number.isFinite(Date.parse(row.provenance.retrievedAt)) || row.amounts.some(amount => !Number.isFinite(amount.amount))) return "Campaign fact crosses its source, state or saved evidence.";
  }
  return null;
}
