import { readLatestReaderReadbacks, routineEventObservedAt, type RoutineDataStore } from "./store.ts";
import type { RoutineSourceContract } from "./contracts.ts";
import type { ManualProductionSourceContract } from "./manual-contracts.ts";
import type { CandidateEvent, PromotedPointerIdentity } from "./types.ts";
import { headSha } from "../ops/git-facts.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { isScopedManualContractScope } from "./scoped-manual-contracts.ts";
import {
  normalizeReaderCodeSha,
  parseReaderProjectionReadback,
  READER_PROJECTION_READBACK_PREFIX,
  READER_READBACK_EVIDENCE_KIND,
  serializeReaderProjectionReadback,
  type ReaderProjectionReadbackReceipt,
} from "./reader-readback.ts";

export const READER_READBACK_RETRY_MS = 5 * 60_000;

export interface RoutineReaderVerification {
  readonly verifierId: string;
  readonly status: "PASS" | "FAIL";
  readonly detail: string;
}

interface VerificationOptions {
  readonly store: RoutineDataStore;
  readonly now: string;
  readonly expectedVersionId: string;
    /** Only a fan-out contract needs it; omitted, the readback uses the contract's per-state marker scope. */
  readonly scope?: string;
}

type ReaderContract = RoutineSourceContract | ManualProductionSourceContract;

interface TypedReadResult {
  readonly kind: string;
  readonly metadata: { readonly versionId: string | null };
}

function pass(verifierId: string, detail: string): RoutineReaderVerification {
  return { verifierId, status: "PASS", detail };
}

function fail(verifierId: string, detail: string): RoutineReaderVerification {
  return { verifierId, status: "FAIL", detail };
}

function verifyExactVersion(
  verifierId: string,
  result: TypedReadResult,
  expectedVersionId: string,
  label: string,
): RoutineReaderVerification {
  if (result.kind !== "PROMOTED" || result.metadata.versionId !== expectedVersionId) {
    return fail(
      verifierId,
      `Expected promoted ${expectedVersionId}; typed ${label} Reader returned ${result.kind}:${result.metadata.versionId ?? "none"}.`,
    );
  }
  return pass(verifierId, `The typed ${label} Reader read canonical version ${expectedVersionId}.`);
}

function verifierIdFor(contract: ReaderContract): string {
  if (contract.recordClass === "FEDERAL_CIVIC_RECORD") return "lib/sources/congress/publication.ts#readFederalSourceProjection";
  if (contract.sourceId === "plural-openstates" && contract.recordClass === "STATE_LEGISLATOR") return "lib/state-rollcalls/legislators.ts#readOpenStatesPeopleProjection";
  switch (contract.id) {
    case "dotgov": return "lib/civic-data/dotgov.ts#readDotGovProjection";
    case "fec-funding": return "lib/funding/snapshot.ts#readFundingSnapshot";
    case "nh-members": return "lib/civic-data/state-members.ts#readNhMembers";
    case "az-state-legislators":
    case "nj-state-legislators": return "lib/state-rollcalls/legislators.ts#readOfficialStateLegislatorsProjection";
    case "az-openstates-votes": return "lib/sources/plural/votes.ts#readArizonaPluralVotesProjection";
    case "az-state-rollcalls":
    case "nj-state-rollcalls": return "lib/sources/legiscan/snapshot.ts#readOfficialStateVotesProjection";
    case "nh-state-rollcalls": return "lib/civic-data/read-model.ts#readPromotedStateLegislatorVotes";
    case "census-acs-population": return "lib/reference/acs-population.ts#readPopulationProjection";
    case "nj-morris-filing": return "lib/sources/ballot-nj-morris/index.ts#readNjMorrisFiling";
    case "congress-bulk-roster": return "lib/officials/federal-directory-read-model.ts#readFederalDirectoryProjection";
    case "registry-runtime-bindings": return "lib/registry/runtime-read-model.ts#readRegistryRuntimeProjection";
    case "congress-rollcalls": return "lib/votes/snapshot.ts#readFederalRollCallsProjection";
    case "federal-key-votes": return "lib/votes/key-votes-projection.ts#readFederalKeyVotesProjection";
    case "ballot-contests": return "lib/ballot/generic-projection.ts#readGenericBallotProjection";
    case "plain-english-translations": return "lib/translate/projection-reader.ts#readTranslationProjection";
    case "special-district-boundaries": return "lib/registry/special-district-boundary-reader.ts#readSpecialDistrictBoundaries";
    case "public-records": return "lib/civic-data/public-records.ts#readPublicRecords";
    case "campaign-finance": return "lib/funding/campaign-finance-reader.ts#readCampaignFinance";
    case "government-budgets": return "lib/civic-data/government-budgets.ts#readGovernmentBudgets";
    case "az-sos-ballot": return "lib/civic-data/manual-read-models.ts#readAzBallotProjection";
    case "nh-curated-ballot": return "lib/civic-data/manual-read-models.ts#readNhBallotProjection";
    case "candidate-profiles": return "lib/civic-data/manual-read-models.ts#readCandidateProfilesProjection";
    case "candidate-corpus": return "lib/civic-data/manual-read-models.ts#readCandidateCorpusProjection";
    case "officeholder-statements": return "lib/corpus/data-plane.ts#readOfficeholderStatementsProjection";
    case "jurisdiction-operational-reference": return "lib/civic-data/operational-references.ts#preloadOperationalReferenceBundle";
    case "jurisdiction-operational-reference-az": return "lib/civic-data/operational-references.ts#preloadAzOperationalReferenceBundle";
    case "az-sos-campaign-finance":
    case "nh-sos-campaign-finance":
    case "nj-elec-campaign-finance": return "lib/funding/state-snapshot.ts#readStateMoneyProjection";
    case "az-pima-local-finance": return "lib/control-plane/campaign-finance/held-records.ts#refreshAzPimaFinanceFromPromoted";
    case "voting-sites": return "lib/ballot/voting-sites-server.ts#readVotingSitesProjection";
    case "prl": return "lib/sources/prl/snapshot.ts#readPrlProjection";
    case "prl-archives": return "lib/sources/prl/archive-publication.ts#readPrlArchiveProjection";
    case "az-official-actions": return "lib/officials/executive-actions.ts#readExecutiveActionsProjection";
    case "pima-legistar-outcomes": return "lib/outcomes/store.ts#readOutcomeProjection";
    case "mesa-legistar-minutes-outcomes": return "lib/outcomes/store.ts#readMesaOutcomeProjection";
    case "official-filings":
    case "comment-access":
    case "ballot-navigation":
    case "stances":
    case "campaign-sites":
    case "member-offices":
    case "venue-resolutions":
    case "meeting-body-crosswalk": return "lib/civic-data/curated-reader-read-model.ts#readCuratedReaderProjection";
    case "meeting-source-wiring": return "lib/civic-data/derived-meeting-wiring.ts#readDerivedMeetingWiring";
    case "meeting-doors": return "lib/doors/meeting-doors.ts#readMeetingDoors";
    case "meeting-body-crosswalk-derived": return "lib/civic-data/derived-crosswalk.ts#readDerivedMeetingBodyCrosswalk";
    case "candidate-campaign-sites-derived": return "lib/civic-data/derived-campaign-sites.ts#readDerivedCampaignSites";
    case "everyday-routing": return "lib/routing/everyday-data-plane.ts#readEverydayRoutingProjection";
    default:
      if (contract.recordClass === "REGISTRATION") return "lib/registration/reader.ts#readRegistrationProjection";
      if (contract.recordClass === "MEETING_OUTCOME" && contract.sourceId === "door-outcomes") return "lib/outcomes/store.ts#readDoorOutcomeProjection";
      return contract.recordClass === "MEETING"
        ? "lib/meetings/snapshot.ts#readMeetingsProjection"
        : `unavailable:${contract.id}`;
  }
}

/** No generic pointer-only fallback: an unknown contract cannot acquire Reader-delivery evidence by declaration. */
export async function verifyRoutineReaderProjection(
  contract: ReaderContract,
  options: VerificationOptions,
): Promise<RoutineReaderVerification> {
  const verifierId = verifierIdFor(contract);
  try {
    if (contract.recordClass === "FEDERAL_CIVIC_RECORD") {
      const { readFederalSourceProjection } = await import("../sources/congress/publication.ts");
      const { isFederalSource } = await import("../sources/congress/targets.ts");
      if (!isFederalSource(contract.sourceId)) return fail(verifierId, "Unknown federal publisher.");
      const scope = options.scope ?? contract.scope;
      const partition = scope.slice(contract.sourceId.length + 1);
      return verifyExactVersion(verifierId, await readFederalSourceProjection(contract.sourceId, partition, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "federal source");
    }
    if (contract.sourceId === "plural-openstates" && contract.recordClass === "STATE_LEGISLATOR") {
      const { readOpenStatesPeopleProjection } = await import("../state-rollcalls/legislators.ts");
      const jurisdiction = /^US-[A-Z]{2}/.exec(contract.scope)?.[0] as `US-${string}` | undefined;
      if (!jurisdiction) return fail(verifierId,"The state people scope has no jurisdiction.");
      return verifyExactVersion(verifierId,await readOpenStatesPeopleProjection(jurisdiction,{store:options.store,now:options.now,bypassCache:true}),options.expectedVersionId,"state people");
    }
    switch (contract.id) {
      case "dotgov": {
        const { readDotGovProjection } = await import("./dotgov.ts");
        return verifyExactVersion(verifierId, await readDotGovProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "government domains");
      }
      case "fec-funding": {
        const { readFundingSnapshot } = await import("../funding/snapshot.ts");
        const result = await readFundingSnapshot({ store: options.store, now: options.now, bypassCache: true });
        return verifyExactVersion(verifierId, result, options.expectedVersionId, "funding");
      }
      case "nh-members": {
        const { readNhMembers } = await import("./state-members.ts");
        const result = await readNhMembers({ store: options.store, now: options.now, bypassCache: true });
        return verifyExactVersion(verifierId, result, options.expectedVersionId, "NH-member");
      }
      case "az-state-legislators":
      case "nj-state-legislators": {
        const { readOfficialStateLegislatorsProjection } = await import("../state-rollcalls/legislators.ts");
        const { officialStateLegislatorTargetByContract } = await import("../state-rollcalls/authority.ts");
        const target = officialStateLegislatorTargetByContract(contract.id);
        if (!target) return fail(verifierId, `No official state-legislator target exists for ${contract.id}.`);
        const result = await readOfficialStateLegislatorsProjection(target.jurisdiction, {
          store: options.store,
          now: options.now,
          bypassCache: true,
        });
        return verifyExactVersion(
          verifierId,
          result,
          options.expectedVersionId,
          `${target.state} official-state-legislator`,
        );
      }
      case "az-openstates-votes": {
        const { readArizonaPluralVotesProjection } = await import("../sources/plural/votes.ts");
        return verifyExactVersion(verifierId, await readArizonaPluralVotesProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "native Arizona votes");
      }
      case "az-state-rollcalls":
      case "nj-state-rollcalls": {
        const [{ readOfficialStateVotesProjection }, { officialStateRollCallTargetByContract }] = await Promise.all([
          import("../sources/legiscan/snapshot.ts"),
          import("../state-rollcalls/authority.ts"),
        ]);
        const target = officialStateRollCallTargetByContract(contract.id);
        if (!target) return fail(verifierId, `No official state-roll target exists for ${contract.id}.`);
        const result = await readOfficialStateVotesProjection(target.jurisdiction, {
          store: options.store,
          now: options.now,
          bypassCache: true,
        });
        return verifyExactVersion(
          verifierId,
          result,
          options.expectedVersionId,
          `${target.state} official-state-roll-call`,
        );
      }
      case "nh-state-rollcalls": {
        const { readPromotedCivicData } = await import("./read-model.ts");
        const scope = options.scope ?? contract.scope;
        const result = await readPromotedCivicData("STATE_LEGISLATOR_VOTES", scope, {
          store: options.store,
          now: options.now,
          bypassCache: true,
        });
        if (result.kind !== "PROMOTED" || result.metadata.versionId !== options.expectedVersionId) {
          return fail(
            verifierId,
            `Expected promoted ${options.expectedVersionId}; STATE_LEGISLATOR_VOTES ${scope} returned ${result.kind}:${result.metadata.versionId ?? "none"}.`,
          );
        }
        const payload = result.value as { officeholderId?: unknown; positions?: unknown; throughRollId?: unknown } | undefined;
        const shaped = payload !== undefined && (
          (typeof payload.officeholderId === "string" && Array.isArray(payload.positions)) ||
          "throughRollId" in payload
        );
        return shaped
          ? pass(verifierId, `The STATE_LEGISLATOR_VOTES projection at ${scope} read canonical version ${options.expectedVersionId}.`)
          : fail(verifierId, `The STATE_LEGISLATOR_VOTES projection at ${scope} is neither a member record nor a session marker.`);
      }
      case "census-acs-population": {
        const { readPopulationProjection } = await import("../reference/acs-population.ts");
        const result = await readPopulationProjection({ store: options.store, now: options.now, bypassCache: true });
        return verifyExactVersion(verifierId, result, options.expectedVersionId, "ACS");
      }
      case "nj-morris-filing": {
        const { readNjMorrisFiling } = await import("../sources/ballot-nj-morris/index.ts");
        const result = await readNjMorrisFiling({ store: options.store, now: options.now, bypassCache: true });
        return verifyExactVersion(verifierId, result, options.expectedVersionId, "Morris ballot");
      }
      case "congress-bulk-roster": {
        const { readFederalDirectoryProjection } = await import("../officials/federal-directory-read-model.ts");
        return verifyExactVersion(verifierId, await readFederalDirectoryProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "federal-directory");
      }
      case "registry-runtime-bindings": {
        const { readRegistryRuntimeProjection } = await import("../registry/runtime-read-model.ts");
        return verifyExactVersion(verifierId, await readRegistryRuntimeProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "registry-runtime");
      }
      case "congress-rollcalls": {
        const { readFederalRollCallsProjection } = await import("../votes/snapshot.ts");
        return verifyExactVersion(verifierId, await readFederalRollCallsProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "federal-roll-call");
      }
      case "federal-key-votes": {
        const { readFederalKeyVotesProjection } = await import("../votes/key-votes-projection.ts");
        return verifyExactVersion(verifierId, await readFederalKeyVotesProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "federal-key-vote");
      }
      case "ballot-contests": {
        const { readGenericBallotProjection } = await import("../ballot/generic-projection.ts");
        return verifyExactVersion(verifierId, await readGenericBallotProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "state-election-ballots");
      }
      case "plain-english-translations": {
        const { readTranslationProjection } = await import("../translate/projection-reader.ts");
        return verifyExactVersion(verifierId, await readTranslationProjection({ store: options.store, now: options.now, bypassCache: true, scope: options.scope }), options.expectedVersionId, "plain-English translation");
      }
      case "special-district-boundaries": {
        const { readSpecialDistrictBoundaries } = await import("../registry/special-district-boundary-reader.ts");
        const prefix = "US:special-district-boundaries:";
        if (!options.scope?.startsWith(prefix)) return fail(verifierId, "District-boundary readback requires its exact county jurisdiction.");
        return verifyExactVersion(verifierId, await readSpecialDistrictBoundaries(options.scope.slice(prefix.length), { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "public-records": {
        const { readPublicRecords } = await import("./public-records.ts");
        const prefix = "US:public-records:";
        if (!options.scope?.startsWith(prefix)) return fail(verifierId, "Public-record readback requires its exact jurisdiction.");
        return verifyExactVersion(verifierId, await readPublicRecords(options.scope.slice(prefix.length), { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "campaign-finance": {
        const { readCampaignFinance } = await import("../funding/campaign-finance-reader.ts");
        const prefix = "US:campaign-finance:";
        if (!options.scope?.startsWith(prefix)) return fail(verifierId, "Campaign-finance readback requires its exact jurisdiction.");
        return verifyExactVersion(verifierId, await readCampaignFinance(options.scope.slice(prefix.length), { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "government-budgets": {
        const { readGovernmentBudgets } = await import("./government-budgets.ts");
        const prefix = "US:government-budgets:";
        if (!options.scope?.startsWith(prefix)) return fail(verifierId, "Budget readback requires its exact jurisdiction.");
        return verifyExactVersion(verifierId, await readGovernmentBudgets(options.scope.slice(prefix.length), { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "az-sos-ballot":
      case "nh-curated-ballot":
      case "candidate-profiles":
      case "candidate-corpus": {
        const readers = await import("./manual-read-models.ts");
        const result = contract.id === "az-sos-ballot"
          ? await readers.readAzBallotProjection({ store: options.store, now: options.now, bypassCache: true })
          : contract.id === "nh-curated-ballot"
            ? await readers.readNhBallotProjection({ store: options.store, now: options.now, bypassCache: true })
            : contract.id === "candidate-profiles"
              ? await readers.readCandidateProfilesProjection({ store: options.store, now: options.now, bypassCache: true })
              : await readers.readCandidateCorpusProjection({ store: options.store, now: options.now, bypassCache: true });
        return verifyExactVersion(verifierId, result, options.expectedVersionId, contract.readerProjection?.id ?? contract.id);
      }
      case "officeholder-statements": {
        const { readOfficeholderStatementsProjection } = await import("../corpus/data-plane.ts");
        return verifyExactVersion(verifierId, await readOfficeholderStatementsProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "officeholder-statements");
      }
      case "jurisdiction-operational-reference": {
        const { preloadOperationalReferenceBundle } = await import("./operational-references.ts");
        return verifyExactVersion(verifierId, await preloadOperationalReferenceBundle({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "operational-reference");
      }
      case "jurisdiction-operational-reference-az": {
        const { preloadAzOperationalReferenceBundle } = await import("./operational-references.ts");
        return verifyExactVersion(verifierId, await preloadAzOperationalReferenceBundle({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "az-operational-reference");
      }
      case "az-sos-campaign-finance":
      case "nh-sos-campaign-finance":
      case "nj-elec-campaign-finance": {
        const { readStateMoneyProjection } = await import("../funding/state-snapshot.ts");
        const { STATE_CAMPAIGN_FINANCE_SOURCES } = await import("../funding/data-plane.ts");
        const state = Object.entries(STATE_CAMPAIGN_FINANCE_SOURCES)
          .find(([, source]) => source.contractId === contract.id)?.[0] as keyof typeof STATE_CAMPAIGN_FINANCE_SOURCES | undefined;
        if (!state) return fail(verifierId, `No state campaign-finance authority owns contract ${contract.id}.`);
        return verifyExactVersion(verifierId, await readStateMoneyProjection(state, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, `${state} campaign-finance`);
      }
      case "az-pima-local-finance": {
        const { refreshAzPimaFinanceFromPromoted } = await import("../control-plane/campaign-finance/held-records.ts");
        const version = await refreshAzPimaFinanceFromPromoted({ store: options.store, now: options.now, bypassCache: true });
        return version === options.expectedVersionId
          ? pass(verifierId, `The typed Pima campaign-finance Reader read canonical version ${options.expectedVersionId}.`)
          : fail(verifierId, `Expected promoted ${options.expectedVersionId}; typed Pima campaign-finance Reader returned ${version ?? "none"}.`);
      }
      case "voting-sites": {
        const { readVotingSitesProjection } = await import("../ballot/voting-sites-server.ts");
        return verifyExactVersion(verifierId, await readVotingSitesProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "voting-sites");
      }
      case "prl": {
        const { readPrlProjection } = await import("../sources/prl/snapshot.ts");
        return verifyExactVersion(verifierId, await readPrlProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "PRL");
      }
      case "prl-archives": {
        const { readPrlArchiveProjection } = await import("../sources/prl/archive-publication.ts");
        return verifyExactVersion(verifierId, await readPrlArchiveProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "PRL archives");
      }
      case "az-official-actions": {
        const { readExecutiveActionsProjection } = await import("../officials/executive-actions.ts");
        return verifyExactVersion(verifierId, await readExecutiveActionsProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "Arizona official-actions");
      }
      case "pima-legistar-outcomes": {
        const [{ readDoorOutcomeProjection }, { PIMA_OUTCOME_TENANT }] = await Promise.all([import("../outcomes/store.ts"), import("../outcomes/data-plane.ts")]);
        return verifyExactVersion(verifierId, await readDoorOutcomeProjection(PIMA_OUTCOME_TENANT.scope, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "Pima meeting-outcomes");
      }
      case "mesa-legistar-minutes-outcomes": {
        const [{ readDoorOutcomeProjection }, { MESA_OUTCOME_TENANT }] = await Promise.all([import("../outcomes/store.ts"), import("../outcomes/data-plane.ts")]);
        return verifyExactVersion(verifierId, await readDoorOutcomeProjection(MESA_OUTCOME_TENANT.scope, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "Mesa meeting-outcomes");
      }
      case "official-filings":
    case "comment-access":
      case "ballot-navigation":
      case "stances":
      case "campaign-sites":
      case "member-offices":
      case "venue-resolutions":
      case "meeting-body-crosswalk": {
        const { readCuratedReaderProjection } = await import("./curated-reader-read-model.ts");
        return verifyExactVersion(verifierId, await readCuratedReaderProjection(contract.id, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "meeting-source-wiring": {
        const { readDerivedMeetingWiring } = await import("./derived-meeting-wiring.ts");
        return verifyExactVersion(verifierId, await readDerivedMeetingWiring({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "meeting-doors": {
        const { readMeetingDoors } = await import("../doors/meeting-doors.ts");
        return verifyExactVersion(verifierId, await readMeetingDoors({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "meeting-body-crosswalk-derived": {
        const { readDerivedMeetingBodyCrosswalk } = await import("./derived-crosswalk.ts");
        return verifyExactVersion(verifierId, await readDerivedMeetingBodyCrosswalk({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "candidate-campaign-sites-derived": {
        const { readDerivedCampaignSites } = await import("./derived-campaign-sites.ts");
        return verifyExactVersion(verifierId, await readDerivedCampaignSites({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "everyday-routing": {
        const { readEverydayRoutingProjection } = await import("../routing/everyday-data-plane.ts");
        return verifyExactVersion(verifierId, await readEverydayRoutingProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, contract.id);
      }
      case "census-geography-overlaps": {
        const { readCensusGeographyProjection } = await import("../census-geography/reader.ts");
        return verifyExactVersion(verifierId, await readCensusGeographyProjection({ store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, "census-geography");
      }
      default: {
        if (contract.recordClass === "REGISTRATION") {
          // One state per contract: the scope names it (`US-OH:registration:v1`).
          const state = /^US-([A-Z]{2}):registration:v1$/.exec(options.scope ?? contract.scope)?.[1];
          if (state === undefined) return fail(verifierId, `A registration scope must name one state; ${options.scope ?? contract.scope} does not.`);
          const { readRegistrationProjection } = await import("../registration/reader.ts");
          return verifyExactVersion(verifierId, await readRegistrationProjection(state, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, `${state} registration`);
        }
        if (contract.recordClass === "MEETING") {
          const { readMeetingsProjection } = await import("../meetings/snapshot.ts");
          const result = await readMeetingsProjection({ store: options.store, now: options.now, bypassCache: true });
          const partition = result.kind === "PROMOTED"
            ? result.partitions.find((item) => item.contractId === contract.id)
            : undefined;
          if (result.kind !== "PROMOTED" || partition?.kind !== "PROMOTED" || partition.versionId !== options.expectedVersionId) {
            return fail(verifierId, `Expected meeting partition ${contract.id}:${options.expectedVersionId}; typed meetings Reader returned ${result.kind}:${partition?.kind ?? "missing"}:${partition?.versionId ?? "none"}.`);
          }
          return pass(verifierId, `The typed meetings Reader composed partition ${contract.id} at canonical version ${options.expectedVersionId}.`);
        }
        if (contract.recordClass === "MEETING_OUTCOME" && contract.sourceId === "door-outcomes") {
                    // A door's own scope, read as the Reader reads it (its tenant and meeting-id namespace checked).
          const { readDoorOutcomeProjection } = await import("../outcomes/store.ts");
          return verifyExactVersion(verifierId, await readDoorOutcomeProjection(options.scope ?? contract.scope, { store: options.store, now: options.now, bypassCache: true }), options.expectedVersionId, `${contract.id} door outcomes`);
        }
        throw new Error(`NO_TYPED_READER_VERIFIER:${contract.id}`);
      }
    }
  } catch (error) {
    return fail(verifierId, error instanceof Error ? error.message : String(error));
  }
}

const POINTER_READBACK_VERIFIER_ID = "lib/civic-data/store.ts#readPromotionIdentity";

async function promotedPointerReadbackIssue(
  store: RoutineDataStore,
  contract: ReaderContract,
  promoted: PromotedPointerIdentity,
): Promise<string | null> {
  let pointer: PromotedPointerIdentity | null;
  try {
    pointer = await store.readPromotionIdentity(contract.recordClass, promoted.scope);
  } catch (error) {
    return `Reading canonical pointer ${promoted.key} failed (${sanitizedErrorDiagnostic(error)}). We could not ask the store.`;
  }
  if (
    pointer === null ||
    pointer.key !== promoted.key ||
    pointer.sourceId !== contract.sourceId ||
    pointer.versionId !== promoted.versionId ||
    pointer.lastKnownGoodVersionId !== promoted.versionId
  ) {
    return `Promoted pointer readback expected ${promoted.versionId}; canonical pointer ${promoted.key} is ` +
      `${pointer === null ? "NOT_RECORDED" : `${pointer.sourceId}:${pointer.versionId}`}.`;
  }
  return null;
}

/** Persists one typed Reader observation without changing candidate disposition, the pointer, or LKG. */
export async function recordRoutineReaderProjectionReadback(
  store: RoutineDataStore,
  contract: ReaderContract,
  promoted: PromotedPointerIdentity,
  observedAt: string,
  verifierCodeSha: string | null = headSha(),
): Promise<ReaderProjectionReadbackReceipt | null> {
  if (contract.readerProjection === null) return null;
  const normalizedVerifierCodeSha = normalizeReaderCodeSha(verifierCodeSha);
  const pointerIssue = await promotedPointerReadbackIssue(store, contract, promoted);
  const readerVerification = pointerIssue !== null
    ? fail(POINTER_READBACK_VERIFIER_ID, pointerIssue)
    : await verifyRoutineReaderProjection(contract, {
        store,
        now: observedAt,
        expectedVersionId: promoted.versionId,
        scope: promoted.scope,
      });
  return appendReaderProjectionReadback(
    store,
    contract,
    promoted,
    observedAt,
    normalizedVerifierCodeSha,
    readerVerification,
  );
}

async function appendReaderProjectionReadback(
  store: RoutineDataStore,
  contract: ReaderContract,
  promoted: PromotedPointerIdentity,
  observedAt: string,
  normalizedVerifierCodeSha: string | null,
  readerVerification: RoutineReaderVerification,
): Promise<ReaderProjectionReadbackReceipt> {
  if (contract.readerProjection === null) {
    throw new Error(`READER_PROJECTION_NOT_APPLICABLE:${contract.id}`);
  }
  const verification = normalizedVerifierCodeSha === null
    ? fail(
        readerVerification.verifierId,
        `The typed Reader result cannot be certified because its executing code commit was not resolvable. ${readerVerification.detail}`,
      )
    : readerVerification;
  observedAt = await routineEventObservedAt(store, promoted.recordClass, promoted.scope, observedAt);
  const receipt: ReaderProjectionReadbackReceipt = {
    contractVersion: 2,
    kind: "READER_PROJECTION_READBACK",
    contractId: contract.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
        // Must equal the promoted candidate's scope, so the durable evidence binds to the row actually read.
    scope: promoted.scope,
    projectionId: contract.readerProjection.id,
    versionId: promoted.versionId,
    pointerKey: promoted.key,
    observedAt,
    evidenceKind: READER_READBACK_EVIDENCE_KIND,
    verifierId: verification.verifierId,
    verifierCodeSha: normalizedVerifierCodeSha,
    status: verification.status,
    detail: verification.detail,
  };
  await store.appendEvidence(promoted.versionId, "PROMOTED", observedAt, serializeReaderProjectionReadback(receipt));
  return receipt;
}

export type ReaderReadbackRepairOutcome =
  | { readonly kind: "NOT_APPLICABLE" | "NO_PROMOTION" | "BACKOFF"; readonly receipt: null }
  | {
      readonly kind: "CURRENT";
      /** The exact durable PASS that made this readback current. */
      readonly receipt: ReaderProjectionReadbackReceipt & { readonly status: "PASS" };
    }
  | {
      readonly kind: "FAILED_BACKOFF";
      readonly receipt: ReaderProjectionReadbackReceipt & { readonly status: "FAIL" };
    }
  | { readonly kind: "RECORDED"; readonly receipt: ReaderProjectionReadbackReceipt };

interface ReaderReadbackInspection {
  readonly outcome: ReaderReadbackRepairOutcome | null;
  readonly promotion: PromotedPointerIdentity | null;
  readonly attestFrom?: ReaderProjectionReadbackReceipt & { readonly status: "PASS"; readonly verifierCodeSha: string };
}

export interface ReaderVerifierClosureAttestation {
  readonly identical: boolean;
  readonly detail: string;
}

/**
 * A PASS is carried to the executing commit only when every file the typed Reader verifiers execute is byte-identical
 * at both commits; the database admits the new receipt only while the pointer still names that version.
 */
export type ReaderVerifierClosureAttestor = (
  priorVerifierCodeSha: string,
  currentVerifierCodeSha: string,
) => Promise<ReaderVerifierClosureAttestation> | ReaderVerifierClosureAttestation;

async function attestReaderProjectionReadback(
  store: RoutineDataStore,
  contract: ReaderContract,
  promotion: PromotedPointerIdentity,
  prior: NonNullable<ReaderReadbackInspection["attestFrom"]>,
  observedAt: string,
  normalizedVerifierCodeSha: string | null,
  attestor: ReaderVerifierClosureAttestor | undefined,
): Promise<ReaderProjectionReadbackReceipt | null> {
  if (attestor === undefined || normalizedVerifierCodeSha === null) return null;
  let attestation: ReaderVerifierClosureAttestation;
  try {
    attestation = await attestor(prior.verifierCodeSha, normalizedVerifierCodeSha);
  } catch {
    return null;
  }
  if (!attestation.identical) return null;
  try {
    return await appendReaderProjectionReadback(
      store,
      contract,
      promotion,
      observedAt,
      normalizedVerifierCodeSha,
      pass(
        prior.verifierId,
        `ATTESTED, not re-read: the exact PASS for canonical version ${promotion.versionId} at code ` +
          `${prior.verifierCodeSha} (observed ${prior.observedAt}) carries to code ${normalizedVerifierCodeSha}; ` +
          `${attestation.detail}`,
      ),
    );
  } catch {
    // Not attested (the pointer moved, or the append failed): the caller
    // re-reads through the typed Reader, whose own failure stays visible.
    return null;
  }
}

function promotionIdentityIssue(contract: ReaderContract, promotion: PromotedPointerIdentity): string | null {
  const scope = isScopedManualContractScope(contract.id, promotion.scope) ? promotion.scope : contract.scope;
  const expectedKey = `${contract.recordClass}:${scope}`;
  if (
    promotion.key !== expectedKey ||
    promotion.sourceId !== contract.sourceId ||
    promotion.recordClass !== contract.recordClass ||
    promotion.scope !== scope ||
    typeof promotion.versionId !== "string" || promotion.versionId.trim() === "" ||
    promotion.lastKnownGoodVersionId !== promotion.versionId
  ) return `READER_PROMOTION_IDENTITY_INVALID:${contract.id}`;
  return null;
}

function inspectReaderReadbackEvents(
  contract: ReaderContract,
  promotion: PromotedPointerIdentity,
  events: readonly CandidateEvent[],
  now: string,
  normalizedVerifierCodeSha: string | null,
): ReaderReadbackInspection {
  const marked = events
    .filter((event) => event.detail.startsWith(READER_PROJECTION_READBACK_PREFIX))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.sequence - left.sequence);
  const latestEvent = marked[0];
  const latest = latestEvent ? parseReaderProjectionReadback(latestEvent.detail) : null;
  const sameVersion = normalizedVerifierCodeSha !== null && latest !== null &&
    latest.contractId === contract.id &&
    latest.sourceId === contract.sourceId &&
    latest.recordClass === contract.recordClass &&
    latest.scope === promotion.scope &&
    latest.projectionId === contract.readerProjection?.id &&
    latest.versionId === promotion.versionId &&
    latest.pointerKey === promotion.key;
  const exact = sameVersion && latest.verifierCodeSha === normalizedVerifierCodeSha;
  if (exact && latest.status === "PASS") {
    return { outcome: { kind: "CURRENT", receipt: { ...latest, status: "PASS" } }, promotion: null };
  }
  const nowMs = Date.parse(now);
  const latestMs = latestEvent ? Date.parse(latestEvent.at) : Number.NaN;
  if (
    exact && latestEvent &&
    Number.isFinite(nowMs) &&
    Number.isFinite(latestMs) &&
    nowMs >= latestMs &&
    nowMs - latestMs < READER_READBACK_RETRY_MS
  ) {
    if (latest.status === "FAIL") {
      return { outcome: { kind: "FAILED_BACKOFF", receipt: { ...latest, status: "FAIL" } }, promotion: null };
    }
    return { outcome: { kind: "BACKOFF", receipt: null }, promotion: null };
  }
  if (sameVersion && !exact && latest.status === "PASS" && latest.verifierCodeSha !== null) {
    return { outcome: null, promotion, attestFrom: { ...latest, status: "PASS", verifierCodeSha: latest.verifierCodeSha } };
  }
  return { outcome: null, promotion };
}

async function inspectReaderReadback(
  store: RoutineDataStore,
  contract: ReaderContract,
  now: string,
  normalizedVerifierCodeSha: string | null,
): Promise<ReaderReadbackInspection> {
  if (contract.readerProjection === null) {
    return { outcome: { kind: "NOT_APPLICABLE", receipt: null }, promotion: null };
  }
  const promotion = await store.readPromotionIdentity(contract.recordClass, contract.scope);
  if (promotion === null) return { outcome: { kind: "NO_PROMOTION", receipt: null }, promotion: null };
  const identityIssue = promotionIdentityIssue(contract, promotion);
  if (identityIssue !== null) throw new Error(identityIssue);
  const events = await readLatestReaderReadbacks(store, [promotion.versionId]);
  return inspectReaderReadbackEvents(contract, promotion, events, now, normalizedVerifierCodeSha);
}

/** Never reacquires a publisher and never mutates source state. */
export async function repairRoutineReaderProjectionReadback(
  store: RoutineDataStore,
  contract: ReaderContract,
  now: string = new Date().toISOString(),
  verifierCodeSha: string | null = headSha(),
  options: {
    readonly attestor?: ReaderVerifierClosureAttestor;
  } = {},
): Promise<ReaderReadbackRepairOutcome> {
  const normalizedVerifierCodeSha = normalizeReaderCodeSha(verifierCodeSha);
  const inspection = await inspectReaderReadback(store, contract, now, normalizedVerifierCodeSha);
  if (inspection.outcome !== null) return inspection.outcome;
  if (inspection.promotion === null) throw new Error(`READER_REPAIR_PROMOTION_MISSING:${contract.id}`);
  if (inspection.attestFrom !== undefined) {
    const attested = await attestReaderProjectionReadback(
      store,
      contract,
      inspection.promotion,
      inspection.attestFrom,
      now,
      normalizedVerifierCodeSha,
      options.attestor,
    );
    if (attested !== null) return { kind: "RECORDED", receipt: attested };
  }
  const receipt = await recordRoutineReaderProjectionReadback(
    store,
    contract,
    inspection.promotion,
    now,
    normalizedVerifierCodeSha,
  );
  if (receipt === null) return { kind: "NOT_APPLICABLE", receipt: null };
  return { kind: "RECORDED", receipt };
}

export const MEETING_READER_EVENT_READ_CONCURRENCY = 8;
export const MEETING_READER_EVIDENCE_WRITE_CONCURRENCY = 4;

type MeetingsAggregateRead = Awaited<ReturnType<typeof import("../meetings/snapshot.ts")["readMeetingsProjection"]>>;

export type MeetingReaderReadbackRepairResult =
  | {
      readonly contractId: string;
      readonly ok: true;
      readonly value: ReaderReadbackRepairOutcome;
      readonly error: null;
    }
  | {
      readonly contractId: string;
      readonly ok: false;
      readonly value: null;
      readonly error: string;
    };

export async function repairMeetingReaderProjectionReadbacks(
  store: RoutineDataStore,
  contracts: readonly RoutineSourceContract[],
  now: string = new Date().toISOString(),
  verifierCodeSha: string | null = headSha(),
  options: {
    readonly aggregate?: () => Promise<MeetingsAggregateRead>;
    readonly attestor?: ReaderVerifierClosureAttestor;
  } = {},
): Promise<readonly MeetingReaderReadbackRepairResult[]> {
  const ids = contracts.map(({ id }) => id);
  const scopes = contracts.map(({ scope }) => scope);
  if (new Set(ids).size !== ids.length || new Set(scopes).size !== scopes.length) {
    throw new Error("MEETING_READER_REPAIR_CONTRACT_IDENTITY_DUPLICATE");
  }
  if (contracts.some((contract) => contract.recordClass !== "MEETING" || contract.readerProjection === null)) {
    throw new Error("MEETING_READER_REPAIR_CONTRACT_INVALID");
  }
  if (contracts.length === 0) return [];

  const results = new Map<string, MeetingReaderReadbackRepairResult>();
  let promotions: readonly PromotedPointerIdentity[];
  try {
    promotions = await store.readPromotionIdentities("MEETING", scopes);
  } catch (error) {
    const detail = sanitizedErrorDiagnostic(error);
    return contracts.map(({ id }) => ({ contractId: id, ok: false, value: null, error: detail }));
  }
  const promotionsByScope = new Map<string, PromotedPointerIdentity[]>();
  for (const promotion of promotions) {
    const rows = promotionsByScope.get(promotion.scope) ?? [];
    rows.push(promotion);
    promotionsByScope.set(promotion.scope, rows);
  }

  const eventInputs: { readonly contract: RoutineSourceContract; readonly promotion: PromotedPointerIdentity }[] = [];
  for (const contract of contracts) {
    const matching = promotionsByScope.get(contract.scope) ?? [];
    if (matching.length === 0) {
      results.set(contract.id, {
        contractId: contract.id,
        ok: true,
        value: { kind: "NO_PROMOTION", receipt: null },
        error: null,
      });
      continue;
    }
    if (matching.length !== 1) {
      results.set(contract.id, {
        contractId: contract.id,
        ok: false,
        value: null,
        error: `MEETING_READER_PROMOTION_DUPLICATE:${contract.id}`,
      });
      continue;
    }
    const promotion = matching[0]!;
    const identityIssue = promotionIdentityIssue(contract, promotion);
    if (identityIssue !== null) {
      results.set(contract.id, { contractId: contract.id, ok: false, value: null, error: identityIssue });
      continue;
    }
    eventInputs.push({ contract, promotion });
  }

  const normalizedVerifierCodeSha = normalizeReaderCodeSha(verifierCodeSha);
  const eventReads = await runBoundedWorkPool(
    eventInputs,
    MEETING_READER_EVENT_READ_CONCURRENCY,
    ({ promotion }) => readLatestReaderReadbacks(store, [promotion.versionId]),
  );
  let pendingRecords: { readonly contract: RoutineSourceContract; readonly promotion: PromotedPointerIdentity }[] = [];
  const attestable: {
    readonly contract: RoutineSourceContract;
    readonly promotion: PromotedPointerIdentity;
    readonly prior: NonNullable<ReaderReadbackInspection["attestFrom"]>;
  }[] = [];
  for (const read of eventReads) {
    const input = eventInputs[read.index]!;
    if (!read.ok) {
      results.set(input.contract.id, {
        contractId: input.contract.id,
        ok: false,
        value: null,
        error: read.error,
      });
      continue;
    }
    const inspection = inspectReaderReadbackEvents(
      input.contract,
      input.promotion,
      read.value,
      now,
      normalizedVerifierCodeSha,
    );
    if (inspection.outcome !== null) {
      results.set(input.contract.id, {
        contractId: input.contract.id,
        ok: true,
        value: inspection.outcome,
        error: null,
      });
    } else if (inspection.attestFrom !== undefined && options.attestor !== undefined) {
      attestable.push({ ...input, prior: inspection.attestFrom });
    } else {
      pendingRecords.push(input);
    }
  }

  if (attestable.length > 0) {
    const attestations = await runBoundedWorkPool(
      attestable,
      MEETING_READER_EVIDENCE_WRITE_CONCURRENCY,
      ({ contract, promotion, prior }) => attestReaderProjectionReadback(
        store,
        contract,
        promotion,
        prior,
        now,
        normalizedVerifierCodeSha,
        options.attestor,
      ),
    );
    const unattested: typeof pendingRecords = [];
    for (const attestation of attestations) {
      const { contract, promotion } = attestable[attestation.index]!;
      if (attestation.ok && attestation.value !== null) {
        results.set(contract.id, {
          contractId: contract.id,
          ok: true,
          value: { kind: "RECORDED", receipt: attestation.value },
          error: null,
        });
      } else {
        // Not attested, or its append failed: the aggregate re-reads it.
        unattested.push({ contract, promotion });
      }
    }
    pendingRecords = [...pendingRecords, ...unattested];
  }

  if (pendingRecords.length > 0) {
    let aggregate: MeetingsAggregateRead | null = null;
    let aggregateError: string | null = null;
    try {
      if (options.aggregate) {
        aggregate = await options.aggregate();
      } else {
        const { readMeetingsProjection } = await import("../meetings/snapshot.ts");
        aggregate = await readMeetingsProjection({ store, now, bypassCache: true });
      }
    } catch (error) {
      aggregateError = sanitizedErrorDiagnostic(error);
    }

    if (aggregateError !== null || aggregate === null) {
      for (const { contract } of pendingRecords) {
        results.set(contract.id, {
          contractId: contract.id,
          ok: false,
          value: null,
          error: aggregateError ?? "MEETING_READER_AGGREGATE_RESULT_MISSING",
        });
      }
    } else {
      const evidenceWrites = await runBoundedWorkPool(
        pendingRecords,
        MEETING_READER_EVIDENCE_WRITE_CONCURRENCY,
        async ({ contract, promotion }) => {
          const partition = aggregate.kind === "PROMOTED"
            ? aggregate.partitions.find(({ contractId }) => contractId === contract.id)
            : undefined;
          const verification = aggregate.kind === "PROMOTED" &&
              partition?.kind === "PROMOTED" &&
              partition.versionId === promotion.versionId
            ? pass(
                verifierIdFor(contract),
                `The typed meetings Reader composed partition ${contract.id} at canonical version ${promotion.versionId}.`,
              )
            : fail(
                verifierIdFor(contract),
                `Expected meeting partition ${contract.id}:${promotion.versionId}; typed meetings Reader returned ` +
                  `${aggregate.kind}:${partition?.kind ?? "missing"}:${partition?.versionId ?? "none"}.`,
              );
          return appendReaderProjectionReadback(
            store,
            contract,
            promotion,
            now,
            normalizedVerifierCodeSha,
            verification,
          );
        },
      );
      for (const write of evidenceWrites) {
        const { contract } = pendingRecords[write.index]!;
        results.set(contract.id, write.ok
          ? {
              contractId: contract.id,
              ok: true,
              value: { kind: "RECORDED", receipt: write.value },
              error: null,
            }
          : { contractId: contract.id, ok: false, value: null, error: write.error });
      }
    }
  }

  return contracts.map((contract) => results.get(contract.id) ?? ({
    contractId: contract.id,
    ok: false as const,
    value: null,
    error: `MEETING_READER_REPAIR_RESULT_MISSING:${contract.id}`,
  }));
}
