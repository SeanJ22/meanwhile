import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ripcordPulled } from "../ripcords.ts";
import type { ContributorGroups } from "./grouping.ts";
import type {
  ContributionRow,
  FundingAbsence,
  FundingCandidate,
  FundingSnapshot,
  SecondHopCommittee,
} from "./types.ts";
import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { requiredRoutineContract, routineFreshnessMs } from "../civic-data/contracts.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

/**
 * Server-side reader over the promoted operational FEC projection, with the
 * committed `data/fec/fec-2026.json` retained as bootstrap LKG. No live FEC
 * call happens at request time, and the FEC API key never reaches runtime code.
 *
 * The contributor accessor is the ripcord's enforcement point: when
 * `ripcord.fecContributorDisplay` is pulled, contributor rows do not leave
 * this module — the pull is a data filter, not a CSS rule.
 */

const FEC_CONTRACT = requiredRoutineContract("fec-funding");
const FEC_SCOPE = FEC_CONTRACT.scope;

let cache: FundingSnapshot | null = null;
let readState: CivicDataReadResult<FundingSnapshot> = civicDataReadNotInitialized(
  "FEC_FUNDING",
  FEC_SCOPE,
  "The FEC canonical pointer has not been read for this process.",
);

function validateFundingSnapshot(payload: FundingSnapshot, versionId: string): void {
  if (payload.formatVersion !== 1 || !Array.isArray(payload.candidates) || !Array.isArray(payload.absences)) {
    throw new Error(`FEC projection ${versionId} does not satisfy FundingSnapshot.`);
  }
}

function fundingBootstrap(): CivicDataBootstrap<FundingSnapshot> {
  const tracked = JSON.parse(
    readFileSync(join(process.cwd(), "data", "fec", "fec-2026.json"), "utf8"),
  ) as FundingSnapshot;
  validateFundingSnapshot(tracked, "bundled bootstrap");
  const heldAbsenceCount = tracked.absences.length;
  const value: FundingSnapshot = {
    ...tracked,
    // The frozen rows cannot prove an absence; never revive them as Reader authority.
    absences: [],
  };
  const sourceThrough = value.candidates
    .map((candidate) => candidate.totals.coverageEndDate ?? "")
    .sort()
    .at(-1) || String(value.cycle);
  return {
    value,
    sourceId: FEC_CONTRACT.sourceId,
    version: String(value.cycle),
    versionId: `bootstrap:fec:${value.fetchedAt}`,
    sourceThrough,
    retrievedAt: value.fetchedAt,
    staleAtRetrieval: false,
    detail:
      `Bundled FEC bootstrap selected only because the canonical store answered with no promoted pointer; ` +
      `${heldAbsenceCount} frozen absence rows are withheld because this projection does not claim their authority.`,
  };
}

/** Typed FEC read outcome; a store failure never opens the bootstrap file. */
export async function readFundingSnapshot(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FundingSnapshot>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedOrBootstrap({
    ...options,
    now,
    recordClass: "FEC_FUNDING",
    scope: FEC_SCOPE,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(FEC_CONTRACT.id, now),
    bootstrap: fundingBootstrap,
    allowUnconfiguredBootstrap: process.env.NODE_ENV !== "production",
  });
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateFundingSnapshot(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

/** Compatibility return for existing request preloads and live acceptance. */
export async function refreshFundingFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readFundingSnapshot(options));
}

/** The FEC read, edge first: the reader edge's proven copy through this Reader, else the database. */
export const settleFundingSnapshotRead = (): Promise<CivicDataReadResult<FundingSnapshot>> =>
  readPromotedEdgeFirst("FEC_FUNDING", FEC_SCOPE, readFundingSnapshot, "The FEC funding");
/** The FEC preload, edge first. */
export const settleFundingRead = async (): Promise<string | null> => promotedVersionOrThrow(await settleFundingSnapshotRead());

export function fundingReadState(): CivicDataReadResult<FundingSnapshot> {
  return readState;
}

export function getFundingSnapshot(): FundingSnapshot {
  if (cache === null) {
    throw new Error(
      `FEC funding is ${readState.kind}; call refreshFundingFromPromoted before using the synchronous projection.`,
    );
  }
  return cache;
}

/** The committee-level record answering for an app-side target id, if any. */
export function fundingForTarget(targetKey: string): FundingCandidate | null {
  return (
    getFundingSnapshot().candidates.find((c) =>
      c.targetKeys.includes(targetKey),
    ) ?? null
  );
}

/** The earned absence for a target — a search that ran and came back empty. */
export function fundingAbsenceForTarget(targetKey: string): FundingAbsence | null {
  return (
    getFundingSnapshot().absences.find((a) => a.targetKey === targetKey) ?? null
  );
}

/**
 * Contributor rows for display — empty while the display ripcord is pulled.
 * This is the only exported path to FEC_CONTRIBUTOR data.
 */
export function contributorRowsForDisplay(
  candidate: FundingCandidate,
): ContributionRow[] {
  if (ripcordPulled("ripcord.fecContributorDisplay")) return [];
  return candidate.topContributions;
}

/**
 * The contributing committees' own books, keyed by committee id. Emptied by
 * `ripcord.fecContributorDisplay` here, at the accessor. Only ids actually
 * fetched are returned, so an unfetched committee renders no expander.
 */
export function secondHopForGroups(
  groups: ContributorGroups,
): Record<string, SecondHopCommittee> {
  if (ripcordPulled("ripcord.fecContributorDisplay")) return {};
  const wanted = new Set(
    groups.organizations
      .map((g) => g.contributorCommitteeId)
      .filter((id): id is string => id !== null),
  );
  if (wanted.size === 0) return {};
  const out: Record<string, SecondHopCommittee> = {};
  for (const committee of getFundingSnapshot().secondHop ?? []) {
    if (!wanted.has(committee.committeeId)) continue;
    // A committee whose own hop came back empty is stored (so the run is
    // recorded) but never rendered as an expander with nothing in it.
    if (committee.topContributions.length === 0) continue;
    out[committee.committeeId] = committee;
  }
  return out;
}

/**
 * The FUNDING_TOTAL_REACTION target universe: every FEC candidate id in the
 * snapshot. The write path checks against this the way vote reactions check
 * the votes snapshot — fail closed on anything else.
 */
export function getFundingTargetIds(): Set<string> {
  const ids = new Set(getFundingSnapshot().candidates.map((c) => c.fecCandidateId));
  if (ids.size === 0) {
    throw new Error("funding target set is empty — refusing to validate against nothing");
  }
  return ids;
}

/**
 * The CONTRIBUTOR_REACTION target universe: only candidates whose
 * contributor display can actually render — has rows AND the display
 * ripcord is live. A pulled ripcord empties this set, so the control's
 * write path dies with its display.
 */
export function getContributorReactionTargetIds(): Set<string> {
  if (ripcordPulled("ripcord.fecContributorDisplay")) return new Set();
  return new Set(
    getFundingSnapshot()
      .candidates.filter((c) => c.topContributions.length > 0)
      .map((c) => c.fecCandidateId),
  );
}
