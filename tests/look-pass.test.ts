import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQueue } from "../app/(admin)/_mw/admin-v6/queue.ts";
import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";
import type { FixItem } from "../lib/control-plane/fix-list.ts";
import { withFixAdded } from "../lib/control-plane/fix-list.ts";
import type { AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import {
  lookFixAdds, lookOwed, lookPass, lookShotKey, lookShotsByFix, lookTargets, lookView, withFixIds, type LookScreen, type ShotScreen,
} from "../lib/frontend/look-pass.ts";
import { LOOK_QUESTIONS, type LookReviewOutcome } from "../lib/frontend/look-review.ts";
import { resolveRollingCeiling } from "../lib/control-plane/fleet-safety.ts";
import { lookModelCall, lookReviewBoundUsd, lookSpendDecision } from "../lib/frontend/look-spend.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { priceMeteredUsage, readMeteredUsage } from "../lib/control-plane/model-cost.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const AT = "2026-10-06T02:00:00.000Z";
const answers = Object.fromEntries(LOOK_QUESTIONS.map((q) => [q, "yes"])) as Record<(typeof LOOK_QUESTIONS)[number], string>;
const shots = (): ShotScreen[] => lookTargets(["00001"], ["home", "ballot"]).map((target) => ({
  target, shot: lookShotKey(SHA, AT, target), issues: {}, issueLines: [], failed: null,
}));
const reviewed = (verdicts: ("red" | "green")[]): LookReviewOutcome => ({
  kind: "REVIEWED", red: verdicts.filter((v) => v === "red").length,
  screens: verdicts.map((verdict, i) => ({ label: `s${i}`, answers, verdict, element: verdict === "red" ? "a 9px date label" : null })),
});
const url = (key: string) => `/shot/${key}`;

it("look-review climbs only for an invalid answer and accepts a valid red review on any tier", async () => {
  for (const failures of [0, 1, 2]) {
    const repos = createMemoryRepositories(), sent: string[] = [];
    await repos.adminConfig.put("current", { apiFallback: { enabled: false }, updatedAt: AT,
      fleetSpendCeiling: { rollingCeilingUsd: 100, decidedAt: AT, decidedBy: "session", receiptId: "test", previousUsd: 10 } } as AdminConfig, AT);
    const raw = JSON.stringify({ screens: [{ label: "ballot", answers, verdict: "red", element: "A small date label" }] });
    const call = lookModelCall(repos, "test", async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model; sent.push(model);
      return Response.json({ model, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: sent.length <= failures ? "invalid" : raw }] });
    }, { env: { WTP_BACKGROUND_WORKER_BATCH: "0" } });
    assert.equal(await call({ prompt: "p", schema: {}, images: [{ label: "ballot", mediaType: "image/png", base64: "AAAA" }] }), raw);
    assert.deepEqual(sent, ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"].slice(0, failures + 1));
    assert.equal((await repos.costs.read("look-review")).length, sent.length);
  }
});
const emptyQueue = { items: [], counts: { queued: 0, sent: 0, opened: 0, refused: 0 } } as unknown as Parameters<typeof v6FixesView>[0];

describe("FE-21: every deploy is looked at on the live site", () => {
  it("shoots every surface on a phone and a desktop, with screenshots under the signed-in prefix", () => {
    const targets = lookTargets(["00001"]);
    assert.equal(targets.length, 8);
    assert.deepEqual(new Set(targets.map((t) => t.profile)), new Set(["phone", "desktop"]));
    assert.ok(targets.every((t) => lookShotKey(SHA, AT, t).startsWith("resident-tasks/look/2026-10-06/")));
  });

  it("looks at each served commit once, and never at an unknown one", () => {
    assert.equal(lookOwed(SHA, new Set()), true);
    assert.equal(lookOwed(SHA, new Set([SHA])), false);
    assert.equal(lookOwed(null, new Set()), false);
    assert.equal(lookOwed("not a commit", new Set()), false);
  });

  it("an entry is green only when every screen was reviewed and none is red", () => {
    const s = shots();
    assert.equal(lookPass({ sha: SHA, at: AT, runId: "r", shots: s, reviewed: s, outcome: reviewed(["green", "green", "green", "green"]) }).verdict, "green");
    const red = lookPass({ sha: SHA, at: AT, runId: "r", shots: s, reviewed: s, outcome: reviewed(["green", "red", "green", "green"]) });
    assert.equal(red.verdict, "red");
    assert.deepEqual([red.red, red.green, red.notReviewed], [1, 3, 0]);
    const held = lookPass({ sha: SHA, at: AT, runId: "r", shots: s, reviewed: s, outcome: { kind: "NOT_RUN", why: "spend-refused" } });
    assert.equal(held.verdict, "not reviewed");
    assert.match(held.reviewerSays ?? "", /spending limit/);
  });

  it("a screen that failed to load is not reviewed, and the verdicts stay with the screens that were sent", () => {
    const s = shots();
    const failed = { ...s[0], shot: null, failed: "it never became usable within 20 seconds" };
    const all = [failed, ...s.slice(1)];
    const pass = lookPass({ sha: SHA, at: AT, runId: "r", shots: all, reviewed: s.slice(1), outcome: reviewed(["red", "green", "green"]) });
    assert.equal(pass.screens[0].verdict, "not reviewed");
    assert.equal(pass.screens[1].verdict, "red");
    assert.equal(pass.verdict, "red");
  });

  it("a red flag becomes one fix-list item that points at its screenshot; the same red next deploy is the same item", () => {
    const s = shots();
    const pass = lookPass({ sha: SHA, at: AT, runId: "r", shots: s, reviewed: s, outcome: reviewed(["green", "red", "green", "green"]) });
    const adds = lookFixAdds(pass);
    assert.equal(adds.length, 1);
    assert.match(adds[0].add.says, /a 9px date label/);
    let config = { apiFallback: { enabled: false }, updatedAt: AT } as unknown as AdminConfig;
    config = withFixAdded(config, { ...adds[0].add, addedBy: "The look check", at: AT });
    config = withFixAdded(config, { ...adds[0].add, addedBy: "The look check", at: "2026-10-07T00:00:00.000Z" });
    const items = config.fixList as readonly FixItem[];
    assert.equal(items.length, 1);

    const withIds = withFixIds(pass, new Map<LookScreen, string>([[adds[0].screen, items[0].id]]));
    const byFix = lookShotsByFix([withIds], url);
    assert.deepEqual(byFix.get(items[0].id), [{ label: adds[0].screen.label, image: url(adds[0].screen.shot!) }]);

    // Admin: the fix carries its screenshot, and the Queue shows the deploy's look check.
    const view = v6FixesView(emptyQueue, items, AT, undefined, { view: lookView(withIds, url), shots: byFix });
    assert.deepEqual(view.open[0].shots, byFix.get(items[0].id));
    assert.equal(view.look?.verdict, "Red");
    assert.equal(view.look?.screens[0].verdict, "Red");
    assert.equal(view.look?.screens[0].image, url(adds[0].screen.shot!));
    const row = buildQueue({ receipts: null, sends: null, hunts: null, stuck: null, fixes: view, doors: null, scheduled: null }).find((r) => r.kind === "look");
    assert.equal(row?.filter, "needs-me");
    assert.deepEqual(row?.open, { type: "look", id: SHA });
  });

  it("green flags are counted, and a green deploy is done on the Queue", () => {
    const s = shots();
    const pass = lookPass({ sha: SHA, at: AT, runId: "r", shots: s, reviewed: s, outcome: reviewed(["green", "green", "green", "green"]) });
    const v = lookView(pass, url)!;
    assert.equal(v.summary, "All 4 screens look right.");
    const row = buildQueue({ receipts: null, sends: null, hunts: null, stuck: null, fixes: { open: [], closed: [], returned: [], look: v }, doors: null, scheduled: null })[0];
    assert.equal(row.filter, "done");
    assert.equal(row.chip, "Looks right");
  });
});

describe("FE-21: the reviewer runs only under the owner's spend controls", () => {
  const config = (ceiling: number) => ({ value: { apiFallback: { enabled: false }, updatedAt: AT, fleetSpendCeiling: { rollingCeilingUsd: ceiling, decidedAt: AT, decidedBy: "session", receiptId: "r1", previousUsd: 10 } } });
  it("refuses with no room under the rolling ceiling, unmeasured spend, an unreadable setting or a pause", () => {
    // With no dial set, the fallback ceiling is in force, the same as for research.
    assert.equal(lookSpendDecision({ adminConfigRow: null, intentLog: [], windowUsd: 0 }, 8).ok, resolveRollingCeiling(null).rollingCeilingUsd > lookReviewBoundUsd(8));
    assert.equal(lookSpendDecision({ adminConfigRow: config(5), intentLog: [], windowUsd: null }, 8).ok, false);
    assert.equal(lookSpendDecision({ adminConfigRow: { unreadable: "x" }, intentLog: [], windowUsd: 0 }, 8).ok, false);
    assert.equal(lookSpendDecision({ adminConfigRow: null, intentLog: null, windowUsd: 0 }, 8).ok, false);
    const c = config(5);
    const room = lookSpendDecision({ adminConfigRow: c, intentLog: [], windowUsd: 5 - lookReviewBoundUsd(8) / 2 }, 8);
    assert.equal(room.ok, false, "a review that would cross the ceiling is refused before it is sent");
    assert.equal(lookSpendDecision({ adminConfigRow: c, intentLog: [], windowUsd: 1 }, 8).ok, true);
    const paused = [{ kind: "INTENT", intentId: "i1", action: "PAUSE", requestedAt: AT, actor: "owner", adminSessionRef: "s" }];
    assert.equal(lookSpendDecision({ adminConfigRow: config(5), intentLog: paused, windowUsd: 0 }, 8).ok, false);
  });
});

describe("FE-21: the reviewer's model call", () => {
  it("sends each screenshot with its label and only the schema's shape, and returns the model's text", async () => {
    let sent: { model: string; messages: { content: { type: string; text?: string; source?: { data: string } }[] }[]; output_config: unknown } | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify({ screens: [{ label: "screen", verdict: "green", element: null, answers: { beautiful: "Clear", easy: "Clear", instant: "Clear", come_back: "Clear", show_a_friend: "Clear" } }] }) }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const call = lookModelCall({} as ControlPlaneRepositories, "key", fake, { env: { WTP_BACKGROUND_WORKER_BATCH: "0" } });
    const text = await call({ prompt: "p", schema: { type: "object", properties: { a: { type: "string", minLength: 1, maxLength: 9 } } }, images: [{ label: "ballot page, phone", mediaType: "image/png", base64: "AAAA" }] });
    assert.equal(text, JSON.stringify({ screens: [{ label: "screen", verdict: "green", element: null, answers: { beautiful: "Clear", easy: "Clear", instant: "Clear", come_back: "Clear", show_a_friend: "Clear" } }] }));
    const content = sent!.messages[0].content;
    assert.equal(content[0].text, "Screen: ballot page, phone");
    assert.equal(content[1].type, "image");
    assert.equal(content[1].source?.data, "AAAA");
    assert.ok(!JSON.stringify(sent!.output_config).includes("minLength"));
  });

  it("goes through the Batches API at half price when the audit batch lane is on (River, Oct 6)", async () => {
    const urls: string[] = [];
    let submitted: { requests: { custom_id: string; params: { model: string; messages: unknown[] } }[] } | null = null;
    let polls = 0;
    const fake = (async (url: string, init: RequestInit = {}) => {
      urls.push(`${init.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/messages/batches") && init.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return Response.json({ id: "b1", processing_status: "in_progress", request_counts: {}, results_url: null });
      }
      if (url.endsWith("/batches/b1")) {
        polls += 1;
        return Response.json({ id: "b1", processing_status: polls > 1 ? "ended" : "in_progress", request_counts: {}, results_url: "https://api.anthropic.com/r/b1" });
      }
      if (url.endsWith("/r/b1")) {
        const id = submitted!.requests[0].custom_id;
        return new Response(`${JSON.stringify({ custom_id: id, result: { type: "succeeded", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ screens: [{ label: "screen", verdict: "green", element: null, answers: { beautiful: "Clear", easy: "Clear", instant: "Clear", come_back: "Clear", show_a_friend: "Clear" } }] }) }] } } })}\n`);
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const costs: { cost: { usd: number | null }; resultKind?: string }[] = [];
    const repos = { costs: { append: async (_w: string, _id: string, e: never) => { costs.push(e); } } } as unknown as ControlPlaneRepositories;
    const call = lookModelCall(repos, "key", fake, { env: {}, sleep: async () => {}, pollIntervalMs: 0 });
    const text = await call({ prompt: "p", schema: { type: "object" }, images: [{ label: "home, phone", mediaType: "image/png", base64: "AAAA" }] });
    assert.equal(text, JSON.stringify({ screens: [{ label: "screen", verdict: "green", element: null, answers: { beautiful: "Clear", easy: "Clear", instant: "Clear", come_back: "Clear", show_a_friend: "Clear" } }] }));
    assert.equal(submitted!.requests.length, 1);
    assert.ok(submitted!.requests[0].custom_id.startsWith("look-review-"));
    assert.ok(!urls.some((u) => u.endsWith("/v1/messages")), "no Messages request when batched");
    const full = priceMeteredUsage("claude-sonnet-5-5", readMeteredUsage({ input_tokens: 1_000_000, output_tokens: 0 }), "5m").usd!;
    assert.equal(costs.length, 1);
    assert.equal(costs[0].resultKind, "BATCH_SUCCEEDED");
    assert.ok(full > 0 && Math.abs(costs[0].cost.usd! - full / 2) < 1e-9, "the ledger keeps the batch price");
  });

  it("cancels a batch that outlasts its wait, so the screens stay not judged rather than paid for unread", async () => {
    const urls: string[] = [];
    const fake = (async (url: string, init: RequestInit = {}) => {
      urls.push(`${init.method ?? "GET"} ${url}`);
      if (url.endsWith("/cancel")) return Response.json({ id: "b2", processing_status: "canceling", request_counts: {}, results_url: null });
      return Response.json({ id: "b2", processing_status: "in_progress", request_counts: {}, results_url: null });
    }) as unknown as typeof fetch;
    const call = lookModelCall({} as ControlPlaneRepositories, "key", fake, { env: { WTP_BACKGROUND_WORKER_BATCH: "on" }, sleep: async () => {}, batchWaitMs: -1 });
    await assert.rejects(call({ prompt: "p", schema: {}, images: [{ label: "x", mediaType: "image/png", base64: "AAAA" }] }), /LOOK_REVIEW_BATCH_TIMEOUT b2/);
    assert.ok(urls.includes("POST https://api.anthropic.com/v1/messages/batches/b2/cancel"));
  });
});
