import { ripcordPulled } from "../ripcords.ts";
import type { ContributorGroups } from "./grouping.ts";
import type { ContributionRow, FundingAbsence, FundingCandidate, FundingSnapshot, SecondHopCommittee } from "./types.ts";
import { civicDataReadNotInitialized, promotedVersionOrThrow, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderSelection, type ReaderSelection } from "../db/reader-route.ts";
import { routineFreshnessMs } from "../civic-data/contracts.ts";
import { fecFundingContractId, fecStateOfTarget } from "../civic-data/fec-state-scope.ts";
import { requireRegistryState, registryJurisdictions } from "../civic-data/state-scopes.ts";
import { readFecStateSnapshot } from "./fec-state-read.ts";

export interface FundingReadOptions extends PromotedCivicDataReadOptions { readonly state?: string; readonly targetKeys?: readonly string[]; readonly districts?: readonly string[] }
interface Holding { read: CivicDataReadResult<FundingSnapshot>; snapshot: FundingSnapshot | null }
const holdings = new WeakMap<ReaderSelection, Holding>();
const emptyHolding: Holding = { snapshot: null, read: civicDataReadNotInitialized("FEC_FUNDING", "FEC_STATE_REQUIRED", "The selected state's FEC pointer has not been read.") };
let outsideRequest: Holding = emptyHolding;
function current(): Holding { return currentReaderSelection() ? holdings.get(currentReaderSelection()!) ?? emptyHolding : outsideRequest; }
function selectedState(explicit?: string): string {
  if (explicit) return requireRegistryState(explicit);
  const selection = currentReaderSelection();
  const nativeStates = [...new Set([...selection?.keys ?? []].flatMap(key => fecStateOfTarget(key) ?? []))];
  if (nativeStates.length === 1) return requireRegistryState(nativeStates[0]);
  const states = [...new Set([...(selection?.states ?? []), ...(selection?.divisions ?? []).flatMap(registryJurisdictions),
    ...[...selection?.keys ?? []].flatMap(key => fecStateOfTarget(key) ?? [])])];
  if (states.length !== 1) throw new Error("FEC_STATE_REQUIRED");
  return requireRegistryState(states[0]);
}
export async function readFundingSnapshot(options: FundingReadOptions = {}): Promise<CivicDataReadResult<FundingSnapshot>> {
  const state = selectedState(options.state), now = options.now ?? new Date().toISOString(), selectionKeys = [...currentReaderSelection()?.keys ?? []];
  const targetKeys = options.targetKeys ?? selectionKeys.filter(key => /^(?:fec:[HS]\d[A-Z]{2}\d{5}|congress:[A-Z]\d{6}|ballot-)/.test(key));
  const districts = options.districts ?? [...new Set(selectionKeys.flatMap(key => /\/cd:(\d+)(?:\/|$)/.exec(key)?.[1]?.padStart(2, "0") ?? []))];
  const read = await readFecStateSnapshot(state, { ...options, now, maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(fecFundingContractId(state), now),
    ...(targetKeys.length ? { targetKeys } : districts.length ? { districts } : {}) });
  const holding = { read, snapshot: read.kind === "PROMOTED" ? read.value : null };
  if (holding.snapshot?.formatVersion !== undefined && (holding.snapshot.formatVersion !== 1 || !Array.isArray(holding.snapshot.candidates) || !Array.isArray(holding.snapshot.absences))) throw new Error("FEC_SNAPSHOT_INVALID");
  const selection = currentReaderSelection(); if (selection) holdings.set(selection, holding); else outsideRequest = holding;
  return read;
}
export async function refreshFundingFromPromoted(options: FundingReadOptions = {}): Promise<string | null> {
  return promotedVersionOrThrow(await readFundingSnapshot(options));
}
export const settleFundingSnapshotRead = (state?: string): Promise<CivicDataReadResult<FundingSnapshot>> => readFundingSnapshot({ state });
export const settleFundingRead = async (state?: string): Promise<string | null> => promotedVersionOrThrow(await settleFundingSnapshotRead(state));
export function fundingReadState(): CivicDataReadResult<FundingSnapshot> { return current().read; }
export function getFundingSnapshot(): FundingSnapshot {
  const held = current(); if (!held.snapshot) throw new Error(`FEC funding is ${held.read.kind}; read the selected state before using its projection.`);
  return held.snapshot;
}

/** The committee-level record answering for an app-side target id, if any. */
export function fundingForTarget(targetKey: string): FundingCandidate | null {
  return (
    getFundingSnapshot().candidates.filter((c) => c.targetKeys.includes(targetKey) || targetKey === `fec:${c.fecCandidateId}`)
      .sort((a, b) => b.cycle - a.cycle || (b.totals.coverageEndDate ?? "").localeCompare(a.totals.coverageEndDate ?? ""))[0] ?? null
  );
}

/** Native FEC aliases are optional when the money holding was not loaded. */
export function fecPersonKeys(targetKey: string): string[] {
  const rows = current().snapshot?.candidates.filter(candidate => candidate.targetKeys.includes(targetKey) || targetKey === `fec:${candidate.fecCandidateId}`) ?? [];
  return [...new Set(rows.flatMap(row => [`fec:${row.fecCandidateId}`, ...row.targetKeys]))];
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
  return publicOrganizationContributions(candidate.topContributions);
}

/** Whitelist before serialization: source rows remain private evidence. */
export function publicOrganizationContributions(rows: readonly ContributionRow[]): ContributionRow[] {
  return rows.filter(row => row.kind === "COMMITTEE_OR_ORGANIZATION" &&
    ["CCM", "COM", "ORG", "PAC", "PTY"].includes(row.entityType ?? "")).map(row => ({
    dataClass: "FEC_CONTRIBUTOR", kind: "COMMITTEE_OR_ORGANIZATION",
    contributorName: row.contributorName, amount: row.amount, receiptDate: row.receiptDate,
    city: null, state: row.state, entityType: row.entityType, lineNumber: row.lineNumber,
    committeeType: row.committeeType, organizationType: row.organizationType, designation: row.designation,
    contributorCommitteeId: row.contributorCommitteeId,
    ...(row.sourceObservedAt ? { sourceObservedAt: row.sourceObservedAt } : {}),
  }));
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
    const topContributions = publicOrganizationContributions(committee.topContributions);
    if (topContributions.length === 0) continue;
    out[committee.committeeId] = {
      dataClass: "FEC_CONTRIBUTOR", committeeId: committee.committeeId, cycle: committee.cycle ?? getFundingSnapshot().cycle, name: committee.name,
      committeeType: committee.committeeType, organizationType: committee.organizationType,
      designation: committee.designation, receipts: committee.receipts, topContributions,
      provenance: { sourceUrl: committee.provenance.sourceUrl, sourceOrg: committee.provenance.sourceOrg,
        collectedAt: committee.provenance.collectedAt, verifiedAt: committee.provenance.verifiedAt },
    };
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
      .candidates.filter((c) => publicOrganizationContributions(c.topContributions).length > 0)
      .map((c) => c.fecCandidateId),
  );
}
