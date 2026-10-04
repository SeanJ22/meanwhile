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

/**
 * **THE RUNNER PUBLISHES EACH PROVEN POINTER A COLD READER READ FROM THE
 * DATABASE.** (2026-09-25.)
 *
 * On production a cold /ballot?zip=85701 took 5.1–5.8 s on the first request
 * an instance served, and a cold Ask 14.8 s in its source preloads: each read
 * below was a pointer read and a proof read against a cold database (the AZ
 * ballot 0.46 MB of pointer and 1.5 MB of proof; Pima finance 6.4 MB of proof).
 * The standing runner already proves every one of them. Here it publishes the
 * proven pair (`PromotedEdgeEntry`) on the reader edge, one artifact per
 * family, beside the registry and the federal directory.
 *
 * Nothing is published that the Reader would refuse. Each pointer is read and
 * proved exactly as a database Reader proves it (`readPromotedCivicData`), and
 * then handed, as the edge entry itself, to that family's own typed Reader, the
 * one a reader request will call with it: a family whose Reader rejects the
 * entry (a validator throws, a source id mismatches, another version answers)
 * is left out whole, and the reader reads it from the database as before. An
 * answered, absent pointer travels as NOT_RECORDED: every Reader answers it
 * exactly as it answers the database's own NOT_RECORDED.
 *
 * A family is read only when it moved. Its version is its pointers' identities
 * (version and newest unchanged confirmation, which shapes a read's
 * retrieval instant and staleness), so a family whose pointers still name what
 * the served manifest carries is carried by reference and not read at all.
 */

/** Anything a family's typed Reader answers: a read result, or the read state a preload left. */
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

/** Every pointer each proven-pointer family carries, with the Reader that must accept it. */
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
    "executive-actions": [{ recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass, scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope, reader: readExecutiveActionsProjection }],
  };
}

type PointerState = Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation"> | null;

/** One pointer's served identity: its version and newest unchanged confirmation, or `none`. */
export function promotedPointerVersion(recordClass: RoutineRecordClass, scope: string, pointer: PointerState): string {
  if (pointer === null) return `${recordClass}:${scope}=none`;
  const confirmation = pointer.latestConfirmation
    ? `~${createHash("sha256").update(JSON.stringify(pointer.latestConfirmation)).digest("hex").slice(0, 16)}`
    : "";
  return `${recordClass}:${scope}=${pointer.versionId}${confirmation}`;
}

/** A family's version: its pointers' identities, in a fixed order. */
export function promotedFamilyVersion(versions: readonly string[]): string {
  return [...versions].sort().join("|");
}

export interface PromotedEdgeFamiliesRead {
  readonly authority: Partial<Record<PromotedAuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried>>;
  /** One line per family left out this pass, and why. */
  readonly skipped: readonly string[];
}

/**
 * Read every proven-pointer family for publication: carried by reference when
 * its pointers still name the served version, otherwise read, proved and
 * accepted by its own Reader, or left out.
 */
export async function readPromotedEdgeFamilies(input: {
  readonly store: CivicDataReadStore & { readonly readPromotionIdentity: NonNullable<CivicDataReadStore["readPromotionIdentity"]> };
  readonly servedManifest: Pick<ReaderManifest, "authorityArtifacts"> | null;
  readonly now: string;
  /** The families to read; every proven-pointer family when omitted. */
  readonly families?: Readonly<Partial<Record<PromotedAuthorityFamily, readonly PromotedEdgePointer[]>>>;
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
      for (const { recordClass, scope, reader } of pointers) {
        const read = await readPromotedCivicData(recordClass, scope, { store: input.store, now: input.now });
        const entry = promotedEdgeEntryOf(read, recordClass, scope, input.store);
        if (entry === null) throw new Error(`${recordClass}:${scope} read ${read.kind}, not a proven or answered-absent pointer`);
        if (entry.kind === "PROMOTED") {
          // The entry itself, through the Reader a reader request calls with it.
          const accepted = await reader({ edge: entry, now: input.now });
          if (accepted.kind !== "PROMOTED" || accepted.metadata?.versionId !== entry.projection.versionId) {
            throw new Error(`${recordClass}:${scope}: its Reader answered the edge entry ${accepted.kind}`);
          }
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
