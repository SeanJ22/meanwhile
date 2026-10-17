import type { SourceAuthorityContract } from "../civic-data/types.ts";
import { CAMPAIGN_FINANCE_PARSER, CAMPAIGN_FINANCE_SOURCES, campaignFinanceSourceId } from "./state-sources.ts";

export const CAMPAIGN_FINANCE_AUTHORITIES = Object.fromEntries(CAMPAIGN_FINANCE_SOURCES.map(source => {
  const id = campaignFinanceSourceId(source.state);
  return [id, {
    id, publisher: source.publisher, trust: "T1_AUTHORITATIVE_STRUCTURED", sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: [...new Set([source.officialUrl, ...source.resources.flatMap(resource => [resource.url.split("?")[0], ...(resource.index ? [resource.index.url, resource.index.downloadPrefix] : [])])])],
    jurisdictions: [`US-${source.state}`], recordClasses: ["CURATED_READER_RECORD"],
    competentFacts: ["source-native campaign filings", "filed transaction amounts", "native committee and local-government identifiers"],
    expectedIdentifierKeys: ["source_record_id"], expectedTemporalFields: ["publication_date", "retrieved_at"],
    horizonSemantics: "Each complete native extract retains every row. Native local-government IDs remain distinct from independently bound governments. A source failure preserves the prior accepted publication.",
    parserVersion: CAMPAIGN_FINANCE_PARSER, freshnessExpectation: "Conditional daily reads following the publisher's updates; provider Retry-After is honored.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" }, routineAutoPromotion: true,
  }];
})) as Readonly<Record<`US-${string}:campaign-finance-source`, SourceAuthorityContract>>;
