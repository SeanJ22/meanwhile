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
    // THE REAL SHAPE AS OF 2026-08-26 (RULING 165). The Actions app is not
    // selectable in a ruleset's Add bypass list — confirmed against the live UI
    // — so the grant is to the Deploy keys CATEGORY, `actor_id` is null because
    // a single key cannot be named, and the mode is `exempt`, which skips
    // enforcement outright rather than evaluating and waving the actor through.
    bypass_actors: [{ actor_type: "DeployKey", actor_id: null, bypass_mode: "exempt" }],
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

/** One write-enabled deploy key — the intended end state under RULING 165. */
const ONE_WRITE_KEY = [{ id: 1, title: "wtp-scheduled-pushers", read_only: false, last_used: null }];

const complete = (classic: unknown, rulesets: unknown[], deployKeys: unknown = ONE_WRITE_KEY) =>
  ({ classic, rulesets, deployKeys, complete: true, unreachable: [] }) as never;

/* ---- cannot-tell is never a pass ------------------------------------------ */

test("RULING 163: an unreadable API is COULD-NOT-TELL, never intact", () => {
  const r = judgeProtection(
    { classic: null, rulesets: [], deployKeys: null, complete: false, unreachable: ["branches/main/protection: HTTP 401"] },
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
  assert.match(failed[0].name, /scheduled-push bypass/);
  assert.match(failed[0].detail, /ABSENT/);

  // The four that must survive the change for humans and for Claude Code.
  for (const name of [/pull request is required/, /up to date/, /required contexts/, /no human, admin, role or team/]) {
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
      { actor_type: "DeployKey", actor_id: null, bypass_mode: "exempt" },
      { actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" },
    ],
  });
  const r = judgeProtection(complete(null, [withHuman]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  const human = r.assertions.find((a) => /no human, admin, role or team/.test(a.name))!;
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


/* ---- the shape that is now REAL (2026-08-26, RULING 165) ------------------ */

/**
 * THE ACTIONS-APP PATH IS CLOSED, AND THE VERIFIER NOW SAYS SO.
 *
 * RULING 163 was written while one question was genuinely open — whether a
 * branch ruleset's `Add bypass` list offers the GitHub Actions app. It does
 * not: confirmed against the live UI on 2026-08-26, Apps tab filtered on
 * `actions`, zero suggestions. So the verifier stops accepting either machine
 * path and asserts the one that exists.
 */
test("RULING 165: the bypass must be Deploy keys — an Actions-app grant is DRIFT, not agreement", () => {
  const viaApp = ruleset({
    bypass_actors: [{ actor_type: "Integration", actor_id: ACTIONS_APP_ID, bypass_mode: "exempt" }],
  });
  const r = judgeProtection(complete(null, [viaApp]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  const grant = r.assertions.find((a) => /scheduled-push bypass/.test(a.name))!;
  assert.equal(grant.ok, false);
  assert.match(grant.detail, /not DeployKey/);
  assert.match(grant.detail, /platform changed/, "it points at the platform, not at a misconfiguration");
});

test("RULING 165: bypass mode `always` reads as DRIFTED, never as agreement", () => {
  /*
   * The two modes are not interchangeable and the difference is the reason the
   * mode is asserted at all. `always` still EVALUATES the ruleset and waves the
   * actor through afterward; `exempt` skips enforcement outright, which is what
   * GitHub recommends for trusted high-volume automation. A scheduled
   * deploy-key push is exactly that case, and it is Sean's settled decision —
   * so a mode that has quietly become `always` is drift away from a decision.
   */
  const always = ruleset({
    bypass_actors: [{ actor_type: "DeployKey", actor_id: null, bypass_mode: "always" }],
  });
  const r = judgeProtection(complete(null, [always]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  const grant = r.assertions.find((a) => /scheduled-push bypass/.test(a.name))!;
  assert.equal(grant.ok, false);
  assert.match(grant.detail, /"always"/);
  assert.match(grant.detail, /DRIFT, not agreement/);
});

/* ---- the bypass is CATEGORY-WIDE, so the key count is protection state ---- */

test("RULING 165: a SECOND write-enabled deploy key is DRIFT — the bypass is category-wide", () => {
  /*
   * `bypass_actors` names `DeployKey` with `actor_id: null`. There is no way to
   * grant the bypass to ONE key, so every write-enabled deploy key on this
   * repository silently holds it. A second key is a second route past every
   * rule in the ruleset that nobody decided to open — and it is invisible in
   * the ruleset itself, which is why it is read from a different endpoint.
   */
  const r = judgeProtection(
    complete(null, [ruleset()], [
      { id: 1, title: "wtp-scheduled-pushers", read_only: false },
      { id: 2, title: "some-other-integration", read_only: false },
    ]),
    CONTEXTS,
  );
  assert.equal(r.verdict, "drifted");
  const keys = r.assertions.find((a) => /write-enabled deploy key/.test(a.name))!;
  assert.equal(keys.ok, false);
  assert.match(keys.detail, /some-other-integration/, "the extra key is NAMED, not counted");
  assert.match(keys.detail, /CATEGORY-WIDE/);
});

test("RULING 165: a read-only deploy key beside the pusher is fine and is not miscounted", () => {
  // Read-only keys cannot push, so they do not inherit anything that matters.
  // Counting them would produce a false alarm on a perfectly correct repo.
  const r = judgeProtection(
    complete(null, [ruleset()], [
      { id: 1, title: "wtp-scheduled-pushers", read_only: false },
      { id: 2, title: "a-read-only-mirror", read_only: true },
    ]),
    CONTEXTS,
  );
  assert.equal(r.verdict, "intact", r.summary);
  const keys = r.assertions.find((a) => /write-enabled deploy key/.test(a.name))!;
  assert.match(keys.detail, /1 of 2 deploy key\(s\) can write/);
});

test("RULING 165: ZERO write-enabled deploy keys is DRIFT — a bypass granted to an empty category", () => {
  const r = judgeProtection(complete(null, [ruleset()], []), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  const keys = r.assertions.find((a) => /write-enabled deploy key/.test(a.name))!;
  assert.equal(keys.ok, false);
  assert.match(keys.detail, /no scheduled push can land/);
});

test("RULING 24 + 164: an UNREAD deploy-key list is cannot-tell, never a pass", () => {
  // `null` is not an empty list. A count nobody could read must never be
  // judged as one — the whole of RULING 24 in one assertion.
  const r = judgeProtection(complete(null, [ruleset()], null), CONTEXTS);
  assert.equal(r.verdict, "cannot-tell");
  const keys = r.assertions.find((a) => /write-enabled deploy key/.test(a.name))!;
  assert.equal(keys.ok, null);
});

/* ---- both shapes at once is DRIFT, not merely reported -------------------- */

test("RULING 165: shape `both` is DRIFTED — the two mechanisms STACK and the key is still refused", () => {
  /*
   * RULING 163 made this state visible. It was not enough: `shape: both` was
   * REPORTED and the verdict could still be `intact`, so the one arrangement in
   * which the whole cutover silently does nothing read as healthy.
   *
   * Classic branch protection has no per-actor bypass list at all. Left in
   * place beside the ruleset it refuses the deploy key whatever the ruleset
   * grants — the change looks done, every setting reads correct, and not one
   * scheduled push can land.
   */
  const r = judgeProtection(complete(CLASSIC_TODAY, [ruleset()]), CONTEXTS);
  assert.equal(r.shape, "both");
  assert.equal(r.verdict, "drifted", "reporting the shape was never enough — it must go RED");
  const only = r.assertions.find((a) => /exactly one protection mechanism/.test(a.name))!;
  assert.equal(only.ok, false);
  assert.match(only.detail, /STACK/);
  assert.match(only.detail, /Delete the classic rule/);
});

/* ---- deletions and force pushes ------------------------------------------ */

test("RULING 165: a ruleset that drops the deletion and force-push rules is DRIFTED", () => {
  const stripped = ruleset({
    rules: [
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: CONTEXTS.map((c) => ({ context: c })),
        },
      },
    ],
  });
  const r = judgeProtection(complete(null, [stripped]), CONTEXTS);
  assert.equal(r.verdict, "drifted");
  assert.equal(r.assertions.find((a) => /cannot be deleted/.test(a.name))!.ok, false);
  assert.equal(r.assertions.find((a) => /force pushes are blocked/.test(a.name))!.ok, false);
});

/* ---- the live end state, transcribed from the API ------------------------ */

test("RULING 165: the LIVE ruleset read from the API on 2026-08-26 is INTACT", () => {
  /*
   * A TRANSCRIPTION OF A SERVER FACT, not a wish — the same discipline
   * `REQUIRED_CONTEXTS` is held to. Read from
   * `repos/SeanJ22/We-The-People/rulesets/21572280` and `.../keys` on
   * 2026-08-26, after Sean's clicks landed. If the branch changes, this is
   * updated to match what the branch says, and `pnpm protection:verify` is what
   * tells you it has.
   *
   * It is the whole payload rather than the `ruleset()` helper on purpose: the
   * helper is OUR idea of the shape, and asserting against it would be
   * comparing a parser to itself (RULING 147). This is what GitHub sent.
   */
  const live = {
    id: 21572280,
    name: "main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [
            { context: "build (default)", integration_id: 15368 },
            { context: "build (standalone)", integration_id: 15368 },
            { context: "gates (test · lint · tsc)", integration_id: 15368 },
          ],
        },
      },
    ],
    bypass_actors: [{ actor_id: null, actor_type: "DeployKey", bypass_mode: "exempt" }],
  };

  const liveKeys = [
    {
      id: 161394591,
      title: "wtp-scheduled-pushers",
      read_only: false,
      created_at: "2026-08-26T15:32:24Z",
      last_used: null,
    },
  ];

  // `classic: null` is the API's own answer: `branches/main/protection` returns
  // HTTP 404 "Branch not protected", so the classic rule is genuinely gone.
  const r = judgeProtection(complete(null, [live], liveKeys), CONTEXTS);
  assert.equal(r.verdict, "intact", r.summary);
  assert.equal(r.shape, "ruleset", "classic protection is gone — not `both`");
  assert.equal(r.assertions.filter((a) => a.ok !== true).length, 0, r.summary);
});
