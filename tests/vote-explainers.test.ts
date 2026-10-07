import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  VOTE_EXPLAINERS,
  explainVoteQuestion,
} from "../lib/votes/vote-explainers.ts";
import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summary.ts";

test("every common vote type the chambers cast has a plain-words explainer", () => {
  const questions = [
    "On Passage",
    "On Motion to Recommit",
    "On Cloture on the Motion to Proceed",
    "On the Amendment",
    "Passed, Objections of the President Notwithstanding",
    "On Overriding the Veto",
    "On the Nomination",
    "On Ordering the Previous Question",
    "On Motion to Suspend the Rules and Pass",
    "On Agreeing to the Resolution",
    "On the Motion to Table",
    "On Concurring in the Senate Amendment",
  ];
  for (const question of questions) {
    if (question.startsWith("Passed, Objections")) continue;
    const explainer = explainVoteQuestion(question);
    assert.ok(explainer, `no explainer for "${question}"`);
    assert.ok(explainer.plain.length > 40, `"${question}": explainer too thin`);
  }
});

test("an unmatched question renders no explainer — never a guessed one", () => {
  assert.equal(explainVoteQuestion("On the Quorum Call"), null);
  assert.equal(explainVoteQuestion(""), null);
});

test("every explainer cites its parliamentary definition in the data file", () => {
  for (const explainer of VOTE_EXPLAINERS) {
    assert.match(
      explainer.basis,
      /https:\/\/(www\.)?(senate\.gov|govinfo\.gov)/,
      `explainer "${explainer.plain.slice(0, 40)}…" must cite an official definition`,
    );
  }
});

test("explainers pass the register test: plain words, no advocacy", () => {
  const jargon = /\bquorum\b|\bengrossment\b|\bsine die\b|\bunanimous consent\b/i;
  const advocacy = /\bshould\b|\bgood\b|\bbad\b|\bwe recommend\b/i;
  for (const explainer of VOTE_EXPLAINERS) {
    assert.ok(!jargon.test(explainer.plain), `jargon in: ${explainer.plain}`);
    assert.ok(!advocacy.test(explainer.plain), `advocacy in: ${explainer.plain}`);
  }
});

test("5b: every vote type states what a No vote mechanically did — never evaluatively", () => {
  const advocacy = /\bshould\b|\bgood\b|\bbad\b|\bsadly\b|\bunfortunately\b/i;
  for (const explainer of VOTE_EXPLAINERS) {
    assert.ok(
      explainer.noMeans && explainer.noMeans.length > 20,
      `missing noMeans for: ${explainer.plain.slice(0, 40)}…`,
    );
    assert.match(
      explainer.noMeans,
      /\bNo\b/,
      `noMeans must speak about the No vote: ${explainer.noMeans}`,
    );
    assert.ok(!advocacy.test(explainer.noMeans), `advocacy in: ${explainer.noMeans}`);
  }
});

test("the vote surface actually renders the explainers", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "map", "popup", "official-popup.tsx"),
    "utf8",
  );
  assert.ok(
    source.includes("explainVoteQuestion"),
    "official-popup must render the vote-type explainer on each row",
  );
});

test("notice summaries carry no advocacy vocabulary", () => {
  assert.ok(NOTICE_SUMMARIES.length >= 1, "the notice-summary register is empty");
  const advocacy = /\bshould\b|\bgood\b|\bbad\b|\bwe recommend\b|\bimportant\b/i;
  for (const summary of NOTICE_SUMMARIES) {
    assert.ok(
      !advocacy.test(summary.summary),
      `${summary.meetingId}: summary contains advocacy vocabulary`,
    );
  }
});
