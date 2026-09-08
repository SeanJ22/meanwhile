/**
 * Reader-only visual review fixtures. These values are deliberately inert
 * unless a caller opts into local review mode; production callers get null.
 */
export type DesktopVotePlacementVariant =
  | "A_STANDALONE"
  | "B_CLUSTER_SEGMENT"
  | "C_CLUSTER_ROW";

const DESKTOP_VOTE_PLACEMENTS = new Set<DesktopVotePlacementVariant>([
  "A_STANDALONE",
  "B_CLUSTER_SEGMENT",
  "C_CLUSTER_ROW",
]);

export function desktopVotePlacementVariantFrom(
  value: string | null | undefined,
): DesktopVotePlacementVariant | null {
  return value && DESKTOP_VOTE_PLACEMENTS.has(value as DesktopVotePlacementVariant)
    ? (value as DesktopVotePlacementVariant)
    : null;
}

export function desktopVotePlacementVariantFromSearch(
  search: string,
  reviewMode = false,
): DesktopVotePlacementVariant | null {
  if (!reviewMode) return null;
  return desktopVotePlacementVariantFrom(
    new URLSearchParams(search).get("desktopVote"),
  );
}
