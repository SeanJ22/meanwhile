import { AREA_FACTS, areaFactsForState, type AreaFact } from "./facts.ts";

/**
 * Two states side by side: the same questions with each state's sourced
 * answer. Comparison is not ranking: nothing scores, orders or prefers, and the
 * column order is the manifest's onboarding order. Rows are keyed by topic; a
 * side with no answer renders its own named gap.
 */

export interface ComparisonCell {
  fact: AreaFact | null;
}

export interface ComparisonRow {
  topic: string;
  /** The question, in the words of whichever side asks it. Identical today. */
  question: string;
  left: ComparisonCell;
  right: ComparisonCell;
}

export interface StateComparison {
  left: { usps: string; name: string };
  right: { usps: string; name: string };
  rows: ComparisonRow[];
  /** Counts, so an empty comparison never reads as "these states are the same". */
  census: {
    rows: number;
    bothAnswered: number;
    onlyLeft: number;
    onlyRight: number;
  };
}

/** A cell we have not written up: a fact about our pages, never "this state has no rule". */
export const NOT_WRITTEN_UP =
  "We haven't written this one up for this state yet. That's a gap in our pages, not a statement about the state.";

/** Reader-facing intro. Level register: this is a claim surface. */
export const COMPARISON_INTRO =
  "The same questions, answered for both states from each state's own official sources. We don't rank states and we don't say which is better — that's yours to decide.";

export function compareStates(
  leftUsps: string,
  rightUsps: string,
): StateComparison | null {
  const left = areaFactsForState(leftUsps);
  const right = areaFactsForState(rightUsps);
  if (!left || !right || left.state === right.state) return null;

  /* The left state's authoring order, then topics only the right carries; never sorted by content. */
  const topics: string[] = [...left.facts.map((f) => f.topic)];
  for (const f of right.facts) {
    if (!topics.includes(f.topic)) topics.push(f.topic);
  }

  const rows: ComparisonRow[] = topics.map((topic) => {
    const l = left.facts.find((f) => f.topic === topic) ?? null;
    const r = right.facts.find((f) => f.topic === topic) ?? null;
    return {
      topic,
      // Whichever side has it; the left's when both exist.
      question: (l ?? r)!.question,
      left: { fact: l },
      right: { fact: r },
    };
  });

  return {
    left: { usps: left.state, name: left.stateName },
    right: { usps: right.state, name: right.stateName },
    rows,
    census: {
      rows: rows.length,
      bothAnswered: rows.filter((r) => r.left.fact && r.right.fact).length,
      onlyLeft: rows.filter((r) => r.left.fact && !r.right.fact).length,
      onlyRight: rows.filter((r) => !r.left.fact && r.right.fact).length,
    },
  };
}

/** Every comparable pair, in the manifest's onboarding order. */
export function comparablePairs(): { left: string; right: string }[] {
  const pairs: { left: string; right: string }[] = [];
  for (let i = 0; i < AREA_FACTS.length; i++) {
    for (let j = 0; j < AREA_FACTS.length; j++) {
      if (i === j) continue;
      pairs.push({ left: AREA_FACTS[i].state, right: AREA_FACTS[j].state });
    }
  }
  return pairs;
}
