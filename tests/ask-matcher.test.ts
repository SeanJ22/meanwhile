import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { answerQuestion, askWasAnswered } from "../lib/routing/ask.ts";
import { matchDestination } from "../lib/routing/destinations.ts";
import { matchDigest } from "../lib/routing/digest.ts";
import {
  MIN_EXACT_NAME_CHARS,
  matchExactName,
  normalizeName,
  type NameableEntity,
} from "../lib/routing/exact-name.ts";
import {
  STRONG_MATCH_MIN_HITS,
  matchTopic,
  weakTopicMatch,
} from "../lib/routing/match.ts";
import { coverageAt } from "../lib/registry/server.ts";

/**
 * THE AUTHOR'S MATCHER RULING (2026-08-17), held permanently.
 *
 * *"The keyword layer only routes on a STRONG match — multiple distinct
 * keyword hits, or an exact name match (a body, person, district, or
 * destination named as such). Anything weaker falls through to the Claude
 * classifier, which reads the full question and either picks the right drawer
 * or says nothing routes."*
 *
 * The first test below is the proving case the ruling names by hand, and it is
 * required to be permanent. Everything after it holds the rest of the ruling:
 * what the threshold is, which exact-name classes are honored, and that a weak
 * match reaches the reader as a refusal rather than as a low-confidence route
 * when the classifier is not available.
 */

const TUCSON: [number, number] = [32.2226, -110.9747];

// ── 1. THE PROVING CASE ────────────────────────────────────────────────────

const WEATHER = "what will the weather be like on election day";

test("PROVING CASE: the weather question does not route on the keyword layer", () => {
  /*
   * g11 found this and handed it over rather than claiming it as a defect,
   * because nothing was fabricated: the word "election" is genuinely a keyword
   * of `elections-voting`, the route's answer was assembled from sourced
   * records, and A07's contract held throughout. What was wrong was narrower
   * and worse — the product answered a question nobody had asked.
   *
   * One hit is now weak. This must never route on the keyword layer again.
   */
  assert.equal(
    matchTopic(WEATHER),
    null,
    "one keyword hit ('election') may not carry a route",
  );

  // It declined for the right reason, and the record says which: a single
  // sub-threshold hit, not an absence of evidence. Naming the difference is
  // what lets a later audit tell a near-miss from a blank.
  const weak = weakTopicMatch(WEATHER);
  assert.ok(weak, "the sub-threshold winner is still reportable");
  assert.equal(weak.topicId, "elections-voting");
  assert.deepEqual(weak.matchedOn, ["election"]);

  // And nothing else picks it up on the way past — not a destination, not the
  // digest. The question reaches the classifier untouched.
  assert.equal(matchDestination(WEATHER), null);
  assert.equal(matchDigest(WEATHER), null);
});

test("PROVING CASE, end to end: with no classifier the weather question is REFUSED, not routed", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  // No classifier topic is supplied — which is exactly the state when the
  // ripcord is pulled, the ceiling is spent, or the API is unreachable.
  const result = answerQuestion(WEATHER, coverage, "85701");
  assert.equal(result.answer.kind, "NO_ROUTE");
  assert.equal(
    askWasAnswered(result),
    false,
    "an unanswered question must be logged as one — this is A06's roadmap",
  );
  assert.ok(result.answer.statement, "the refusal is stated to the reader");
  assert.equal(result.match, null, "no low-confidence route is ever the fallback");
});

// ── 2. THE THRESHOLD, STATED ───────────────────────────────────────────────

test("the strong-match threshold is two distinct hits, and it is the same number the code uses", () => {
  assert.equal(STRONG_MATCH_MIN_HITS, 2);

  // At the bar.
  const strong = matchTopic("there is a pothole on my street");
  assert.ok(strong);
  assert.equal(strong.topicId, "roads-local");
  assert.ok(strong.matchedOn.length >= STRONG_MATCH_MIN_HITS);

  // Below it — every one of these has exactly one hit and every one declines.
  for (const [question, topicId] of [
    ["my water bill", "water-sewer"],
    ["my property assessment", "property-taxes"],
    ["who do I call about the library", "libraries"],
    ["a pothole", "roads-local"],
  ] as const) {
    assert.equal(matchTopic(question), null, `"${question}" must decline`);
    const weak = weakTopicMatch(question);
    assert.equal(weak?.topicId, topicId);
    assert.equal(weak?.matchedOn.length, 1);
  }

  // A tie still refuses at any strength — that rule predates the threshold and
  // is not replaced by it.
  assert.equal(matchTopic("school"), null);
  assert.equal(weakTopicMatch("school"), null, "a one-hit tie is still a tie");
  assert.equal(weakTopicMatch(""), null);
});

// ── 3. THE EXACT-NAME CLASSES ──────────────────────────────────────────────

const INDEX: NameableEntity[] = [
  { id: "b1", name: "Planning Commission", nameClass: "body" },
  { id: "b2", name: "Pima County Board of Supervisors", nameClass: "body" },
  { id: "p1", name: "Regina Romero", nameClass: "person" },
  { id: "d1", name: "AZ-6", nameClass: "district" },
  { id: "pl1", name: "Vail", nameClass: "place" },
  { id: "m1", name: "Regular Session", nameClass: "meeting" },
];

test("the four classes the ruling names all route at one match, plus the two the index also carries", () => {
  // A body, a person, a district and (the fourth class) a destination — the
  // destination through its own module, which is where a curated phrase lives.
  assert.equal(matchExactName("Planning Commission", INDEX)?.entity.id, "b1");
  assert.equal(matchExactName("Regina Romero", INDEX)?.entity.id, "p1");
  assert.equal(matchExactName("AZ-6", INDEX)?.entity.id, "d1");
  assert.equal(matchDestination("what's on my ballot")?.destination.id, "ballot");

  // And the two more the same index carries, named as such by a reader.
  assert.equal(matchExactName("Vail", INDEX)?.entity.id, "pl1");
  assert.equal(matchExactName("Regular Session", INDEX)?.entity.id, "m1");

  // Every class that matched is reported, so a caller can route by kind.
  assert.equal(matchExactName("Planning Commission", INDEX)?.entity.nameClass, "body");
});

test("exact means WHOLE: a name inside a sentence is a question, not a navigation", () => {
  // This is the whole reason a name may route on one match. If a name buried
  // in a sentence counted, "when does the Planning Commission meet" would
  // navigate instead of answering, and the strength would be unearned.
  assert.equal(matchExactName("when does the Planning Commission meet", INDEX), null);
  assert.equal(matchExactName("I want to email Regina Romero", INDEX), null);
});

test("exact-name refuses ambiguity, article noise, and fragments", () => {
  // Two DIFFERENT rows with the same name: the string did not say which.
  const ambiguous: NameableEntity[] = [
    ...INDEX,
    { id: "b3", name: "planning commission", nameClass: "body" },
  ];
  assert.equal(matchExactName("Planning Commission", ambiguous), null);

  // The SAME row arriving twice is not a tie.
  assert.equal(
    matchExactName("Planning Commission", [...INDEX, { ...INDEX[0] }])?.entity.id,
    "b1",
  );

  // A leading article is noise, not a different body.
  assert.equal(matchExactName("the Planning Commission", INDEX)?.entity.id, "b1");
  assert.equal(normalizeName("The  Planning—Commission "), "planning commission");

  // Fragments mid-typing never navigate.
  assert.equal(MIN_EXACT_NAME_CHARS, 3);
  assert.equal(matchExactName("Va", INDEX), null);
  assert.equal(matchExactName("", INDEX), null);
});

// ── 4. THE FALLTHROUGH CONTRACT ────────────────────────────────────────────

test("a weak match with a classifier topic routes; the same match without one refuses", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const question = "my water bill";

  const unaided = answerQuestion(question, coverage, "85701");
  assert.equal(unaided.answer.kind, "NO_ROUTE");
  assert.equal(unaided.weak?.topicId, "water-sewer", "the near-miss is reported");

  const aided = answerQuestion(question, coverage, "85701", "water-sewer");
  assert.equal(aided.answer.kind, "ROUTED");
  assert.equal(aided.match?.via, "classifier");
  assert.deepEqual(
    aided.match?.matchedOn,
    [],
    "a classifier match carries no keyword evidence, and must not pretend to",
  );
});

test("the classifier still cannot invent a route, and still cannot overrule a strong one", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const invented = answerQuestion("my water bill", coverage, "85701", "made-up-topic");
  assert.equal(invented.answer.kind, "NO_ROUTE");

  const strong = answerQuestion(
    "there is a pothole on my street",
    coverage,
    "85701",
    "libraries",
  );
  assert.equal(strong.match?.topicId, "roads-local");
  assert.equal(strong.match?.via, undefined);
});

// ── 5. THE ANSWERED DEFINITION — A06'S ROADMAP ─────────────────────────────

test("askWasAnswered is the single definition, and the surface reads it rather than repeating it", async () => {
  const coverage = await coverageAt(...TUCSON, 1);

  // Destination only: no topic at all, and still an answer.
  const destinationOnly = answerQuestion("when is the next meeting", coverage, "85701");
  assert.ok(destinationOnly.destination, "the destination matched");
  assert.equal(askWasAnswered(destinationOnly), true);

  // Digest only.
  const digestOnly = answerQuestion("whats going on where i live", coverage, "85701");
  assert.ok(digestOnly.digest, "the digest matched");
  assert.equal(askWasAnswered(digestOnly), true);

  // Exact name only.
  const named = answerQuestion("Planning Commission", coverage, "85701", {
    entities: INDEX,
  });
  assert.ok(named.exactName, "the name matched");
  assert.equal(askWasAnswered(named), true);

  // A genuine refusal is still a refusal.
  const refused = answerQuestion("qwertyuiop asdfgh", coverage, "85701");
  assert.equal(askWasAnswered(refused), false);

  // A03: an agenda hit is an answer even when nothing else matched, and no
  // hits leaves the refusal a refusal.
  assert.equal(askWasAnswered(refused, { agendaHits: 0 }), false);
  assert.equal(askWasAnswered(refused, { agendaHits: 3 }), true);

  /*
   * The component must not carry a SECOND definition of answered. g11's defect
   * was a `routedSomewhere` expression that knew about topics and destinations
   * and would have had to learn about the digest and exact names separately —
   * three chances to disagree with the render. The source is pinned: the log
   * branch reads the shared function.
   */
  const source = readFileSync(
    join(process.cwd(), "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  // The call may carry extra evidence (A03's agenda hits, 2026-08-18) —
  // what it may NOT do is decide "answered" itself. The pin is on the call,
  // not on its argument list, so extending the definition stays legal and
  // re-implementing it does not.
  assert.match(
    source,
    /if \(askWasAnswered\(result[,)]/,
    "the log branch must read the shared definition of answered",
  );
  assert.ok(
    !/askWasAnswered\(result\)\s*\|\|/.test(source),
    "the component is ORing something onto the shared definition — extend the function instead",
  );
  assert.ok(
    !/routedSomewhere/.test(source),
    "the component's private copy of 'answered' is gone, not shadowed",
  );
});
