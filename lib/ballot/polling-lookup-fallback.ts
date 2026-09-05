import { POLLING_PLACE_LINKS, type PollingPlaceLink } from "./polling-place-links.ts";
import type { VotingSitesAnswer } from "./voting-sites.ts";

/** Official tools are offered only when the in-app answer cannot settle the question. */
export function pollingLookupFallbacks(status: "idle" | "asking" | "failed" | "answered", answer?: VotingSitesAnswer): PollingPlaceLink[] {
  if (status === "idle" || status === "asking") return [];
  // No resolved jurisdiction means no state can safely be chosen. Name each
  // held authority instead of assigning the reader a state from their old ZIP.
  if (status === "failed" || !answer?.match || answer.outsideCoverage) return [...POLLING_PLACE_LINKS];
  const unresolvedStates = new Set(answer.jurisdictions.filter((jurisdiction) =>
    jurisdiction.refusal || !jurisdiction.sites.length || jurisdiction.narrowing.kind === "REFUSED",
  ).map((jurisdiction) => jurisdiction.state));
  return POLLING_PLACE_LINKS.filter((link) => unresolvedStates.has(link.state));
}
