import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ASK_CHALLENGER_MODEL,
  ASK_INCUMBENT_MODEL,
  ASK_MODEL_RATES,
  rateRatio,
  relativeNonRegressionAnalysis,
  switchVerdict,
  type QuestionRun,
} from "../lib/ask/model-economics.ts";
import { comparabilityFailure } from "../lib/ask/model-comparison.ts";
import { ASK_SYNTHESIS_MODEL } from "../lib/ask/synthesize.ts";

/**
 * **H2 — ASK MODEL ECONOMICS, UNDER RULING 230.** (Session C, lane B, amended
 * 2026-09-01.)
 *
 * The decision rule is the thing under test here, not the models. A comparison
 * that cannot run must reach NO SWITCH, and it must reach it for the right
 * reason — the criterion is unmet, which is different from the challenger
 * having been tried and lost.
 *
 * **What changed on 2026-09-01, and why these tests are not the old ones.**
 * This file used to assert the RELATIVE rule — *a question the incumbent
 * already failed does not block the switch* — and `tests/ask-model-comparison.test.ts`
 * asserted the ABSOLUTE one. Two green suites, encoding two rules that derive
 * opposite outcomes on the same data, which is exactly what the 2026-08-31 run
 * record then wrote down: `decision: RETAIN`, `ownerCriterionMet: false`, and
 * `verdict.kind: "SWITCH"`, in one file.
 *
 * RULING 230 makes the absolute rule the only verdict. The relative reading is
 * kept as a DIAGNOSTIC with its own type, and the test that used to preserve
 * the disagreement is replaced below by the seeded case that names it:
 * **both arms failing one question yields HOLD/RETAIN, never SWITCH.**
 */

test("H2: ONE MODEL FOR ALL ASK TRAFFIC — every Ask call site names the same model", () => {
  /*
   * Read off the source, because the rule is about what the product RUNS. A
   * per-caller or per-question model would also shard the prompt cache, which
   * is model-scoped, and forfeit every hit H1 exists to earn.
   */
  const root = process.cwd();

  /*
   * **STRUCTURAL, NOT FOUR LITERALS AGREEING.** (ITEM K, 2026-09-01.)
   *
   * This test used to read every `"claude-…"` literal out of the four call
   * sites and assert they were equal. That checks the rule and does not
   * ENFORCE it: four literals are four places to forget, and the test passes
   * right up until the moment someone changes three of them. ITEM K had to
   * change all four and met exactly that.
   *
   * So the shape is inverted. ONE module declares the model; the call sites
   * declare none and import it. A call site that reintroduces a literal fails
   * here whatever value it picks — including the right one — because the
   * defect is the second declaration, not the disagreement it will later cause.
   */
  const DECLARING_MODULE = "lib/ask/model.ts";
  const sites = [
    "lib/ask/synthesize.ts",
    "lib/ask/interpret.ts",
    "lib/routing/classifier.ts",
    "lib/routing/unsourced-fallback.ts",
  ];

  /* Only a model ID in DOUBLE QUOTES counts as a declaration. Prose naming a
     model in backticks is documentation, and a guard that reads its own
     comments as the defect is a guard that gets loosened. */
  const declarations = (path: string) =>
    [...readFileSync(join(root, path), "utf8").matchAll(/"(claude-[a-z0-9-]+)"/g)].map(
      (m) => m[1],
    );

  const declared = declarations(DECLARING_MODULE);
  assert.deepEqual(
    declared,
    [ASK_INCUMBENT_MODEL],
    `${DECLARING_MODULE} must declare the Ask model exactly once and declare no other`,
  );

  for (const site of sites) {
    assert.deepEqual(
      declarations(site),
      [],
      `${site} declares a model literal; the Ask model is declared once, in ${DECLARING_MODULE}`,
    );
    assert.match(
      readFileSync(join(root, site), "utf8"),
      /ASK_SYNTHESIS_MODEL/,
      `${site} is an Ask call site and must read the shared model constant`,
    );
  }
});

test("H2: the incumbent is read from the code, never from a constant that can drift", () => {
  assert.equal(ASK_INCUMBENT_MODEL, ASK_SYNTHESIS_MODEL);
  /*
   * ITEM K, 2026-09-01: the owner ruled the switch from `claude-opus-5`.
   * Pinned deliberately — a model ID that can change without a test changing
   * is a model ID that can change without anyone noticing, and every stored
   * answer's provenance depends on knowing which one shipped.
   */
  assert.equal(ASK_SYNTHESIS_MODEL, "claude-sonnet-5");
});

test("H2: both candidates' rates carry a date and a source", () => {
  for (const model of [ASK_INCUMBENT_MODEL, ASK_CHALLENGER_MODEL]) {
    const rate = ASK_MODEL_RATES[model];
    assert.ok(rate, `no published rate recorded for ${model}`);
    assert.equal(rate.model, model);
    assert.ok(rate.inputUsdPerMillion > 0 && rate.outputUsdPerMillion > 0);
    assert.match(rate.statedOn, /^\d{4}-\d{2}-\d{2}$/, "a price with no date is uncheckable");
    assert.ok(rate.source.length > 20, "a price with no source is a price somebody remembered");
  }
});

test("the published rate ratio is 0.4x both ways — the arms swapped when the switch landed", () => {
  /*
   * ITEM K, 2026-09-01. This asserted 2.5x when the incumbent was Opus 5 and
   * the challenger was Sonnet 5. Both constants moved: the incumbent is now
   * Sonnet 5 and the standing comparison arm is Opus 5, the revert target. The
   * ratio is therefore the reciprocal, and asserting it in the new direction
   * is what proves the two constants actually swapped rather than one of them
   * being changed and the other forgotten.
   *
   * `rateRatio` is incumbent-over-challenger, so 2/5 and 10/25 = 0.4. The
   * product now runs the cheaper of the two arms per token, which is the
   * direction of the switch — and never the reason for it.
   */
  const ratio = rateRatio(
    ASK_MODEL_RATES[ASK_INCUMBENT_MODEL],
    ASK_MODEL_RATES[ASK_CHALLENGER_MODEL],
  );
  assert.equal(ratio.input, 0.4);
  assert.equal(ratio.output, 0.4);
  assert.ok(ratio.input < 1, "the incumbent must be the cheaper arm after the ITEM K switch");
});

/* ── the verdict ─────────────────────────────────────────────────────────── */

const RAN = (id: string, model: string, held: boolean): QuestionRun => ({
  questionId: id,
  model,
  held,
  ms: 1000,
  usd: 0.01,
});

const NEVER_RAN = (id: string, model: string): QuestionRun => ({
  questionId: id,
  model,
  held: null,
  ms: null,
  usd: null,
});

test("H2: a comparison that never ran is NOT_MEASURED, and NOT_MEASURED is never a switch", () => {
  /*
   * **THE CASE THIS SESSION IS ACTUALLY IN.** No credential reached this
   * worktree, so no question ran on either model. The verdict must be
   * NOT_MEASURED — the obligation stays live — and it must not quietly become
   * either a switch or a finding against the challenger.
   */
  const verdict = switchVerdict(
    [NEVER_RAN("Q2", ASK_INCUMBENT_MODEL)],
    [NEVER_RAN("Q2", ASK_CHALLENGER_MODEL)],
    "ANTHROPIC_API_KEY absent",
  );
  assert.equal(verdict.kind, "NOT_MEASURED");
  assert.notEqual(verdict.kind, "SWITCH");
  assert.deepEqual(
    verdict.kind === "NOT_MEASURED" ? [...verdict.unmeasured] : [],
    [`Q2@${ASK_INCUMBENT_MODEL}`, `Q2@${ASK_CHALLENGER_MODEL}`],
  );
});

test("H2: an empty challenger set is NOT_MEASURED, never a vacuous SWITCH", () => {
  /* Zero questions all holding is the classic vacuous truth, and it would read
     as a clean sweep. It is refused by name. */
  const verdict = switchVerdict([RAN("Q2", ASK_INCUMBENT_MODEL, true)], [], "nothing ran");
  assert.equal(verdict.kind, "NOT_MEASURED");
});

test("H2: ONE question not holding blocks the switch, however many held", () => {
  const incumbent = ["Q2", "Q3", "Q4", "Q5"].map((id) => RAN(id, ASK_INCUMBENT_MODEL, true));
  const challenger = [
    RAN("Q2", ASK_CHALLENGER_MODEL, true),
    RAN("Q3", ASK_CHALLENGER_MODEL, true),
    RAN("Q4", ASK_CHALLENGER_MODEL, false),
    RAN("Q5", ASK_CHALLENGER_MODEL, true),
  ];
  const verdict = switchVerdict(incumbent, challenger, "");
  assert.equal(verdict.kind, "HOLD");
  assert.deepEqual(verdict.kind === "HOLD" ? [...verdict.notHolding] : [], ["Q4"]);
});

test("H2: every question holding is the ONLY path to a switch", () => {
  const incumbent = ["Q2", "Q3"].map((id) => RAN(id, ASK_INCUMBENT_MODEL, true));
  const challenger = ["Q2", "Q3"].map((id) => RAN(id, ASK_CHALLENGER_MODEL, true));
  const verdict = switchVerdict(incumbent, challenger, "");
  assert.equal(verdict.kind, "SWITCH");
  assert.equal(verdict.kind === "SWITCH" && verdict.to, ASK_CHALLENGER_MODEL);
});

test("RULING 230 seeded: BOTH ARMS FAILING one question yields HOLD, never SWITCH", () => {
  /*
   * **THE 2026-08-31 MEASUREMENT, SEEDED.** Q5 failed on BOTH arms — an
   * 18-record pack against the ASK-19 700-character budget — and Q3 held on
   * the challenger where the incumbent failed it. The superseded relative rule
   * saw no DEGRADATION and derived SWITCH from exactly this shape, which is how
   * the run record came to say SWITCH and RETAIN at once.
   *
   * RULING 230: a question that does not hold on the challenger blocks the
   * switch whatever the incumbent did with it. A question neither model answers
   * is a real unanswered reader question, and a switch taken while one is open
   * is a switch taken on a comparison that never finished.
   */
  const incumbent = [
    RAN("Q2", ASK_INCUMBENT_MODEL, true),
    RAN("Q3", ASK_INCUMBENT_MODEL, false),
    RAN("Q4", ASK_INCUMBENT_MODEL, true),
    RAN("Q5", ASK_INCUMBENT_MODEL, false),
  ];
  const challenger = [
    RAN("Q2", ASK_CHALLENGER_MODEL, true),
    RAN("Q3", ASK_CHALLENGER_MODEL, true),
    RAN("Q4", ASK_CHALLENGER_MODEL, true),
    RAN("Q5", ASK_CHALLENGER_MODEL, false),
  ];

  const verdict = switchVerdict(incumbent, challenger, "the 2026-08-31 shape");
  assert.equal(verdict.kind, "HOLD", "both-arms-fail must never derive a switch");
  assert.notEqual(verdict.kind, "SWITCH");
  assert.deepEqual(verdict.kind === "HOLD" ? [...verdict.notHolding] : [], ["Q5"]);

  /* And the diagnostic still says the useful thing — which is why it survives
     — while being incapable of expressing a switch. */
  const relative = relativeNonRegressionAnalysis(incumbent, challenger);
  assert.equal(relative.kind, "NO_DEGRADATION");
  assert.deepEqual([...relative.bothArmsFailed], ["Q5"]);
  assert.deepEqual([...relative.degraded], []);
  assert.equal(relative.isNotASwitchVerdict, true);
  /* No switch-shaped member, checked over the VALUE rather than the type — the
     compiler already refuses `relative.kind === "SWITCH"` as an impossible
     comparison, which is the structural half of the same guarantee. */
  const members = Object.keys(relative);
  assert.ok(!members.includes("to"), "the diagnostic must carry no target model");
  assert.ok(
    !["SWITCH", "HOLD", "NOT_MEASURED"].includes(relative.kind),
    `the diagnostic's kind is ${relative.kind}; it must not reuse a verdict name`,
  );
});

/* ── RULING 230's structural half ────────────────────────────────────────── */

function sourceFilesUnder(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) out.push(...sourceFilesUnder(rel, root));
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(rel);
  }
  return out;
}

test("RULING 230: exactly ONE function in the repository returns a switch verdict", () => {
  /*
   * The ruling's second clause — *no second function may emit a
   * `SwitchVerdict`* — asserted rather than described. Read off the SOURCE,
   * over the shipped tree, because the failure this forbids is a well-meaning
   * second derivation added beside the first, which is exactly how the
   * contradiction arose the first time.
   *
   * The pattern is the RETURN ANNOTATION, so a type import or a mention in
   * prose does not count as an emitter and does not have to be worked around.
   */
  const root = process.cwd();
  const emitters: string[] = [];
  const annotation = new RegExp("\\)\\s*:\\s*" + "SwitchVerdict" + "\\b");
  for (const dir of ["lib", "scripts", "app", "components"]) {
    for (const file of sourceFilesUnder(dir, root)) {
      if (annotation.test(readFileSync(join(root, file), "utf8"))) emitters.push(file);
    }
  }
  assert.deepEqual(
    emitters,
    ["lib/ask/model-economics.ts"],
    `a switch verdict is emitted from ${emitters.length} place(s); RULING 230 allows one`,
  );
});

/* ========================================================================== */
/* The silent denominator — a question that could not be compared             */
/* ========================================================================== */

/*
 * ITEM K's own effort sweep found this and reported it rather than working
 * around it: the harness FILTERED incomparable rows out before deriving a
 * verdict, so `xhigh` emitted SWITCH over three surviving rows and `max` over
 * ONE, and the record said `questions: 1` as though a one-question sweep had
 * been the plan. RULING 230's guard was in place and could not fire, because
 * the questions never reached it.
 *
 * These are the assertions that would have caught it. They are written against
 * the SHARED rule rather than against the harness's private copy, because a
 * private copy is how the two drift back apart (RULING 103).
 */

test("a question that reached neither arm is NOT MEASURED, not absent", () => {
  const why = comparabilityFailure({
    packsIdentical: true,
    incumbentRanCount: 0,
    challengerRanCount: 0,
    incumbentModel: "model-a",
    challengerModel: "model-b",
  });
  assert.ok(why, "a question no pass completed on must give a reason, not null");
  assert.match(why, /never put to either arm/);
});

test("a question that reached only one arm names THAT arm", () => {
  const onlyChallenger = comparabilityFailure({
    packsIdentical: true,
    incumbentRanCount: 0,
    challengerRanCount: 3,
    incumbentModel: "model-a",
    challengerModel: "model-b",
  });
  assert.ok(onlyChallenger);
  assert.match(onlyChallenger, /model-a/);
  assert.doesNotMatch(onlyChallenger, /model-b/);
  assert.match(onlyChallenger, /never put to that arm/);
});

test("differing evidence packs void the comparison, and say why", () => {
  const why = comparabilityFailure({
    packsIdentical: false,
    incumbentRanCount: 3,
    challengerRanCount: 3,
    incumbentModel: "model-a",
    challengerModel: "model-b",
  });
  assert.ok(why);
  assert.match(why, /not attributable to the model/);
});

test("a comparable question returns null — the rule refuses nothing it should not", () => {
  assert.equal(
    comparabilityFailure({
      packsIdentical: true,
      incumbentRanCount: 3,
      challengerRanCount: 3,
      incumbentModel: "model-a",
      challengerModel: "model-b",
    }),
    null,
  );
});

test("carrying an incomparable question as unmeasured REFUSES the vacuous switch", () => {
  /*
   * The defect, reproduced end to end. Six questions attempted; five reached
   * neither arm; the one that ran held on the challenger.
   *
   * Under the filter, `switchVerdict` saw one run per arm, every challenger
   * question held, and it returned SWITCH with `questions: 1`.
   * Carried as unmeasured, the guard RULING 230 already put there fires.
   */
  const ids = ["q1", "q2", "q3", "q4", "q5", "q6"];
  const ran = new Set(["q6"]);
  const runs = (model: string): QuestionRun[] =>
    ids.map((questionId) => ({
      questionId,
      model,
      held: ran.has(questionId) ? true : null,
      ms: 1,
      usd: 1,
    }));

  const verdict = switchVerdict(runs("model-a"), runs("model-b"), "the sweep");
  assert.equal(
    verdict.kind,
    "NOT_MEASURED",
    "five of six questions never ran; a SWITCH over the sixth is a vacuous sweep",
  );
  assert.equal(
    verdict.kind === "NOT_MEASURED" ? verdict.unmeasured.length : -1,
    10,
    "every unmeasured question is named, on BOTH arms — 5 questions x 2 arms",
  );

  // And the control: with all six measured and holding, SWITCH is still reachable.
  const allHeld = (model: string): QuestionRun[] =>
    ids.map((questionId) => ({ questionId, model, held: true, ms: 1, usd: 1 }));
  const clean = switchVerdict(allHeld("model-a"), allHeld("model-b"), "the sweep");
  assert.equal(clean.kind, "SWITCH");
  assert.equal(clean.kind === "SWITCH" ? clean.questions : -1, 6);
});
