import { currentStatewideExecutives } from "../officials/statewide-executives.ts";
import { currentBodyRosters, currentRosterMemberReaderDisposition } from "../registry/body-rosters.ts";
import { fundingAnswerForTarget, type FundingAnswer } from "./display.ts";
import type { CivicDataReadMetadata } from "../civic-data/read-model.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { getRegistryRuntimeReadModel, selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { officialCandidacySeatMatches, reconcileOfficialCandidacies, type OfficialCandidacyBridgeRow } from "../registry/runtime-data-plane.ts";
import { currentBallotPeopleProjection } from "../ballot/generic-projection.ts";
import type { BallotSet } from "../ballot/types.ts";
import { directFundingTargetPlan } from "./target-authorities.ts";
import { currentStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { statePeopleScopeForDivision } from "../officials/people-identity.ts";
import type { CampaignFinancePlaceRead } from "./state-reader.ts";

export type OfficialFinanceIdentity = "NOT_OFFICIAL" | "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
export interface CampaignMoney {
  requestedTargetKey: string;
  federal: FundingAnswer;
  officialIdentity: OfficialFinanceIdentity;
}
export type CampaignMoneyApiAnswer = FundingAnswer
  | { kind: "identity-unresolved"; statement: string };
export type CampaignMoneyApiResponse = (CampaignMoneyApiAnswer | {kind:"state-cycle";data:CampaignFinancePlaceRead}) & {
  readonly dataState: "PROMOTED" | "BOOTSTRAP" | "PARTIAL";
  readonly dataMetadata: CivicDataReadMetadata | null;
  readonly holdingStatus?: "HELD" | "PARTIAL";
  readonly unavailableAuthorities?: readonly string[];
};

export interface CampaignMoneyReadSelection {
  /** The FEC holding applies to this exact target and was read successfully. */
  readonly federal?: boolean;
  /** The canonical person/candidacy graph was read successfully. */
  readonly identity?: boolean;
}

type BridgeRow = OfficialCandidacyBridgeRow;
let indexedBridge: {
  source: ReturnType<typeof getRegistryRuntimeReadModel>["officialCandidacies"];
  inputs: readonly unknown[];
  byHolder: Map<string, BridgeRow>;
  byCandidacy: Map<string, BridgeRow[]>;
} | null = null;

function bridgeIndex() {
  const source = getRegistryRuntimeReadModel().officialCandidacies;
  const ballots: BallotSet[] = [], inputs: unknown[] = [];
  const rosters: NonNullable<ReturnType<typeof currentStatePeopleProjection>>["roster"][] = [];
  for (const state of selectedRegistryStates()) {
    try {
      const ballot = currentBallotPeopleProjection(state);
      inputs.push(ballot); ballots.push(...Object.values(ballot.ballots));
    } catch { /* A person page can read before this state's ballot is held. */ }
    const roster = currentStatePeopleProjection(`US-${state}`)?.roster;
    inputs.push(roster);
    if (roster) rosters.push(roster);
  }
  let federal: ReturnType<typeof getFederalOfficeholderSet> | null = null;
  try { federal = getFederalOfficeholderSet(); } catch { /* Independent state ballots retain their held state links. */ }
  inputs.push(federal);
  if (indexedBridge?.source === source && inputs.length === indexedBridge.inputs.length &&
      inputs.every((value, index) => indexedBridge!.inputs[index] === value)) return indexedBridge;
  const holders: BridgeRow["holder"][] = [];
  for (const roster of [...rosters, ...federal ? [federal] : []]) {
    const divisions = new Map<string, string[]>();
    for (const row of roster.divisions) divisions.set(row.officeholderId, [...divisions.get(row.officeholderId) ?? [], row.ocdId]);
    for (const holder of roster.officeholders) holders.push({ id: holder.id, name: holder.name,
      personId: holder.personId, nativeIds: holder.nativeIds,
      officialProfileUrl: holder.websiteUrl,
      officeTitle: holder.officeTitle, divisions: divisions.get(holder.id) ?? [],
      authority: roster === federal ? "FEDERAL_DIRECTORY" : "STATE_PEOPLE", sourceUrl: holder.provenance.sourceUrl });
  }
  const resolved = ballots.length ? reconcileOfficialCandidacies({ bridge: source, ballots, holders }) : source;
  const byHolder = new Map(resolved.rows.map(row => [row.holder.id, row]));
  const byCandidacy = new Map<string, BridgeRow[]>();
  for (const row of resolved.rows) if (officialCandidacySeatMatches(row) && row.candidacy) {
    for (const id of new Set([row.candidacy.candidacyId, ...row.candidacy.aliases ?? []])) {
      const rows = byCandidacy.get(id) ?? [];
      rows.push(row); byCandidacy.set(id, rows);
    }
  }
  indexedBridge = { source, inputs, byHolder, byCandidacy };
  return indexedBridge;
}
/** A reusable office/roster slot must never give its successor the predecessor's money. */
export function officialFinanceIdentityMatches(row: BridgeRow, current: { id: string; name: string; officeTitle: string; divisions: readonly string[] } | null): boolean {
  return current !== null && current.id === row.holder.id && current.name === row.holder.name
    && current.officeTitle === row.holder.officeTitle
    && JSON.stringify([...new Set(current.divisions)].sort()) === JSON.stringify([...new Set(row.holder.divisions)].sort());
}

function currentHolder(row: BridgeRow) {
  if (row.holder.authority === "STATE_PEOPLE") {
    const scope = row.holder.divisions.map(statePeopleScopeForDivision).find(scope => scope !== null);
    const set = scope ? currentStatePeopleProjection(scope)?.roster : null;
    const holder = set?.officeholders.find(holder => holder.id === row.holder.id);
    return holder && set ? { ...holder, divisions: set.divisions.filter(division => division.officeholderId === holder.id).map(division => division.ocdId) } : null;
  }
  if (row.holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE") {
    const e = currentStatewideExecutives().find(e => e.holder.id === row.holder.id);
    return e ? { ...e.holder, divisions: [e.stateOcdId] } : null;
  }
  if (row.holder.authority === "REGISTRY_BODY_ROSTER") {
    for (const r of currentBodyRosters()) {
      const h = r.members.find(h => h.id === row.holder.id);
      if (h) return { ...h, divisions: [r.bodyId.split("#")[0]] };
    }
    return null;
  }
  if (row.holder.authority === "FEDERAL_DIRECTORY") {
    const set = getFederalOfficeholderSet();
    const h = set.officeholders.find(h => h.id === row.holder.id);
    return h ? { ...h, divisions: set.divisions.filter(d => d.officeholderId === h.id).map(d => d.ocdId) } : null;
  }
  return null;
}

/** The committed person relationship, checked against the current holder slot. */
export function resolvedCandidacyForOfficial(officialId: string): { candidacyId: string; contestId: string } | null {
  const roster = currentRosterMemberReaderDisposition(officialId);
  if (roster?.state === "IDENTITY_UNRESOLVED") return null;
  if (roster?.state === "EXACT_DUPLICATE") return resolvedCandidacyForOfficial(roster.canonicalId!);
  const row = bridgeIndex().byHolder.get(officialId);
  return row && officialCandidacySeatMatches(row) && row.candidacy && officialFinanceIdentityMatches(row, currentHolder(row))
    ? { candidacyId: row.candidacy.candidacyId, contestId: row.candidacy.contestId } : null;
}

/** Reverse the same committed relationship for ballot statements, actions and votes. */
export function officialIdsForCandidacy(candidacyId: string): string[] {
  return (bridgeIndex().byCandidacy.get(candidacyId) ?? []).filter((row) => officialFinanceIdentityMatches(row, currentHolder(row))).map((row) => row.holder.id);
}

/** Current canonical person occupying a stable slot, for other reader holdings. */
export function currentOfficialIdentity(officialId: string) {
  const roster = currentRosterMemberReaderDisposition(officialId);
  if (roster?.state === "IDENTITY_UNRESOLVED") return null;
  if (roster?.state === "EXACT_DUPLICATE") return currentOfficialIdentity(roster.canonicalId!);
  const row = bridgeIndex().byHolder.get(officialId);
  if (!row) return null;
  const current = currentHolder(row);
  return officialFinanceIdentityMatches(row, current) ? current : null;
}

export function currentOfficialIdentityStatus(officialId: string): "NOT_OFFICIAL" | "IDENTITY_UNRESOLVED" | "RESOLVED" {
  const roster = currentRosterMemberReaderDisposition(officialId);
  if (roster?.state === "IDENTITY_UNRESOLVED") return "IDENTITY_UNRESOLVED";
  if (roster?.state === "EXACT_DUPLICATE") return currentOfficialIdentityStatus(roster.canonicalId!);
  if (!bridgeIndex().byHolder.has(officialId)) return "NOT_OFFICIAL";
  return currentOfficialIdentity(officialId) ? "RESOLVED" : "IDENTITY_UNRESOLVED";
}

export function candidacyOfficialIdentityStatus(candidacyId: string): "NO_APPLICABLE_OFFICIAL" | "IDENTITY_UNRESOLVED" | "RESOLVED" {
  const rows = bridgeIndex().byCandidacy.get(candidacyId) ?? [];
  if (!rows.length) return "NO_APPLICABLE_OFFICIAL";
  return rows.every(row => officialFinanceIdentityMatches(row, currentHolder(row))) ? "RESOLVED" : "IDENTITY_UNRESOLVED";
}

export function campaignMoneyForTarget(
  targetKey: string,
  contestId?: string,
  selection: CampaignMoneyReadSelection = {},
): CampaignMoney {
  const direct = directFundingTargetPlan(targetKey);
  // Source-namespaced candidacies identify their finance authority directly.
  // Reusable officeholder slots require the current person/candidacy bridge.
  const readIdentity = (selection.identity ?? true) &&
    (targetKey.startsWith("congress:") || !(direct.federal || direct.state !== null) || targetKey.includes("|"));
  const roster = readIdentity ? currentRosterMemberReaderDisposition(targetKey) : null;
  if (roster?.state === "IDENTITY_UNRESOLVED") return {
    requestedTargetKey: targetKey, federal: { kind: "none" }, officialIdentity: "IDENTITY_UNRESOLVED",
  };
  if (roster?.state === "EXACT_DUPLICATE") return { ...campaignMoneyForTarget(roster.canonicalId!, contestId), requestedTargetKey: targetKey };
  const official = readIdentity ? bridgeIndex().byHolder.get(targetKey) : undefined;
  if (official && (!officialFinanceIdentityMatches(official, currentHolder(official)) || official.status === "IDENTITY_UNRESOLVED" || official.status === "NOT_CHECKED")) return {
    requestedTargetKey: targetKey, federal: { kind: "none" }, officialIdentity: "IDENTITY_UNRESOLVED",
  };
  const candidacy = official && officialCandidacySeatMatches(official) ? official.candidacy : null;
  const plan = candidacy ? directFundingTargetPlan(candidacy.candidacyId) : direct;
  const readFederal = selection.federal ?? (official
    ? official.holder.authority === "FEDERAL_DIRECTORY" || plan.federal
    : direct.contestId === null || direct.federal);
  const federal = readFederal ? fundingAnswerForTarget(targetKey) : { kind: "none" } as const;
  if (official) {
    if (!candidacy) {
      return { requestedTargetKey: targetKey, federal, officialIdentity: "NO_APPLICABLE_CANDIDACY" };
    }
    return { requestedTargetKey: targetKey, federal, officialIdentity: "RESOLVED" };
  }
  return { requestedTargetKey: targetKey, federal, officialIdentity: "NOT_OFFICIAL" };
}

export function campaignMoneyApiAnswer(
  targetKey: string,
  contestId?: string,
  selection: CampaignMoneyReadSelection = {},
): CampaignMoneyApiAnswer {
  const answer = campaignMoneyForTarget(targetKey, contestId, selection);
  if (answer.officialIdentity === "IDENTITY_UNRESOLVED") return {
    kind: "identity-unresolved", statement: "We have not established which campaign-finance candidacy belongs to this officeholder.",
  };
  return answer.federal;
}
