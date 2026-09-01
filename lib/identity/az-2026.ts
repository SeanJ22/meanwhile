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
 * - `data/identity/az-2026-candidate-registry.json` — the statewide canonical
 *   candidate/contest registry.
 * - `data/identity/az-2026-certified-lineup-reconciliation.json` — the
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
 * so `next.config.ts` names `./data/identity/*.json` for `/ballot`. Untraced,
 * these reads return nothing, every certified nominee falls back to the
 * unreconciled state, and the money vanishes again — a regression that looks
 * exactly like honest missing data, which is why it is called out here.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AzIdentityRegistry,
  LineupReconciliation,
  LineupReconciliationRow,
} from "./types.ts";

export const AZ_REGISTRY_FILE = "az-2026-candidate-registry.json";
export const AZ_LINEUP_BRIDGE_FILE = "az-2026-certified-lineup-reconciliation.json";

function readIdentityFile<T>(file: string): T | null {
  const path = join(process.cwd(), "data", "identity", file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    /* A file that cannot be parsed is a FAILURE of that file. It resolves to
       null, every nominee falls to its honest unreconciled state, and no name
       is ever guessed at to cover for it. */
    return null;
  }
}

let registryCache: AzIdentityRegistry | null | undefined;
let bridgeCache: LineupReconciliation | null | undefined;
let rowIndex: Map<string, LineupReconciliationRow> | null = null;
let coveredContests: Set<string> | null = null;

export function azIdentityRegistry(): AzIdentityRegistry | null {
  if (registryCache === undefined) registryCache = readIdentityFile<AzIdentityRegistry>(AZ_REGISTRY_FILE);
  return registryCache;
}

export function azLineupReconciliation(): LineupReconciliation | null {
  if (bridgeCache === undefined) {
    bridgeCache = readIdentityFile<LineupReconciliation>(AZ_LINEUP_BRIDGE_FILE);
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
  if (!coveredContests) {
    const bridge = azLineupReconciliation();
    coveredContests = new Set((bridge?.rows ?? []).map((r) => r.contestId));
  }
  return coveredContests.has(contestId);
}

/** The precomputed row for one nominee card, or `null` if there is none. */
export function lineupRowForCard(cardKey: string): LineupReconciliationRow | null {
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
  const row = index().get(cardKey);
  if (!row || row.outcome !== "RECONCILED") return null;
  return row.canonicalCandidacyId;
}

/** Test seam. Never called by a render path. */
export function resetAzIdentityCache(): void {
  registryCache = undefined;
  bridgeCache = undefined;
  rowIndex = null;
  coveredContests = null;
}
