/**
 * THE INTENDED END STATE OF `main`'s PROTECTION, AS A TEST.
 * (2026-08-26, the unblock-pushers session. RULING 163.)
 *
 * `pnpm protection:verify` reads the live API, and the live API is not
 * available to every runner. This file asserts the JUDGEMENT — the pure half in
 * `lib/ops/protection-state.ts` — against constructed payloads, so the end
 * state is pinned in the repo rather than only in a ruling's table.
 *
 * The load-bearing case is the LAST one: the post-change shape Sean is being
 * asked to click. It is asserted here BEFORE it exists on the server, which is
 * the only way the click-list can be checked against anything.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ACTIONS_APP_ID, judgeProtection } from "../lib/ops/protection-state.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";

const CONTEXTS = REQUIRED_CONTEXTS;

/** The classic protection this repo carried from 2026-08-25, read from the API that day. */
const CLASSIC_TODAY = {
  required_status_checks: { strict: true, contexts: [...CONTEXTS] },
  required_pull_request_reviews: { required_approving_review_count: 0 },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
};

/** The ruleset shape the click-list asks for. */
function ruleset(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "main",
    enforcement: "active",
    target: "branch",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [{ actor_type: "Integration", actor_id: ACTIONS_APP_ID, bypass_mode: "always" }],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: CONTEXTS.map((c) => ({ context: c })),
        },
      },
    ],
    ...overrides,
  };
}

const complete = (classic: unknown, rulesets: unknown[]) =>
  ({ classic, rulesets, complete: true, unreachable: [] }) as never;

/* ---- cannot-tell is never a pass ------------------------------------------ */

test("RULING 163: an unreadable API is COULD-NOT-TELL, never intact", () => {
  const r = judgeProtection(
    { classic: null, rulesets: [], complete: false, unreachable: ["branches/main/protection: HTTP 401"] },
    CONTEXTS,
  );
  assert.equal(r.verdict, "cannot-tell");
  assert.match(r.summary, /not a pass/i);
});

test("RULING 163: no protection at all is DRIFTED and says so plainly", () => {
  const r = judgeProtection(complete(null, []), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  assert.match(r.summary, /not protected/);
});

/* ---- today's state, which is the reason this session exists --------------- */

test("RULING 163: today's classic protection is DRIFTED only on the missing bot bypass", () => {
  const r = judgeProtection(complete(CLASSIC_TODAY, []), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  assert.equal(r.shape, "classic");

  const failed = r.assertions.filter((a) => a.ok === false);
  assert.equal(failed.length, 1, `expected exactly one failure, got: ${failed.map((f) => f.name).join(", ")}`);
  assert.match(failed[0].name, /Actions app/);
  assert.match(failed[0].detail, /ABSENT/);

  // The four that must survive the change for humans and for Claude Code.
  for (const name of [/pull request is required/, /up to date/, /required contexts/, /no human or admin/]) {
    const a = r.assertions.find((x) => name.test(x.name));
    assert.ok(a && a.ok === true, `${name} must hold today: ${a?.detail}`);
  }
});

/* ---- the end state the click-list asks for -------------------------------- */

test("RULING 163: the ruleset end state is INTACT — this is what Sean is clicking toward", () => {
  const r = judgeProtection(complete(null, [ruleset()]), CONTEXTS);
  assert.equal(r.verdict, "intact", r.summary);
  assert.equal(r.shape, "ruleset");
  assert.equal(r.assertions.filter((a) => a.ok !== true).length, 0);
});

/* ---- the ways the end state could be got wrong ---------------------------- */

test("RULING 163: a bypass granted to anyone but the Actions app is DRIFTED", () => {
  // The failure that matters most: a human bypass reopens the 8/25 hole.
  const withHuman = ruleset({
    bypass_actors: [
      { actor_type: "Integration", actor_id: ACTIONS_APP_ID, bypass_mode: "always" },
      { actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" },
    ],
  });
  const r = judgeProtection(complete(null, [withHuman]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  const human = r.assertions.find((a) => /no human or admin/.test(a.name))!;
  assert.equal(human.ok, false);
  assert.match(human.detail, /RepositoryRole/);
});

test("RULING 156 + 163: a RENAMED required context reads as MISSING, not as agreement", () => {
  // The rename hazard, at the protection layer. A job rename that is not
  // re-registered leaves GitHub with nothing to wait for and the merge button
  // green — so the verifier must go red on it.
  const renamed = ruleset({
    rules: [
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "build (default)" },
            { context: "build (standalone)" },
            { context: "gates (test, lint, tsc)" }, // middots tidied away
          ],
        },
      },
    ],
  });
  const r = judgeProtection(complete(null, [renamed]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  const contexts = r.assertions.find((a) => /required contexts/.test(a.name))!;
  assert.equal(contexts.ok, false);
  assert.match(contexts.detail, /MISSING/);
  assert.match(contexts.detail, /gates \(test · lint · tsc\)/);
});

test("RULING 163: a ruleset that forgets strict is DRIFTED", () => {
  const lax = ruleset({
    rules: [
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: CONTEXTS.map((c) => ({ context: c })),
        },
      },
    ],
  });
  const r = judgeProtection(complete(null, [lax]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  assert.equal(r.assertions.find((a) => /up to date/.test(a.name))!.ok, false);
});

test("RULING 163: an EVALUATE-mode ruleset does not count as protection", () => {
  // GitHub's "evaluate" mode reports what WOULD have happened and blocks
  // nothing. A verifier that counted it would report intact on a branch
  // anybody can push to.
  const r = judgeProtection(complete(null, [ruleset({ enforcement: "evaluate" })]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  assert.match(r.summary, /not protected/);
});

test("RULING 163: classic protection left ON beside the ruleset still blocks the bot, and is reported", () => {
  // The trap in the click-list: classic protection and rulesets are ADDITIVE.
  // Leaving classic in place means the bot is still refused even though the
  // ruleset grants it a bypass — the change would look done and nothing would
  // work. The shape is reported so that state is legible.
  const r = judgeProtection(complete(CLASSIC_TODAY, [ruleset()]), CONTEXTS);
  assert.equal(r.shape, "both", "both shapes present must be visible in the report");
});
