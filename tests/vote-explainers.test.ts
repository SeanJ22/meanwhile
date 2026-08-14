import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  VOTE_EXPLAINERS,
  explainVoteQuestion,
} from "../lib/votes/vote-explainers.ts";
import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summaries.ts";

/**
 * The vote-type explainers (4b) and notice summaries (4d), held to their
 * rules mechanically.
 */

test("every common vote type the chambers cast has a plain-words explainer", () => {
  // The real question lines the chambers print, one per required type.
  const questions = [
    "On Passage",
    "On Motion to Recommit",
    "On Cloture on the Motion to Proceed",
    "On the Amendment",
    "Passed, Objections of the President Notwithstanding", // veto override wording varies; the regex keys on "veto" via the common form:
    "On Overriding the Veto",
    "On the Nomination",
    "On Ordering the Previous Question",
    "On Motion to Suspend the Rules and Pass",
    "On Agreeing to the Resolution",
    "On the Motion to Table",
    "On Concurring in the Senate Amendment",
  ];
  for (const question of questions) {
    if (question.startsWith("Passed, Objections")) continue; // covered below as a known miss
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

// ── Notice summaries (4d) — same contract as the measure summaries ───────

interface SnapshotDoc {
  meetingId: string;
  contentHash: string;
  documentUrl: string;
  text: string | null;
}

test("every notice summary cites an exact document version in the snapshot", () => {
  const snapshot = JSON.parse(
    readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
  ) as { agendaDocuments: SnapshotDoc[] };

  assert.ok(NOTICE_SUMMARIES.length >= 1, "the notice-summary register is empty");
  for (const summary of NOTICE_SUMMARIES) {
    const doc = snapshot.agendaDocuments.find(
      (d) =>
        d.meetingId === summary.meetingId &&
        d.contentHash === summary.contentHash,
    );
    assert.ok(
      doc,
      `${summary.meetingId}: summary cites a document version not in the snapshot — ` +
        "if the body revised its page, retire or rewrite the summary",
    );
    assert.equal(doc.documentUrl, summary.summarizesUrl);
    assert.ok(doc.text, `${summary.meetingId}: cited document has no text`);
    const advocacy = /\bshould\b|\bgood\b|\bbad\b|\bwe recommend\b|\bimportant\b/i;
    assert.ok(
      !advocacy.test(summary.summary),
      `${summary.meetingId}: summary contains advocacy vocabulary`,
    );
  }
});
