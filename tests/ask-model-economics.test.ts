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
  const sites = [
    "lib/ask/synthesize.ts",
    "lib/ask/interpret.ts",
    "lib/routing/classifier.ts",
    "lib/routing/unsourced-fallback.ts",
  ];
  for (const site of sites) {
    const source = readFileSync(join(root, site), "utf8");
    const declared = [...source.matchAll(/"(claude-[a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.ok(declared.length > 0, `${site} declares no model`);
    for (const model of declared) {
      assert.equal(
        model,
        ASK_INCUMBENT_MODEL,
        `${site} runs ${model}; Ask runs one model for all traffic`,
      );
    }
  }
});

test("H2: the incumbent is read from the code, never from a constant that can drift", () => {
  assert.equal(ASK_INCUMBENT_MODEL, ASK_SYNTHESIS_MODEL);
  assert.equal(ASK_SYNTHESIS_MODEL, "claude-opus-5");
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

test("H2: the published rate ratio is 2.5x on input and 2.5x on output", () => {
  const ratio = rateRatio(
    ASK_MODEL_RATES[ASK_INCUMBENT_MODEL],
    ASK_MODEL_RATES[ASK_CHALLENGER_MODEL],
  );
  assert.equal(ratio.input, 2.5);
  assert.equal(ratio.output, 2.5);
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
  assert.ok(
    !("to" in relative) && !("kind" in relative && relative.kind === "SWITCH"),
    "the diagnostic must carry no switch-shaped member",
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
