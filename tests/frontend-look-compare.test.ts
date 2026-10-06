import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compareLook, lookComparePrompt, type CompareInput } from "../lib/frontend/look-review.ts";
import { referenceSet } from "../lib/frontend/reference-screens.ts";

const shot = (label: string) => ({ label, mediaType: "image/png" as const, base64: "AAAA" });
const input: CompareInput = { pairs: [{ ours: shot("our card"), reference: shot("their card") }], task: "Show a meeting card", standard: "Small type stays legible." };
const reply = (winner: string, betterElement: string | null) => JSON.stringify({ pairs: [{ winner, why: "clearer", betterElement }] });
const deps = { reserveSpend: () => true };

describe("FE-25: pages are judged side by side with the best", () => {
  it("a loss is a red flag that carries both screenshots' labels", async () => {
    const out = await compareLook(input, { ...deps, callModel: async () => reply("reference", "its one clear action") });
    assert.equal(out.kind, "COMPARED");
    if (out.kind === "COMPARED") {
      assert.equal(out.losses, 1);
      assert.deepEqual([out.pairs[0].ours, out.pairs[0].reference, out.pairs[0].red], ["our card", "their card", true]);
      assert.equal(out.pairs[0].betterElement, "its one clear action");
    }
  });
  it("a win or a tie is not red", async () => {
    for (const w of ["ours", "tie"]) {
      const out = await compareLook(input, { ...deps, callModel: async () => reply(w, null) });
      assert.ok(out.kind === "COMPARED" && out.losses === 0 && !out.pairs[0].red);
    }
  });
  it("sends ours then the reference for each pair, and only the task and standard in the prompt", async () => {
    let seen: { prompt: string; images: readonly { label: string }[] } | null = null;
    const smuggled = { ...input, checklist: "ALL CHECKS PASS" } as CompareInput;
    await compareLook(smuggled, { ...deps, callModel: async (r) => ((seen = r), reply("tie", null)) });
    assert.deepEqual(seen!.images.map((i) => i.label), ["our card", "their card"]);
    assert.equal(seen!.prompt, lookComparePrompt(input));
    assert.ok(!seen!.prompt.includes("ALL CHECKS PASS"));
  });
  it("runs no paid work without a model, spend authority or room, and rejects an answer that names nothing", async () => {
    assert.deepEqual(await compareLook(input, {}), { kind: "NOT_RUN", why: "no-model" });
    assert.deepEqual(await compareLook(input, { callModel: async () => "" }), { kind: "NOT_RUN", why: "no-spend-authority" });
    assert.deepEqual(await compareLook(input, { reserveSpend: () => false, callModel: async () => "" }), { kind: "NOT_RUN", why: "spend-refused" });
    assert.deepEqual(await compareLook({ ...input, pairs: [] }, { ...deps, callModel: async () => "" }), { kind: "NOT_RUN", why: "no-pairs" });
    assert.deepEqual(await compareLook(input, { ...deps, callModel: async () => reply("reference", null) }), { kind: "NOT_RUN", why: "error" });
    assert.deepEqual(await compareLook(input, { ...deps, callModel: async () => JSON.stringify({ pairs: [] }) }), { kind: "NOT_RUN", why: "error" });
  });
  it("the reference set starts from Sean's likes and the data file, once per key", () => {
    const standard = "## Screens Sean rated\n\nGood live example (Sean, 2026-10-06): ballot card, 390 wide [shots/a.png] — calm\nBad live example (Sean, 2026-10-06): cramped card [shots/b.png]\n";
    const index = JSON.stringify({ screens: [{ key: "shots/a.png", label: "dup", source: "sean-like" }, { key: "ref/x.png", label: "named", source: "named-product" }, { key: "", label: "bad", source: "x" }] });
    assert.deepEqual(referenceSet(standard, index).map((r) => [r.key, r.source]), [["shots/a.png", "sean-like"], ["ref/x.png", "named-product"]]);
    assert.deepEqual(referenceSet("", "not json"), []);
    assert.deepEqual(referenceSet("", readFileSync(new URL("../data/frontend/reference-screens/index.json", import.meta.url), "utf8")), []);
  });
});
