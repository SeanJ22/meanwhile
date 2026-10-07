import type { PollingPlaceLink } from "./polling-place-links.ts";
import type { VotingSitesAnswer } from "./voting-sites.ts";

export function pollingLookupFallbacks(status: "idle" | "asking" | "failed" | "answered", answer?: VotingSitesAnswer): PollingPlaceLink[] {
  if (status === "idle" || status === "asking") return [];
  const links = answer?.pollingPlaceLinks ?? [];
  if (status === "failed" || !answer?.match || answer.outsideCoverage) return [...links];
  const unresolvedStates = new Set(answer.jurisdictions.filter((jurisdiction) =>
    jurisdiction.refusal || !jurisdiction.sites.length || jurisdiction.narrowing.kind === "REFUSED",
  ).map((jurisdiction) => jurisdiction.state));
  return links.filter((link) => unresolvedStates.has(link.state));
}
