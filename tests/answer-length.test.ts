/**
 * The answer length contract. A prose cap applied without a contract would truncate sourced content,
 * so these assertions are as much about what the contract must not do (cut a sentence, drop a
 * record, degrade to silence) as about the budget it enforces.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  ANSWER_LENGTH_CONTRACT,
  lengthRuleForPrompt,
  measureAnswer,
  overLengthBudget,
} from "../lib/ask/length-contract.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";

function pack(): EvidencePack {
  return {
    question: "when does the board meet?",
    today: "2026-08-31",
    intent: "MEETING_TIME",
    temporal: { kind: "NEXT" },
    subject: null,
    records: [
      {
        kind: "MEETING",
        id: "m1",
        text: "Regular meeting, 6:00 p.m.",
        sourceUrl: "https://example.gov/agenda",
      },
    ],
    gaps: [],
    denominators: {},
  } as unknown as EvidencePack;
}

const SHORT = "The board meets on Tuesday at six. The agenda is published.";

test("ASK-19: a short answer is inside the budget", () => {
  assert.equal(overLengthBudget(SHORT), null);
  const { sentences, characters } = measureAnswer(SHORT);
  assert.equal(sentences, 2);
  assert.equal(characters, SHORT.length);
});

test("ASK-19: SENTENCES are a gate", () => {
  const six = Array.from({ length: 6 }, (_, i) => `Sentence ${i + 1}.`).join(" ");
  const reason = overLengthBudget(six);
  assert.ok(reason, "six sentences is over a five-sentence budget");
  assert.match(reason, /sentences-over-5/);
});

test("ASK-19: CHARACTERS are a SECOND gate, because five sentences can be a wall", () => {
  // Five very long sentences satisfy a sentence count, so words are counted too.
  const wall = Array.from({ length: 4 }, () => "x".repeat(200)).join(". ") + ".";
  assert.ok(measureAnswer(wall).sentences <= ANSWER_LENGTH_CONTRACT.maxSentences);
  const reason = overLengthBudget(wall);
  assert.ok(reason, "a four-sentence wall passes the sentence gate and must fail the second");
  assert.match(reason, /characters-over-700/);
});

test("ASK-19: an over-budget answer is REJECTED, and the rejection is not a truncation", () => {
  // `validateAnswer` returns a verdict, never a shortened string.
  const long = Array.from({ length: 9 }, (_, i) => `Sentence number ${i + 1} about the board.`).join(" ");
  const verdict = validateAnswer(long, [], pack());
  assert.equal(verdict.kind, "FAILED");
  assert.ok(verdict.kind === "FAILED" && verdict.failed.some((f) => f.startsWith("too-long:")));
  assert.ok(
    verdict.kind === "FAILED" && verdict.checked.includes("within-length-budget"),
    "the check is declared as run, so a run that skipped it is visible",
  );
  // Comments stripped first: the module's doc block may name the `slice` it refuses.
  const source = readFileSync("lib/ask/length-contract.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(
    !/\.slice\(0,|\.substring\(|truncat/i.test(source),
    "nothing in the contract cuts a string — half a sentence about a government is a claim " +
      "nobody made",
  );
});

test("ASK-19: a short answer still PASSES the whole validator", () => {
  /* The budget must not become a new way for correct answers to die. */
  const verdict = validateAnswer(SHORT, [], pack());
  assert.equal(verdict.kind, "PASSED", JSON.stringify(verdict));
  assert.ok(verdict.checked.includes("within-length-budget"));
});

test("ASK-19: the PROMPT states the same numbers the validator enforces", () => {
  // The prompt and the validator read one declaration.
  const rule = lengthRuleForPrompt();
  assert.match(rule, new RegExp(String(ANSWER_LENGTH_CONTRACT.maxSentences)));
  assert.match(rule, new RegExp(String(ANSWER_LENGTH_CONTRACT.maxCharacters)));
  const prompt = readFileSync("lib/ask/synthesize.ts", "utf8");
  assert.match(prompt, /lengthRuleForPrompt\(\)/, "the prompt reads the contract");
  assert.ok(
    !/Two to five sentences unless the records genuinely need more/.test(prompt),
    "the escape hatch is gone — an instruction the model can always satisfy is not a rule",
  );
});
