/** Canonical dataset → reader surface contract. The manifest never guesses from imports. */
export interface ReaderSurface {
  readonly id: string;
  readonly label: string;
  readonly path: string;
}

export const READER_SURFACES = [
  { id: "ballot", label: "Ballot and candidate cards", path: "app/ballot/page.tsx" },
  { id: "map", label: "Map and government cards", path: "components/map/map-entry.tsx" },
  { id: "representation", label: "Government representation", path: "app/api/representation/[...division]/route.ts" },
  { id: "meetings", label: "Nearby meetings", path: "app/api/meetings/route.ts" },
  { id: "agenda", label: "Meeting agendas", path: "app/api/agenda/route.ts" },
  { id: "ask", label: "Grounded civic questions", path: "app/api/ask/grounded/route.ts" },
  { id: "positions", label: "Sourced positions", path: "app/api/positions/[subject]/[topic]/route.ts" },
  { id: "funding", label: "Campaign funding", path: "app/api/funding/[target]/route.ts" },
  { id: "state-money", label: "State campaign funding on candidate and official cards", path: "components/funding/state-money-section.tsx" },
  { id: "votes", label: "Officials' recorded votes", path: "app/api/votes/route.ts" },
  { id: "voting-sites", label: "Where to vote", path: "app/api/voting-sites/route.ts" },
  { id: "about-area", label: "About this area", path: "app/about-area/page.tsx" },
  { id: "civic-routing", label: "Civic questions and contact routing", path: "components/ask/ask-box.tsx" },
] as const satisfies readonly ReaderSurface[];

export type ReaderSurfaceId = (typeof READER_SURFACES)[number]["id"];

export interface DatasetFamily {
  readonly id: string;
  readonly domain: string;
  /** A typed, declared file contract. Patterns accommodate a state's first acquisition. */
  readonly patterns: readonly RegExp[];
  readonly surfaces: readonly ReaderSurfaceId[];
  /** Distinguishes a reader input from an acquisition which has not been promoted. */
  readonly relationship: string;
  readonly consumerPaths: readonly string[];
}

export const DATASET_FAMILIES: readonly DatasetFamily[] = [
  { id: "body-rosters", domain: "officials", patterns: [/^lib\/registry\/body-rosters\.ts$/, /^data\/states\/[^/]+\/officials\/cawcd-rosters\.json$/], surfaces: ["map", "ballot", "ask"], relationship: "Sourced body memberships and exact-body contact grounding. Raw source rows retain explicit unresolved and exact-duplicate dispositions before the shared reader projection. The assembled multi-state roster includes its separately inventoried acquired roster inputs; dataset totals are not additive unique-person counts.", consumerPaths: ["lib/registry/body-rosters.ts", "lib/officials/tier-grouping.ts", "lib/ask/contacts.ts"] },
  { id: "statewide-executives", domain: "officials", patterns: [/^lib\/officials\/statewide-executives\.ts$/], surfaces: ["representation", "map", "ballot", "ask"], relationship: "Sourced statewide officeholders and their contact/provenance records, shared by geographic representation and exact-person Ask grounding.", consumerPaths: ["lib/registry/server.ts"] },
  { id: "curated-body-identities", domain: "registry", patterns: [/^lib\/registry\/curated-bodies\.ts$/], surfaces: ["map", "representation"], relationship: "Curated governing and advisory body identities; identity does not establish a roster or acquired meeting corpus.", consumerPaths: ["lib/registry/server.ts"] },
  { id: "tribal-nation-identities", domain: "registry", patterns: [/^lib\/registry\/tribal-nations\.ts$/], surfaces: [], relationship: "Named sovereign tribal jurisdictions from the cited enumeration. Territorial overlap is not a claim that a nation governs a reader; no direct reader wiring is asserted.", consumerPaths: [] },
  { id: "comment-access", domain: "meetings", patterns: [/^lib\/registry\/comment-access\.ts$/], surfaces: ["map", "ask"], relationship: "Sourced standing public-comment and attendance rules shared by the meeting panel and exact-body Ask grounding; a standing rule does not assert an event-specific override.", consumerPaths: ["components/map/meeting-panel.tsx", "lib/ask/meeting-knowledge.ts"] },
  { id: "area-facts", domain: "reference", patterns: [/^lib\/area\/facts\.ts$/], surfaces: ["about-area"], relationship: "State-scoped, cited answers about an area; unheld topics remain gaps.", consumerPaths: ["app/about-area/page.tsx"] },
  { id: "ballot-navigation", domain: "ballot", patterns: [/^lib\/ballot\/(election-dates|polling-place-links|registration-links)\.ts$/], surfaces: ["ballot"], relationship: "Sourced election calendars and official voter lookup links.", consumerPaths: ["app/ballot/page.tsx"] },
  { id: "minutes-summaries", domain: "meetings", patterns: [/^lib\/meetings\/minutes-summaries\.ts$/], surfaces: ["map", "ask"], relationship: "Sourced minutes summaries joined by exact meeting identity on meeting popups and Ask; paraphrases retain their source and cannot substitute for a recorded roll call.", consumerPaths: ["components/map/popup/meeting-popup.tsx", "lib/ask/meeting-knowledge.ts"] },
  { id: "venue-records", domain: "meetings", patterns: [/^lib\/meetings\/venue-cache\.ts$/, /^data\/states\/[^/]+\/meetings\/(insite|legistar)-venues\.json$/], surfaces: ["meetings", "map"], relationship: "Acquired venue/address records used by meeting normalization; a venue match is not another meeting.", consumerPaths: ["lib/meetings/venue-cache.ts"] },
  { id: "campaign-sites", domain: "officials", patterns: [/^lib\/officials\/campaign-sites\.ts$/], surfaces: ["map", "ballot", "representation"], relationship: "Verified campaign/personal links, distinguished from official government websites.", consumerPaths: ["lib/officials/lookup.ts"] },
  { id: "everyday-routing", domain: "reference", patterns: [/^lib\/routing\/everyday\.ts$/], surfaces: ["civic-routing"], relationship: "Cited topic-to-contact records and explicit contact misses, joined to states through the canonical ZIP/OCD projection.", consumerPaths: ["lib/routing/ask.ts"] },
  { id: "sourced-definitions", domain: "reference", patterns: [/^lib\/officials\/(body-definitions|form-definitions|office-blurbs)\.ts$/, /^data\/states\/[^/]+\/reference\/body-blurbs\.json$/], surfaces: ["map", "ballot"], relationship: "Held body, form and office descriptions with their authority and explicit unsourced cases; class definitions do not assert a particular body's powers. Ballot office explanations use the office-blurb selector; map body descriptions use the body/form selectors.", consumerPaths: ["lib/officials/body-definitions.ts", "lib/officials/form-definitions.ts", "lib/officials/office-blurbs.ts"] },
  { id: "body-compositions", domain: "officials", patterns: [/^data\/states\/[^/]+\/officials\/body-compositions\.json$/], surfaces: ["map", "civic-routing"], relationship: "Source-backed legal body compositions govern membership interpretation and contact routing.", consumerPaths: ["lib/registry/body-membership.ts"] },
  { id: "measure-summaries", domain: "ballot", patterns: [/^data\/states\/[^/]+\/ballot\/measure-summaries\.json$/, /^lib\/ballot\/measure-provisions\.ts$/, /^data\/ballot\/measure-records-first-seed\.json$/], surfaces: ["ballot", "ask"], relationship: "Sourced measure summaries and provisions rendered with ballot measures and returned from the same canonical holdings by Ask.", consumerPaths: ["lib/ballot/measure-records.ts", "lib/ballot/measure-summary.ts", "lib/ballot/measure-provisions.ts"] },
  { id: "notice-summaries", domain: "meetings", patterns: [/^data\/states\/[^/]+\/meetings\/notice-summaries\.json$/], surfaces: ["map", "ask"], relationship: "Source-hash-bound meeting-notice summaries shared by the meeting agenda panel and exact-meeting Ask grounding. These summarize the named meeting document, not a ballot measure, candidate position or recorded vote; the former ballot edge was not applicable to this record class.", consumerPaths: ["lib/meetings/notice-summary.ts", "lib/ask/meeting-knowledge.ts"] },
  { id: "state-money", domain: "funding", patterns: [/^data\/states\/[^/]+\/funding\//], surfaces: ["ballot", "state-money", "map", "funding", "ask"], relationship: "Normalized reader snapshot, joined by canonical candidacy identity and explicit officeholder/candidacy bridges. Ballot, official funding and Ask use the same resolved records and provenance; acquired finance corpora are separate inputs.", consumerPaths: ["lib/funding/state-snapshot.ts"] },
  { id: "identity", domain: "identity", patterns: [/^data\/states\/[^/]+\/identity\//], surfaces: ["ballot", "state-money", "map", "funding", "ask"], relationship: "Candidate, contest and officeholder/candidacy identities; committed exact bridges for the reader projection. Identity records support joins and do not claim that every historical candidacy is on the current ballot.", consumerPaths: ["lib/identity/az-2026.ts", "lib/funding/campaign-money.ts"] },
  { id: "ballot", domain: "ballot", patterns: [/^data\/states\/[^/]+\/ballot\//, /^data\/ballot\/candidate-(cards|hunt-state|links)(?:-|\.)/], surfaces: ["ballot", "ask"], relationship: "Ballot/candidate projection, enrichment and sourced analyses.", consumerPaths: ["lib/ballot/registry.ts"] },
  { id: "candidate-corpus", domain: "candidates", patterns: [/^data\/candidates\/corpus-/], surfaces: ["positions", "ballot", "ask"], relationship: "Cited candidate documents, searched through the unified corpus; the ballot uses the same current-extraction contract for its candidate documents.", consumerPaths: ["lib/corpus/unified.ts", "lib/candidates/corpus.ts"] },
  { id: "candidate-acquisitions", domain: "candidates", patterns: [/^data\/states\/[^/]+\/candidates\//], surfaces: ["ballot", "state-money"], relationship: "Acquisition corpus feeding generated identity and reader projections; acquisition is not a claim that every row is displayed.", consumerPaths: ["lib/identity/az-2026.ts", "lib/hunt/candidate-universe.ts"] },
  { id: "local-finance", domain: "campaign-finance", patterns: [/^data\/states\/az\/campaign-finance\/az-pima-2026-(held|transactions)\.json$/], surfaces: ["ask"], relationship: "Existing local-finance reader records linked by the filing officer's exact committee-office designation and committed office-to-body bridge. Only the canonical Ask selector's linked register and transaction records are reader eligible; unlinked committees, unsupported transaction types and acquisition/index metadata remain withheld or supporting inputs. No new data or person-to-committee attachment is declared.", consumerPaths: ["lib/ask/local-finance.ts"] },
  { id: "campaign-finance-corpus", domain: "campaign-finance", patterns: [/^data\/states\/[^/]+\/campaign-finance\//, /^data\/campaign-finance\/filing-regimes\.json$/], surfaces: ["state-money", "ballot"], relationship: "Acquired source corpus and filing regimes feed the normalized state-money snapshots. Unprojected holdings remain inventory.", consumerPaths: ["lib/funding/state-money.ts"] },
  { id: "meetings", domain: "meetings", patterns: [/^data\/meetings-snapshot\.json$/, /^data\/states\/[^/]+\/meetings\//], surfaces: ["meetings", "agenda", "ask", "map"], relationship: "Normalized meeting and agenda rows served through the snapshot loader.", consumerPaths: ["lib/meetings/snapshot.ts"] },
  { id: "federal-finance", domain: "funding", patterns: [/^data\/fec\//], surfaces: ["funding", "ballot", "map", "ask"], relationship: "Federal campaign-finance totals, sourced absences and existing nested display inputs; current ballot, official funding and Ask reach the same canonical answer. State attribution follows candidates, not donor addresses.", consumerPaths: ["lib/funding/snapshot.ts", "lib/funding/display.ts"] },
  { id: "statement-corpus", domain: "corpus", patterns: [/^data\/corpus\//], surfaces: ["positions", "ask"], relationship: "Cited officeholder statements through the unified corpus.", consumerPaths: ["lib/corpus/unified.ts"] },
  { id: "congress", domain: "officeholders", patterns: [/^data\/congress-legislators\//], surfaces: ["map", "representation", "ballot"], relationship: "Federal officeholder identities, published contact and committee directories.", consumerPaths: ["lib/registry/server.ts"] },
  { id: "registry", domain: "registry", patterns: [/^lib\/registry\/.*\.json$/, /^data\/states\/[^/]+\/registry\//], surfaces: ["map", "representation", "ballot", "meetings"], relationship: "Canonical divisions, bodies, officeholders and their sourced links.", consumerPaths: ["lib/registry/server.ts"] },
  { id: "votes", domain: "votes", patterns: [/^data\/votes\//, /^data\/states\/[^/]+\/votes\//], surfaces: ["votes", "ballot", "ask", "map"], relationship: "Recorded-vote holdings with cited summaries and no inferred candidate positions. A tracked member named by a production contract as a bootstrap fixture is immutable first-seed/test evidence, not live Reader authority; production federal vote delivery requires its promoted pointer.", consumerPaths: ["lib/votes/snapshot.ts", "lib/sources/legiscan/snapshot.ts"] },
  { id: "voting-sites", domain: "ballot", patterns: [/^data\/voting-sites\.json$/, /^data\/states\/[^/]+\/voting-sites\//], surfaces: ["voting-sites", "ballot", "map"], relationship: "Sourced voting places and dates through the shared map and ballot voting-sites panel.", consumerPaths: ["lib/ballot/voting-sites-server.ts"] },
  { id: "geography", domain: "geography", patterns: [/^public\/geo\//, /^data\/zcta\//, /^lib\/geo\/.*\.json$/, /^data\/states\/[^/]+\/(geo|zcta|geography|streets)\//, /^data\/derived\/(?!registration\/)/], surfaces: ["map", "ballot", "representation", "meetings"], relationship: "Jurisdiction geometry and reader-location projections; geometry never proves bodies or records have been acquired.", consumerPaths: ["lib/registry/server.ts"] },
  { id: "jurisdictions", domain: "jurisdictions", patterns: [/^data\/states\/[^/]+\/jurisdictions\//], surfaces: [], relationship: "Acquisition inventory and durable route obligations. No direct reader dataset; promotion is separately gated.", consumerPaths: ["lib/hunt/jurisdiction-universe.ts"] },
  { id: "reference", domain: "reference", patterns: [/^data\/reference\/.*\.csv$/, /^data\/audit\/gus-2022-clip-counties\.json$/, /^data\/states\/[^/]+\/reference\//, /^data\/derived\/registration\//], surfaces: [], relationship: "Authoritative reference/enumeration input for acquisition and registry construction; a tenant/domain lead is not a verified government. The registration reference is the runner's input; readers read only each state's promoted registration.", consumerPaths: ["lib/reference/index.ts", "lib/registration/reference.ts"] },
  { id: "asset-index", domain: "assets", patterns: [/^data\/assets\/manifest\.json$/], surfaces: [], relationship: "Content-addressed asset index. Existence and acquired dates are observed separately in the committed vault readback; evidence screenshots are not civic holdings.", consumerPaths: ["scripts/assets.mts"] },
  { id: "dotgov", domain: "reference", patterns: [/^data\/dotgov\//], surfaces: [], relationship: "Government-domain discovery inventory; domains are not a body-coverage denominator.", consumerPaths: ["scripts/fetch-dotgov.mts"] },
  { id: "nh-legislative-members", domain: "officeholders", patterns: [/^data\/states\/nh\/hunt\/nh-gencourt-members\.json$/], surfaces: ["ballot"], relationship: "General Court member records feed sourced ballot-seat incumbency; the published electedStatus is interpreted by the seat-holder loader.", consumerPaths: ["lib/ballot/seat-holders.ts"] },
  { id: "hunt", domain: "hunt", patterns: [/^data\/states\/[^/]+\/hunt\//, /^data\/hunt\//], surfaces: [], relationship: "Historical research/test holdings only. Production Readers and clocks forbid this family; candidate enrichment derives its denominator from promoted ballot/profile records.", consumerPaths: [] },
  { id: "state-officeholders", domain: "officials", patterns: [/^data\/states\/[^/]+\/officials\/officeholders-\d{2}\.json$/], surfaces: [], relationship: "Open States state-legislator projections: an unofficial source marked as such, joined to the official roster when it is held and publishing on its own for any state (rulings §3). Not a Reader fallback until published through the door.", consumerPaths: [] },
  { id: "official-actions", domain: "officials", patterns: [/^data\/states\/[^/]+\/officials\/(?!officeholders-)/], surfaces: ["ballot", "map", "ask"], relationship: "Sourced official actions through the canonical executive-action reader projection; Ask and official cards must preserve the exact action identities, signed/source-document attribution and held-population limits. Supporting acquired roster inputs are separately accounted for.", consumerPaths: ["lib/officials/executive-actions.ts"] },
  { id: "outcomes", domain: "meetings", patterns: [/^data\/outcomes\//, /^data\/states\/[^/]+\/outcomes\//], surfaces: ["agenda", "ask", "map"], relationship: "Held meeting outcomes, actions and recorded roll calls, joined by exact meeting/body identity through the canonical outcome evidence selector.", consumerPaths: ["lib/meetings/reader-records.ts", "lib/outcomes/store.ts"] },
  { id: "questionnaire", domain: "questionnaire", patterns: [/^data\/states\/[^/]+\/questionnaire\//], surfaces: [], relationship: "Questionnaire invitation inventory. An invitation is not a candidate response or position.", consumerPaths: [] },
  { id: "portraits", domain: "portraits", patterns: [/^public\/(candidates|officials)\//, /^data\/states\/[^/]+\/(portraits|photos)\//], surfaces: ["ballot", "map", "representation"], relationship: "Locally served, sourced and reviewed portrait assets; registry photo bindings supply representation while card sources supply candidate/official cards.", consumerPaths: ["lib/officials/card-sources.ts", "lib/registry/server.ts"] },
  { id: "prl", domain: "reference", patterns: [/^data\/prl\//, /^data\/states\/[^/]+\/prl\//], surfaces: ["ballot", "map"], relationship: "Normalized sourced official profile aggregates, joined by exact Bioguide identity. Shares retain PRL attribution and the source statement-count denominator; no ranking or inferred position is projected.", consumerPaths: ["lib/sources/prl/snapshot.ts"] },
];

export function datasetFamily(path: string): DatasetFamily | null {
  return DATASET_FAMILIES.find((family) => family.patterns.some((pattern) => pattern.test(path))) ?? null;
}

/** Runtime validation is also used by the existence test and the generation gate. */
export function validateDatasetMapping(paths: readonly string[], exists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  for (const surface of READER_SURFACES) if (!exists(surface.path)) problems.push(`reader surface ${surface.id} does not exist: ${surface.path}`);
  const ids = new Set<string>(READER_SURFACES.map((s) => s.id));
  for (const path of paths) {
    if (!exists(path)) problems.push(`dataset does not exist: ${path}`);
    const family = datasetFamily(path);
    if (!family) { problems.push(`dataset has no declared reader-surface mapping: ${path}`); continue; }
    for (const id of family.surfaces) if (!ids.has(id)) problems.push(`${path} names unknown reader surface ${id}`);
    for (const consumer of family.consumerPaths) if (!exists(consumer)) problems.push(`${path} names absent consumer ${consumer}`);
  }
  return [...new Set(problems)].sort();
}
