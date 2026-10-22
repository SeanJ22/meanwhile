import type { SourceAuthorityContract } from "../civic-data/types.ts";
import inventory from "../../data/campaign-finance/sources.json" with { type: "json" };
import { jurisdictionFromOcdId, US_JURISDICTIONS } from "../coverage/states.ts";

interface CampaignFinanceIndex {
  readonly url: string;
  readonly pattern: string;
  readonly downloadPrefix: string;
  readonly postback?: string;
  readonly method?: "POST";
  readonly body?: Readonly<Record<string, unknown>>;
  readonly headers?:Readonly<Record<string,string>>;
  readonly rowPath?: string;
  readonly singleUrlField?:string;
  readonly throughDateArray?:string;
  readonly idField?: string;
  readonly urlTemplate?: string;
  readonly filter?: { readonly field: string; readonly value: string };
  readonly yearField?:string;
  readonly split?: { readonly field: string; readonly delimiter: string };
  readonly parameters?: readonly { readonly parameter: string; readonly field: string }[];
  readonly selectParameter?: { readonly name: string; readonly parameter: string; readonly valuePattern?: string };
  readonly childPattern?: string;
  readonly child?: CampaignFinanceIndex;
  readonly expectedFields?: Readonly<Record<string, string>>;
}

export interface CampaignFinanceResource {
  readonly id: string;
  readonly aggregation?: "TRANSACTION" | "CYCLE_TOTAL";
  readonly individual?: {readonly typeField:string;readonly types:readonly string[];readonly nameFields:readonly string[];readonly nameParts?:readonly string[];readonly identityFields:readonly string[]};
  readonly individualLines?: {readonly threshold:200;readonly small:string;readonly large:string};
  readonly receipts?: boolean;
  readonly since?: {readonly field:string;readonly kind:"YEAR"|"DATE"};
  readonly releaseVersionUrl?:string;
  readonly releaseVersionPath?:string;
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
  readonly filerFallbackParts?: readonly string[];
  readonly filedCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly registrationTotals?: readonly string[];
  readonly financialReportCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly filedStatementField?: string;
  readonly candidate: readonly string[];
  readonly candidateParts?: readonly string[];
  readonly candidateCondition?: { readonly field: string; readonly values: readonly string[] };
  readonly office: readonly string[];
  readonly district?:readonly string[];
  readonly jurisdiction?:readonly string[];
  readonly period: readonly string[];
  readonly cycle?:readonly string[];
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
export const CAMPAIGN_FINANCE_PARSER = "campaign-finance-source/2";
export const CAMPAIGN_MONEY_SOURCE_ID = "campaign-money";
export const CAMPAIGN_MONEY_SCOPE = "campaign-money:hourly";
const campaignFinanceSourceId = (state: string): `US-${string}:campaign-finance-source` => `US-${campaignFinanceSource(state).state}:campaign-finance-source`;
export const campaignFinanceNativeScope = (state: string): string => `${CAMPAIGN_MONEY_SOURCE_ID}:US-${campaignFinanceSource(state).state}`;

export function campaignFinanceSource(state: string): CampaignFinanceSource {
  const source = CAMPAIGN_FINANCE_SOURCES.find(row => row.state === state);
  if (!source || !US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("Campaign finance requires a supported state or territory.");
  return source;
}
export function campaignMoneySourceResources(state:string):readonly CampaignFinanceResource[]{
  return campaignFinanceSource(state).resources.filter(resource=>resource.cycle?.length && resource.office.length &&
    (resource.candidate.length || resource.candidateParts?.length) && resource.aggregation);
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

function campaignFinanceStateFromScope(scope: string): string | null {
  const state = /^US-([A-Z]{2}):campaign-finance$/.exec(scope)?.[1];
  return US_JURISDICTIONS.some(row => row.usps === state) ? state! : null;
}

export function isCampaignFinanceStateScope(scope: string): boolean {
  return campaignFinanceStateFromScope(scope) !== null;
}

const stateAuthorities = Object.fromEntries(CAMPAIGN_FINANCE_SOURCES.map(source => {
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

export const CAMPAIGN_FINANCE_AUTHORITIES = { ...stateAuthorities,
  [CAMPAIGN_MONEY_SOURCE_ID]: {
    id: CAMPAIGN_MONEY_SOURCE_ID, publisher: "Meanwhile campaign refresh reports",
    trust: "T2_AUTHORITATIVE_DOCUMENT", sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US", ...CAMPAIGN_FINANCE_SOURCES.map(source => `US-${source.state}`)],
    recordClasses: ["CAMPAIGN_FINANCE"], competentFacts: ["published-person refresh counts", "campaign money work and remaining gaps"],
    expectedIdentifierKeys: ["source_record_id"], expectedTemporalFields: ["checked_at", "retrieved_at"],
    horizonSemantics: "One state worker at a time checks published officeholders and November 3, 2026 candidates. Missing and unmatched money stays open.",
    parserVersion: CAMPAIGN_FINANCE_PARSER, freshnessExpectation: "Hourly people scans; each person's daily check and each publisher's release clock are independent.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" }, routineAutoPromotion: true,
    derivedPromotion: { inputKinds: ["PROMOTED_VERSION", "VAULTED_EVIDENCE"], authorization: "SRC-MN: standing hourly person-bound money work" },
  },
} as const satisfies Readonly<Record<string, SourceAuthorityContract>>;

export interface CampaignFinanceWorkCheck {
  readonly kind: "campaign-finance-work-check";
  readonly state: string;
  readonly resource: "people";
  readonly records: readonly { readonly id:string;readonly state:string;readonly checkedAt:string;readonly startedAt?:string;readonly publishedPeople:number;readonly peopleWorked:number;readonly peopleWithMoney:number;readonly loaded:number;readonly unmatched:number;readonly reasons:Readonly<Record<string,number>>;readonly peakMemoryBytes:number }[];
}
export type CampaignFinancePublication = CampaignFinanceWorkCheck;

export function campaignFinancePublicationIssue(value: CampaignFinancePublication, state: string): string | null {
  if(value?.kind === "campaign-finance-work-check"){
    const row=value.records?.[0];
    return value.state===state && value.resource==="people" && value.records.length===1 && row?.state===state && !!row.id &&
      Number.isFinite(Date.parse(row.checkedAt)) && [row.publishedPeople,row.peopleWorked,row.peopleWithMoney,row.loaded,row.unmatched,row.peakMemoryBytes].every(n=>Number.isSafeInteger(n)&&n>=0)
      ? null : "Campaign work check is incomplete";
  }
  return "Campaign work check is not recognized";
}

export async function runCampaignMoneyStates(visit:(state:string)=>Promise<void>){
  for(const source of CAMPAIGN_FINANCE_SOURCES)await visit(source.state);
}
