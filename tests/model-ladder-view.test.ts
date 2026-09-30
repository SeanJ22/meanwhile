/**
 * **THE MODEL LADDER'S WORDS ON ADMIN.** (MW-031, MW-033, 2026-09-25.)
 *
 * Fleet · Money says how many model escalations are on record, and a zero says
 * why it is a zero; an assignment's standing view can say which class a Scout
 * started on, why, and — for an escalated one — the evidence and the combined
 * cost. Pure: fixtures in, sentences out.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ESCALATION_REASON_WORDS,
  ESCALATION_REFUSAL_WORDS,
  escalationSentence,
  ladderHeadline,
  scoutModelLine,
  type LadderFacts,
} from "../lib/control-plane/admin-view/model-ladder-view.ts";
import { MODEL_ESCALATION_REASONS, MODEL_ESCALATION_REFUSALS } from "../lib/control-plane/scheduler/model-routing.ts";

/** The last paid charge before the owner's pause: 2026-09-22 13:06 MST. */
const LAST_PAID = "2026-09-22T20:06:00.000Z";
const BEFORE_ONLY: LadderFacts = { startedOn: [{ modelClass: "BEFORE_LADDER", attempts: 2166 }], escalated: 0, escalationsRefused: 0, latest: [] };

test("a zero is honest: with paid research paused it says since when; with nothing run under the ladder, or nothing needing to move up, it says that", () => {
  assert.equal(ladderHeadline({ ladder: BEFORE_ONLY, lastPaidAt: LAST_PAID, pausedByOwner: true }), "Escalations recorded: 0 (paid research paused since Sep 22).");
  assert.equal(
    ladderHeadline({ ladder: BEFORE_ONLY, lastPaidAt: LAST_PAID, pausedByOwner: false }),
    "Escalations recorded: 0 (no paid Scout has run since the ladder was switched on; the last paid charge was Sep 22).",
  );
  const ran: LadderFacts = { ...BEFORE_ONLY, startedOn: [...BEFORE_ONLY.startedOn, { modelClass: "sonnet", attempts: 12 }] };
  assert.equal(ladderHeadline({ ladder: ran, lastPaidAt: LAST_PAID, pausedByOwner: null }), "Escalations recorded: 0 (12 paid Scout attempts started on the cheaper class and none needed to move up).");
  assert.equal(ladderHeadline({ ladder: null, lastPaidAt: LAST_PAID, pausedByOwner: true }), "Escalations recorded: not read — the Scout results were not read, which is not the same as none.");
});

test("an escalation on record reads as the classes by name, the reason, the evidence, and what both tries cost together and each", () => {
  const ladder: LadderFacts = {
    startedOn: [{ modelClass: "sonnet", attempts: 40 }],
    escalated: 3,
    escalationsRefused: 1,
    latest: [
      {
        at: "2026-10-01T17:30:00.000Z",
        obligationId: "freshness:x",
        subjectId: "ocd-division/country:us/state:az/place:x",
        from: "sonnet",
        fromModel: "claude-sonnet-5",
        to: "frontier",
        toModel: "claude-opus-5-5",
        reason: "RESULT_REFUSED",
        evidence: "finish refused after 4 turn(s): SCOUT_CANDIDATE_WITHOUT_EVIDENCE",
        refused: null,
        attemptsUsd: [0.0124, 0.0305],
        combinedUsd: 0.0429,
      },
    ],
  };
  const line = ladderHeadline({ ladder, lastPaidAt: LAST_PAID, pausedByOwner: false });
  assert.equal(
    line,
    "Escalations recorded: 3. 1 more was called for and refused. Latest: A Scout moved from Claude Sonnet 5.5 to Claude Opus 5.5 on Oct 1 because its answer failed our checks and was never fixed " +
      "(finish refused after 4 turn(s): SCOUT_CANDIDATE_WITHOUT_EVIDENCE); both tries together cost $0.0429 ($0.0124 + $0.0305).",
  );
  const refused = escalationSentence({ ...ladder.latest[0], to: null, refused: "CEILING", reason: "NO_TYPED_RESULT", evidence: null, attemptsUsd: [0.0093], combinedUsd: 0.0093 });
  assert.equal(refused, "A Scout stayed on Claude Sonnet 5.5 on Oct 1 although it stopped without giving an answer, because the spending ceiling could not cover a second try; it cost $0.0093.");
  const unmeasured = escalationSentence({ ...ladder.latest[0], combinedUsd: null, attemptsUsd: [null, 0.03] });
  assert.match(unmeasured, /both tries together cost an unmeasured amount \(an unmeasured amount \+ \$0\.0300\)/, "an unmeasured cost is never shown as $0");
  assert.match(escalationSentence({ ...ladder.latest[0], fromModel: null, toModel: null }), /the sonnet class \(exact model not recorded\)/,
    "class-only history cannot be relabeled with today's active Sonnet version");
  assert.match(escalationSentence({ ...ladder.latest[0], fromModel: "claude-sonnet-5-5" }), /Claude Sonnet 5\.5/);
});

test("every recorded reason and every refusal has owner words — the closed lists and the words cannot drift apart", () => {
  assert.deepEqual(Object.keys(ESCALATION_REASON_WORDS).sort(), [...MODEL_ESCALATION_REASONS].sort());
  assert.deepEqual(Object.keys(ESCALATION_REFUSAL_WORDS).sort(), [...MODEL_ESCALATION_REFUSALS].sort());
});

test("one Scout result for an assignment's standing view: the class chosen, why, and for an escalated one the evidence and combined cost; a result before the ladder says it started at the top by the rule of the day", () => {
  const common = { worker: { provider: "anthropic", model: "claude-opus-5-5", modelReported: "claude-opus-5-5" }, startedAt: "2026-10-01T17:30:00.000Z", obligationId: "o", subjectId: "s" };
  const before = scoutModelLine({ ...common, worker: { ...common.worker, model: "claude-opus-5" }, usd: 0.41 });
  assert.equal(before.chosen, "Claude Opus 5");
  assert.match(before.why, /Recorded before the ladder \(2026-09-25\)/);
  assert.equal(before.escalation, null);

  const why = "Sonnet 5 is the cheapest class that accepts this loop's request";
  const stayed = scoutModelLine({ ...common, worker: { ...common.worker, model: "claude-sonnet-5-5" }, usd: 0.01, modelClass: "sonnet", modelClassWhy: why, escalatedFrom: null, escalationReason: null, escalationEvidence: null, escalationRefused: null, modelAttempts: [{ modelClass: "sonnet", model: "claude-sonnet-5-5", turns: 3, usd: 0.01, accepted: true }] });
  assert.deepEqual(stayed, { chosen: "Claude Sonnet 5.5", why, escalation: null });

  const moved = scoutModelLine({
    ...common,
    usd: 0.0429,
    modelClass: "frontier",
    modelClassWhy: why,
    escalatedFrom: "sonnet",
    escalationReason: "BOUND_EXHAUSTED_WITHOUT_RESULT",
    escalationEvidence: "the turn bound (18) is reached; no typed result in 20 turn(s) including 2 grace turn(s)",
    escalationRefused: null,
    modelAttempts: [
      { modelClass: "sonnet", model: "claude-sonnet-5-5", turns: 20, usd: 0.0124, accepted: false },
      { modelClass: "frontier", model: "claude-opus-5-5", turns: 2, usd: 0.0305, accepted: true },
    ],
  });
  assert.equal(moved.chosen, "Claude Sonnet 5.5", "the class CHOSEN is the one it started on, not the one it ended on");
  assert.equal(moved.why, why);
  assert.equal(
    moved.escalation,
    "A Scout moved from Claude Sonnet 5.5 to Claude Opus 5.5 on Oct 1 because it used up its turns without a usable answer (the turn bound (18) is reached; no typed result in 20 turn(s) including 2 grace turn(s)); both tries together cost $0.0429 ($0.0124 + $0.0305).",
  );
});
