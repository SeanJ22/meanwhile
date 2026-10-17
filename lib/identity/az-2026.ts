import { currentGenericBallotProjection } from "../ballot/generic-projection.ts";

import type {
  LineupReconciliation,
  LineupReconciliationRow,
} from "./types.ts";

const indexes = new WeakMap<LineupReconciliation, Map<string, LineupReconciliationRow>>();

export function azContestIdentity(contestId: string) {
  for (const ballot of Object.values(currentGenericBallotProjection("AZ").ballots)) {
    const contest = ballot.contests.find(row => row.id === contestId);
    if (contest) return contest.identity ?? null;
  }
  return null;
}

export function azLineupReconciliation(): LineupReconciliation | null {
  return Object.values(currentGenericBallotProjection("AZ").ballots).find(ballot => ballot.lineupReconciliation)?.lineupReconciliation ?? null;
}

function index(): ReadonlyMap<string, LineupReconciliationRow> {
  const bridge = azLineupReconciliation();
  if (!bridge) return new Map();
  let rows = indexes.get(bridge);
  if (!rows) { rows = new Map(bridge.rows.map(row => [row.cardKey, row])); indexes.set(bridge, rows); }
  return rows;
}

export function lineupBridgeCovers(contestId: string): boolean {
  if (!contestId.startsWith("ballot-az-")) return false;
  return [...index().values()].some(row => row.contestId === contestId);
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

function partyConflictFilingForCard(cardKey: string): PartyConflictFiling | null {
  const row = lineupRowForCard(cardKey);
  if (!row || row.outcome !== "PARTY_CONFLICT" || row.sourceValues.registryCandidateIds.length !== 1) return null;
  const candidate = Object.values(currentGenericBallotProjection("AZ").ballots)
    .flatMap(ballot => [...ballot.candidacies, ...(ballot.filingCandidacies ?? [])]).find(candidate => candidate.identity?.identityId === row.sourceValues.registryCandidateIds[0]);
  if (!candidate) return null;
  const canvass = azLineupReconciliation()?.sources.find((source) => source.url && /canvass/i.test(source.name));
  return {
    cardKey,
    contestId: row.contestId,
    filingCandidacyId: candidate.id,
    name: row.nomineeName,
    canvassParty: row.sourceValues.canvassParty,
    canvassSourceUrl: canvass?.url ?? null,
    filingParty: row.sourceValues.registryParty,
    filingSourceUrl: candidate.identity?.candidacySourceUrl ?? candidate.provenance.sourceUrl,
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
