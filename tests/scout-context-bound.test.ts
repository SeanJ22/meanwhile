/**
 * **A SCOUT'S ACCUMULATED CONTEXT IS BOUNDED, SO IT CANNOT HIT PAYLOAD_BYTE_CEILING.**
 * (2026-09-17.)
 *
 * Every turn re-sends the whole conversation and the FleetSafetyController counts
 * each re-send against the cycle's 16 MiB payload budget. Unbounded, a scout that
 * fetched a few large pages grew its messages until a turn's projected request
 * crossed the ceiling and ABORTED — the failure that stopped every scout from
 * 2026-09-15 on. `boundToolResultContext` holds the tool-result representations
 * under a byte budget, newest-first, eliding older ones to artifact-id pointers.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOUT_CONTEXT_ELISION_MARK,
  SCOUT_CONTEXT_TOOL_RESULT_BUDGET,
  boundToolResultContext,
} from "../lib/control-plane/scheduler/scout-executor.ts";

type Msg = { role: "user" | "assistant"; content: unknown };

/** N turns, each an assistant tool_use + a user tool_result of `size` bytes, ids t1..tN. */
function conversation(n: number, size: number): { messages: Msg[]; map: Map<string, string[]> } {
  const messages: Msg[] = [{ role: "user", content: [{ type: "text", text: "the brief" }] }];
  const map = new Map<string, string[]>();
  for (let i = 1; i <= n; i += 1) {
    const id = `t${i}`;
    map.set(id, [`ar-${i}`]);
    messages.push({ role: "assistant", content: [{ type: "tool_use", id, name: "fetch_public", input: { url: `https://x/${i}` } }] });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: `[rung ${i}: fetch_public -> https://x/${i}]\n` + "X".repeat(size) }],
    });
  }
  return { messages, map };
}

function toolResults(messages: readonly Msg[]): { id: string; content: string }[] {
  const out: { id: string; content: string }[] = [];
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content as Record<string, unknown>[]) {
      if (b.type === "tool_result") out.push({ id: b.tool_use_id as string, content: b.content as string });
    }
  }
  return out;
}
const retainedBytes = (messages: readonly Msg[]): number =>
  toolResults(messages)
    .filter((r) => !r.content.includes(SCOUT_CONTEXT_ELISION_MARK))
    .reduce((n, r) => n + Buffer.byteLength(r.content, "utf8"), 0);

test("older tool results are elided until the retained content is within budget", () => {
  const size = 40_000;
  const { messages, map } = conversation(6, size); // 240 KB of tool results, budget 100 KB
  boundToolResultContext(messages, SCOUT_CONTEXT_TOOL_RESULT_BUDGET, map);

  assert.ok(
    retainedBytes(messages) <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET + size,
    `retained ${retainedBytes(messages)} B exceeds the budget plus one result`,
  );
  const results = toolResults(messages);
  assert.ok(!results.at(-1)!.content.includes(SCOUT_CONTEXT_ELISION_MARK), "the newest result is always kept whole");
  const elided = results.filter((r) => r.content.includes(SCOUT_CONTEXT_ELISION_MARK));
  assert.ok(elided.length >= 1, "with 240 KB over a 100 KB budget, older results must be elided");
  for (const r of elided) {
    assert.match(r.content, /ar-\d+/, "an elided stub still points at its vaulted artifact id");
    assert.match(r.content, /rung \d+/, "an elided stub keeps its rung header");
  }
  assert.deepEqual(results.map((r) => r.id), ["t1", "t2", "t3", "t4", "t5", "t6"], "tool_use ids are preserved for pairing");
});

test("nothing is elided when the whole conversation fits", () => {
  const { messages, map } = conversation(3, 10_000); // 30 KB total, well under budget
  boundToolResultContext(messages, SCOUT_CONTEXT_TOOL_RESULT_BUDGET, map);
  assert.equal(toolResults(messages).filter((r) => r.content.includes(SCOUT_CONTEXT_ELISION_MARK)).length, 0);
});

test("a result with no artifact mapping (finish / record_rung) is never elided", () => {
  const { messages, map } = conversation(4, 40_000);
  // Simulate an early finish-style result that carries no representation and no artifact ids.
  map.delete("t1");
  boundToolResultContext(messages, SCOUT_CONTEXT_TOOL_RESULT_BUDGET, map);
  const t1 = toolResults(messages).find((r) => r.id === "t1")!;
  assert.ok(!t1.content.includes(SCOUT_CONTEXT_ELISION_MARK), "an unmapped result carries no representation to elide");
});

test("elision is stable: a second pass changes nothing", () => {
  const { messages, map } = conversation(6, 40_000);
  boundToolResultContext(messages, SCOUT_CONTEXT_TOOL_RESULT_BUDGET, map);
  const first = toolResults(messages).map((r) => r.content);
  boundToolResultContext(messages, SCOUT_CONTEXT_TOOL_RESULT_BUDGET, map);
  assert.deepEqual(toolResults(messages).map((r) => r.content), first, "already-elided blocks stay put");
});
