import type { CoverageSummary } from "../registry/coverage.ts";

import { matchDestination, type DestinationMatch } from "./destinations.ts";
import { matchDigest, type DigestMatch } from "./digest.ts";
import { everydayContactsFor, type EverydayContact } from "./everyday.ts";
import {
  matchExactName,
  type ExactNameMatch,
  type NameableEntity,
} from "./exact-name.ts";
import { matchTopic, weakTopicMatch, type TopicMatch } from "./match.ts";
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
 *
 * ## THE AUTHOR'S MATCHER RULING (2026-08-17)
 *
 * *"The keyword layer only routes on a STRONG match — multiple distinct
 * keyword hits, or an exact name match (a body, person, district, or
 * destination named as such). Anything weaker falls through to the Claude
 * classifier, which reads the full question and either picks the right drawer
 * or says nothing routes."*
 *
 * That ruling is spread across four modules, each holding the part it can
 * prove, and this function is where they meet — in this order, because the
 * order IS the ruling:
 *
 * 1. **Exact name** (`exact-name.ts`) — the reader named a body, a person, a
 *    district, a place or a meeting, whole. Strong at one match.
 * 2. **Destination phrase** (`destinations.ts`) — a destination named as such.
 *    Strong, and already multi-word by construction.
 * 3. **Digest** (`digest.ts`) — A02's "what's going on where I live", the same
 *    phrase discipline.
 * 4. **Strong keyword topic** (`match.ts`) — two or more distinct hits.
 *
 * Everything below that bar is WEAK and routes nowhere from here. The caller
 * hands a weak question to the Level 1 classifier and asks again with what it
 * chose; where the classifier is off, over its ceiling or unreachable, the
 * weak match stays unrouted and the reader gets the honest refusal with the
 * destinations offered. A low-confidence route is never the fallback, which is
 * the half of the ruling that is easy to lose.
 *
 * `weak` carries the sub-threshold winner so the surface and a later audit can
 * tell "no keyword at all" from "one keyword, below the bar". It is evidence
 * about our matching, never an answer: nothing renders from it.
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
  /** A02: the reader asked for the whole picture of their own divisions. */
  digest: DigestMatch | null;
  /**
   * The reader named a thing outright. The surface NAVIGATES on this rather
   * than answering — naming a body is a request to be taken to it.
   */
  exactName: ExactNameMatch | null;
  /** The sub-threshold keyword winner. Diagnostic only; never rendered. */
  weak: TopicMatch | null;
}

export interface AskOptions {
  /**
   * A topic the Level 1 classifier chose (6d, 2026-08-15), used ONLY when
   * the keyword matcher refused. Keyword-first is structural here rather
   * than a convention: the classifier's id is read after `matchTopic`, so
   * it can never overrule a deterministic match.
   */
  classified?: string | null;
  /**
   * Everything the reader could name outright at this moment — the search
   * index, adapted. Empty is a fine and common value: the exact-name rung
   * simply finds nothing, and the question falls to the layers below.
   */
  entities?: readonly NameableEntity[];
}

export function answerQuestion(
  text: string,
  coverage: CoverageSummary,
  zip: string | null = null,
  /**
   * Historically the fourth positional argument was the classifier's topic.
   * It still is — every existing caller and test passes a string or null —
   * and an options object is accepted in its place for the newer rungs.
   */
  classifiedOrOptions: string | null | AskOptions = null,
): AskAnswer {
  const options: AskOptions =
    classifiedOrOptions !== null && typeof classifiedOrOptions === "object"
      ? classifiedOrOptions
      : { classified: classifiedOrOptions };
  const classified = options.classified ?? null;

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
  const digest = matchDigest(text);
  const exactName = matchExactName(text, options.entities ?? []);
  // Reported only when the threshold is what turned it away — a match that
  // routed is not weak, and a question with no keyword at all has no weak
  // winner to name.
  const weak = keyword ? null : weakTopicMatch(text);

  return { match, answer, contacts, destination, digest, exactName, weak };
}

/**
 * Did this question reach an answer? The single definition, so the surface
 * and the log can never disagree about it.
 *
 * This exists because of the defect g11 found and named: a question answered
 * by a destination alone was logged `NO_ROUTE` with its text, which put an
 * ANSWERED question into A06's roadmap of things this product cannot do. The
 * roadmap is only worth having if it contains exactly what we could not do, so
 * "answered" is defined once, here, and both the render and the log read it.
 *
 * An exact name is answered too, and more strongly than the rest: the reader
 * is navigated to the thing they named. It belongs in the SEARCH log, not the
 * question log — the two stores never blur, which is M119's own rule — so the
 * caller routes it there and this function only says that it was not a
 * refusal.
 */
export function askWasAnswered(
  result: AskAnswer,
  /**
   * A03 (2026-08-18): the agenda rung's result, which the CLIENT holds
   * because the corpus is server-side and this function is pure.
   *
   * It is a parameter rather than a second check at the call site for the
   * reason g11 wrote this function in the first place: a private copy of
   * "answered" in the component knew about topics and destinations and
   * would have had to learn the digest and exact names separately. The
   * agenda rung is the fourth thing that would have had to be learned
   * twice. One definition, one place to extend.
   */
  extra: { agendaHits?: number } = {},
): boolean {
  return Boolean(
    (result.answer.kind === "ROUTED" && result.match) ||
      result.destination ||
      result.digest ||
      result.exactName ||
      (extra.agendaHits ?? 0) > 0,
  );
}

/** The refusal text length cap for the search log — the roadmap needs the
 *  question, never a novel. */
export const REFUSAL_LOG_MAX_CHARS = 200;
