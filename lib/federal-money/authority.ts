import { FEDERAL_MONEY_SOURCES, FEDERAL_MONEY_PARSER, type FederalMoneySource } from "./model.ts";
import { FEDERAL_MONEY_CONFIG, FEDERAL_MONEY_STATES } from "./sources.ts";
import type { SourceAuthorityContract } from "../civic-data/types.ts";

export const FEDERAL_MONEY_AUTHORITIES = Object.fromEntries(FEDERAL_MONEY_SOURCES.map(source => [source, {
  id: source, publisher: FEDERAL_MONEY_CONFIG[source].publisher, trust: "T1_AUTHORITATIVE_STRUCTURED",
  sourceClass: "FEDERAL_AGENCY", routePrefixes: [FEDERAL_MONEY_CONFIG[source].route],
  jurisdictions: ["US", ...FEDERAL_MONEY_STATES.map(state => `US-${state}`)], recordClasses: ["FEDERAL_MONEY"],
  competentFacts: ["federal awards", "single-audit findings", "entity registration and UEI", "county disaster declarations"],
  expectedIdentifierKeys: ["source_record_id"], expectedTemporalFields: ["publication_date", "retrieved_at"],
  horizonSemantics: "Source-native pages and extracts cover every state. A partially acquired or unmatched row is retained and reports no absence. Recipient identity and geographic reach are distinct.",
  parserVersion: FEDERAL_MONEY_PARSER, freshnessExpectation: FEDERAL_MONEY_CONFIG[source].clock,
  absencePolicy: { kind: "NEVER_FROM_ZERO" }, routineAutoPromotion: true,
}])) as unknown as Readonly<Record<FederalMoneySource, SourceAuthorityContract>>;
