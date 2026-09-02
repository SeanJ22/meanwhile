import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ASK_EFFORT_ENV,
  ASK_EFFORT_LEVELS,
  ASK_MODEL_ENV,
  ASK_SYNTHESIS_EFFORT,
  ASK_SYNTHESIS_MODEL,
  askModelOverrides,
  askModelStartupLine,
  resolveAskEffort,
  resolveAskModel,
} from "../lib/ask/model.ts";
import { synthesisRequestBody } from "../lib/ask/synthesize.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";

/**
 * **THE ASK MODEL CONSTANT, ITS OVERRIDE, AND THE REQUEST SHAPE.**
 * (ITEM K, 2026-09-01.)
 *
 * Three things are under test, and each of them is a way the switch could have
 * gone wrong silently rather than loudly:
 *
 * 1. **The default is the CODE, never the environment.** An unset variable
 *    must resolve to the constant. If it did not, a deploy that forgot to set
 *    a variable would serve a different model than the suite measured, which
 *    is the exact drift the constant exists to prevent.
 * 2. **The request carries no sampling parameter and no manual thinking
 *    block.** `temperature`, `top_p` and `top_k` at any non-default value are
 *    a 400 on this model generation, and so is `{type: "enabled",
 *    budget_tokens: N}`. None of them is present today; this test is what
 *    stops one being added back by a session that remembers an older API.
 * 3. **Effort is PINNED and valid.** An omitted `effort` defaults to `high`
 *    server-side and thinking bills at the output rate, so an accidentally
 *    omitted field is an accidentally expensive one.
 */

function pack(): EvidencePack {
  return {
    question: "When does the council next meet?",
    intent: "MEETING_NEXT",
    temporal: { kind: "NEXT" },
    subject: { id: "ocd-division/country:us/state:az/place:vail", name: "Vail Town Council", kind: "BODY" },
    records: [
      {
        kind: "MEETING",
        text: "Vail Town Council regular meeting, 2026-09-15 at 6:00 PM.",
        sourceUrl: "https://example.gov/vail/agenda",
        publisher: "Town of Vail",
        observedAt: "2026-09-01",
      },
    ],
    gaps: [],
    denominators: { meetingsSearched: 1 },
    today: "2026-09-01",
  } as unknown as EvidencePack;
}

/* ── 1. the constant, and the override's two conditions ──────────────────── */

test("an unset override resolves to the constant — the default is the code", () => {
  assert.equal(resolveAskModel({}), ASK_SYNTHESIS_MODEL);
  assert.equal(resolveAskEffort({}), ASK_SYNTHESIS_EFFORT);
});

test("an empty or whitespace override is treated as unset, never as an empty model", () => {
  /* This is how a misconfigured deploy arrives. Honouring it would send
     `"model": ""` on every reader question and take Ask down; the reader would
     meet a configuration error dressed as an unavailable answer. */
  for (const value of ["", "   ", "\t"]) {
    assert.equal(resolveAskModel({ [ASK_MODEL_ENV]: value }), ASK_SYNTHESIS_MODEL);
  }
});

test("a set override is honoured, and is REPORTED as an override", () => {
  /*
   * The override value is DERIVED from the constant rather than written down,
   * and that is the point of this line. It used to be the literal
   * `claude-opus-5` — which was a different model from the constant on the day
   * it was written, and became the SAME model the day the switch was reverted.
   * An override equal to the constant is not an override, so the assertion
   * quietly stopped testing anything and went red only because
   * `askModelOverrides` is honest about it.
   *
   * A test that has to be edited every time the constant moves is a test that
   * will one day be edited wrongly.
   */
  /*
   * Widened to `string` on purpose. `ASK_SYNTHESIS_MODEL` narrows to a LITERAL
   * type, so comparing it against the other model is a `TS2367` "no overlap"
   * error — tsc is correct that the comparison is decidable at compile time,
   * and that is exactly why the value must not be hardcoded here at runtime.
   */
  const current: string = ASK_SYNTHESIS_MODEL;
  const other = current === "claude-sonnet-5" ? "claude-opus-5" : "claude-sonnet-5";
  const env = { [ASK_MODEL_ENV]: other };
  assert.notEqual(other, ASK_SYNTHESIS_MODEL, "the override must differ from the default");
  assert.equal(resolveAskModel(env), other);
  assert.equal(askModelOverrides(env).model, true);
  assert.match(askModelStartupLine(env), new RegExp(other));
  assert.match(askModelStartupLine(env), new RegExp(`overridden by ${ASK_MODEL_ENV}`));
});

test("an effort override off the closed set is REFUSED, not passed through to a 400", () => {
  const env = { [ASK_EFFORT_ENV]: "extreme" };
  assert.equal(resolveAskEffort(env), ASK_SYNTHESIS_EFFORT);
  assert.equal(askModelOverrides(env).effortRefused, "extreme");
  assert.match(askModelStartupLine(env), /REFUSED/);
});

test("every effort level in the closed set resolves to itself", () => {
  for (const level of ASK_EFFORT_LEVELS) {
    assert.equal(resolveAskEffort({ [ASK_EFFORT_ENV]: level }), level);
  }
});

test("the startup line reports the RESOLVED values and carries no secret", () => {
  const line = askModelStartupLine({});
  assert.match(line, new RegExp(ASK_SYNTHESIS_MODEL));
  assert.match(line, new RegExp(`effort ${ASK_SYNTHESIS_EFFORT}`));
  /* Two configuration values and nothing else. A startup line that grew a
     third field would be the place a credential eventually gets logged. */
  assert.ok(!/sk-|api[_-]?key/i.test(line), "the startup line must never carry a credential");
});

/* ── 2. the request shape ────────────────────────────────────────────────── */

test("the Ask request sets no temperature, top_p or top_k — each is a 400 on this model", () => {
  const body = synthesisRequestBody(pack(), { model: ASK_SYNTHESIS_MODEL, cached: true });
  for (const forbidden of ["temperature", "top_p", "top_k"]) {
    assert.ok(
      !(forbidden in body),
      `${forbidden} is present; a non-default sampling parameter returns 400 on this model ` +
        `generation, and setting it to the documented default explicitly is not the fix — ` +
        `the key is removed`,
    );
  }
});

test("thinking is ADAPTIVE — the manual budget_tokens form is a 400 on this model", () => {
  const body = synthesisRequestBody(pack(), { model: ASK_SYNTHESIS_MODEL, cached: true });
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.ok(
    !JSON.stringify(body).includes("budget_tokens"),
    "budget_tokens is removed on this model generation and returns 400",
  );
});

test("effort is PINNED on the request, never omitted to the server default", () => {
  const body = synthesisRequestBody(pack(), { model: ASK_SYNTHESIS_MODEL, cached: true });
  const config = body.output_config as { effort?: string };
  assert.equal(config.effort, ASK_SYNTHESIS_EFFORT);
  assert.ok(
    (ASK_EFFORT_LEVELS as readonly string[]).includes(config.effort ?? ""),
    "an effort off the closed set is a 400",
  );
});

test("the model id carries no date suffix — these ids are dateless AND pinned", () => {
  /* From the Claude 4.6 generation onward a dateless id identifies one pinned
     version. A dated variant would name a model that does not exist. */
  assert.match(ASK_SYNTHESIS_MODEL, /^claude-[a-z]+-[0-9]+$/);
  assert.ok(!/-\d{8}$/.test(ASK_SYNTHESIS_MODEL), "no date suffix");
});

/* ── 3. the measurement-integrity argument is WRITTEN DOWN ───────────────── */

test("the declaring module states WHY the model is a constant and not a per-environment variable", () => {
  /*
   * The brief required the reason stated where the constant is declared, and
   * the reason is not decoration: it is the argument a future session needs
   * before it "simplifies" this into an environment variable per environment
   * and silently decouples the local suite from what production serves.
   */
  const source = readFileSync(join(process.cwd(), "lib/ask/model.ts"), "utf8");
  assert.match(source, /measurement integrity/i);
  assert.match(source, /local/i);
  assert.match(source, /production/i);
});

/* ========================================================================== */
/* The override must reach EVERY Ask rung, not just the one that reported it  */
/* ========================================================================== */

test("no Ask call site binds the model at module load", () => {
  /*
   * `const MODEL = ASK_SYNTHESIS_MODEL` binds the CONSTANT once, when the
   * module is first imported, so `WTP_ASK_MODEL` never reaches that rung.
   * Three of the four Ask call sites did exactly that: `synthesize.ts`
   * honoured the override and `classifier.ts`, `unsourced-fallback.ts` and
   * `interpret.ts` silently did not.
   *
   * ITEM K's brief allows the override on two conditions, and the second is
   * that **the RESOLVED value — not the default — is what gets recorded**. A
   * rung reading the constant meets the first and quietly breaks the second.
   *
   * What it cost: RULING 234 makes the measurement the reversibility mechanism
   * for the Sonnet 5 switch. With three rungs bound at load, an emergency
   * revert through the environment would have moved ONE call site while
   * reporting the model had changed. It was found that way — an isolation walk
   * with `WTP_ASK_MODEL=claude-opus-5` reproduced a failure identically, which
   * read as proof the model was innocent and was really proof that the
   * override never arrived.
   */
  const rungs = [
    "lib/routing/classifier.ts",
    "lib/routing/unsourced-fallback.ts",
    "lib/ask/interpret.ts",
    "lib/ask/synthesize.ts",
  ];
  const offenders: string[] = [];
  for (const rung of rungs) {
    const src = readFileSync(join(process.cwd(), rung), "utf8");
    // Strip block comments: these files DISCUSS the constant by name, and a
    // guard that reads its own explanation as the defect is the defect.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    if (/const\s+\w*MODEL\w*\s*=\s*ASK_SYNTHESIS_MODEL\s*;/.test(code)) {
      offenders.push(`${rung} binds ASK_SYNTHESIS_MODEL at module load`);
    }
    if (/model:\s*MODEL\b/.test(code)) {
      offenders.push(`${rung} sends a module-bound MODEL in its request body`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "every Ask rung must resolve the model at call time:\n  " + offenders.join("\n  "),
  );
});

test("every Ask rung imports the RESOLVER, so the override cannot miss one", () => {
  for (const rung of [
    "lib/routing/classifier.ts",
    "lib/routing/unsourced-fallback.ts",
    "lib/ask/interpret.ts",
    "lib/ask/synthesize.ts",
  ]) {
    const src = readFileSync(join(process.cwd(), rung), "utf8");
    assert.match(
      src,
      /import\s*\{[^}]*resolveAskModel[^}]*\}\s*from/,
      `${rung} does not import resolveAskModel, so WTP_ASK_MODEL cannot reach it`,
    );
  }
});
