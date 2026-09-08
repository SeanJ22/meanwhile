import type { RoutineRecordClass, SourceAuthorityContract } from "./types.ts";

/**
 * The one authority/competence registry for routine civic data. An adapter may
 * add parser mechanics, but it may not invent trusted hosts or competent facts.
 */
export const SOURCE_AUTHORITIES = {
  "fec-open-api": {
    id: "fec-open-api",
    publisher: "Federal Election Commission",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: ["https://api.open.fec.gov/v1/"],
    allowedFinalHosts: ["api.open.fec.gov"],
    jurisdictions: ["US"],
    recordClasses: ["FEC_FUNDING"],
    competentFacts: ["candidate registration", "committee registration", "filed totals", "filed receipts", "report coverage period"],
    expectedIdentifierKeys: ["candidate_id", "committee_id"],
    expectedTemporalFields: ["cycle", "coverage_end_date", "two_year_transaction_period"],
    horizonSemantics: "Each API query has its own filters and pagination. A candidate total or filed receipt is authoritative; the union of returned pages is complete only when pagination metadata proves the bounded query ended.",
    parserVersion: "fec-funding/2",
    freshnessExpectation: "Weekly; FEC processing itself may lag filings by days.",
    absencePolicy: { kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT", requiredKeys: ["office", "state", "district", "cycle", "pagination"] },
    routineAutoPromotion: true,
  },
  "census-data-api": {
    id: "census-data-api",
    publisher: "U.S. Census Bureau",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: ["https://api.census.gov/data/"],
    allowedFinalHosts: ["api.census.gov"],
    jurisdictions: ["US"],
    recordClasses: ["CENSUS_REFERENCE"],
    competentFacts: ["named Census product values", "product vintage", "Census geography code"],
    expectedIdentifierKeys: ["product", "vintage", "geography"],
    expectedTemporalFields: ["vintage"],
    horizonSemantics: "A wildcard geography query is complete only when its returned geography identifiers are unique and reconcile to the product's declared/expected cardinality.",
    parserVersion: "census-data-api/2",
    freshnessExpectation: "On publication of a newer supported product vintage; never silently substitute a different geography.",
    absencePolicy: { kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT", requiredKeys: ["product", "vintage", "geography", "wildcard"] },
    routineAutoPromotion: true,
  },
  "census-bulk-products": {
    id: "census-bulk-products",
    publisher: "U.S. Census Bureau",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: ["https://www2.census.gov/programs-surveys/gus/", "https://www2.census.gov/geo/tiger/"],
    allowedFinalHosts: ["www2.census.gov"],
    jurisdictions: ["US"],
    recordClasses: ["CENSUS_REFERENCE", "CENSUS_GEOGRAPHY"],
    competentFacts: ["Census of Governments unit classification", "Census GEOID", "TIGER/Line boundary", "statistical geography classification"],
    expectedIdentifierKeys: ["product", "vintage", "geoid"],
    expectedTemporalFields: ["vintage", "source_through"],
    horizonSemantics: "Completeness is product/vintage-specific and must reconcile archive members, feature/row cardinality, unique identifiers, and geographic relationships. Statistical place does not imply an independent government.",
    parserVersion: "census-bulk/2",
    freshnessExpectation: "At the supported product's official release cadence.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "az-legislature": {
    id: "az-legislature",
    publisher: "Arizona State Legislature",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "STATE_LEGISLATURE",
    routePrefixes: ["https://www.azleg.gov/", "https://apps.azleg.gov/", "https://www.azsenate.gov/", "https://www.azhouse.gov/"],
    allowedFinalHosts: ["www.azleg.gov", "azleg.gov", "apps.azleg.gov", "www.azsenate.gov", "azsenate.gov", "www.azhouse.gov", "azhouse.gov"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL"],
    competentFacts: ["legislative membership", "chamber", "district", "session", "official roll call", "bill action stage"],
    expectedIdentifierKeys: ["legislator", "legislature", "session", "rollCallId", "eventId"],
    expectedTemporalFields: ["legislature", "session", "term", "vote_date"],
    horizonSemantics: "A roster page speaks for the selected chamber/session. A bill page or journal speaks only for the identified action; an agenda or calendar is not a decision.",
    parserVersion: "az-legislature/2",
    freshnessExpectation: "Roster at least daily in session; roll calls after each sitting.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "nh-general-court": {
    id: "nh-general-court",
    publisher: "New Hampshire General Court",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "STATE_LEGISLATURE",
    routePrefixes: ["https://gc.nh.gov/downloads/", "https://gc.nh.gov/nhgcrollcalls/", "https://gc.nh.gov/"],
    allowedFinalHosts: ["gc.nh.gov"],
    jurisdictions: ["US-NH"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL"],
    competentFacts: ["legislative membership", "elected status", "chamber", "district", "committee assignment", "official roll call"],
    expectedIdentifierKeys: ["seatNo", "chamber", "district", "rollCallId", "eventId"],
    expectedTemporalFields: ["term", "session", "vote_date"],
    horizonSemantics: "Members.txt is the whole published roster file but states no row total; row disposition must reconcile to its logical input. Roll-call completeness is bounded only by an identified chamber/session index or database horizon.",
    parserVersion: "nh-general-court/2",
    freshnessExpectation: "Roster daily while membership changes; roll calls after each sitting.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "nj-legislature": {
    id: "nj-legislature",
    publisher: "New Jersey Legislature / Office of Legislative Services",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "STATE_LEGISLATURE",
    routePrefixes: ["https://www.njleg.state.nj.us/", "https://pub.njleg.state.nj.us/", "https://pub.njleg.gov/"],
    allowedFinalHosts: ["www.njleg.state.nj.us", "njleg.state.nj.us", "pub.njleg.state.nj.us", "pub.njleg.gov"],
    jurisdictions: ["US-NJ"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL"],
    competentFacts: ["legislative membership", "chamber", "district", "session", "official voting record", "bill action stage"],
    expectedIdentifierKeys: ["roster_id", "district", "house", "session", "rollCallId", "eventId"],
    expectedTemporalFields: ["legislative_session", "term", "vote_date"],
    horizonSemantics: "Roster/API results speak for their selected chamber/session. Voting records are complete only for the exact member/bill/session query the official surface defines.",
    parserVersion: "nj-legislature/2",
    freshnessExpectation: "Roster at least daily in session; voting records after publication.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  legiscan: {
    id: "legiscan",
    publisher: "LegiScan",
    trust: "T4_RESEARCH_SECONDARY",
    sourceClass: "INTERMEDIARY",
    routePrefixes: ["https://api.legiscan.com/", "https://legiscan.com/"],
    allowedFinalHosts: ["api.legiscan.com", "legiscan.com", "www.legiscan.com"],
    jurisdictions: ["US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL"],
    competentFacts: [],
    expectedIdentifierKeys: ["people_id", "roll_call_id", "session_id"],
    expectedTemporalFields: ["dataset_date", "session_id"],
    horizonSemantics: "Research/corroboration only; a vendor dataset hash is not official state authority.",
    parserVersion: "legiscan-bulk/1",
    freshnessExpectation: "Vendor weekly publication.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
  },
  "plural-openstates": {
    id: "plural-openstates",
    publisher: "Plural / Open States",
    trust: "T4_RESEARCH_SECONDARY",
    sourceClass: "INTERMEDIARY",
    routePrefixes: ["https://open.pluralpolicy.com/", "https://github.com/openstates/"],
    allowedFinalHosts: ["open.pluralpolicy.com", "github.com", "raw.githubusercontent.com"],
    jurisdictions: ["US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["STATE_LEGISLATOR"],
    competentFacts: [],
    expectedIdentifierKeys: ["person_id"],
    expectedTemporalFields: ["term"],
    horizonSemantics: "Research/corroboration only; an intermediary roster cannot auto-promote as official membership truth.",
    parserVersion: "plural-roster/1",
    freshnessExpectation: "Unknown intermediary lag; official term evidence is required for authoritative promotion.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
  },
} as const satisfies Readonly<Record<string, SourceAuthorityContract>>;

export type SourceAuthorityId = keyof typeof SOURCE_AUTHORITIES;

export function sourceAuthority(sourceId: string): SourceAuthorityContract | null {
  return (SOURCE_AUTHORITIES as Readonly<Record<string, SourceAuthorityContract>>)[sourceId] ?? null;
}

export function authorityFor(
  sourceId: string,
  recordClass: RoutineRecordClass,
  finalUrl: string,
): { readonly ok: true; readonly contract: SourceAuthorityContract } | { readonly ok: false; readonly code: string; readonly detail: string } {
  const contract = sourceAuthority(sourceId);
  if (!contract) return { ok: false, code: "SOURCE_NOT_REGISTERED", detail: `${sourceId} is not in SOURCE_AUTHORITIES.` };
  if (!contract.recordClasses.includes(recordClass)) {
    return { ok: false, code: "SOURCE_NOT_COMPETENT_FOR_RECORD_CLASS", detail: `${sourceId} is not registered for ${recordClass}.` };
  }
  let url: URL;
  try { url = new URL(finalUrl); }
  catch { return { ok: false, code: "FINAL_URL_INVALID", detail: `Final URL is not parseable: ${JSON.stringify(finalUrl)}.` }; }
  if (url.protocol !== "https:") return { ok: false, code: "FINAL_URL_NOT_HTTPS", detail: `${url.href} is not HTTPS.` };
  if (!contract.allowedFinalHosts.includes(url.hostname.toLowerCase())) {
    return { ok: false, code: "FINAL_HOST_NOT_AUTHORIZED", detail: `${url.hostname} does not inherit authority from ${sourceId}.` };
  }
  if (!contract.routePrefixes.some((prefix) => url.href.startsWith(prefix))) {
    return { ok: false, code: "FINAL_ROUTE_NOT_REGISTERED", detail: `${url.href} is on an inherited host but outside ${sourceId}'s registered publication routes.` };
  }
  if (!contract.routineAutoPromotion) {
    return { ok: false, code: "SOURCE_NOT_AUTO_PROMOTABLE", detail: `${sourceId} is ${contract.trust}; it remains research/corroboration only.` };
  }
  return { ok: true, contract };
}
