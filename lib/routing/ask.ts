import type { CoverageSummary } from "../registry/coverage.ts";

import { matchDestination, type DestinationMatch } from "./destinations.ts";
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
  /**
   * An in-app surface this question is asking to be taken to (G05 rule 4d,
   * 2026-08-17) — ballot, meetings, districts or contact. Null for the great
   * majority of questions, which are about who owns a problem rather than
   * about where something already is.
   *
   * It rides ALONGSIDE the topic answer rather than replacing it: a question
   * can be both ("when does the school board meet" is a meetings destination
   * AND a schools topic), and dropping one to render the other would answer
   * less than we know.
   */
  destination: DestinationMatch | null;
}

export function answerQuestion(
  text: string,
  coverage: CoverageSummary,
  zip: string | null = null,
  /**
   * A topic the Level 1 classifier chose (6d, 2026-08-15), used ONLY when
   * the keyword matcher refused. Keyword-first is structural here rather
   * than a convention: the classifier's id is read after `matchTopic`, so
   * it can never overrule a deterministic match.
   */
  classified: string | null = null,
): AskAnswer {
  const keyword = matchTopic(text);
  const match: TopicMatch | null =
    keyword ??
    (classified ? { topicId: classified, matchedOn: [], via: "classifier" } : null);
  // No match resolves the unmapped-topic id — resolveRouting returns the
  // refusal for anything it doesn't know, which is exactly the contract.
  const answer = resolveRouting(match?.topicId ?? "", coverage);
  const contacts = match ? everydayContactsFor(match.topicId, zip) : [];
  /*
   * G05 rule 4d: an in-app destination, matched independently of the topic.
   *
   * Read AFTER the topic so the extension cannot change any answer the
   * router already gave — a destination is additive by construction, and
   * `tests/ask-destinations.test.ts` proves every previously-routed question
   * still routes to the same topic.
   */
  const destination = matchDestination(text);
  return { match, answer, contacts, destination };
}

/** The refusal text length cap for the search log — the roadmap needs the
 *  question, never a novel. */
export const REFUSAL_LOG_MAX_CHARS = 200;
