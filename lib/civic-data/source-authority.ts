import { REGISTRATION_PARSER_VERSION, REGISTRATION_SOURCE_ROUTE_PREFIX, REGISTRATION_TARGETS } from "../registration/publication.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import {
  MANUAL_SOURCE_CLASSES,
  type ManualSourceSetReceipt,
  type RoutineRecordClass,
  type SourceAuthorityContract,
} from "./types.ts";

export interface OfficialLinkingPage {
  readonly url: string;
  readonly html: string;
  readonly linkingPage?: OfficialLinkingPage | null;
}

// Plain string parsing: this runs inside the isolated Validator realm, which has no URL global.
const hostOf = (url: string, base?: string): string | null => {
  const absolute = /^(https?):\/\/([^/?#\s]+)/i.exec(url.trim());
  if (absolute) {
    const host = absolute[2].replace(/^[^@]*@/, "").replace(/:\d*$/, "").toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) ? host.replace(/^www\./, "") : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url.trim())) return null; // mailto:, tel:, javascript: — not a page
  if (url.trim().startsWith("//")) return hostOf(`https:${url.trim()}`);
  return base === undefined ? null : hostOf(base);
};

/** Any `.gov` site is official; any other site is official once an official government page links to it. No host list. */
export function isOfficialSource(url: string, linkingPage?: OfficialLinkingPage | null): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  if (/(^|\.)gov$/.test(host)) return true;
  if (!linkingPage || !isOfficialSource(linkingPage.url, linkingPage.linkingPage)) return false;
  for (const match of linkingPage.html.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (hostOf((match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, "&"), linkingPage.url) === host) return true;
  }
  return false;
}

export const SOURCE_AUTHORITIES = {
  "official-ballot-authorities": {
    id: "official-ballot-authorities",
    publisher: "Exact official election authorities in the saved-source receipt",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US", ...REGISTRATION_TARGETS.map(target => target.jurisdiction)],
    recordClasses: ["BALLOT_CANDIDACY"],
    competentFacts: ["election", "contest", "complete listed candidate set", "filed candidate name", "party", "seat count"],
    expectedIdentifierKeys: ["contest_id", "candidacy_id"],
    expectedTemporalFields: ["source_through", "collected_at"],
    horizonSemantics: "Each state/election key contains only source-verified complete contests; no wider coverage or absence is inferred.",
    parserVersion: "ballot-contests/1",
    freshnessExpectation: "Recheck saved election lists inside the BALLOT_CONTEST freshness window; source gaps remain owed.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"] },
  },
  "federal-legislative-records": {
    id: "federal-legislative-records",
    publisher: "U.S. House Clerk, U.S. Senate, and Congress.gov",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_LEGISLATURE",
    routePrefixes: [
      "https://clerk.house.gov/",
      "https://www.senate.gov/legislative/",
      "https://api.congress.gov/v3/",
      "https://www.congress.gov/bill/",
    ],
    jurisdictions: ["US"],
    recordClasses: ["FEDERAL_ROLL_CALL", "FEDERAL_KEY_VOTE"],
    competentFacts: [
      "federal roll-call identity",
      "chamber question and result",
      "recorded member position",
      "bill identity and official title",
      "bill action stage",
    ],
    expectedIdentifierKeys: ["roll_call_id", "entry_id"],
    expectedTemporalFields: ["congress", "session", "vote_date", "source_through"],
    horizonSemantics: "A recent-vote projection is bounded by the declared per-chamber roll window. A reviewed key-question version is bounded by every explicitly selected chamber roll, and each official roll must be acquired before promotion.",
    parserVersion: "federal-votes/2",
    freshnessExpectation: "Manual owner-directed acquisition; no standing clock. Every acquisition produces a durable candidate/outcome receipt.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "congress-directory-project": {
    id: "congress-directory-project",
    publisher: "unitedstates/congress-legislators (community-maintained directory project)",
    trust: "T3_ATTRIBUTED_PRIMARY",
    sourceClass: "INTERMEDIARY",
    routePrefixes: ["https://raw.githubusercontent.com/unitedstates/congress-legislators/"],
    jurisdictions: ["US"],
    recordClasses: ["FEDERAL_DIRECTORY"],
    competentFacts: ["current federal membership", "term and chamber", "official contact", "district office", "official social account", "committee membership"],
    expectedIdentifierKeys: ["bioguide_id", "division_ocd_id", "committee_id"],
    expectedTemporalFields: ["term_start", "term_end", "source_sha", "source_through"],
    horizonSemantics: "The five files at one adopted commit SHA form one bounded directory version. Every file must be acquired and pass its declared floor; the project remains attributed as an intermediary rather than an official chamber record.",
    parserVersion: "congress-directory/2",
    freshnessExpectation: "Explicit owner invocation after adopting a new project SHA; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "registry-reviewed-bindings": {
    id: "registry-reviewed-bindings",
    publisher: "Exact government, Census, NCES, and official-platform sources named by the reviewed registry receipt",
    trust: "T3_ATTRIBUTED_PRIMARY",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US", "US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["REGISTRY_RUNTIME_BINDING"],
    competentFacts: ["body-to-division binding", "current body name and contact", "body roster membership and contact", "statewide officeholder and contact", "exact roster identity disposition", "officeholder-to-candidacy binding", "runtime body provenance", "licensed officeholder portrait binding"],
    expectedIdentifierKeys: ["body_id", "division_ocd_id", "officeholder_id", "candidacy_id"],
    expectedTemporalFields: ["source_through", "collected_at"],
    horizonSemantics: "An explicit owner-reviewed package speaks only for its enumerated runtime bindings and exact source bytes. Static division/schema derivations remain separately versioned software inputs.",
    parserVersion: "registry-runtime-bindings/3",
    freshnessExpectation: "Explicit owner invocation after a reviewed source package changes; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: MANUAL_SOURCE_CLASSES },
  },
  "curated-reader-primary-sources": {
    id: "curated-reader-primary-sources",
    publisher: "Exact election-authority, candidate-controlled, public-body, venue-coordinate and legislator-office reference sources named by each reviewed Reader-record receipt",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US", ...REGISTRATION_TARGETS.map((target) => target.jurisdiction)],
    recordClasses: ["CURATED_READER_RECORD"],
    competentFacts: [
      "published public-comment rule",
      "official GIS/service-area district polygons bound to held government identities (CA-55)",
      "source-worded public-record kind, title and sentence about an exact jurisdiction or body (CA-37)",
      "official adopted government budgets, fiscal year dates, version-specific amendments and legal budget responsibilities (CA-52)",
      "neutral official measure translations checked sentence by sentence by an independent model (CA-25)",
      "independently verified official candidate-filing and committee-report facts, without an inferred ballot or financial identity join",
      "official voter-registration lookup route",
      "official polling-place lookup route",
      "verified campaign or personal site binding",
      "a state legislator's capitol or district office address and phone from the Open States reference file, joined to the official roster and marked unofficial",
      "reviewed exact-source venue address and coordinate resolution",
      "official everyday service contact route for an exact state/topic cell",
      "explicit owner-reviewed CONTACT_OWED obligation where no supported contact is held",
      "the exact body a government's calendar belongs to and the filter selecting its meetings, on the government's own saved pages (C16)",
    ],
    expectedIdentifierKeys: ["record_id", "body_id", "state", "officeholder_id", "source_id", "raw_location", "topic_id", "zip"],
    expectedTemporalFields: ["source_version", "source_through", "verified_at", "collected_at", "reviewed_at"],
    horizonSemantics: "Each contract is an independent, explicitly reviewed record family. Its receipt speaks only for the exact URLs and bytes in that family and cannot determine another family\u2019s disposition.",
    parserVersion: "curated-reader-records/2",
    freshnessExpectation: "Explicit owner invocation after a cited publisher changes; no standing clock and no tracked production writer.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: {
      allowedSourceClasses: MANUAL_SOURCE_CLASSES,
    },
  },
  "voting-sites": {
    id: "voting-sites",
    publisher: "The election authority named by each sourced jurisdiction",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: ["https://"],
    jurisdictions: REGISTRATION_TARGETS.map(target => target.jurisdiction),
    recordClasses: ["VOTING_SITE"],
    competentFacts: [
      "official voting-site identity and address",
      "official vote-center or assigned-site model",
      "published election and opening window",
      "publisher-specific retrieval refusal",
    ],
    expectedIdentifierKeys: ["ocd_id", "voting_site_id"],
    expectedTemporalFields: ["election", "collected_at", "source_through"],
    horizonSemantics: "Every supported election authority is an independent acquisition scope. A failed authority retains only that scope's prior GOOD version; a zero-site response is a refusal, never proof that no place exists.",
    parserVersion: "official-voting-sites/3",
    freshnessExpectation: "Explicit owner invocation when an authority publishes or changes its election locations; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  prl: {
    id: "prl",
    publisher: "Polarization Research Lab at Dartmouth — America's Political Pulse",
    trust: "T3_ATTRIBUTED_PRIMARY",
    sourceClass: "INTERMEDIARY",
    routePrefixes: [
      "https://americaspoliticalpulse.com/data/elite/",
      "https://www.americaspoliticalpulse.com/data/elite/",
    ],
    jurisdictions: ["US"],
    recordClasses: ["PRL_PROFILE"],
    competentFacts: [
      "PRL's own congressional rhetoric statement count",
      "PRL's own five allowlisted rhetoric mean shares",
      "PRL measurement source and update date",
      "PRL dataset attribution and licence",
    ],
    expectedIdentifierKeys: ["bioguide_id"],
    expectedTemporalFields: ["communication_last_update", "source_through"],
    horizonSemantics: "The national profiles archive is bounded by its exact CSV rows. Only positive-statement rows with exact Bioguide identifiers may promote, and the five attributed mean shares remain PRL measurements rather than government facts.",
    parserVersion: "prl-rhetoric/2",
    freshnessExpectation: "Explicit owner invocation after PRL publishes a new attributed archive; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "fec-open-api": {
    id: "fec-open-api",
    publisher: "Federal Election Commission",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: ["https://api.open.fec.gov/v1/"],
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
  "az-sos-campaign-finance": {
    id: "az-sos-campaign-finance",
    publisher: "Arizona Secretary of State — SeeTheMoney",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://seethemoney.az.gov/Reporting/"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["STATE_CAMPAIGN_FINANCE"],
    competentFacts: ["committee registration", "office and election cycle", "filed receipt and expenditure totals", "reporting period"],
    expectedIdentifierKeys: ["committee_id", "candidacy_id"],
    expectedTemporalFields: ["election_cycle", "checked_at", "source_through"],
    horizonSemantics: "The union of the official active, less-active, and officeholder filters is the acquisition horizon. Dollar figures promote only after the publisher's itemized ledger reconciles them.",
    parserVersion: "az-campaign-finance/2",
    freshnessExpectation: "Explicit owner invocation after a filing deadline or owner-requested review; no standing GitHub or production cadence.",
    absencePolicy: { kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT", requiredKeys: ["candidacy_id", "election_cycle", "filter_union"] },
    routineAutoPromotion: true,
  },
  "nh-sos-campaign-finance": {
    id: "nh-sos-campaign-finance",
    publisher: "New Hampshire Secretary of State — Campaign Finance System",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://cfsapi.sos.nh.gov/api/PublicFilerDetails/"],
    jurisdictions: ["US-NH"],
    recordClasses: ["STATE_CAMPAIGN_FINANCE"],
    competentFacts: ["filer identity", "office and election cycle", "filed receipts and spending totals", "bounded filer absence"],
    expectedIdentifierKeys: ["committee_id", "candidacy_id"],
    expectedTemporalFields: ["election_cycle", "checked_at", "source_through"],
    horizonSemantics: "The empty-name statewide filer query is complete only when every page reconciles to the publisher's totalItems; Reader narrowing makes no network request.",
    parserVersion: "nh-campaign-finance/2",
    freshnessExpectation: "Explicit owner invocation after a filing deadline or owner-requested review; no standing GitHub or production cadence.",
    absencePolicy: { kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT", requiredKeys: ["candidacy_id", "election_cycle", "totalItems"] },
    routineAutoPromotion: true,
  },
  "nj-elec-campaign-finance": {
    id: "nj-elec-campaign-finance",
    publisher: "New Jersey Election Law Enforcement Commission",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://www.njelecefilesearch.com/"],
    jurisdictions: ["US-NJ"],
    recordClasses: ["STATE_CAMPAIGN_FINANCE"],
    competentFacts: ["filing entity", "filing location", "office and election year", "filed report totals", "bounded filing absence"],
    expectedIdentifierKeys: ["committee_id", "candidacy_id"],
    expectedTemporalFields: ["election_year", "checked_at", "source_through"],
    horizonSemantics: "Each official dropdown location is acquired with a control and its stated row count; an unacquired or short location remains ROUTE_UNREAD and cannot establish absence.",
    parserVersion: "nj-campaign-finance/2",
    freshnessExpectation: "Explicit owner invocation after a filing deadline or owner-requested review; no standing GitHub or production cadence.",
    absencePolicy: { kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT", requiredKeys: ["candidacy_id", "election_year", "location_code"] },
    routineAutoPromotion: true,
  },
  "az-pima-local-finance": {
    id: "az-pima-local-finance",
    publisher: "Pima County Elections public campaign-finance portal",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://ecf-api.easyvoteapp.com/"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["LOCAL_CAMPAIGN_FINANCE"],
    competentFacts: ["Pima filer identity", "public filing index", "redacted contribution row", "redacted distribution row", "filing authority identity"],
    expectedIdentifierKeys: ["portal_filer_id", "filing_id"],
    expectedTemporalFields: ["recorded_on", "retrieved_at", "source_through"],
    horizonSemantics: "The public filer index and contribution/distribution searches are separate named horizons. A consistent year partition disproves the suspected round-number cap; other document classes remain explicitly held.",
    parserVersion: "pima-campaign-finance/2",
    freshnessExpectation: "Explicit owner invocation after a filing deadline or owner-requested review; no standing GitHub or production cadence.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "census-data-api": {
    id: "census-data-api",
    publisher: "U.S. Census Bureau",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: ["https://api.census.gov/data/"],
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
    jurisdictions: ["US"],
    recordClasses: ["CENSUS_REFERENCE"],
    competentFacts: ["Census of Governments unit classification", "Census GEOID", "TIGER/Line boundary", "statistical geography classification"],
    expectedIdentifierKeys: ["product", "vintage", "geoid"],
    expectedTemporalFields: ["vintage", "source_through"],
    horizonSemantics: "Completeness is product/vintage-specific and must reconcile archive members, feature/row cardinality, unique identifiers, and geographic relationships. Statistical place does not imply an independent government.",
    parserVersion: "census-bulk/2",
    freshnessExpectation: "At the supported product's official release cadence.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
  },
  "census-geography-relationships": {
    id: "census-geography-relationships",
    publisher: "U.S. Census Bureau",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: ["https://www2.census.gov/geo/docs/maps-data/data/rel2020/"],
    jurisdictions: ["US"],
    recordClasses: ["CENSUS_GEOGRAPHY"],
    competentFacts: ["ZCTA-to-geography area overlap (2020 tab20 relationship file)", "Census GEOID"],
    expectedIdentifierKeys: ["type", "geoid", "version"],
    expectedTemporalFields: ["version", "source_through"],
    horizonSemantics: "Complete for the exact built scopes: each geography's every wholly-or-partly overlapping ZCTA. It never claims a wider geography universe and never substitutes a different Census vintage.",
    parserVersion: "census-geography-overlaps/1",
    freshnessExpectation: "Owner-invoked version promotion on a new Census relationship-file vintage; never a silent vintage substitution.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "census-governments-registration": {
    id: "census-governments-registration",
    publisher: "U.S. Census Bureau",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: [REGISTRATION_SOURCE_ROUTE_PREFIX],
    jurisdictions: REGISTRATION_TARGETS.map((t) => t.jurisdiction),
    recordClasses: ["REGISTRATION"],
    competentFacts: [
      "The governments of each state (2022 Census of Governments)",
      "The functioning local governments of each territory, which the Census of Governments does not enumerate (TIGER/Line 2023 functional status, committed extract)",
      "Census division identity and GEOID (2023 cartographic boundary files)",
      "OCD division id built from the Census names",
    ],
    expectedIdentifierKeys: ["ocd_id", "geoid"],
    expectedTemporalFields: ["version", "source_through"],
    horizonSemantics:
      "Complete for the pinned Census vintage: every government the 2022 Census of Governments lists in the state, each on the Census division the Census ties it to or named as unpaired, and every Census division in the state. For a territory, every division TIGER/Line 2023 gives a governing functional status (A, B, C, G), and a territory whose divisions all carry a non-governing status is registered with that record stated. It never claims a government the Census does not record, and a different Census file is refused rather than substituted.",
    parserVersion: REGISTRATION_PARSER_VERSION,
    freshnessExpectation: "Every 90 days a conditional request confirms census.gov still serves the pinned Census of Governments bytes (a 304 against the Last-Modified they were served with, or the bytes hashed); a new vintage waits for the reference to be rebuilt from it.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "jurisdiction-operational-reference": {
    id: "jurisdiction-operational-reference",
    publisher: "U.S. Census Bureau and Arizona Secretary of State source vintages plus the reviewed AZ/NH/NJ jurisdiction-routing model",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: [
      "https://www2.census.gov/programs-surveys/gus/",
      "https://apps.azsos.gov/cfs/",
    ],
    jurisdictions: ["US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["OPERATIONAL_REFERENCE"],
    competentFacts: [
      "named covered-state government from the adopted Census source vintage",
      "reviewed filing-officer and election-custodian routing",
      "explicit adapted, discovery-owed, and requires-adapter state",
      "a government's current website where a reviewed correction replaces a dead Census address: its homepage and its own .gov registry row name the same government, or another government's own publication names the site (C15, the website field only)",
    ],
    expectedIdentifierKeys: ["jurisdiction_id"],
    expectedTemporalFields: ["source_version", "source_through"],
    horizonSemantics: "The projection is complete only for the exact reviewed AZ/NH/NJ routing version and its named input vintages; it never claims every government or route in a state.",
    parserVersion: "jurisdiction-operational-reference/3",
    freshnessExpectation: "Owner-invoked version promotion only; the standing control plane consumes the promoted LKG and does not read tracked mutable runtime truth.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "jurisdiction-operational-reference-az": {
    id: "jurisdiction-operational-reference-az",
    publisher: "U.S. Census Bureau and Arizona Secretary of State source vintages plus the reviewed Arizona jurisdiction-routing model",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://www2.census.gov/programs-surveys/gus/", "https://apps.azsos.gov/cfs/"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["OPERATIONAL_REFERENCE"],
    competentFacts: [
      "named Arizona government from the adopted Census source vintage",
      "reviewed Arizona filing-officer and election-custodian routing",
      "explicit adapted, discovery-owed, and requires-adapter state for Arizona",
      "a reviewed Arizona government's official website, with the separately receipted website-correction evidence",
    ],
    expectedIdentifierKeys: ["jurisdiction_id"],
    expectedTemporalFields: ["source_version", "source_through"],
    horizonSemantics: "Complete only for the reviewed Arizona routing version and its named input vintages; it does not claim other states or every route in Arizona.",
    parserVersion: "jurisdiction-operational-reference/3",
    freshnessExpectation: "Invoked for an exact resolved owner Send; the promoted Arizona pointer retains its prior GOOD version on refusal.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "meetings-public-bodies": {
    id: "meetings-public-bodies",
    publisher: "The configured public bodies in the canonical source-wiring registry",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: [
      "https://api.thrillshare.com/", "https://bradfordnh.gov/", "https://calendar.google.com/",
      "https://capaz.api.civicclerk.com/", "https://capaz.portal.civicclerk.com/", "https://govboard.tusd1.org/",
      "https://clerksboards.tucsonaz.gov/", "https://meetings.boardbook.org/", "https://mesa.legistar.com/",
      "https://webapi.legistar.com/v1/",
      "https://morriscountynj.iqm2.com/", "https://newlondon.nh.gov/",
      "https://www.pima.edu/robots.txt",
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/",
      "https://events.pima.edu/",
      "https://www.susd12.org/robots.txt",
      "https://www.susd12.org/api/calendars/150042/events",
      "https://susd-12.community.highbond.com/", "https://tucsonaz.hylandcloud.com/",
      "https://pima.legistar.com/",
      "https://www.pima.gov/board-of-supervisors-meeting-schedule",
      "https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule",
      "https://tusd1-schooldesk.community.diligentoneplatform.com/", "https://vailschooldistrictaz.thrillshare.com/",
      "https://warnernh.gov/", "https://www.cap-az.com/", "https://www.kearsarge.org/", "https://www.merrimackcounty.net/",
      "https://www.mesaaz.gov/", "https://www.mhrd.org/", "https://www.newbury.nh.gov/", "https://www.rockawaytownship.org/",
      "https://www.suttonnh.gov/", "https://www.wilmotnh.org/",
      "https://www.tusd1.org/Reconfiguration",
      "https://www.chandleraz.gov/robots.txt",
      "https://www.chandleraz.gov/government/departments/city-clerks-office/city-council-meetings",
      "https://www.chandleraz.gov/rest/events/day/",
      "https://public.destinyhosted.com/agenda_publish.cfm?id=24263&mt=CC",
      "https://newburynhlibrary.net/feed/",
      "https://www.newburyenergynh.org/",
      "https://holbrookaz.gov/robots.txt",
      "https://holbrookaz.gov/government/council-agenda/",
      "https://winslowaz.suiteonemedia.com/robots.txt",
      "https://winslowaz.suiteonemedia.com/?embed=1",
    ],
    jurisdictions: ["US-AZ", "US-NH", "US-NJ", "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION"],
    recordClasses: ["MEETING"],
    competentFacts: ["meeting time", "meeting status", "public body", "location", "agenda link", "agenda document"],
    expectedIdentifierKeys: ["meeting_id", "body_id", "source_route"],
    expectedTemporalFields: ["starts_at", "ends_at", "source_through"],
    horizonSemantics: "Each configured body/route is an independent obligation. A failed route may retain only that route's LKG rows and cannot erase or authenticate any unrelated body.",
    parserVersion: "meetings-composite/2",
    freshnessExpectation: "Daily through the supported election window, then weekly; source/body retries are hourly.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
    /*
     * Neither authority below has a route of its own; each is authentic only as the exact inputs its candidate names.
     * The `authorization` strings are stored text, kept byte-identical.
     */
  "meeting-source-wiring": {
    id: "meeting-source-wiring",
    publisher: "The standing runner, from promoted and vaulted inputs only: the reviewed meeting-body crosswalk, registration, the discovery walk's attempts and its vaulted evidence",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US", ...REGISTRATION_TARGETS.map((t) => t.jurisdiction)],
    recordClasses: ["CURATED_READER_RECORD"],
    competentFacts: [
      "which reviewed calendar route publishes as which exact body, recomputed from promoted and vaulted inputs",
      "a connection suspended for review, the trigger and its evidence",
      "which calendar on a government's attested own host is its registered body's or a printed sub-body's, accepted by the deterministic reviewer on vaulted bytes",
    ],
    expectedIdentifierKeys: ["record_id", "body_id"],
    expectedTemporalFields: ["verified_at", "reviewed_at"],
    horizonSemantics: "Each row is one reviewed route of one body. A row is never dropped: an outage holds it, a review trigger suspends it, and only a later review restores it.",
    parserVersion: "meeting-source-wiring/1",
    freshnessExpectation: "Recomputed by the standing runner as the crosswalk, registration and discovery walks change; no tracked writer.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
    derivedPromotion: {
      inputKinds: ["PROMOTED_VERSION", "VAULTED_EVIDENCE", "DISCOVERY_ATTEMPT", "COMMITTED_ROUTE_HINT", "CROSSWALK_VERSION"],
      authorization: "C16: owner decision recorded 2026-09-24T22:43Z",
    },
  },
  "meetings-derived-routes": {
    id: "meetings-derived-routes",
    publisher: "The public bodies whose calendars the promoted meeting-source wiring connects, each read on its own attested host",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: [],
    jurisdictions: [...REGISTRATION_TARGETS.map((t) => t.jurisdiction), "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION"],
    recordClasses: ["MEETING"],
    competentFacts: ["meeting time", "meeting status", "public body", "location", "agenda link", "agenda document"],
    expectedIdentifierKeys: ["meeting_id", "body_id", "source_route"],
    expectedTemporalFields: ["starts_at", "ends_at", "source_through"],
    horizonSemantics: "Each wired row is an independent member of its state's family: a failed or suspended member keeps only its own last verified rows and cannot erase or authenticate any other member.",
    parserVersion: "meetings-composite/2",
    freshnessExpectation: "As the meeting partitions: sitting-window re-reads, daily through the supported election window, then weekly.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
    derivedPromotion: {
      inputKinds: ["PROMOTED_VERSION", "MEMBER_ACQUISITION"],
      authorization: "C16: owner decision recorded 2026-09-24T22:43Z",
    },
  },
  "meetings-history": {
    id: "meetings-history",
    publisher: "The public bodies whose sittings the live meeting partitions hold, kept from the promoted partition version they were read in",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: [],
    jurisdictions: [...REGISTRATION_TARGETS.map((t) => t.jurisdiction), "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION"],
    recordClasses: ["MEETING"],
    competentFacts: ["meeting time", "meeting status", "public body", "location", "agenda link", "agenda document"],
    expectedIdentifierKeys: ["meeting_id", "body_id", "source_route"],
    expectedTemporalFields: ["starts_at", "ends_at", "source_through"],
    horizonSemantics: "Append-only: a sitting is added when it leaves its live partition and is never removed. It is never re-read, so it makes no claim about what the publisher lists today.",
    parserVersion: "meetings-composite/2",
    freshnessExpectation: "None: history is kept as last published and moves only when a sitting leaves its partition.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
    derivedPromotion: {
      inputKinds: ["PROMOTED_VERSION"],
      authorization: "Rulings §4 (history is kept, never deleted; Sean, October 3, 2026) and build plan v6 DB-06",
    },
  },
  "candidate-campaign-site-chain": {
    id: "candidate-campaign-site-chain",
    publisher: "The standing runner, from held and vaulted inputs only: the campaign-site chain's pipeline approvals, the vaulted bytes of each verifying robots-first read, and the promoted candidate-profiles version",
    trust: "T3_ATTRIBUTED_PRIMARY",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US", "US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["CURATED_READER_RECORD"],
    competentFacts: [
      "a 2026 candidate's campaign site, read robots-first by our own deterministic Attempt and verified to name the candidate, the office or district and the 2026 election, on vaulted bytes",
      "literal candidate-authored text from those same identity-verified captured pages, with distinct source-byte and transcription hashes; no inferred positions",
    ],
    expectedIdentifierKeys: ["record_id", "candidacy_id"],
    expectedTemporalFields: ["read_at", "approved_at"],
    horizonSemantics: "Each row is one approved site for one canonical candidacy, keyed by the Reader's own key. It never says a candidate has no site, and a candidate the version does not name is simply not yet verified.",
    parserVersion: "candidate-campaign-site-chain/1",
    freshnessExpectation: "Recomputed by the standing runner as the campaign-site chain approves sites; no tracked writer.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
    derivedPromotion: {
      inputKinds: ["PROMOTED_VERSION", "VAULTED_EVIDENCE", "PIPELINE_APPROVAL"],
      authorization: "Sean, 2026-09-21: \"You may enable automatic promotion for qualifying results. Fix the gap, recover value already paid for.\"",
    },
  },
  "nj-morris-county-clerk": {
    id: "nj-morris-county-clerk",
    publisher: "Morris County Clerk",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://www.morriscountyclerk.org/"],
    jurisdictions: ["US-NJ"],
    recordClasses: ["BALLOT_FILING"],
    competentFacts: ["filed candidacy", "contest", "party", "slogan", "term", "seat count", "filed contact", "filing removal"],
    expectedIdentifierKeys: ["contest_id", "candidacy_id", "division_id"],
    expectedTemporalFields: ["election_date", "filing_revision", "source_through"],
    horizonSemantics: "The clerk page's newest current general-election candidate and school-candidate PDFs jointly bound the county filing horizon; every input row is built or explicitly refused.",
    parserVersion: "nj-morris-filing/2",
    freshnessExpectation: "Daily through the general election, then weekly while post-certification corrections remain possible.",
    absencePolicy: { kind: "BOUNDED_QUERY_OR_EXPLICIT_STATEMENT", requiredKeys: ["contest_id", "candidacy_id", "division_id"] },
    routineAutoPromotion: true,
  },
  "cisa-dotgov-registry": {
    id: "cisa-dotgov-registry",
    publisher: "Cybersecurity and Infrastructure Security Agency",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "FEDERAL_AGENCY",
    routePrefixes: [
      "https://api.github.com/repos/cisagov/dotgov-data/",
      "https://raw.githubusercontent.com/cisagov/dotgov-data/",
      "https://github.com/cisagov/dotgov-data/",
    ],
    jurisdictions: ["US"],
    recordClasses: ["DOTGOV_REFERENCE"],
    competentFacts: ["registered .gov domain", "registrant organization", "CISA domain type", "registry source revision"],
    expectedIdentifierKeys: ["domain", "source_sha"],
    expectedTemporalFields: ["source_commit", "source_through"],
    horizonSemantics: "The SHA-pinned current-full.csv is a complete domain registry for that source revision but never a government/body denominator.",
    parserVersion: "cisa-dotgov/2",
    freshnessExpectation: "Monthly check for a newer CISA source revision.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "az-election-authorities": {
    id: "az-election-authorities",
    publisher: "Arizona Secretary of State and exact named Arizona filing/canvass authorities",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US-AZ"],
    recordClasses: ["BALLOT_CANDIDACY"],
    competentFacts: ["filed candidacy", "certified nominee", "contest", "party", "measure", "candidate identity crosswalk"],
    expectedIdentifierKeys: ["contest_id", "candidacy_id", "identity_id"],
    expectedTemporalFields: ["election_date", "source_through"],
    horizonSemantics: "The explicit owner-reviewed source set names the exact Arizona filing, canvass, and local ballot documents represented by one projection; omissions remain stated and never become statewide absence claims.",
    parserVersion: "az-election-manual/1",
    freshnessExpectation: "Explicit owner invocation when a named election authority publishes a revision; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"] },
  },
  "nh-election-authorities": {
    id: "nh-election-authorities",
    publisher: "New Hampshire Secretary of State and exact named New Hampshire election authorities",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US-NH"],
    recordClasses: ["BALLOT_CANDIDACY"],
    competentFacts: ["filed candidacy", "contest", "party", "term", "seat count", "election date"],
    expectedIdentifierKeys: ["contest_id", "candidacy_id"],
    expectedTemporalFields: ["election_date", "source_through"],
    horizonSemantics: "The explicit owner-reviewed source set bounds the exact New Hampshire filing documents and supported county projection; it does not claim an unobserved statewide ballot universe.",
    parserVersion: "nh-election-manual/1",
    freshnessExpectation: "Explicit owner invocation after a reviewed filing or certification revision; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"] },
  },
  "candidate-primary-publications": {
    id: "candidate-primary-publications",
    publisher: "Exact candidate-controlled, filing-authority, and official-publisher pages named in each reviewed receipt",
    trust: "T3_ATTRIBUTED_PRIMARY",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION"],
    competentFacts: ["candidate-published biography", "candidate-controlled link", "filed contact", "candidate-authored publication", "official officeholder page"],
    expectedIdentifierKeys: ["candidate_key", "document_id"],
    expectedTemporalFields: ["retrieved_at", "source_through"],
    horizonSemantics: "Each reviewed receipt speaks only for its enumerated URLs and exact candidate keys. It never establishes that a candidate published nothing elsewhere.",
    parserVersion: "candidate-primary-manual/1",
    freshnessExpectation: "Explicit owner invocation after an equal-effort reviewed collection pass; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: ["CANDIDATE_CONTROLLED", "OFFICIAL_PUBLISHER", "ELECTION_AUTHORITY"] },
  },
  "officeholder-primary-publications": {
    id: "officeholder-primary-publications",
    publisher: "Exact officeholder-controlled, campaign-controlled, and official office pages named in each reviewed receipt",
    trust: "T3_ATTRIBUTED_PRIMARY",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US"],
    recordClasses: ["OFFICEHOLDER_STATEMENT"],
    competentFacts: ["officeholder-published statement", "campaign-controlled statement", "official office biography and publication"],
    expectedIdentifierKeys: ["officeholder_id", "snapshot_id"],
    expectedTemporalFields: ["retrieved_at", "source_through"],
    horizonSemantics: "Each owner-reviewed receipt speaks only for its enumerated URLs and exact snapshots. It never establishes that an officeholder published nothing elsewhere.",
    parserVersion: "officeholder-statements-manual/1",
    freshnessExpectation: "Explicit owner invocation after a reviewed primary-publication collection pass; no standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: ["CANDIDATE_CONTROLLED", "OFFICIAL_PUBLISHER"] },
  },
  "az-official-actions": {
    id: "az-official-actions",
    publisher: "Office of the Arizona Governor and Arizona State Legislature official publications named in the reviewed receipt",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "MULTI_PUBLISHER_PRIMARY",
    routePrefixes: [],
    jurisdictions: ["US-AZ"],
    recordClasses: ["STATE_EXECUTIVE_ACTION"],
    competentFacts: ["executive order", "chaptered enactment", "governor approval", "veto", "official transmittal letter"],
    expectedIdentifierKeys: ["action_id", "officeholder_id"],
    expectedTemporalFields: ["occurred_at", "collected_at", "source_through"],
    horizonSemantics: "Each promoted row is bounded by the exact Governor/Legislature document bytes in an owner-reviewed receipt. An unread letter remains unread and a partial index walk never claims a complete action universe.",
    parserVersion: "az-official-actions/2",
    freshnessExpectation: "Explicit owner invocation after a new official order, chapter, or letter is published; no GitHub or standing clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: false,
    manualReceiptPromotion: { allowedSourceClasses: ["OFFICIAL_PUBLISHER"] },
  },
  "pima-legistar-outcomes": {
    id: "pima-legistar-outcomes",
    publisher: "Pima County public Legistar records",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://webapi.legistar.com/v1/pima/"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["MEETING_OUTCOME"],
    competentFacts: ["agenda item", "recorded body action", "recorded disposition", "exact per-person roll call", "publisher document status"],
    expectedIdentifierKeys: ["meeting_id", "event_id"],
    expectedTemporalFields: ["event_last_modified_utc", "observed_at", "source_through"],
    horizonSemantics: "The events query bounds its date window; each changed sitting is an independent acquisition. Failed item or vote retrieval produces a refused durable candidate and cannot replace another sitting's LKG facts.",
    parserVersion: "pima-legistar-outcomes/2",
    freshnessExpectation: "The standing routine runner's clock under the pima-legistar-outcomes routine contract; each pass reads a rolling events window and re-walks only sittings whose publisher EventLastModifiedUtc moved. No owner or GitHub clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "mesa-legistar-minutes-outcomes": {
    id: "mesa-legistar-minutes-outcomes",
    publisher: "City of Mesa City Clerk, on the city's public Legistar portal",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "OFFICIAL_PLATFORM",
    routePrefixes: ["https://mesa.legistar.com/", "https://legistar.granicus.com/mesa/"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["MEETING_OUTCOME"],
    competentFacts: ["recorded council motion", "mover and seconder", "recorded result", "verbatim tabulation of votes", "minutes document standing (action minutes, minutes, approval recorded)", "minutes not yet published"],
    expectedIdentifierKeys: ["meeting_id", "event_id"],
    expectedTemporalFields: ["observed_at", "source_through"],
    horizonSemantics: "The calendar grid bounds the concluded sittings in a rolling window; each sitting's minutes document speaks only for that sitting. A sitting with no published minutes is recorded as not yet published and never as one without decisions; a failed read refuses the candidate and cannot replace another sitting's LKG facts.",
    parserVersion: "mesa-legistar-minutes-outcomes/1",
    freshnessExpectation: "The standing routine runner's clock under the mesa-legistar-minutes-outcomes routine contract, following the council's InSite sittings; each pass reads the calendar grid and re-reads only minutes whose link or label moved. No owner or GitHub clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "door-outcomes": {
    id: "door-outcomes",
    publisher: "Public bodies on Legistar, each read on the host its own door names",
    trust: "T1_AUTHORITATIVE_STRUCTURED",
    sourceClass: "OFFICIAL_PLATFORM",
    // The vendor's public Web API; a body's own portal host comes from its door (installDoorHosts).
    routePrefixes: ["https://webapi.legistar.com/v1/"],
    jurisdictions: [...REGISTRATION_TARGETS.map((t) => t.jurisdiction), "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION"],
    recordClasses: ["MEETING_OUTCOME"],
    competentFacts: ["agenda item", "recorded body action", "recorded disposition", "exact per-person roll call", "publisher document status", "minutes document standing"],
    expectedIdentifierKeys: ["meeting_id", "event_id"],
    expectedTemporalFields: ["event_last_modified_utc", "observed_at", "source_through"],
    horizonSemantics: "Each door bounds its own date window; each changed sitting is an independent acquisition. A failed item, vote or minutes retrieval produces a refused durable candidate and cannot replace another sitting's, or another door's, LKG facts.",
    parserVersion: "legistar-outcomes/2",
    freshnessExpectation: "The standing routine runner's clock under the door's outcome contract, following the body's sittings; each pass re-walks only sittings whose publisher stamp or minutes link moved. No owner or GitHub clock.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
  "az-legislature": {
    id: "az-legislature",
    publisher: "Arizona State Legislature",
    trust: "T2_AUTHORITATIVE_DOCUMENT",
    sourceClass: "STATE_LEGISLATURE",
    routePrefixes: ["https://www.azleg.gov/", "https://apps.azleg.gov/", "https://www.azsenate.gov/", "https://www.azhouse.gov/"],
    jurisdictions: ["US-AZ"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES"],
    competentFacts: ["legislative membership", "chamber", "district", "session", "official roll call", "bill action stage"],
    expectedIdentifierKeys: ["legislator", "legislature", "session", "rollCallId", "eventId", "officeholderId", "jurisdiction"],
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
    jurisdictions: ["US-NH"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES"],
    competentFacts: ["legislative membership", "elected status", "chamber", "district", "committee assignment", "official roll call"],
    expectedIdentifierKeys: ["PersonID", "EmployeeNumber", "seatNo", "chamber", "district", "rollCallId", "eventId", "officeholderId", "jurisdiction"],
    expectedTemporalFields: ["term", "session", "vote_date"],
    horizonSemantics: "Members.txt is the whole published current-roster file and legislators.txt supplies its exact official PersonID crosswalk; row disposition must reconcile to logical input. For 2026, RollCallSummary.txt, RollCallHistory.txt and legislators.txt form one bounded horizon only when every summary, member position, published tally and one-to-one EmployeeNumber/PersonID join reconciles.",
    parserVersion: "nh-general-court/3",
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
    jurisdictions: ["US-NJ"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES"],
    competentFacts: ["legislative membership", "chamber", "district", "session", "official voting record", "bill action stage"],
    expectedIdentifierKeys: ["roster_id", "district", "house", "session", "rollCallId", "eventId", "officeholderId", "jurisdiction"],
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
    jurisdictions: ["US-AZ", "US-NH", "US-NJ"],
    recordClasses: ["STATE_LEGISLATOR", "STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES"],
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
    jurisdictions: ["US"],
        recordClasses: ["STATE_LEGISLATOR"],
    competentFacts: [],
    expectedIdentifierKeys: ["person_id"],
    expectedTemporalFields: ["term"],
    horizonSemantics: "Open States state-legislator rows publish on their own for any state, marked unofficial and joined to the official roster when it is held; an official roster row, when present, wins on conflict (rulings §3).",
    parserVersion: "plural-roster/1",
    freshnessExpectation: "Unknown intermediary lag; refreshed with the weekly state-legislator pass.",
    absencePolicy: { kind: "NEVER_FROM_ZERO" },
    routineAutoPromotion: true,
  },
} as const satisfies Readonly<Record<string, SourceAuthorityContract>>;

export type SourceAuthorityId = keyof typeof SOURCE_AUTHORITIES;

export function sourceAuthority(sourceId: string): SourceAuthorityContract | null {
  return (SOURCE_AUTHORITIES as Readonly<Record<string, SourceAuthorityContract>>)[sourceId] ?? null;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function manualSourceReceiptStructureIssue(
  receipt: ManualSourceSetReceipt | undefined,
): { readonly code: string; readonly detail: string } | null {
  if (
    !receipt || receipt.contractVersion !== 1 || typeof receipt.reviewedBy !== "string" ||
    !receipt.reviewedBy.trim() || typeof receipt.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.reviewedAt)) || !Array.isArray(receipt.sources)
  ) {
    return { code: "MANUAL_SOURCE_RECEIPT_INVALID", detail: "The source-set receipt lacks its version, reviewer, or review time." };
  }
  const reviewTime = Date.parse(receipt.reviewedAt);
  for (const source of receipt.sources) {
    if (
      !source || typeof source !== "object" || typeof source.requestedUrl !== "string" ||
      typeof source.finalUrl !== "string" || typeof source.publisher !== "string" ||
      typeof source.retrievedAt !== "string" || typeof source.rawHash !== "string" ||
      typeof source.reviewedEvidence !== "string"
    ) {
      return { code: "MANUAL_SOURCE_ATTEMPT_INVALID", detail: "A source attempt is not a complete review object." };
    }
    let requested: URL;
    let final: URL;
    try {
      requested = new URL(source.requestedUrl);
      final = new URL(source.finalUrl);
    } catch {
      return { code: "MANUAL_SOURCE_URL_INVALID", detail: `A reviewed source URL is not parseable: ${JSON.stringify(source.finalUrl)}.` };
    }
    if (requested.protocol !== "https:" || final.protocol !== "https:") {
      return { code: "MANUAL_SOURCE_URL_NOT_HTTPS", detail: `${source.finalUrl} is not an HTTPS source attempt.` };
    }
    if (!(MANUAL_SOURCE_CLASSES as readonly string[]).includes(source.sourceClass)) {
      return { code: "MANUAL_SOURCE_CLASS_INVALID", detail: `${source.sourceClass} is not a registered manual source class.` };
    }
    const retrieved = Date.parse(source.retrievedAt);
    if (!Number.isFinite(retrieved) || retrieved > reviewTime) {
      return { code: "MANUAL_SOURCE_TIME_INVALID", detail: `${source.finalUrl} lacks a retrieval time at or before the review.` };
    }
    if (!source.publisher.trim() || !Number.isInteger(source.httpStatus) || source.httpStatus < 0 || source.httpStatus > 599) {
      return { code: "MANUAL_SOURCE_ATTEMPT_INVALID", detail: `${source.finalUrl} lacks a publisher or truthful HTTP outcome.` };
    }
    const outcome: unknown = source.reviewOutcome ?? "SUPPORTED";
    if (outcome === "BLOCKED") {
      if (typeof source.failureDetail !== "string" || !source.failureDetail.trim()) {
        return { code: "MANUAL_SOURCE_BLOCK_DETAIL_MISSING", detail: `${source.finalUrl} is BLOCKED without an exact failure detail.` };
      }
      if (source.httpStatus === 0 ? source.rawHash !== "" : !SHA256.test(source.rawHash)) {
        return { code: "MANUAL_SOURCE_BLOCK_PROOF_INVALID", detail: `${source.finalUrl} does not truthfully bind its blocked HTTP response bytes.` };
      }
    } else if (outcome === "SUPPORTED") {
      if (source.httpStatus < 200 || source.httpStatus >= 300 || !SHA256.test(source.rawHash) || !source.reviewedEvidence.trim()) {
        return { code: "MANUAL_SOURCE_SUPPORTED_PROOF_INVALID", detail: `${source.finalUrl} is marked SUPPORTED without successful exact bytes and reviewed evidence.` };
      }
    } else {
      return { code: "MANUAL_SOURCE_REVIEW_OUTCOME_INVALID", detail: `${source.finalUrl} has an unknown review outcome.` };
    }
  }
  return null;
}

export function authorityForManualReceipt(
  sourceId: string,
  recordClass: RoutineRecordClass,
  receipt: ManualSourceSetReceipt | undefined,
  finalUrl: string | null,
): { readonly ok: true; readonly contract: SourceAuthorityContract } | { readonly ok: false; readonly code: string; readonly detail: string } {
  const contract = sourceAuthority(sourceId);
  if (!contract) return { ok: false, code: "SOURCE_NOT_REGISTERED", detail: `${sourceId} is not in SOURCE_AUTHORITIES.` };
  if (!contract.recordClasses.includes(recordClass)) {
    return { ok: false, code: "SOURCE_NOT_COMPETENT_FOR_RECORD_CLASS", detail: `${sourceId} is not registered for ${recordClass}.` };
  }
  const policy = contract.manualReceiptPromotion;
  if (!policy) return { ok: false, code: "MANUAL_SOURCE_RECEIPT_NOT_PERMITTED", detail: `${sourceId} does not permit receipt-bounded manual promotion.` };
  const structureIssue = manualSourceReceiptStructureIssue(receipt);
  if (structureIssue) return { ok: false, ...structureIssue };
  if (receipt!.sources.length === 0) {
    return { ok: false, code: "MANUAL_SOURCE_SET_EMPTY", detail: "A manual promotion must name at least one exact acquired source." };
  }
  const seen = new Set<string>();
  for (const source of receipt!.sources) {
    let requested: URL;
    let final: URL;
    try {
      requested = new URL(source.requestedUrl);
      final = new URL(source.finalUrl);
    } catch {
      return { ok: false, code: "MANUAL_SOURCE_URL_INVALID", detail: `A reviewed source URL is not parseable: ${JSON.stringify(source.finalUrl)}.` };
    }
    if (requested.protocol !== "https:" || final.protocol !== "https:") {
      return { ok: false, code: "MANUAL_SOURCE_URL_NOT_HTTPS", detail: `${source.finalUrl} is not an HTTPS primary-source read.` };
    }
    if (!policy.allowedSourceClasses.includes(source.sourceClass)) {
      return { ok: false, code: "MANUAL_SOURCE_CLASS_NOT_AUTHORIZED", detail: `${source.sourceClass} is outside ${sourceId}'s reviewed source classes.` };
    }
    if (source.reviewOutcome === "BLOCKED") {
      return { ok: false, code: "MANUAL_SOURCE_REVIEW_BLOCKED", detail: `${source.finalUrl} was reviewed as blocked: ${source.failureDetail}.` };
    }
    if (!Number.isInteger(source.httpStatus) || source.httpStatus < 200 || source.httpStatus >= 300) {
      return { ok: false, code: "MANUAL_SOURCE_HTTP_INVALID", detail: `${source.finalUrl} was not acquired with a successful HTTP status.` };
    }
    if (!SHA256.test(source.rawHash) || !source.publisher.trim() || !source.reviewedEvidence.trim()) {
      return { ok: false, code: "MANUAL_SOURCE_PROOF_INCOMPLETE", detail: `${source.finalUrl} lacks exact bytes, publisher identity, or reviewed evidence.` };
    }
    const identity = `${final.href}\n${source.rawHash}`;
    if (seen.has(identity)) return { ok: false, code: "MANUAL_SOURCE_PROOF_DUPLICATED", detail: `${source.finalUrl} repeats the same reviewed bytes.` };
    seen.add(identity);
  }
  if (!finalUrl || !receipt!.sources.some((source) => source.finalUrl === finalUrl)) {
    return { ok: false, code: "MANUAL_PRIMARY_ROUTE_NOT_RECEIPTED", detail: "The candidate's primary final URL is absent from its reviewed source set." };
  }
  return { ok: true, contract };
}

/** Null means only the contract's own routes are registered. A door's host admits any HTTPS path on that host. */
let doorHosts: ReadonlySet<string> | null = null;
const DOOR_HOST_SOURCES: ReadonlySet<string> = new Set(["meetings-public-bodies", "door-outcomes"]);

export function installDoorHosts(hosts: Iterable<string> | null): void {
  doorHosts = hosts === null ? null : new Set([...hosts].map((host) => host.trim().toLowerCase()).filter((host) => host !== ""));
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
  const onDoorHost = DOOR_HOST_SOURCES.has(sourceId) && doorHosts !== null && doorHosts.has(url.hostname.toLowerCase());
  if (!onDoorHost && !contract.routePrefixes.some((prefix) => url.href.startsWith(prefix))) {
    return { ok: false, code: "FINAL_ROUTE_NOT_REGISTERED", detail: `${url.href} is outside ${sourceId}'s registered publication routes.` };
  }
  if (!contract.routineAutoPromotion) {
    return { ok: false, code: "SOURCE_NOT_AUTO_PROMOTABLE", detail: `${sourceId} is ${contract.trust}; it remains research/corroboration only.` };
  }
  return { ok: true, contract };
}
