/**
 * **ASK-12 (2026-08-25) — the unsourced fallback, and the wall around it.**
 *
 * The load-bearing tests here are the NEGATIVE ones. Sean allowed this on one
 * condition — *a sourced civic answer and an unsourced general answer must
 * never be visually or structurally confusable* — and the whole trust posture
 * of the product is what is at stake if that slips.
 */
import test from "node:test";
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
  /*
   * Enforced by ABSENCE (the RULING 112 pattern). A Sources section cannot be
   * populated from a shape that has no such field, so the separation survives
   * a careless caller rather than depending on one being careful.
   */
  const answer = unsourcedAnswer("Rain happens when water vapour condenses.");
  for (const banned of ["sources", "provenance", "sourceUrl", "sourceOrg", "collectedAt", "citation"]) {
    assert.ok(
      !(banned in (answer as unknown as Record<string, unknown>)),
      `an unsourced answer carries \`${banned}\` — a Sources section could be built from it`,
    );
  }
  // And the module itself never names one, so a future field cannot be added
  // quietly. Comments are stripped: the doc block above discusses these words.
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
  // Sean: "explicitly and visibly marked as unsourced, in plain language a
  // fifteen-year-old reads correctly — not a footnote, not an asterisk."
  assert.ok(UNSOURCED_MARK.length > 60, "the mark is too short to say what it has to say");
  assert.ok(!/^\s*[*†‡]/.test(UNSOURCED_MARK), "the mark opens as a footnote marker");
  assert.match(UNSOURCED_MARK, /did not come from any public record/i);
  assert.match(UNSOURCED_MARK, /have not checked it/i);
  // No jargon a fifteen-year-old would trip on.
  for (const jargon of ["provenance", "corpus", "LLM", "heuristic", "unsourced provenance"]) {
    assert.ok(!UNSOURCED_MARK.includes(jargon), `the mark uses jargon: ${jargon}`);
  }
  // And it is ON the record, so it cannot be rendered without.
  assert.equal(unsourcedAnswer("x").mark, UNSOURCED_MARK);
});

test("ASK-12 — LAST, NEVER FIRST: a question the router ANSWERED never falls back", () => {
  assert.equal(
    shouldFallBack({ routerAnswered: true, routerDeclined: false }),
    false,
    "a sourced answer was discarded in favour of a generated one",
  );
  // Not tried at all is also not a decline.
  assert.equal(
    shouldFallBack({ routerAnswered: false, routerDeclined: false }),
    false,
    "the fallback fired without the sourced path having declined",
  );
});

test("ASK-12: the out-of-scope class Sean named DOES fall back", () => {
  // "Why is it raining?" — declined by the router, not civic, flag on.
  assert.equal(
    shouldFallBack({ routerAnswered: false, routerDeclined: true }),
    true,
    "the fallback refuses the exact class it was built for",
  );
});

test("ASK-12: the SOURCED refusal is unchanged — the civic path did not move", () => {
  /*
   * Sean: "Sourced civic answers are unchanged. Prove this: show a civic
   * question still answering from sources after the change." The sourced
   * refusal is what a declined civic question renders, and it is asserted here
   * verbatim so a fallback that quietly replaced it would fail.
   */
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
  // The source line names the model and says no record backs the answer.
  assert.equal(
    unsourcedSourceLine("claude-haiku-4-5"),
    "Source: Claude Haiku 4.5, general knowledge — not a public record this site holds.",
  );
  assert.equal(unsourcedAnswer("x", "claude-haiku-4-5").sourceLine, unsourcedSourceLine("claude-haiku-4-5"));
  // A civic question is no longer refused by the fallback itself.
  assert.equal(shouldFallBack({ routerAnswered: false, routerDeclined: true }), true);
  // The prompt asks for one or two sentences, and no longer tells the model to refuse civic questions.
  let sent = "";
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const outcome = await askUnsourced("Who is my state senator?", {
    fetchImpl: (async (_url: string, init: { body: string }) => {
      sent = init.body;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "I am not sure who holds that seat." }] }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.match(sent, /ONE or TWO sentences/);
  assert.ok(!/DECLINE/.test(sent), "the prompt still orders the model to refuse civic questions");
  assert.equal(outcome.kind, "UNSOURCED");
});
