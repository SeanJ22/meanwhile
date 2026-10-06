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
      return new Response(JSON.stringify({ model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "{\"screens\":[]}" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const call = lookModelCall({} as ControlPlaneRepositories, "key", fake);
    const text = await call({ prompt: "p", schema: { type: "object", properties: { a: { type: "string", minLength: 1, maxLength: 9 } } }, images: [{ label: "ballot page, phone", mediaType: "image/png", base64: "AAAA" }] });
    assert.equal(text, "{\"screens\":[]}");
    const content = sent!.messages[0].content;
    assert.equal(content[0].text, "Screen: ballot page, phone");
    assert.equal(content[1].type, "image");
    assert.equal(content[1].source?.data, "AAAA");
    assert.ok(!JSON.stringify(sent!.output_config).includes("minLength"));
  });
});
