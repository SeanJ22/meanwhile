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
import { MODELS } from "../lib/models.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";

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
  /* Widened to string: the constant narrows to a literal type, and a literal comparison is a TS2367 error. */
  const current: string = ASK_SYNTHESIS_MODEL;
  const other = current === MODELS.sonnet.model ? MODELS.opus.model : MODELS.sonnet.model;
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
  assert.match(ASK_SYNTHESIS_MODEL, /^claude-[a-z]+(-[0-9]+)+$/);
  assert.ok(!/-\d{8}$/.test(ASK_SYNTHESIS_MODEL), "no date suffix");
});

test("no Ask call site binds the model at module load", () => {
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
    /* Each rung resolves its role (lib/ask/model.ts), whose override list carries WTP_ASK_MODEL as an alias. */
    assert.match(
      src,
      /import\s*\{[^}]*\b(resolveAskModel|resolveAskRoleModel)\b[^}]*\}\s*from/,
      `${rung} does not import a model resolver, so an override cannot reach it`,
    );
  }
});
