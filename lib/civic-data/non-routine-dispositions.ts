import type { RoutineDataClassification } from "./types.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  type ManualProductionSourceContract,
} from "./manual-contracts.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
} from "./meeting-partitions.ts";
import { REGISTRATION_TARGETS } from "../registration/publication.ts";

export type NonRoutineDisposition =
  | "EXPLICIT_VERSION_ADOPTION"
  | "OPERATIONAL"
  | "RESEARCH_ONLY"
  | "FIXTURE";

export type NonRoutineExecution =
  | "REVIEWED_SOFTWARE_OR_DATA_MODEL_CHANGE"
  | "MANUAL_CONTROL_PLANE_OPERATION"
  | "MANUAL_RESEARCH"
  | "TEST_ONLY";

export type ForbiddenNonRoutineExecution =
  | "SCHEDULED_EXECUTION"
  | "ROUTINE_RUNNER_EXECUTION"
  | "AUTOMATIC_PRODUCTION_PROMOTION"
  | "UNREVIEWED_TRACKED_WRITE"
  | "READER_RUNTIME_FALLBACK"
  | "PRODUCTION_CANONICAL_USE";

export interface NonRoutineExecutionPolicy {
  readonly permitted: readonly NonRoutineExecution[];
  readonly forbidden: readonly ForbiddenNonRoutineExecution[];
  readonly readerUse: "ADOPTED_VERSION" | "CONTROL_PLANE_ONLY" | "FORBIDDEN";
  readonly requiresReviewedSoftwareChange: boolean;
}

const VERSION_ADOPTION = {
  permitted: ["REVIEWED_SOFTWARE_OR_DATA_MODEL_CHANGE"],
  forbidden: ["SCHEDULED_EXECUTION", "ROUTINE_RUNNER_EXECUTION", "AUTOMATIC_PRODUCTION_PROMOTION", "UNREVIEWED_TRACKED_WRITE"],
  readerUse: "ADOPTED_VERSION",
  requiresReviewedSoftwareChange: true,
} as const satisfies NonRoutineExecutionPolicy;

const OPERATIONAL = {
  permitted: ["MANUAL_CONTROL_PLANE_OPERATION"],
  forbidden: ["SCHEDULED_EXECUTION", "ROUTINE_RUNNER_EXECUTION", "AUTOMATIC_PRODUCTION_PROMOTION", "UNREVIEWED_TRACKED_WRITE", "READER_RUNTIME_FALLBACK"],
  readerUse: "CONTROL_PLANE_ONLY",
  requiresReviewedSoftwareChange: false,
} as const satisfies NonRoutineExecutionPolicy;

const RESEARCH_ONLY = {
  permitted: ["MANUAL_RESEARCH"],
  forbidden: ["SCHEDULED_EXECUTION", "ROUTINE_RUNNER_EXECUTION", "AUTOMATIC_PRODUCTION_PROMOTION", "UNREVIEWED_TRACKED_WRITE", "READER_RUNTIME_FALLBACK", "PRODUCTION_CANONICAL_USE"],
  readerUse: "FORBIDDEN",
  requiresReviewedSoftwareChange: false,
} as const satisfies NonRoutineExecutionPolicy;

const FIXTURE = {
  permitted: ["TEST_ONLY"],
  forbidden: ["SCHEDULED_EXECUTION", "ROUTINE_RUNNER_EXECUTION", "AUTOMATIC_PRODUCTION_PROMOTION", "UNREVIEWED_TRACKED_WRITE", "READER_RUNTIME_FALLBACK", "PRODUCTION_CANONICAL_USE"],
  readerUse: "FORBIDDEN",
  requiresReviewedSoftwareChange: true,
} as const satisfies NonRoutineExecutionPolicy;

export interface NonRoutineDispositionContract {
  readonly sourceId: string;
  readonly inventoryClassification: RoutineDataClassification | "STATIC_VERSIONED_REFERENCE" | "RESEARCH_ONLY" | "SOFTWARE_FIXTURE";
  readonly disposition: NonRoutineDisposition;
  readonly trackedPaths: readonly string[];
  readonly execution: NonRoutineExecutionPolicy;
  /**
   * Exact readers named by the frozen census whose dependency on this
   * tracked row has since been retired. This records a completed cutover;
   * it is not permission for a production fallback.
   */
  readonly retiredFrozenRuntimeReaders?: readonly string[];
  /** Runtime dependencies found by the implementation census beyond the frozen row. */
  readonly retiredDiscoveredRuntimeReaders?: readonly string[];
  /** Executable tracked-output doors deleted or narrowed during the cutover. */
  readonly retiredWriterExecutables?: readonly string[];
  /** Permanent routine authorities that replace this retired research Reader. */
  readonly replacementRoutineContracts?: readonly {
    readonly contractId: string;
    readonly contractSourceId: string;
  }[];
  readonly reason: string;
}

/**
 * Rows that are lawfully outside the standing runner. Every update mode here
 * is intentionally non-automatic. Adding an entry cannot create a second
 * freshness clock or a production promotion door.
 */
export const NON_ROUTINE_DISPOSITIONS: readonly NonRoutineDispositionContract[] = [
  {
    sourceId: "nj-questionnaire-invitations",
    inventoryClassification: "OPERATIONAL_REFERENCE_DATA",
    disposition: "OPERATIONAL",
    trackedPaths: ["data/questionnaire/invitations-nj-morris-2026.json"],
    execution: OPERATIONAL,
    reason:
      "The tracked derivative and its writer are retired. The remaining command derives an unsent, non-persistent operational plan from the canonical NJ filing and rejects every tracked-write mode.",
  },
  {
    sourceId: "census-geography",
    inventoryClassification: "STATIC_VERSIONED_REFERENCE",
    disposition: "EXPLICIT_VERSION_ADOPTION",
    trackedPaths: ["public/geo/**", "data/zcta/**", "data/states/*/geo/**", "data/states/*/zcta/**", "data/states/*/geography/**", "data/states/*/streets/**", "data/derived/**"],
    execution: VERSION_ADOPTION,
    reason: "Each Census/GIS product is adopted as a named immutable source vintage through a reviewed software/data-model change.",
  },
  {
    sourceId: "registry-static-identities",
    inventoryClassification: "STATIC_VERSIONED_REFERENCE",
    disposition: "EXPLICIT_VERSION_ADOPTION",
    trackedPaths: ["lib/registry/curated-bodies.ts", "lib/registry/tribal-nations.ts", "stable division/schema projections"],
    execution: VERSION_ADOPTION,
    reason: "Legal identity and schema records change only as an explicit reviewed model version.",
  },
  {
    sourceId: "curated-versioned-reference",
    inventoryClassification: "STATIC_VERSIONED_REFERENCE",
    disposition: "EXPLICIT_VERSION_ADOPTION",
    trackedPaths: ["lib/area/facts.ts", "lib/officials/body-definitions.ts", "lib/officials/form-definitions.ts", "lib/officials/office-blurbs.ts", "data/states/*/officials/body-compositions.json", "public/candidates/**", "public/officials/**", "data/states/*/portraits/**", "data/states/*/photos/**"],
    execution: VERSION_ADOPTION,
    reason: "Definitions, compositions, and reviewed content-addressed assets are explicit product versions, not a freshness feed.",
  },
  {
    sourceId: "asset-index",
    inventoryClassification: "OPERATIONAL_REFERENCE_DATA",
    disposition: "OPERATIONAL",
    trackedPaths: ["data/assets/manifest.json"],
    execution: OPERATIONAL,
    reason: "The manifest is a manually rebuilt control-plane index over immutable content hashes and makes no Reader civic-truth claim.",
  },
  {
    sourceId: "static-reference-vintages",
    inventoryClassification: "STATIC_VERSIONED_REFERENCE",
    disposition: "EXPLICIT_VERSION_ADOPTION",
    trackedPaths: ["data/reference/census_govt_units_2022*.csv", "data/reference/census_tiger_2023_territory_functional_status.csv", "data/reference/nces_ccd_lea_directory_2025_26.csv", "cited embedded definition modules"],
    execution: VERSION_ADOPTION,
    reason: "The filename and review identify the adopted source vintage; replacement is a deliberate version change.",
  },
  {
    sourceId: "granicus-fixture",
    inventoryClassification: "SOFTWARE_FIXTURE",
    disposition: "FIXTURE",
    trackedPaths: ["data/reference/granicus_legistar_tenants.csv"],
    execution: FIXTURE,
    reason: "The recorded tenant table is test input only.",
  },
  {
    sourceId: "software-fixtures",
    inventoryClassification: "SOFTWARE_FIXTURE",
    disposition: "FIXTURE",
    trackedPaths: ["data/fixtures/**", "tests/fixtures/**", "lib/control-plane/fixtures/**"],
    execution: FIXTURE,
    reason: "Synthetic and recorded fixtures may execute only in deterministic tests.",
  },
  {
    sourceId: "legiscan-state-rollcalls",
    inventoryClassification: "RESEARCH_ONLY",
    disposition: "RESEARCH_ONLY",
    trackedPaths: ["data/votes/state-votes-snapshot.json"],
    execution: RESEARCH_ONLY,
    retiredFrozenRuntimeReaders: ["lib/sources/legiscan/snapshot.ts", "votes", "Ask", "map", "ballot"],
    replacementRoutineContracts: [
      { contractId: "az-state-rollcalls", contractSourceId: "az-legislature" },
      { contractId: "nh-state-rollcalls", contractSourceId: "nh-general-court" },
      { contractId: "nj-state-rollcalls", contractSourceId: "nj-legislature" },
    ],
    reason:
      "The mutable LegiScan writer and every production fallback are retired. The tracked corpus is historical research/test evidence only; Reader state roll calls require a proof-validated promotion from an official state publisher.",
  },
  {
    sourceId: "plural-bulk-roster",
    inventoryClassification: "RESEARCH_ONLY",
    disposition: "RESEARCH_ONLY",
    trackedPaths: ["data/reference/openstates_legislators.csv", "data/states/*/officials/officeholders-*.json"],
    execution: RESEARCH_ONLY,
    retiredFrozenRuntimeReaders: ["lib/registry/server.ts", "representation", "map", "ballot", "Ask"],
    retiredDiscoveredRuntimeReaders: [
      "lib/funding/campaign-money.ts",
      "registry-runtime-bindings officialCandidacies projection",
      "data/ballot/candidate-links-2026.json",
      "lib/photos/person.ts candidate portrait bridge",
      "lib/registry/server.ts portrait-id bridge",
      "lib/officials/campaign-sites.ts intermediary-id bridge",
      "lib/corpus/unified.ts intermediary-keyed statement bridge",
      "lib/holdings/reader-census.ts portrait delivery projection",
      "next.config.ts production trace",
    ],
    retiredWriterExecutables: [
      "scripts/build-officeholders.ts#state",
      "scripts/b14-official-links.mts",
      "scripts/enrich-officials.mts",
      "scripts/fix-nh-official-pages.mts",
      "scripts/fix-stale-official-pages.mts",
      "scripts/reader-finance-identity.mts",
    ],
    replacementRoutineContracts: [
      { contractId: "az-state-legislators", contractSourceId: "az-legislature" },
      { contractId: "nj-state-legislators", contractSourceId: "nj-legislature" },
    ],
    reason:
      "The Plural/OpenStates state-projection writers, derived candidate/finance bridges, and every production fallback are retired. The tracked CSV and derived state rosters remain historical research/test evidence only; current membership must come from a proof-validated official-legislature projection.",
  },
  {
    sourceId: "research-holdings",
    inventoryClassification: "RESEARCH_ONLY",
    disposition: "RESEARCH_ONLY",
    trackedPaths: ["data/hunt/**", "data/states/*/hunt/** except data/states/nh/hunt/nh-gencourt-members.json", "unwired route descriptors"],
    execution: RESEARCH_ONLY,
    retiredDiscoveredRuntimeReaders: [
      "lib/control-plane/scheduler/providers/candidate-enrichment.ts candidate denominator",
    ],
    retiredWriterExecutables: ["scripts/candidate-universe.mts"],
    reason:
      "The standing candidate-enrichment denominator is derived from proof-validated promoted ballot/profile records. The generated candidate-universe writer is deleted, so the remaining hunt holdings and unwired descriptors are historical research/test evidence only and cannot enter a production Reader or clock.",
  },
];

function trackedPathPatternMatches(pattern: string, path: string): boolean {
  const [included, excluded] = pattern.split(" except ", 2);
  const matches = (candidate: string) => {
    const doubleStar = "__PDC_DOUBLE_STAR__";
    const expression = candidate
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("**", doubleStar)
      .replaceAll("*", "[^/]*")
      .replaceAll(doubleStar, ".*");
    return new RegExp(`^${expression}$`).test(path);
  };
  return matches(included) && (!excluded || !matches(excluded));
}

/** Exact governing disposition for a tracked path, including reviewed globs. */
export function nonRoutineDispositionForTrackedPath(
  path: string,
): NonRoutineDispositionContract | null {
  return NON_ROUTINE_DISPOSITIONS.find((disposition) =>
    disposition.trackedPaths.some((pattern) => trackedPathPatternMatches(pattern, path))
  ) ?? null;
}

export interface RoutineInventoryBinding {
  readonly inventorySourceId: string;
  readonly contractIds: readonly string[];
  readonly contractSourceId: string;
  /**
   * A bound contract whose own source authority differs from the row's first
   * writer, by contract id: one frozen family, read from another permitted
   * route. Every other bound contract carries `contractSourceId`.
   */
  readonly contractSourceIds?: Readonly<Record<string, string>>;
}

/** The source authority a binding requires of one bound contract. */
export function boundContractSourceId(binding: RoutineInventoryBinding, contractId: string): string {
  return binding.contractSourceIds?.[contractId] ?? binding.contractSourceId;
}

/**
 * Frozen inventory rows bound to the actual standing-runner contracts. The
 * former composite meetings row fans out to SOURCE_WIRING-derived
 * source/body contracts; it does not name or recreate an aggregate authority.
 */
export const ROUTINE_INVENTORY_BINDINGS = [
  { inventorySourceId: "meetings-composite", contractIds: MEETING_PARTITION_CONTRACTS.filter(({ derivedFamily }) => derivedFamily === null).map(({ id }) => id), contractSourceId: "meetings-public-bodies" },
  // C16 (a session label; the authority is rulings §3): the derived wiring store and the per-state derived meeting families.
  // + the automatic crosswalk (C16 option A, 2026-09-25), the same authority's second derived store.
  { inventorySourceId: "meeting-source-wiring", contractIds: ["meeting-body-crosswalk-derived", "meeting-source-wiring"], contractSourceId: "meeting-source-wiring" },
  { inventorySourceId: "meetings-derived-families", contractIds: MEETING_PARTITION_CONTRACTS.filter(({ derivedFamily }) => derivedFamily !== null).map(({ id }) => id), contractSourceId: "meetings-derived-routes" },
  { inventorySourceId: "nj-morris-clerk-ballot", contractIds: ["nj-morris-filing"], contractSourceId: "nj-morris-county-clerk" },
  { inventorySourceId: "dotgov", contractIds: ["dotgov"], contractSourceId: "cisa-dotgov-registry" },
  { inventorySourceId: "fec-open-api", contractIds: ["fec-funding"], contractSourceId: "fec-open-api" },
  { inventorySourceId: "nh-general-court", contractIds: ["nh-members"], contractSourceId: "nh-general-court" },
  { inventorySourceId: "census-acs-api", contractIds: ["census-acs-population"], contractSourceId: "census-data-api" },
  { inventorySourceId: "census-geography-relationships", contractIds: ["census-geography-overlaps"], contractSourceId: "census-geography-relationships" },
  // Formerly an explicit-owner contract; the standing runner is now its only
  // clock and writer, so it carries no manual binding below.
  // NH332 (2026-09-25): the same official Legistar body records, read for Mesa
  // off the council's minutes on its permitted portal host, under its own authority.
  {
    inventorySourceId: "legistar-outcomes",
    contractIds: ["pima-legistar-outcomes", "mesa-legistar-minutes-outcomes"],
    contractSourceId: "pima-legistar-outcomes",
    contractSourceIds: { "mesa-legistar-minutes-outcomes": "mesa-legistar-minutes-outcomes" },
  },
  // One registration contract per state, DC and territory, from the FIPS table (lib/registration/publication.ts).
  { inventorySourceId: "census-governments-registration", contractIds: REGISTRATION_TARGETS.map(({ contractId }) => contractId), contractSourceId: "census-governments-registration" },
  // The verified campaign sites the campaign-site chain approves, published automatically (Sean 2026-09-21; RULING 292).
  { inventorySourceId: "candidate-campaign-site-chain", contractIds: ["candidate-campaign-sites-derived"], contractSourceId: "candidate-campaign-site-chain" },
] as const satisfies readonly RoutineInventoryBinding[];

export interface ManualProductionInventoryBinding {
  readonly inventorySourceId: string;
  readonly contractId: string;
  readonly contractSourceId: string;
  readonly additionalContracts?: readonly { readonly contractId: string; readonly contractSourceId: string }[];
  readonly reason: string;
}

/** Runtime civic data with an explicit owner clock and canonical promotion plane. */
export const MANUAL_PRODUCTION_INVENTORY_BINDINGS: readonly ManualProductionInventoryBinding[] = [
  {
    inventorySourceId: "meeting-body-crosswalk", contractId: "meeting-body-crosswalk", contractSourceId: "curated-reader-primary-sources",
    reason: "Reviewed records connecting a government's calendar to its exact body, each on the government's own saved pages cited by sha256 and promoted through the verified manual door by the owner or a reviewing agent session (rulings §3); the derived meeting-source wiring reads only the promoted version.",
  },
  {
    inventorySourceId: "congress-bulk-roster", contractId: "congress-bulk-roster", contractSourceId: "congress-directory-project",
    reason: "The SHA-pinned five-file Congress directory acquisition promotes current federal membership/contact/committee facts with exact hashes and LKG isolation; tracked roster/directory files are first-seed/test evidence only and the migration/build/enrichment writers are deleted.",
  },
  {
    inventorySourceId: "registry-runtime-bindings", contractId: "registry-runtime-bindings", contractSourceId: "registry-reviewed-bindings",
    reason: "Owner-reviewed body/division, body-roster, statewide-officeholder/contact, exact roster-disposition, officeholder/candidacy, and photo bindings promote atomically through the canonical plane. Registry, roster, statewide-executive, promoted-body, candidacy-bridge, and photo holdings are first-seed/test evidence; production readers fail closed and all tracked writer doors are deleted, promotion-only, or explicitly fixture-only.",
  },
  {
    inventorySourceId: "congress-rollcalls", contractId: "congress-rollcalls", contractSourceId: "federal-legislative-records",
    reason: "Official recent federal roll calls and positions promote through the explicit-owner contract; tracked JSON is first-seed-only and no writer remains.",
  },
  {
    inventorySourceId: "federal-key-votes", contractId: "federal-key-votes", contractSourceId: "federal-legislative-records",
    reason: "Reviewed question/roll selection v1 is software input; current official questions, tallies, URL verification, and positions promote as one LKG-protected projection. Mutable pending/law/chamber status is excluded unless an official acquisition is represented in its durable receipt.",
  },
  {
    inventorySourceId: "az-sos-ballot", contractId: "az-sos-ballot", contractSourceId: "az-election-authorities",
    additionalContracts: [{ contractId: "ballot-contests", contractSourceId: "official-ballot-authorities" },
      { contractId: "plain-english-translations", contractSourceId: "curated-reader-primary-sources" }],
    reason: "The first-seed ballot contract and its general official-authority worker replacement own canonical Reader projections; tracked holdings remain first-seed evidence only.",
  },
  {
    inventorySourceId: "nh-curated-ballot", contractId: "nh-curated-ballot", contractSourceId: "nh-election-authorities",
    reason: "The explicit-owner New Hampshire ballot contract owns the canonical Reader projection; tracked holdings are first-seed evidence only.",
  },
  {
    inventorySourceId: "candidate-profiles", contractId: "candidate-profiles", contractSourceId: "candidate-primary-publications",
    reason: "Candidate profile facts promote through the explicit-owner contract and Readers fail closed on its canonical pointer.",
  },
  {
    inventorySourceId: "candidate-corpus", contractId: "candidate-corpus", contractSourceId: "candidate-primary-publications",
    reason: "Candidate publication facts promote through the explicit-owner contract and Readers fail closed on its canonical pointer.",
  },
  {
    inventorySourceId: "officeholder-statements", contractId: "officeholder-statements", contractSourceId: "officeholder-primary-publications",
    reason: "Owner-reviewed primary-publication snapshots promote through the canonical candidate/event/promotion plane; the tracked append corpus is an immutable first seed and has no writer or production fallback.",
  },
  {
    inventorySourceId: "operational-reference-inventories", contractId: "jurisdiction-operational-reference", contractSourceId: "jurisdiction-operational-reference",
    additionalContracts: [{ contractId: "jurisdiction-operational-reference-az", contractSourceId: "jurisdiction-operational-reference-az" }],
    reason: "Covered-jurisdiction operational routing is promoted and read from the canonical data plane. Obsolete mutable FEC/state-CF writers are deleted; remaining tracked inventories are historical, versioned, research, or test evidence and are non-authoritative.",
  },
  {
    inventorySourceId: "az-sos-campaign-finance", contractId: "az-sos-campaign-finance", contractSourceId: "az-sos-campaign-finance",
    additionalContracts: [{ contractId: "campaign-finance", contractSourceId: "curated-reader-primary-sources" }],
    reason: "Owner-invoked SeeTheMoney acquisition promotes validated 2026 records and exact changes to the canonical plane; tracked state-money/corpus files are test and first-seed evidence only.",
  },
  {
    inventorySourceId: "nh-sos-campaign-finance", contractId: "nh-sos-campaign-finance", contractSourceId: "nh-sos-campaign-finance",
    reason: "Owner-invoked NH CFS acquisition reconciles the statewide filer index to totalItems and promotes the Reader projection without a tracked writer.",
  },
  {
    inventorySourceId: "nj-elec-campaign-finance", contractId: "nj-elec-campaign-finance", contractSourceId: "nj-elec-campaign-finance",
    reason: "Owner-invoked ELEC acquisition validates each official location/control result and promotes the Reader projection; short locations are held rather than written as absence.",
  },
  {
    inventorySourceId: "az-pima-local-finance", contractId: "az-pima-local-finance", contractSourceId: "az-pima-local-finance",
    reason: "Owner-invoked Pima acquisition promotes the official filer index and public redacted transaction rows together; tracked local files are deterministic first-seed/test evidence only.",
  },
  {
    inventorySourceId: "az-governor-actions", contractId: "az-official-actions", contractSourceId: "az-official-actions",
    additionalContracts: [{ contractId: "executive-actions", contractSourceId: "curated-reader-primary-sources" }],
    reason: "Owner-reviewed Arizona Governor/Legislature source bytes promote exact official-action records; the former tracked action snapshot is test/history evidence and has no production Reader or writer.",
  },
  {
    inventorySourceId: "voting-sites", contractId: "voting-sites", contractSourceId: "voting-sites",
    reason: "Owner-invoked acquisitions from the official Pima, Morris County, and New Hampshire election authorities promote source-scoped voting-site records; a failed jurisdiction retains only its prior good rows, and the tracked holdings are bootstrap/test evidence with no production fallback or writer.",
  },
  {
    inventorySourceId: "prl", contractId: "prl", contractSourceId: "prl",
    reason: "Owner-invoked acquisition of the attributed PRL national archive promotes exact Bioguide-keyed profiles under its restricted source tier and licence; the tracked snapshot is bootstrap/test evidence with no production fallback or writer.",
  },
];

export type Pdc7MigrationKind =
  | "PRODUCTION_DATA_PLANE"
  | "OPERATIONAL_REFERENCE_PLANE"
  | "RESEARCH_READER_DECOUPLING"
  | "ROW_SPLIT_REQUIRED";

export interface Pdc7MigrationBlocker {
  readonly sourceId: string;
  readonly kind: Pdc7MigrationKind;
  readonly trackedPaths: readonly string[];
  readonly forbiddenUntilResolved: readonly ("SCHEDULED_EXECUTION" | "AUTOMATIC_PRODUCTION_PROMOTION" | "VERSION_ADOPTION_RELABEL")[];
  readonly reason: string;
}

export type ResolvedSplitPathDisposition =
  | {
      readonly path: string;
      readonly disposition: "PRODUCTION_DATA_PLANE";
      readonly contractId: string;
      readonly contractSourceId: string;
      readonly reason: string;
    }
  | {
      readonly path: string;
      readonly disposition: "EXPLICIT_VERSION_ADOPTION";
      readonly versionBinding: string;
      readonly reason: string;
    };

export interface ResolvedSplitInventoryBinding {
  readonly inventorySourceId: string;
  readonly paths: readonly ResolvedSplitPathDisposition[];
  /** New publishers in this existing family, distinguished from the immutable
   * cutover census. They retain the same exact contract/source checks. */
  readonly addedProductionPaths?: readonly Extract<ResolvedSplitPathDisposition, { disposition: "PRODUCTION_DATA_PLANE" }>[];
}

/**
 * Exact path partition for the one mixed frozen row. Mutable current facts
 * have canonical candidate/event/promotion pointers; immutable reviewed
 * transformations are source-version-bound and acquire no freshness clock.
 */
export const PDC7_RESOLVED_SPLIT_BINDINGS: readonly ResolvedSplitInventoryBinding[] = [
  {
    inventorySourceId: "curated-reader-records",
    addedProductionPaths: [
      { path: "lib/civic-data/official-filings.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "official-filings", contractSourceId: "curated-reader-primary-sources", reason: "Independently verified filing facts use the existing curated source, candidate/event/promotion and Reader checks. Added after the frozen cutover; neither the historical paths nor the 42-family denominator is rewritten." },
      { path: "lib/civic-data/special-district-boundaries.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "special-district-boundaries", contractSourceId: "curated-reader-primary-sources", reason: "Saved official district polygons publish through the existing scoped Slide and typed address reader; frozen inventory families are unchanged." },
      { path: "lib/civic-data/public-records.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "public-records", contractSourceId: "curated-reader-primary-sources", reason: "Source-worded public records use the existing saved-evidence worker and normal Slide; frozen inventory families are unchanged." },
      { path: "lib/civic-data/government-budgets.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "government-budgets", contractSourceId: "curated-reader-primary-sources", reason: "Official adopted budget facts use the normal source-backed worker and Slide; frozen inventory families are unchanged." },
      { path: "lib/officials/member-offices.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "member-offices", contractSourceId: "curated-reader-primary-sources", reason: "State legislators' capitol and district offices are refreshed daily from Open States (owner decision 2026-10-01), joined to each official roster, and read only from the canonical member-offices pointer. Added after the frozen cutover; neither the historical paths nor the 42-family denominator is rewritten." },
    ],
    paths: [
      { path: "lib/registry/body-rosters.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "registry-runtime-bindings", contractSourceId: "registry-reviewed-bindings", reason: "Current body membership/contact/term/party rows are members of the canonical registry runtime projection; this module is first-seed/test evidence only." },
      { path: "lib/officials/statewide-executives.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "registry-runtime-bindings", contractSourceId: "registry-reviewed-bindings", reason: "Current statewide executive/contact/party rows are members of the canonical registry runtime projection; this module is first-seed/test evidence only." },
      { path: "lib/registry/comment-access.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "comment-access", contractSourceId: "curated-reader-primary-sources", reason: "Standing public-comment rules can change at their publishers and therefore require an exact-byte reviewed promotion, source-scoped receipt, and LKG." },
      { path: "lib/ballot/election-dates.ts", disposition: "EXPLICIT_VERSION_ADOPTION", versionBinding: "state + electionDay + cited official 2026 calendar + reviewedAt", reason: "A named election calendar is a finite adopted election vintage. Changing election/cycle or official calendar is a reviewed software/data-model version, not a polling clock." },
      { path: "lib/ballot/polling-place-links.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "ballot-navigation", contractSourceId: "curated-reader-primary-sources", reason: "A live authority lookup URL may move and is read only from the canonical ballot-navigation pointer." },
      { path: "lib/ballot/registration-links.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "ballot-navigation", contractSourceId: "curated-reader-primary-sources", reason: "A live authority lookup URL may move and is read only from the canonical ballot-navigation pointer." },
      { path: "lib/meetings/minutes-summaries.ts", disposition: "EXPLICIT_VERSION_ADOPTION", versionBinding: "source-namespaced meeting id + immutable published minutes document id/url + reviewed readAt", reason: "Each row is a reviewed paraphrase of one concluded sitting's named finalized minutes document, never a claim about the current meeting feed." },
      { path: "lib/meetings/venue-cache.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "venue-resolutions", contractSourceId: "curated-reader-primary-sources", reason: "Venue/address resolutions can change independently of software. Meeting acquisition reads the exact promoted source/body/raw-location mapping; a bad reviewed successor holds only this pointer and prior GOOD resolutions remain live." },
      { path: "lib/officials/campaign-sites.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "campaign-sites", contractSourceId: "curated-reader-primary-sources", reason: "A campaign/personal site binding changes independently of software and is read only from its reviewed canonical promotion." },
      { path: "lib/routing/everyday.ts", disposition: "PRODUCTION_DATA_PLANE", contractId: "everyday-routing", contractSourceId: "curated-reader-primary-sources", reason: "Every topic/ZIP cell is promoted as one source-scoped contact or an explicit UNKNOWN/CONTACT_OWED obligation; production meeting and Ask readers use only the canonical projection." },
      { path: "data/states/*/meetings/notice-summaries.json", disposition: "EXPLICIT_VERSION_ADOPTION", versionBinding: "meetingId + SHA-256 contentHash + summarizesUrl", reason: "The summary renders only against the exact notice bytes it paraphrases; a revised notice hash makes it inapplicable." },
      { path: "data/states/*/ballot/measure-summaries.json", disposition: "EXPLICIT_VERSION_ADOPTION", versionBinding: "contestId + cited official analysis/measure record + reviewed artifact recordsSha256", reason: "Neutral editorial paraphrases are deliberately reviewed content attached to the adopted ballot-source version, not an automatic freshness feed." },
    ],
  },
];

const BLOCKED = ["SCHEDULED_EXECUTION", "AUTOMATIC_PRODUCTION_PROMOTION", "VERSION_ADOPTION_RELABEL"] as const;

/**
 * Mutable rows that cannot truthfully be closed by a non-routine label. These
 * stay explicit and fail closed until their named migration is implemented.
 */
export const PDC7_MIGRATION_BLOCKERS: readonly Pdc7MigrationBlocker[] = [
];

export type HoldingFamilyClassification = RoutineDataClassification | "STATIC_VERSIONED_REFERENCE" | "RESEARCH_ONLY" | "SOFTWARE_FIXTURE";

export interface HoldingFamilyDisposition {
  readonly familyId: string;
  readonly classification: HoldingFamilyClassification | readonly HoldingFamilyClassification[];
  readonly splitSourceIds?: readonly string[];
}

const RUNTIME_FAMILIES = ["body-rosters", "statewide-executives", "comment-access", "ballot-navigation", "minutes-summaries", "venue-records", "campaign-sites", "everyday-routing", "measure-summaries", "notice-summaries", "state-money", "identity", "ballot", "candidate-corpus", "candidate-acquisitions", "local-finance", "campaign-finance-corpus", "meetings", "federal-finance", "statement-corpus", "congress", "votes", "voting-sites", "nh-legislative-members", "state-officeholders", "official-actions", "outcomes", "prl"] as const;
const OPERATIONAL_FAMILIES = ["jurisdictions", "asset-index", "dotgov", "questionnaire"] as const;
const STATIC_FAMILIES = ["curated-body-identities", "tribal-nation-identities", "area-facts", "sourced-definitions", "body-compositions", "geography", "portraits"] as const;

/** One record per holdings family; split families remain one explicitly split record. */
export const HOLDING_FAMILY_DISPOSITIONS: readonly HoldingFamilyDisposition[] = [
  ...RUNTIME_FAMILIES.map((familyId) => ({ familyId, classification: "RUNTIME_CIVIC_DATA" as const })),
  ...OPERATIONAL_FAMILIES.map((familyId) => ({ familyId, classification: "OPERATIONAL_REFERENCE_DATA" as const })),
  ...STATIC_FAMILIES.map((familyId) => ({ familyId, classification: "STATIC_VERSIONED_REFERENCE" as const })),
  { familyId: "hunt", classification: "RESEARCH_ONLY" },
  { familyId: "registry", classification: ["RUNTIME_CIVIC_DATA", "STATIC_VERSIONED_REFERENCE"], splitSourceIds: ["registry-runtime-bindings", "registry-static-identities"] },
  { familyId: "reference", classification: ["OPERATIONAL_REFERENCE_DATA", "STATIC_VERSIONED_REFERENCE", "SOFTWARE_FIXTURE"], splitSourceIds: ["operational-reference-inventories", "static-reference-vintages", "granicus-fixture"] },
];

interface InventoryRowLike {
  readonly source_id: string;
  readonly classification: string;
  readonly tracked_paths: readonly string[];
  readonly current_scheduler: string;
  readonly current_promotion_door: string;
  readonly runtime_readers: readonly string[];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => seen.has(value) || !seen.add(value));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export interface Pdc7ClosureProblem {
  readonly sourceId: string;
  readonly kind: Pdc7MigrationKind;
  readonly detail: string;
}

/**
 * Terminal PDC-7 truth, kept separate from denominator accounting. A row being
 * named is not the same as its authority having moved; every result here is an
 * unresolved cutover that prevents PDC-7 from passing.
 */
export function pdc7ClosureProblems(): readonly Pdc7ClosureProblem[] {
  return PDC7_MIGRATION_BLOCKERS.map(({ sourceId, kind, reason }) => ({
    sourceId,
    kind,
    detail: reason,
  }));
}

/**
 * Frozen-denominator accounting. This proves there are no UNKNOWN or multiply
 * classified rows; it deliberately does not convert a named migration blocker
 * into closure. Call {@link pdc7ClosureProblems} for the terminal verdict.
 */
export function validatePdc7DispositionRegistry(
  inventoryRows: readonly InventoryRowLike[],
  holdingFamilyIds: readonly string[],
): string[] {
  const problems: string[] = [];
  const routineIds = ROUTINE_INVENTORY_BINDINGS.map((row) => row.inventorySourceId);
  const manualIds = MANUAL_PRODUCTION_INVENTORY_BINDINGS.map((row) => row.inventorySourceId);
  const dispositionIds = NON_ROUTINE_DISPOSITIONS.map((row) => row.sourceId);
  const resolvedSplitIds = PDC7_RESOLVED_SPLIT_BINDINGS.map((row) => row.inventorySourceId);
  const blockerIds = PDC7_MIGRATION_BLOCKERS.map((row) => row.sourceId);
  const classifiedIds: string[] = [...routineIds, ...manualIds, ...dispositionIds, ...resolvedSplitIds, ...blockerIds];
  for (const duplicate of duplicates(classifiedIds)) problems.push(`inventory source classified more than once: ${duplicate}`);
  for (const duplicate of duplicates(inventoryRows.map((row) => row.source_id))) problems.push(`inventory source appears more than once: ${duplicate}`);

  const inventoryById = new Map(inventoryRows.map((row) => [row.source_id, row]));
  for (const sourceId of classifiedIds) if (!inventoryById.has(sourceId)) problems.push(`classified source absent from inventory: ${sourceId}`);
  for (const row of inventoryRows) if (!classifiedIds.includes(row.source_id)) problems.push(`UNKNOWN inventory disposition: ${row.source_id}`);

  const manualContracts = new Map<string, ManualProductionSourceContract>(
    MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => [contract.id, contract]),
  );
  const routineContracts = new Map(observableRoutineContracts().map((contract) => [contract.id, contract]));
  const boundRoutineContracts = new Set<string>();
  for (const binding of ROUTINE_INVENTORY_BINDINGS) {
    if (binding.contractIds.length === 0) problems.push(`${binding.inventorySourceId}: routine production binding is empty`);
    for (const contractId of binding.contractIds) {
      const contract = routineContracts.get(contractId);
      if (!contract) problems.push(`${binding.inventorySourceId}: routine production contract ${contractId} is absent`);
      else if (contract.sourceId !== boundContractSourceId(binding, contractId)) problems.push(`${binding.inventorySourceId}: routine production authority differs from ${boundContractSourceId(binding, contractId)}`);
      if (boundRoutineContracts.has(contractId)) problems.push(`routine production contract has multiple frozen inventory bindings: ${contractId}`);
      boundRoutineContracts.add(contractId);
    }
  }
  for (const disposition of NON_ROUTINE_DISPOSITIONS) {
    for (const binding of disposition.replacementRoutineContracts ?? []) {
      const contract = routineContracts.get(binding.contractId);
      if (!contract) problems.push(`${disposition.sourceId}: replacement routine contract ${binding.contractId} is absent`);
      else if (contract.sourceId !== binding.contractSourceId) problems.push(`${disposition.sourceId}: replacement routine authority differs from ${binding.contractSourceId}`);
      if (boundRoutineContracts.has(binding.contractId)) problems.push(`routine production contract has multiple frozen inventory bindings: ${binding.contractId}`);
      boundRoutineContracts.add(binding.contractId);
    }
  }
  for (const contract of routineContracts.values()) {
    if (!boundRoutineContracts.has(contract.id)) problems.push(`routine production contract has no frozen inventory binding: ${contract.id}`);
  }
  const manualProductionBindings = MANUAL_PRODUCTION_INVENTORY_BINDINGS.flatMap(binding => [
    { inventorySourceId: binding.inventorySourceId, contractId: binding.contractId, contractSourceId: binding.contractSourceId },
    ...(binding.additionalContracts ?? []).map(contract => ({ inventorySourceId: binding.inventorySourceId, ...contract })),
  ]);
  const seenManualContracts = new Set<string>();
  for (const binding of manualProductionBindings) {
    const contract = manualContracts.get(binding.contractId);
    if (!contract) problems.push(`${binding.inventorySourceId}: manual production contract ${binding.contractId} is absent`);
    else if (contract.sourceId !== binding.contractSourceId) problems.push(`${binding.inventorySourceId}: manual production authority differs from ${binding.contractSourceId}`);
    if (seenManualContracts.has(binding.contractId)) problems.push(`manual production contract has multiple frozen inventory bindings: ${binding.contractId}`);
    seenManualContracts.add(binding.contractId);
  }
  const splitProductionContracts = PDC7_RESOLVED_SPLIT_BINDINGS.flatMap((binding) =>
    [...binding.paths, ...(binding.addedProductionPaths ?? [])].flatMap((path) => path.disposition === "PRODUCTION_DATA_PLANE" ? [path.contractId] : []),
  );
  const boundManualContracts = new Set([
    ...manualProductionBindings.map((binding) => binding.contractId),
    ...splitProductionContracts,
  ]);
  for (const contract of MANUAL_PRODUCTION_SOURCE_CONTRACTS) {
    if (!boundManualContracts.has(contract.id)) problems.push(`manual production contract has no frozen inventory binding: ${contract.id}`);
  }

  for (const disposition of NON_ROUTINE_DISPOSITIONS) {
    const inventory = inventoryById.get(disposition.sourceId);
    if (!inventory) continue;
    if (inventory.classification !== disposition.inventoryClassification) problems.push(`${disposition.sourceId}: classification differs from frozen inventory`);
    if (!sameStrings(inventory.tracked_paths, disposition.trackedPaths)) problems.push(`${disposition.sourceId}: tracked paths differ from frozen inventory`);
    for (const required of ["SCHEDULED_EXECUTION", "ROUTINE_RUNNER_EXECUTION", "AUTOMATIC_PRODUCTION_PROMOTION"] as const) {
      if (!disposition.execution.forbidden.includes(required)) problems.push(`${disposition.sourceId}: ${required} is not forbidden`);
    }
    if (/\b(?:daily|weekly|monthly|cron|schedule(?:d)?)\b/i.test(inventory.current_scheduler) && !/\b(?:manual|none|explicit)\b/i.test(inventory.current_scheduler)) {
      problems.push(`${disposition.sourceId}: non-routine row still names an automatic scheduler`);
    }
    if (/automatic|standing runner|routine runner/i.test(inventory.current_promotion_door)) problems.push(`${disposition.sourceId}: non-routine row still names an automatic promotion door`);
    if (disposition.disposition === "RESEARCH_ONLY" || disposition.disposition === "FIXTURE") {
      const nonTestReaders = inventory.runtime_readers.filter((reader) => !/\btests?\b/i.test(reader));
      const retiredReaders = disposition.retiredFrozenRuntimeReaders ?? [];
      const unresolvedReaders = nonTestReaders.filter((reader) => !retiredReaders.includes(reader));
      const inventedRetirements = retiredReaders.filter((reader) => !nonTestReaders.includes(reader));
      if (unresolvedReaders.length > 0) problems.push(`${disposition.sourceId}: research/fixture row has runtime fallback readers: ${unresolvedReaders.join(", ")}`);
      if (inventedRetirements.length > 0) problems.push(`${disposition.sourceId}: retired reader is absent from the frozen census: ${inventedRetirements.join(", ")}`);
      if (disposition.execution.readerUse !== "FORBIDDEN" || !disposition.execution.forbidden.includes("READER_RUNTIME_FALLBACK")) {
        problems.push(`${disposition.sourceId}: research/fixture runtime fallback is not forbidden`);
      }
    }
  }

  for (const split of PDC7_RESOLVED_SPLIT_BINDINGS) {
    const inventory = inventoryById.get(split.inventorySourceId);
    if (!inventory) continue;
    if (inventory.classification !== "RUNTIME_CIVIC_DATA") problems.push(`${split.inventorySourceId}: resolved split is not the frozen runtime row`);
    const paths = split.paths.map((path) => path.path);
    if (!sameStrings(inventory.tracked_paths, paths)) problems.push(`${split.inventorySourceId}: resolved split paths differ from frozen inventory`);
    const currentPaths = [...split.paths, ...(split.addedProductionPaths ?? [])];
    for (const duplicate of duplicates(currentPaths.map(path => path.path))) problems.push(`${split.inventorySourceId}: split path classified more than once: ${duplicate}`);
    for (const path of currentPaths) {
      if (!path.path || !path.reason) problems.push(`${split.inventorySourceId}: production path or reason is missing`);
      if (path.disposition === "PRODUCTION_DATA_PLANE") {
        const contract = manualContracts.get(path.contractId);
        if (!contract) problems.push(`${split.inventorySourceId}:${path.path}: production contract ${path.contractId} is absent`);
        else if (contract.sourceId !== path.contractSourceId) problems.push(`${split.inventorySourceId}:${path.path}: production authority differs from ${path.contractSourceId}`);
      } else if (!/source|document|content|hash|version|artifact|calendar|meeting|contest/i.test(path.versionBinding)) {
        problems.push(`${split.inventorySourceId}:${path.path}: version adoption lacks an exact source/version binding`);
      }
    }
  }

  for (const blocker of PDC7_MIGRATION_BLOCKERS) {
    const inventory = inventoryById.get(blocker.sourceId);
    if (inventory && !sameStrings(inventory.tracked_paths, blocker.trackedPaths)) problems.push(`${blocker.sourceId}: blocker paths differ from frozen inventory`);
    for (const required of BLOCKED) if (!blocker.forbiddenUntilResolved.includes(required)) problems.push(`${blocker.sourceId}: unresolved row does not forbid ${required}`);
  }

  const familyIds = HOLDING_FAMILY_DISPOSITIONS.map((row) => row.familyId);
  for (const duplicate of duplicates(familyIds)) problems.push(`holding family classified more than once: ${duplicate}`);
  for (const id of holdingFamilyIds) if (!familyIds.includes(id)) problems.push(`UNKNOWN holding family disposition: ${id}`);
  for (const id of familyIds) if (!holdingFamilyIds.includes(id)) problems.push(`classified holding family absent from registry: ${id}`);
  for (const row of HOLDING_FAMILY_DISPOSITIONS) {
    const classifications = Array.isArray(row.classification) ? row.classification : [row.classification];
    if (classifications.length === 0 || classifications.some((classification) => String(classification).includes("UNKNOWN"))) {
      problems.push(`${row.familyId}: holding family has UNKNOWN classification`);
    }
  }
  return [...new Set(problems)].sort();
}
