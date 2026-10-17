import { jurisdictionFromOcdId, US_JURISDICTIONS } from "../coverage/states.ts";

export function campaignFinanceStateScope(ocdId: string): string {
  const state = jurisdictionFromOcdId(ocdId);
  if (!state) throw new Error("Campaign finance requires one exact state or local jurisdiction.");
  return campaignFinanceScopeForState(state.usps);
}

export function campaignFinanceScopeForState(state: string): string {
  if (!US_JURISDICTIONS.some(row => row.usps === state)) throw new Error("Campaign finance requires a supported state or territory.");
  return `US-${state}:campaign-finance`;
}

export function campaignFinanceStateFromScope(scope: string): string | null {
  const state = /^US-([A-Z]{2}):campaign-finance$/.exec(scope)?.[1];
  return US_JURISDICTIONS.some(row => row.usps === state) ? state! : null;
}

export function isCampaignFinanceStateScope(scope: string): boolean {
  return campaignFinanceStateFromScope(scope) !== null;
}
