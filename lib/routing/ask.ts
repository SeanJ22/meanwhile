import type { CoverageSummary } from "../registry/coverage.ts";

import { matchTopic, type TopicMatch } from "./match.ts";
import { resolveRouting, type RoutingAnswer } from "./resolve.ts";

/**
 * The ask-box pipeline (5, 2026-08-19): free text → keyword match →
 * registry-grounded route, or the honest refusal. Pure and client-safe —
 * coverage arrives as an argument; no generation of any kind and no
 * network. The identical function runs in the golden tests against the
 * real registry at 85701.
 */
export interface AskAnswer {
  match: TopicMatch | null;
  answer: RoutingAnswer;
}

export function answerQuestion(
  text: string,
  coverage: CoverageSummary,
): AskAnswer {
  const match = matchTopic(text);
  // No match resolves the unmapped-topic id — resolveRouting returns the
  // refusal for anything it doesn't know, which is exactly the contract.
  const answer = resolveRouting(match?.topicId ?? "", coverage);
  return { match, answer };
}

/** The refusal text length cap for the search log — the roadmap needs the
 *  question, never a novel. */
export const REFUSAL_LOG_MAX_CHARS = 200;
