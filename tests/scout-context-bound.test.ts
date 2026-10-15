/**
 * Every turn re-sends the whole conversation against the cycle's payload budget,
 * so a job's accumulated context is bounded. The bound is a RESTART, never an
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
function conversation(n: number, size: number): { messages: Msg[]; steps: ScoutRung[] } {
  const messages: Msg[] = [{ role: "user", content: [{ type: "text", text: "the brief" }] }];
  const steps: ScoutRung[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = `t${i}`;
    steps.push({ index: i - 1, rung: "fetch_public", tool: "fetch_public", target: `https://x/${i}`, observed: "HTTP 200", artifactIds: [`ar-${i}`], note: null, at: "2026-09-25T00:00:00.000Z" });
    messages.push({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: `sig-${i}` }, { type: "tool_use", id, name: "fetch_public", input: { url: `https://x/${i}` } }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: String(i % 10).repeat(size) }] });
  }
  return { messages, steps };
}

const carry = (c: ReturnType<typeof conversation>, restart = 1, reported: readonly string[] = []) =>
  scoutCarriedForward({ messages: c.messages, steps: c.steps, reported, budgetBytes: SCOUT_CONTEXT_TOOL_RESULT_BUDGET, restart });

test("the carried-forward block lists every step, keeps the newest results whole, and fits older ones in half the budget", () => {
  const size = SCOUT_CONTEXT_TOOL_RESULT_BUDGET / 4;
  const c = conversation(6, size);
  assert.ok(representationBytesIn(c.messages) > SCOUT_CONTEXT_TOOL_RESULT_BUDGET, "this conversation is over the budget, so the executor would restart it");
  const text = carry(c, 1, ["name = \"Lee Park\" for place:beta"]);
  assert.ok(text.startsWith(`${SCOUT_CARRIED_FORWARD_MARK} (restart 1)`));
  for (let i = 1; i <= 6; i += 1) assert.ok(text.includes(`- fetch_public https://x/${i} · HTTP 200`), `step ${i} is carried`);
  assert.match(text, /FACTS ALREADY IN THE BOX \(1\)[^\n]*\n- name = "Lee Park" for place:beta/);
  assert.ok(text.includes("6".repeat(size)), "the newest result is carried whole");
  assert.ok(text.includes("5".repeat(size)), "the next newest fits in half the budget");
  assert.ok(!text.includes("4".repeat(size)), "an older result that does not fit in half the budget is its step line only");
  assert.ok(Buffer.byteLength(text, "utf8") <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET, "the restarted conversation starts under the budget");
  assert.doesNotMatch(text, /sig-\d/, "no thinking block or signature is carried: nothing in it is tied to the old transcript");
  assert.equal(representationBytesIn([{ role: "user", content: [{ type: "text", text: "the brief" }, { type: "text", text }] }]), Buffer.byteLength(text, "utf8"), "the carried block counts toward the next restart");
});

test("nothing is over the budget when the whole conversation fits, and small older results are carried whole", () => {
  const c = conversation(3, 5_000);
  assert.ok(representationBytesIn(c.messages) <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET);
  const text = carry(c);
  for (const d of ["1", "2", "3"]) assert.ok(text.includes(d.repeat(5_000)), `result ${d} fits in half the budget and is carried whole`);
});

test("the carried-forward block is a pure function of the record: the same conversation gives the same bytes", () => {
  const a = conversation(6, 15_000);
  const b = conversation(6, 15_000);
  assert.equal(carry(a, 2), carry(b, 2));
});
