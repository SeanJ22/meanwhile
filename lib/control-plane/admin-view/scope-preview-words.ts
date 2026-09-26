import type { CoverageStatus } from "./coverage.ts";

export function scopeRouteDescription(status: CoverageStatus): string {
  if (status === "NOT_ATTEMPTED") return "No walk recorded in this registry";
  if (status === "LIVE" || status === "MANUAL") return "A source route is registered";
  if (status === "KNOWN_UNCOVERED" || status === "NO_SOURCE_FOUND") return "Looked; no source route registered";
  return "Source-route status unclassified";
}
