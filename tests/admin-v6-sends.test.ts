import assert from "node:assert/strict";
import test from "node:test";
import { sendViews, type SendIntentRaw } from "../lib/control-plane/admin-view/v6-sends-read.ts";

const dispatch = (id: string, at: string, note = "Deploy fleet to Arizona"): SendIntentRaw => ({ intentId: id, action: "DISPATCH", note, requestedAt: at });
const cancel = (id: string, at: string, target: string): SendIntentRaw => ({ intentId: id, action: "CANCEL_DISPATCH", note: target, requestedAt: at });

test("a sent instruction shows where it stands, and can be taken back only while it is waiting or carried", () => {
  const out = sendViews({
    intents: [dispatch("DISPATCH:2026-09-30T10:00:00.000Z", "2026-09-30T10:00:00.000Z", "waiting one"), dispatch("DISPATCH:2026-09-30T09:00:00.000Z", "2026-09-30T09:00:00.000Z", "carried one"),
      dispatch("DISPATCH:2026-09-30T08:00:00.000Z", "2026-09-30T08:00:00.000Z", "finished one")],
    honored: [{ honors: "DISPATCH:2026-09-30T09:00:00.000Z", honoredAt: "2026-09-30T09:05:00.000Z", detail: "matched 10" }, { honors: "DISPATCH:2026-09-30T08:00:00.000Z", honoredAt: "2026-09-30T08:05:00.000Z", detail: "matched 0" }],
    carried: [{ ref: "DISPATCH:2026-09-30T09:00:00.000Z", deferred: 677, created: 12 }],
  });
  assert.deepEqual(out.map((s) => [s.words, s.state, s.canCancel]), [["waiting one", "waiting", true], ["carried one", "carried", true], ["finished one", "finished", false]]);
  assert.match(out[1].stateWords, /677 requirements left to create, 12 created so far/);
  assert.equal(out[1].ranAs, "matched 10");
});

test("taking one back is a request until the runner records it, and only then does it read as taken back", () => {
  const id = "DISPATCH:2026-09-30T09:00:00.000Z";
  const base = { intents: [dispatch(id, "2026-09-30T09:00:00.000Z"), cancel("CANCEL_DISPATCH:2026-09-30T11:00:00.000Z", "2026-09-30T11:00:00.000Z", id)], carried: [{ ref: id, deferred: 5, created: 0 }] };
  const asked = sendViews({ ...base, honored: [{ honors: id, honoredAt: "x", detail: "" }] })[0];
  assert.equal(asked.state, "cancel-requested");
  assert.equal(asked.canCancel, false);
  const done = sendViews({ ...base, honored: [{ honors: id, honoredAt: "x", detail: "" }, { honors: "CANCEL_DISPATCH:2026-09-30T11:00:00.000Z", honoredAt: "y", detail: "no longer carried" }] })[0];
  assert.equal(done.state, "cancelled");
  assert.equal(done.canCancel, false);
});
