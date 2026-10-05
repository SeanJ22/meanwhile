import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOOK_QUESTIONS, lookReviewPrompt, reviewLook, type LookReviewInput } from "../lib/frontend/look-review.ts";

const shot = (label: string) => ({ label, mediaType: "image/png" as const, base64: "AAAA" });
const input: LookReviewInput = { screenshots: [shot("cramped card, 390 wide")], task: "Show a meeting card", standard: "Small type stays legible." };
const answers = Object.fromEntries(LOOK_QUESTIONS.map((q) => [q, "line"]));
const reply = (verdict: string, element: string | null) => JSON.stringify({ screens: [{ label: "x", answers, verdict, element }] });

describe("FE-20: a look reviewer separate from the builder", () => {
  it("flags a fixture with a 9px label that every data check passes", async () => {
    const out = await reviewLook(input, { reserveSpend: () => true, callModel: async () => reply("red", "9px label") });
    assert.equal(out.kind, "REVIEWED");
    if (out.kind === "REVIEWED") {
      assert.equal(out.red, 1);
      assert.equal(out.screens[0].element, "9px label");
      assert.equal(out.screens[0].label, "cramped card, 390 wide");
    }
  });
  it("the prompt holds the task and the standard and nothing smuggled in on the input", async () => {
    const smuggled = { ...input, checklist: "ALL CHECKS PASS", dataCounts: 42 } as LookReviewInput;
    let prompt = "";
    await reviewLook(smuggled, { reserveSpend: () => true, callModel: async (r) => ((prompt = r.prompt), reply("green", null)) });
    assert.ok(prompt.includes(input.task) && prompt.includes(input.standard));
    assert.ok(!prompt.includes("ALL CHECKS PASS") && !prompt.includes("42"));
    assert.equal(prompt, lookReviewPrompt(input));
  });
  it("runs no paid work without a model, spend authority or room under the dial", async () => {
    assert.deepEqual(await reviewLook(input, {}), { kind: "NOT_RUN", why: "no-model" });
    assert.deepEqual(await reviewLook(input, { callModel: async () => reply("green", null) }), { kind: "NOT_RUN", why: "no-spend-authority" });
    let called = false;
    const refused = await reviewLook(input, { reserveSpend: () => false, callModel: async () => ((called = true), reply("green", null)) });
    assert.deepEqual(refused, { kind: "NOT_RUN", why: "spend-refused" });
    assert.equal(called, false);
    assert.deepEqual(await reviewLook({ ...input, screenshots: [] }, { reserveSpend: () => true, callModel: async () => "" }), { kind: "NOT_RUN", why: "no-screens" });
  });
  it("a red verdict that names no element, or an answer for the wrong screens, is not a review", async () => {
    const deps = { reserveSpend: () => true };
    assert.deepEqual(await reviewLook(input, { ...deps, callModel: async () => reply("red", null) }), { kind: "NOT_RUN", why: "error" });
    assert.deepEqual(await reviewLook(input, { ...deps, callModel: async () => JSON.stringify({ screens: [] }) }), { kind: "NOT_RUN", why: "error" });
    assert.deepEqual(await reviewLook(input, { ...deps, callModel: async () => "not json" }), { kind: "NOT_RUN", why: "error" });
  });
});
