import type { SourceAuthorityContract } from "../../civic-data/types.ts";
import { FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, FEDERAL_SOURCES, type FederalSourceId } from "./targets.ts";

function authority(id: FederalSourceId): SourceAuthorityContract {
  const source = FEDERAL_SOURCES[id];
  return { id, publisher: source.publisher, trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: id === "congress-api" || id === "senate-lda" ? "FEDERAL_LEGISLATURE" : "FEDERAL_AGENCY",
    routePrefixes: [source.url, ...(id === "govinfo" ? ["https://www.govinfo.gov/"] : []), ...(id === "senate-lda" ? ["https://lda.senate.gov/api/v1/"] : [])],
    jurisdictions: ["US"], recordClasses: [FEDERAL_RECORD_CLASS],
    competentFacts: ["native member and bill identifiers", "sponsored legislation", "bill committee referrals", "official bill text editions", "agency rule and comment deadline", "filed lobbying contributions"],
    expectedIdentifierKeys: ["native_id"], expectedTemporalFields: ["published_at", "checked_at"],
    horizonSemantics: "Paged national acquisition publishes source-native partitions immediately. Unjoined rows stay held under their own IDs; no name or state guess establishes a member join.",
    parserVersion: FEDERAL_PARSER_VERSION, freshnessExpectation: source.clock, absencePolicy: { kind: "NEVER_FROM_ZERO" }, routineAutoPromotion: true };
}
export const FEDERAL_SOURCE_AUTHORITIES = {
  "congress-api": authority("congress-api"), govinfo: authority("govinfo"), "regulations-gov": authority("regulations-gov"),
  "federal-register": authority("federal-register"), "senate-lda": authority("senate-lda"),
};
