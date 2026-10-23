import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { ballotNavigationScope, ballotNavigationState } from "./ballot-navigation-scope.ts";
import { campaignFinanceStateScope, isCampaignFinanceStateScope } from "../funding/state-sources.ts";
import { federalMemberOfScope, federalMemberVotesScope } from "../votes/data-plane.ts";

const PREFIXES: Readonly<Record<string, string>> = {
  "plain-english-translations": "US:plain-english-translations",
  "special-district-boundaries": "US:special-district-boundaries",
  "public-records": "US:public-records",
  "government-budgets": "US:government-budgets",
};
const jurisdictionIsValid = (id: string, ocdId: string) => Boolean(jurisdictionFromOcdId(ocdId) ||
  !["plain-english-translations", "campaign-finance", "special-district-boundaries"].includes(id) && ocdId === "ocd-division/country:us");

export function scopedManualContractScope(id: string, ocdId: string): string {
  if (id === "campaign-finance") return campaignFinanceStateScope(ocdId);
  if (!PREFIXES[id] || !jurisdictionIsValid(id, ocdId)) throw new Error("Scoped publication requires one US jurisdiction.");
  return `${PREFIXES[id]}:${ocdId}`;
}
export function isScopedManualContractScope(id: string, scope: string): boolean {
  if (id === "ballot-navigation") return ballotNavigationState(scope) !== null;
  if (id === "campaign-finance") return isCampaignFinanceStateScope(scope);
  if (id === "congress-rollcalls") return federalMemberOfScope(scope) !== null;
  const prefix = PREFIXES[id];
  return Boolean(prefix && scope.startsWith(`${prefix}:`) && jurisdictionIsValid(id, scope.slice(prefix.length + 1)));
}
export function manualPayloadScope(id: string, fallback: string, payload: unknown): string {
  if (id === "ballot-navigation") {
    const records = (payload as { records?: readonly { value?: { state?: string } }[] })?.records;
    const state = records?.[0]?.value?.state;
    if (!state || records?.some(row => row.value?.state !== state)) throw new Error("Navigation publication requires one state.");
    return ballotNavigationScope(state);
  }
  if (id === "campaign-finance") {
    const records = (payload as { records?: readonly { ocdId?: string }[] })?.records;
    if (!records?.length) throw new Error("Campaign finance has no state-bound filings.");
    const scope = campaignFinanceStateScope(records[0].ocdId ?? "");
    if (records.some(row => campaignFinanceStateScope(row.ocdId ?? "") !== scope)) throw new Error("Campaign finance crosses its state's boundary.");
    return scope;
  }
  const member = (payload as { officeholderId?: unknown })?.officeholderId;
  if (id === "congress-rollcalls") return typeof member === "string" ? federalMemberVotesScope(member) : fallback;
  if (!PREFIXES[id]) return fallback;
  const records = (payload as { records?: readonly { ocdId?: string }[] })?.records;
  const division = records?.[0]?.ocdId;
  if (!division || records?.some(row => row.ocdId !== division)) throw new Error("Scoped publication contains different jurisdictions.");
  return scopedManualContractScope(id, division);
}
