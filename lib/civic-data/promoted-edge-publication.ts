import { REGISTRY_STATES, stateBallotScope } from "./state-scopes.ts";
import { stateRegistryRuntimeScope } from "./state-scopes.ts";
import { DOTGOV_SCOPE, readDotGovProjection } from "./dotgov.ts";
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
import { DERIVED_CAMPAIGN_SITES_RECORD_CLASS } from "./derived-campaign-sites.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
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
import { STATE_AUTHORITY_FAMILIES, type StateAuthorityFamily, type GlobalPromotedAuthorityFamily, type PromotedFamilyArtifactValue } from "../meetings/edge-artifacts.ts";
import { authorityPlaceOfScope, authorityPointerKey, PLACE_SPLIT_FAMILIES, prepareStateAuthorityArtifact, readServedPointer, readServedPromotedFamily, writeAuthorityPointer,
  type PublishAuthorityValue, type PublishedStateAuthority } from "../meetings/edge-serving.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { PRL_ARCHIVE_SCOPE, readPrlArchiveProjection } from "../sources/prl/archive-publication.ts";
import { PRL_CONTRACT } from "../sources/prl/data-plane.ts";
import { readPrlProjection } from "../sources/prl/snapshot.ts";
import type { RoutineDataStore } from "./store.ts";



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

export function promotedEdgePointers(): Readonly<Record<GlobalPromotedAuthorityFamily, readonly PromotedEdgePointer[]>> {
  const nhMembers = requiredRoutineContract("nh-members");
  return {
    "other-reader-data": [],
    "state-votes": [],
    "government-domains": [{ recordClass: "DOTGOV_REFERENCE", scope: DOTGOV_SCOPE, reader: readDotGovProjection }],
    "ballot-navigation": [manual("ballot-navigation", (options) => readCuratedReaderProjection("ballot-navigation", options))],
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
    "prl-profiles": [{ ...PRL_CONTRACT, reader: readPrlProjection }],
    "executive-actions": [{ recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass, scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope, reader: readExecutiveActionsProjection }],
  };
}

function statePromotedEdgePointers(state: string): Readonly<Partial<Record<StateAuthorityFamily, readonly PromotedEdgePointer[]>>> {
  const pointer = (recordClass: RoutineRecordClass, scope: string): PromotedEdgePointer => ({
    recordClass, scope, reader: options => readPromotedCivicData(recordClass, scope, options),
  });
  const registry = { "registry-runtime": [pointer("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state))] };
  return {
    ...registry,
    "ballot-contests": [pointer("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state))],
    "candidate-profiles": [pointer("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", state))],
    "candidate-publications": [pointer("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", state))],
    "voting-sites": [pointer("VOTING_SITE", stateBallotScope("voting-sites", state))],
    "candidate-campaign-sites-derived": [pointer(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, stateBallotScope("candidate-campaign-sites-derived", state))],
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

async function readFamily(input: {
  store: CivicDataReadStore & { readonly readPromotionIdentity: NonNullable<CivicDataReadStore["readPromotionIdentity"]> };
  pointers: readonly PromotedEdgePointer[];
  served: string | null;
  now: string;
  readPrior?: () => Promise<PromotedFamilyArtifactValue | null>;
}): Promise<{ authority: PublishAuthorityValue | null; skipped: string[] }> {
  const { store, pointers, served, now } = input;
  const skipped: string[] = [];
  if (served !== null) {
    const current = promotedFamilyVersion(await Promise.all(pointers.map(async ({ recordClass, scope }) =>
      promotedPointerVersion(recordClass, scope, await store.readPromotionIdentity(recordClass, scope)))));
    if (current === served) return { authority: null, skipped };
  }
  const entries: PromotedEdgeEntry[] = [], versions: string[] = [];
  let prior: PromotedFamilyArtifactValue | null | undefined;
  for (const { recordClass, scope, reader } of pointers) {
    let entry: PromotedEdgeEntry | null = null;
    try {
      const read = await readPromotedCivicData(recordClass, scope, { store, now });
      entry = promotedEdgeEntryOf(read, recordClass, scope, store);
      if (entry === null) throw new Error(`${recordClass}:${scope} read ${read.kind}, not a proven or answered-absent pointer`);
      if (entry.kind === "PROMOTED") {
        const accepted = await reader({ edge: entry, now });
        if (accepted.kind !== "PROMOTED" || accepted.metadata?.versionId !== entry.projection.versionId)
          throw new Error(`${recordClass}:${scope}: its Reader answered the edge entry ${accepted.kind}`);
      }
    } catch (error) {
      if (prior === undefined) prior = await input.readPrior?.() ?? null;
      const held = prior?.entries.find(candidate => candidate.kind === "PROMOTED"
        ? candidate.projection.recordClass === recordClass && candidate.projection.scope === scope
        : candidate.recordClass === recordClass && candidate.scope === scope);
      if (!held) throw error;
      skipped.push(`${error instanceof Error ? error.message : String(error)}; retaining the accepted prior version`);
      entry = held;
    }
    entries.push(entry);
    versions.push(promotedPointerVersion(recordClass, scope, entry.kind === "PROMOTED" ? entry.projection : null));
  }
  return { authority: { value: { kind: "PROMOTED_POINTERS", entries }, versionId: promotedFamilyVersion(versions) }, skipped };
}

/** Each family (each place of a family that grows with places) checks its own pointer and, when it moved, writes it at once. */
export async function publishPromotedEdgeFamilies(input: {
  readonly store: CivicDataReadStore & Pick<RoutineDataStore, "listPromotionScopes"> & { readonly readPromotionIdentity: NonNullable<CivicDataReadStore["readPromotionIdentity"]> };
  readonly artifactStore: ReaderArtifactStore;
  readonly now: string;
  readonly families?: Readonly<Partial<Record<GlobalPromotedAuthorityFamily, readonly PromotedEdgePointer[]>>>;
}): Promise<{ readonly published: readonly string[]; readonly skipped: readonly string[] }> {
  const families = { ...input.families ?? promotedEdgePointers() };
  if (families["other-reader-data"]?.length === 0) {
    const known = new Set([...Object.values(promotedEdgePointers()).flat(), ...selectedStateEdgePointers(null).flatMap(row => row.pointers)].map(pointer => `${pointer.recordClass}:${pointer.scope}`));
    families["other-reader-data"] = (await input.store.listPromotionScopes?.(["CURATED_READER_RECORD", "OPERATIONAL_REFERENCE", "STATE_LEGISLATOR"]) ?? [])
      .filter(pointer => !known.has(`${pointer.recordClass}:${pointer.scope}`))
      .map(pointer => ({ ...pointer, reader: options => readPromotedCivicData(pointer.recordClass, pointer.scope, options) }));
  }
  if (families["state-votes"]?.length === 0) families["state-votes"] = (await input.store.listPromotionScopes?.(["STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES"]) ?? [])
    .map(pointer => ({ ...pointer, reader: options => readPromotedCivicData(pointer.recordClass, pointer.scope, options) }));
  const published: string[] = [], skipped: string[] = [];
  for (const [family, pointers] of Object.entries(families) as [GlobalPromotedAuthorityFamily, readonly PromotedEdgePointer[]][]) {
    const places = new Map<string | undefined, PromotedEdgePointer[]>();
    for (const pointer of pointers) {
      const place = PLACE_SPLIT_FAMILIES.has(family) ? authorityPlaceOfScope(pointer.scope) : undefined;
      places.set(place, [...places.get(place) ?? [], pointer]);
    }
    if (!PLACE_SPLIT_FAMILIES.has(family) && !places.size) places.set(undefined, []);
    for (const [place, held] of places) {
      const name = place === undefined ? family : `${family}/${place}`;
      try {
        const served = await readServedPointer(input.artifactStore, authorityPointerKey(family, place));
        const result = await readFamily({ ...input, pointers: held, served: served?.ref.layout === "records" ? served.ref.version : null,
          readPrior: () => readServedPromotedFamily(family, served?.ref, input.artifactStore, place) });
        skipped.push(...result.skipped.map(reason => `${name} ${reason}`));
        if (!result.authority) continue;
        if (await writeAuthorityPointer(input.artifactStore, family, place, result.authority, served, input.now)) published.push(name);
        else skipped.push(`${name} READER_POINTER_RACED`);
      } catch (error) { skipped.push(`${name} ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { published, skipped };
}

export function selectedStateEdgePointers(selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[] | null) {
  const owns = (pointer: PromotedEdgePointer) => selected === null || selected.some(row => row.recordClass === pointer.recordClass && row.scope === pointer.scope);
  return REGISTRY_STATES.flatMap(state => {
    const families = statePromotedEdgePointers(state);
    return STATE_AUTHORITY_FAMILIES.flatMap(family => {
      const pointers = families[family];
      return pointers?.some(owns) ? [{ state, family, pointers }] : [];
    });
  });
}

/** The artifact of one state family, built from its promoted pointers whether or not anything is promoted there. */
export async function prepareStateEdgeFamily(input: {
  readonly store: CivicDataReadStore & { readonly readPromotionIdentity: NonNullable<CivicDataReadStore["readPromotionIdentity"]> };
  readonly now: string;
  readonly unit: ReturnType<typeof selectedStateEdgePointers>[number];
  readonly artifactStore: ReaderArtifactStore;
}): Promise<{ entry: PublishedStateAuthority; skipped: string[] }> {
  const { state, family, pointers } = input.unit;
  const result = await readFamily({ store: input.store, now: input.now, pointers, served: null });
  return { entry: await prepareStateAuthorityArtifact(family, state, result.authority!, input.artifactStore, input.now),
    skipped: result.skipped.map(reason => `${state}:${family} ${reason}`) };
}
