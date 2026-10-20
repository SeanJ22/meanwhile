import test from "./helpers/playbooks.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  UNSOURCED_MARK,
  shouldFallBack,
  unsourcedAnswer,
} from "../lib/routing/unsourced-fallback.ts";

const ROOT = process.cwd();

test("ASK-12 — THE LOAD-BEARING CASE: an unsourced answer carries NO sources field at all", () => {
  const answer = unsourcedAnswer("Rain happens when water vapour condenses.");
  for (const banned of ["sources", "provenance", "sourceUrl", "sourceOrg", "collectedAt", "citation"]) {
    assert.ok(
      !(banned in (answer as unknown as Record<string, unknown>)),
      `an unsourced answer carries \`${banned}\` — a Sources section could be built from it`,
    );
  }
  const raw = readFileSync(join(ROOT, "lib", "routing", "unsourced-fallback.ts"), "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("export interface UnsourcedAnswer"), "stripping comments removed the code");
  for (const banned of ["sourceUrl", "sourceOrg", "collectedAt"]) {
    assert.ok(!code.includes(banned), `the module names \`${banned}\``);
  }
});

test("ASK-12: it is a DIFFERENT KIND, so it cannot be rendered where a routed answer goes", () => {
  const answer = unsourcedAnswer("x");
  assert.equal(answer.kind, "UNSOURCED");
  assert.notEqual(answer.kind, "NO_ROUTE");
  assert.equal(answer.provenanceTag, "UNSOURCED_GENERAL", "the ripcord doctrine's provenance tag is missing");
});

test("ASK-12: the mark is PLAIN LANGUAGE, and it is not a footnote", () => {
  assert.equal(UNSOURCED_MARK, "AI answer");
  for (const jargon of ["provenance", "corpus", "LLM", "heuristic", "unsourced provenance"]) {
    assert.ok(!UNSOURCED_MARK.includes(jargon), `the mark uses jargon: ${jargon}`);
  }
  assert.equal(unsourcedAnswer("x").mark, UNSOURCED_MARK);
});

test("ASK-12 — LAST, NEVER FIRST: a question the router ANSWERED never falls back", () => {
  assert.equal(
    shouldFallBack({ routerAnswered: true, routerDeclined: false }),
    false,
    "a sourced answer was discarded in favour of a generated one",
  );
  assert.equal(
    shouldFallBack({ routerAnswered: false, routerDeclined: false }),
    false,
    "the fallback fired without the sourced path having declined",
  );
});

test("ASK-12: the out-of-scope class Sean named DOES fall back", () => {
  assert.equal(
    shouldFallBack({ routerAnswered: false, routerDeclined: true }),
    true,
    "the fallback refuses the exact class it was built for",
  );
});

test("ASK-12: the SOURCED refusal is unchanged — the civic path did not move", () => {
  const resolve = readFileSync(join(ROOT, "lib", "routing", "resolve.ts"), "utf8");
  assert.match(
    resolve,
    /We don't have a sourced answer for who owns this topic yet\. Rather than guess, we haven't routed it/,
    "the sourced refusal was replaced or reworded by the fallback work",
  );
  assert.ok(
    !resolve.includes("unsourced-fallback"),
    "the sourced router imports the fallback — the two paths must not meet inside it",
  );
});

test("Sean, October 1, 2026: Ask without a held source may answer, states its source, and stays short", async () => {
  const { unsourcedSourceLine, askUnsourced } = await import("../lib/routing/unsourced-fallback.ts");
  assert.equal(
    unsourcedSourceLine("claude-haiku-5-5"),
    "Source: Claude Haiku 5.5, general knowledge — not a public record this site holds.",
  );
  assert.equal(unsourcedAnswer("x", "claude-haiku-5-5").sourceLine, unsourcedSourceLine("claude-haiku-5-5"));
  assert.equal(shouldFallBack({ routerAnswered: false, routerDeclined: true }), true);
  let sent = "";
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const outcome = await askUnsourced("Who is my state senator?", {
    fetchImpl: (async (_url: string, init: { body: string }) => {
      sent = init.body;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "I don't know." }] }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.match(sent, /For a simple question, use exactly one short sentence/);
  assert.ok(!/DECLINE/.test(sent), "the prompt still orders the model to refuse civic questions");
  assert.equal(outcome.kind, "UNSOURCED");
  if (outcome.kind === "UNSOURCED") assert.equal(outcome.answer.text, "I don't know.");
  assert.match(JSON.parse(sent).messages[0].content, /Give only the answer/);
});

test("the general AI answer preserves its answer text and renders an explicit unknown without process narration", async () => {
  const { askUnsourced } = await import("../lib/routing/unsourced-fallback.ts");
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  let known = true;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(request.tools[0].input_schema.required, ["known", "answer"]);
    return Response.json({ content: [{ type: "tool_use", name: "answer_reader", input: { known, answer: known ? "Mark Kelly voted NO on H.R. 1." : "" } }] });
  }) as typeof fetch;
  const answer = await askUnsourced("How did Mark Kelly vote on HR1?", { fetchImpl });
  assert.equal(answer.kind, "UNSOURCED");
  if (answer.kind === "UNSOURCED") assert.equal(answer.answer.text, "Mark Kelly voted NO on H.R. 1.");
  known = false;
  const unknown = await askUnsourced("How did Mark Kelly vote on HR1?", { fetchImpl });
  assert.equal(unknown.kind, "UNSOURCED");
  if (unknown.kind === "UNSOURCED") assert.equal(unknown.answer.text, "I don't know.");
});
