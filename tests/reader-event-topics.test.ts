import assert from "node:assert/strict";
import test from "node:test";

import { classifyReaderEventTopic, readerTopicInCode } from "../lib/db/reader-event-topics.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";

const memoryCache = () => {
  const held = new Map<string, string>();
  return { read: async (key: string) => held.get(key) ?? null, remember: async (key: string, topic: string) => { held.set(key, topic); return topic; } };
};

test("a question plain code cannot place goes to the cheapest tier as a quick job: thinking off, low effort, room to answer, cached prompt", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    assert.equal(readerTopicInCode("Can I bring my dog to the city pool?"), null);
    const sent: Record<string, unknown>[] = [];
    const costs: CostEntry[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ model: MODELS.haiku.model, content: [{ type: "text", text: JSON.stringify({ topic: "free-form" }) }],
        usage: { input_tokens: 4, cache_read_input_tokens: 840, cache_creation_input_tokens: 0, output_tokens: 12 } }));
    }) as typeof fetch;
    const topic = await classifyReaderEventTopic("Can I bring my dog to the city pool?", { cache: memoryCache(), fetchImpl, recordCost: async (row) => { costs.push(row); } });
    assert.equal(topic, "free-form");
    const body = sent[0] as { model: string; max_tokens: number; thinking?: unknown; output_config: { effort?: string }; system: { cache_control?: unknown }[] };
    assert.equal(body.model, MODELS.haiku.model);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.output_config.effort, "low");
    assert.ok(body.max_tokens >= 1024, "room to answer");
    assert.deepEqual(body.system[0].cache_control, { type: "ephemeral", ttl: "1h" }, "the stable topic list is cached for an hour");
    assert.ok(Math.abs(costs[0].cost.usd! - (4 * 0.1 + 840 * 0.1 * 0.1 + 12 * 0.5) / 1e6) < 1e-15, "priced at Haiku 5.5's rates");
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});
