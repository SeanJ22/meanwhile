import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ripcordPulled } from "../ripcords.ts";
import type {
  ContributionRow,
  FundingAbsence,
  FundingCandidate,
  FundingSnapshot,
} from "./types.ts";

/**
 * Server-side reader over the committed FEC snapshot (`data/fec/fec-2026.json`,
 * written by `pnpm fec:fetch`). No live FEC call happens at request time,
 * and the FEC API key never reaches runtime code — it exists only in the
 * fetch script's environment (guard-tested in tests/funding.test.ts).
 *
 * The contributor accessor is the ripcord's enforcement point: when
 * `ripcord.fecContributorDisplay` is pulled, contributor rows do not leave
 * this module — the pull is a data filter, not a CSS rule.
 */

let cache: FundingSnapshot | null = null;

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
