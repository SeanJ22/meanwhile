import type { CoverageStatus } from "./types.ts";

/** Calendar states whose source is already usable by reader surfaces. */
export const WIRED_STATUSES: ReadonlySet<CoverageStatus> = new Set<CoverageStatus>([
  "LIVE",
  "MANUAL",
]);
