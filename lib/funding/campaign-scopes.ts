import { jurisdictionFromOcdId, US_JURISDICTIONS } from "../coverage/states.ts";

export function campaignFinanceStateScope(ocdId: string): string {
  const state = jurisdictionFromOcdId(ocdId);
  if (!state) throw new Error("Campaign finance requires one exact state or local jurisdiction.");
  return `US-${state.usps}:campaign-finance`;
}

export function isCampaignFinanceStateScope(scope: string): boolean {
  const state = /^US-([A-Z]{2}):campaign-finance$/.exec(scope)?.[1];
  return US_JURISDICTIONS.some(row => row.usps === state);
}
