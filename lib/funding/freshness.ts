import type { CivicDataReadMetadata } from "../civic-data/read-model.ts";

/**
 * The one campaign-finance freshness/disclosure sentence, shared by every
 * surface that renders funding (the map official popup and the ballot
 * battlecard). Both surfaces MUST show the identical note for the same
 * holding — the render proof (`reader-last-mile-render.mts`, federal-money
 * focus) asserts the map and ballot funding sections render the same text —
 * so the wording lives here once rather than being re-authored per surface
 * and drifting. It is computed from the availability envelope the funding
 * settlement produces (`holdingStatus`/`dataState`/`dataMetadata`/
 * `unavailableAuthorities`), never from a hardcoded date: the actual
 * source-through value is read off `dataMetadata.sourceThrough`.
 *
 * Returns null when the holding is fully HELD, PROMOTED, and CURRENT — there
 * is nothing to disclose, and a note in that case would be noise. A missing,
 * incorrect, or misleading note is therefore detectable: the proof compares
 * the rendered text on both surfaces against this single source of truth.
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
