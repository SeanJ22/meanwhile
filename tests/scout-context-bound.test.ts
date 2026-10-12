/**
 * Every turn re-sends the whole conversation against the cycle's payload budget,
 * so a Scout's accumulated context is bounded. The bound is a RESTART, never an
 * in-place edit of history (which invalidates every later thinking block): the
 * next request is the brief plus one carried-forward block built from the
 * machine's record (`scoutCarriedForward`), with nothing earlier replayed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOUT_CARRIED_FORWARD_MARK,
  SCOUT_CONTEXT_TOOL_RESULT_BUDGET,
  representationBytesIn,
  scoutCarriedForward,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import type { ScoutRung } from "../lib/control-plane/scheduler/scout-result.ts";

type Msg = { role: "user" | "assistant"; content: unknown };

/** N turns, each an assistant tool_use + a user tool_result of `size` bytes, ids t1..tN. */
function conversation(n: number, size: number): { messages: Msg[]; map: Map<string, string[]>; rungs: ScoutRung[] } {
  const messages: Msg[] = [{ role: "user", content: [{ type: "text", text: "the brief" }] }];
  const map = new Map<string, string[]>();
  const rungs: ScoutRung[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = `t${i}`;
    map.set(id, [`ar-${i}`]);
    rungs.push({ index: i - 1, rung: "primary-site-navigation", tool: "fetch_public", target: `https://x/${i}`, observed: "HTTP 200", artifactIds: [`ar-${i}`], note: i === 1 ? "the home page" : null, at: "2026-09-25T00:00:00.000Z" });
    messages.push({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: `sig-${i}` }, { type: "tool_use", id, name: "fetch_public", input: { url: `https://x/${i}` } }] });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: `[rung ${i - 1}: fetch_public -> https://x/${i}]\n` + String(i % 10).repeat(size) }],
    });
  }
  return { messages, map, rungs };
}

const carry = (c: ReturnType<typeof conversation>, restart = 1) =>
  scoutCarriedForward({ messages: c.messages, rungs: c.rungs, artifactIdsByToolUse: c.map, budgetBytes: SCOUT_CONTEXT_TOOL_RESULT_BUDGET, restart, state: "WHERE THE ATTEMPT STANDS: test" });

test("the carried-forward block lists every rung with its artifact ids, keeps the newest representation whole, and fits older ones in half the budget", () => {
  const size = 40_000;
  const c = conversation(6, size); // 240 KB of tool results, budget 100 KB
  assert.ok(representationBytesIn(c.messages) > SCOUT_CONTEXT_TOOL_RESULT_BUDGET, "this conversation is over the budget, so the executor would restart it");
  const text = carry(c);
  assert.ok(text.startsWith(`${SCOUT_CARRIED_FORWARD_MARK} (restart 1 of this Attempt)`));
  for (let i = 1; i <= 6; i += 1) assert.match(text, new RegExp(`\\[${i - 1}\\] fetch_public primary-site-navigation → https://x/${i} · HTTP 200${i === 1 ? " · your note: the home page" : ""} · artifacts ar-${i}`), `rung ${i - 1} is carried with its artifact id`);
  assert.ok(text.includes("6".repeat(size)), "the newest representation is carried whole");
  assert.ok(!text.includes("5".repeat(size)), "an older representation that does not fit in half the budget is its rung line only");
  assert.match(text, /5 earlier results are not repeated; each is its rung above/);
  assert.ok(Buffer.byteLength(text, "utf8") <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET, "the restarted conversation starts under the budget");
  assert.doesNotMatch(text, /sig-\d/, "no thinking block or signature is carried: nothing in it is tied to the old transcript");
  assert.equal(representationBytesIn([{ role: "user", content: [{ type: "text", text: "the brief" }, { type: "text", text }] }]), Buffer.byteLength(text, "utf8"), "the carried block counts toward the next restart");
});

test("nothing is over the budget when the whole conversation fits, and small older results are carried whole", () => {
  const c = conversation(3, 10_000); // 30 KB total, well under budget
  assert.ok(representationBytesIn(c.messages) <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET);
  const text = carry(c);
  for (const d of ["1", "2", "3"]) assert.ok(text.includes(d.repeat(10_000)), `result ${d} fits in half the budget and is carried whole`);
  assert.doesNotMatch(text, /not repeated/);
});

test("the most recent turn's finish refusal and record_rung answer are carried whole; an older one is not", () => {
  const c = conversation(4, 40_000);
  // An early finish refusal (no artifact mapping), then the newest turn's own refusal beside a fetch.
  (c.messages[2].content as Record<string, unknown>[]).push({ type: "tool_result", tool_use_id: "old-finish", is_error: true, content: "REFUSED — old refusal" });
  (c.messages[1].content as Record<string, unknown>[]).push({ type: "tool_use", id: "old-finish", name: "finish", input: {} });
  (c.messages.at(-2)!.content as Record<string, unknown>[]).push({ type: "tool_use", id: "new-finish", name: "finish", input: {} });
  (c.messages.at(-1)!.content as Record<string, unknown>[]).push({ type: "tool_result", tool_use_id: "new-finish", is_error: true, content: "REFUSED — fix and call finish again:\n- SCOUT_EARLY_ABSENCE: too early" });
  const text = carry(c);
  assert.match(text, /--- finish · call new-finish · error ---\nREFUSED — fix and call finish again:\n- SCOUT_EARLY_ABSENCE: too early/);
  assert.doesNotMatch(text, /old refusal/, "an older turn's refusal was already answered; it is not news");
});

test("the carried-forward block is a pure function of the record: the same conversation gives the same bytes", () => {
  const a = conversation(6, 40_000);
  const b = conversation(6, 40_000);
  assert.equal(carry(a, 2), carry(b, 2));
});
