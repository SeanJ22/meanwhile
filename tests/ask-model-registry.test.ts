import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { MODELS, MODEL_TIERS } from "../lib/models.ts";
import { synthesisLadder, synthesizeWithLadder } from "../lib/ask/synthesize.ts";
import { interpretQuestion } from "../lib/ask/interpret.ts";
import { classifyQuestion, resetClassifierState } from "../lib/routing/classifier.ts";
import { askUnsourced } from "../lib/routing/unsourced-fallback.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";

const models = MODEL_TIERS.map(tier => MODELS[tier].model);
const pack = { question: "When does the council meet?", intent: "MEETING_TIME", temporal: { kind: "NEXT" },
  subject: { id: "council", name: "Council", kind: "BODY" }, today: "2026-10-24", records: [
    { kind: "MEETING", id: "meeting", text: "Council meets October 27.", sourceUrl: "https://example.gov/agenda" },
  ], gaps: [], denominators: { meetingsSearched: 1 } } as unknown as EvidencePack;
const reading = { intent: "MEETING_TIME", entityMentions: ["council"], normalizedMentions: ["Council"], temporal: { kind: "NEXT" }, referent: null };

test("each writer is tried only after the preceding answer fails; a passing answer stops spending", async () => {
  for (let failures = 0; failures < 3; failures++) {
    const sent: string[] = [], charged: string[] = [];
    const result = await synthesizeWithLadder(pack, { apiKey: "test", recordCost: async cost => { charged.push(cost.model!); },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)); sent.push(body.model);
        return Response.json({ model: body.model, content: [{ type: "text", text: JSON.stringify({ answer: `${sent.length}`, citedSources: [1] }) }], usage: { input_tokens: 1, output_tokens: 1 } });
      }, validate: () => sent.length <= failures ? { kind: "FAILED", failed: ["unsupported"] } as never : { kind: "PASSED", checked: [] } as never });
    assert.deepEqual(sent, models.slice(0, failures + 1));
    assert.equal(result.verdict?.kind, "PASSED");
    assert.equal(result.attempts.at(-1)?.servedModel, models[failures]);
    assert.deepEqual(synthesisLadder().map(r => r.model), models);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(charged, sent);
  }
});

test("reader, classifier and general answers all climb on malformed results", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test";
  try {
    for (const step of ["reader", "classifier", "general"] as const) for (let failures = 0; failures < 3; failures++) {
      resetClassifierState();
      const sent: string[] = [];
      const fetchImpl: typeof fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)); sent.push(body.model);
        const content = sent.length <= failures ? [{ type: "text", text: "" }] : step === "general"
          ? [{ type: "tool_use", name: "answer_reader", input: { known: true, answer: "Council meets October 27." } }]
          : [{ type: "text", text: JSON.stringify(step === "reader" ? reading : { topic: "NONE" }) }];
        return Response.json({ model: body.model, content });
      };
      const recordCost = async () => {};
      const result = step === "reader" ? await interpretQuestion("When does the council meet?", { inventory: [], today: "2026-10-24" }, { fetchImpl, recordCost })
        : step === "classifier" ? await classifyQuestion("Council question", { fetchImpl, recordCost })
        : await askUnsourced("When does the council meet?", { fetchImpl, recordCost });
      assert.notEqual(result.kind, "UNAVAILABLE", step);
      assert.deepEqual(sent, models.slice(0, failures + 1), step);
    }
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("an exhausted request deadline sends no additional writer", async () => {
  const sent: string[] = [];
  const result = await synthesizeWithLadder(pack, { apiKey: "test", deadlineMs: Date.now() - 1,
    fetchImpl: async (_url, init) => { sent.push(JSON.parse(String(init?.body)).model); throw new Error("no call expected"); },
    validate: () => ({ kind: "PASSED", checked: [] }) as never });
  assert.deepEqual(sent, []);
  assert.equal(result.outcome.kind, "UNAVAILABLE");
});
