/** A section’s missing facts, keyed by the fact rather than its display position. */
export interface CardGap {
  id: string;
  label: string;
  count?: number;
  unit?: string;
  kind?: "not-posted" | "not-held";
  subject?: { type: "BODY" | "CANDIDATE"; id: string } | null;
}

export function mergeCardGaps(gaps: readonly CardGap[]): CardGap[] {
  return [...new Map(gaps.filter(gap => (gap.count ?? 1) > 0 && gap.label.trim()).map(gap => [gap.id, gap])).values()];
}
