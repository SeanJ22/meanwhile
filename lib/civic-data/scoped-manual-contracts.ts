import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { campaignFinanceStateScope, isCampaignFinanceStateScope } from "../funding/state-sources.ts";
import { federalMemberOfScope, federalMemberVotesScope, federalKeyVoteMemberOfScope, federalKeyVoteMemberScope } from "../votes/data-plane.ts";
import { registryJurisdictions, requireRegistryState } from "./state-scopes.ts";

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
  if (id === "venue-resolutions") return /^US-[A-Z]{2}:venue-resolutions$/.test(scope) && registryJurisdictions(scope).length === 1;
  if (id === "campaign-finance") return isCampaignFinanceStateScope(scope);
  if (id === "congress-rollcalls") return federalMemberOfScope(scope) !== null;
  if (id === "federal-key-votes") return federalKeyVoteMemberOfScope(scope) !== null;
  const prefix = PREFIXES[id];
  return Boolean(prefix && scope.startsWith(`${prefix}:`) && jurisdictionIsValid(id, scope.slice(prefix.length + 1)));
}
export function manualPayloadScope(id: string, fallback: string, payload: unknown): string {
  if (id === "venue-resolutions") {
    const held = payload as { state?: string; records?: readonly { bodyOcdId?: string | null }[] };
    const states = [...new Set(held.records?.flatMap(row => registryJurisdictions(row.bodyOcdId)) ?? [])];
    const state = held.state ? requireRegistryState(held.state) : states.length === 1 ? states[0] : null;
    if (!state || states.some(other => other !== state) || held.records?.some(row => !row.bodyOcdId && !held.state))
      throw new Error("Venue publication requires one explicit state and its exact body bindings.");
    return `US-${state}:venue-resolutions`;
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
  if (id === "federal-key-votes") return typeof member === "string" ? federalKeyVoteMemberScope(member) : fallback;
  if (!PREFIXES[id]) return fallback;
  const records = (payload as { records?: readonly { ocdId?: string }[] })?.records;
  const division = records?.[0]?.ocdId;
  if (!division || records?.some(row => row.ocdId !== division)) throw new Error("Scoped publication contains different jurisdictions.");
  return scopedManualContractScope(id, division);
}
