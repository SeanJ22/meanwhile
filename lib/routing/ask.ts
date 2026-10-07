import { answerSaysSomething, type AskAnswerPayload } from "../ask/answer.ts";
import type { CoverageSummary } from "../registry/coverage.ts";

import { matchDestination, type DestinationMatch } from "./destinations.ts";
import { matchDigest, type DigestMatch } from "./digest.ts";
import {
  everydayContactsFor,
  type EverydayContact,
  type EverydayRoutingProjection,
} from "./everyday.ts";
import {
  matchExactName,
  normalizeName,
  type ExactNameMatch,
  type NameableEntity,
} from "./exact-name.ts";
import { matchTopic, weakTopicMatch, type TopicMatch } from "./match.ts";
import {
  bindNamedEntity,
  nameAReaderCanSay,
  type BindableEntity,
  type NamedEntityBinding,
} from "./named-entity.ts";
import { resolveRouting, type RoutingAnswer } from "./resolve.ts";

/**
 * The ask-box pipeline: free text → keyword match → registry-grounded route, or the honest refusal.
 * Pure and client-safe; no generation and no network. When the matched topic has a curated direct
 * contact for the ZIP in view, it rides the answer as `contacts`.
 *
 * The keyword layer routes only on a strong match, checked in this order:
 * 1. Exact name (`exact-name.ts`): the reader named a body, person, district, place or meeting, whole.
 * 2. Destination phrase (`destinations.ts`).
 * 3. Digest (`digest.ts`): "what's going on where I live".
 * 4. Strong keyword topic (`match.ts`): two or more distinct hits.
 * Anything weaker routes nowhere from here: the caller hands it to the Level 1 classifier, and where the
 * classifier is unavailable the reader gets the refusal with destinations offered. A low-confidence route
 * is never the fallback. `weak` is diagnostic evidence only; nothing renders from it.
 */
export interface AskAnswer {
  match: TopicMatch | null;
  answer: RoutingAnswer;
  /** Direct owners for this topic at the zip in view. Often empty. */
  contacts: EverydayContact[];
  /**
   * An in-app surface this question asks to be taken to (ballot, meetings, districts or contact). Rides
   * alongside the topic answer rather than replacing it, since a question can be both.
   */
  destination: DestinationMatch | null;
  /** A02: the reader asked for the whole picture of their own divisions. */
  digest: DigestMatch | null;
  /** The reader named a thing outright. The surface navigates on this rather than answering. */
  exactName: ExactNameMatch | null;
  /** The sub-threshold keyword winner. Diagnostic only; never rendered. */
  weak: TopicMatch | null;
  /**
   * The government the reader named, reconciled against what we hold. `NONE` for most questions.
   * Rendered: `AMBIGUOUS` and `UNRESOLVED` are sentences the reader has to see.
   */
  binding: NamedEntityBinding;
}

export interface AskOptions {
  /**
   * A topic the Level 1 classifier chose, used only when the keyword matcher refused; read after
   * `matchTopic`, so it can never overrule a deterministic match.
   */
  classified?: string | null;
  /**
   * Everything the reader could name outright at this moment — the search
   * index, adapted. Empty is a fine and common value: the exact-name rung
   * simply finds nothing, and the question falls to the layers below.
   */
  entities?: readonly NameableEntity[];
  /** Server-preloaded canonical routing authority; absent means no contacts. */
  everydayRouting?: EverydayRoutingProjection | null;
}

export function answerQuestion(
  text: string,
  coverage: CoverageSummary,
  zip: string | null = null,
  /**
   * The fourth positional argument is the classifier's topic; an options object is accepted in its place
   * for the newer rungs.
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

  // The binding rung runs before routing: a government the reader named outranks the one their ZIP
  // implies (see `named-entity.ts`). The inventory is the search index plus the reader's own covered bodies,
  // which carry `divisionType` and often only a `divisionLabel`.
  const binding = bindNamedEntity(text, bindableEntities(coverage, options.entities ?? []));

  // No match resolves the unmapped-topic id — resolveRouting returns the
  // refusal for anything it doesn't know, which is exactly the contract.
  const answer = resolveRouting(match?.topicId ?? "", coverage, binding);
  // Contacts are keyed on the reader's ZIP, so a named government the reader's own context cannot satisfy
  // silences them too. `BOUND` keeps them only when the named government is one of the reader's own.
  const bindingAllowsLocalContacts =
    binding.kind === "NONE" ||
    (binding.kind === "BOUND" &&
      coverage.bodies.some(
        (b) => b.bodyId === binding.entity.id || b.ocdId === binding.entity.id,
      ));
  const contacts =
    match && bindingAllowsLocalContacts
      ? everydayContactsFor(match.topicId, zip, options.everydayRouting)
      : [];
  // An in-app destination, matched independently of the topic and after it, so it cannot change any
  // answer the router already gave.
  const destination = matchDestination(text);
  const digest = matchDigest(text);
  const exactName = matchExactName(text, options.entities ?? []);
  // Reported only when the threshold is what turned it away — a match that
  // routed is not weak, and a question with no keyword at all has no weak
  // winner to name.
  const weak = keyword ? null : weakTopicMatch(text);

  return { match, answer, contacts, destination, digest, exactName, weak, binding };
}

/**
 * Everything the reader could have named, for the binding rung: the search index (what the reader sees
 * and types) merged with the reader's own covered bodies (which carry `divisionType`, and whose readable
 * label is often `divisionLabel`). Ids are the registry's own.
 */
function bindableEntities(
  coverage: CoverageSummary,
  entities: readonly NameableEntity[],
): BindableEntity[] {
  // The two sources use different id spaces for the same government (`body:<venue key>` vs the registry
  // `bodyId`). Deduplicate by normalized name, only across the two sources, never within coverage: two
  // different governments sharing a name are both coverage rows and stay AMBIGUOUS. The index row is the
  // weaker duplicate and is dropped.
  const fromCoverage: BindableEntity[] = [];
  const coveredNames = new Set<string>();
  for (const body of coverage.bodies) {
    // Qualified where the body's own name identifies nothing (e.g. a body called just "Planning Board").
    // The same rule the meetings inventory uses, so the two Ask paths agree on what a reader can name.
    const label = nameAReaderCanSay(body.name, body.divisionLabel);
    if (!label) continue;
    coveredNames.add(normalizeName(label));
    fromCoverage.push({
      id: body.bodyId,
      name: label,
      nameClass: "body",
      divisionType: body.divisionType,
    });
  }

  const fromIndex = entities
    .filter((e) => !coveredNames.has(normalizeName(e.name)))
    .map((e) => ({ ...e }));

  return [...fromCoverage, ...fromIndex];
}

/**
 * Did this question reach an answer? The single definition, so the surface and the log never disagree
 * and an answered question never lands in the cannot-answer log. An exact name counts as answered; the
 * caller routes it to the search log, not the question log.
 */
export function askWasAnswered(
  result: AskAnswer,
  /**
   * The Ask engine's whole reply. Uses `answerSaysSomething` rather than counting fields, so there is one
   * definition of "answered". A named gap counts as answered.
   */
  grounded: AskAnswerPayload | null = null,
): boolean {
  return Boolean(
    (result.answer.kind === "ROUTED" && result.match) ||
      result.destination ||
      result.digest ||
      result.exactName ||
      answerSaysSomething(grounded),
  );
}

/** An empty unbound engine reply cannot deny a verified routing answer below it. */
export function showGroundedAnswer(result: AskAnswer | null, grounded: AskAnswerPayload | null): boolean {
  if (!grounded) return false;
  if (!result || !askWasAnswered(result)) return true;
  return Boolean(grounded.subject || answerSaysSomething(grounded) ||
    grounded.contacts.length || grounded.meetings.length ||
    grounded.mode === "OFF" || grounded.mode === "TRANSPORT_FAILED");
}

/** The refusal text length cap for the search log — the roadmap needs the
 *  question, never a novel. */
export const REFUSAL_LOG_MAX_CHARS = 200;
