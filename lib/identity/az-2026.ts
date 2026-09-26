/**
 * **READING THE ARIZONA 2026 IDENTITY LAYER.**
 * (Session C3, 2026-09-01. RULING 229.)
 *
 * **This module is hand-written. The two files it READS are the generated
 * ones** — `pnpm identity:az` writes them, and they are never hand-edited
 * (RULING 92). The distinction matters to the register guard as much as to a
 * reader: what is generated is the data, not this loader.
 *
 * The two artifacts:
 *
 * - `data/states/az/identity/az-2026-candidate-registry.json` — the statewide canonical
 *   candidate/contest registry.
 * - `data/states/az/identity/az-2026-certified-lineup-reconciliation.json` — the
 *   PRECOMPUTED bridge from each certified-lineup nominee card to the canonical
 *   candidacy the state campaign-money snapshot is keyed on, plus the population
 *   proof.
 *
 * **Nothing here matches names at run time.** The bridge is a lookup table; the
 * matching happened once, in the generator, over the whole population, and the
 * result is committed so a person can read it. A reader surface that did its own
 * name matching would be exactly the fuzzy join this layer exists to replace.
 *
 * The files are read through `process.cwd()`, which the Next tracer cannot see,
 * so `next.config.ts` traces `./data/states/az/identity/*.json` for `/ballot`. Untraced,
 * these reads return nothing, every certified nominee falls back to the
 * unreconciled state, and the money vanishes again — a regression that looks
 * exactly like honest missing data, which is why it is called out here.
 */

import { currentAzBallotProjection } from "../civic-data/manual-read-models.ts";

import type {
  AzIdentityRegistry,
  LineupReconciliation,
  LineupReconciliationRow,
} from "./types.ts";

export const AZ_REGISTRY_FILE = "az-2026-candidate-registry.json";
export const AZ_LINEUP_BRIDGE_FILE = "az-2026-certified-lineup-reconciliation.json";

let registryCache: AzIdentityRegistry | null | undefined;
let bridgeCache: LineupReconciliation | null | undefined;
let rowIndex: Map<string, LineupReconciliationRow> | null = null;
let coveredContests: Set<string> | null = null;

export function azIdentityRegistry(): AzIdentityRegistry | null {
  if (registryCache === undefined) registryCache = currentAzBallotProjection().identityRegistry;
  return registryCache;
}

export function azLineupReconciliation(): LineupReconciliation | null {
  if (bridgeCache === undefined) {
    bridgeCache = currentAzBallotProjection().lineupReconciliation;
    rowIndex = null;
    coveredContests = null;
  }
  return bridgeCache;
}

function index(): Map<string, LineupReconciliationRow> {
  if (rowIndex) return rowIndex;
  const bridge = azLineupReconciliation();
  rowIndex = new Map((bridge?.rows ?? []).map((r) => [r.cardKey, r]));
  return rowIndex;
}

/**
 * Does the bridge speak for this contest at all?
 *
 * `false` is not "unresolved" — it means this contest's cards are not certified
 * Arizona lineup cards, so nothing here applies to them and the caller's
 * existing behaviour stands unchanged. New Hampshire and New Jersey answer
 * `false` here and must keep working exactly as they did.
 */
export function lineupBridgeCovers(contestId: string): boolean {
  if (!contestId.startsWith("ballot-az-")) return false;
  if (!coveredContests) {
    const bridge = azLineupReconciliation();
    coveredContests = new Set((bridge?.rows ?? []).map((r) => r.contestId));
  }
  return coveredContests.has(contestId);
}

/** The precomputed row for one nominee card, or `null` if there is none. */
export function lineupRowForCard(cardKey: string): LineupReconciliationRow | null {
  if (!cardKey.startsWith("ballot-az-")) return null;
  return index().get(cardKey) ?? null;
}

/**
 * The canonical candidacy id a nominee card resolves to, or `null`.
 *
 * `null` covers every unresolved outcome deliberately: a caller must not be
 * able to tell *which* kind of unresolved it is from this function and act
 * differently, because there is no action that differs. The row itself carries
 * the reason, for the artifact and for the reader's sentence.
 */
export function reconciledCandidacyIdForCard(cardKey: string): string | null {
  const row = lineupRowForCard(cardKey);
  if (!row || row.outcome !== "RECONCILED") return null;
  return row.canonicalCandidacyId;
}

/**
 * **ONE NAME, TWO PARTIES: THE PAIR THE GENERATOR ALREADY FOUND.**
 *
 * A `PARTY_CONFLICT` card is exactly one name match in the card's own contest
 * whose two authorities publish different party labels (Teri Ann Hourihan:
 * the certified canvass says "No Labels", the Secretary of State's filing list
 * says "Arizona Independent Party"). The card still has NO canonical candidacy
 * — `reconciledCandidacyIdForCard` stays `null` and `readerPersonKeys` stays
 * the card alone — because we have not established that the two rows are the
 * same candidacy.
 *
 * What this returns is the committed pair itself, so a reader surface can
 * treat the reader's words ("Teri Ann Hourihan") as naming one subject instead
 * of asking "which one did you mean?" about two rows that exist only because
 * two authorities disagree, and then state BOTH parties with their sources.
 * It never attaches the filing's money or records to the card as its own.
 * `null` unless the row is a PARTY_CONFLICT with exactly one registry
 * identity that names a canonical candidacy.
 */
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
