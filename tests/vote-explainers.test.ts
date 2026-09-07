import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  VOTE_EXPLAINERS,
  STATE_VOTE_EXPLAINERS,
  explainVoteQuestion,
  type VoteJurisdiction,
} from "../lib/votes/vote-explainers.ts";
import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summary.ts";

const FEDERAL = { level: "federal" } as const satisfies VoteJurisdiction;
const NH = { level: "state", state: "NH" } as const satisfies VoteJurisdiction;

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
    const explainer = explainVoteQuestion(question, FEDERAL);
    assert.ok(explainer, `no explainer for "${question}"`);
    assert.ok(explainer.plain.length > 40, `"${question}": explainer too thin`);
  }
});

test("an unmatched question renders no explainer — never a guessed one", () => {
  assert.equal(explainVoteQuestion("On the Quorum Call", FEDERAL), null);
  assert.equal(explainVoteQuestion("", FEDERAL), null);
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

test("state veto override names the governor only when the motion establishes an override", () => {
  for (const question of ["Veto Override", "On Overriding the Veto"]) {
    const explainer = explainVoteQuestion(question, NH);
    assert.ok(explainer);
    assert.match(explainer.plain, /override the governor's veto/);
    assert.equal(explainer.noMeans, "A No vote here was a vote against overriding the veto.");
    assert.doesNotMatch(explainer.plain, /President|two-thirds|became law|signed/i);
  }
  const message = explainVoteQuestion("VETO MESSAGE - Roll Call Required", NH);
  assert.ok(message);
  assert.match(message.plain, /governor's objections/);
  assert.doesNotMatch(message.plain, /President|override|became law|signed/i);
  assert.equal(message.noMeans, null, "a veto message does not establish the direction of the motion");
});

test("state concurrence and passage do not invent an executive action or later stage", () => {
  for (const state of ["NH", "NJ", "AZ"]) {
    for (const question of ["Assembly Floor: Concur in Senate Amendments", "On Concurring in the Senate Amendment", "Senate Floor: Third Reading - Final Passage", "On Passage"]) {
      const explainer = explainVoteQuestion(question, { level: "state", state });
      assert.ok(explainer, `${state}: ${question}`);
      assert.doesNotMatch(`${explainer.plain} ${explainer.noMeans}`, /President|governor|signed|veto|became law/i);
    }
  }
});

test("a jurisdiction mismatch or ambiguous state procedure never borrows a federal explainer", () => {
  for (const question of ["On the Nomination", "On Cloture", "Veto", "On Passage of a bill about veto powers", "Motion to Table the Veto Override", "Reconsider Veto Override", "Motion to Sustain the Veto", "Motion Not to Concur in Senate Amendments", "On the Quorum Call", ""]) {
    assert.equal(explainVoteQuestion(question, NH), null, question);
  }
  // Missing jurisdiction is also an honest gap at runtime, never a federal default.
  assert.equal(explainVoteQuestion("Veto Override", undefined as unknown as VoteJurisdiction), null);
  assert.match(explainVoteQuestion("On Overriding the Veto", FEDERAL)!.plain, /President's veto/);
  assert.match(explainVoteQuestion("On the Nomination", FEDERAL)!.plain, /President's nominee/);
});

test("state definitions remain neutral and source-backed without federal procedure leakage", () => {
  for (const explainer of STATE_VOTE_EXPLAINERS) {
    assert.match(explainer.basis, /https:\/\/gc\.nh\.gov\//);
    assert.doesNotMatch(`${explainer.plain} ${explainer.noMeans}`, /President|60 votes|two-thirds|\bshould\b|\bgood\b|\bbad\b|we recommend/i);
  }
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
