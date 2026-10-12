import assert from "node:assert/strict";
import test from "node:test";

import { askHedgeMs, hedgedFetch } from "../lib/ask/hedged-fetch.ts";

/** A stalled reading is asked again: the first answer wins, only the loser is stopped, a failure is retried at once, and the hedge can be switched off. */

const ok = (text: string) => new Response(text, { status: 200 });

/** A fetch whose n-th call takes plans[n] ms (or rejects), and which records what it was asked and whether it was aborted. */
function planned(plans: (number | "fail")[]) {
  const seen: { at: number; aborted: boolean }[] = [];
  const impl = (async (_url: unknown, init?: RequestInit) => {
    const index = seen.length;
    const call = { at: Date.now(), aborted: false };
    seen.push(call);
    const plan = plans[index] ?? 0;
    if (plan === "fail") throw new TypeError("network");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, plan);
      init?.signal?.addEventListener("abort", () => { call.aborted = true; clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
    });
    return ok(`answer ${index}`);
  }) as typeof fetch;
  return { impl, seen };
}

test("an answer before the hedge time is the only call", async () => {
  const { impl, seen } = planned([20]);
  const response = await hedgedFetch(impl, "https://x.example", {}, { hedgeAfterMs: 100, timeoutMs: 2_000 });
  assert.equal(await response.text(), "answer 0");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(seen.length, 1, "no second call");
});

test("a stalled call is asked again at the hedge time; the first answer wins and only the loser is stopped", async () => {
  const { impl, seen } = planned([1_000, 30]);
  const started = Date.now();
  const response = await hedgedFetch(impl, "https://x.example", {}, { hedgeAfterMs: 100, timeoutMs: 2_000 });
  const took = Date.now() - started;
  assert.equal(await response.text(), "answer 1", "the second call's body is readable after the loser is stopped");
  assert.equal(seen.length, 2);
  assert.ok(took >= 100 && took < 500, `answered in ${took} ms, not the stalled call's 1000`);
  assert.deepEqual(seen.map((call) => call.aborted), [true, false]);
});

test("a call that fails before the hedge time returns without an unchanged retry", async () => {
  const { impl, seen } = planned(["fail", 20]);
  const started = Date.now();
  await assert.rejects(hedgedFetch(impl, "https://x.example", {}, { hedgeAfterMs: 1_000, timeoutMs: 2_000 }), /network/);
  assert.ok(Date.now() - started < 400, "not held for the hedge time");
  assert.equal(seen.length, 1);
});

test("both calls failing is a failure, and the overall timeout still bounds the wait", async () => {
  await assert.rejects(hedgedFetch(planned(["fail", "fail"]).impl, "https://x.example", {}, { hedgeAfterMs: 50, timeoutMs: 2_000 }), /network/);
  await assert.rejects(hedgedFetch(planned([5_000, 5_000]).impl, "https://x.example", {}, { hedgeAfterMs: 50, timeoutMs: 200 }), /aborted|timeout/i);
});

test("switched off, it is one call with the timeout; the delay reads WTP_ASK_HEDGE_MS", async () => {
  const { impl, seen } = planned([300]);
  const response = await hedgedFetch(impl, "https://x.example", {}, { hedgeAfterMs: null, timeoutMs: 2_000 });
  assert.equal(await response.text(), "answer 0");
  assert.equal(seen.length, 1);
  assert.equal(askHedgeMs({}), 1_800);
  assert.equal(askHedgeMs({ WTP_ASK_HEDGE_MS: "2500" }), 2_500);
  assert.equal(askHedgeMs({ WTP_ASK_HEDGE_MS: "off" }), null);
  assert.equal(askHedgeMs({ WTP_ASK_HEDGE_MS: "nonsense" }), 1_800);
});
