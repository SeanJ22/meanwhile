import { AREA_FACTS, areaFactsForState, type AreaFact } from "./facts.ts";

/**
 * **Two states, side by side** — tracker **D47**.
 *
 * ## What this is, and the one thing it must never become
 *
 * A mover asks "how is New Hampshire different from New Jersey?" and the
 * honest answer is two columns of sourced facts with the same questions down
 * the left. That is all this is.
 *
 * **Comparison is not ranking.** Nothing here scores, totals, weights,
 * orders, or declares a better one, and there is no affordance that implies
 * a preference. It is the same constraint as `CLAUDE.md`'s no-composite-score
 * rule arriving on a different surface: the moment the product says one state
 * is better, its neutrality claim is gone and the data business goes with it.
 * A reader comparing income tax between two states is entitled to both
 * numbers and to no opinion at all.
 *
 * `tests/comparison.test.ts` holds that: no key named `score`, `rank`,
 * `rating`, `better`, `winner` or `grade` may appear on anything this module
 * returns, and the column order is the manifest's onboarding order rather
 * than anything derived from the content.
 *
 * ## Alignment, and the row that only one state answers
 *
 * Rows are keyed by **topic**, never by position. All three covered states
 * happen to carry the same seven topics today, and building on that
 * coincidence would break silently the first time a state is onboarded with
 * six. A topic either state answers gets a row; the side that has no answer
 * renders its own named gap, and it says WHOSE gap it is — we have not
 * written it up, which is a fact about us and never about the state.
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
  /**
   * Counts, because an operation that can return nothing must say what it
   * returned. A comparison that silently aligned nothing would render as two
   * empty columns and read as "these states are the same".
   */
  census: {
    rows: number;
    bothAnswered: number;
    onlyLeft: number;
    onlyRight: number;
  };
}

/**
 * The sentence for a cell we have not written up.
 *
 * A named gap in the gap's own register. It is a fact about our pages, and it
 * must never read as "this state has no rule about that" — which would be a
 * specific false claim about a government.
 */
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

  /*
   * Topic order comes from the LEFT state's own authoring order, with any
   * topic only the right state carries appended. Deliberately not sorted by
   * anything derived from the answers — a sort by "most different" or "most
   * asked" would be an editorial ranking wearing an ordering.
   */
  const topics: string[] = [...left.facts.map((f) => f.topic)];
  for (const f of right.facts) {
    if (!topics.includes(f.topic)) topics.push(f.topic);
  }

  const rows: ComparisonRow[] = topics.map((topic) => {
    const l = left.facts.find((f) => f.topic === topic) ?? null;
    const r = right.facts.find((f) => f.topic === topic) ?? null;
    return {
      topic,
      // Whichever side has it; identical across states today, and taking the
      // left's when both exist keeps the column headers honest.
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

/**
 * Every pair we can compare, in the manifest's own onboarding order.
 *
 * Order is structural, never a recommendation: the manifest decides, not the
 * content, and not how interesting a pair looks.
 */
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
