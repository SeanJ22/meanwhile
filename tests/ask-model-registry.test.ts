import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ASK_MODEL_ROLE_NAMES,
  ASK_MODEL_ROLES,
  askModelStartupLine,
  resolveAskFastWriter,
  resolveAskModel,
  resolveAskRole,
  resolveAskRoleModel,
  type AskModelRole,
} from "../lib/ask/model.ts";
import {
  ALWAYS_THINKS_MIN_MAX_TOKENS,
  ASK_MODEL_REGISTRY,
  ASK_RETIRED_MODELS,
  askModelEntry,
  askModelPrice,
  askModelRefusal,
  askRequestFields,
  canonicalAskModelId,
} from "../lib/ask/model-registry.ts";
import { interpretQuestion } from "../lib/ask/interpret.ts";
import { escalationFirstReason, synthesisLadder, synthesisRequestBody, synthesizeWithLadder, type SynthesisRung } from "../lib/ask/synthesize.ts";
import { classifyQuestion, resetClassifierState } from "../lib/routing/classifier.ts";
import { askUnsourced } from "../lib/routing/unsourced-fallback.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";

/**
 * **THE ASK MODEL REGISTRY AND ITS ROLES.** (2026-09-25.)
 *
 * Sean, 7:25 PM MST: Opus 5 must not be used any more, not as a test subject,
 * default or fallback. 7:50 PM: changing a model should be easy. So:
 *
 * 1. no role resolves to `claude-opus-5`, by default or by override;
 * 2. every role resolves from one table, each with its own override, and the
 *    old `WTP_ASK_MODEL` / `WTP_ASK_FAST_MODEL` still work;
 * 3. an unknown or retired override is refused by name and the role keeps its
 *    default (a typo in a deploy variable must not take Ask down);
 * 4. every rung's request carries only fields its model accepts — checked for
 *    every role on every registry model;
 * 5. the model the API says served a call is recorded beside the id we sent.
 */

const ROLE_ENV: Record<AskModelRole, string> = {
  READER: "WTP_ASK_READER_MODEL",
  FAST_WRITER: "WTP_ASK_FAST_MODEL",
  ESCALATION_WRITER: "WTP_ASK_ESCALATION_MODEL",
  CLASSIFIER: "WTP_ASK_CLASSIFIER_MODEL",
  UNSOURCED: "WTP_ASK_UNSOURCED_MODEL",
};

function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(vars)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return run().finally(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

/** A transport that records the request body and answers with a fixed reply naming a served model. */
function capture(reply: unknown, servedModel = "claude-served-by-api") {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return new Response(JSON.stringify({ model: servedModel, content: [{ type: "text", text: JSON.stringify(reply) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

function pack(): EvidencePack {
  return {
    question: "When does the council next meet?",
    intent: "MEETING_TIME",
    temporal: { kind: "NEXT" },
    subject: { id: "ocd-division/country:us/state:az/place:vail", name: "Vail Town Council", kind: "BODY" },
    records: [{ kind: "MEETING", id: "m1", text: "Vail Town Council regular meeting, 2026-09-15 at 6:00 PM.", sourceUrl: "https://example.gov/vail/agenda" }],
    gaps: [],
    denominators: { meetingsSearched: 1 },
    today: "2026-09-01",
  } as unknown as EvidencePack;
}

/* ── 1. Opus 5 is out ────────────────────────────────────────────────────── */

test("no role resolves to claude-opus-5 — not by default, not by override, not through an alias", () => {
  for (const role of ASK_MODEL_ROLE_NAMES) {
    assert.notEqual(resolveAskRole(role, {}).model, "claude-opus-5", `${role} defaults to the retired model`);
    for (const name of [...ASK_MODEL_ROLES[role].env]) {
      const resolved = resolveAskRole(role, { [name]: "claude-opus-5" });
      assert.notEqual(resolved.model, "claude-opus-5", `${name}=claude-opus-5 reached ${role}`);
      assert.equal(resolved.model, ASK_MODEL_ROLES[role].defaultModel, "a refused override keeps the role's default");
      assert.match(resolved.refused.join(" "), /claude-opus-5 retired/);
    }
  }
  assert.ok(!askModelEntry("claude-opus-5"), "the retired model is not a registry entry, so nothing can select it");
  assert.ok(ASK_RETIRED_MODELS["claude-opus-5"]);
});

test("no Ask call site names claude-opus-5 as a literal", () => {
  for (const file of ["lib/ask/model.ts", "lib/ask/interpret.ts", "lib/ask/synthesize.ts", "lib/routing/classifier.ts", "lib/routing/unsourced-fallback.ts", "app/api/ask/grounded/route.ts", "app/api/ask/classify/route.ts"]) {
    const code = readFileSync(join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/["'`]claude-opus-5["'`]/.test(code), `${file} names claude-opus-5 in code`);
  }
});

/* ── 2. one table, per-role overrides, the old names still work ──────────── */

test("every role's default is a registry model with a price and a cache minimum", () => {
  for (const role of ASK_MODEL_ROLE_NAMES) {
    const model = ASK_MODEL_ROLES[role].defaultModel;
    assert.ok(askModelEntry(model), `${role} default ${model} is not in the registry`);
    const price = askModelPrice(model);
    assert.ok(price, `${model} has no control-plane rate row`);
    assert.ok(price!.rate.inputUsdPerMillion > 0 && price!.rate.outputUsdPerMillion > 0);
    assert.ok(price!.cacheMinimumTokens !== null && price!.cacheMinimumTokens > 0);
  }
  /* Opus 5.5 reads cache at 0.05x, not the 0.1x default: priced from the one control-plane row. */
  assert.equal(askModelPrice("claude-opus-5-5")!.cacheReadMultiplier, 0.05);
  assert.equal(askModelPrice("claude-opus-5-5")!.rate.inputUsdPerMillion, 4);
});

test("each role has its own override, and the specific one beats the WTP_ASK_MODEL alias", () => {
  for (const role of ASK_MODEL_ROLE_NAMES) {
    const specific = ROLE_ENV[role];
    assert.ok(ASK_MODEL_ROLES[role].env.includes(specific), `${role} has no ${specific}`);
    const other = ASK_MODEL_ROLES[role].defaultModel === "claude-sonnet-5" ? "claude-haiku-4-5" : "claude-sonnet-5";
    const resolved = resolveAskRole(role, { [specific]: other, WTP_ASK_MODEL: "claude-opus-5-5" });
    assert.equal(resolved.model, other);
    assert.equal(resolved.overriddenBy, specific);
  }
  /* The legacy alias still moves every frontier-default role — and only those. */
  for (const role of ["ESCALATION_WRITER", "UNSOURCED"] as const) {
    assert.equal(resolveAskRoleModel(role, { WTP_ASK_MODEL: "claude-sonnet-5" }), "claude-sonnet-5");
  }
  for (const role of ["READER", "CLASSIFIER"] as const) {
    assert.equal(resolveAskRoleModel(role, { WTP_ASK_MODEL: "claude-sonnet-5" }), ASK_MODEL_ROLES[role].defaultModel, `${role} is not a frontier role`);
  }
  assert.equal(resolveAskModel({ WTP_ASK_MODEL: "claude-sonnet-5" }), "claude-sonnet-5");
  /* The fast writer keeps its own switch, including off. */
  assert.equal(resolveAskFastWriter({ WTP_ASK_FAST_MODEL: "off" }), null);
  assert.equal(resolveAskFastWriter({ WTP_ASK_FAST_MODEL: "none" }), null);
  assert.equal(resolveAskFastWriter({ WTP_ASK_FAST_MODEL: "claude-haiku-4-5-20251001" }), "claude-haiku-4-5", "a dated alias resolves to the registry id");
  /* Only the fast writer can be switched off; `off` elsewhere is an unknown model, refused. */
  const reader = resolveAskRole("READER", { WTP_ASK_READER_MODEL: "off" });
  assert.equal(reader.model, ASK_MODEL_ROLES.READER.defaultModel);
  assert.equal(reader.refused.length, 1);
});

/* ── 2b. the routing the 2026-09-25 comparison decided ──────────────────── */

test("the measured routing: Haiku 4.5 reads, writes first and labels; Opus 5.5 escalates", () => {
  assert.deepEqual(
    Object.fromEntries(ASK_MODEL_ROLE_NAMES.map((role) => [role, resolveAskRole(role, {}).model])),
    { READER: "claude-haiku-4-5", FAST_WRITER: "claude-haiku-4-5", ESCALATION_WRITER: "claude-opus-5-5", CLASSIFIER: "claude-haiku-4-5", UNSOURCED: "claude-opus-5-5" },
  );
});

test("money questions that ask WHO gave or COMPARE are written by the escalation writer first; how-much questions keep the fast writer", () => {
  /* The measured questions, by what the fast writer did with them. */
  for (const question of [
    "Who funded the Vail school board candidates?", // Haiku 4.5 wrong 2 of 2
    "Who donated to Katie Hobbs's campaign?", // wrong 2 of 2
    "Has Cinde Warmington raised more money than Kelly Ayotte?", // wrong 2 of 2
    "Who are Tayfun Selen's biggest donors?", // right 2 of 2, same kind: routed conservatively
  ]) {
    assert.equal(escalationFirstReason(question, {}), "money-who-or-comparison", question);
    const ladder = synthesisLadder({}, { question });
    assert.deepEqual(ladder.map((rung) => [rung.model, rung.role]), [["claude-opus-5-5", "FRONTIER"]], question);
  }
  for (const question of [
    "How much campaign money has Katie Hobbs raised?", // right 2 of 2
    "How much money has Tayfun Selen raised for his campaign?", // right 2 of 2
    "How much has Kelly Ayotte raised and spent?", // right 2 of 2
    "When does the Mesa City Council meet next?",
    "Who sits on the Mesa City Council?",
  ]) {
    assert.equal(escalationFirstReason(question, {}), null, question);
    assert.deepEqual(synthesisLadder({}, { question }).map((rung) => rung.role), ["FAST", "FRONTIER"], question);
  }
  /* One switch turns the kind routing off without a deploy. */
  assert.equal(escalationFirstReason("Who donated to Katie Hobbs's campaign?", { WTP_ASK_WRITER_ROUTING: "off" }), null);
  assert.deepEqual(synthesisLadder({ WTP_ASK_WRITER_ROUTING: "off" }, { question: "Who donated to Katie Hobbs's campaign?" }).map((rung) => rung.role), ["FAST", "FRONTIER"]);
});

/* ── 3. an unknown model fails safe ──────────────────────────────────────── */

test("an unknown model override is REFUSED by name, the default stands, and the startup line says so", () => {
  const env = { WTP_ASK_CLASSIFIER_MODEL: "claude-opus-9-typo" };
  const resolved = resolveAskRole("CLASSIFIER", env);
  assert.equal(resolved.model, ASK_MODEL_ROLES.CLASSIFIER.defaultModel);
  assert.equal(resolved.overriddenBy, null);
  assert.match(resolved.refused[0], /not in the Ask model registry/);
  assert.match(askModelStartupLine(env), /WTP_ASK_CLASSIFIER_MODEL="claude-opus-9-typo" REFUSED/);
  assert.equal(askModelRefusal("claude-sonnet-5"), null);
  assert.equal(canonicalAskModelId(" claude-haiku-4-5-20251001 "), "claude-haiku-4-5");
  /* An unregistered id never gets a thinking or effort field it might reject. */
  assert.deepEqual(askRequestFields("claude-unknown", { thinking: "ADAPTIVE", effort: "low" }), { minMaxTokens: 0 });
});

/* ── 4. every rung, every registry model: only accepted fields ───────────── */

function assertAccepted(body: Record<string, unknown>, model: string, want: "ADAPTIVE" | "OFF", where: string) {
  const caps = askModelEntry(model)!.capabilities;
  const thinking = body.thinking as { type?: string } | undefined;
  const effort = (body.output_config as { effort?: string } | undefined)?.effort;
  assert.equal(body.model, model, `${where}: sent ${String(body.model)}`);
  if (thinking?.type === "disabled") assert.ok(caps.thinkingDisabled, `${where}: ${model} rejects thinking disabled`);
  if (thinking?.type === "adaptive") assert.ok(caps.adaptiveThinking, `${where}: ${model} rejects adaptive thinking`);
  if (want === "OFF" && caps.thinkingDisabled) assert.equal(thinking?.type, "disabled", `${where}: thinking should be off on ${model}`);
  if (want === "ADAPTIVE" && caps.adaptiveThinking) assert.equal(thinking?.type, "adaptive", `${where}: thinking should be adaptive on ${model}`);
  if (!caps.adaptiveThinking && want === "ADAPTIVE") assert.equal(thinking, undefined, `${where}: ${model} takes no thinking field`);
  assert.equal(effort !== undefined, caps.effort, `${where}: effort ${effort === undefined ? "missing" : "sent"} on ${model}`);
  assert.ok(!JSON.stringify(body).includes("budget_tokens"), `${where}: no budget_tokens`);
  for (const forbidden of ["temperature", "top_p", "top_k", "tool_choice"]) assert.ok(!(forbidden in body), `${where}: ${forbidden}`);
  if (caps.alwaysThinks) assert.ok(Number(body.max_tokens) >= ALWAYS_THINKS_MIN_MAX_TOKENS, `${where}: no room for ${model}'s thinking`);
}

test("the reading rung sends each registry model only what it accepts, and records the served model", async () => {
  for (const { id } of ASK_MODEL_REGISTRY) {
    const { bodies, fetchImpl } = capture({ intent: "UNKNOWN", entityMentions: [], normalizedMentions: [], temporal: { kind: "NONE" }, referent: null }, `${id}-served`);
    const outcome = await withEnv({ WTP_ASK_READER_MODEL: id, WTP_ASK_MODEL: undefined }, () =>
      interpretQuestion("what will the weather be", { inventory: [], today: "2026-09-25" }, { apiKey: "sk-test", fetchImpl }));
    assert.equal(outcome.kind, "READ");
    assertAccepted(bodies[0], id, "ADAPTIVE", `reader/${id}`);
    assert.equal(outcome.kind === "READ" && outcome.model, id);
    assert.equal(outcome.kind === "READ" && outcome.servedModel, `${id}-served`);
  }
});

test("both writing rungs send each registry model only what it accepts, and the ladder records the served model", async () => {
  for (const { id } of ASK_MODEL_REGISTRY) {
    for (const effort of ["low", "medium"] as const) {
      assertAccepted(synthesisRequestBody(pack(), { model: id, cached: true, effort }), id, "ADAPTIVE", `writer/${id}/${effort}`);
    }
    const { fetchImpl } = capture({ answer: "The council next meets on September 15, 2026.", citedSources: [1] }, `${id}-served`);
    const rung: SynthesisRung = { model: id, effort: askModelEntry(id)!.capabilities.effort ? "low" : null, role: "FAST", timeoutMs: 5000 };
    const result = await synthesizeWithLadder(pack(), { apiKey: "sk-test", fetchImpl, ladder: [rung], validate: () => ({ kind: "PASSED", checked: [] }) as never });
    assert.equal(result.outcome.kind, "WROTE");
    assert.equal(result.outcome.kind === "WROTE" && result.outcome.servedModel, `${id}-served`);
    assert.equal(result.attempts[0].servedModel, `${id}-served`);
  }
});

test("the topic classifier sends each registry model only what it accepts (no disabled thinking on Opus 5.5)", async () => {
  for (const { id } of ASK_MODEL_REGISTRY) {
    resetClassifierState();
    const { bodies, fetchImpl } = capture({ topic: "NONE" }, `${id}-served`);
    const outcome = await withEnv({ WTP_ASK_CLASSIFIER_MODEL: id, WTP_ASK_MODEL: undefined, ANTHROPIC_API_KEY: "sk-test" }, () =>
      classifyQuestion(`who fixes potholes ${id}`, { fetchImpl }));
    assertAccepted(bodies[0], id, "OFF", `classifier/${id}`);
    assert.equal(outcome.kind, "NONE");
    assert.equal(outcome.kind === "NONE" && outcome.servedModel, `${id}-served`);
    assert.equal(outcome.kind === "NONE" && outcome.model, id);
  }
  const opus55 = askRequestFields("claude-opus-5-5", { thinking: "OFF", effort: "low" });
  assert.equal(opus55.thinking, undefined, "Opus 5.5 answers thinking disabled with HTTP 400");
  assert.equal(opus55.effort, "low");
});

test("the unsourced fallback sends each registry model only what it accepts", async () => {
  for (const { id } of ASK_MODEL_REGISTRY) {
    const { bodies, fetchImpl } = capture("It rains when warm moist air cools.", `${id}-served`);
    await withEnv({ WTP_ASK_UNSOURCED_MODEL: id, WTP_ASK_MODEL: undefined, ANTHROPIC_API_KEY: "sk-test" }, () =>
      askUnsourced("why is it raining", { fetchImpl }));
    if (bodies.length === 0) continue; /* the ripcord is pulled in this environment: nothing is sent at all */
    assertAccepted(bodies[0], id, "OFF", `unsourced/${id}`);
  }
});
