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
import { promotedReadModel } from "../civic-data/read-model.ts";

/**
 * Server-side reader over the promoted operational FEC projection, with the
 * committed `data/fec/fec-2026.json` retained as bootstrap LKG. No live FEC
 * call happens at request time, and the FEC API key never reaches runtime code.
 *
 * The contributor accessor is the ripcord's enforcement point: when
 * `ripcord.fecContributorDisplay` is pulled, contributor rows do not leave
 * this module — the pull is a data filter, not a CSS rule.
 */

let cache: FundingSnapshot | null = null;

/** Load the promoted operational projection, retaining the bundled bootstrap LKG when absent. */
export async function refreshFundingFromPromoted(): Promise<string | null> {
  const promoted = await promotedReadModel<FundingSnapshot>("FEC_FUNDING", "federal-supported");
  if (!promoted) return null;
  const payload = promoted.payload;
  if (payload.formatVersion !== 1 || !Array.isArray(payload.candidates) || !Array.isArray(payload.absences)) {
    throw new Error(`Promoted FEC projection ${promoted.versionId} does not satisfy FundingSnapshot.`);
  }
  cache = payload;
  return promoted.versionId;
}

export function getFundingSnapshot(): FundingSnapshot {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(join(process.cwd(), "data", "fec", "fec-2026.json"), "utf8"),
    ) as FundingSnapshot;
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
 * The second hop for a set of grouped contributor rows (item 3) — the
 * contributing committees' own books, keyed by committee id.
 *
 * Same ripcord as the first hop: these are FEC_CONTRIBUTOR rows, and
 * `ripcord.fecContributorDisplay` empties them HERE, at the accessor, not
 * in a component. Only ids the hop actually holds are returned, so a
 * committee we never fetched renders no expander rather than an empty one —
 * "we haven't looked one level down for this committee" and "this committee
 * has no donors" are different claims and must not render the same.
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
