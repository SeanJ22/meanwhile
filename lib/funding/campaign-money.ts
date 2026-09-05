/** One reader answer for a candidacy, certified card, or current official. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bridge from "./official-candidacies.json" with { type: "json" };
import { STATEWIDE_EXECUTIVES } from "../officials/statewide-executives.ts";
import { BODY_ROSTERS, rosterMemberReaderDisposition } from "../registry/body-rosters.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { fundingAnswerForTarget, type FundingAnswer } from "./display.ts";
import { stateMoneyForCard, type CardMoney } from "./nominee-money.ts";

export type OfficialFinanceIdentity = "NOT_OFFICIAL" | "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
export interface CampaignMoney {
  requestedTargetKey: string;
  federal: FundingAnswer;
  state: CardMoney;
  officialIdentity: OfficialFinanceIdentity;
}
export type CampaignMoneyApiAnswer = FundingAnswer
  | { kind: "state"; data: CardMoney }
  | { kind: "combined"; federal: Exclude<FundingAnswer, { kind: "none" }>; state: CardMoney }
  | { kind: "identity-unresolved"; statement: string };

type BridgeRow = (typeof bridge.rows)[number];
const byHolder = new Map(bridge.rows.map(row => [row.holder.id, row]));
const byCandidacy = new Map<string, BridgeRow[]>();
for (const row of bridge.rows) if (row.status === "RESOLVED" && row.candidacy) {
  const rows = byCandidacy.get(row.candidacy.candidacyId) ?? [];
  rows.push(row);
  byCandidacy.set(row.candidacy.candidacyId, rows);
}
const emptyState = (): CardMoney => ({ records: [], resolution: "DIRECT_CANDIDACY_KEY", resolvedTargetKey: null });

/** A reusable office/roster slot must never give its successor the predecessor's money. */
export function officialFinanceIdentityMatches(row: BridgeRow, current: { id: string; name: string; officeTitle: string; divisions: string[] } | null): boolean {
  return current !== null && current.id === row.holder.id && current.name === row.holder.name
    && current.officeTitle === row.holder.officeTitle
    && JSON.stringify([...current.divisions].sort()) === JSON.stringify([...row.holder.divisions].sort());
}

function currentHolder(row: BridgeRow) {
  if (row.holder.sourcePath === "lib/officials/statewide-executives.ts") {
    const e = STATEWIDE_EXECUTIVES.find(e => e.holder.id === row.holder.id);
    return e ? { ...e.holder, divisions: [e.stateOcdId] } : null;
  }
  if (row.holder.sourcePath === "lib/registry/body-rosters.ts") {
    for (const r of BODY_ROSTERS) {
      const h = r.members.find(h => h.id === row.holder.id);
      if (h) return { ...h, divisions: [r.bodyId.split("#")[0]] };
    }
    return null;
  }
  if (row.holder.sourcePath === "lib/registry/officeholders-us.json") {
    const set = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "officeholders-us.json"), "utf8")) as OfficeholderSet;
    const h = set.officeholders.find(h => h.id === row.holder.id);
    return h ? { ...h, divisions: set.divisions.filter(d => d.officeholderId === h.id).map(d => d.ocdId) } : null;
  }
  const match = /^data\/states\/([a-z]{2})\/officials\/(officeholders-\d{2}\.json)$/.exec(row.holder.sourcePath);
  if (!match) return null;
  // Missing canonical input throws to the API's 503; it never becomes absence.
  const set = JSON.parse(readFileSync(join(process.cwd(), "data", "states", match[1], "officials", match[2]), "utf8")) as OfficeholderSet;
  const h = set.officeholders.find(h => h.id === row.holder.id);
  return h ? { ...h, divisions: set.divisions.filter(d => d.officeholderId === h.id).map(d => d.ocdId) } : null;
}

/** The committed person relationship, checked against the current holder slot. */
export function resolvedCandidacyForOfficial(officialId: string): { candidacyId: string; contestId: string } | null {
  const roster = rosterMemberReaderDisposition(officialId);
  if (roster?.state === "IDENTITY_UNRESOLVED") return null;
  if (roster?.state === "EXACT_DUPLICATE") return resolvedCandidacyForOfficial(roster.canonicalId!);
  const row = byHolder.get(officialId);
  return row?.status === "RESOLVED" && row.candidacy && officialFinanceIdentityMatches(row, currentHolder(row))
    ? { candidacyId: row.candidacy.candidacyId, contestId: row.candidacy.contestId } : null;
}

/** Reverse the same committed relationship for ballot statements, actions and votes. */
export function officialIdsForCandidacy(candidacyId: string): string[] {
  return (byCandidacy.get(candidacyId) ?? []).filter((row) => officialFinanceIdentityMatches(row, currentHolder(row))).map((row) => row.holder.id);
}

/** Current canonical person occupying a stable slot, for other reader holdings. */
export function currentOfficialIdentity(officialId: string) {
  const roster = rosterMemberReaderDisposition(officialId);
  if (roster?.state === "IDENTITY_UNRESOLVED") return null;
  if (roster?.state === "EXACT_DUPLICATE") return currentOfficialIdentity(roster.canonicalId!);
  const row = byHolder.get(officialId);
  if (!row) return null;
  const current = currentHolder(row);
  return officialFinanceIdentityMatches(row, current) ? current : null;
}

export function currentOfficialIdentityStatus(officialId: string): "NOT_OFFICIAL" | "IDENTITY_UNRESOLVED" | "RESOLVED" {
  const roster = rosterMemberReaderDisposition(officialId);
  if (roster?.state === "IDENTITY_UNRESOLVED") return "IDENTITY_UNRESOLVED";
  if (roster?.state === "EXACT_DUPLICATE") return currentOfficialIdentityStatus(roster.canonicalId!);
  if (!byHolder.has(officialId)) return "NOT_OFFICIAL";
  return currentOfficialIdentity(officialId) ? "RESOLVED" : "IDENTITY_UNRESOLVED";
}

export function candidacyOfficialIdentityStatus(candidacyId: string): "NO_APPLICABLE_OFFICIAL" | "IDENTITY_UNRESOLVED" | "RESOLVED" {
  const rows = byCandidacy.get(candidacyId) ?? [];
  if (!rows.length) return "NO_APPLICABLE_OFFICIAL";
  return rows.every(row => officialFinanceIdentityMatches(row, currentHolder(row))) ? "RESOLVED" : "IDENTITY_UNRESOLVED";
}

export function campaignMoneyForTarget(targetKey: string, contestId?: string): CampaignMoney {
  const roster = rosterMemberReaderDisposition(targetKey);
  if (roster?.state === "IDENTITY_UNRESOLVED") return {
    requestedTargetKey: targetKey, federal: { kind: "none" }, state: emptyState(), officialIdentity: "IDENTITY_UNRESOLVED",
  };
  if (roster?.state === "EXACT_DUPLICATE") return { ...campaignMoneyForTarget(roster.canonicalId!, contestId), requestedTargetKey: targetKey };
  const official = byHolder.get(targetKey);
  if (official && (!officialFinanceIdentityMatches(official, currentHolder(official)) || official.status === "IDENTITY_UNRESOLVED")) return {
    requestedTargetKey: targetKey, federal: { kind: "none" }, state: emptyState(), officialIdentity: "IDENTITY_UNRESOLVED",
  };
  const federal = fundingAnswerForTarget(targetKey);
  if (official) {
    if (official.status !== "RESOLVED" || !official.candidacy) {
      return { requestedTargetKey: targetKey, federal, state: emptyState(), officialIdentity: "NO_APPLICABLE_CANDIDACY" };
    }
    const state = stateMoneyForCard(official.candidacy.candidacyId, official.candidacy.contestId);
    return { requestedTargetKey: targetKey, federal, state, officialIdentity: "RESOLVED" };
  }
  // The committed certified-lineup bridge resolves legacy display keys. There
  // is no runtime name search and no fallback to another candidate.
  const state = stateMoneyForCard(targetKey, contestId ?? targetKey.split("|")[0]);
  return { requestedTargetKey: targetKey, federal, state, officialIdentity: "NOT_OFFICIAL" };
}

export function campaignMoneyApiAnswer(targetKey: string): CampaignMoneyApiAnswer {
  const answer = campaignMoneyForTarget(targetKey);
  if (answer.state.records.length && answer.federal.kind !== "none") return { kind: "combined", federal: answer.federal, state: answer.state };
  if (answer.state.records.length) return { kind: "state", data: answer.state };
  if (answer.officialIdentity === "IDENTITY_UNRESOLVED") return {
    kind: "identity-unresolved", statement: "We have not established which campaign-finance candidacy belongs to this officeholder.",
  };
  return answer.federal;
}
