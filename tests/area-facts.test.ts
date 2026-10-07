import assert from "node:assert/strict";
import { test } from "node:test";

import { AREA_FACTS, areaFactsForState } from "../lib/area/facts.ts";

/**
 * The mover's page: official sources, plain sentences, no characterization.
 */

const REQUIRED_TOPICS = [
  "marijuana",
  "school-vaccinations",
  "firearms",
  "income-tax",
  "vehicle",
  "voter-registration",
  "property-tax",
];

test("all three covered states answer all seven mover questions", () => {
  assert.deepEqual(
    AREA_FACTS.map((s) => s.state).sort(),
    ["AZ", "NH", "NJ"],
  );
  for (const set of AREA_FACTS) {
    const topics = set.facts.map((f) => f.topic);
    for (const topic of REQUIRED_TOPICS) {
      assert.ok(
        topics.includes(topic),
        `${set.state}: missing required topic "${topic}"`,
      );
    }
  }
});

test("every answer is cited to an official https source with a verification note", () => {
  for (const set of AREA_FACTS) {
    for (const fact of set.facts) {
      assert.match(fact.sourceUrl, /^https:\/\//, `${set.state}/${fact.topic}`);
      assert.ok(
        !/wikipedia|ballotpedia|blog|news/i.test(fact.sourceUrl),
        `${set.state}/${fact.topic}: source must be official, not secondary`,
      );
      assert.ok(
        fact.verification.length > 5,
        `${set.state}/${fact.topic}: verification note required`,
      );
      assert.ok(fact.sourceOrg.length > 3, `${set.state}/${fact.topic}`);
    }
  }
});

test("answers state rules without characterizing them", () => {
  // The reader judges; we cite. Adjectives of judgment are the leak.
  const characterization =
    /\b(strict|lenient|generous|harsh|burdensome|notorious|high taxes|low taxes|sadly|unfortunately|thankfully|controversial|extreme)\b/i;
  for (const set of AREA_FACTS) {
    for (const fact of set.facts) {
      assert.ok(
        !characterization.test(fact.answer),
        `${set.state}/${fact.topic}: characterization in answer: ${fact.answer}`,
      );
      // Register bound: one or two sentences, not an essay.
      assert.ok(
        fact.answer.length < 400,
        `${set.state}/${fact.topic}: answer too long for the register`,
      );
    }
  }
});

test("lookup is by state code, case-insensitive, honest null otherwise", () => {
  assert.ok(areaFactsForState("nj"));
  assert.ok(areaFactsForState("NH"));
  assert.equal(areaFactsForState("TX"), null);
});
