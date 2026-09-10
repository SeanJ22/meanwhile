import type { CoverageStatus } from "./types.ts";

interface StateLegislatorCoverageAuthorityView {
  readonly scope: string;
  readonly kind: string;
}

/** Calendar states whose source is already usable by reader surfaces. */
export const WIRED_STATUSES: ReadonlySet<CoverageStatus> = new Set<CoverageStatus>([
  "LIVE",
  "MANUAL",
]);

/** Reader wording over authority bytes already projected by the server. */
export function stateLegislatorCoverageGapText(
  authority: StateLegislatorCoverageAuthorityView,
): string | null {
  if (authority.kind === "NOT_RECORDED") {
    return `The canonical state-legislator store answered for ${authority.scope}, but no promoted roster is recorded yet.`;
  }
  if (authority.kind === "STORE_UNREACHABLE") {
    return `We couldn't verify the canonical state-legislator roster for ${authority.scope} at the last check, so representative names may be missing.`;
  }
  return null;
}
