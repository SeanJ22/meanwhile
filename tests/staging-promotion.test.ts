import assert from "node:assert/strict";
import test from "node:test";

import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";
import {
  NEVER_EVALUATED,
  PROMOTION_REFUSALS,
  REFUSAL_EXPLANATIONS,
  evaluatePromotion,
  explainPromotion,
  type GateRecordSource,
  type PromotionInput,
  type PromotionRefusal,
  type StagingGateRecord,
} from "../lib/ops/staging-promotion.ts";

/**
 * RULING 233 — THE NEGATIVE CONTROLS FOR PROMOTION.
 *
 * Every test below plants a state in which the naive gate — *did staging go
 * green?* — answers yes and the promotion is unsafe. The defect being guarded
 * against is never a crash; it is a green that was about something else: an
 * earlier commit, a stale deploy, or the production database.
 *
 * The eligible case is proved too, and deliberately first. A gate that refuses
 * everything is not a gate, and a mechanism whose passing branch is never
 * exercised is one whose passing branch has never been shown to exist.
 */

const HEAD = "1111111111111111111111111111111111111111";
const OLDER = "2222222222222222222222222222222222222222";
const MAIN = "3333333333333333333333333333333333333333";

/** A record that is green in every respect, for the exact head. */
const GREEN: StagingGateRecord = {
  formatVersion: 1,
  stagingSha: HEAD,
  deployedSha: HEAD,
  observedAt: "2026-09-01T12:00:00.000Z",
  suite: "PASS",
  visual: "PASS",
  walk: "PASS",
  requiredChecks: "PASS",
  databaseRole: "staging",
  freezeClear: true,
  detail: "Staging gate green against the staging branch database.",
};

function withRecord(record: StagingGateRecord): GateRecordSource {
  return { kind: "RECORD", record };
}

/** The eligible input, which every refusal test perturbs by exactly one field. */
function eligibleInput(over: Partial<PromotionInput> = {}): PromotionInput {
  return {
    gate: withRecord(GREEN),
    stagingHeadSha: HEAD,
    mainSha: MAIN,
    ancestry: "ancestor",
    ...over,
  };
}

/** Refuse for exactly one named reason, and prove it is the only one. */
function refusesOnly(input: PromotionInput, expected: PromotionRefusal): void {
  const v = evaluatePromotion(input);
  assert.equal(v.eligible, false, `expected ${expected}, got an eligible verdict: ${v.reason}`);
  assert.deepEqual([...v.refusals], [expected]);
}

/* ========================================================================== */
/* The passing branch                                                         */
/* ========================================================================== */

test("a green record for the exact head, on staging's database, is ELIGIBLE", () => {
  const v = evaluatePromotion(eligibleInput());
  assert.equal(v.eligible, true, v.reason);
  assert.deepEqual([...v.refusals], []);
  assert.equal(v.stagingSha, HEAD);
  assert.equal(v.mainSha, MAIN);
  assert.match(v.reason, /Promotion permitted/);
});

test("eligible is DERIVED from the refusal list, never asserted beside it", () => {
  // If these two could ever disagree, every other test in this file would be
  // asserting on a field that is not the one the caller acts on.
  for (const input of [eligibleInput(), eligibleInput({ ancestry: "not-ancestor" })]) {
    const v = evaluatePromotion(input);
    assert.equal(v.eligible, v.refusals.length === 0);
  }
});

test("an abbreviated sha in the record still matches the full head", () => {
  /*
   * `sameCommit` is prefix-tolerant with a seven character floor, and this is
   * the case it exists for: a record written with `git rev-parse --short`
   * against a head read as forty characters is the SAME commit, and reporting
   * STALE_HEAD for it would be a false refusal on the mechanism's first real
   * use — the failure direction that gets a gate switched off rather than fixed.
   */
  const v = evaluatePromotion(
    eligibleInput({
      gate: withRecord({ ...GREEN, stagingSha: HEAD.slice(0, 8), deployedSha: HEAD.slice(0, 8) }),
    }),
  );
  assert.equal(v.eligible, true, v.reason);
});

/* ========================================================================== */
/* One refusal per code                                                       */
/* ========================================================================== */

test("NO_GATE_RECORD — an absent record is not a passing one", () => {
  refusesOnly(
    eligibleInput({ gate: { kind: "MISSING", how: "no file at data/ops/staging-gate.json" } }),
    "NO_GATE_RECORD",
  );
});

test("GATE_RECORD_UNREADABLE — a failed read is not an empty document", () => {
  refusesOnly(
    eligibleInput({ gate: { kind: "UNREADABLE", how: "Unexpected token } in JSON at position 12" } }),
    "GATE_RECORD_UNREADABLE",
  );
});

test("NO_GATE_RECORD and GATE_RECORD_UNREADABLE are never the same refusal", () => {
  // They lead to different repairs — run the gate, versus fix the file — and a
  // gate that reports them identically has thrown away the difference.
  const missing = evaluatePromotion(eligibleInput({ gate: { kind: "MISSING", how: "x" } }));
  const unreadable = evaluatePromotion(eligibleInput({ gate: { kind: "UNREADABLE", how: "x" } }));
  assert.notDeepEqual([...missing.refusals], [...unreadable.refusals]);
});

test("STALE_HEAD — a green about an earlier commit is not a green about this one", () => {
  /*
   * THE WHOLE POINT OF THE RULE. The suite really did pass, against a real
   * commit, on the staging database. Two commits then landed. Nothing has
   * measured them, and the record cannot tell the difference on its own.
   */
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, stagingSha: OLDER, deployedSha: HEAD }) }),
    "STALE_HEAD",
  );
});

test("STALE_HEAD — an unmeasurable staging head never counts as a match", () => {
  const v = evaluatePromotion(eligibleInput({ stagingHeadSha: null, ancestry: "unknown" }));
  assert.equal(v.eligible, false);
  assert.ok(v.refusals.includes("STALE_HEAD"));
  assert.equal(v.stagingSha, null);
});

test("DEPLOY_BEHIND_HEAD — a green suite against a stale deploy proves nothing", () => {
  /*
   * The record is about the right commit. The HOST was serving the previous
   * build when it was asked, so every assertion passed and not one of them
   * touched the code being promoted. This is why the record carries two shas.
   */
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, stagingSha: HEAD, deployedSha: OLDER }) }),
    "DEPLOY_BEHIND_HEAD",
  );
});

test("SUITE_RED — and NOT_RUN is refused identically to FAIL", () => {
  refusesOnly(eligibleInput({ gate: withRecord({ ...GREEN, suite: "FAIL" }) }), "SUITE_RED");
  refusesOnly(eligibleInput({ gate: withRecord({ ...GREEN, suite: "NOT_RUN" }) }), "SUITE_RED");
});

test("VISUAL_RED — and NOT_RUN is refused identically to FAIL", () => {
  refusesOnly(eligibleInput({ gate: withRecord({ ...GREEN, visual: "FAIL" }) }), "VISUAL_RED");
  refusesOnly(eligibleInput({ gate: withRecord({ ...GREEN, visual: "NOT_RUN" }) }), "VISUAL_RED");
});

test("WALK_RED — and NOT_RUN is refused identically to FAIL", () => {
  refusesOnly(eligibleInput({ gate: withRecord({ ...GREEN, walk: "FAIL" }) }), "WALK_RED");
  refusesOnly(eligibleInput({ gate: withRecord({ ...GREEN, walk: "NOT_RUN" }) }), "WALK_RED");
});

test("REQUIRED_CHECKS_NOT_GREEN — the ruleset's own gate, measured here too", () => {
  /*
   * `main` is protected by a RULESET (id 21572280), not classic branch
   * protection, and it requires three literal contexts strictly. This refusal
   * exists so the red is found BEFORE a pull request is opened — and it is a
   * SECOND gate under the freeze, never a substitute: the ruleset knows nothing
   * about which database the run reached.
   */
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, requiredChecks: "FAIL" }) }),
    "REQUIRED_CHECKS_NOT_GREEN",
  );
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, requiredChecks: "NOT_RUN" }) }),
    "REQUIRED_CHECKS_NOT_GREEN",
  );
});

test("WRONG_DATABASE — green against production is worse than red", () => {
  /*
   * It proved production still works. It proved nothing about the staging
   * schema, and it wrote reader-shaped rows into the store that gets sold. A
   * red run gets investigated; this one gets promoted.
   */
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, databaseRole: "production" }) }),
    "WRONG_DATABASE",
  );
});

test("WRONG_DATABASE — 'unknown' is refused exactly as 'production' is", () => {
  // A run that cannot say which database it touched has not established that it
  // touched the staging one. "Probably staging" is not a measurement.
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, databaseRole: "unknown" }) }),
    "WRONG_DATABASE",
  );
});

test("FREEZE_NOT_CLEAR — including the case where nothing asked", () => {
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, freezeClear: false }) }),
    "FREEZE_NOT_CLEAR",
  );
  // `null` is "never established", and an unasked question is not a passing
  // answer. This is the `!== true` rather than `=== false` decision, tested.
  refusesOnly(
    eligibleInput({ gate: withRecord({ ...GREEN, freezeClear: null }) }),
    "FREEZE_NOT_CLEAR",
  );
});

test("NOT_FAST_FORWARD — main carries something staging never tested", () => {
  refusesOnly(eligibleInput({ ancestry: "not-ancestor" }), "NOT_FAST_FORWARD");
});

test("NOT_FAST_FORWARD — 'unknown' ancestry is refused, never assumed", () => {
  // `git merge-base --is-ancestor` answers with an exit code, and anything but
  // 0 or 1 means git could not say. A failed measurement is not a history.
  refusesOnly(eligibleInput({ ancestry: "unknown" }), "NOT_FAST_FORWARD");
});

test("UNKNOWN_FORMAT_VERSION — a shape this reader predates is never assumed compatible", () => {
  /*
   * The record is green in every field. The fields are NOT read, because
   * reading `suite: "PASS"` out of a shape written by a future writer and
   * treating it as this evaluator's PASS is exactly the act `formatVersion`
   * exists to prevent.
   */
  const future = { ...GREEN, formatVersion: 2 };
  const v = evaluatePromotion(eligibleInput({ gate: { kind: "RECORD", record: future } }));
  assert.equal(v.eligible, false);
  assert.deepEqual([...v.refusals], ["UNKNOWN_FORMAT_VERSION"]);
  assert.ok(!v.refusals.includes("SUITE_RED"), "an unknown shape's fields are not interpreted");
});

/* ========================================================================== */
/* Collection, not short-circuit                                              */
/* ========================================================================== */

test("every refusal is collected, so one read shows the whole work order", () => {
  /*
   * The failure this prevents is procedural rather than technical: fixing
   * SUITE_RED, re-running, and only then discovering WRONG_DATABASE turns a
   * five-minute repair into four round trips.
   */
  const v = evaluatePromotion({
    gate: withRecord({
      ...GREEN,
      stagingSha: OLDER,
      deployedSha: OLDER,
      suite: "FAIL",
      visual: "NOT_RUN",
      walk: "FAIL",
      requiredChecks: "FAIL",
      databaseRole: "production",
      freezeClear: false,
    }),
    stagingHeadSha: HEAD,
    mainSha: MAIN,
    ancestry: "not-ancestor",
  });
  assert.equal(v.eligible, false);
  assert.deepEqual(
    [...v.refusals].sort(),
    [
      "DEPLOY_BEHIND_HEAD",
      "FREEZE_NOT_CLEAR",
      "NOT_FAST_FORWARD",
      "REQUIRED_CHECKS_NOT_GREEN",
      "STALE_HEAD",
      "SUITE_RED",
      "VISUAL_RED",
      "WALK_RED",
      "WRONG_DATABASE",
    ].sort(),
  );
});

test("an unusable record still gets the ancestry refusal beside it", () => {
  // Ancestry is a fact about git that the record has no bearing on, so it is
  // still measured. That is the difference between "nothing to measure it
  // from" and "gave up".
  const v = evaluatePromotion(
    eligibleInput({ gate: { kind: "MISSING", how: "none" }, ancestry: "not-ancestor" }),
  );
  assert.deepEqual([...v.refusals].sort(), ["NOT_FAST_FORWARD", "NO_GATE_RECORD"].sort());
});

/* ========================================================================== */
/* The vocabulary itself                                                      */
/* ========================================================================== */

test("the never-evaluated default is deliberately not green", () => {
  const v = evaluatePromotion({
    gate: withRecord(NEVER_EVALUATED),
    stagingHeadSha: HEAD,
    mainSha: MAIN,
    ancestry: "ancestor",
  });
  assert.equal(v.eligible, false);
  // Every arm, both shas, the database and the freeze — all refused at once.
  for (const code of [
    "STALE_HEAD",
    "DEPLOY_BEHIND_HEAD",
    "SUITE_RED",
    "VISUAL_RED",
    "WALK_RED",
    "REQUIRED_CHECKS_NOT_GREEN",
    "WRONG_DATABASE",
    "FREEZE_NOT_CLEAR",
  ] as const) {
    assert.ok(v.refusals.includes(code), `NEVER_EVALUATED must refuse ${code}`);
  }
});

test("every refusal code carries an explanation, and every one is printed", () => {
  // A code with no explanation is a gate that tells its reader a name and
  // leaves them to read the source to act on it.
  for (const code of PROMOTION_REFUSALS) {
    const explanation = REFUSAL_EXPLANATIONS[code];
    assert.equal(typeof explanation, "string");
    assert.ok(explanation.length > 40, `${code} needs a real explanation, not a restatement`);
  }
  const printed = explainPromotion(
    evaluatePromotion(eligibleInput({ gate: { kind: "MISSING", how: "none" }, ancestry: "unknown" })),
  );
  assert.match(printed, /PROMOTION REFUSED/);
  assert.match(printed, /NO_GATE_RECORD/);
  assert.match(printed, /NOT_FAST_FORWARD/);
  assert.ok(printed.includes(REFUSAL_EXPLANATIONS.NO_GATE_RECORD));
});

test("the eligible verdict prints as eligible and lists nothing to fix", () => {
  const printed = explainPromotion(evaluatePromotion(eligibleInput()));
  assert.match(printed, /PROMOTION ELIGIBLE/);
  for (const code of PROMOTION_REFUSALS) assert.ok(!printed.includes(code), `${code} was printed`);
});

test("the required contexts are the imported ones, never re-typed here", () => {
  // RULING 156: the ruleset matches these as literal strings, so a second copy
  // is a second place for a rename to disagree — and a required context that
  // never arrives is not a blocked merge, it is nothing to wait for.
  assert.ok(REQUIRED_CONTEXTS.length >= 3);
  assert.ok(
    REFUSAL_EXPLANATIONS.REQUIRED_CHECKS_NOT_GREEN.includes(REQUIRED_CONTEXTS[0] as string),
    "the explanation names the contexts it is about, from the one list that holds them",
  );
});
