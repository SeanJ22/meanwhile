import type { CoverageSummary } from "../registry/coverage.ts";

import { everydayContactsFor, type EverydayContact } from "./everyday.ts";
import { matchTopic, type TopicMatch } from "./match.ts";
import { resolveRouting, type RoutingAnswer } from "./resolve.ts";

/**
 * The ask-box pipeline (5, 2026-08-19): free text → keyword match →
 * registry-grounded route, or the honest refusal. Pure and client-safe —
 * coverage arrives as an argument; no generation of any kind and no
 * network. The identical function runs in the golden tests against the
 * real registry at 85701.
 *
 * The everyday layer (session brief 3, wall clock 2026-08-14): when the
 * matched topic has a curated direct contact for the zip in view — the
 * office that owns the fix, with a real phone — it rides the answer as
 * `contacts`, rendered before the escalation steps. A service line that
 * owns the topic IS the answer; the steps stay as who to escalate to.
 */
export interface AskAnswer {
  match: TopicMatch | null;
  answer: RoutingAnswer;
  /** Direct owners for this topic at the zip in view. Often empty. */
  contacts: EverydayContact[];
}

export function answerQuestion(
  text: string,
  coverage: CoverageSummary,
  zip: string | null = null,
): AskAnswer {
  const match = matchTopic(text);
  // No match resolves the unmapped-topic id — resolveRouting returns the
  // refusal for anything it doesn't know, which is exactly the contract.
  const answer = resolveRouting(match?.topicId ?? "", coverage);
  const contacts = match ? everydayContactsFor(match.topicId, zip) : [];
  return { match, answer, contacts };
}

/** The refusal text length cap for the search log — the roadmap needs the
 *  question, never a novel. */
export const REFUSAL_LOG_MAX_CHARS = 200;
