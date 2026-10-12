import type { CivicDataReadMetadata } from "../civic-data/read-model.ts";

/**
 * The one campaign-finance freshness/disclosure sentence, shared by every
 * surface that renders funding so the map and ballot show identical text.
 * Computed from the funding settlement's availability envelope, never a
 * hardcoded date. Null when the holding is fully HELD, PROMOTED and CURRENT.
 */
export interface FundingFreshnessEnvelope {
  // Optional so the map's CampaignMoneyApiResponse (which types holdingStatus as
  // optional) and the ballot's FundingHoldingSettlement ANSWER variant (which
  // requires it) both satisfy it; absent is treated as "not PARTIAL".
  readonly holdingStatus?: "HELD" | "PARTIAL";
  readonly dataState: "PROMOTED" | "BOOTSTRAP" | "PARTIAL";
  readonly dataMetadata: CivicDataReadMetadata | null;
  readonly unavailableAuthorities?: readonly string[];
}

export function fundingFreshnessNote(envelope: FundingFreshnessEnvelope): string | null {
  if (envelope.holdingStatus === "PARTIAL") {
    return `Some independent campaign-finance holdings are unavailable (${(envelope.unavailableAuthorities ?? []).join(", ")}). The records below remain source-linked; they are not a complete cross-authority answer.`;
  }
  if (envelope.dataState === "BOOTSTRAP") {
    return "Campaign-finance records are using the bundled bootstrap because no canonical production version is recorded.";
  }
  if (envelope.dataMetadata?.stale === "STALE") {
    return `Campaign-finance records are serving the last known good version; its source data is stale${envelope.dataMetadata.sourceThrough ? ` (source through ${envelope.dataMetadata.sourceThrough})` : ""}.`;
  }
  if (envelope.dataMetadata?.stale === "UNKNOWN") {
    return "Campaign-finance record freshness could not be established.";
  }
  return null;
}
