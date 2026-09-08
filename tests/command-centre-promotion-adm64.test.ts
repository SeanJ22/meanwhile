/**
 * **THE CONSOLE MAY NOT ANSWER FOR A PIPELINE IT DID NOT READ.**
 * (ADM-64 / ADM-70, the 9.7.26 admin feedback.)
 *
 * The command centre answered *"Is anything being published to readers?"* with
 * **"No. Promotion to readers is off, and 0 record classes are open."**, in
 * GREEN, from a hard-coded `false`.
 *
 * The law behind that `false` is real: the legacy nightly window is off until a
 * governed activation turns it on, and PR #293 built the readiness machinery
 * and deliberately left it off. What changed is that PR #301 landed a second
 * promotion path — the routine civic data plane — which does not import that
 * gate, promotes from the standing runner, and is consumed by reader surfaces.
 *
 * So a true statement about one pipeline became a false statement about the
 * product. This is the single failure the whole admin surface exists to
 * prevent, and a boolean could not express the honest answer, which is that
 * nobody asked.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { commandCentre, type CommandCentreInput } from "@/lib/control-plane/command-centre.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BASE: CommandCentreInput = {
  runner: { state: "Active", level: "GREEN", needsYou: false, action: null },
  code: null,
  production: null,
  staging: null,
  steward: null,
  promotionOn: null,
  openRecordClasses: null,
  decisionsWaiting: 0,
  stuckIncidents: 0,
  latestReceipt: null,
  receiptGap: null,
};

function publishing(input: CommandCentreInput) {
  const answer = commandCentre(input).find((a) => a.question === "Is anything being published to readers?");
  assert.ok(answer, "the publishing question must always be asked");
  return answer;
}

test("unread promotion state is a named gap, never a confident No", () => {
  const answer = publishing(BASE);
  assert.equal(answer.says, null, "an unread state must not produce a sentence");
  assert.ok(answer.gap && answer.gap.length > 40, "the gap has to say what was not read");
  assert.equal(answer.level, "UNKNOWN", "not GREEN — green is a claim that all is well");
});

test("the gap names BOTH promotion paths, because answering for one is the wrong answer", () => {
  const gap = publishing(BASE).gap ?? "";
  assert.match(gap, /legacy nightly window/i, gap);
  assert.match(gap, /routine civic data plane/i, gap);
});

test("a real reading still answers, in both directions", () => {
  const on = publishing({ ...BASE, promotionOn: true });
  assert.match(on.says ?? "", /is ON/);
  assert.equal(on.level, "AMBER", "promotion being on is worth noticing, not celebrating");

  const off = publishing({ ...BASE, promotionOn: false, openRecordClasses: 3 });
  assert.match(off.says ?? "", /off/i);
  assert.match(off.says ?? "", /3 record classes are open/);
  assert.equal(off.level, "GREEN");
});

/**
 * The guard that matters most: the home page must not go back to asserting an
 * answer it did not read. A hard-coded literal here is exactly how the false
 * sentence shipped in the first place.
 */
test("the home page does not hard-code a promotion answer", () => {
  const page = readFileSync(join(ROOT, "app/(admin)/admin/page.tsx"), "utf8");
  assert.match(page, /promotionOn: null/, "the page reads neither plane, so it must say so");
  assert.doesNotMatch(
    page,
    /promotionOn: (true|false)\b/,
    "a hard-coded promotion answer is a claim nothing on the render checked",
  );
});
