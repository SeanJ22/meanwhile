import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ASK_CHALLENGER_MODEL,
  ASK_INCUMBENT_MODEL,
  ASK_MODEL_RATES,
  rateRatio,
  switchVerdict,
  type QuestionRun,
} from "../lib/ask/model-economics.ts";
import { ASK_SYNTHESIS_MODEL } from "../lib/ask/synthesize.ts";

/**
 * **H2 — ASK MODEL ECONOMICS.** (Session C, lane W6.)
 *
 * The decision rule is the thing under test here, not the models. A comparison
 * that cannot run must reach NO SWITCH, and it must reach it for the right
 * reason — the criterion is unmet, which is different from the challenger
 * having been tried and lost.
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

test("H2: ONE degraded question blocks the switch, however many held", () => {
  const incumbent = ["Q2", "Q3", "Q4", "Q5"].map((id) => RAN(id, ASK_INCUMBENT_MODEL, true));
  const challenger = [
    RAN("Q2", ASK_CHALLENGER_MODEL, true),
    RAN("Q3", ASK_CHALLENGER_MODEL, true),
    RAN("Q4", ASK_CHALLENGER_MODEL, false),
    RAN("Q5", ASK_CHALLENGER_MODEL, true),
  ];
  const verdict = switchVerdict(incumbent, challenger, "");
  assert.equal(verdict.kind, "HOLD");
  assert.deepEqual(verdict.kind === "HOLD" ? [...verdict.degraded] : [], ["Q4"]);
});

test("H2: every question holding is the ONLY path to a switch", () => {
  const incumbent = ["Q2", "Q3"].map((id) => RAN(id, ASK_INCUMBENT_MODEL, true));
  const challenger = ["Q2", "Q3"].map((id) => RAN(id, ASK_CHALLENGER_MODEL, true));
  const verdict = switchVerdict(incumbent, challenger, "");
  assert.equal(verdict.kind, "SWITCH");
  assert.equal(verdict.kind === "SWITCH" && verdict.to, ASK_CHALLENGER_MODEL);
});

test("H2: a question the incumbent already failed does not block the switch", () => {
  /* The criterion is DEGRADATION, not perfection. A question neither model
     answers is a retrieval gap, and holding the model choice hostage to it
     would make every future switch impossible for a reason unrelated to the
     model. */
  const verdict = switchVerdict(
    [RAN("Q2", ASK_INCUMBENT_MODEL, true), RAN("Q9", ASK_INCUMBENT_MODEL, false)],
    [RAN("Q2", ASK_CHALLENGER_MODEL, true), RAN("Q9", ASK_CHALLENGER_MODEL, false)],
    "",
  );
  assert.equal(verdict.kind, "SWITCH");
});
