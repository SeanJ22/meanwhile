import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
import { createHash } from "node:crypto";

import {
  promotedEdgeEntryOf,
  readPromotedCivicData,
  type CivicDataReadStore,
  type PromotedCivicDataReadOptions,
  type PromotedEdgeEntry,
} from "./read-model.ts";
import type { PromotedPointerIdentity, RoutineRecordClass } from "./types.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { requiredRoutineContract } from "./contracts.ts";
import {
  readAzBallotProjection,
  readCandidateCorpusProjection,
  readCandidateProfilesProjection,
  readNhBallotProjection,
} from "./manual-read-models.ts";
import {
  DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
  DERIVED_CAMPAIGN_SITES_SCOPE,
  readDerivedCampaignSites,
} from "./derived-campaign-sites.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { VOTING_SITES_CONTRACT } from "../ballot/voting-sites-data-plane.ts";
import { readVotingSitesProjection } from "../ballot/voting-sites-server.ts";
import { readNhMembers } from "./state-members.ts";
import { readFundingSnapshot } from "../funding/snapshot.ts";
import { readStateMoneyProjection } from "../funding/state-snapshot.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, PIMA_LOCAL_FINANCE_CONTRACT, type StateCampaignFinanceJurisdiction } from "../funding/data-plane.ts";
import { azPimaFinanceReadState, refreshAzPimaFinanceFromPromoted } from "../control-plane/campaign-finance/held-records.ts";
import { readFederalRollCallsProjection } from "../votes/snapshot.ts";
import { readFederalKeyVotesProjection } from "../votes/key-votes-projection.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_ROLLCALL_SCOPE } from "../votes/data-plane.ts";
import { readOfficeholderStatementsProjection } from "../corpus/data-plane.ts";
import { readExecutiveActionsProjection } from "../officials/executive-actions.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT } from "../outcomes/data-plane.ts";
import type { PromotedAuthorityFamily, PromotedFamilyArtifactValue, ReaderManifest } from "../meetings/edge-artifacts.ts";
import { servedAuthorityVersion, type PublishAuthorityCarried, type PublishAuthorityValue } from "../meetings/edge-serving.ts";
import { PRL_ARCHIVE_SCOPE, readPrlArchiveProjection } from "../sources/prl/archive-publication.ts";

/**
 * Each pointer is proved exactly as a database Reader proves it, then handed to its family's own Reader; a family
 * whose Reader rejects an update retains the previous entry. A family is read only when its pointers moved.
 */

interface ReaderAnswer {
  readonly kind: string;
  readonly metadata?: { readonly versionId: string | null };
}

export interface PromotedEdgePointer {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  /** The pointer's own typed Reader, handed `{ edge }` exactly as a reader request hands it. */
  readonly reader: (options: PromotedCivicDataReadOptions) => Promise<ReaderAnswer>;
}

const manual = (id: Parameters<typeof requiredManualProductionContract>[0], reader: PromotedEdgePointer["reader"]): PromotedEdgePointer => {
  const contract = requiredManualProductionContract(id);
  return { recordClass: contract.recordClass, scope: contract.scope, reader };
};

export function promotedEdgePointers(): Readonly<Record<PromotedAuthorityFamily, readonly PromotedEdgePointer[]>> {
  const nhMembers = requiredRoutineContract("nh-members");
  return {
    "ballot-contests": [manual("ballot-contests", readGenericBallotProjection)],
    "ballot-az": [manual("az-sos-ballot", readAzBallotProjection)],
    "ballot-nh": [manual("nh-curated-ballot", readNhBallotProjection)],
    "candidate-profiles": [
      manual("candidate-profiles", readCandidateProfilesProjection),
      { recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS, scope: DERIVED_CAMPAIGN_SITES_SCOPE, reader: readDerivedCampaignSites },
    ],
    "candidate-publications": [manual("candidate-corpus", readCandidateCorpusProjection),
      { recordClass: DERIVED_CAMPAIGN_SITES_RECORD_CLASS, scope: DERIVED_CAMPAIGN_SITES_SCOPE, reader: readDerivedCampaignSites }],
    "ballot-navigation": [manual("ballot-navigation", (options) => readCuratedReaderProjection("ballot-navigation", options))],
    "voting-sites": [{ ...VOTING_SITES_CONTRACT, reader: readVotingSitesProjection }],
    "official-filings": [manual("official-filings", (options) => readCuratedReaderProjection("official-filings", options))],
    "member-offices": [manual("member-offices", (options) => readCuratedReaderProjection("member-offices", options))],
    "nh-members": [{ recordClass: nhMembers.recordClass, scope: nhMembers.scope, reader: readNhMembers }],
    "federal-funding": [{ recordClass: "FEC_FUNDING", scope: requiredRoutineContract("fec-funding").scope, reader: readFundingSnapshot }],
    "state-money": (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) => ({
      recordClass: "STATE_CAMPAIGN_FINANCE" as const,
      scope: STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
      reader: (options: PromotedCivicDataReadOptions) => readStateMoneyProjection(state, options),
    })),
    "pima-finance": [{
      recordClass: "LOCAL_CAMPAIGN_FINANCE",
      scope: PIMA_LOCAL_FINANCE_CONTRACT.scope,
      reader: async (options) => { await refreshAzPimaFinanceFromPromoted(options); return azPimaFinanceReadState(); },
    }],
    "federal-votes": [{ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, reader: readFederalRollCallsProjection }],
    "federal-key-votes": [{ recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE, reader: readFederalKeyVotesProjection }],
    "officeholder-statements": [manual("officeholder-statements", readOfficeholderStatementsProjection)],
    "prl-archives": [{ recordClass: "PRL_ARCHIVE", scope: PRL_ARCHIVE_SCOPE, reader: readPrlArchiveProjection }],
    "executive-actions": [{ recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass, scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope, reader: readExecutiveActionsProjection }],
  };
}

type PointerState = Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation"> | null;

export function promotedPointerVersion(recordClass: RoutineRecordClass, scope: string, pointer: PointerState): string {
  if (pointer === null) return `${recordClass}:${scope}=none`;
  const confirmation = pointer.latestConfirmation
    ? `~${createHash("sha256").update(JSON.stringify(pointer.latestConfirmation)).digest("hex").slice(0, 16)}`
    : "";
  return `${recordClass}:${scope}=${pointer.versionId}${confirmation}`;
}

export function promotedFamilyVersion(versions: readonly string[]): string {
  return [...versions].sort().join("|");
}

export interface PromotedEdgeFamiliesRead {
  readonly authority: Partial<Record<PromotedAuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried>>;
  readonly skipped: readonly string[];
}

export async function readPromotedEdgeFamilies(input: {
  readonly store: CivicDataReadStore & { readonly readPromotionIdentity: NonNullable<CivicDataReadStore["readPromotionIdentity"]> };
  readonly servedManifest: Pick<ReaderManifest, "authorityArtifacts"> | null;
  readonly now: string;
  readonly families?: Readonly<Partial<Record<PromotedAuthorityFamily, readonly PromotedEdgePointer[]>>>;
  readonly readServedFamily?: (family: PromotedAuthorityFamily) => Promise<PromotedFamilyArtifactValue | null>;
}): Promise<PromotedEdgeFamiliesRead> {
  const families = input.families ?? promotedEdgePointers();
  const authority: Partial<Record<PromotedAuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried>> = {};
  const skipped: string[] = [];
  for (const [family, pointers] of Object.entries(families) as [PromotedAuthorityFamily, readonly PromotedEdgePointer[]][]) {
    try {
      const served = servedAuthorityVersion(input.servedManifest, family);
      if (served !== null) {
        const current = promotedFamilyVersion(await Promise.all(pointers.map(async ({ recordClass, scope }) =>
          promotedPointerVersion(recordClass, scope, await input.store.readPromotionIdentity(recordClass, scope)))));
        if (current === served) {
          authority[family] = { versionId: served, carried: true };
          continue;
        }
      }
      const entries: PromotedEdgeEntry[] = [];
      const versions: string[] = [];
      let prior: PromotedFamilyArtifactValue | null | undefined;
      for (const { recordClass, scope, reader } of pointers) {
        let entry: PromotedEdgeEntry | null = null;
        try {
          const read = await readPromotedCivicData(recordClass, scope, { store: input.store, now: input.now });
          entry = promotedEdgeEntryOf(read, recordClass, scope, input.store);
          if (entry === null) throw new Error(`${recordClass}:${scope} read ${read.kind}, not a proven or answered-absent pointer`);
          if (entry.kind === "PROMOTED") {
            const accepted = await reader({ edge: entry, now: input.now });
            if (accepted.kind !== "PROMOTED" || accepted.metadata?.versionId !== entry.projection.versionId) {
              throw new Error(`${recordClass}:${scope}: its Reader answered the edge entry ${accepted.kind}`);
            }
          }
        } catch (error) {
          if (prior === undefined) prior = await input.readServedFamily?.(family) ?? null;
          const held = prior?.entries.find(candidate => candidate.kind === "PROMOTED"
            ? candidate.projection.recordClass === recordClass && candidate.projection.scope === scope
            : candidate.recordClass === recordClass && candidate.scope === scope);
          if (!held) throw error;
          skipped.push(`${family} ${error instanceof Error ? error.message : String(error)}; retaining the accepted prior version`);
          entry = held;
        }
        entries.push(entry);
        versions.push(promotedPointerVersion(recordClass, scope, entry.kind === "PROMOTED" ? entry.projection : null));
      }
      const value: PromotedFamilyArtifactValue = { kind: "PROMOTED_POINTERS", entries };
      authority[family] = { value, versionId: promotedFamilyVersion(versions) };
    } catch (error) {
      skipped.push(`${family} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { authority, skipped };
}
