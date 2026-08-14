import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { answerQuestion, REFUSAL_LOG_MAX_CHARS } from "../lib/routing/ask.ts";
import { matchTopic } from "../lib/routing/match.ts";

/**
 * The ask box, v1 (session brief 5, 2026-08-19): routing without
 * generation. The author's two golden cases run LIVE — the same
 * answerQuestion the surface calls, against the real registry at 85701 —
 * plus the honest refusal, the no-LLM guarantee, and the transparency
 * coupling.
 */

const TUCSON: [number, number] = [32.21696, -110.971];
const ROOT = join(import.meta.dirname, "..");

test("golden, live at 85701: the library question routes to Tucson and Pima", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer } = answerQuestion(
    "They stopped building the library down the road — who should I talk to?",
    coverage,
  );
  assert.equal(match?.topicId, "libraries");
  assert.equal(answer.kind, "ROUTED");
  const [cityStep, countyStep] = answer.steps;
  assert.ok(cityStep.bodies.some((b) => b.label === "Tucson"));
  assert.ok(countyStep.bodies.some((b) => b.label === "Pima"));
  assert.equal(answer.grounding.totalSteps, 2);
  assert.equal(answer.grounding.stepsWithSomeone, 2);
});

test("golden, live at 85701: the school-construction question routes to district policy", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer } = answerQuestion(
    "Who do I talk to about the new school construction they stopped?",
    coverage,
  );
  assert.equal(match?.topicId, "schools-policy");
  assert.equal(answer.kind, "ROUTED");
  assert.ok(
    answer.steps[0].bodies.some((b) => b.label.includes("Tucson Unified")),
    "the board step grounds on TUSD",
  );
});

test("the honest refusal: an unroutable question refuses, never guesses", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const { match, answer } = answerQuestion(
    "what is the meaning of civic life",
    coverage,
  );
  assert.equal(match, null);
  assert.equal(answer.kind, "NO_ROUTE");
  assert.ok(answer.statement?.includes("Rather than guess"));
  assert.equal(answer.steps.length, 0);
});

test("a tie between topics refuses — evidence that does not decide is not a route", () => {
  // One school anchor hit for each school topic and nothing else.
  assert.equal(matchTopic("school"), null);
  assert.equal(matchTopic(""), null);
  assert.equal(matchTopic("   "), null);
});

test("no generation: the ask pipeline touches no LLM, no network, no API key", () => {
  for (const file of ["match.ts", "ask.ts", "resolve.ts", "topics.ts"]) {
    const source = readFileSync(join(ROOT, "lib", "routing", file), "utf8");
    for (const banned of ["fetch(", "anthropic", "openai", "API_KEY", "llm"]) {
      assert.ok(
        !source.toLowerCase().includes(banned.toLowerCase()),
        `lib/routing/${file} contains "${banned}" — v1 is routing WITHOUT generation`,
      );
    }
  }
});

test("log discipline: routed asks log the topic only; refusals carry capped text", () => {
  // The component is the enforcement point — pin its source: the routed
  // branch must not send the question, the refusal branch must cap it.
  const source = readFileSync(
    join(ROOT, "components", "ask", "ask-box.tsx"),
    "utf8",
  );
  assert.match(source, /routed: true,\s*\}/, "the routed log call must carry no question text");
  assert.match(
    source,
    /question: question\.slice\(0, REFUSAL_LOG_MAX_CHARS\)/,
    "the refusal log call must cap the text",
  );
  assert.ok(!/localStorage/.test(source), "the ask box stores nothing on the device");
  assert.equal(REFUSAL_LOG_MAX_CHARS, 200);
});

test("the transparency page covers the ask box in the same commit", () => {
  const page = readFileSync(
    join(ROOT, "app", "transparency", "page.tsx"),
    "utf8",
  );
  assert.match(page, /Who do I talk to about/);
  assert.match(page, /no AI writes the answer/);
  assert.match(page, /200\s*(\n\s*)?characters/, "the cap must be stated to readers");
});

test("QUESTION_ASKED is a registered identifier-free event type", async () => {
  const { SEARCH_LOG_EVENT_TYPES, assertDetailIsAnonymous } = await import(
    "../lib/db/search-log.ts"
  );
  assert.ok(SEARCH_LOG_EVENT_TYPES.includes("QUESTION_ASKED"));
  // The exact detail shapes the component sends pass the anonymity guard.
  assertDetailIsAnonymous({ topic: "libraries", routed: true });
  assertDetailIsAnonymous({
    topic: "NO_ROUTE",
    routed: false,
    question: "who fixes the streetlights",
  });
});
