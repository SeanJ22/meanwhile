/**
 * Reader-review-only layouts for an exactly three-candidate contest.
 *
 * The short query values make the owner-review URLs easy to compare, while
 * the returned names record what each candidate-neutral composition does.
 * There is intentionally no fallback variant: missing or invalid input keeps
 * the production ballot grid unchanged.
 */
export type ThreeCandidateReviewVariant =
  | "A_THREE_ACROSS"
  | "B_CENTERED_THIRD"
  | "C_SINGLE_COLUMN";

export function threeCandidateReviewVariantFrom(
  value: string | null | undefined,
  reviewEnabled: boolean,
): ThreeCandidateReviewVariant | null {
  if (!reviewEnabled) return null;

  switch (value) {
    case "A":
      return "A_THREE_ACROSS";
    case "B":
      return "B_CENTERED_THIRD";
    case "C":
      return "C_SINGLE_COLUMN";
    default:
      return null;
  }
}
