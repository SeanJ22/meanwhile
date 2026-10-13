/** Missing facts collected by a reader card, keyed by the fact rather than its display position. */
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

/** A publisher's observed absence is distinct from information we have yet to gather. */
export function cardGapLine(gaps: readonly CardGap[]): string | null {
  const parts = (["not-posted", "not-held"] as const).flatMap(kind => {
    const groups = new Map<string, { label: string; count: number; unit?: string }>();
    for (const gap of mergeCardGaps(gaps)) {
      if ((gap.kind ?? "not-held") !== kind) continue;
      const key = `${gap.label}|${gap.unit ?? ""}`;
      const existing = groups.get(key);
      if (existing) existing.count += gap.count ?? 1;
      else groups.set(key, { label: gap.label, count: gap.count ?? 1, unit: gap.unit });
    }
    if (!groups.size) return [];
    const labels = [...groups.values()].map(({ label, count, unit }) => unit
      ? `${label} for ${count} ${count === 1 ? unit : unit === "body" ? "bodies" : `${unit}s`}`
      : label);
    return [`${kind === "not-posted" ? "Not posted yet" : "Still gathering"}: ${labels.join(", ")}`];
  });
  return parts.length ? `${parts.join("; ")}.` : null;
}
