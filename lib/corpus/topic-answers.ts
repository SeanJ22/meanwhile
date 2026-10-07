import { composeOwnWordsAnswer } from "../ask/own-words.ts";
import type { EvidenceGap, EvidenceRecord } from "../ask/evidence.ts";
import { statementEvidenceFor } from "../ask/statements.ts";
import { DEFAULT_STANCE_TOPICS, type StanceTopic } from "../stances/topics.ts";
import type { StatementCorpus } from "./types.ts";

/**
 * Builds each stance topic's answer once, with the same statement search and
 * exact-words composer Ask uses, so a chip and a typed question cannot drift
 * apart. Pure: the corpus and the people are arguments.
 */

export interface TopicAnswerPerson {
  /** Roster officeholder id or ballot candidacy id, as the corpus keys it. */
  readonly subjectId: string;
  readonly name: string;
  /** The exact identity keys the corpus holds this person under (official and card ids), proved by the caller. */
  readonly identityKeys?: readonly string[];
}

export interface StoredTopicAnswer {
  readonly subjectId: string;
  readonly topicId: string;
  /** The chip label the reader tapped. */
  readonly topic: string;
  /** Ask's exact-words answer, when every passage is a clean own-page quote. */
  readonly prose: string | null;
  /** The cited pages, as Ask returns them. */
  readonly citedUrls: readonly string[];
  /** The records Ask would show under the answer. */
  readonly records: readonly EvidenceRecord[];
  /** What was searched, from Ask's own gaps; present when nothing is quotable. */
  readonly gaps: readonly EvidenceGap[];
  readonly denominators: Readonly<Record<string, number>>;
}

/** The question a chip stands for, worded so Ask's own stance routing accepts it. */
export function chipQuestion(name: string, topic: string): string {
  return `What does ${name} say about ${topic}?`;
}

/** One person's stored answer for one topic, or null when the corpus could not be read for them. */
export function buildTopicAnswer(person: TopicAnswerPerson, topic: StanceTopic, corpus: StatementCorpus): StoredTopicAnswer | null {
  const subject = { kind: "PERSON" as const, id: person.subjectId, name: person.name };
  const question = chipQuestion(person.name, topic.label);
  const found = statementEvidenceFor(subject, question, [], () => corpus, person.identityKeys ?? [person.subjectId]);
  // A read that failed is not an answer: the chip keeps asking Ask.
  if (found.denominators.statementLoaderFailures || found.denominators.statementIdentityUnresolved) return null;
  const composed = composeOwnWordsAnswer({ subject, question, records: found.records });
  return {
    subjectId: person.subjectId, topicId: topic.id, topic: topic.label,
    prose: composed?.answer ?? null, citedUrls: composed?.citedUrls ?? [...new Set(found.records.flatMap(r => r.sourceUrl ? [r.sourceUrl] : []))],
    records: found.records, gaps: found.gaps, denominators: found.denominators,
  };
}

/** Every person against the same topics, in the same order: equal effort by construction. */
export function buildTopicAnswers(
  people: readonly TopicAnswerPerson[],
  corpus: StatementCorpus,
  topics: readonly StanceTopic[] = DEFAULT_STANCE_TOPICS,
): StoredTopicAnswer[] {
  return people.flatMap(person => topics.flatMap(topic => {
    const answer = buildTopicAnswer(person, topic, corpus);
    return answer ? [answer] : [];
  }));
}

/** The stored answers keyed by chip label, for the one person a card shows. */
export function topicAnswersByLabel(answers: readonly StoredTopicAnswer[], subjectId: string): Record<string, StoredTopicAnswer> {
  return Object.fromEntries(answers.filter(a => a.subjectId === subjectId).map(a => [a.topic, a]));
}
