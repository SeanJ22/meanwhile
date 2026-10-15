import { currentGenericBallotProjection } from "../ballot/generic-projection.ts";

import type {
  AzIdentityRegistry,
  LineupReconciliation,
  LineupReconciliationRow,
} from "./types.ts";

let registryCache: AzIdentityRegistry | null | undefined;
let bridgeCache: LineupReconciliation | null | undefined;
let rowIndex: Map<string, LineupReconciliationRow> | null = null;
let coveredContests: Set<string> | null = null;

export function azIdentityRegistry(): AzIdentityRegistry | null {
  registryCache = Object.values(currentGenericBallotProjection().ballots).find(ballot => ballot.identityRegistry)?.identityRegistry ?? null;
  return registryCache;
}

export function azLineupReconciliation(): LineupReconciliation | null {
  const next = Object.values(currentGenericBallotProjection().ballots).find(ballot => ballot.lineupReconciliation)?.lineupReconciliation ?? null;
  if (next !== bridgeCache) {
    bridgeCache = next;
    rowIndex = null;
    coveredContests = null;
  }
  return bridgeCache;
}

function index(): Map<string, LineupReconciliationRow> {
  const bridge = azLineupReconciliation();
  if (rowIndex) return rowIndex;
  rowIndex = new Map((bridge?.rows ?? []).map((r) => [r.cardKey, r]));
  return rowIndex;
}

export function lineupBridgeCovers(contestId: string): boolean {
  if (!contestId.startsWith("ballot-az-")) return false;
  const bridge = azLineupReconciliation();
  if (!coveredContests) {
    coveredContests = new Set((bridge?.rows ?? []).map((r) => r.contestId));
  }
  return coveredContests.has(contestId);
}

/** The precomputed row for one nominee card, or `null` if there is none. */
export function lineupRowForCard(cardKey: string): LineupReconciliationRow | null {
  if (!cardKey.startsWith("ballot-az-")) return null;
  return index().get(cardKey) ?? null;
}

export function reconciledCandidacyIdForCard(cardKey: string): string | null {
  const row = lineupRowForCard(cardKey);
  if (!row || row.outcome !== "RECONCILED") return null;
  return row.canonicalCandidacyId;
}

export interface PartyConflictFiling {
  readonly cardKey: string;
  readonly contestId: string;
  readonly filingCandidacyId: string;
  readonly name: string;
  readonly canvassParty: string | null;
  readonly canvassSourceUrl: string | null;
  readonly filingParty: string | null;
  readonly filingSourceUrl: string | null;
  /** The committed reader sentence for the unresolved row. */
  readonly readerGapSentence: string | null;
}

export function partyConflictFilingForCard(cardKey: string): PartyConflictFiling | null {
  const row = lineupRowForCard(cardKey);
  if (!row || row.outcome !== "PARTY_CONFLICT" || row.sourceValues.registryCandidateIds.length !== 1) return null;
  const identity = azIdentityRegistry()?.candidates.find((candidate) => candidate.identityId === row.sourceValues.registryCandidateIds[0]);
  if (!identity?.canonicalCandidacyId) return null;
  const canvass = azLineupReconciliation()?.sources.find((source) => source.url && /canvass/i.test(source.name));
  return {
    cardKey,
    contestId: row.contestId,
    filingCandidacyId: identity.canonicalCandidacyId,
    name: row.nomineeName,
    canvassParty: row.sourceValues.canvassParty,
    canvassSourceUrl: canvass?.url ?? null,
    filingParty: row.sourceValues.registryParty,
    filingSourceUrl: identity.candidacySourceUrl,
    readerGapSentence: row.readerGapSentence,
  };
}

/** The PARTY_CONFLICT card whose single name match is this filing, or `null`. */
export function partyConflictCardForFiling(candidacyId: string): PartyConflictFiling | null {
  for (const row of azLineupReconciliation()?.rows ?? []) {
    if (row.outcome !== "PARTY_CONFLICT") continue;
    const pair = partyConflictFilingForCard(row.cardKey);
    if (pair?.filingCandidacyId === candidacyId) return pair;
  }
  return null;
}

/** Test seam. Never called by a render path. */
export function resetAzIdentityCache(): void {
  registryCache = undefined;
  bridgeCache = undefined;
  rowIndex = null;
  coveredContests = null;
}
